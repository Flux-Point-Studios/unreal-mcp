/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\daemon.ts
 *
 * MCP Runner Daemon - Core infrastructure for autonomous CI robot
 *
 * The daemon is the main orchestrator that owns the lifecycle of all CI operations.
 * It survives editor crashes and provides a single MCP tool endpoint for workflows:
 *   workflow.run(...)
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    MCP Runner Daemon                         │
 * │  (Node.js process - owns lifecycle, survives crashes)       │
 * ├─────────────────────────────────────────────────────────────┤
 * │  workflow.run(...)  ←  Single MCP tool endpoint             │
 * ├─────────────────────────────────────────────────────────────┤
 * │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────────┐      │
 * │  │ Editor  │  │  UAT    │  │Gauntlet │  │ BuildGraph│      │
 * │  │ Manager │  │ Runner  │  │ Runner  │  │ Executor  │      │
 * │  └─────────┘  └─────────┘  └─────────┘  └───────────┘      │
 * ├─────────────────────────────────────────────────────────────┤
 * │  Watchdog │ Artifact Store │ SCM Integration │ DDC Mgr     │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Used by: MCP server, CI pipelines, automation workflows
 * Integrates with: All runner modules
 */

import {
    WorkflowSpec,
    WorkflowResult,
    WorkflowPhase,
    PhaseResult,
    StepResult,
    RunId,
    EditorStatus,
    Capabilities,
    SecurityProfileName,
    SCMAttempt,
    generateRunId
} from './types.js';
import { EditorInstanceManager } from './editor-manager.js';
import { UATRunner } from './uat-runner.js';
import { GauntletRunner } from './gauntlet.js';
import { BuildGraphExecutor } from './buildgraph-executor.js';
import { EditorWatchdog } from './watchdog.js';
import { ArtifactStore, RunArtifacts } from './artifact-store.js';
import { SCMClient, createSCMClient } from './scm-client.js';
import { DDCManager } from './ddc-manager.js';
import { PolicyEnforcer, SECURITY_PROFILES } from '../config/security-profiles.js';
import { runAutomationTests } from './automation-tests.js';
import { VisualRegressionRunner } from './visual-regression.js';
import { GoldenScenarioRunner } from './golden-scenario.js';
import { ReportServer } from './report-server.js';
import { CrashTriager } from './crash-triage.js';
import { ROBOT_MODE, DeterminismManager } from './determinism-profile.js';

/**
 * Configuration for the MCP Runner Daemon.
 */
export interface DaemonConfig {
    /** Path to the Unreal project file */
    projectPath: string;
    /** Path to the Unreal Engine installation */
    enginePath: string;
    /** Directory for storing artifacts */
    artifactDir: string;
    /** Security profile to use (default: 'dev') */
    securityProfile?: SecurityProfileName;
    /** Whether to enable the report server (default: true) */
    enableReportServer?: boolean;
    /** Port for the report server (default: 8080) */
    reportServerPort?: number;
    /** SCM type for version control integration */
    scmType?: 'git' | 'perforce';
    /** DDC mode (default: 'local') */
    ddcMode?: 'local' | 'zen';
    /** Zen server URL (required if ddcMode is 'zen') */
    zenServerUrl?: string;
}

/**
 * Status of the daemon.
 */
export interface DaemonStatus {
    /** Whether the daemon is running */
    running: boolean;
    /** Daemon start time */
    startedAt: string;
    /** Uptime in seconds */
    uptime: number;
    /** Editor status */
    editor: EditorStatus;
    /** Number of workflows executed */
    workflowsExecuted: number;
    /** Number of successful workflows */
    workflowsSucceeded: number;
    /** Number of failed workflows */
    workflowsFailed: number;
    /** Currently running workflow ID, if any */
    currentWorkflow?: RunId;
    /** Security profile in use */
    securityProfile: SecurityProfileName;
}

/**
 * MCP Runner Daemon - The main CI robot orchestrator.
 */
export class MCPRunnerDaemon {
    private config: Required<Omit<DaemonConfig, 'scmType'>> & { scmType: 'git' | 'perforce' };
    private editorManager: EditorInstanceManager;
    private uatRunner: UATRunner;
    private gauntletRunner: GauntletRunner;
    private buildGraphExecutor: BuildGraphExecutor;
    private watchdog: EditorWatchdog;
    private artifactStore: ArtifactStore;
    private scmClient: SCMClient;
    private ddcManager: DDCManager;
    private policyEnforcer: PolicyEnforcer;
    private visualRunner: VisualRegressionRunner;
    private goldenScenarioRunner: GoldenScenarioRunner;
    private reportServer?: ReportServer;
    private crashTriager: CrashTriager;
    private determinismManager: DeterminismManager;

    private startTime: Date;
    private workflowsExecuted: number = 0;
    private workflowsSucceeded: number = 0;
    private workflowsFailed: number = 0;
    private currentWorkflowId?: RunId;
    private currentScmAttempt?: SCMAttempt;
    private running: boolean = false;

    constructor(config: DaemonConfig) {
        // Apply defaults
        this.config = {
            projectPath: config.projectPath,
            enginePath: config.enginePath,
            artifactDir: config.artifactDir,
            securityProfile: config.securityProfile ?? 'dev',
            enableReportServer: config.enableReportServer ?? true,
            reportServerPort: config.reportServerPort ?? 8080,
            scmType: config.scmType ?? 'git',
            ddcMode: config.ddcMode ?? 'local',
            zenServerUrl: config.zenServerUrl ?? ''
        };

        this.startTime = new Date();

        // Initialize all subsystems
        this.editorManager = new EditorInstanceManager({
            projectPath: this.config.projectPath,
            enginePath: this.config.enginePath
        });

        this.uatRunner = new UATRunner(
            this.config.enginePath,
            this.config.projectPath
        );

        this.gauntletRunner = new GauntletRunner(
            this.config.enginePath,
            this.config.projectPath
        );

        this.buildGraphExecutor = new BuildGraphExecutor(
            this.config.enginePath,
            this.config.projectPath
        );

        this.watchdog = new EditorWatchdog({
            crashLogDir: `${this.config.artifactDir}/crashes`
        });

        this.artifactStore = new ArtifactStore(this.config.artifactDir);

        this.scmClient = createSCMClient({
            type: this.config.scmType,
            workingDir: this.config.projectPath
        });

        // DDC Manager
        if (this.config.ddcMode === 'zen' && this.config.zenServerUrl) {
            this.ddcManager = new DDCManager(
                { mode: 'zen', zenServerUrl: this.config.zenServerUrl },
                this.config.projectPath,
                this.config.enginePath
            );
        } else {
            this.ddcManager = new DDCManager(
                { mode: 'local' },
                this.config.projectPath,
                this.config.enginePath
            );
        }

        // Policy Enforcer with 3 required arguments
        this.policyEnforcer = new PolicyEnforcer(
            this.config.securityProfile,
            this.config.projectPath,
            this.config.enginePath
        );

        this.visualRunner = new VisualRegressionRunner({
            projectPath: this.config.projectPath,
            enginePath: this.config.enginePath,
            baselineDir: `${this.config.artifactDir}/visual-baselines`,
            artifactDir: this.config.artifactDir
        });

        this.goldenScenarioRunner = new GoldenScenarioRunner(
            this.config.enginePath,
            this.config.projectPath,
            this.config.artifactDir
        );

        this.crashTriager = new CrashTriager(`${this.config.artifactDir}/crashes`);

        this.determinismManager = new DeterminismManager(this.config.projectPath);

        // Report server will be initialized in start() if enabled
    }

    /**
     * Start the daemon.
     */
    async start(): Promise<void> {
        if (this.running) {
            console.log('[Daemon] Already running');
            return;
        }

        console.log('[Daemon] Starting MCP Runner Daemon...');
        this.running = true;
        this.startTime = new Date();

        // Start the watchdog (will attach to editor when it starts)
        // Watchdog.start() requires an editor manager, so we defer until editor starts
        // For now, just log that we're ready

        // Start report server if enabled
        if (this.config.enableReportServer) {
            this.reportServer = new ReportServer({
                port: this.config.reportServerPort,
                artifactStore: this.artifactStore
            });
            await this.reportServer.start();
            console.log(`[Daemon] Report server running at http://localhost:${this.config.reportServerPort}`);
        }

        console.log('[Daemon] Daemon started successfully');
        console.log(`[Daemon] Security profile: ${this.config.securityProfile}`);
        console.log(`[Daemon] DDC mode: ${this.config.ddcMode}`);

        // Log DDC warning for Zen
        if (this.config.ddcMode === 'zen') {
            console.warn('[Daemon] WARNING: Zen DDC is UNAUTHENTICATED - use on trusted LAN/VPN only!');
        }
    }

    /**
     * Stop the daemon.
     */
    async stop(): Promise<void> {
        if (!this.running) {
            console.log('[Daemon] Not running');
            return;
        }

        console.log('[Daemon] Stopping MCP Runner Daemon...');

        // Stop the watchdog
        this.watchdog.stop();

        // Stop report server
        if (this.reportServer) {
            await this.reportServer.stop();
        }

        // Stop editor if running
        if (this.editorManager.isRunning()) {
            await this.editorManager.shutdown();
        }

        this.running = false;
        console.log('[Daemon] Daemon stopped');
    }

    /**
     * Get the current daemon status.
     */
    getStatus(): DaemonStatus {
        // getStatus() returns EditorStatus directly, not a Promise
        const editorStatus = this.editorManager.getStatus();

        return {
            running: this.running,
            startedAt: this.startTime.toISOString(),
            uptime: (Date.now() - this.startTime.getTime()) / 1000,
            editor: editorStatus,
            workflowsExecuted: this.workflowsExecuted,
            workflowsSucceeded: this.workflowsSucceeded,
            workflowsFailed: this.workflowsFailed,
            currentWorkflow: this.currentWorkflowId,
            securityProfile: this.config.securityProfile
        };
    }

    /**
     * Get system capabilities.
     */
    getCapabilities(): Capabilities {
        const profile = SECURITY_PROFILES[this.config.securityProfile];

        return {
            engineVersion: 'UE 5.7',  // Would be dynamically detected
            pluginVersion: '1.0.0',
            securityProfile: this.config.securityProfile,
            ddcConfig: {
                mode: this.config.ddcMode,
                networkWarning: this.ddcManager.getNetworkWarning()
            },
            supportedActions: [
                'build', 'cook', 'test', 'package', 'deploy',
                'visual_regression', 'golden_scenario', 'buildgraph'
            ],
            allowlistedPaths: profile.allowlistedPaths,
            allowlistedCommands: profile.allowlistedCommands
        };
    }

    /**
     * Main entry point: Run a workflow.
     *
     * @param workflow - The workflow specification to execute
     * @returns The result of the workflow execution
     */
    async runWorkflow(workflow: WorkflowSpec): Promise<WorkflowResult> {
        const runId = generateRunId();
        this.currentWorkflowId = runId;
        this.workflowsExecuted++;

        console.log(`[Daemon] Starting workflow "${workflow.name}" (${runId})`);

        const startTime = Date.now();
        // createRun returns a Promise<RunArtifacts>
        const artifacts = await this.artifactStore.createRun(runId);
        const phaseResults: PhaseResult[] = [];

        try {
            // Create SCM attempt (branch/changelist)
            const scmAttempt = await this.scmClient.createAttempt(runId);
            this.currentScmAttempt = scmAttempt;
            console.log(`[Daemon] SCM attempt created: ${scmAttempt.branch || scmAttempt.changelist}`);

            // Apply determinism profile
            this.determinismManager.applyProfile(ROBOT_MODE);

            // Execute each phase
            for (const phase of workflow.phases) {
                console.log(`[Daemon] Starting phase: ${phase.name}`);
                const phaseResult = await this.executePhase(phase, runId, artifacts);
                phaseResults.push(phaseResult);

                // Check for phase failure
                if (!phaseResult.success && !phase.continueOnError) {
                    throw new Error(`Phase "${phase.name}" failed`);
                }
            }

            // All phases succeeded
            const result: WorkflowResult = {
                runId,
                success: true,
                phases: phaseResults,
                summary: `Workflow "${workflow.name}" completed successfully`,
                duration: Date.now() - startTime,
                artifacts: await artifacts.listArtifacts()
            };

            // Commit SCM changes
            await this.scmClient.commitAttempt(scmAttempt, result.summary);
            console.log('[Daemon] SCM changes committed');

            this.workflowsSucceeded++;
            this.currentWorkflowId = undefined;
            this.currentScmAttempt = undefined;

            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            console.error(`[Daemon] Workflow failed: ${errorMessage}`);

            // Write crash log
            await artifacts.write('crash.log', errorMessage);

            // Attempt rollback if configured
            if (workflow.rollbackOnFailure && this.currentScmAttempt) {
                console.log('[Daemon] Attempting rollback...');
                try {
                    // Use revertAttempt with the stored attempt
                    await this.scmClient.revertAttempt(this.currentScmAttempt);
                    console.log('[Daemon] Rollback successful');
                } catch (rollbackError) {
                    console.error(`[Daemon] Rollback failed: ${rollbackError}`);
                }
            }

            this.workflowsFailed++;
            this.currentWorkflowId = undefined;
            this.currentScmAttempt = undefined;

            return {
                runId,
                success: false,
                phases: phaseResults,
                summary: `Workflow "${workflow.name}" failed: ${errorMessage}`,
                duration: Date.now() - startTime,
                artifacts: await artifacts.listArtifacts(),
                error: errorMessage
            };
        }
    }

    /**
     * Execute a single workflow phase.
     */
    private async executePhase(phase: WorkflowPhase, runId: RunId, artifacts: RunArtifacts): Promise<PhaseResult> {
        const startTime = Date.now();
        const stepResults: StepResult[] = [];

        if (phase.parallel) {
            // Execute steps in parallel
            const promises = phase.steps.map(step => this.executeStep(step, runId, artifacts));
            const results = await Promise.all(promises);
            stepResults.push(...results);
        } else {
            // Execute steps sequentially
            for (const step of phase.steps) {
                const result = await this.executeStep(step, runId, artifacts);
                stepResults.push(result);

                if (!result.success && !phase.continueOnError) {
                    break;  // Stop on first failure
                }
            }
        }

        const success = stepResults.every(r => r.success);

        return {
            name: phase.name,
            success,
            steps: stepResults,
            duration: Date.now() - startTime
        };
    }

    /**
     * Execute a single workflow step.
     */
    private async executeStep(
        step: { type: string; action: string; params?: Record<string, unknown>; timeout?: number },
        runId: RunId,
        artifacts: RunArtifacts
    ): Promise<StepResult> {
        const startTime = Date.now();

        console.log(`[Daemon] Executing step: ${step.type}/${step.action}`);

        try {
            let output = '';

            switch (step.type) {
                case 'build':
                    output = await this.executeBuildStep(step);
                    break;
                case 'test':
                    output = await this.executeTestStep(step, runId, artifacts);
                    break;
                case 'cook':
                    output = await this.executeCookStep(step);
                    break;
                case 'package':
                    output = await this.executePackageStep(step);
                    break;
                case 'custom':
                    output = await this.executeCustomStep(step);
                    break;
                default:
                    throw new Error(`Unknown step type: ${step.type}`);
            }

            return {
                type: step.type,
                action: step.action,
                success: true,
                duration: Date.now() - startTime,
                output
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            return {
                type: step.type,
                action: step.action,
                success: false,
                duration: Date.now() - startTime,
                error: errorMessage
            };
        }
    }

    /**
     * Execute a build step.
     */
    private async executeBuildStep(step: { action: string; params?: Record<string, unknown> }): Promise<string> {
        switch (step.action) {
            case 'compile':
            case 'compile_editor':
                const buildResult = await this.buildGraphExecutor.execute(
                    'Build/BuildGraph_CI.xml',
                    ['CompileEditor'],
                    { platform: step.params?.platform as string || 'Win64' }
                );
                if (!buildResult.success) {
                    throw new Error(`Build failed: ${buildResult.stderr}`);
                }
                return buildResult.stdout;

            case 'compile_game':
                const gameResult = await this.buildGraphExecutor.execute(
                    'Build/BuildGraph_CI.xml',
                    ['CompileGame'],
                    { platform: step.params?.platform as string || 'Win64' }
                );
                if (!gameResult.success) {
                    throw new Error(`Game build failed: ${gameResult.stderr}`);
                }
                return gameResult.stdout;

            case 'buildgraph':
                const bgResult = await this.buildGraphExecutor.execute(
                    step.params?.script as string || 'Build/BuildGraph_CI.xml',
                    step.params?.targets as string[] || ['Build'],
                    step.params?.options as Record<string, unknown> || {}
                );
                if (!bgResult.success) {
                    throw new Error(`BuildGraph failed: ${bgResult.stderr}`);
                }
                return bgResult.stdout;

            default:
                throw new Error(`Unknown build action: ${step.action}`);
        }
    }

    /**
     * Execute a test step.
     */
    private async executeTestStep(
        step: { action: string; params?: Record<string, unknown> },
        _runId: RunId,
        artifacts: RunArtifacts
    ): Promise<string> {
        switch (step.action) {
            case 'automation':
            case 'run_automation': {
                const testResult = await runAutomationTests({
                    projectPath: this.config.projectPath,
                    enginePath: this.config.enginePath,
                    filter: step.params?.filter as string || 'Project.',
                    artifactDir: artifacts.getRunDir(),
                    timeout: step.params?.timeout as number || 600000,
                    requiresRendering: step.params?.requiresRendering as boolean ?? false
                });
                if (!testResult.success) {
                    throw new Error(`Tests failed: ${testResult.failed}/${testResult.total}`);
                }
                return `Tests passed: ${testResult.passed}/${testResult.total}`;
            }

            case 'visual_regression':
            case 'compare_visuals': {
                const visualResult = await this.visualRunner.compare({
                    map: step.params?.map as string || '/Game/Maps/TestMap',
                    testSuite: step.params?.testSuite as string || 'FPS.Visual.Baseline'
                });
                if (!visualResult.success) {
                    throw new Error(`Visual regression failed: ${visualResult.maxDifference * 100}% difference`);
                }
                return 'Visual comparison passed';
            }

            case 'golden_scenario': {
                const scenarioResult = await this.goldenScenarioRunner.runScenario({
                    map: step.params?.map as string || '/Game/Maps/TestMap',
                    duration: step.params?.duration as number || 60000,
                    inputSequence: step.params?.inputSequence as [] || [],
                    assertions: step.params?.assertions as [] || [
                        { type: 'no_errors' },
                        { type: 'fps_above', threshold: 30 }
                    ]
                });
                if (!scenarioResult.success) {
                    throw new Error('Golden scenario failed');
                }
                return 'Golden scenario passed';
            }

            case 'gauntlet': {
                // GauntletTestConfig uses 'test' not 'testName'
                const gauntletResult = await this.gauntletRunner.runTest({
                    test: step.params?.testName as string || step.params?.test as string || 'DefaultTest',
                    platform: step.params?.platform as string || 'Win64',
                    configuration: step.params?.configuration as string || 'Development',
                    timeout: step.params?.timeout as number || 600000
                });
                if (!gauntletResult.success) {
                    throw new Error(`Gauntlet test failed: ${gauntletResult.failed} tests failed`);
                }
                return 'Gauntlet test passed';
            }

            default:
                throw new Error(`Unknown test action: ${step.action}`);
        }
    }

    /**
     * Execute a cook step.
     */
    private async executeCookStep(step: { action: string; params?: Record<string, unknown> }): Promise<string> {
        const result = await this.uatRunner.run(
            'BuildCookRun',
            [
                `-project="${this.config.projectPath}"`,
                `-platform=${step.params?.platform || 'Win64'}`,
                '-cook',
                '-iterate'
            ]
        );

        if (!result.success) {
            throw new Error(`Cook failed: ${result.stderr}`);
        }

        return result.stdout;
    }

    /**
     * Execute a package step.
     */
    private async executePackageStep(step: { action: string; params?: Record<string, unknown> }): Promise<string> {
        const result = await this.uatRunner.run(
            'BuildCookRun',
            [
                `-project="${this.config.projectPath}"`,
                `-platform=${step.params?.platform || 'Win64'}`,
                '-cook',
                '-stage',
                '-package',
                '-pak'
            ]
        );

        if (!result.success) {
            throw new Error(`Package failed: ${result.stderr}`);
        }

        return result.stdout;
    }

    /**
     * Execute a custom step.
     */
    private async executeCustomStep(step: { action: string; params?: Record<string, unknown> }): Promise<string> {
        // Validate against policy
        const violation = this.policyEnforcer.validateCommand(step.action);
        if (violation) {
            throw new Error(`Policy violation: ${violation.rule} - ${violation.attempted}`);
        }

        // Execute UAT with custom command
        const result = await this.uatRunner.run(step.action, [
            `-project="${this.config.projectPath}"`,
            ...(step.params?.args as string[] || [])
        ]);

        if (!result.success) {
            throw new Error(`Custom step failed: ${result.stderr}`);
        }

        return result.stdout;
    }

    /**
     * Triage a crash.
     */
    async triageCrash(crashDir: string): Promise<void> {
        const report = await this.crashTriager.triage(crashDir);
        console.log(`[Daemon] Crash triaged: ${report.type}`);
        console.log(`[Daemon] Suggested cause: ${report.suggestedCause}`);
        console.log(`[Daemon] Next actions: ${report.nextActions.join(', ')}`);
    }

    /**
     * Get DDC editor args.
     */
    getDDCArgs(): string[] {
        return this.ddcManager.getEditorArgs();
    }

    /**
     * Start the editor and attach watchdog.
     */
    async startEditor(additionalArgs: string[] = []): Promise<number> {
        const pid = await this.editorManager.spawn(additionalArgs);

        // Attach watchdog to editor
        this.watchdog.start(this.editorManager);

        return pid;
    }

    /**
     * Stop the editor gracefully.
     */
    async stopEditor(save: boolean = true): Promise<boolean> {
        this.watchdog.stop();
        return this.editorManager.shutdown(save);
    }
}

/**
 * Create a new MCP Runner Daemon.
 */
export function createDaemon(config: DaemonConfig): MCPRunnerDaemon {
    return new MCPRunnerDaemon(config);
}

/**
 * Default export for module convenience.
 */
export default MCPRunnerDaemon;
