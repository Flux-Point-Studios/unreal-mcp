/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\index.ts
 *
 * MCP Runner Module - Barrel exports for CI Robot infrastructure
 *
 * This module provides the complete infrastructure for autonomous Unreal CI:
 * - MCPRunnerDaemon: Main orchestrator (daemon.ts)
 * - BuildGraphExecutor: BuildGraph integration (buildgraph-executor.ts)
 * - UATRunner: UAT command execution (uat-runner.ts)
 * - GauntletRunner: Gauntlet test integration (gauntlet.ts)
 * - EditorInstanceManager: Editor lifecycle management (editor-manager.ts)
 * - EditorWatchdog: Crash recovery and health monitoring (watchdog.ts)
 * - ArtifactStore: Test artifact management (artifact-store.ts)
 * - SCMClient: Git/Perforce integration (scm-client.ts)
 * - DDCManager: Derived Data Cache management (ddc-manager.ts)
 * - VisualRegressionRunner: Screenshot comparison (visual-regression.ts)
 * - CrashTriager: GPU-aware crash analysis (crash-triage.ts)
 * - ReportServer: Embedded test report viewer (report-server.ts)
 * - DeterminismManager: Robot mode profiles (determinism-profile.ts)
 * - runAutomationTests: Automation test execution (automation-tests.ts)
 * - runGoldenScenario: Gameplay validation (golden-scenario.ts)
 *
 * Usage:
 *   import { MCPRunnerDaemon, createDaemon } from './runner/index.js';
 *   const daemon = createDaemon({ projectPath: '...', enginePath: '...' });
 *   await daemon.start();
 *   await daemon.runWorkflow(workflowSpec);
 */

// Core Daemon
export {
    MCPRunnerDaemon,
    createDaemon,
    type DaemonConfig,
    type DaemonStatus
} from './daemon.js';

// Types
export * from './types.js';

// Build & Execution
export {
    BuildGraphExecutor,
    createBuildGraphExecutor
} from './buildgraph-executor.js';

export {
    UATRunner,
    createUATRunner
} from './uat-runner.js';

export {
    GauntletRunner,
    createGauntletRunner
} from './gauntlet.js';

// Editor Management
export {
    EditorInstanceManager,
    createRobotModeEditor
} from './editor-manager.js';

export {
    EditorWatchdog,
    createWatchdog
} from './watchdog.js';

// Storage & Artifacts
export {
    ArtifactStore,
    createArtifactStore
} from './artifact-store.js';

// SCM Integration
export {
    SCMClient,
    createSCMClient
} from './scm-client.js';

// DDC (Derived Data Cache)
export {
    DDCManager,
    createLocalDDCManager,
    createZenDDCManager
} from './ddc-manager.js';

// Testing
export {
    VisualRegressionRunner,
    createVisualRegressionRunner,
    captureVisualBaseline,
    compareVisuals
} from './visual-regression.js';

export {
    runAutomationTests
} from './automation-tests.js';

export {
    GoldenScenarioRunner,
    createGoldenScenarioRunner,
    runBasicGameplayScenario,
    runStressTestScenario,
    SCENARIO_TEMPLATES
} from './golden-scenario.js';

// Crash Analysis
export {
    CrashTriager,
    triageCrash,
    formatCrashReport
} from './crash-triage.js';

// Report Server
export {
    ReportServer,
    createReportServer
} from './report-server.js';

// Determinism Profiles
export {
    ROBOT_MODE,
    HEADLESS_MODE,
    VISUAL_TEST_MODE,
    PERFORMANCE_TEST_MODE,
    DeterminismManager,
    PROFILES,
    getRobotModeArgs,
    getVisualTestArgs,
    getHeadlessArgs
} from './determinism-profile.js';
