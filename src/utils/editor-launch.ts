/**
 * Location: src/utils/editor-launch.ts
 *
 * Summary:
 * Utility module for launching Unreal Editor in various modes (editor, headless, game, server).
 * Provides functionality to find the Unreal Editor executable, build command-line arguments,
 * and launch the editor process for CI/CD automation scenarios.
 *
 * Usage:
 * - Used by system-handlers.ts for launch_editor and launch_headless actions
 * - Used by AutomationBridge for auto-launch capability when connection fails
 * - findUnrealEditorPath() - Locates the Unreal Editor executable
 * - buildLaunchArgs() - Constructs command-line arguments based on mode
 * - launchEditor() - Spawns the editor process
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';
import { Logger } from './logger.js';

const log = new Logger('EditorLaunch');

/**
 * Launch mode for the Unreal Editor.
 */
export type LaunchMode = 'editor' | 'headless' | 'game' | 'server' | 'commandlet';

/**
 * Options for launching the Unreal Editor.
 */
export interface LaunchOptions {
    /** Path to the .uproject file */
    projectPath: string;
    /** Launch mode (editor, headless, game, server, commandlet) */
    mode?: LaunchMode;
    /** Additional command-line arguments */
    additionalArgs?: string;
    /** Custom path to the Unreal Editor executable */
    editorPath?: string;
    /** Commandlet name (required when mode is 'commandlet') */
    commandletName?: string;
    /** Commandlet arguments (when mode is 'commandlet') */
    commandletArgs?: string;
    /** Whether to run detached from the parent process */
    detached?: boolean;
    /** Custom environment variables */
    env?: Record<string, string>;
    /** Working directory for the process */
    cwd?: string;
}

/**
 * Result of launching the editor.
 */
export interface LaunchResult {
    /** Process ID of the launched editor */
    pid: number | undefined;
    /** The command that was executed */
    command: string;
    /** The arguments passed to the command */
    args: string[];
    /** The child process handle (if not detached) */
    process?: ChildProcess;
}

/**
 * Common Unreal Engine installation paths by version.
 */
const COMMON_UE_PATHS_WINDOWS = [
    'C:/Program Files/Epic Games/UE_5.7/Engine/Binaries/Win64/UnrealEditor.exe',
    'C:/Program Files/Epic Games/UE_5.6/Engine/Binaries/Win64/UnrealEditor.exe',
    'C:/Program Files/Epic Games/UE_5.5/Engine/Binaries/Win64/UnrealEditor.exe',
    'C:/Program Files/Epic Games/UE_5.4/Engine/Binaries/Win64/UnrealEditor.exe',
    'C:/Program Files/Epic Games/UE_5.3/Engine/Binaries/Win64/UnrealEditor.exe',
    'C:/Program Files/Epic Games/UE_5.2/Engine/Binaries/Win64/UnrealEditor.exe',
    'C:/Program Files/Epic Games/UE_5.1/Engine/Binaries/Win64/UnrealEditor.exe',
    'C:/Program Files/Epic Games/UE_5.0/Engine/Binaries/Win64/UnrealEditor.exe',
    'D:/Program Files/Epic Games/UE_5.7/Engine/Binaries/Win64/UnrealEditor.exe',
    'D:/Program Files/Epic Games/UE_5.6/Engine/Binaries/Win64/UnrealEditor.exe',
    'D:/Epic Games/UE_5.7/Engine/Binaries/Win64/UnrealEditor.exe',
    'D:/Epic Games/UE_5.6/Engine/Binaries/Win64/UnrealEditor.exe',
];

const COMMON_UE_PATHS_MAC = [
    '/Users/Shared/Epic Games/UE_5.7/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor',
    '/Users/Shared/Epic Games/UE_5.6/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor',
    '/Users/Shared/Epic Games/UE_5.5/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor',
    '/Applications/Epic Games/UE_5.7/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor',
    '/Applications/Epic Games/UE_5.6/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor',
];

const COMMON_UE_PATHS_LINUX = [
    '/opt/UnrealEngine/Engine/Binaries/Linux/UnrealEditor',
    '~/UnrealEngine/Engine/Binaries/Linux/UnrealEditor',
    '/home/ue/UnrealEngine/Engine/Binaries/Linux/UnrealEditor',
];

/**
 * Finds the Unreal Editor executable path.
 *
 * Search order:
 * 1. Custom path provided in options
 * 2. UE_EDITOR_PATH environment variable
 * 3. Derive from .uproject file location (Engine association)
 * 4. Common installation paths for the current platform
 *
 * @param projectPath - Optional path to .uproject file to derive engine path
 * @param customPath - Optional custom path to check first
 * @returns The path to the Unreal Editor executable
 * @throws Error if no valid editor path is found
 */
export async function findUnrealEditorPath(projectPath?: string, customPath?: string): Promise<string> {
    // 1. Check custom path first
    if (customPath && existsSync(customPath)) {
        log.info(`Using custom editor path: ${customPath}`);
        return customPath;
    }

    // 2. Check environment variable
    const envPath = process.env.UE_EDITOR_PATH;
    if (envPath && existsSync(envPath)) {
        log.info(`Using editor path from UE_EDITOR_PATH: ${envPath}`);
        return envPath;
    }

    // 3. Try to derive from .uproject file (check for EngineAssociation)
    if (projectPath && existsSync(projectPath)) {
        try {
            const derivedPath = await deriveEditorPathFromProject(projectPath);
            if (derivedPath && existsSync(derivedPath)) {
                log.info(`Derived editor path from project: ${derivedPath}`);
                return derivedPath;
            }
        } catch (err) {
            log.debug('Could not derive editor path from project:', err);
        }
    }

    // 4. Check common installation paths
    const commonPaths = getCommonPathsForPlatform();
    for (const path of commonPaths) {
        if (existsSync(path)) {
            log.info(`Found editor at common path: ${path}`);
            return path;
        }
    }

    throw new Error(
        'Could not find Unreal Editor. Please set the UE_EDITOR_PATH environment variable ' +
        'or provide the editorPath option.'
    );
}

/**
 * Gets common Unreal Engine paths for the current platform.
 */
function getCommonPathsForPlatform(): string[] {
    const currentPlatform = platform();
    switch (currentPlatform) {
        case 'win32':
            return COMMON_UE_PATHS_WINDOWS;
        case 'darwin':
            return COMMON_UE_PATHS_MAC;
        case 'linux':
            return COMMON_UE_PATHS_LINUX;
        default:
            log.warn(`Unknown platform: ${currentPlatform}, using Windows paths`);
            return COMMON_UE_PATHS_WINDOWS;
    }
}

/**
 * Attempts to derive the editor path from the project's EngineAssociation.
 */
async function deriveEditorPathFromProject(projectPath: string): Promise<string | null> {
    try {
        const { readFile } = await import('fs/promises');
        const content = await readFile(projectPath, 'utf-8');
        const project = JSON.parse(content);

        const engineAssociation = project.EngineAssociation;
        if (!engineAssociation) {
            return null;
        }

        // Handle version string like "5.7" or "5.6"
        if (/^\d+\.\d+$/.test(engineAssociation)) {
            const version = `UE_${engineAssociation}`;
            const currentPlatform = platform();

            if (currentPlatform === 'win32') {
                const paths = [
                    `C:/Program Files/Epic Games/${version}/Engine/Binaries/Win64/UnrealEditor.exe`,
                    `D:/Program Files/Epic Games/${version}/Engine/Binaries/Win64/UnrealEditor.exe`,
                    `D:/Epic Games/${version}/Engine/Binaries/Win64/UnrealEditor.exe`,
                ];
                for (const p of paths) {
                    if (existsSync(p)) return p;
                }
            } else if (currentPlatform === 'darwin') {
                const paths = [
                    `/Users/Shared/Epic Games/${version}/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor`,
                    `/Applications/Epic Games/${version}/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor`,
                ];
                for (const p of paths) {
                    if (existsSync(p)) return p;
                }
            }
        }

        // Handle GUID-based association (source builds)
        // This would require reading the registry on Windows or the LauncherInstalled.dat file
        // For now, we skip this and fall back to common paths

        return null;
    } catch (err) {
        log.debug('Error reading project file:', err);
        return null;
    }
}

/**
 * Builds command-line arguments for launching the Unreal Editor.
 *
 * @param projectPath - Path to the .uproject file
 * @param mode - Launch mode (editor, headless, game, server, commandlet)
 * @param options - Additional launch options
 * @returns Array of command-line arguments
 */
export function buildLaunchArgs(
    projectPath: string,
    mode: LaunchMode = 'editor',
    options: Partial<LaunchOptions> = {}
): string[] {
    const args: string[] = [projectPath];

    switch (mode) {
        case 'headless':
            // Headless mode - no rendering, minimal UI
            args.push('-nullrhi');           // Null rendering hardware interface
            args.push('-nosplash');          // Skip splash screen
            args.push('-unattended');        // Non-interactive mode
            args.push('-nopause');           // Don't pause on errors
            args.push('-nosound');           // Disable audio
            args.push('-noloadstartuppackages'); // Skip startup packages
            break;

        case 'game':
            // Standalone game mode
            args.push('-game');
            args.push('-windowed');
            args.push('-ResX=1280');
            args.push('-ResY=720');
            break;

        case 'server':
            // Dedicated server mode
            args.push('-server');
            args.push('-log');
            args.push('-unattended');
            break;

        case 'commandlet':
            // Commandlet mode for automation
            if (options.commandletName) {
                args.push(`-run=${options.commandletName}`);
                if (options.commandletArgs) {
                    args.push(options.commandletArgs);
                }
            }
            args.push('-unattended');
            args.push('-nopause');
            break;

        case 'editor':
        default:
            // Standard editor mode - just launch the editor with the project
            break;
    }

    // Always enable the MCP plugin to ensure automation bridge is active
    args.push('-ExecCmds=MCP.Enable');

    // Add logging for debugging
    args.push('-log');

    // Parse and add additional arguments
    if (options.additionalArgs) {
        const extraArgs = options.additionalArgs.trim().split(/\s+/).filter(Boolean);
        args.push(...extraArgs);
    }

    return args;
}

/**
 * Launches the Unreal Editor with the specified options.
 *
 * @param options - Launch options
 * @returns Launch result with process information
 * @throws Error if the editor path cannot be found or the launch fails
 */
export async function launchEditor(options: LaunchOptions): Promise<LaunchResult> {
    const {
        projectPath,
        mode = 'editor',
        additionalArgs,
        editorPath,
        commandletName,
        commandletArgs,
        detached = true,
        env,
        cwd
    } = options;

    // Validate project path
    if (!projectPath) {
        throw new Error('Project path is required');
    }

    if (!existsSync(projectPath)) {
        throw new Error(`Project file not found: ${projectPath}`);
    }

    // Find the editor executable
    const unrealPath = await findUnrealEditorPath(projectPath, editorPath);

    // Build the arguments
    const args = buildLaunchArgs(projectPath, mode, {
        additionalArgs,
        commandletName,
        commandletArgs
    });

    log.info(`Launching Unreal Editor: ${unrealPath}`);
    log.info(`Arguments: ${args.join(' ')}`);
    log.info(`Mode: ${mode}`);

    // Spawn the process
    const spawnOptions: Parameters<typeof spawn>[2] = {
        detached,
        stdio: detached ? 'ignore' : 'inherit',
        env: { ...process.env, ...env },
        cwd: cwd || undefined,
        // On Windows, use shell to handle paths with spaces
        shell: platform() === 'win32'
    };

    const proc = spawn(unrealPath, args, spawnOptions);

    if (detached) {
        // Allow the parent process to exit independently
        proc.unref();
    }

    // Handle spawn errors
    proc.on('error', (err) => {
        log.error('Failed to launch editor:', err);
    });

    return {
        pid: proc.pid,
        command: unrealPath,
        args,
        process: detached ? undefined : proc
    };
}

/**
 * Waits for the Unreal Editor to be ready by checking for MCP connection.
 * This is a helper that can be used after launching to ensure the editor is ready.
 *
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param checkIntervalMs - Interval between checks
 * @param isConnectedFn - Function to check if MCP is connected
 * @returns Promise that resolves when connected or rejects on timeout
 */
export async function waitForEditorReady(
    timeoutMs: number,
    checkIntervalMs: number = 1000,
    isConnectedFn: () => boolean
): Promise<void> {
    const startTime = Date.now();

    return new Promise<void>((resolve, reject) => {
        const check = () => {
            if (isConnectedFn()) {
                resolve();
                return;
            }

            const elapsed = Date.now() - startTime;
            if (elapsed >= timeoutMs) {
                reject(new Error(`Editor did not become ready within ${timeoutMs}ms`));
                return;
            }

            setTimeout(check, checkIntervalMs);
        };

        check();
    });
}

/**
 * Validates that a project path is valid.
 */
export function validateProjectPath(projectPath: string): { valid: boolean; error?: string } {
    if (!projectPath) {
        return { valid: false, error: 'Project path is required' };
    }

    if (!projectPath.endsWith('.uproject')) {
        return { valid: false, error: 'Project path must be a .uproject file' };
    }

    if (!existsSync(projectPath)) {
        return { valid: false, error: `Project file not found: ${projectPath}` };
    }

    return { valid: true };
}
