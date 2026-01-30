/**
 * Gauntlet Integration - UE Gauntlet test framework runner
 *
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\gauntlet.ts
 *
 * This file provides TypeScript integration with Epic's Gauntlet testing framework
 * for running gameplay tests, performance benchmarks, and stress tests. It wraps
 * the UATRunner to execute Gauntlet commands and parses the results.
 *
 * Used by: CI robot modules, test orchestrator, workflow automation
 * Dependencies: uat-runner.ts, types.ts
 */

import { UATRunner } from './uat-runner.js';
import { TestResult, ScenarioMetrics, ArtifactInfo } from './types.js';
import * as path from 'path';

export interface GauntletTestConfig {
    test: string;                    // Test class name
    platform?: string;               // Target platform (Win64, etc.)
    configuration?: string;          // Development, Shipping, etc.
    timeout?: number;                // Test timeout in ms
    maxRetries?: number;             // Max retry attempts on failure
    map?: string;                    // Override map to load
    additionalArgs?: string[];       // Extra command line args
    reportDir?: string;              // Where to save reports
}

export interface GauntletResult extends TestResult {
    testName: string;
    platform: string;
    configuration: string;
    retryCount: number;
    metrics?: ScenarioMetrics;
}

/**
 * Test tier definitions for CI pipeline
 */
export type TestTier = 'smoke' | 'full' | 'stress';

export const TEST_TIERS: Record<TestTier, GauntletTestConfig[]> = {
    smoke: [
        { test: 'FPS.Smoke.Startup', timeout: 60000 },
        { test: 'FPS.Smoke.LoadMap', timeout: 120000 },
    ],
    full: [
        { test: 'FPS.Gameplay.Movement', timeout: 300000 },
        { test: 'FPS.Gameplay.Combat', timeout: 300000 },
        { test: 'FPS.Visual.Baseline', timeout: 300000 },
    ],
    stress: [
        { test: 'FPS.Stress.ManyActors', timeout: 600000 },
        { test: 'FPS.Stress.LongDuration', timeout: 1800000 },
    ]
};

/**
 * Gauntlet Runner - Execute Gauntlet tests
 */
export class GauntletRunner {
    private uatRunner: UATRunner;
    private _projectPath: string;
    private defaultPlatform: string = 'Win64';
    private defaultConfiguration: string = 'Development';

    constructor(enginePath: string, projectPath: string) {
        this.uatRunner = new UATRunner(enginePath, projectPath);
        this._projectPath = projectPath;
    }

    /**
     * Run a single Gauntlet test
     */
    async runTest(config: GauntletTestConfig): Promise<GauntletResult> {
        const platform = config.platform || this.defaultPlatform;
        const configuration = config.configuration || this.defaultConfiguration;
        const maxRetries = config.maxRetries || 0;

        let lastResult: GauntletResult | null = null;
        let retryCount = 0;

        while (retryCount <= maxRetries) {
            console.log(`[Gauntlet] Running test: ${config.test} (attempt ${retryCount + 1}/${maxRetries + 1})`);

            const args = this.buildTestArgs(config, platform, configuration);
            const uatResult = await this.uatRunner.run('RunUnreal', args, {
                timeout: config.timeout || 600000,
                logFile: config.reportDir ? path.join(config.reportDir, `${config.test}_${retryCount}.log`) : undefined
            });

            const result = this.parseGauntletResult(config.test, uatResult, platform, configuration, retryCount);
            lastResult = result;

            if (result.success) {
                console.log(`[Gauntlet] Test ${config.test} PASSED`);
                return result;
            }

            retryCount++;
            if (retryCount <= maxRetries) {
                console.log(`[Gauntlet] Test ${config.test} FAILED, retrying...`);
            }
        }

        console.log(`[Gauntlet] Test ${config.test} FAILED after ${retryCount} attempts`);
        return lastResult!;
    }

    /**
     * Build command line args for Gauntlet test
     */
    private buildTestArgs(config: GauntletTestConfig, platform: string, configuration: string): string[] {
        const args: string[] = [
            `-test=${config.test}`,
            `-platform=${platform}`,
            `-configuration=${configuration}`,
            '-unattended',
            '-nullrhi=0',  // Rendering ON for gameplay tests
            '-ResumeOnCriticalFailure'
        ];

        if (config.map) {
            args.push(`-map=${config.map}`);
        }

        if (config.maxRetries) {
            args.push(`-MaxRetries=${config.maxRetries}`);
        }

        if (config.reportDir) {
            args.push(`-ReportExportPath="${config.reportDir}"`);
        }

        if (config.additionalArgs) {
            args.push(...config.additionalArgs);
        }

        return args;
    }

    /**
     * Parse UAT result into Gauntlet result
     */
    private parseGauntletResult(
        testName: string,
        uatResult: { success: boolean; exitCode: number; stdout: string; stderr: string; duration: number; logPath?: string },
        platform: string,
        configuration: string,
        retryCount: number
    ): GauntletResult {
        // Parse test counts from output
        const passMatch = uatResult.stdout.match(/(\d+) test\(s\) passed/i);
        const failMatch = uatResult.stdout.match(/(\d+) test\(s\) failed/i);
        const skipMatch = uatResult.stdout.match(/(\d+) test\(s\) skipped/i);

        const passed = passMatch ? parseInt(passMatch[1], 10) : (uatResult.success ? 1 : 0);
        const failed = failMatch ? parseInt(failMatch[1], 10) : (uatResult.success ? 0 : 1);
        const skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;

        // Parse metrics if available
        const metrics = this.parseMetrics(uatResult.stdout);

        // Parse failures
        const failures = this.parseFailures(uatResult.stdout, uatResult.stderr);

        const artifacts: ArtifactInfo[] = [];
        if (uatResult.logPath) {
            artifacts.push({
                name: 'test_log',
                path: uatResult.logPath,
                type: 'text/plain'
            });
        }

        return {
            testName,
            platform,
            configuration,
            retryCount,
            success: uatResult.success,
            passed,
            failed,
            skipped,
            total: passed + failed + skipped,
            duration: uatResult.duration,
            metrics,
            failures: failures.length > 0 ? failures : undefined,
            artifacts: {
                logs: artifacts.map(a => a.path)
            }
        };
    }

    /**
     * Parse metrics from test output
     */
    private parseMetrics(stdout: string): ScenarioMetrics | undefined {
        const avgFpsMatch = stdout.match(/Average FPS:\s*([\d.]+)/i);
        const minFpsMatch = stdout.match(/Minimum FPS:\s*([\d.]+)/i);
        const maxFpsMatch = stdout.match(/Maximum FPS:\s*([\d.]+)/i);

        if (avgFpsMatch || minFpsMatch) {
            return {
                avgFPS: avgFpsMatch ? parseFloat(avgFpsMatch[1]) : 0,
                minFPS: minFpsMatch ? parseFloat(minFpsMatch[1]) : 0,
                maxFPS: maxFpsMatch ? parseFloat(maxFpsMatch[1]) : 0,
                errorCount: (stdout.match(/error/gi) || []).length,
                stuckFrames: 0,
                duration: 0
            };
        }

        return undefined;
    }

    /**
     * Parse failure messages from output
     */
    private parseFailures(stdout: string, stderr: string): { name: string; message: string }[] {
        const failures: { name: string; message: string }[] = [];
        const combined = stdout + '\n' + stderr;

        // Look for common failure patterns
        const errorLines = combined.split('\n').filter(line =>
            line.toLowerCase().includes('failed') ||
            line.toLowerCase().includes('error:') ||
            line.toLowerCase().includes('assertion')
        );

        for (const line of errorLines.slice(0, 10)) {  // Limit to 10 failures
            failures.push({
                name: 'TestFailure',
                message: line.trim()
            });
        }

        return failures;
    }

    /**
     * Run a tier of tests
     */
    async runTier(tier: TestTier, reportDir?: string): Promise<GauntletResult[]> {
        const tests = TEST_TIERS[tier];
        const results: GauntletResult[] = [];

        console.log(`[Gauntlet] Running ${tier} tier: ${tests.length} tests`);

        for (const testConfig of tests) {
            const config: GauntletTestConfig = {
                ...testConfig,
                reportDir: reportDir || testConfig.reportDir
            };

            const result = await this.runTest(config);
            results.push(result);

            // For smoke tests, fail fast on any failure
            if (tier === 'smoke' && !result.success) {
                console.log(`[Gauntlet] Smoke test failed, aborting tier`);
                break;
            }
        }

        return results;
    }

    /**
     * Run all tiers in sequence (smoke -> full -> stress)
     */
    async runAllTiers(reportDir?: string): Promise<{
        smoke: GauntletResult[];
        full: GauntletResult[];
        stress: GauntletResult[];
        overallSuccess: boolean;
    }> {
        // Always run smoke tests first
        const smokeResults = await this.runTier('smoke', reportDir);
        const smokeSuccess = smokeResults.every(r => r.success);

        if (!smokeSuccess) {
            return {
                smoke: smokeResults,
                full: [],
                stress: [],
                overallSuccess: false
            };
        }

        // Run full tests
        const fullResults = await this.runTier('full', reportDir);
        const fullSuccess = fullResults.every(r => r.success);

        if (!fullSuccess) {
            return {
                smoke: smokeResults,
                full: fullResults,
                stress: [],
                overallSuccess: false
            };
        }

        // Run stress tests (optional, don't fail overall if these fail)
        const stressResults = await this.runTier('stress', reportDir);

        return {
            smoke: smokeResults,
            full: fullResults,
            stress: stressResults,
            overallSuccess: true
        };
    }
}

/**
 * Create a Gauntlet runner
 */
export function createGauntletRunner(enginePath: string, projectPath: string): GauntletRunner {
    return new GauntletRunner(enginePath, projectPath);
}

/**
 * Quick helper to run a single test
 */
export async function runGauntletTest(
    enginePath: string,
    projectPath: string,
    testName: string,
    options?: Partial<GauntletTestConfig>
): Promise<GauntletResult> {
    const runner = new GauntletRunner(enginePath, projectPath);
    return runner.runTest({
        test: testName,
        ...options
    });
}
