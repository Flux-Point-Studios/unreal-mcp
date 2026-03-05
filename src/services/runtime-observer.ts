/**
 * Runtime Observer (Sprint 8: Runtime Observability)
 *
 * Captures and correlates runtime events during Play-In-Editor (PIE):
 * - Log entries (from disk or streaming)
 * - Viewport screenshots at intervals
 * - Scene stats / performance metrics
 * - Player state snapshots
 *
 * Provides a structured timeline the agent can reason about.
 *
 * Works with existing tools NOW; enhanced by C++ log buffer when available.
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('RuntimeObserver');

const MAX_LOG_BUFFER = 500;
const MAX_EVENTS = 200;
const MAX_SNAPSHOTS = 50;

export type EventSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'verbose';

export interface RuntimeLogEntry {
    timestamp: string;
    frameIndex?: number;
    category: string;
    severity: EventSeverity;
    message: string;
    source?: string; // 'stream' | 'disk' | 'console'
}

export interface RuntimeEvent {
    id: number;
    timestamp: string;
    type: 'log' | 'screenshot' | 'stat' | 'player_state' | 'assertion' | 'input' | 'custom';
    severity: EventSeverity;
    summary: string;
    data: Record<string, unknown>;
}

export interface PlaytestSnapshot {
    timestamp: string;
    frameIndex: number;
    stats?: Record<string, unknown>;
    playerState?: Record<string, unknown>;
    screenshotBase64?: string;
    logsSinceLastSnapshot: number;
    errorsSinceLastSnapshot: number;
}

export interface PlaytestSession {
    id: string;
    startedAt: string;
    endedAt?: string;
    status: 'running' | 'completed' | 'failed' | 'aborted';
    scenarioLabel?: string;
    snapshots: PlaytestSnapshot[];
    events: RuntimeEvent[];
    logs: RuntimeLogEntry[];
    summary?: PlaytestReport;
}

export interface PlaytestReport {
    duration: number;
    totalLogs: number;
    totalErrors: number;
    totalWarnings: number;
    totalScreenshots: number;
    errorCategories: Record<string, number>;
    timeline: string; // Human-readable summary
    verdict: 'clean' | 'warnings_only' | 'errors_found' | 'fatal';
}

class RuntimeObserver {
    private logBuffer: RuntimeLogEntry[] = [];
    private events: RuntimeEvent[] = [];
    private nextEventId = 1;
    private activeSession: PlaytestSession | null = null;
    private pastSessions: PlaytestSession[] = [];
    private maxPastSessions = 5;

    // --- Log Buffer ---

    /**
     * Ingest a log entry (from any source).
     */
    addLog(entry: RuntimeLogEntry): void {
        this.logBuffer.push(entry);
        if (this.logBuffer.length > MAX_LOG_BUFFER) {
            this.logBuffer.splice(0, this.logBuffer.length - MAX_LOG_BUFFER);
        }

        // Auto-create events for errors/fatals
        if (entry.severity === 'error' || entry.severity === 'fatal') {
            this.addEvent({
                type: 'log',
                severity: entry.severity,
                summary: `[${entry.category}] ${entry.message.slice(0, 120)}`,
                data: { category: entry.category, fullMessage: entry.message },
            });
        }

        // If session is active, add to session logs
        if (this.activeSession) {
            this.activeSession.logs.push(entry);
        }
    }

    /**
     * Ingest multiple log entries from a parsed log file.
     */
    ingestLogs(entries: Array<{ timestamp?: string; category?: string; level?: string; message?: string }>): number {
        let count = 0;
        for (const e of entries) {
            const severity = this.parseSeverity(e.level || 'Log');
            this.addLog({
                timestamp: e.timestamp || new Date().toISOString(),
                category: e.category || 'Unknown',
                severity,
                message: e.message || '',
                source: 'disk',
            });
            count++;
        }
        return count;
    }

    /**
     * Get recent logs, optionally filtered.
     */
    getRecentLogs(options: {
        count?: number;
        severity?: EventSeverity;
        category?: string;
        since?: string;
    } = {}): RuntimeLogEntry[] {
        let filtered = this.logBuffer;

        if (options.severity) {
            const severityRank: Record<string, number> = { fatal: 0, error: 1, warning: 2, info: 3, verbose: 4 };
            const minRank = severityRank[options.severity] ?? 4;
            filtered = filtered.filter(e => (severityRank[e.severity] ?? 4) <= minRank);
        }

        if (options.category) {
            const cat = options.category.toLowerCase();
            filtered = filtered.filter(e => e.category.toLowerCase().includes(cat));
        }

        if (options.since) {
            const sinceTime = new Date(options.since).getTime();
            filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
        }

        const count = options.count || 50;
        return filtered.slice(-count);
    }

    /**
     * Get error/warning summary suitable for LLM context.
     */
    getLogSummary(): { errors: number; warnings: number; topCategories: Record<string, number>; recentErrors: string[] } {
        let errors = 0;
        let warnings = 0;
        const categories: Record<string, number> = {};
        const recentErrors: string[] = [];

        for (const log of this.logBuffer) {
            if (log.severity === 'error' || log.severity === 'fatal') {
                errors++;
                categories[log.category] = (categories[log.category] || 0) + 1;
                if (recentErrors.length < 10) {
                    recentErrors.push(`[${log.category}] ${log.message.slice(0, 100)}`);
                }
            } else if (log.severity === 'warning') {
                warnings++;
            }
        }

        return { errors, warnings, topCategories: categories, recentErrors };
    }

    // --- Events ---

    addEvent(event: Omit<RuntimeEvent, 'id' | 'timestamp'>): number {
        const id = this.nextEventId++;
        const entry: RuntimeEvent = {
            id,
            timestamp: new Date().toISOString(),
            ...event,
        };

        this.events.push(entry);
        if (this.events.length > MAX_EVENTS) {
            this.events.splice(0, this.events.length - MAX_EVENTS);
        }

        if (this.activeSession) {
            this.activeSession.events.push(entry);
        }

        return id;
    }

    getRecentEvents(count = 20): RuntimeEvent[] {
        return this.events.slice(-count);
    }

    // --- Playtest Sessions ---

    /**
     * Start a new playtest session.
     */
    startSession(scenarioLabel?: string): PlaytestSession {
        if (this.activeSession) {
            // Auto-end previous session
            this.endSession('aborted');
        }

        const session: PlaytestSession = {
            id: `playtest_${Date.now()}`,
            startedAt: new Date().toISOString(),
            status: 'running',
            scenarioLabel,
            snapshots: [],
            events: [],
            logs: [],
        };

        this.activeSession = session;
        logger.info(`Playtest session started: ${session.id}${scenarioLabel ? ` (${scenarioLabel})` : ''}`);

        this.addEvent({
            type: 'custom',
            severity: 'info',
            summary: `Playtest session started${scenarioLabel ? `: ${scenarioLabel}` : ''}`,
            data: { sessionId: session.id, scenarioLabel },
        });

        return session;
    }

    /**
     * Add a snapshot to the active session.
     */
    addSnapshot(snapshot: Omit<PlaytestSnapshot, 'logsSinceLastSnapshot' | 'errorsSinceLastSnapshot'>): void {
        if (!this.activeSession) return;

        const lastSnapshotTime = this.activeSession.snapshots.length > 0
            ? new Date(this.activeSession.snapshots[this.activeSession.snapshots.length - 1].timestamp).getTime()
            : new Date(this.activeSession.startedAt).getTime();

        const logsSince = this.activeSession.logs.filter(
            l => new Date(l.timestamp).getTime() > lastSnapshotTime
        ).length;

        const errorsSince = this.activeSession.logs.filter(
            l => new Date(l.timestamp).getTime() > lastSnapshotTime &&
                (l.severity === 'error' || l.severity === 'fatal')
        ).length;

        this.activeSession.snapshots.push({
            ...snapshot,
            logsSinceLastSnapshot: logsSince,
            errorsSinceLastSnapshot: errorsSince,
        });

        if (this.activeSession.snapshots.length > MAX_SNAPSHOTS) {
            this.activeSession.snapshots.splice(0, this.activeSession.snapshots.length - MAX_SNAPSHOTS);
        }
    }

    /**
     * End the active session and generate a report.
     */
    endSession(status: 'completed' | 'failed' | 'aborted' = 'completed'): PlaytestReport | null {
        if (!this.activeSession) return null;

        this.activeSession.endedAt = new Date().toISOString();
        this.activeSession.status = status;

        const report = this.generateReport(this.activeSession);
        this.activeSession.summary = report;

        // Archive
        this.pastSessions.push(this.activeSession);
        if (this.pastSessions.length > this.maxPastSessions) {
            this.pastSessions.shift();
        }

        logger.info(`Playtest session ended: ${this.activeSession.id} — ${report.verdict}`);
        this.activeSession = null;
        return report;
    }

    getActiveSession(): PlaytestSession | null {
        return this.activeSession;
    }

    getPastSessions(): PlaytestSession[] {
        return this.pastSessions;
    }

    /**
     * Generate a structured report from a playtest session.
     */
    private generateReport(session: PlaytestSession): PlaytestReport {
        const startTime = new Date(session.startedAt).getTime();
        const endTime = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
        const duration = Math.round((endTime - startTime) / 1000);

        let totalErrors = 0;
        let totalWarnings = 0;
        let hasFatal = false;
        const errorCategories: Record<string, number> = {};

        for (const log of session.logs) {
            if (log.severity === 'fatal') {
                hasFatal = true;
                totalErrors++;
                errorCategories[log.category] = (errorCategories[log.category] || 0) + 1;
            } else if (log.severity === 'error') {
                totalErrors++;
                errorCategories[log.category] = (errorCategories[log.category] || 0) + 1;
            } else if (log.severity === 'warning') {
                totalWarnings++;
            }
        }

        // Build timeline
        const timelineEntries: string[] = [];
        timelineEntries.push(`[0s] Session started${session.scenarioLabel ? `: ${session.scenarioLabel}` : ''}`);

        for (const snapshot of session.snapshots) {
            const snapshotTime = Math.round((new Date(snapshot.timestamp).getTime() - startTime) / 1000);
            const errorNote = snapshot.errorsSinceLastSnapshot > 0
                ? ` (${snapshot.errorsSinceLastSnapshot} errors since last)`
                : '';
            timelineEntries.push(`[${snapshotTime}s] Snapshot #${snapshot.frameIndex}${errorNote}`);
        }

        // Key error events
        const errorEvents = session.events
            .filter(e => e.severity === 'error' || e.severity === 'fatal')
            .slice(0, 5);

        for (const event of errorEvents) {
            const eventTime = Math.round((new Date(event.timestamp).getTime() - startTime) / 1000);
            timelineEntries.push(`[${eventTime}s] ${event.severity.toUpperCase()}: ${event.summary}`);
        }

        timelineEntries.push(`[${duration}s] Session ${session.status}`);

        const verdict: PlaytestReport['verdict'] = hasFatal ? 'fatal'
            : totalErrors > 0 ? 'errors_found'
                : totalWarnings > 0 ? 'warnings_only'
                    : 'clean';

        return {
            duration,
            totalLogs: session.logs.length,
            totalErrors,
            totalWarnings,
            totalScreenshots: session.snapshots.filter(s => s.screenshotBase64).length,
            errorCategories,
            timeline: timelineEntries.join('\n'),
            verdict,
        };
    }

    // --- Utilities ---

    private parseSeverity(level: string): EventSeverity {
        const lower = level.toLowerCase();
        if (lower.includes('fatal')) return 'fatal';
        if (lower.includes('error')) return 'error';
        if (lower.includes('warning')) return 'warning';
        if (lower.includes('verbose')) return 'verbose';
        return 'info';
    }

    /**
     * Clear all buffered data.
     */
    clear(): void {
        this.logBuffer = [];
        this.events = [];
        this.activeSession = null;
        logger.info('Runtime observer cleared');
    }

    /**
     * Get buffer sizes for diagnostics.
     */
    getStatus(): Record<string, unknown> {
        return {
            logBufferSize: this.logBuffer.length,
            eventCount: this.events.length,
            activeSession: this.activeSession ? {
                id: this.activeSession.id,
                status: this.activeSession.status,
                scenarioLabel: this.activeSession.scenarioLabel,
                logCount: this.activeSession.logs.length,
                snapshotCount: this.activeSession.snapshots.length,
                eventCount: this.activeSession.events.length,
            } : null,
            pastSessionCount: this.pastSessions.length,
        };
    }
}

/** Singleton instance. */
export const runtimeObserver = new RuntimeObserver();
