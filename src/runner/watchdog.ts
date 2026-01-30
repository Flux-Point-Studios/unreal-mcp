/**
 * Editor Watchdog - Monitor and recover from editor crashes
 */

import { EventEmitter } from 'events';
import { EditorInstanceManager } from './editor-manager.js';
import { CrashTriager } from './crash-triage.js';
import { CrashReport } from './types.js';

export interface WatchdogConfig {
    heartbeatIntervalMs?: number;     // How often to check (default: 5000)
    heartbeatTimeoutMs?: number;      // Time before considering dead (default: 30000)
    maxCrashCount?: number;           // Max crashes before giving up (default: 3)
    autoRestart?: boolean;            // Auto-restart on crash (default: true)
    crashLogDir?: string;             // Where to find crash logs
}

export interface WatchdogEvents {
    heartbeat: () => void;
    timeout: () => void;
    crash: (report: CrashReport) => void;
    restart: (attempt: number) => void;
    maxCrashesReached: (count: number) => void;
}

/**
 * Editor Watchdog - Monitors editor health and handles crashes
 */
export class EditorWatchdog extends EventEmitter {
    private editorManager: EditorInstanceManager | null = null;
    private config: Required<WatchdogConfig>;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private lastHeartbeat: Date | null = null;
    private crashCount: number = 0;
    private isMonitoring: boolean = false;
    private crashTriager: CrashTriager | null = null;

    constructor(config: WatchdogConfig = {}) {
        super();
        this.config = {
            heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5000,
            heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 30000,
            maxCrashCount: config.maxCrashCount ?? 3,
            autoRestart: config.autoRestart ?? true,
            crashLogDir: config.crashLogDir ?? ''
        };

        if (this.config.crashLogDir) {
            this.crashTriager = new CrashTriager(this.config.crashLogDir);
        }
    }

    /**
     * Start monitoring an editor instance
     */
    start(editorManager: EditorInstanceManager): void {
        if (this.isMonitoring) {
            this.stop();
        }

        this.editorManager = editorManager;
        this.crashCount = 0;
        this.lastHeartbeat = new Date();
        this.isMonitoring = true;

        // Listen for editor events
        editorManager.on('ready', () => {
            this.recordHeartbeat();
        });

        editorManager.on('crashed', async (code, signal) => {
            console.log(`[Watchdog] Editor crashed with code ${code}, signal ${signal}`);
            await this.handleCrash();
        });

        editorManager.on('stopped', () => {
            console.log('[Watchdog] Editor stopped');
            this.stop();
        });

        // Start heartbeat monitoring
        this.heartbeatInterval = setInterval(() => {
            this.checkHeartbeat();
        }, this.config.heartbeatIntervalMs);

        console.log('[Watchdog] Monitoring started');
    }

    /**
     * Stop monitoring
     */
    stop(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        this.isMonitoring = false;
        this.editorManager = null;
        console.log('[Watchdog] Monitoring stopped');
    }

    /**
     * Record a heartbeat from the editor
     */
    recordHeartbeat(): void {
        this.lastHeartbeat = new Date();
        this.editorManager?.recordHeartbeat();
        this.emit('heartbeat');
    }

    /**
     * Check if heartbeat has timed out
     */
    private checkHeartbeat(): void {
        if (!this.isMonitoring || !this.lastHeartbeat) {
            return;
        }

        const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat.getTime();

        if (timeSinceLastHeartbeat > this.config.heartbeatTimeoutMs) {
            console.log(`[Watchdog] Heartbeat timeout (${timeSinceLastHeartbeat}ms)`);
            this.emit('timeout');

            // Check if process is actually dead
            if (this.editorManager && !this.editorManager.isRunning()) {
                this.handleCrash();
            }
        }
    }

    /**
     * Handle a crash event
     */
    private async handleCrash(): Promise<void> {
        this.crashCount++;

        // Triage the crash if we have a crash directory
        let crashReport: CrashReport | null = null;
        if (this.crashTriager) {
            try {
                crashReport = await this.crashTriager.triage();
                console.log(`[Watchdog] Crash triage: ${crashReport.type}`);
            } catch (err) {
                console.error('[Watchdog] Crash triage failed:', err);
            }
        }

        // Create a default crash report if triage didn't provide one
        if (!crashReport) {
            crashReport = {
                type: 'UNKNOWN',
                callstack: [],
                relevantLogs: [],
                nextActions: ['Check crash logs manually'],
                timestamp: new Date().toISOString()
            };
        }

        this.emit('crash', crashReport);

        // Check if we've exceeded max crashes
        if (this.crashCount >= this.config.maxCrashCount) {
            console.log(`[Watchdog] Max crash count reached (${this.crashCount})`);
            this.emit('maxCrashesReached', this.crashCount);
            this.stop();
            return;
        }

        // Auto-restart if enabled
        if (this.config.autoRestart && this.editorManager) {
            console.log(`[Watchdog] Auto-restarting (attempt ${this.crashCount}/${this.config.maxCrashCount})`);
            this.emit('restart', this.crashCount);

            try {
                await this.editorManager.restart();
                this.lastHeartbeat = new Date();
            } catch (err) {
                console.error('[Watchdog] Restart failed:', err);
            }
        }
    }

    /**
     * Get current crash count
     */
    getCrashCount(): number {
        return this.crashCount;
    }

    /**
     * Reset crash count
     */
    resetCrashCount(): void {
        this.crashCount = 0;
    }

    /**
     * Check if monitoring is active
     */
    isActive(): boolean {
        return this.isMonitoring;
    }

    /**
     * Get time since last heartbeat
     */
    getTimeSinceLastHeartbeat(): number | null {
        if (!this.lastHeartbeat) {
            return null;
        }
        return Date.now() - this.lastHeartbeat.getTime();
    }

    /**
     * Manually trigger a health check
     */
    async healthCheck(): Promise<{
        healthy: boolean;
        editorRunning: boolean;
        timeSinceHeartbeat: number | null;
        crashCount: number;
    }> {
        const editorRunning = this.editorManager?.isRunning() ?? false;
        const timeSinceHeartbeat = this.getTimeSinceLastHeartbeat();

        const healthy = editorRunning &&
            (timeSinceHeartbeat === null || timeSinceHeartbeat < this.config.heartbeatTimeoutMs);

        return {
            healthy,
            editorRunning,
            timeSinceHeartbeat,
            crashCount: this.crashCount
        };
    }
}

/**
 * Create a watchdog with default settings
 */
export function createWatchdog(config?: WatchdogConfig): EditorWatchdog {
    return new EditorWatchdog(config);
}

/**
 * Create a watchdog and attach to editor manager
 */
export function attachWatchdog(
    editorManager: EditorInstanceManager,
    config?: WatchdogConfig
): EditorWatchdog {
    const watchdog = new EditorWatchdog(config);
    watchdog.start(editorManager);
    return watchdog;
}
