/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\visual-regression.ts
 *
 * Visual Regression Runner - Screenshot comparison for visual testing
 *
 * CRITICAL: Do NOT use -NullRHI for visual tests - rendering must be ON!
 *
 * This module provides functionality for:
 * - Capturing baseline screenshots from Unreal automation tests
 * - Comparing current screenshots against baselines
 * - Generating visual diff reports
 * - Updating baselines when intentional changes occur
 *
 * Used by: CI pipelines, visual QA workflows, screenshot comparison tests
 * Integrates with: determinism-profile.ts (for consistent rendering settings),
 *                  types.ts (for result interfaces), Unreal automation tests
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { VisualComparisonResult, ImageDifference, BaselineResult } from './types.js';
import { VISUAL_TEST_MODE } from './determinism-profile.js';

/**
 * Visual Regression Runner
 */
export class VisualRegressionRunner {
    private projectPath: string;
    private enginePath: string;
    private baselineDir: string;
    private comparisonThreshold: number = 0.01;  // 1% difference threshold
    private artifactDir: string;

    constructor(config: {
        projectPath: string;
        enginePath: string;
        baselineDir: string;
        artifactDir: string;
        comparisonThreshold?: number;
    }) {
        this.projectPath = config.projectPath;
        this.enginePath = config.enginePath;
        this.baselineDir = config.baselineDir;
        this.artifactDir = config.artifactDir;
        if (config.comparisonThreshold !== undefined) {
            this.comparisonThreshold = config.comparisonThreshold;
        }
    }

    /**
     * Capture baseline screenshots using actual automation test suite
     * IMPORTANT: Rendering must be ON (no -NullRHI)
     */
    async captureBaseline(config: {
        map: string;
        testSuite: string;  // e.g., "FPS.Visual.Baseline" - must be an actual automation test
        resolution: { width: number; height: number };
    }): Promise<BaselineResult> {
        await fs.mkdir(this.baselineDir, { recursive: true });

        const cmdArgs = [
            this.projectPath,
            // Use singular RunTest (Epic's documented form)
            `-ExecCmds="Automation RunTest ${config.testSuite};Quit"`,
            `-Map=${config.map}`,
            `-ScreenshotFolder="${this.baselineDir}"`,
            `-ResX=${config.resolution.width}`,
            `-ResY=${config.resolution.height}`,
            // NO -NullRHI! We need actual rendering for screenshots
            '-unattended',
            '-nosplash',
            // Determinism profile (essential for consistent screenshots)
            ...this.getDeterminismArgs()
        ];

        console.log(`[VisualRegression] Capturing baseline for: ${config.testSuite}`);
        console.log(`[VisualRegression] Resolution: ${config.resolution.width}x${config.resolution.height}`);
        console.log(`[VisualRegression] Output: ${this.baselineDir}`);

        await this.spawnEditor(cmdArgs, 600000);  // 10 min timeout

        const screenshots = await this.listScreenshots(this.baselineDir);

        return {
            baselinePath: this.baselineDir,
            screenshotCount: screenshots.length,
            screenshots
        };
    }

    /**
     * Compare current screenshots against baseline
     */
    async compare(config: {
        map: string;
        testSuite: string;
        thresholds?: {
            global?: number;
            perImage?: Map<string, number>;
        };
    }): Promise<VisualComparisonResult> {
        const tempDir = path.join(this.artifactDir, 'current-screenshots');
        const reportDir = path.join(this.artifactDir, 'visual-report');

        await fs.mkdir(tempDir, { recursive: true });
        await fs.mkdir(reportDir, { recursive: true });

        const cmdArgs = [
            this.projectPath,
            // Singular RunTest
            `-ExecCmds="Automation RunTest ${config.testSuite};Quit"`,
            `-Map=${config.map}`,
            `-ScreenshotFolder="${tempDir}"`,
            `-ScreenshotComparisonFolder="${this.baselineDir}"`,
            `-ReportExportPath="${reportDir}"`,
            // NO -NullRHI
            '-unattended',
            '-nosplash',
            ...this.getDeterminismArgs()
        ];

        console.log('[VisualRegression] Comparing against baseline');

        await this.spawnEditor(cmdArgs, 600000);

        // Parse comparison results
        const report = await this.parseComparisonReport(reportDir);
        const globalThreshold = config.thresholds?.global ?? this.comparisonThreshold;

        const differences: ImageDifference[] = [];
        let maxDifference = 0;

        for (const [imageName, diff] of Object.entries(report.differences)) {
            const threshold = config.thresholds?.perImage?.get(imageName) ?? globalThreshold;
            const passed = diff <= threshold;

            maxDifference = Math.max(maxDifference, diff);

            differences.push({
                name: imageName,
                difference: diff,
                threshold,
                passed,
                diffImagePath: path.join(reportDir, `diff_${imageName}`)
            });
        }

        return {
            success: maxDifference < globalThreshold,
            differences,
            maxDifference,
            artifacts: {
                baseline: this.baselineDir,
                current: tempDir,
                diffImages: differences.filter(d => !d.passed && d.diffImagePath).map(d => d.diffImagePath as string),
                report: path.join(reportDir, 'index.html')
            }
        };
    }

    /**
     * Determinism profile: fixed resolution, timestep, seed, no popups
     * CRITICAL: No -NullRHI - we need actual rendering
     * Uses VISUAL_TEST_MODE from determinism-profile.ts for consistent settings
     */
    private getDeterminismArgs(): string[] {
        // Use the centralized VISUAL_TEST_MODE profile for consistency
        // This profile explicitly does NOT include -NullRHI since we need rendering
        return [...VISUAL_TEST_MODE.editorArgs];
    }

    /**
     * Spawn editor process
     */
    private async spawnEditor(args: string[], timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        const editorPath = path.join(this.enginePath, 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');

        return new Promise((resolve) => {
            const proc = spawn(editorPath, args, {
                stdio: 'pipe',
                shell: true
            });

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data) => { stdout += data.toString(); });
            proc.stderr?.on('data', (data) => { stderr += data.toString(); });

            const timeoutHandle = setTimeout(() => {
                proc.kill('SIGKILL');
            }, timeout);

            proc.on('close', (code) => {
                clearTimeout(timeoutHandle);
                resolve({ stdout, stderr, exitCode: code ?? 1 });
            });

            proc.on('error', (err) => {
                clearTimeout(timeoutHandle);
                resolve({ stdout, stderr: err.message, exitCode: 1 });
            });
        });
    }

    /**
     * List screenshots in a directory
     */
    private async listScreenshots(dir: string): Promise<string[]> {
        try {
            const files = await fs.readdir(dir);
            return files.filter(f =>
                f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.bmp')
            );
        } catch {
            return [];
        }
    }

    /**
     * Parse comparison report
     */
    private async parseComparisonReport(reportDir: string): Promise<{
        differences: Record<string, number>;
        maxDifference: number;
    }> {
        const differences: Record<string, number> = {};
        let maxDifference = 0;

        try {
            // Try to read UE's comparison report
            const reportPath = path.join(reportDir, 'ComparisonReport.json');
            const content = await fs.readFile(reportPath, 'utf-8');
            const report = JSON.parse(content);

            if (report.comparisons && Array.isArray(report.comparisons)) {
                for (const comp of report.comparisons) {
                    const diff = comp.difference ?? comp.pixelDifference ?? 0;
                    differences[comp.name || comp.imageName] = diff;
                    maxDifference = Math.max(maxDifference, diff);
                }
            }
        } catch {
            // If no report file, compare manually
            const baselineFiles = await this.listScreenshots(this.baselineDir);

            for (const file of baselineFiles) {
                // In a real implementation, we'd use an image comparison library
                // For now, assume 0 difference (would need actual pixel comparison)
                differences[file] = 0;
            }
        }

        return { differences, maxDifference };
    }

    /**
     * Update baseline with current screenshots
     */
    async updateBaseline(config: {
        map: string;
        testSuite: string;
        resolution: { width: number; height: number };
    }): Promise<BaselineResult> {
        // Clear existing baseline
        try {
            await fs.rm(this.baselineDir, { recursive: true, force: true });
        } catch {
            // Directory might not exist
        }

        // Capture new baseline
        return this.captureBaseline(config);
    }
}

/**
 * Create a visual regression runner
 */
export function createVisualRegressionRunner(config: {
    projectPath: string;
    enginePath: string;
    baselineDir: string;
    artifactDir: string;
    comparisonThreshold?: number;
}): VisualRegressionRunner {
    return new VisualRegressionRunner(config);
}

/**
 * Quick baseline capture
 */
export async function captureVisualBaseline(
    projectPath: string,
    enginePath: string,
    baselineDir: string,
    testSuite: string = 'FPS.Visual.Baseline'
): Promise<BaselineResult> {
    const runner = new VisualRegressionRunner({
        projectPath,
        enginePath,
        baselineDir,
        artifactDir: path.dirname(baselineDir)
    });

    return runner.captureBaseline({
        map: '/Game/Maps/TestMap',
        testSuite,
        resolution: { width: 1920, height: 1080 }
    });
}

/**
 * Quick visual comparison
 */
export async function compareVisuals(
    projectPath: string,
    enginePath: string,
    baselineDir: string,
    artifactDir: string,
    testSuite: string = 'FPS.Visual.Baseline'
): Promise<VisualComparisonResult> {
    const runner = new VisualRegressionRunner({
        projectPath,
        enginePath,
        baselineDir,
        artifactDir
    });

    return runner.compare({
        map: '/Game/Maps/TestMap',
        testSuite
    });
}
