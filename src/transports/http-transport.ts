/**
 * src/transports/http-transport.ts
 *
 * Streamable HTTP transport for the Unreal Engine MCP server.
 *
 * Provides an HTTP-based alternative to the default stdio transport, enabling:
 * - Multiple simultaneous client sessions (each with isolated server instances)
 * - Remote access from web dashboards, CI/CD pipelines, and non-local agents
 * - Session management with automatic cleanup on disconnect
 *
 * Uses the MCP SDK's built-in Express integration (`createMcpExpressApp`) and
 * `StreamableHTTPServerTransport` for spec-compliant MCP-over-HTTP with SSE.
 *
 * Each new MCP initialize request spawns a fresh `createServer()` instance,
 * giving every session its own Unreal bridge, automation bridge, and ancillary
 * services. Sessions are tracked by ID and cleaned up when the transport closes
 * or a DELETE /mcp request is received.
 *
 * Activated by setting MCP_HTTP_ENABLED=true (default port 3000, configurable
 * via MCP_HTTP_PORT). When enabled, the CLI entry point starts this transport
 * instead of (or alongside) the stdio transport.
 *
 * Related files:
 *   - src/index.ts          -- createServer() factory used per session
 *   - src/config.ts         -- MCP_HTTP_ENABLED and MCP_HTTP_PORT env vars
 *   - src/cli.ts            -- entry point that selects transport mode
 */

import { randomUUID } from 'node:crypto';
import { createServer as createMcpServer } from '../index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../utils/logger.js';

import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { GraphQLServer } from '../graphql/server.js';

/**
 * Lightweight request type compatible with Express Request. The route handlers
 * receive Express req/res objects but we type them against Node's HTTP types
 * (which Express extends) to avoid needing @types/express as a dependency.
 * The `body` and `headers` properties are the only ones we access directly.
 */
interface HttpRequest extends IncomingMessage {
  body?: unknown;
  headers: IncomingMessage['headers'];
}

/**
 * Lightweight response type compatible with Express Response. Extends Node's
 * ServerResponse with the Express helper methods we use (status, json, headersSent).
 */
interface HttpResponse extends ServerResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
  headersSent: boolean;
}

const log = new Logger('HTTP-Transport');

// ---------------------------------------------------------------------------
// Session bookkeeping
// ---------------------------------------------------------------------------

/** Resources associated with a single MCP HTTP session. */
interface ManagedSession {
  /** The StreamableHTTP transport instance that owns this session. */
  transport: StreamableHTTPServerTransport;
  /** The MCP SDK Server instance for this session. */
  server: Server;
  /** Tears down bridges, metrics, and GraphQL for this session. */
  cleanup: () => Promise<void>;
}

/** Active sessions keyed by MCP session ID. */
const sessions: Map<string, ManagedSession> = new Map();

// ---------------------------------------------------------------------------
// Session lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Creates a new isolated MCP server and transport for an incoming initialize
 * request. The transport is connected to the server, and the session is
 * registered for future requests once the SDK fires `onsessioninitialized`.
 *
 * @returns The StreamableHTTPServerTransport to use for the initial request.
 */
function createSessionTransport(): StreamableHTTPServerTransport {
  const { server, bridge, automationBridge, graphqlServer, metricsServer } =
    createMcpServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      log.info(`HTTP session initialized: ${sessionId}`);
      sessions.set(sessionId, {
        transport,
        server,
        cleanup: buildCleanup(automationBridge, bridge, graphqlServer, metricsServer),
      });
    },
  });

  // When the transport closes (e.g. DELETE or disconnect), tear down the
  // session's server-side resources to avoid memory leaks.
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid && sessions.has(sid)) {
      log.info(`HTTP session closed: ${sid}`);
      const session = sessions.get(sid)!;
      session.cleanup().catch((err) => {
        log.warn(`Error during session cleanup for ${sid}`, err);
      });
      sessions.delete(sid);
    }
  };

  transport.onerror = (error: Error) => {
    log.error(`Transport error (session=${transport.sessionId ?? 'unknown'})`, error);
  };

  // Connect the MCP server to this transport (registers message routing).
  // Connection is async but we cannot await in the constructor-like helper,
  // so we schedule and let the transport buffer until ready.
  void server.connect(transport);

  return transport;
}

/**
 * Builds a cleanup function that gracefully tears down the per-session
 * infrastructure (automation bridge, Unreal bridge, GraphQL, metrics).
 */
function buildCleanup(
  automationBridge: { stop: () => void },
  bridge: { dispose: () => void },
  graphqlServer: GraphQLServer | null,
  metricsServer: HttpServer | null,
): () => Promise<void> {
  return async () => {
    try { automationBridge.stop(); } catch { /* best effort */ }
    try { bridge.dispose(); } catch { /* best effort */ }
    try { await graphqlServer?.stop(); } catch { /* best effort */ }
    try {
      if (metricsServer) {
        await new Promise<void>((resolve) => {
          metricsServer.close(() => resolve());
        });
      }
    } catch { /* best effort */ }
  };
}

// ---------------------------------------------------------------------------
// Express route handlers
// ---------------------------------------------------------------------------

/**
 * POST /mcp -- Main MCP message endpoint.
 *
 * If the request carries a valid `Mcp-Session-Id` header for an existing
 * session, the message is routed to that session's transport. If there is no
 * session header and the body is an MCP initialize request, a brand-new
 * session is created. All other combinations are rejected with 400.
 */
async function handlePost(req: HttpRequest, res: HttpResponse): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    if (sessionId && sessions.has(sessionId)) {
      // Route to existing session
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // Brand-new session
      const transport = createSessionTransport();
      await transport.handleRequest(req, res, req.body);
    } else if (sessionId && !sessions.has(sessionId)) {
      // Session ID provided but not found (expired or invalid)
      res.status(404).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Session not found. It may have expired or been terminated.',
        },
        id: null,
      });
    } else {
      // No session ID and not an initialize request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided and the request is not an initialization request.',
        },
        id: null,
      });
    }
  } catch (error) {
    log.error('Error handling POST /mcp', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

/**
 * GET /mcp -- SSE stream endpoint for server-initiated notifications.
 *
 * Requires a valid `Mcp-Session-Id` header for an existing session.
 */
async function handleGet(req: HttpRequest, res: HttpResponse): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid or missing session ID' },
      id: null,
    });
    return;
  }

  try {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  } catch (error) {
    log.error('Error handling GET /mcp', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

/**
 * DELETE /mcp -- Session termination endpoint.
 *
 * The SDK transport handles the actual teardown; we just route the request.
 */
async function handleDelete(req: HttpRequest, res: HttpResponse): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid or missing session ID' },
      id: null,
    });
    return;
  }

  try {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  } catch (error) {
    log.error('Error handling DELETE /mcp', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

/**
 * GET /health -- Lightweight health-check / status endpoint.
 *
 * Returns the transport type, active session count, and process uptime.
 */
function handleHealth(_req: HttpRequest, res: HttpResponse): void {
  res.json({
    status: 'ok',
    transport: 'streamable-http',
    sessions: sessions.size,
    uptime: process.uptime(),
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Starts the MCP HTTP server on the specified port.
 *
 * Uses `createMcpExpressApp()` from the SDK, which provides an Express app
 * pre-configured with body parsing middleware and DNS rebinding protection
 * (when binding to localhost).
 *
 * The returned Promise resolves once the server is listening, and rejects if
 * the listen call fails.
 *
 * @param port - TCP port to bind (default 3000)
 * @param host - Hostname / IP to bind (default '127.0.0.1')
 * @returns Resolves when the server is ready to accept connections
 */
export async function startHttpServer(
  port: number = 3000,
  host: string = '127.0.0.1',
): Promise<void> {
  // Create the pre-configured Express app (includes JSON body parsing)
  const app = createMcpExpressApp({ host });

  // Register route handlers
  app.post('/mcp', handlePost as never);
  app.get('/mcp', handleGet as never);
  app.delete('/mcp', handleDelete as never);
  app.get('/health', handleHealth as never);

  return new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port, host, () => {
      log.info(`MCP HTTP Server listening on http://${host}:${port}`);
      log.info(`  MCP endpoint : http://${host}:${port}/mcp`);
      log.info(`  Health check : http://${host}:${port}/health`);
      resolve();
    });

    httpServer.on('error', (error: Error) => {
      log.error('Failed to start HTTP server', error);
      reject(error);
    });

    // -----------------------------------------------------------------------
    // Graceful shutdown
    // -----------------------------------------------------------------------
    const shutdown = async (signal?: string) => {
      const reason = signal ? ` (${signal})` : '';
      log.info(`Shutting down HTTP server${reason}...`);

      // Close every active session's transport and server-side resources
      const cleanupTasks: Promise<void>[] = [];
      for (const [sid, session] of sessions.entries()) {
        cleanupTasks.push(
          (async () => {
            try { await session.transport.close(); } catch { /* best effort */ }
            try { await session.cleanup(); } catch { /* best effort */ }
            sessions.delete(sid);
          })(),
        );
      }
      await Promise.allSettled(cleanupTasks);

      // Stop accepting new connections and close the HTTP listener
      httpServer.close(() => {
        log.info('HTTP server closed.');
        process.exit(0);
      });

      // Force exit after 5 seconds if graceful shutdown stalls
      setTimeout(() => {
        log.warn('Graceful shutdown timed out, forcing exit.');
        process.exit(1);
      }, 5000).unref();
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  });
}
