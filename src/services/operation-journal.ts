/**
 * Operation Journal
 *
 * Records every mutating tool call as a structured breadcrumb trail.
 * Feeds ue://recent-changes, checkpoint diffs, and recovery diagnostics.
 *
 * Design principles:
 * - Ring buffer (capped at MAX_ENTRIES) — no unbounded growth
 * - Structured entries the LLM can reason about
 * - Queryable by time, tool, asset, or journal position
 * - Singleton — one journal per server process
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('OperationJournal');

/** Maximum number of journal entries retained in memory. */
const MAX_ENTRIES = 200;

/** Read-only actions that should NOT be journaled. */
const READ_ONLY_ACTIONS = new Set([
    // Generic read patterns
    'list', 'get', 'find', 'search', 'inspect', 'info', 'details', 'status',
    'get_info', 'get_details', 'get_status', 'get_properties', 'get_transform',
    'get_components', 'get_graph_details', 'get_node_details', 'get_pin_details',
    'get_blueprint', 'get_actor_details', 'get_material_details', 'get_mesh_details',
    'get_texture_details', 'get_component_details', 'get_property', 'get_viewport_info',
    'get_scene_stats', 'get_memory_stats', 'get_selected_actors', 'get_component_property',
    'find_by_name', 'find_by_tag', 'find_by_class', 'list_tools', 'list_categories',
    'list_tests', 'get_test_results', 'get_current_level', 'get_summary',
    'list_levels', 'list_objects', 'list_bones', 'list_sockets', 'get_skeleton_info',
    'get_character_info', 'get_combat_info', 'get_ai_info', 'get_inventory_info',
    'get_interaction_info', 'get_widget_info', 'get_networking_info', 'get_sessions_info',
    'get_navigation_info', 'get_splines_info', 'get_audio_info', 'get_niagara_info',
    'get_gas_info', 'get_input_info', 'get_animation_info', 'get_level_info',
    'list_providers', 'check_generation_status', 'get_script_history',
    'dump_asset', 'exists', 'get_dependencies', 'get_material_stats',
    'validate', 'validate_niagara_system',
    // manage_tools read-only
    'get_status', 'reset',
    // Checkpoint/validation reads (will be added later)
    'list_checkpoints', 'diff_checkpoint', 'get_validation_report',
]);

/** Read-only tools that never produce mutations. */
const READ_ONLY_TOOLS = new Set([
    'inspect', 'manage_tools', 'manage_tasks',
]);

export interface JournalEntry {
    /** Unique entry ID (monotonic). */
    id: number;
    /** ISO timestamp. */
    timestamp: string;
    /** MCP tool name. */
    tool: string;
    /** Action dispatched. */
    action: string;
    /** Sanitized subset of params (no huge blobs). */
    params: Record<string, unknown>;
    /** Asset paths touched (best-effort extraction from args). */
    assetsModified: string[];
    /** Actor names/paths touched (best-effort extraction from args). */
    actorsModified: string[];
    /** Outcome of the call. */
    outcome: 'success' | 'failure' | 'partial';
    /** Warnings emitted. */
    warnings: string[];
    /** Errors emitted. */
    errors: string[];
    /** Associated checkpoint ID, if any. */
    checkpointId?: string;
    /** Wall-clock duration in milliseconds. */
    durationMs: number;
    /** Human-readable one-line summary. */
    summary: string;
}

export interface JournalRecordInput {
    tool: string;
    action: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
    durationMs: number;
    checkpointId?: string;
}

/**
 * Extract asset paths from tool args (best-effort heuristic).
 */
function extractAssetPaths(args: Record<string, unknown>): string[] {
    const paths: string[] = [];
    const keys = [
        'assetPath', 'asset_path', 'path', 'materialPath', 'texturePath',
        'blueprintPath', 'blueprint_path', 'meshPath', 'sourcePath', 'targetPath',
        'destinationPath', 'source_path', 'target_path',
    ];
    for (const key of keys) {
        const val = args[key];
        if (typeof val === 'string' && val.startsWith('/')) {
            paths.push(val);
        }
    }
    // name + path combo (e.g., manage_blueprint create)
    if (typeof args.name === 'string' && typeof args.path === 'string') {
        const combined = `${args.path}/${args.name}`;
        if (!paths.includes(combined)) paths.push(combined);
    }
    return paths;
}

/**
 * Extract actor identifiers from tool args (best-effort heuristic).
 */
function extractActorPaths(args: Record<string, unknown>): string[] {
    const actors: string[] = [];
    const keys = ['actorName', 'actor_name', 'actorPath', 'actor_path', 'name'];
    for (const key of keys) {
        const val = args[key];
        if (typeof val === 'string' && val.length > 0) {
            actors.push(val);
        }
    }
    return actors;
}

/**
 * Build a human-readable one-line summary from a journal entry's data.
 */
function buildSummary(tool: string, action: string, args: Record<string, unknown>, outcome: string): string {
    const target = (args.actorName || args.actor_name || args.name || args.assetPath || args.asset_path || args.path || '') as string;
    const targetStr = target ? ` '${target}'` : '';
    const outcomeStr = outcome === 'success' ? '' : ` [${outcome}]`;
    return `${tool}.${action}${targetStr}${outcomeStr}`;
}

/**
 * Sanitize args for storage — remove large blobs, truncate strings.
 */
function sanitizeParams(args: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string') {
            result[key] = value.length > 200 ? value.slice(0, 200) + '...' : value;
        } else if (Array.isArray(value)) {
            result[key] = value.length > 10 ? `[${value.length} items]` : value;
        } else if (value !== null && typeof value === 'object') {
            const keys = Object.keys(value as object);
            result[key] = keys.length > 5 ? `{${keys.length} keys}` : value;
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Determine outcome from a tool result object.
 */
function determineOutcome(result: Record<string, unknown>): { outcome: 'success' | 'failure' | 'partial'; warnings: string[]; errors: string[] } {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (result.errors && Array.isArray(result.errors)) {
        for (const e of result.errors) {
            errors.push(typeof e === 'string' ? e : JSON.stringify(e));
        }
    }
    if (result.warnings && Array.isArray(result.warnings)) {
        for (const w of result.warnings) {
            warnings.push(typeof w === 'string' ? w : JSON.stringify(w));
        }
    }
    if (typeof result.error === 'string' && result.error.length > 0) {
        errors.push(result.error);
    }
    if (typeof result.warning === 'string' && result.warning.length > 0) {
        warnings.push(result.warning);
    }

    let outcome: 'success' | 'failure' | 'partial' = 'success';
    if (result.success === false) {
        outcome = errors.length > 0 ? 'failure' : 'failure';
    } else if (errors.length > 0 && result.success === true) {
        outcome = 'partial';
    }

    return { outcome, warnings, errors };
}

class OperationJournal {
    private entries: JournalEntry[] = [];
    private nextId = 1;

    /**
     * Determine if a tool+action pair should be journaled (i.e., is mutating).
     */
    shouldRecord(tool: string, action: string): boolean {
        if (READ_ONLY_TOOLS.has(tool)) return false;
        if (READ_ONLY_ACTIONS.has(action)) return false;
        return true;
    }

    /**
     * Record a completed tool call.
     * Returns the journal entry ID.
     */
    record(input: JournalRecordInput): number {
        const { outcome, warnings, errors } = determineOutcome(input.result);
        const entry: JournalEntry = {
            id: this.nextId++,
            timestamp: new Date().toISOString(),
            tool: input.tool,
            action: input.action,
            params: sanitizeParams(input.args),
            assetsModified: extractAssetPaths(input.args),
            actorsModified: extractActorPaths(input.args),
            outcome,
            warnings,
            errors,
            checkpointId: input.checkpointId,
            durationMs: input.durationMs,
            summary: buildSummary(input.tool, input.action, input.args, outcome),
        };

        this.entries.push(entry);

        // Trim to ring buffer size
        if (this.entries.length > MAX_ENTRIES) {
            this.entries.splice(0, this.entries.length - MAX_ENTRIES);
        }

        logger.debug(`Journal entry #${entry.id}: ${entry.summary}`);
        return entry.id;
    }

    /**
     * Get the N most recent entries (default: 20).
     */
    getRecent(count = 20): JournalEntry[] {
        return this.entries.slice(-count);
    }

    /**
     * Get all entries that touched a given asset path.
     */
    getByAsset(assetPath: string): JournalEntry[] {
        return this.entries.filter(e => e.assetsModified.some(a => a.includes(assetPath)));
    }

    /**
     * Get all entries for a given tool.
     */
    getByTool(tool: string): JournalEntry[] {
        return this.entries.filter(e => e.tool === tool);
    }

    /**
     * Get all entries since a given timestamp (ISO string or epoch ms).
     */
    getSince(since: string | number): JournalEntry[] {
        const ts = typeof since === 'string' ? new Date(since).getTime() : since;
        return this.entries.filter(e => new Date(e.timestamp).getTime() >= ts);
    }

    /**
     * Get entries since a given journal position (entry ID).
     */
    getSincePosition(position: number): JournalEntry[] {
        return this.entries.filter(e => e.id > position);
    }

    /**
     * Current journal position (latest entry ID, or 0 if empty).
     */
    getPosition(): number {
        return this.entries.length > 0 ? this.entries[this.entries.length - 1].id : 0;
    }

    /**
     * Get a compact summary of recent changes suitable for LLM context.
     */
    getRecentChangesSummary(count = 15): string {
        const recent = this.getRecent(count);
        if (recent.length === 0) return 'No operations recorded yet.';

        const lines = recent.map(e => {
            const age = Math.round((Date.now() - new Date(e.timestamp).getTime()) / 1000);
            const ageStr = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.round(age / 60)}m ago` : `${Math.round(age / 3600)}h ago`;
            const warnStr = e.warnings.length > 0 ? ` (${e.warnings.length} warnings)` : '';
            return `[${ageStr}] ${e.summary}${warnStr}`;
        });

        return lines.join('\n');
    }

    /**
     * Get entries that had errors (for ue://recent-errors).
     */
    getRecentErrors(count = 10): JournalEntry[] {
        return this.entries
            .filter(e => e.outcome === 'failure' || e.outcome === 'partial')
            .slice(-count);
    }

    /**
     * Total entry count.
     */
    get size(): number {
        return this.entries.length;
    }

    /**
     * Clear all entries.
     */
    clear(): void {
        this.entries = [];
        this.nextId = 1;
        logger.info('Journal cleared');
    }
}

/** Singleton instance. */
export const operationJournal = new OperationJournal();
