/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\automation-tests.ts
 *
 * Automation Tests Runner - Run UE automation tests correctly
 *
 * CRITICAL: Use "RunTest" (singular) per Epic's documentation, NOT "RunTests"
 *
 * This module provides functions to run Unreal Engine automation tests via
 * the editor command line. It handles test execution, result parsing, and
 * artifact collection.
 *
 * Used by: CI pipelines, test orchestration, MCP runner daemon
 * Integrates with: types.ts (result interfaces), determinism-profile.ts (editor args)
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { TestResult, AutomationTestConfig, TestFailure } from './types.js';
import { HEADLESS_MODE, ROBOT_MODE } from './determinism-profile.js';

/**
 * Run automation tests using the correct command format
 */
export async function runAutomationTests(config: AutomationTestConfig): Promise<TestResult> {
    const startTime = Date.now();

    // Ensure artifact directory exists
    await fs.mkdir(config.artifactDir, { recursive: true });

    const reportPath = path.join(config.artifactDir, 'automation-report');
    await fs.mkdir(reportPath, { recursive: true });

    // Build command line args
    const editorPath = getEditorCmdPath(config.enginePath);
    const cmdArgs = buildCommandArgs(config, reportPath);

    console.log(`[AutomationTests] Running: ${config.filter}`);
    console.log(`[AutomationTests] Report path: ${reportPath}`);

    const result = await spawnEditor(editorPath, cmdArgs, config.timeout);
    const report = await parseAutomationReport(reportPath);

    return {
        success: report.passed === report.total && report.failed === 0,
        passed: report.passed,
        failed: report.failed,
        skipped: report.skipped,
        total: report.total,
        duration: Date.now() - startTime,
        artifacts: {
            report: path.join(reportPath, 'index.json'),
            html: path.join(reportPath, 'index.html'),
            logs: [result.logPath].filter(Boolean) as string[]
        },
        failures: report.failures
    };
}

/**
 * Build command line arguments for automation tests
 * CRITICAL: Use singular "RunTest" per Epic docs
 */
function buildCommandArgs(config: AutomationTestConfig, reportPath: string): string[] {
    const args: string[] = [
        config.projectPath,
        // CORRECT: Use singular "RunTest" per Epic documentation
        `-ExecCmds="Automation RunTest ${config.filter};Quit"`,
        `-ReportExportPath="${reportPath}"`,
        '-unattended',
        '-nosplash',
        '-ResumeRunTest'  // Resume from first not-run test after crash
    ];

    // Only use -NullRHI for non-rendering tests
    // IMPORTANT: Don't use -NullRHI for visual tests!
    if (!config.requiresRendering) {
        args.push('-NullRHI');
    }

    // Add determinism args for consistent results
    const profile = config.requiresRendering ? ROBOT_MODE : HEADLESS_MODE;
    args.push(...profile.editorArgs.filter(arg =>
        // Don't duplicate args we already have
        !arg.includes('NullRHI') &&
        !arg.includes('unattended') &&
        !arg.includes('nosplash')
    ));

    return args;
}

/**
 * Get the editor command-line executable path
 */
function getEditorCmdPath(enginePathOverride?: string): string {
    // Use provided engine path, or fall back to env, or default
    const enginePath = enginePathOverride || process.env.UE_ENGINE_PATH || 'D:\\UnrealEngine\\UE_5.7';

    const platform = process.platform;
    if (platform === 'win32') {
        return path.join(enginePath, 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe');
    } else if (platform === 'darwin') {
        return path.join(enginePath, 'Binaries', 'Mac', 'UnrealEditor-Cmd');
    } else {
        return path.join(enginePath, 'Binaries', 'Linux', 'UnrealEditor-Cmd');
    }
}

/**
 * Spawn editor process and wait for completion
 */
async function spawnEditor(
    editorPath: string,
    args: string[],
    timeout: number
): Promise<{ exitCode: number; stdout: string; stderr: string; logPath?: string }> {
    return new Promise((resolve) => {
        console.log(`[AutomationTests] Spawning: ${editorPath}`);
        console.log(`[AutomationTests] Args: ${args.join(' ')}`);

        const opts: SpawnOptions = {
            stdio: 'pipe',
            shell: true
        };

        const proc = spawn(editorPath, args, opts);

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        const timeoutHandle = setTimeout(() => {
            console.log(`[AutomationTests] Timeout after ${timeout}ms`);
            proc.kill('SIGKILL');
        }, timeout);

        proc.on('close', (code) => {
            clearTimeout(timeoutHandle);
            resolve({
                exitCode: code ?? 1,
                stdout,
                stderr
            });
        });

        proc.on('error', (err) => {
            clearTimeout(timeoutHandle);
            resolve({
                exitCode: 1,
                stdout,
                stderr: stderr + `\nProcess error: ${err.message}`
            });
        });
    });
}

/**
 * Parse automation test report from output directory
 */
async function parseAutomationReport(reportPath: string): Promise<{
    passed: number;
    failed: number;
    skipped: number;
    total: number;
    failures: TestFailure[];
}> {
    const result = {
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        failures: [] as TestFailure[]
    };

    try {
        // Try to read index.json if it exists
        const indexPath = path.join(reportPath, 'index.json');
        const content = await fs.readFile(indexPath, 'utf-8');
        const report = JSON.parse(content);

        // Parse standard UE automation report format
        if (report.tests && Array.isArray(report.tests)) {
            for (const test of report.tests) {
                result.total++;
                if (test.state === 'success' || test.state === 'passed') {
                    result.passed++;
                } else if (test.state === 'skipped') {
                    result.skipped++;
                } else {
                    result.failed++;
                    result.failures.push({
                        name: test.name || test.testName || 'Unknown',
                        message: test.message || test.error || 'Test failed',
                        stack: test.stack
                    });
                }
            }
        } else if (report.passed !== undefined) {
            // Alternative format
            result.passed = report.passed || 0;
            result.failed = report.failed || 0;
            result.skipped = report.skipped || 0;
            result.total = result.passed + result.failed + result.skipped;
        }

    } catch (err) {
        // Report file doesn't exist or can't be parsed
        console.log(`[AutomationTests] Could not parse report: ${err}`);

        // Try to find any log files in the directory
        try {
            const files = await fs.readdir(reportPath);
            for (const file of files) {
                if (file.endsWith('.log') || file.endsWith('.txt')) {
                    const content = await fs.readFile(path.join(reportPath, file), 'utf-8');
                    // Try to extract pass/fail counts from log
                    const passMatch = content.match(/(\d+)\s+(?:test|tests)\s+passed/i);
                    const failMatch = content.match(/(\d+)\s+(?:test|tests)\s+failed/i);

                    if (passMatch) result.passed = parseInt(passMatch[1], 10);
                    if (failMatch) result.failed = parseInt(failMatch[1], 10);
                    result.total = result.passed + result.failed + result.skipped;
                    break;
                }
            }
        } catch {
            // Can't read directory
        }
    }

    return result;
}

/**
 * Run a quick smoke test
 */
export async function runSmokeTests(projectPath: string, artifactDir: string): Promise<TestResult> {
    return runAutomationTests({
        projectPath,
        filter: 'Project.Smoke',  // Assumes smoke tests are prefixed
        artifactDir,
        timeout: 300000,  // 5 minutes
        requiresRendering: false
    });
}

/**
 * Run all project tests
 */
export async function runAllProjectTests(projectPath: string, artifactDir: string): Promise<TestResult> {
    return runAutomationTests({
        projectPath,
        filter: 'Project.',  // All tests in Project namespace
        artifactDir,
        timeout: 1800000,  // 30 minutes
        requiresRendering: false
    });
}

/**
 * Run visual tests (requires rendering - no NullRHI)
 */
export async function runVisualTests(projectPath: string, artifactDir: string): Promise<TestResult> {
    return runAutomationTests({
        projectPath,
        filter: 'FPS.Visual',
        artifactDir,
        timeout: 600000,  // 10 minutes
        requiresRendering: true  // NO NullRHI!
    });
}

/**
 * List available automation tests
 */
export async function listAutomationTests(projectPath: string): Promise<string[]> {
    const editorPath = getEditorCmdPath(projectPath);
    const args = [
        projectPath,
        '-ExecCmds="Automation List;Quit"',
        '-unattended',
        '-nosplash',
        '-NullRHI'
    ];

    const result = await spawnEditor(editorPath, args, 120000);

    // Parse test names from output
    const tests: string[] = [];
    const lines = result.stdout.split('\n');

    for (const line of lines) {
        const match = line.match(/^\s+(.+\.[\w]+)$/);
        if (match) {
            tests.push(match[1].trim());
        }
    }

    return tests;
}
