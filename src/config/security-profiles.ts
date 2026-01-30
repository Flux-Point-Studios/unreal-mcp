/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\config\security-profiles.ts
 *
 * Security Profiles - Policy-as-code for Dev vs CI environments
 *
 * Provides allowlisting and confirmation requirements for actions
 * to prevent accidental destructive operations in CI environments.
 *
 * This module implements a policy enforcement system that:
 * - Defines security profiles for different environments (dev, ci)
 * - Validates commands and file paths against allowlists
 * - Controls whether arbitrary Python execution is permitted
 * - Tracks which operations require user confirmation
 *
 * Used by: runner daemon, CI robot modules, workflow orchestrator
 * Dependencies: runner/types.ts for SecurityProfile, PolicyViolation types
 */

import { SecurityProfile, SecurityProfileName, PolicyViolation } from '../runner/types.js';

/**
 * Development profile - permissive for local development
 */
export const DEV_PROFILE: SecurityProfile = {
    name: 'dev',
    allowlistedCommands: ['*'],  // All commands allowed
    allowlistedPaths: ['*'],      // All paths allowed
    allowArbitraryPython: true,
    requireConfirmationFor: ['quit_editor', 'delete_asset', 'delete_actor'],
    logLevel: 'verbose'
};

/**
 * CI profile - restrictive for automated pipelines
 */
export const CI_PROFILE: SecurityProfile = {
    name: 'ci',
    allowlistedCommands: [
        'Automation',
        'Cook',
        'CompileAllBlueprints',
        'ResavePackages',
        'DerivedDataCache',
        'BuildGraph',
        'RunUnreal',
        'RunAutomation',
        'BuildCookRun'
    ],
    allowlistedPaths: [
        '${PROJECT_DIR}/**',
        '${ENGINE_DIR}/Build/**',
        '${ENGINE_DIR}/Binaries/**'
    ],
    allowArbitraryPython: false,
    requireConfirmationFor: ['*'],  // All destructive operations need confirmation
    logLevel: 'normal'
};

/**
 * All available profiles
 */
export const SECURITY_PROFILES: Record<SecurityProfileName, SecurityProfile> = {
    dev: DEV_PROFILE,
    ci: CI_PROFILE
};

/**
 * Policy Enforcer - validates commands and paths against security profiles
 */
export class PolicyEnforcer {
    private profile: SecurityProfile;
    private projectDir: string;
    private engineDir: string;

    constructor(
        profileOrName: SecurityProfile | SecurityProfileName,
        projectDir: string,
        engineDir: string
    ) {
        this.profile = typeof profileOrName === 'string'
            ? SECURITY_PROFILES[profileOrName]
            : profileOrName;
        this.projectDir = projectDir;
        this.engineDir = engineDir;
    }

    /**
     * Get current profile name
     */
    getProfileName(): SecurityProfileName {
        return this.profile.name;
    }

    /**
     * Validate a command against the allowlist
     */
    validateCommand(command: string): PolicyViolation | null {
        if (this.profile.allowlistedCommands.includes('*')) {
            return null;
        }

        const isAllowed = this.profile.allowlistedCommands.some(allowed => {
            // Support prefix matching
            if (allowed.endsWith('*')) {
                return command.startsWith(allowed.slice(0, -1));
            }
            return command === allowed || command.startsWith(allowed + ' ');
        });

        if (!isAllowed) {
            return {
                rule: 'COMMAND_NOT_ALLOWLISTED',
                attempted: command,
                allowed: this.profile.allowlistedCommands
            };
        }

        return null;
    }

    /**
     * Validate a file path against the allowlist
     */
    validatePath(filePath: string): PolicyViolation | null {
        if (this.profile.allowlistedPaths.includes('*')) {
            return null;
        }

        const normalizedPath = this.normalizePath(filePath);

        const isAllowed = this.profile.allowlistedPaths.some(pattern => {
            return this.matchPath(normalizedPath, pattern);
        });

        if (!isAllowed) {
            return {
                rule: 'PATH_NOT_ALLOWLISTED',
                attempted: filePath,
                allowed: this.profile.allowlistedPaths
            };
        }

        return null;
    }

    /**
     * Check if an action requires confirmation
     */
    requiresConfirmation(action: string): boolean {
        if (this.profile.requireConfirmationFor.includes('*')) {
            return true;
        }
        return this.profile.requireConfirmationFor.includes(action);
    }

    /**
     * Check if arbitrary Python execution is allowed
     */
    allowsPython(): boolean {
        return this.profile.allowArbitraryPython;
    }

    /**
     * Validate Python code execution
     */
    validatePython(code: string): PolicyViolation | null {
        if (!this.profile.allowArbitraryPython) {
            return {
                rule: 'PYTHON_NOT_ALLOWED',
                attempted: code.substring(0, 100) + (code.length > 100 ? '...' : ''),
                allowed: []
            };
        }
        return null;
    }

    /**
     * Get allowlisted commands for capability reporting
     */
    getAllowlistedCommands(): string[] {
        return [...this.profile.allowlistedCommands];
    }

    /**
     * Get allowlisted paths for capability reporting
     */
    getAllowlistedPaths(): string[] {
        return this.profile.allowlistedPaths.map(p => this.expandPathVariables(p));
    }

    /**
     * Match a path against a pattern with glob support
     */
    private matchPath(path: string, pattern: string): boolean {
        const expandedPattern = this.expandPathVariables(pattern);

        // Simple glob matching (supports ** for recursive, * for single level)
        const regexPattern = expandedPattern
            .replace(/\\/g, '/')
            .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
            .replace(/\*/g, '[^/]*')
            .replace(/<<<DOUBLESTAR>>>/g, '.*');

        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(path.replace(/\\/g, '/'));
    }

    /**
     * Expand path variables
     */
    private expandPathVariables(pattern: string): string {
        return pattern
            .replace(/\$\{PROJECT_DIR\}/g, this.projectDir)
            .replace(/\$\{ENGINE_DIR\}/g, this.engineDir);
    }

    /**
     * Normalize a path for comparison
     */
    private normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/');
    }

    /**
     * Create a detailed policy report
     */
    getSecurityReport(): {
        profile: SecurityProfileName;
        allowlistedCommands: string[];
        allowlistedPaths: string[];
        allowArbitraryPython: boolean;
        confirmationRequired: string[];
        logLevel: string;
    } {
        return {
            profile: this.profile.name,
            allowlistedCommands: this.getAllowlistedCommands(),
            allowlistedPaths: this.getAllowlistedPaths(),
            allowArbitraryPython: this.profile.allowArbitraryPython,
            confirmationRequired: this.profile.requireConfirmationFor,
            logLevel: this.profile.logLevel
        };
    }
}

/**
 * Create a policy enforcer from environment
 */
export function createPolicyEnforcerFromEnv(
    projectDir: string,
    engineDir: string
): PolicyEnforcer {
    // Detect CI environment
    const isCI = !!(
        process.env.CI ||
        process.env.JENKINS_HOME ||
        process.env.GITHUB_ACTIONS ||
        process.env.GITLAB_CI ||
        process.env.TF_BUILD ||
        process.env.BUILDKITE
    );

    const profileName: SecurityProfileName = isCI ? 'ci' : 'dev';
    console.log(`[Security] Using ${profileName} profile (CI detected: ${isCI})`);

    return new PolicyEnforcer(profileName, projectDir, engineDir);
}

/**
 * Validate and throw if policy violation
 */
export function enforcePolicy(
    enforcer: PolicyEnforcer,
    type: 'command' | 'path' | 'python',
    value: string
): void {
    let violation: PolicyViolation | null = null;

    switch (type) {
        case 'command':
            violation = enforcer.validateCommand(value);
            break;
        case 'path':
            violation = enforcer.validatePath(value);
            break;
        case 'python':
            violation = enforcer.validatePython(value);
            break;
    }

    if (violation) {
        throw new PolicyViolationError(violation);
    }
}

/**
 * Custom error for policy violations
 */
export class PolicyViolationError extends Error {
    public violation: PolicyViolation;

    constructor(violation: PolicyViolation) {
        super(`Policy violation: ${violation.rule} - attempted: ${violation.attempted}`);
        this.name = 'PolicyViolationError';
        this.violation = violation;
    }
}
