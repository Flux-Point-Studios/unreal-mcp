#!/usr/bin/env node
/**
 * src/cli.ts
 *
 * Entry point for the Unreal Engine MCP server.
 *
 * Selects the transport mode based on configuration:
 *   - MCP_HTTP_ENABLED=true  --> Streamable HTTP transport (src/transports/http-transport.ts)
 *   - Default                --> Stdio transport (src/index.ts -> startStdioServer)
 *
 * Also supports a --http CLI flag as a convenience shortcut for enabling HTTP
 * mode without setting the environment variable.
 *
 * Dynamic-imports the compiled JS first (./index.js) and falls back to
 * TypeScript source (./index.ts) when running via ts-node-esm or similar
 * dev workflows where compiled JS is not available.
 *
 * Related files:
 *   - src/index.ts                      -- createServer() and startStdioServer()
 *   - src/transports/http-transport.ts  -- startHttpServer()
 *   - src/config.ts                     -- MCP_HTTP_ENABLED, MCP_HTTP_PORT, MCP_HTTP_HOST
 */

import { Logger } from './utils/logger.js';
import { config } from './config.js';

const log = new Logger('CLI');

/**
 * Checks whether HTTP mode was requested via CLI flag (--http) or
 * environment variable (MCP_HTTP_ENABLED=true).
 */
function isHttpModeRequested(): boolean {
  if (config.MCP_HTTP_ENABLED) {
    return true;
  }
  // Support --http CLI flag as a convenience
  return process.argv.includes('--http');
}

/**
 * Starts the Streamable HTTP transport. Uses a dynamic import so the
 * http-transport module (and its Express dependency from the SDK) are only
 * loaded when actually needed.
 */
async function startHttpMode(): Promise<void> {
  log.info('Starting MCP server in HTTP transport mode');
  try {
    const { startHttpServer } = await import('./transports/http-transport.js');
    await startHttpServer(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST);
  } catch (error) {
    log.error('Failed to start HTTP server:', error);
    process.exit(1);
  }
}

/**
 * Starts the default stdio transport. Tries compiled JS first, then falls
 * back to TypeScript source for dev workflows.
 */
async function startStdioMode(): Promise<void> {
  try {
    const m = await import('./index.js');
    if (m && typeof m.startStdioServer === 'function') {
      await m.startStdioServer();
    } else {
      throw new Error('startStdioServer not exported from index.js');
    }
  } catch (err) {
    // If index.js cannot be resolved, try importing the TypeScript source
    // at runtime (useful when running via ts-node-esm). Cast the error when
    // inspecting runtime-only properties like `code`.
    const errObj = err as Record<string, unknown> | null;
    if (
      err &&
      (errObj?.code === 'ERR_MODULE_NOT_FOUND' ||
        String(err).includes('Unable to resolve'))
    ) {
      try {
        const tsModuleSpecifier = new URL('./index.ts', import.meta.url).href;
        const m2 = await import(tsModuleSpecifier);
        if (m2 && typeof m2.startStdioServer === 'function') {
          await m2.startStdioServer();
        } else {
          throw new Error('startStdioServer not exported from index.ts');
        }
      } catch (err2) {
        log.error(
          'Failed to start server (fallback to TypeScript failed):',
          err2,
        );
        process.exit(1);
      }
      return;
    }
    log.error('Failed to start server:', err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  if (isHttpModeRequested()) {
    await startHttpMode();
  } else {
    await startStdioMode();
  }
})();
