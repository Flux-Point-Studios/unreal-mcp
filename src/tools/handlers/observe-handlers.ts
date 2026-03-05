/**
 * Observe Tool Handlers (Sprint 8: Runtime Observability)
 *
 * Actions:
 *   query_logs           — get recent runtime logs with filtering
 *   get_log_summary      — error/warning counts and top categories
 *   start_playtest       — begin a playtest session (starts PIE + observation)
 *   capture_snapshot      — capture a point-in-time snapshot during playtest
 *   stop_playtest        — end playtest session and generate report
 *   get_playtest_report  — get the last playtest report
 *   run_scenario         — automated scenario: start PIE, capture snapshots at intervals, stop, report
 *   get_runtime_state    — current PIE state (is it running, player info, FPS)
 */

import { ITools } from '../../types/tool-interfaces.js';
import { executeAutomationRequest } from './common-handlers.js';
import { runtimeObserver } from '../../services/runtime-observer.js';
import { Logger } from '../../utils/logger.js';

const logger = new Logger('ObserveHandlers');

/**
 * Read and ingest recent logs from disk.
 */
async function ingestDiskLogs(tools: ITools): Promise<number> {
    try {
        const result = await tools.logTools.readOutputLog({
            lines: 100,
        });

        const resultObj = result as Record<string, unknown>;
        const entries = resultObj.entries || resultObj.logs || resultObj.data;
        if (Array.isArray(entries)) {
            return runtimeObserver.ingestLogs(entries as Array<{
                timestamp?: string; category?: string; level?: string; message?: string;
            }>);
        }
        return 0;
    } catch {
        return 0;
    }
}

/**
 * Capture a viewport screenshot and return base64 data.
 */
async function captureScreenshot(tools: ITools): Promise<string | null> {
    try {
        const result = await executeAutomationRequest(
            tools, 'control_editor',
            { action: 'capture_viewport', width: 640, height: 360, format: 'jpeg', quality: 60 },
            'Bridge unavailable'
        ) as Record<string, unknown>;

        if (result.success !== false && typeof result.imageData === 'string') {
            return result.imageData;
        }
        // Check nested result
        const inner = result.result as Record<string, unknown> | undefined;
        if (inner && typeof inner.imageData === 'string') {
            return inner.imageData;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Get current PIE state.
 */
async function getPIEState(tools: ITools): Promise<Record<string, unknown>> {
    try {
        const result = await executeAutomationRequest(
            tools, 'control_editor',
            { action: 'get_play_state' },
            'Bridge unavailable'
        ) as Record<string, unknown>;

        return result;
    } catch {
        return { playing: false, error: 'Could not query PIE state' };
    }
}

/**
 * Get scene stats during play.
 */
async function getSceneStats(tools: ITools): Promise<Record<string, unknown>> {
    try {
        const result = await executeAutomationRequest(
            tools, 'inspect',
            { action: 'get_scene_stats' },
            'Bridge unavailable'
        ) as Record<string, unknown>;
        return (result.result ?? result) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/**
 * Helper: sleep for ms.
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function handleObserveTools(
    action: string,
    args: Record<string, unknown>,
    tools: ITools
): Promise<Record<string, unknown>> {
    switch (action) {
        case 'query_logs': {
            // Ingest fresh logs from disk first
            await ingestDiskLogs(tools);

            const logs = runtimeObserver.getRecentLogs({
                count: (args.count as number) || 50,
                severity: args.severity as 'fatal' | 'error' | 'warning' | 'info' | 'verbose' | undefined,
                category: args.category as string | undefined,
                since: args.since as string | undefined,
            });

            return {
                success: true,
                logs: logs.map(l => ({
                    timestamp: l.timestamp,
                    category: l.category,
                    severity: l.severity,
                    message: l.message.slice(0, 300),
                })),
                count: logs.length,
                bufferStatus: runtimeObserver.getStatus(),
            };
        }

        case 'get_log_summary': {
            await ingestDiskLogs(tools);
            const summary = runtimeObserver.getLogSummary();
            return { success: true, ...summary };
        }

        case 'start_playtest': {
            const scenarioLabel = (args.label || args.scenario) as string | undefined;

            // Start PIE
            try {
                await executeAutomationRequest(
                    tools, 'control_editor',
                    { action: 'play' },
                    'Bridge unavailable'
                );
            } catch (err) {
                return {
                    success: false,
                    error: `Failed to start PIE: ${err instanceof Error ? err.message : String(err)}`,
                };
            }

            // Wait a moment for PIE to initialize
            await sleep(1000);

            // Start observation session
            const session = runtimeObserver.startSession(scenarioLabel);

            // Capture initial snapshot
            await ingestDiskLogs(tools);
            const screenshot = await captureScreenshot(tools);
            const stats = await getSceneStats(tools);

            runtimeObserver.addSnapshot({
                timestamp: new Date().toISOString(),
                frameIndex: 0,
                stats,
                screenshotBase64: screenshot || undefined,
            });

            return {
                success: true,
                message: `Playtest session started: ${session.id}`,
                sessionId: session.id,
                scenarioLabel,
                initialStats: stats,
                hasScreenshot: !!screenshot,
            };
        }

        case 'capture_snapshot': {
            const session = runtimeObserver.getActiveSession();
            if (!session) {
                return { success: false, error: 'No active playtest session. Use start_playtest first.' };
            }

            const frameIndex = session.snapshots.length;

            // Ingest fresh logs
            await ingestDiskLogs(tools);

            // Capture viewport
            const screenshot = await captureScreenshot(tools);

            // Get stats
            const stats = await getSceneStats(tools);

            runtimeObserver.addSnapshot({
                timestamp: new Date().toISOString(),
                frameIndex,
                stats,
                screenshotBase64: screenshot || undefined,
            });

            const summary = runtimeObserver.getLogSummary();

            return {
                success: true,
                frameIndex,
                stats,
                hasScreenshot: !!screenshot,
                errorsSoFar: summary.errors,
                warningsSoFar: summary.warnings,
                recentErrors: summary.recentErrors.slice(0, 5),
            };
        }

        case 'stop_playtest': {
            // Stop PIE
            try {
                await executeAutomationRequest(
                    tools, 'control_editor',
                    { action: 'stop' },
                    'Bridge unavailable'
                );
            } catch { /* best-effort */ }

            await sleep(500);

            // Final log ingest
            await ingestDiskLogs(tools);

            // End session
            const report = runtimeObserver.endSession(
                (args.status as 'completed' | 'failed' | 'aborted') || 'completed'
            );

            if (!report) {
                return { success: false, error: 'No active playtest session to stop' };
            }

            return {
                success: true,
                report,
            };
        }

        case 'get_playtest_report': {
            const session = runtimeObserver.getActiveSession();
            if (session) {
                // Active session — return interim report
                return {
                    success: true,
                    status: 'running',
                    sessionId: session.id,
                    logCount: session.logs.length,
                    snapshotCount: session.snapshots.length,
                    eventCount: session.events.length,
                    logSummary: runtimeObserver.getLogSummary(),
                };
            }

            const past = runtimeObserver.getPastSessions();
            if (past.length === 0) {
                return { success: true, message: 'No playtest sessions recorded yet' };
            }

            const latest = past[past.length - 1];
            return {
                success: true,
                sessionId: latest.id,
                status: latest.status,
                report: latest.summary,
                scenarioLabel: latest.scenarioLabel,
            };
        }

        case 'run_scenario': {
            const label = (args.label || args.scenario || 'automated_scenario') as string;
            const durationSeconds = (args.duration as number) || 10;
            const captureIntervalSeconds = (args.interval as number) || 3;
            const maxSnapshots = Math.min(Math.ceil(durationSeconds / captureIntervalSeconds) + 1, 20);

            // Start playtest
            const startResult = await handleObserveTools('start_playtest', { label }, tools);
            if (!startResult.success) return startResult;

            // Capture snapshots at intervals
            const snapshotResults: Array<Record<string, unknown>> = [];
            for (let i = 0; i < maxSnapshots; i++) {
                await sleep(captureIntervalSeconds * 1000);

                const snapshot = await handleObserveTools('capture_snapshot', {}, tools);
                snapshotResults.push(snapshot);

                // Abort early on fatal errors
                const logSummary = runtimeObserver.getLogSummary();
                if (logSummary.recentErrors.some(e => e.toLowerCase().includes('fatal') || e.toLowerCase().includes('crash'))) {
                    logger.warn('Fatal error detected during scenario — aborting');
                    break;
                }
            }

            // Stop and get report
            const stopResult = await handleObserveTools('stop_playtest', { status: 'completed' }, tools);

            return {
                success: true,
                scenarioLabel: label,
                duration: durationSeconds,
                snapshotsCapured: snapshotResults.length,
                report: stopResult.report,
            };
        }

        case 'get_runtime_state': {
            const pieState = await getPIEState(tools);
            const stats = await getSceneStats(tools);
            const logSummary = runtimeObserver.getLogSummary();
            const observerStatus = runtimeObserver.getStatus();

            return {
                success: true,
                pie: pieState,
                sceneStats: stats,
                logSummary,
                observer: observerStatus,
            };
        }

        default:
            return {
                success: false,
                error: `Unknown observe action: ${action}`,
                availableActions: [
                    'query_logs', 'get_log_summary',
                    'start_playtest', 'capture_snapshot', 'stop_playtest',
                    'get_playtest_report', 'run_scenario', 'get_runtime_state',
                ],
            };
    }
}
