/**
 * Location: src/utils/progress-reporter.ts
 *
 * MCP progress notification utility.  When a client sends a tool call that
 * includes `_meta.progressToken`, the server can report incremental progress
 * back to the client through `notifications/progress`.  This module provides
 * a simple abstraction over that mechanism:
 *
 *   - `McpProgressReporter` -- sends real progress notifications via the MCP
 *     `Server.notification()` API.
 *   - `NoOpProgressReporter` -- silently discards progress reports.  Used when
 *     no progress token was supplied so that handler code can call
 *     `reporter.report(...)` unconditionally.
 *
 * Usage from any handler:
 *   await tools.progressReporter.report(1, 3, 'Validating parameters...');
 *   // ... do work ...
 *   await tools.progressReporter.report(2, 3, 'Executing operation...');
 *   // ... do work ...
 *   await tools.progressReporter.report(3, 3, 'Complete');
 *
 * The factory function `createProgressReporter` chooses the correct
 * implementation based on whether a progress token is available.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * A lightweight handle that handlers use to emit progress updates.
 * Callers never need to check for null -- the no-op variant is always safe.
 */
export interface ProgressReporter {
  /** Report progress.  `progress` and `total` are in arbitrary units. */
  report(progress: number, total: number, message?: string): Promise<void>;
  /** Whether this reporter is connected to a real progress token. */
  readonly active: boolean;
}

// ---------------------------------------------------------------------------
// No-op implementation (used when no progress token is present)
// ---------------------------------------------------------------------------

class NoOpProgressReporter implements ProgressReporter {
  readonly active = false;
  async report(): Promise<void> {
    // Intentionally empty -- no token, no notification.
  }
}

/** Module-level singleton so we never allocate more than one no-op. */
const NO_OP_INSTANCE = new NoOpProgressReporter();

// ---------------------------------------------------------------------------
// Active implementation (sends real MCP progress notifications)
// ---------------------------------------------------------------------------

class McpProgressReporter implements ProgressReporter {
  readonly active = true;

  constructor(
    private server: Server,
    private progressToken: string | number
  ) {}

  async report(
    progress: number,
    total: number,
    message?: string
  ): Promise<void> {
    try {
      await this.server.notification({
        method: 'notifications/progress',
        params: {
          progressToken: this.progressToken,
          progress,
          total,
          ...(message ? { message } : {}),
        },
      });
    } catch {
      // Silently swallow notification failures.
      // Progress reporting is best-effort; a broken notification channel
      // must never abort the actual tool operation.
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a `ProgressReporter` appropriate for the current request.
 *
 * @param server         The MCP `Server` instance (used to send notifications).
 * @param progressToken  The token supplied in `request.params._meta.progressToken`,
 *                       or `undefined` / `null` when the client did not request
 *                       progress updates.
 * @returns A `ProgressReporter` that is safe to call unconditionally.
 */
export function createProgressReporter(
  server: Server,
  progressToken?: string | number | null
): ProgressReporter {
  if (progressToken !== undefined && progressToken !== null) {
    return new McpProgressReporter(server, progressToken);
  }
  return NO_OP_INSTANCE;
}
