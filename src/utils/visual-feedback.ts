/**
 * Location: src/utils/visual-feedback.ts
 *
 * Visual Feedback Loop - automatically captures a viewport screenshot after
 * visually-mutating tool operations so the AI can see what it just did and
 * self-correct.  This is a key differentiator over other Unreal/Unity MCP
 * servers; only GDAI MCP (Godot) currently has something comparable.
 *
 * Used by: src/server/tool-registry.ts (post-execution hook in the
 * CallToolRequestSchema handler).
 *
 * Design principles:
 *   - Best-effort: capture failures NEVER break the actual tool response.
 *   - Low overhead: small resolution (640x360), JPEG quality 70, short
 *     timeout (5 000 ms).
 *   - Opt-out via MCP_VISUAL_FEEDBACK env var ('false' or '0' to disable).
 *   - No C++ changes required - reuses the existing capture_viewport handler.
 */

import { Logger } from './logger.js';
import type { AutomationBridge } from '../automation/bridge.js';

const log = new Logger('VisualFeedback');

// ---------------------------------------------------------------------------
// Which tool+action pairs are visually mutating?
// ---------------------------------------------------------------------------

/**
 * Map of tool names to their visually-mutating actions.
 * A value of 'all' means every action on that tool is considered visual.
 * A Set<string> lists the specific actions that are visual.
 */
const VISUAL_ACTIONS: Record<string, Set<string> | 'all'> = {
    'control_actor': new Set([
        'create_actor',
        'set_transform',
        'set_material',
        'delete_actor',
        'set_visibility',
        'duplicate_actor',
        'set_static_mesh',
        'set_actor_property',
        'attach_actor',
        'detach_actor',
        'batch_create_actors',
    ]),
    'control_editor': new Set([
        'set_view_mode',
        'focus_viewport',
        'set_editor_property',
    ]),
    'manage_level': new Set([
        'load_level',
        'new_level',
        'create_sublevel',
        'set_level_visibility',
    ]),
    'manage_environment': 'all',
    'manage_lighting': 'all',
    'manage_material_authoring': 'all',
    'manage_effect': 'all',
    'build_environment': 'all',
    'manage_geometry': 'all',
};

/**
 * Returns true when the given tool name + action combination is expected
 * to produce a visible change in the viewport.
 *
 * @param toolName  The MCP tool name (e.g. 'control_actor').
 * @param action    The action argument passed to the tool.  May be undefined
 *                  for tools where every action is visual ('all').
 */
export function isVisuallyMutating(toolName: string, action?: string): boolean {
    const entry = VISUAL_ACTIONS[toolName];
    if (!entry) return false;
    if (entry === 'all') return true;
    if (!action) return false;
    return entry.has(action);
}

// ---------------------------------------------------------------------------
// Feedback capture options
// ---------------------------------------------------------------------------

/**
 * Configuration for the visual feedback screenshot.
 */
export interface VisualFeedbackOptions {
    /** Width of the feedback screenshot in pixels (default: 640). */
    width?: number;
    /** Height of the feedback screenshot in pixels (default: 360). */
    height?: number;
    /** Image format sent to the C++ handler (default: 'jpeg'). */
    format?: string;
    /** JPEG quality 1-100 (default: 70). */
    quality?: number;
    /** Timeout in milliseconds for the capture request (default: 5000). */
    timeoutMs?: number;
}

/** Sensible defaults that balance quality vs. payload size. */
const DEFAULT_OPTIONS: Required<VisualFeedbackOptions> = {
    width: 640,
    height: 360,
    format: 'jpeg',
    quality: 70,
    timeoutMs: 5000,
};

// ---------------------------------------------------------------------------
// Core helper
// ---------------------------------------------------------------------------

/**
 * Checks the MCP_VISUAL_FEEDBACK environment variable to determine whether
 * the visual feedback loop is enabled.
 *
 * The feature is **enabled by default**.  Set MCP_VISUAL_FEEDBACK to 'false'
 * or '0' to disable.
 */
export function isVisualFeedbackEnabled(): boolean {
    const envVal = process.env.MCP_VISUAL_FEEDBACK;
    if (envVal === 'false' || envVal === '0') return false;
    return true;
}

/**
 * Captures a small viewport screenshot via the automation bridge and returns
 * MCP content blocks that can be appended to a tool response.
 *
 * Returns an array of MCP content items (text annotation + image) on success,
 * or an empty array if the capture fails or is skipped for any reason.
 *
 * This function is designed to be **best-effort** and will never throw.
 *
 * @param automationBridge  The connected AutomationBridge instance.
 * @param options           Optional overrides for resolution/quality/timeout.
 * @returns                 Array of MCP content blocks to append, or [].
 */
export async function captureVisualFeedback(
    automationBridge: AutomationBridge,
    options?: VisualFeedbackOptions
): Promise<Array<Record<string, unknown>>> {
    try {
        // Bail out early if the feature is disabled
        if (!isVisualFeedbackEnabled()) {
            return [];
        }

        // Bail out if the bridge is not connected
        if (!automationBridge.isConnected()) {
            log.debug('Visual feedback skipped: automation bridge not connected');
            return [];
        }

        const opts = { ...DEFAULT_OPTIONS, ...options };

        const captureResponse = await automationBridge.sendAutomationRequest(
            'control_editor',
            {
                action: 'capture_viewport',
                width: opts.width,
                height: opts.height,
                format: opts.format,
                quality: opts.quality,
            },
            { timeoutMs: opts.timeoutMs }
        );

        // The capture handler returns { base64Data, mimeType, ... }
        const resp = captureResponse as Record<string, unknown> | null;
        if (!resp || !resp.base64Data) {
            log.debug('Visual feedback skipped: capture returned no base64Data');
            return [];
        }

        const base64Data = String(resp.base64Data);
        const mimeType = typeof resp.mimeType === 'string' ? resp.mimeType : 'image/jpeg';

        log.debug(
            `Visual feedback captured: ${base64Data.length} chars base64, mime=${mimeType}`
        );

        return [
            { type: 'text', text: '\n---\n[Visual Feedback] Viewport state after operation:' },
            { type: 'image', data: base64Data, mimeType },
        ];
    } catch (err) {
        // Best-effort - never propagate errors
        log.debug('Visual feedback capture failed (non-fatal)', err);
        return [];
    }
}
