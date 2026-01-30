/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\ddc-manager.ts
 *
 * DDC Manager - Shared Derived Data Cache management for build speed
 *
 * IMPORTANT: Zen server is UNAUTHENTICATED and not advised on public/untrusted networks.
 * Use LAN/VPN only for Zen mode.
 *
 * This module provides:
 * - DDC configuration validation with security warnings
 * - Editor arguments generation for different DDC modes
 * - Cache warming for shader compilation
 * - Connection health checks for remote DDC servers
 *
 * Used by: workflow orchestrator, build runner, CI robot
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { DDCConfig, DDCMode } from './types.js';

export class DDCManager {
    private config: DDCConfig;
    private projectPath: string;
    private enginePath: string;

    constructor(config: DDCConfig, projectPath: string, enginePath: string) {
        this.config = config;
        this.projectPath = projectPath;
        this.enginePath = enginePath;
        this.validateConfig();
    }

    private validateConfig(): void {
        if (this.config.mode === 'zen' && this.config.zenServerUrl) {
            console.warn('[DDC] WARNING: Zen server is UNAUTHENTICATED.');
            console.warn('[DDC] WARNING: Use on trusted LAN/VPN only!');
            console.warn('[DDC] WARNING: For internet-facing setups, use cloud-ddc instead.');
        }

        if (this.config.mode === 'shared-fileshare' && !this.config.sharedStoragePath) {
            throw new Error('DDC mode shared-fileshare requires sharedStoragePath');
        }

        if (this.config.mode === 'zen' && !this.config.zenServerUrl) {
            throw new Error('DDC mode zen requires zenServerUrl');
        }

        if (this.config.mode === 'cloud-ddc' && !this.config.cloudDDCEndpoint) {
            throw new Error('DDC mode cloud-ddc requires cloudDDCEndpoint');
        }
    }

    /**
     * Get network warning for capability handshake
     */
    getNetworkWarning(): string {
        switch (this.config.mode) {
            case 'zen':
                return 'Zen server is unauthenticated - LAN/VPN only, not safe on public networks';
            case 'shared-fileshare':
                return 'Shared fileshare requires network access to storage path';
            case 'cloud-ddc':
                return 'Cloud DDC is authenticated and internet-safe';
            default:
                return 'Local DDC only - no network dependencies';
        }
    }

    /**
     * Get the current DDC mode
     */
    getMode(): DDCMode {
        return this.config.mode;
    }

    /**
     * Get editor arguments for DDC configuration
     */
    getEditorArgs(): string[] {
        switch (this.config.mode) {
            case 'zen':
                return [`-ZenStoreURL="${this.config.zenServerUrl}"`];
            case 'shared-fileshare':
                return [`-SharedStorageDir="${this.config.sharedStoragePath}"`];
            case 'cloud-ddc':
                return [`-CloudDDC="${this.config.cloudDDCEndpoint}"`];
            default:
                return [];
        }
    }

    /**
     * Warm the cache by forcing shader compilation on key maps
     */
    async warmCache(maps: string[]): Promise<{ success: boolean; duration: number }> {
        const startTime = Date.now();

        const editorPath = path.join(this.enginePath, 'Binaries/Win64/UnrealEditor-Cmd.exe');
        const cmdArgs = [
            this.projectPath,
            '-run=DerivedDataCache',
            '-fill',
            `-Map=${maps.join('+')}`,
            ...this.getEditorArgs(),
            '-unattended',
            '-nosplash'
        ];

        return new Promise((resolve) => {
            const proc = spawn(editorPath, cmdArgs, {
                stdio: 'pipe',
                shell: true
            });

            let _stdout = '';
            let _stderr = '';

            proc.stdout?.on('data', (data) => {
                _stdout += data.toString();
            });

            proc.stderr?.on('data', (data) => {
                _stderr += data.toString();
            });

            const timeout = setTimeout(() => {
                proc.kill();
                resolve({
                    success: false,
                    duration: Date.now() - startTime
                });
            }, 600000); // 10 minute timeout

            proc.on('close', (code) => {
                clearTimeout(timeout);
                resolve({
                    success: code === 0,
                    duration: Date.now() - startTime
                });
            });

            proc.on('error', (err) => {
                clearTimeout(timeout);
                console.error('[DDC] Cache warm failed:', err);
                resolve({
                    success: false,
                    duration: Date.now() - startTime
                });
            });
        });
    }

    /**
     * Check DDC connection/availability
     */
    async checkConnection(): Promise<{ available: boolean; latencyMs?: number; error?: string }> {
        switch (this.config.mode) {
            case 'zen':
                return this.checkZenConnection();
            case 'shared-fileshare':
                return this.checkFileshareConnection();
            case 'cloud-ddc':
                return this.checkCloudConnection();
            default:
                return { available: true };
        }
    }

    private async checkZenConnection(): Promise<{ available: boolean; latencyMs?: number; error?: string }> {
        if (!this.config.zenServerUrl) {
            return { available: false, error: 'Zen URL not configured' };
        }

        const startTime = Date.now();
        try {
            // Simple HTTP check to Zen server
            const response = await fetch(`${this.config.zenServerUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });

            return {
                available: response.ok,
                latencyMs: Date.now() - startTime
            };
        } catch (err) {
            return {
                available: false,
                error: `Zen server unreachable: ${err instanceof Error ? err.message : String(err)}`
            };
        }
    }

    private async checkFileshareConnection(): Promise<{ available: boolean; latencyMs?: number; error?: string }> {
        if (!this.config.sharedStoragePath) {
            return { available: false, error: 'Shared storage path not configured' };
        }

        const startTime = Date.now();
        try {
            const fs = await import('fs/promises');
            await fs.access(this.config.sharedStoragePath);
            return {
                available: true,
                latencyMs: Date.now() - startTime
            };
        } catch (err) {
            return {
                available: false,
                error: `Shared storage not accessible: ${err instanceof Error ? err.message : String(err)}`
            };
        }
    }

    private async checkCloudConnection(): Promise<{ available: boolean; latencyMs?: number; error?: string }> {
        if (!this.config.cloudDDCEndpoint) {
            return { available: false, error: 'Cloud DDC endpoint not configured' };
        }

        const startTime = Date.now();
        try {
            const response = await fetch(`${this.config.cloudDDCEndpoint}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(10000)
            });

            return {
                available: response.ok,
                latencyMs: Date.now() - startTime
            };
        } catch (err) {
            return {
                available: false,
                error: `Cloud DDC unreachable: ${err instanceof Error ? err.message : String(err)}`
            };
        }
    }

    /**
     * Get configuration info for reporting
     */
    getConfigInfo(): { mode: DDCMode; warning: string; endpoint?: string } {
        return {
            mode: this.config.mode,
            warning: this.getNetworkWarning(),
            endpoint: this.config.zenServerUrl || this.config.sharedStoragePath || this.config.cloudDDCEndpoint
        };
    }
}

/**
 * Create a DDC manager with default local configuration
 */
export function createLocalDDCManager(projectPath: string, enginePath: string): DDCManager {
    return new DDCManager({ mode: 'local' }, projectPath, enginePath);
}

/**
 * Create a DDC manager with Zen configuration (with security warning)
 */
export function createZenDDCManager(
    projectPath: string,
    enginePath: string,
    zenServerUrl: string
): DDCManager {
    console.warn('SECURITY: Creating Zen DDC manager. Ensure you are on a trusted network!');
    return new DDCManager({ mode: 'zen', zenServerUrl }, projectPath, enginePath);
}
