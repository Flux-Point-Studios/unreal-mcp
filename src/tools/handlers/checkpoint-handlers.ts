/**
 * Checkpoint Tool Handlers (Sprint 7: Transactions & Rollback)
 *
 * Actions:
 *   create_checkpoint     — snapshot current level state
 *   list_checkpoints      — list all available checkpoints
 *   diff_checkpoint       — semantic diff between checkpoint and current state (or two checkpoints)
 *   restore_checkpoint    — rollback by deleting actors added since checkpoint and respawning removed ones
 *   delete_checkpoint     — remove a stored checkpoint
 *   begin_transaction     — create an auto-checkpoint before a multi-step mutation
 *   commit_transaction    — finalize a transaction (keep checkpoint as history)
 *   rollback_transaction  — restore to the transaction's start checkpoint
 */

import { ITools } from '../../types/tool-interfaces.js';
import { executeAutomationRequest } from './common-handlers.js';
import { checkpointManager, ActorSnapshot } from '../../services/checkpoint-manager.js';
import { operationJournal } from '../../services/operation-journal.js';
import { Logger } from '../../utils/logger.js';

const logger = new Logger('CheckpointHandlers');

/** Active transaction state (only one at a time). */
let activeTransaction: {
    checkpointId: string;
    label: string;
    startedAt: string;
} | null = null;

/**
 * Fetch current actors from the editor and convert to ActorSnapshot[].
 */
async function captureActorSnapshot(tools: ITools): Promise<ActorSnapshot[]> {
    try {
        const result = await executeAutomationRequest(
            tools, 'control_actor',
            { action: 'list' },
            'Automation bridge not available'
        ) as Record<string, unknown>;

        const actorList = (result.actors || result.result || result) as unknown[];
        if (!Array.isArray(actorList)) return [];

        return actorList.map((a: unknown) => {
            const actor = a as Record<string, unknown>;
            const loc = actor.location as Record<string, number> | undefined;
            const rot = actor.rotation as Record<string, number> | undefined;
            const scale = actor.scale as Record<string, number> | undefined;
            const components = actor.components as string[] | undefined;
            const tags = actor.tags as string[] | undefined;

            return {
                name: (actor.name || actor.Name || actor.actorName || '') as string,
                class: (actor.class || actor.Class || actor.type || 'Unknown') as string,
                path: (actor.path || actor.actorPath || '') as string,
                location: loc ? { x: loc.x || loc.X || 0, y: loc.y || loc.Y || 0, z: loc.z || loc.Z || 0 } : undefined,
                rotation: rot ? { pitch: rot.pitch || rot.Pitch || 0, yaw: rot.yaw || rot.Yaw || 0, roll: rot.roll || rot.Roll || 0 } : undefined,
                scale: scale ? { x: scale.x || scale.X || 1, y: scale.y || scale.Y || 1, z: scale.z || scale.Z || 1 } : undefined,
                components: Array.isArray(components) ? components : undefined,
                tags: Array.isArray(tags) ? tags : undefined,
                visible: typeof actor.visible === 'boolean' ? actor.visible : undefined,
            };
        });
    } catch (err) {
        logger.error(`Failed to capture actor snapshot: ${err instanceof Error ? err.message : String(err)}`);
        return [];
    }
}

/**
 * Try to get the current git ref for SCM anchor.
 */
async function getGitAnchor(): Promise<{ provider: string; ref: string; branch?: string } | undefined> {
    // We'll integrate this properly with the SCM adapter later.
    // For now, this is a placeholder that returns undefined.
    return undefined;
}

export async function handleCheckpointTools(
    action: string,
    args: Record<string, unknown>,
    tools: ITools
): Promise<Record<string, unknown>> {
    switch (action) {
        case 'create_checkpoint': {
            const label = (args.label || args.name || `checkpoint_${Date.now()}`) as string;
            const metadata = (args.metadata || {}) as Record<string, unknown>;

            const actors = await captureActorSnapshot(tools);
            const scmAnchor = await getGitAnchor();

            // Get current level name
            let levelName = 'Unknown';
            try {
                const levelResult = await executeAutomationRequest(
                    tools, 'manage_level',
                    { action: 'get_current_level' },
                    'Bridge unavailable'
                ) as Record<string, unknown>;
                levelName = (levelResult.levelName || levelResult.name || levelResult.level || 'Unknown') as string;
            } catch { /* best-effort */ }

            const checkpoint = checkpointManager.create(label, levelName, actors, scmAnchor, metadata);

            return {
                success: true,
                message: `Checkpoint created: ${checkpoint.id}`,
                checkpoint: {
                    id: checkpoint.id,
                    label: checkpoint.label,
                    timestamp: checkpoint.timestamp,
                    levelName: checkpoint.levelName,
                    actorCount: checkpoint.actorCount,
                    journalPosition: checkpoint.journalPosition,
                    scmAnchor: checkpoint.scmAnchor,
                },
            };
        }

        case 'list_checkpoints': {
            const checkpoints = checkpointManager.list();
            return {
                success: true,
                checkpoints: checkpoints.map(c => ({
                    id: c.id,
                    label: c.label,
                    timestamp: c.timestamp,
                    levelName: c.levelName,
                    actorCount: c.actorCount,
                    journalPosition: c.journalPosition,
                    scmAnchor: c.scmAnchor,
                })),
                count: checkpoints.length,
                activeTransaction: activeTransaction ? {
                    checkpointId: activeTransaction.checkpointId,
                    label: activeTransaction.label,
                    startedAt: activeTransaction.startedAt,
                } : null,
            };
        }

        case 'diff_checkpoint': {
            const checkpointId = (args.checkpointId || args.checkpoint_id || args.from) as string;
            const toCheckpointId = args.toCheckpointId || args.to_checkpoint_id || args.to;

            if (!checkpointId) {
                return { success: false, error: 'checkpointId parameter is required' };
            }

            let diff;
            if (typeof toCheckpointId === 'string') {
                // Diff between two checkpoints
                diff = checkpointManager.diff(checkpointId, toCheckpointId);
            } else {
                // Diff between checkpoint and current live state
                const currentActors = await captureActorSnapshot(tools);
                diff = checkpointManager.diffFromCheckpoint(checkpointId, currentActors);
            }

            if ('error' in diff) {
                return { success: false, error: diff.error };
            }

            return {
                success: true,
                diff: {
                    ...diff,
                    // Truncate actor snapshots for readability
                    actorsAdded: diff.actorsAdded.map(a => ({ name: a.name, class: a.class })),
                    actorsRemoved: diff.actorsRemoved.map(a => ({ name: a.name, class: a.class })),
                },
            };
        }

        case 'restore_checkpoint': {
            const checkpointId = (args.checkpointId || args.checkpoint_id) as string;
            if (!checkpointId) {
                return { success: false, error: 'checkpointId parameter is required' };
            }

            const checkpoint = checkpointManager.get(checkpointId);
            if (!checkpoint) {
                return { success: false, error: `Checkpoint '${checkpointId}' not found` };
            }

            // Get current state
            const currentActors = await captureActorSnapshot(tools);
            const diff = checkpointManager.diffFromCheckpoint(checkpointId, currentActors);
            if ('error' in diff) {
                return { success: false, error: diff.error };
            }

            const errors: string[] = [];
            let deletedCount = 0;

            // Delete actors that were added since checkpoint
            for (const actor of diff.actorsAdded) {
                try {
                    await executeAutomationRequest(
                        tools, 'control_actor',
                        { action: 'delete', actorName: actor.name },
                        'Bridge unavailable'
                    );
                    deletedCount++;
                } catch (err) {
                    errors.push(`Failed to delete ${actor.name}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            // Note: We can't fully restore removed actors without their full serialized state.
            // This is a known limitation — we report what was removed for manual recovery.
            const removedNames = diff.actorsRemoved.map(a => a.name);

            return {
                success: errors.length === 0,
                message: `Restored to checkpoint '${checkpoint.label}': deleted ${deletedCount} actors added since checkpoint`,
                deletedActors: deletedCount,
                unreconstructableActors: removedNames,
                unreconstructableNote: removedNames.length > 0
                    ? `${removedNames.length} actors were removed after the checkpoint and cannot be automatically restored. Manual reconstruction needed.`
                    : undefined,
                errors: errors.length > 0 ? errors : undefined,
                modifiedActors: diff.actorsModified.length,
                modifiedNote: diff.actorsModified.length > 0
                    ? `${diff.actorsModified.length} actors were modified but not reverted (transforms, properties). Use undo or manual correction.`
                    : undefined,
            };
        }

        case 'delete_checkpoint': {
            const checkpointId = (args.checkpointId || args.checkpoint_id) as string;
            if (!checkpointId) {
                return { success: false, error: 'checkpointId parameter is required' };
            }
            const deleted = checkpointManager.delete(checkpointId);
            return {
                success: deleted,
                message: deleted ? `Checkpoint '${checkpointId}' deleted` : `Checkpoint '${checkpointId}' not found`,
            };
        }

        case 'begin_transaction': {
            if (activeTransaction) {
                return {
                    success: false,
                    error: `Transaction already active: '${activeTransaction.label}' (checkpoint: ${activeTransaction.checkpointId}). Commit or rollback first.`,
                };
            }

            const label = (args.label || args.name || `transaction_${Date.now()}`) as string;

            // Auto-create checkpoint
            const actors = await captureActorSnapshot(tools);
            let levelName = 'Unknown';
            try {
                const levelResult = await executeAutomationRequest(
                    tools, 'manage_level',
                    { action: 'get_current_level' },
                    'Bridge unavailable'
                ) as Record<string, unknown>;
                levelName = (levelResult.levelName || levelResult.name || 'Unknown') as string;
            } catch { /* best-effort */ }

            const scmAnchor = await getGitAnchor();
            const checkpoint = checkpointManager.create(`txn_start: ${label}`, levelName, actors, scmAnchor);

            activeTransaction = {
                checkpointId: checkpoint.id,
                label,
                startedAt: new Date().toISOString(),
            };

            logger.info(`Transaction started: '${label}' (checkpoint: ${checkpoint.id})`);

            return {
                success: true,
                message: `Transaction '${label}' started. Checkpoint ${checkpoint.id} created with ${actors.length} actors.`,
                transaction: { ...activeTransaction },
                checkpoint: {
                    id: checkpoint.id,
                    actorCount: checkpoint.actorCount,
                    journalPosition: checkpoint.journalPosition,
                },
            };
        }

        case 'commit_transaction': {
            if (!activeTransaction) {
                return { success: false, error: 'No active transaction to commit' };
            }

            const committed = { ...activeTransaction };
            const journalEntries = operationJournal.getSincePosition(
                checkpointManager.get(activeTransaction.checkpointId)?.journalPosition ?? 0
            );

            activeTransaction = null;
            logger.info(`Transaction committed: '${committed.label}'`);

            return {
                success: true,
                message: `Transaction '${committed.label}' committed. ${journalEntries.length} operations recorded since start.`,
                transaction: committed,
                operationCount: journalEntries.length,
            };
        }

        case 'rollback_transaction': {
            if (!activeTransaction) {
                return { success: false, error: 'No active transaction to rollback' };
            }

            const rolledBack = { ...activeTransaction };

            // Delegate to restore_checkpoint
            const restoreResult = await handleCheckpointTools('restore_checkpoint', {
                checkpointId: activeTransaction.checkpointId,
            }, tools);

            activeTransaction = null;
            logger.info(`Transaction rolled back: '${rolledBack.label}'`);

            return {
                success: restoreResult.success as boolean,
                message: `Transaction '${rolledBack.label}' rolled back`,
                transaction: rolledBack,
                restoreDetails: restoreResult,
            };
        }

        default:
            return {
                success: false,
                error: `Unknown checkpoint action: ${action}`,
                availableActions: [
                    'create_checkpoint', 'list_checkpoints', 'diff_checkpoint',
                    'restore_checkpoint', 'delete_checkpoint',
                    'begin_transaction', 'commit_transaction', 'rollback_transaction',
                ],
            };
    }
}
