/**
 * UAT Runner - Utility for running Unreal Automation Tool commands
 *
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\uat-runner.ts
 *
 * This file provides a TypeScript wrapper for executing Unreal Automation Tool (UAT)
 * commands. It handles process spawning, timeout management, output capture, and
 * logging. Used by other MCP tools and handlers that need to invoke UAT operations
 * such as BuildCookRun, automation tests, Gauntlet tests, and DDC management.
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface UATRunOptions {
    timeout?: number;           // Timeout in ms (default: 600000 - 10 minutes)
    cwd?: string;               // Working directory
    env?: Record<string, string>; // Additional environment variables
    logFile?: string;           // Path to write log output
    runInBackground?: boolean;  // Return immediately without waiting
}

export interface UATResult {
    success: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    duration: number;
    logPath?: string;
}

/**
 * UAT Runner - Execute UAT commands
 */
export class UATRunner {
    private enginePath: string;
    private projectPath?: string;

    constructor(enginePath: string, projectPath?: string) {
        this.enginePath = enginePath;
        this.projectPath = projectPath;
    }

    /**
     * Get the path to RunUAT script
     */
    private getUATPath(): string {
        const platform = process.platform;

        if (platform === 'win32') {
            return path.join(this.enginePath, 'Build', 'BatchFiles', 'RunUAT.bat');
        } else {
            return path.join(this.enginePath, 'Build', 'BatchFiles', 'RunUAT.sh');
        }
    }

    /**
     * Run a UAT command
     */
    async run(command: string, args: string[] = [], options: UATRunOptions = {}): Promise<UATResult> {
        const uatPath = this.getUATPath();
        const startTime = Date.now();

        // Build full command args
        const fullArgs = [command, ...args];

        // Add project path if available and not already in args
        if (this.projectPath && !args.some(a => a.includes('-project='))) {
            fullArgs.push(`-project="${this.projectPath}"`);
        }

        console.log(`[UAT] Running: ${uatPath} ${fullArgs.join(' ')}`);

        const spawnOpts: SpawnOptions = {
            cwd: options.cwd || path.dirname(this.projectPath || this.enginePath),
            shell: true,
            stdio: 'pipe',
            env: {
                ...process.env,
                ...options.env
            }
        };

        return new Promise((resolve) => {
            const proc = spawn(uatPath, fullArgs, spawnOpts);

            let stdout = '';
            let stderr = '';
            let logStream: fs.FileHandle | null = null;

            // Set up log file if specified
            if (options.logFile) {
                fs.open(options.logFile, 'w').then(handle => {
                    logStream = handle;
                }).catch(err => {
                    console.error('[UAT] Failed to open log file:', err);
                });
            }

            proc.stdout?.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                logStream?.write(text);
            });

            proc.stderr?.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                logStream?.write(`[STDERR] ${text}`);
            });

            // Timeout handling
            const timeout = options.timeout || 600000; // 10 min default
            const timeoutHandle = setTimeout(() => {
                console.log(`[UAT] Timeout after ${timeout}ms, killing process`);
                proc.kill('SIGKILL');
            }, timeout);

            proc.on('close', async (code) => {
                clearTimeout(timeoutHandle);

                if (logStream) {
                    await logStream.close();
                }

                const duration = Date.now() - startTime;
                console.log(`[UAT] Completed in ${duration}ms with exit code ${code}`);

                resolve({
                    success: code === 0,
                    exitCode: code ?? 1,
                    stdout,
                    stderr,
                    duration,
                    logPath: options.logFile
                });
            });

            proc.on('error', async (err) => {
                clearTimeout(timeoutHandle);

                if (logStream) {
                    await logStream.close();
                }

                console.error('[UAT] Process error:', err);

                resolve({
                    success: false,
                    exitCode: 1,
                    stdout,
                    stderr: stderr + `\nProcess error: ${err.message}`,
                    duration: Date.now() - startTime,
                    logPath: options.logFile
                });
            });

            // If running in background, resolve immediately with process info
            if (options.runInBackground) {
                resolve({
                    success: true, // Assume success for background tasks
                    exitCode: 0,
                    stdout: `Background process started with PID ${proc.pid}`,
                    stderr: '',
                    duration: 0,
                    logPath: options.logFile
                });
            }
        });
    }

    /**
     * Run BuildCookRun command
     */
    async buildCookRun(config: {
        platform?: string;
        configuration?: string;
        cook?: boolean;
        stage?: boolean;
        pak?: boolean;
        archive?: boolean;
        archiveDir?: string;
    }): Promise<UATResult> {
        const args: string[] = [];

        if (config.platform) args.push(`-platform=${config.platform}`);
        if (config.configuration) args.push(`-configuration=${config.configuration}`);
        if (config.cook) args.push('-cook');
        if (config.stage) args.push('-stage');
        if (config.pak) args.push('-pak');
        if (config.archive) args.push('-archive');
        if (config.archiveDir) args.push(`-archivedirectory="${config.archiveDir}"`);

        args.push('-unattended');
        args.push('-utf8output');

        return this.run('BuildCookRun', args);
    }

    /**
     * Run automation tests
     */
    async runAutomationTests(config: {
        filter: string;
        reportDir?: string;
        nullRHI?: boolean;
    }): Promise<UATResult> {
        const args: string[] = [
            `-ExecCmds="Automation RunTest ${config.filter};Quit"`,
            '-unattended'
        ];

        if (config.reportDir) {
            args.push(`-ReportExportPath="${config.reportDir}"`);
        }

        if (config.nullRHI) {
            args.push('-NullRHI');
        }

        return this.run('RunUnreal', args);
    }

    /**
     * Run a Gauntlet test
     */
    async runGauntlet(config: {
        test: string;
        platform?: string;
        configuration?: string;
        timeout?: number;
        maxRetries?: number;
    }): Promise<UATResult> {
        const args: string[] = [
            `-test=${config.test}`,
            `-platform=${config.platform || 'Win64'}`,
            `-configuration=${config.configuration || 'Development'}`
        ];

        if (config.maxRetries) {
            args.push(`-MaxRetries=${config.maxRetries}`);
        }

        return this.run('RunUnreal', args, { timeout: config.timeout });
    }

    /**
     * Compile all blueprints
     */
    async compileAllBlueprints(): Promise<UATResult> {
        return this.run('CompileAllBlueprints', ['-unattended']);
    }

    /**
     * Resave packages
     */
    async resavePackages(packageFilter?: string): Promise<UATResult> {
        const args = ['-unattended'];
        if (packageFilter) {
            args.push(`-PackageFilter=${packageFilter}`);
        }
        return this.run('ResavePackages', args);
    }

    /**
     * Fill derived data cache
     */
    async fillDDC(maps: string[]): Promise<UATResult> {
        return this.run('DerivedDataCache', [
            '-fill',
            `-Map=${maps.join('+')}`
        ]);
    }
}

/**
 * Create a UAT runner for a project
 */
export function createUATRunner(enginePath: string, projectPath?: string): UATRunner {
    return new UATRunner(enginePath, projectPath);
}
