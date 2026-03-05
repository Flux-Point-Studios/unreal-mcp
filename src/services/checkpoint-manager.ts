/**
 * Checkpoint Manager (Sprint 7: Transactions & Rollback)
 *
 * Semantic snapshots of level state with actor-level diffing.
 * Each checkpoint includes:
 *   - Semantic actor snapshot (names, classes, transforms, components)
 *   - Journal position at time of snapshot
 *   - Optional SCM anchor (git commit hash)
 *   - Rollback metadata
 *   - LLM-readable diff summaries
 *
 * Design: checkpoints are NOT full serializations. They capture enough
 * semantic state for the agent to understand what changed and reason
 * about rollback, without dumping raw UObject sludge.
 */

import { Logger } from '../utils/logger.js';
import { operationJournal } from './operation-journal.js';

const logger = new Logger('CheckpointManager');

const MAX_CHECKPOINTS = 20;

export interface ActorSnapshot {
    name: string;
    class: string;
    path?: string;
    location?: { x: number; y: number; z: number };
    rotation?: { pitch: number; yaw: number; roll: number };
    scale?: { x: number; y: number; z: number };
    components?: string[];
    tags?: string[];
    visible?: boolean;
}

export interface CheckpointData {
    id: string;
    label: string;
    timestamp: string;
    levelName: string;
    actorSnapshot: ActorSnapshot[];
    actorCount: number;
    journalPosition: number;
    scmAnchor?: { provider: string; ref: string; branch?: string };
    metadata: Record<string, unknown>;
}

export interface CheckpointDiff {
    fromCheckpoint: string;
    toCheckpoint: string;
    actorsAdded: ActorSnapshot[];
    actorsRemoved: ActorSnapshot[];
    actorsModified: Array<{
        name: string;
        changes: string[];
    }>;
    journalEntriesBetween: number;
    summary: string;
}

/**
 * Compare two actor snapshots and return a list of human-readable changes.
 */
function diffActorSnapshots(before: ActorSnapshot, after: ActorSnapshot): string[] {
    const changes: string[] = [];

    if (before.class !== after.class) {
        changes.push(`class changed: ${before.class} → ${after.class}`);
    }

    // Location
    if (before.location && after.location) {
        const dx = Math.abs((before.location.x || 0) - (after.location.x || 0));
        const dy = Math.abs((before.location.y || 0) - (after.location.y || 0));
        const dz = Math.abs((before.location.z || 0) - (after.location.z || 0));
        if (dx > 0.1 || dy > 0.1 || dz > 0.1) {
            changes.push(`moved: (${before.location.x}, ${before.location.y}, ${before.location.z}) → (${after.location.x}, ${after.location.y}, ${after.location.z})`);
        }
    }

    // Rotation
    if (before.rotation && after.rotation) {
        const dp = Math.abs((before.rotation.pitch || 0) - (after.rotation.pitch || 0));
        const dy = Math.abs((before.rotation.yaw || 0) - (after.rotation.yaw || 0));
        const dr = Math.abs((before.rotation.roll || 0) - (after.rotation.roll || 0));
        if (dp > 0.1 || dy > 0.1 || dr > 0.1) {
            changes.push(`rotated`);
        }
    }

    // Scale
    if (before.scale && after.scale) {
        const dsx = Math.abs((before.scale.x || 1) - (after.scale.x || 1));
        const dsy = Math.abs((before.scale.y || 1) - (after.scale.y || 1));
        const dsz = Math.abs((before.scale.z || 1) - (after.scale.z || 1));
        if (dsx > 0.01 || dsy > 0.01 || dsz > 0.01) {
            changes.push(`scaled`);
        }
    }

    // Visibility
    if (before.visible !== after.visible) {
        changes.push(`visibility: ${before.visible} → ${after.visible}`);
    }

    // Components
    if (before.components && after.components) {
        const added = after.components.filter(c => !before.components!.includes(c));
        const removed = before.components.filter(c => !after.components!.includes(c));
        if (added.length > 0) changes.push(`components added: ${added.join(', ')}`);
        if (removed.length > 0) changes.push(`components removed: ${removed.join(', ')}`);
    }

    // Tags
    if (before.tags && after.tags) {
        const added = after.tags.filter(t => !before.tags!.includes(t));
        const removed = before.tags.filter(t => !after.tags!.includes(t));
        if (added.length > 0) changes.push(`tags added: ${added.join(', ')}`);
        if (removed.length > 0) changes.push(`tags removed: ${removed.join(', ')}`);
    }

    return changes;
}

class CheckpointManager {
    private checkpoints: Map<string, CheckpointData> = new Map();
    private nextId = 1;

    /**
     * Create a checkpoint from raw actor data.
     */
    create(
        label: string,
        levelName: string,
        actors: ActorSnapshot[],
        scmAnchor?: { provider: string; ref: string; branch?: string },
        metadata: Record<string, unknown> = {}
    ): CheckpointData {
        const id = `chk_${this.nextId++}_${Date.now()}`;
        const checkpoint: CheckpointData = {
            id,
            label,
            timestamp: new Date().toISOString(),
            levelName,
            actorSnapshot: actors,
            actorCount: actors.length,
            journalPosition: operationJournal.getPosition(),
            scmAnchor,
            metadata,
        };

        this.checkpoints.set(id, checkpoint);

        // Trim old checkpoints
        if (this.checkpoints.size > MAX_CHECKPOINTS) {
            const oldest = this.checkpoints.keys().next().value;
            if (oldest) this.checkpoints.delete(oldest);
        }

        logger.info(`Checkpoint created: ${id} (${label}) — ${actors.length} actors, journal pos ${checkpoint.journalPosition}`);
        return checkpoint;
    }

    /**
     * Get a checkpoint by ID.
     */
    get(id: string): CheckpointData | undefined {
        return this.checkpoints.get(id);
    }

    /**
     * List all checkpoints (newest last).
     */
    list(): CheckpointData[] {
        return Array.from(this.checkpoints.values());
    }

    /**
     * Compute a semantic diff between two checkpoints.
     */
    diff(fromId: string, toId: string): CheckpointDiff | { error: string } {
        const from = this.checkpoints.get(fromId);
        const to = this.checkpoints.get(toId);

        if (!from) return { error: `Checkpoint '${fromId}' not found` };
        if (!to) return { error: `Checkpoint '${toId}' not found` };

        const fromActorMap = new Map(from.actorSnapshot.map(a => [a.name, a]));
        const toActorMap = new Map(to.actorSnapshot.map(a => [a.name, a]));

        const actorsAdded: ActorSnapshot[] = [];
        const actorsRemoved: ActorSnapshot[] = [];
        const actorsModified: Array<{ name: string; changes: string[] }> = [];

        // Find added and modified
        for (const [name, actor] of toActorMap) {
            const beforeActor = fromActorMap.get(name);
            if (!beforeActor) {
                actorsAdded.push(actor);
            } else {
                const changes = diffActorSnapshots(beforeActor, actor);
                if (changes.length > 0) {
                    actorsModified.push({ name, changes });
                }
            }
        }

        // Find removed
        for (const [name, actor] of fromActorMap) {
            if (!toActorMap.has(name)) {
                actorsRemoved.push(actor);
            }
        }

        // Journal entries between checkpoints
        const journalBetween = operationJournal.getSincePosition(from.journalPosition)
            .filter(e => e.id <= to.journalPosition);

        // Build summary
        const parts: string[] = [];
        if (actorsAdded.length > 0) parts.push(`${actorsAdded.length} actors added`);
        if (actorsRemoved.length > 0) parts.push(`${actorsRemoved.length} actors removed`);
        if (actorsModified.length > 0) parts.push(`${actorsModified.length} actors modified`);
        if (journalBetween.length > 0) parts.push(`${journalBetween.length} operations between checkpoints`);
        const summary = parts.length > 0 ? parts.join(', ') : 'No changes detected';

        return {
            fromCheckpoint: fromId,
            toCheckpoint: toId,
            actorsAdded,
            actorsRemoved,
            actorsModified,
            journalEntriesBetween: journalBetween.length,
            summary,
        };
    }

    /**
     * Diff between a checkpoint and the current live state.
     * Requires current actors to be passed in.
     */
    diffFromCheckpoint(checkpointId: string, currentActors: ActorSnapshot[]): CheckpointDiff | { error: string } {
        const checkpoint = this.checkpoints.get(checkpointId);
        if (!checkpoint) return { error: `Checkpoint '${checkpointId}' not found` };

        // Create a temporary "now" checkpoint for diffing
        const nowCheckpoint = this.create('__live_snapshot', checkpoint.levelName, currentActors);
        const result = this.diff(checkpointId, nowCheckpoint.id);

        // Clean up temporary checkpoint
        this.checkpoints.delete(nowCheckpoint.id);
        this.nextId--; // Reuse ID

        return result;
    }

    /**
     * Delete a checkpoint.
     */
    delete(id: string): boolean {
        return this.checkpoints.delete(id);
    }

    /**
     * Clear all checkpoints.
     */
    clear(): void {
        this.checkpoints.clear();
        logger.info('All checkpoints cleared');
    }
}

/** Singleton instance. */
export const checkpointManager = new CheckpointManager();
