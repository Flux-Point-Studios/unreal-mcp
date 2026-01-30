/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\types.ts
 *
 * Shared types for MCP Runner Daemon and CI Robot modules.
 *
 * This file provides TypeScript interfaces and types for:
 * - Workflow orchestration (specs, phases, steps, results)
 * - BuildGraph integration (options, results, validation)
 * - DDC (Derived Data Cache) configuration
 * - Test execution and results
 * - Visual regression testing
 * - Scenario-based testing with input sequences
 * - Crash triage and GPU error handling
 * - SCM (Source Control Management) operations
 * - Security profiles and policy enforcement
 * - Editor/Daemon status and configuration
 * - System capabilities discovery
 *
 * Used by: runner daemon, CI robot modules, workflow orchestrator, test harness
 */

// ============ Core Types ============

/**
 * Unique identifier for a workflow run.
 * Format: "run-{timestamp}-{random}" where timestamp is base36 encoded.
 */
export type RunId = string;

/**
 * Specification for a complete workflow to be executed.
 * Workflows consist of phases which contain steps.
 */
export interface WorkflowSpec {
    /** Human-readable name for the workflow */
    name: string;
    /** Optional description of what this workflow does */
    description?: string;
    /** Ordered list of phases to execute */
    phases: WorkflowPhase[];
    /** If true, attempt to rollback changes on failure */
    rollbackOnFailure?: boolean;
    /** Overall timeout in milliseconds for the entire workflow */
    timeout?: number;
    /** List of artifact paths to collect after workflow completion */
    artifacts?: string[];
}

/**
 * A phase within a workflow, containing one or more steps.
 */
export interface WorkflowPhase {
    /** Name of this phase (e.g., "Build", "Test", "Deploy") */
    name: string;
    /** Steps to execute within this phase */
    steps: WorkflowStep[];
    /** If true, execute steps in parallel */
    parallel?: boolean;
    /** If true, continue to next step even if this step fails */
    continueOnError?: boolean;
}

/**
 * A single step within a workflow phase.
 */
export interface WorkflowStep {
    /** Type of step being executed */
    type: 'build' | 'test' | 'cook' | 'package' | 'deploy' | 'custom';
    /** Specific action to perform (e.g., "compile", "run_tests") */
    action: string;
    /** Parameters specific to this step type and action */
    params?: Record<string, unknown>;
    /** Timeout in milliseconds for this step */
    timeout?: number;
}

/**
 * Result of executing a complete workflow.
 */
export interface WorkflowResult {
    /** Unique identifier for this run */
    runId: RunId;
    /** Whether the entire workflow succeeded */
    success: boolean;
    /** Results for each phase in the workflow */
    phases: PhaseResult[];
    /** Human-readable summary of the workflow execution */
    summary: string;
    /** Total duration in milliseconds */
    duration: number;
    /** Collected artifacts from the workflow */
    artifacts: ArtifactInfo[];
    /** Error message if the workflow failed */
    error?: string;
}

/**
 * Result of executing a single phase within a workflow.
 */
export interface PhaseResult {
    /** Name of the phase */
    name: string;
    /** Whether the phase succeeded */
    success: boolean;
    /** Results for each step in the phase */
    steps: StepResult[];
    /** Duration of this phase in milliseconds */
    duration: number;
}

/**
 * Result of executing a single step within a phase.
 */
export interface StepResult {
    /** Type of the step */
    type: string;
    /** Action that was performed */
    action: string;
    /** Whether the step succeeded */
    success: boolean;
    /** Duration of this step in milliseconds */
    duration: number;
    /** Output from the step (stdout, logs, etc.) */
    output?: string;
    /** Error message if the step failed */
    error?: string;
}

/**
 * Information about an artifact produced by a workflow.
 */
export interface ArtifactInfo {
    /** Name of the artifact */
    name: string;
    /** Full path to the artifact */
    path: string;
    /** Size in bytes */
    size?: number;
    /** MIME type or artifact category */
    type?: string;
}

// ============ BuildGraph Types ============

/**
 * Options for BuildGraph execution.
 */
export interface BuildGraphOptions {
    /** Target platform (e.g., "Win64", "Linux", "Android") */
    platform?: string;
    /** Build configuration (e.g., "Development", "Shipping") */
    configuration?: string;
    /** Path to shared DDC storage */
    sharedDDC?: string;
    /** Enable parallel node execution */
    parallel?: boolean;
    /** Enable distributed build across multiple machines */
    distributedBuild?: boolean;
    /** Disable Perforce integration */
    noP4?: boolean;
    /** Additional command-line arguments */
    additionalArgs?: string[];
    /** Timeout in milliseconds for the build */
    timeout?: number;
}

/**
 * Result of a BuildGraph execution.
 */
export interface BuildGraphResult {
    /** Whether the build succeeded */
    success: boolean;
    /** Results for each node that was executed */
    nodes: NodeResult[];
    /** Artifacts produced by the build */
    artifacts: ArtifactInfo[];
    /** Total duration in milliseconds */
    duration: number;
    /** Process exit code */
    exitCode: number;
    /** Standard output from the build process */
    stdout: string;
    /** Standard error from the build process */
    stderr: string;
}

/**
 * Result of executing a single BuildGraph node.
 */
export interface NodeResult {
    /** Name of the node */
    name: string;
    /** Whether the node succeeded */
    success: boolean;
    /** Duration in milliseconds */
    duration: number;
    /** Node-specific output */
    output?: string;
}

/**
 * Result of validating a BuildGraph script.
 */
export interface ValidationResult {
    /** Whether the script is valid */
    valid: boolean;
    /** List of nodes available in the script */
    availableNodes: string[];
    /** Validation errors, if any */
    errors: string[];
}

// ============ DDC Types ============

/**
 * DDC (Derived Data Cache) operating mode.
 * - local: Use only local cache
 * - shared-fileshare: Use network file share for shared cache
 * - zen: Use Zen server for distributed caching
 * - cloud-ddc: Use cloud-based DDC (e.g., Horde)
 */
export type DDCMode = 'local' | 'shared-fileshare' | 'zen' | 'cloud-ddc';

/**
 * Configuration for DDC (Derived Data Cache).
 */
export interface DDCConfig {
    /** Operating mode for the DDC */
    mode: DDCMode;
    /** Path to shared storage (for shared-fileshare mode) */
    sharedStoragePath?: string;
    /** URL of Zen server (for zen mode) */
    zenServerUrl?: string;
    /** Endpoint for cloud DDC (for cloud-ddc mode) */
    cloudDDCEndpoint?: string;
}

// ============ Test Types ============

/**
 * Result of running an automation test suite.
 */
export interface TestResult {
    /** Whether all tests passed */
    success: boolean;
    /** Number of tests that passed */
    passed: number;
    /** Number of tests that failed */
    failed: number;
    /** Number of tests that were skipped */
    skipped: number;
    /** Total number of tests */
    total: number;
    /** Duration in milliseconds */
    duration: number;
    /** Paths to generated artifacts */
    artifacts: {
        /** Path to JSON test report */
        report?: string;
        /** Path to HTML test report */
        html?: string;
        /** Paths to log files */
        logs: string[];
    };
    /** Details of failed tests */
    failures?: TestFailure[];
}

/**
 * Information about a test failure.
 */
export interface TestFailure {
    /** Name of the failed test */
    name: string;
    /** Failure message */
    message: string;
    /** Stack trace, if available */
    stack?: string;
    /** Path to failure screenshot, if available */
    screenshot?: string;
}

/**
 * Configuration for running automation tests.
 */
export interface AutomationTestConfig {
    /** Path to the Unreal project */
    projectPath: string;
    /** Path to the Unreal Engine (optional, uses env UE_ENGINE_PATH if not set) */
    enginePath?: string;
    /** Test filter (e.g., "Project.MyTests", "*.Functional*") */
    filter: string;
    /** Directory to store artifacts */
    artifactDir: string;
    /** Timeout in milliseconds */
    timeout: number;
    /** Whether tests require GPU rendering */
    requiresRendering: boolean;
}

// ============ Visual Regression Types ============

/**
 * Result of a visual regression comparison.
 */
export interface VisualComparisonResult {
    /** Whether all images matched within threshold */
    success: boolean;
    /** Details of each image comparison */
    differences: ImageDifference[];
    /** Paths to generated artifacts */
    artifacts: {
        /** Path to baseline images directory */
        baseline: string;
        /** Path to current images directory */
        current: string;
        /** Paths to difference visualization images */
        diffImages: string[];
        /** Path to HTML comparison report */
        report: string;
    };
    /** Maximum difference percentage across all comparisons */
    maxDifference: number;
}

/**
 * Result of comparing a single image to its baseline.
 */
export interface ImageDifference {
    /** Name of the image being compared */
    name: string;
    /** Percentage difference (0-100) */
    difference: number;
    /** Threshold percentage for passing */
    threshold: number;
    /** Whether this image passed the comparison */
    passed: boolean;
    /** Path to diff visualization image */
    diffImagePath?: string;
}

/**
 * Result of creating or updating baseline images.
 */
export interface BaselineResult {
    /** Path to the baseline directory */
    baselinePath: string;
    /** Number of screenshots captured */
    screenshotCount: number;
    /** Paths to individual screenshots */
    screenshots: string[];
}

// ============ Scenario Types ============

/**
 * Configuration for a test scenario.
 */
export interface ScenarioConfig {
    /** Map to load for the scenario */
    map: string;
    /** Duration in seconds to run the scenario */
    duration: number;
    /** Sequence of inputs to simulate */
    inputSequence: InputAction[];
    /** Assertions to verify after the scenario */
    assertions: ScenarioAssertion[];
}

/**
 * A simulated input action in a scenario.
 */
export interface InputAction {
    /** Enhanced Input action path (e.g., "/Game/Input/IA_Move") */
    actionPath: string;
    /** Value to set (type depends on action binding) */
    value: boolean | number | { x: number; y: number } | { x: number; y: number; z: number };
    /** Duration to hold the input in seconds */
    duration?: number;
    /** Delay before this action in seconds */
    delay?: number;
}

/**
 * An assertion to verify in a scenario.
 */
export interface ScenarioAssertion {
    /** Type of assertion */
    type: 'no_errors' | 'fps_above' | 'no_stuck_state' | 'custom';
    /** Threshold value (for fps_above, etc.) */
    threshold?: number;
    /** Custom check expression or test name */
    customCheck?: string;
}

/**
 * Result of running a test scenario.
 */
export interface ScenarioResult {
    /** Whether the scenario passed all assertions */
    success: boolean;
    /** Performance metrics collected during the scenario */
    metrics: ScenarioMetrics;
    /** Results of each assertion */
    assertions: AssertionResult[];
    /** Artifacts generated during the scenario */
    artifacts: ArtifactInfo[];
}

/**
 * Performance metrics collected during a scenario.
 */
export interface ScenarioMetrics {
    /** Average frames per second */
    avgFPS: number;
    /** Minimum frames per second */
    minFPS: number;
    /** Maximum frames per second */
    maxFPS: number;
    /** Number of errors logged */
    errorCount: number;
    /** Number of frames where game appeared stuck */
    stuckFrames: number;
    /** Actual duration in seconds */
    duration: number;
}

/**
 * Result of evaluating a single assertion.
 */
export interface AssertionResult {
    /** Type of assertion */
    type: string;
    /** Whether the assertion passed */
    passed: boolean;
    /** Human-readable result message */
    message: string;
    /** Actual value observed */
    actual?: unknown;
    /** Expected value */
    expected?: unknown;
}

// ============ Crash Triage Types ============

/**
 * Type of crash detected.
 */
export type CrashType = 'CPU' | 'GPU' | 'HANG' | 'ASSERT' | 'UNKNOWN';

/**
 * Type of GPU error detected.
 */
export type GPUErrorType = 'DEVICE_LOST' | 'OUT_OF_MEMORY' | 'SHADER' | 'UNKNOWN';

/**
 * Report of a crash or hang, with triage information.
 */
export interface CrashReport {
    /** Type of crash */
    type: CrashType;
    /** Parsed callstack frames */
    callstack: string[];
    /** Relevant log lines before the crash */
    relevantLogs: string[];
    /** Path to minidump file, if available */
    minidumpPath?: string;
    /** Path to GPU crash dump, if available */
    gpuCrashDump?: string;
    /** GPU breadcrumb trail for GPU crashes */
    gpuBreadcrumbs?: string[];
    /** AI-suggested cause of the crash */
    suggestedCause?: string;
    /** Recommended next steps for investigation */
    nextActions: string[];
    /** Specific GPU error type, if applicable */
    gpuErrorType?: GPUErrorType;
    /** Timestamp of the crash */
    timestamp?: string;
}

// ============ SCM Types ============

/**
 * Information about an SCM submission attempt.
 */
export interface SCMAttempt {
    /** Run ID associated with this attempt */
    runId: RunId;
    /** Branch name (for Git) */
    branch?: string;
    /** Changelist number (for Perforce) */
    changelist?: number;
    /** Timestamp of the attempt */
    timestamp: string;
}

/**
 * Result of an SCM commit operation.
 */
export interface SCMCommitResult {
    /** Whether the commit succeeded */
    success: boolean;
    /** Git commit hash, if applicable */
    commitHash?: string;
    /** Perforce changelist number, if applicable */
    changelist?: number;
    /** Human-readable result message */
    message: string;
}

// ============ Security Types ============

/**
 * Name of a security profile.
 * - dev: Development profile with more permissive settings
 * - ci: CI/CD profile with stricter security
 */
export type SecurityProfileName = 'dev' | 'ci';

/**
 * Security profile defining allowed operations.
 */
export interface SecurityProfile {
    /** Name of this profile */
    name: SecurityProfileName;
    /** Commands allowed to execute */
    allowlistedCommands: string[];
    /** Paths allowed to access */
    allowlistedPaths: string[];
    /** Whether arbitrary Python execution is allowed */
    allowArbitraryPython: boolean;
    /** Operations that require user confirmation */
    requireConfirmationFor: string[];
    /** Verbosity of security logging */
    logLevel: 'verbose' | 'normal' | 'minimal';
}

/**
 * Information about a security policy violation.
 */
export interface PolicyViolation {
    /** Name of the rule that was violated */
    rule: string;
    /** What was attempted */
    attempted: string;
    /** What is allowed by the policy */
    allowed: string[];
}

// ============ Editor/Daemon Types ============

/**
 * Configuration for launching the Unreal Editor.
 */
export interface EditorConfig {
    /** Path to the Unreal project file */
    projectPath: string;
    /** Path to the Unreal Engine installation */
    enginePath: string;
    /** Additional command-line arguments */
    additionalArgs?: string[];
    /** Timeout for editor operations in milliseconds */
    timeout?: number;
    /** Determinism profile to use */
    determinismProfile?: string;
}

/**
 * Status of the Editor or daemon process.
 */
export interface EditorStatus {
    /** Whether the editor is running */
    running: boolean;
    /** Process ID */
    pid?: number;
    /** Uptime in seconds */
    uptime?: number;
    /** Whether MCP is connected to the editor */
    connected: boolean;
    /** Timestamp of last successful heartbeat */
    lastHeartbeat?: string;
}

// ============ Capability Types ============

/**
 * System capabilities discovered at runtime.
 */
export interface Capabilities {
    /** Unreal Engine version */
    engineVersion: string;
    /** MCP plugin version */
    pluginVersion: string;
    /** Active security profile */
    securityProfile: SecurityProfileName;
    /** DDC configuration summary */
    ddcConfig: {
        mode: DDCMode;
        /** Warning about network DDC, if applicable */
        networkWarning: string;
    };
    /** List of supported MCP actions */
    supportedActions: string[];
    /** Paths allowed by security profile */
    allowlistedPaths: string[];
    /** Commands allowed by security profile */
    allowlistedCommands: string[];
}

// ============ Utility Functions ============

/**
 * Generates a unique run ID for workflow tracking.
 * Format: "run-{timestamp}-{random}" where timestamp is base36 encoded.
 *
 * @returns A unique RunId string
 *
 * @example
 * const runId = generateRunId();
 * // Returns something like "run-lz3v8k-ab12cd"
 */
export function generateRunId(): RunId {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `run-${timestamp}-${random}`;
}
