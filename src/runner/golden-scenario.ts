/**
 * Golden Scenario Test Harness - Gauntlet-style gameplay validation
 *
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\golden-scenario.ts
 *
 * This file provides a test harness for running Gauntlet-style golden scenario tests
 * against Unreal Engine projects. It enables gameplay validation with assertions for
 * CI validation, supporting:
 * - FPS threshold monitoring
 * - Error detection and counting
 * - Stuck state detection
 * - Custom assertion checks
 * - Input sequence playback
 * - Artifact collection and metrics reporting
 *
 * Used by: CI pipelines, automated testing workflows, gameplay validation tools
 * Dependencies: uat-runner.ts, types.ts
 */

import { UATRunner } from './uat-runner.js';
import {
    ScenarioConfig,
    ScenarioResult,
    ScenarioAssertion,
    AssertionResult,
    ScenarioMetrics,
    InputAction,
    ArtifactInfo
} from './types.js';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Golden Scenario Runner
 */
export class GoldenScenarioRunner {
    private uatRunner: UATRunner;
    private projectPath: string;
    private artifactDir: string;

    constructor(enginePath: string, projectPath: string, artifactDir: string) {
        this.uatRunner = new UATRunner(enginePath, projectPath);
        this.projectPath = projectPath;
        this.artifactDir = artifactDir;
    }

    /**
     * Run a golden scenario test
     */
    async runScenario(config: ScenarioConfig): Promise<ScenarioResult> {
        await fs.mkdir(this.artifactDir, { recursive: true });

        const reportDir = path.join(this.artifactDir, `scenario-${Date.now()}`);
        await fs.mkdir(reportDir, { recursive: true });

        console.log(`[GoldenScenario] Running scenario on map: ${config.map}`);
        console.log(`[GoldenScenario] Duration: ${config.duration}ms`);
        console.log(`[GoldenScenario] Assertions: ${config.assertions.length}`);

        // Build Gauntlet test args
        const uatArgs = [
            `-project="${this.projectPath}"`,
            '-platform=Win64',
            '-configuration=Development',
            '-test=FPS.Scenario.Golden',  // Our custom Gauntlet test
            `-map=${config.map}`,
            `-timeout=${config.duration}`,
            '-ResumeOnCriticalFailure',
            '-MaxRetries=3',
            `-ReportExportPath="${reportDir}"`,
            '-unattended',
            '-nullrhi=0'  // Rendering ON for gameplay
        ];

        // Add input sequence if provided
        if (config.inputSequence.length > 0) {
            const inputJson = JSON.stringify(config.inputSequence);
            const inputFile = path.join(reportDir, 'input-sequence.json');
            await fs.writeFile(inputFile, inputJson);
            uatArgs.push(`-InputSequenceFile="${inputFile}"`);
        }

        const result = await this.uatRunner.run('RunUnreal', uatArgs, {
            timeout: config.duration + 60000,  // Add buffer
            logFile: path.join(reportDir, 'scenario.log')
        });

        // Parse metrics from output
        const metrics = this.parseMetrics(result.stdout, config.duration);

        // Evaluate assertions
        const assertionResults = this.evaluateAssertions(metrics, config.assertions, result.stdout);

        // Collect artifacts
        const artifacts = await this.collectArtifacts(reportDir);

        const success = result.success && assertionResults.every(a => a.passed);

        return {
            success,
            metrics,
            assertions: assertionResults,
            artifacts
        };
    }

    /**
     * Parse metrics from test output
     */
    private parseMetrics(stdout: string, duration: number): ScenarioMetrics {
        // Parse FPS metrics
        const avgFpsMatch = stdout.match(/Average FPS:\s*([\d.]+)/i);
        const minFpsMatch = stdout.match(/(?:Min|Minimum) FPS:\s*([\d.]+)/i);
        const maxFpsMatch = stdout.match(/(?:Max|Maximum) FPS:\s*([\d.]+)/i);

        // Count errors
        const errorMatches = stdout.match(/\berror\b/gi);
        const errorCount = errorMatches ? errorMatches.length : 0;

        // Detect stuck frames (same frame rendered multiple times)
        const stuckMatch = stdout.match(/Stuck frames:\s*(\d+)/i);
        const stuckFrames = stuckMatch ? parseInt(stuckMatch[1], 10) : 0;

        return {
            avgFPS: avgFpsMatch ? parseFloat(avgFpsMatch[1]) : 60,
            minFPS: minFpsMatch ? parseFloat(minFpsMatch[1]) : 0,
            maxFPS: maxFpsMatch ? parseFloat(maxFpsMatch[1]) : 0,
            errorCount,
            stuckFrames,
            duration
        };
    }

    /**
     * Evaluate assertions against metrics
     */
    private evaluateAssertions(
        metrics: ScenarioMetrics,
        assertions: ScenarioAssertion[],
        stdout: string
    ): AssertionResult[] {
        return assertions.map(assertion => {
            switch (assertion.type) {
                case 'no_errors':
                    return {
                        type: 'no_errors',
                        passed: metrics.errorCount === 0,
                        message: metrics.errorCount === 0
                            ? 'No errors detected'
                            : `${metrics.errorCount} errors detected`,
                        actual: metrics.errorCount,
                        expected: 0
                    };

                case 'fps_above':
                    const threshold = assertion.threshold || 30;
                    const fpsPassed = metrics.minFPS >= threshold;
                    return {
                        type: 'fps_above',
                        passed: fpsPassed,
                        message: fpsPassed
                            ? `FPS maintained above ${threshold}`
                            : `FPS dropped to ${metrics.minFPS} (threshold: ${threshold})`,
                        actual: metrics.minFPS,
                        expected: threshold
                    };

                case 'no_stuck_state':
                    const maxStuck = assertion.threshold || 0;
                    const stuckPassed = metrics.stuckFrames <= maxStuck;
                    return {
                        type: 'no_stuck_state',
                        passed: stuckPassed,
                        message: stuckPassed
                            ? 'No stuck states detected'
                            : `${metrics.stuckFrames} stuck frames detected`,
                        actual: metrics.stuckFrames,
                        expected: maxStuck
                    };

                case 'custom':
                    // Custom assertions would need to be evaluated differently
                    // For now, check if the custom check string appears in output
                    if (assertion.customCheck) {
                        const passed = stdout.includes(assertion.customCheck);
                        return {
                            type: 'custom',
                            passed,
                            message: passed
                                ? `Custom check "${assertion.customCheck}" passed`
                                : `Custom check "${assertion.customCheck}" not found in output`,
                            actual: passed,
                            expected: true
                        };
                    }
                    return {
                        type: 'custom',
                        passed: true,
                        message: 'No custom check specified'
                    };

                default:
                    return {
                        type: assertion.type,
                        passed: false,
                        message: `Unknown assertion type: ${assertion.type}`
                    };
            }
        });
    }

    /**
     * Collect artifacts from report directory
     */
    private async collectArtifacts(reportDir: string): Promise<ArtifactInfo[]> {
        const artifacts: ArtifactInfo[] = [];

        try {
            const files = await fs.readdir(reportDir);
            for (const file of files) {
                const filePath = path.join(reportDir, file);
                const stats = await fs.stat(filePath);

                if (stats.isFile()) {
                    artifacts.push({
                        name: file,
                        path: filePath,
                        size: stats.size,
                        type: this.getFileType(file)
                    });
                }
            }
        } catch {
            // Directory might not exist
        }

        return artifacts;
    }

    private getFileType(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        const types: Record<string, string> = {
            '.json': 'application/json',
            '.log': 'text/plain',
            '.txt': 'text/plain',
            '.html': 'text/html',
            '.png': 'image/png'
        };
        return types[ext] || 'application/octet-stream';
    }
}

/**
 * Predefined scenario templates
 */
export const SCENARIO_TEMPLATES = {
    basicGameplay: {
        duration: 60000,  // 1 minute
        inputSequence: [
            { actionPath: '/Game/Input/Actions/IA_Move.IA_Move', value: { x: 0, y: 1 }, duration: 2000 },
            { actionPath: '/Game/Input/Actions/IA_Jump.IA_Jump', value: true, duration: 100 },
            { actionPath: '/Game/Input/Actions/IA_Move.IA_Move', value: { x: 1, y: 0 }, duration: 2000 },
        ] as InputAction[],
        assertions: [
            { type: 'no_errors' as const },
            { type: 'fps_above' as const, threshold: 30 },
            { type: 'no_stuck_state' as const }
        ]
    },

    stressTest: {
        duration: 300000,  // 5 minutes
        inputSequence: [],
        assertions: [
            { type: 'no_errors' as const },
            { type: 'fps_above' as const, threshold: 20 },
            { type: 'no_stuck_state' as const, threshold: 5 }
        ]
    },

    idleTest: {
        duration: 30000,  // 30 seconds idle
        inputSequence: [],
        assertions: [
            { type: 'no_errors' as const },
            { type: 'fps_above' as const, threshold: 30 }
        ]
    }
};

/**
 * Create a golden scenario runner
 */
export function createGoldenScenarioRunner(
    enginePath: string,
    projectPath: string,
    artifactDir: string
): GoldenScenarioRunner {
    return new GoldenScenarioRunner(enginePath, projectPath, artifactDir);
}

/**
 * Quick helper to run a basic gameplay scenario
 */
export async function runBasicGameplayScenario(
    enginePath: string,
    projectPath: string,
    artifactDir: string,
    map: string
): Promise<ScenarioResult> {
    const runner = new GoldenScenarioRunner(enginePath, projectPath, artifactDir);

    return runner.runScenario({
        map,
        ...SCENARIO_TEMPLATES.basicGameplay
    });
}

/**
 * Quick helper to run a stress test scenario
 */
export async function runStressTestScenario(
    enginePath: string,
    projectPath: string,
    artifactDir: string,
    map: string
): Promise<ScenarioResult> {
    const runner = new GoldenScenarioRunner(enginePath, projectPath, artifactDir);

    return runner.runScenario({
        map,
        ...SCENARIO_TEMPLATES.stressTest
    });
}
