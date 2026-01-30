/**
 * Location: src/automation/handshake.ts
 *
 * Summary:
 * Handles WebSocket handshake protocol between MCP server and Unreal Engine plugin.
 * Provides version negotiation and capability verification for graceful degradation
 * when plugin versions are mismatched.
 *
 * Used by:
 * - bridge.ts: Uses HandshakeHandler for initial connection handshake
 * - connection-manager.ts: May use performVersionHandshake for version validation
 */

import { WebSocket } from 'ws';
import { Logger } from '../utils/logger.js';
import { AutomationBridgeMessage } from './types.js';
import { EventEmitter } from 'node:events';

/** Server version constant - update when releasing new versions */
export const SERVER_VERSION = '0.6.0';

/** Minimum plugin version required for full feature support */
export const MIN_PLUGIN_VERSION = '0.5.0';

/** Result of version handshake validation */
export interface VersionHandshakeResult {
  success: boolean;
  warning?: string;
  degradedFeatures?: string[];
  pluginVersion?: string;
  serverVersion?: string;
}

/**
 * Compare two semantic version strings.
 * @param v1 - First version string (e.g., "0.6.0")
 * @param v2 - Second version string (e.g., "0.5.0")
 * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Perform version handshake with the Unreal Engine plugin.
 * Validates plugin version against minimum requirements and returns
 * degraded feature information if version is too old.
 *
 * @param getPluginInfo - Async function that retrieves plugin version and capabilities
 * @returns Handshake result with version info and any warnings
 */
export async function performVersionHandshake(
  getPluginInfo: () => Promise<{ version?: string; capabilities?: string[] }>
): Promise<VersionHandshakeResult> {
  const log = new Logger('VersionHandshake');

  try {
    const pluginInfo = await getPluginInfo();
    const pluginVersion = pluginInfo.version || '0.0.0';

    if (compareVersions(pluginVersion, MIN_PLUGIN_VERSION) < 0) {
      log.warn(`Plugin version ${pluginVersion} < required ${MIN_PLUGIN_VERSION}`);

      // Warn but don't refuse - graceful degradation
      return {
        success: true,
        warning: `Plugin version ${pluginVersion} may not support all features. Update recommended.`,
        degradedFeatures: ['transactions', 'reparent_material_instance', 'semanticMaterialGraph'],
        pluginVersion,
        serverVersion: SERVER_VERSION,
      };
    }

    log.info(`Version handshake successful. Plugin version: ${pluginVersion}, Server version: ${SERVER_VERSION}`);
    return {
      success: true,
      pluginVersion,
      serverVersion: SERVER_VERSION,
    };
  } catch (error) {
    log.warn('Version handshake failed, proceeding with defaults:', error);
    return {
      success: true,
      warning: 'Could not verify plugin version',
      serverVersion: SERVER_VERSION,
    };
  }
}

export class HandshakeHandler extends EventEmitter {
    private log = new Logger('HandshakeHandler');
    private readonly DEFAULT_HANDSHAKE_TIMEOUT_MS = 5000;

    constructor(
        private capabilityToken?: string
    ) {
        super();
    }

    public initiateHandshake(socket: WebSocket, timeoutMs: number = this.DEFAULT_HANDSHAKE_TIMEOUT_MS): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            let handshakeComplete = false;

            const timeout = setTimeout(() => {
                if (!handshakeComplete) {
                    this.log.warn('Automation bridge client handshake timed out');
                    socket.close(4002, 'Handshake timeout');
                    reject(new Error('Handshake timeout'));
                }
            }, timeoutMs);

            const onMessage = (data: Buffer | string) => {
                let parsed: AutomationBridgeMessage;
                const text = typeof data === 'string' ? data : data.toString('utf8');
                try {
                    parsed = JSON.parse(text) as AutomationBridgeMessage;
                } catch (error) {
                    this.log.error('Received non-JSON automation message during handshake', error);
                    socket.close(4003, 'Invalid JSON payload');
                    cleanup();
                    reject(new Error('Invalid JSON payload'));
                    return;
                }

                if (parsed.type === 'bridge_ack') {
                    handshakeComplete = true;
                    cleanup();
                    const metadata = this.sanitizeHandshakeMetadata(parsed as Record<string, unknown>);
                    resolve(metadata);
                } else {
                    this.log.warn(`Expected bridge_ack handshake, received ${parsed.type}`);
                    socket.close(4004, 'Handshake expected bridge_ack');
                    cleanup();
                    reject(new Error(`Handshake expected bridge_ack, got ${parsed.type}`));
                }
            };

            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };

            const onClose = () => {
                cleanup();
                reject(new Error('Socket closed during handshake'));
            };

            const cleanup = () => {
                clearTimeout(timeout);
                socket.off('message', onMessage);
                socket.off('error', onError);
                socket.off('close', onClose);
            };

            socket.on('message', onMessage);
            socket.on('error', onError);
            socket.on('close', onClose);

            // Send bridge_hello with a slight delay to ensure the server has registered its handlers
            setTimeout(() => {
                if (socket.readyState === WebSocket.OPEN) {
                    const helloPayload: AutomationBridgeMessage = {
                        type: 'bridge_hello',
                        capabilityToken: this.capabilityToken || undefined
                    };
                    this.log.debug(`Sending bridge_hello (delayed): ${JSON.stringify(helloPayload)}`);
                    socket.send(JSON.stringify(helloPayload));
                } else {
                    this.log.warn('Socket closed before bridge_hello could be sent');
                }
            }, 500);
        });
    }

    private sanitizeHandshakeMetadata(payload: Record<string, unknown>): Record<string, unknown> {
        const sanitized: Record<string, unknown> = { ...payload };
        delete sanitized.type;
        if ('capabilityToken' in sanitized) {
            sanitized.capabilityToken = 'REDACTED';
        }
        return sanitized;
    }
}
