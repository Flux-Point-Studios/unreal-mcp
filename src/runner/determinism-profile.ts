/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\determinism-profile.ts
 *
 * Determinism Profile - Consistent test execution settings for CI robot mode
 *
 * These profiles ensure reproducible results for visual tests, gameplay validation,
 * and screenshot comparisons by fixing resolution, timestep, random seeds, etc.
 *
 * Used by: Test runners, CI automation scripts, visual regression testing systems
 * Integrates with: Unreal Editor command-line args, engine configuration overrides
 */

export interface DeterminismProfile {
    name: string;
    description: string;
    editorArgs: string[];
    configOverrides: Record<string, string>;
}

/**
 * ROBOT_MODE - Full determinism for CI automation
 *
 * Features:
 * - Fixed timestep at 60 FPS
 * - Deterministic random seed
 * - No splash screens or sounds
 * - Fixed resolution 1920x1080
 * - Disabled texture streaming for consistent LODs
 * - Epic scalability for consistent quality
 */
export const ROBOT_MODE: DeterminismProfile = {
    name: 'robot',
    description: 'Full determinism for CI automation and visual regression testing',
    editorArgs: [
        '-FIXEDTIMESTEP',
        '-FPS=60',
        '-BENCHMARK',
        '-DETERMINISTIC',
        '-NOSPLASH',
        '-NOSOUND',
        '-NOTEXTURESTREAMING',
        '-Scalability=Epic',
        '-NoVerifyGC',
        '-NOVERIFYGC',
        '-UNATTENDED',
        '-ResX=1920',
        '-ResY=1080',
        '-WINDOWED',
        '-WinX=0',
        '-WinY=0'
    ],
    configOverrides: {
        // Disable "helpful" editor popups
        'EditorPerProjectUserSettings.bShowProjectLauncherBanner': 'False',
        'EditorPerProjectUserSettings.bShowImportantNotifications': 'False',
        // Fixed device profile
        'Engine.DeviceProfileManager.ActiveDeviceProfile': 'Windows',
        // Fixed random seed for determinism
        'Engine.RandomSeed': '12345',
        // Disable auto-save
        'EditorPerProjectUserSettings.bAutoSaveEnabled': 'False'
    }
};

/**
 * HEADLESS_MODE - For non-visual tests (uses NullRHI)
 */
export const HEADLESS_MODE: DeterminismProfile = {
    name: 'headless',
    description: 'Headless mode for non-visual automation tests',
    editorArgs: [
        '-NULLRHI',
        '-NOSPLASH',
        '-NOSOUND',
        '-UNATTENDED',
        '-NoVerifyGC',
        '-NOVERIFYGC',
        '-BENCHMARK',
        '-FIXEDTIMESTEP',
        '-FPS=60'
    ],
    configOverrides: {
        'EditorPerProjectUserSettings.bShowProjectLauncherBanner': 'False',
        'EditorPerProjectUserSettings.bShowImportantNotifications': 'False'
    }
};

/**
 * VISUAL_TEST_MODE - For screenshot comparison (rendering ON)
 *
 * IMPORTANT: Do NOT use -NullRHI for visual tests - rendering must be ON
 */
export const VISUAL_TEST_MODE: DeterminismProfile = {
    name: 'visual-test',
    description: 'Visual testing mode with rendering enabled for screenshot comparison',
    editorArgs: [
        '-FIXEDTIMESTEP',
        '-FPS=60',
        '-BENCHMARK',
        '-DETERMINISTIC',
        '-NOSPLASH',
        '-NOSOUND',
        '-NOTEXTURESTREAMING',
        '-Scalability=Epic',
        '-NoVerifyGC',
        '-NOVERIFYGC',
        '-UNATTENDED',
        '-ResX=1920',
        '-ResY=1080',
        '-WINDOWED',
        // Force specific graphics settings
        '-FORCERES',
        '-dx12',  // or -dx11 for consistency
        // Disable temporal effects that cause frame-to-frame variation
        '-NoAntiAliasing',
        '-NoMotionBlur'
    ],
    configOverrides: {
        'EditorPerProjectUserSettings.bShowProjectLauncherBanner': 'False',
        'EditorPerProjectUserSettings.bShowImportantNotifications': 'False',
        'Engine.DeviceProfileManager.ActiveDeviceProfile': 'Windows',
        'Engine.RandomSeed': '12345',
        // Disable auto-exposure
        'Engine.AutoExposure.bEnabled': 'False',
        // Fixed exposure
        'Engine.AutoExposure.Exposure': '1.0'
    }
};

/**
 * PERFORMANCE_TEST_MODE - For benchmarking (no artificial caps)
 */
export const PERFORMANCE_TEST_MODE: DeterminismProfile = {
    name: 'performance',
    description: 'Performance testing mode without frame rate caps',
    editorArgs: [
        '-NOSPLASH',
        '-NOSOUND',
        '-UNATTENDED',
        '-Scalability=Epic',
        '-ResX=1920',
        '-ResY=1080',
        '-WINDOWED',
        '-BENCHMARK',
        // No FPS cap for true benchmarking
        '-NOVSYNC',
        '-USEALLCORES'
    ],
    configOverrides: {
        'Engine.bSmoothFrameRate': 'False',
        'Engine.MaxFPS': '0'
    }
};

/**
 * All available profiles
 */
export const PROFILES: Record<string, DeterminismProfile> = {
    robot: ROBOT_MODE,
    headless: HEADLESS_MODE,
    'visual-test': VISUAL_TEST_MODE,
    performance: PERFORMANCE_TEST_MODE
};

/**
 * Manager class for applying determinism profiles
 */
export class DeterminismManager {
    private currentProfile: DeterminismProfile | null = null;
    private _projectConfigPath: string;

    constructor(projectPath: string) {
        this._projectConfigPath = projectPath;
    }

    /**
     * Get a profile by name
     */
    getProfile(name: string): DeterminismProfile | undefined {
        return PROFILES[name];
    }

    /**
     * Apply a profile and return editor args
     */
    applyProfile(profileOrName: DeterminismProfile | string): string[] {
        const profile = typeof profileOrName === 'string'
            ? PROFILES[profileOrName]
            : profileOrName;

        if (!profile) {
            throw new Error(`Unknown determinism profile: ${profileOrName}`);
        }

        this.currentProfile = profile;

        // Apply config overrides (would write to ini files in real implementation)
        for (const [key, value] of Object.entries(profile.configOverrides)) {
            this.setConfigValue(key, value);
        }

        console.log(`[Determinism] Applied profile: ${profile.name}`);
        console.log(`[Determinism] Editor args: ${profile.editorArgs.length} flags`);

        return profile.editorArgs;
    }

    /**
     * Get current profile
     */
    getCurrentProfile(): DeterminismProfile | null {
        return this.currentProfile;
    }

    /**
     * Set a config value (writes to appropriate ini file)
     */
    private setConfigValue(key: string, value: string): void {
        // In a real implementation, this would parse the key to determine
        // which ini file to write to and update it appropriately
        // For now, we just log it
        console.log(`[Determinism] Config: ${key} = ${value}`);
    }

    /**
     * Get args suitable for visual testing (explicitly no NullRHI)
     */
    getVisualTestArgs(): string[] {
        return this.applyProfile(VISUAL_TEST_MODE);
    }

    /**
     * Get args for headless testing (with NullRHI)
     */
    getHeadlessArgs(): string[] {
        return this.applyProfile(HEADLESS_MODE);
    }

    /**
     * Get args for full robot mode
     */
    getRobotModeArgs(): string[] {
        return this.applyProfile(ROBOT_MODE);
    }

    /**
     * Merge profile args with additional custom args
     */
    mergeArgs(profile: DeterminismProfile | string, additionalArgs: string[]): string[] {
        const profileArgs = typeof profile === 'string'
            ? PROFILES[profile]?.editorArgs || []
            : profile.editorArgs;

        // Remove duplicates and conflicts
        const argSet = new Set<string>();
        const conflictPrefixes = ['-ResX=', '-ResY=', '-FPS='];

        for (const arg of [...profileArgs, ...additionalArgs]) {
            // Check for conflicts and remove existing conflicting args
            conflictPrefixes.forEach(prefix => {
                if (arg.startsWith(prefix)) {
                    // Remove existing arg with same prefix
                    for (const existing of argSet) {
                        if (existing.startsWith(prefix)) {
                            argSet.delete(existing);
                            break;
                        }
                    }
                }
            });

            argSet.add(arg);
        }

        return Array.from(argSet);
    }
}

/**
 * Quick helper to get robot mode args
 */
export function getRobotModeArgs(): string[] {
    return [...ROBOT_MODE.editorArgs];
}

/**
 * Quick helper to get visual test args (no NullRHI)
 */
export function getVisualTestArgs(): string[] {
    return [...VISUAL_TEST_MODE.editorArgs];
}

/**
 * Quick helper to get headless args (with NullRHI)
 */
export function getHeadlessArgs(): string[] {
    return [...HEADLESS_MODE.editorArgs];
}
