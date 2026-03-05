// Location: src/handlers/resource-handlers.ts
// Summary: Handles ReadResourceRequestSchema for all MCP resource URIs. Supports both static
//   resources (ue://assets, ue://actors, ue://level, ue://health, ue://automation-bridge,
//   ue://version) and parameterized resource templates (ue://actor/{actorPath},
//   ue://blueprint/{className}, ue://asset/{assetPath}, ue://class/{className},
//   ue://level/{levelPath}, ue://console/{command}). Template URIs are matched via prefix
//   and delegate to the automation bridge for Unreal Engine data retrieval.
// Used by: src/server/resource-registry.ts (instantiated and registered during server setup).

import { ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { UnrealBridge } from '../unreal-bridge.js';
import { AutomationBridge } from '../automation/index.js';
import { AssetResources } from '../resources/assets.js';
import { ActorResources } from '../resources/actors.js';
import { LevelResources } from '../resources/levels.js';
import { HealthMonitor } from '../services/health-monitor.js';
import { getContextByCategory } from '../context/index.js';
import { operationJournal } from '../services/operation-journal.js';
import { acceptanceCriteria } from '../services/acceptance-criteria.js';

/** Timeout in milliseconds for automation bridge requests made by resource template handlers. */
const TEMPLATE_REQUEST_TIMEOUT_MS = 10000;

/**
 * Console commands that are blocked from execution via the ue://console/{command} resource
 * template for safety. Each entry is matched as a lowercase prefix against the incoming command.
 */
const DANGEROUS_CONSOLE_COMMANDS = ['exit', 'quit', 'shutdown', 'restartlevel', 'open '];

export class ResourceHandler {
  constructor(
    private server: Server,
    private bridge: UnrealBridge,
    private automationBridge: AutomationBridge,
    private assetResources: AssetResources,
    private actorResources: ActorResources,
    private levelResources: LevelResources,
    private healthMonitor: HealthMonitor,
    private ensureConnected: () => Promise<boolean>
  ) { }

  registerHandlers() {
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      // --- Static resources ---

      if (uri === 'ue://assets') {
        const ok = await this.ensureConnected();
        if (!ok) {
          return { contents: [{ uri, mimeType: 'text/plain', text: 'Unreal Engine not connected (after 3 attempts).' }] };
        }
        const list = await this.assetResources.list('/Game', true);
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(list, null, 2)
          }]
        };
      }

      if (uri === 'ue://actors') {
        const ok = await this.ensureConnected();
        if (!ok) {
          return { contents: [{ uri, mimeType: 'text/plain', text: 'Unreal Engine not connected (after 3 attempts).' }] };
        }
        const list = await this.actorResources.listActors();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(list, null, 2)
          }]
        };
      }

      if (uri === 'ue://level') {
        const ok = await this.ensureConnected();
        if (!ok) {
          return { contents: [{ uri, mimeType: 'text/plain', text: 'Unreal Engine not connected (after 3 attempts).' }] };
        }
        const level = await this.levelResources.getCurrentLevel();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(level, null, 2)
          }]
        };
      }

      if (uri === 'ue://health') {
        const uptimeMs = Date.now() - this.healthMonitor.metrics.uptime;
        const automationStatus = this.automationBridge.getStatus();

        let versionInfo: Record<string, unknown> = {};
        let featureFlags: Record<string, unknown> = {};
        if (this.bridge.isConnected) {
          try { versionInfo = await this.bridge.getEngineVersion(); } catch { }
          try { featureFlags = await this.bridge.getFeatureFlags(); } catch { }
        }

        const responseTimes = this.healthMonitor.metrics.responseTimes.slice(-25);
        const automationSummary = {
          connected: automationStatus.connected,
          activePort: automationStatus.activePort,
          pendingRequests: automationStatus.pendingRequests,
          listeningPorts: automationStatus.listeningPorts,
          lastHandshakeAt: automationStatus.lastHandshakeAt,
          lastRequestSentAt: automationStatus.lastRequestSentAt,
          maxPendingRequests: automationStatus.maxPendingRequests,
          maxConcurrentConnections: automationStatus.maxConcurrentConnections
        };

        const health = {
          status: this.healthMonitor.metrics.connectionStatus,
          uptimeSeconds: Math.floor(uptimeMs / 1000),
          performance: {
            totalRequests: this.healthMonitor.metrics.totalRequests,
            successfulRequests: this.healthMonitor.metrics.successfulRequests,
            failedRequests: this.healthMonitor.metrics.failedRequests,
            successRate: this.healthMonitor.metrics.totalRequests > 0 ? Number(((this.healthMonitor.metrics.successfulRequests / this.healthMonitor.metrics.totalRequests) * 100).toFixed(2)) : null,
            averageResponseTimeMs: Math.round(this.healthMonitor.metrics.averageResponseTime),
            recentResponseTimesMs: responseTimes
          },
          lastHealthCheckIso: this.healthMonitor.metrics.lastHealthCheck.toISOString(),
          unrealConnection: {
            status: this.bridge.isConnected ? 'connected' : 'disconnected',
            transport: 'automation_bridge',
            engineVersion: versionInfo,
            features: {
              pythonEnabled: false,
              subsystems: featureFlags.subsystems || {},
              automationBridgeConnected: automationStatus.connected
            }
          },
          recentErrors: this.healthMonitor.metrics.recentErrors.slice(-10),
          automationBridge: automationSummary,
          raw: {
            metrics: this.healthMonitor.metrics,
            automationStatus
          }
        };

        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(health, null, 2)
          }]
        };
      }

      if (uri === 'ue://automation-bridge') {
        const status = this.automationBridge.getStatus();
        const content = {
          summary: {
            enabled: status.enabled,
            connected: status.connected,
            host: status.host,
            port: status.port,
            capabilityTokenRequired: status.capabilityTokenRequired,
            pendingRequests: status.pendingRequests
          },
          connections: status.connections,
          timestamps: {
            connectedAt: status.connectedAt,
            lastHandshakeAt: status.lastHandshakeAt,
            lastMessageAt: status.lastMessageAt,
            lastRequestSentAt: status.lastRequestSentAt
          },
          lastDisconnect: status.lastDisconnect,
          lastHandshakeFailure: status.lastHandshakeFailure,
          lastError: status.lastError,
          lastHandshakeMetadata: status.lastHandshakeMetadata,
          pendingRequestDetails: status.pendingRequestDetails,
          listening: status.webSocketListening
        };

        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(content, null, 2)
          }]
        };
      }

      if (uri === 'ue://version') {
        const ok = await this.ensureConnected();
        if (!ok) {
          return { contents: [{ uri, mimeType: 'text/plain', text: 'Unreal Engine not connected (after 3 attempts).' }] };
        }
        const info = await this.bridge.getEngineVersion();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(info, null, 2)
          }]
        };
      }

      // --- Sprint 7: Grounded Context Resources ---

      if (uri === 'ue://project-summary') {
        const sections: Record<string, unknown> = {};

        // Engine version (works even disconnected — returns null)
        try {
          if (this.bridge.isConnected) {
            sections.engineVersion = await this.bridge.getEngineVersion();
          } else {
            sections.engineVersion = null;
            sections.connectionStatus = 'disconnected';
          }
        } catch { sections.engineVersion = null; }

        // Current level
        try {
          if (this.bridge.isConnected) {
            sections.currentLevel = await this.levelResources.getCurrentLevel();
          }
        } catch { sections.currentLevel = null; }

        // Actor summary by class
        try {
          if (this.bridge.isConnected) {
            const actors = await this.actorResources.listActors();
            const actorArray = Array.isArray(actors) ? actors : (actors as Record<string, unknown>).actors;
            if (Array.isArray(actorArray)) {
              const classCounts: Record<string, number> = {};
              for (const a of actorArray) {
                const cls = (a as Record<string, unknown>).class || (a as Record<string, unknown>).type || 'Unknown';
                classCounts[cls as string] = (classCounts[cls as string] || 0) + 1;
              }
              sections.actorSummary = {
                totalActors: actorArray.length,
                byClass: classCounts,
              };
            }
          }
        } catch { sections.actorSummary = null; }

        // Asset counts at /Game root
        try {
          if (this.bridge.isConnected) {
            const assets = await this.assetResources.list('/Game', false);
            const assetArray = Array.isArray(assets) ? assets : [];
            sections.assetCount = assetArray.length;
          }
        } catch { sections.assetCount = null; }

        // Recent operation count from journal
        const journalPos = operationJournal.getPosition();
        sections.journalPosition = journalPos;
        sections.totalOperationsRecorded = operationJournal.size;

        // Acceptance criteria summary (if set)
        const criteria = acceptanceCriteria.get();
        if (criteria) {
          sections.acceptanceCriteria = {
            genre: criteria.genre,
            platforms: criteria.platforms,
            performanceBudget: criteria.performanceBudget,
          };
        }

        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(sections, null, 2)
          }]
        };
      }

      if (uri === 'ue://recent-changes') {
        const recent = operationJournal.getRecent(15);
        const summary = operationJournal.getRecentChangesSummary(15);
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              journalPosition: operationJournal.getPosition(),
              totalRecorded: operationJournal.size,
              summary,
              entries: recent.map(e => ({
                id: e.id,
                timestamp: e.timestamp,
                summary: e.summary,
                tool: e.tool,
                action: e.action,
                assetsModified: e.assetsModified,
                actorsModified: e.actorsModified,
                outcome: e.outcome,
                durationMs: e.durationMs,
                warnings: e.warnings.length > 0 ? e.warnings : undefined,
                errors: e.errors.length > 0 ? e.errors : undefined,
              })),
            }, null, 2)
          }]
        };
      }

      if (uri === 'ue://recent-errors') {
        // Combine journal errors with health monitor errors
        const journalErrors = operationJournal.getRecentErrors(10);
        const healthErrors = this.healthMonitor.metrics.recentErrors.slice(-10);

        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              journalErrors: journalErrors.map(e => ({
                id: e.id,
                timestamp: e.timestamp,
                summary: e.summary,
                tool: e.tool,
                action: e.action,
                outcome: e.outcome,
                errors: e.errors,
                warnings: e.warnings,
                suggestedAction: e.outcome === 'failure'
                  ? `Retry ${e.tool}.${e.action} or inspect affected assets/actors`
                  : undefined,
              })),
              healthErrors: healthErrors.map(e => ({
                timestamp: (e as Record<string, unknown>).timestamp,
                message: (e as Record<string, unknown>).message || (e as Record<string, unknown>).error,
                tool: (e as Record<string, unknown>).tool,
              })),
              totalJournalErrors: journalErrors.length,
              totalHealthErrors: healthErrors.length,
            }, null, 2)
          }]
        };
      }

      if (uri === 'ue://acceptance-criteria') {
        const criteria = acceptanceCriteria.get();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(criteria ?? {
              _note: 'No acceptance criteria set. Use the validate tool with action set_acceptance_criteria to define the design contract.',
              example: {
                genre: 'top-down-shooter',
                camera: 'orthographic-top-down',
                platforms: ['Win64'],
                performanceBudget: { targetFps: 60, maxMemoryMb: 2048 },
                namingConventions: { blueprintPrefix: 'BP_', materialPrefix: 'M_', texturePrefix: 'T_' },
                constraints: ['No marketplace content', 'UE 5.7 only'],
              }
            }, null, 2)
          }]
        };
      }

      // --- Parameterized resource templates ---
      // These handle URIs that match the templates declared in resource-registry.ts.

      // ue://actor/{actorPath}
      const actorPrefix = 'ue://actor/';
      if (uri.startsWith(actorPrefix)) {
        try {
          const ok = await this.ensureConnected();
          if (!ok) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Unreal Engine not connected.' }] };
          }
          const actorPath = decodeURIComponent(uri.slice(actorPrefix.length));
          if (!actorPath) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Error: actorPath parameter is required.' }] };
          }
          const result = await this.automationBridge.sendAutomationRequest('control_actor', {
            action: 'get_actor_properties',
            actorPath
          }, { timeoutMs: TEMPLATE_REQUEST_TIMEOUT_MS });
          return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { contents: [{ uri, mimeType: 'text/plain', text: `Error fetching actor details: ${message}` }] };
        }
      }

      // ue://blueprint/{className}
      const bpPrefix = 'ue://blueprint/';
      if (uri.startsWith(bpPrefix)) {
        try {
          const ok = await this.ensureConnected();
          if (!ok) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Unreal Engine not connected.' }] };
          }
          const className = decodeURIComponent(uri.slice(bpPrefix.length));
          if (!className) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Error: className parameter is required.' }] };
          }
          const result = await this.automationBridge.sendAutomationRequest('manage_blueprint', {
            action: 'get_blueprint',
            blueprint_name: className
          }, { timeoutMs: TEMPLATE_REQUEST_TIMEOUT_MS });
          return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { contents: [{ uri, mimeType: 'text/plain', text: `Error fetching blueprint details: ${message}` }] };
        }
      }

      // ue://asset/{assetPath}
      const assetPrefix = 'ue://asset/';
      if (uri.startsWith(assetPrefix)) {
        try {
          const ok = await this.ensureConnected();
          if (!ok) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Unreal Engine not connected.' }] };
          }
          const assetPath = decodeURIComponent(uri.slice(assetPrefix.length));
          if (!assetPath) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Error: assetPath parameter is required.' }] };
          }
          const result = await this.automationBridge.sendAutomationRequest('manage_asset', {
            action: 'get_properties',
            asset_path: assetPath
          }, { timeoutMs: TEMPLATE_REQUEST_TIMEOUT_MS });
          return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { contents: [{ uri, mimeType: 'text/plain', text: `Error fetching asset details: ${message}` }] };
        }
      }

      // ue://class/{className}
      const classPrefix = 'ue://class/';
      if (uri.startsWith(classPrefix)) {
        try {
          const ok = await this.ensureConnected();
          if (!ok) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Unreal Engine not connected.' }] };
          }
          const className = decodeURIComponent(uri.slice(classPrefix.length));
          if (!className) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Error: className parameter is required.' }] };
          }
          const result = await this.automationBridge.sendAutomationRequest('inspect', {
            action: 'get_class_info',
            class_name: className
          }, { timeoutMs: TEMPLATE_REQUEST_TIMEOUT_MS });
          return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { contents: [{ uri, mimeType: 'text/plain', text: `Error fetching class info: ${message}` }] };
        }
      }

      // ue://level/{levelPath}
      const levelPrefix = 'ue://level/';
      if (uri.startsWith(levelPrefix)) {
        try {
          const ok = await this.ensureConnected();
          if (!ok) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Unreal Engine not connected.' }] };
          }
          const levelPath = decodeURIComponent(uri.slice(levelPrefix.length));
          if (!levelPath) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Error: levelPath parameter is required.' }] };
          }
          const result = await this.automationBridge.sendAutomationRequest('manage_level', {
            action: 'get_level_info',
            level_path: levelPath
          }, { timeoutMs: TEMPLATE_REQUEST_TIMEOUT_MS });
          return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { contents: [{ uri, mimeType: 'text/plain', text: `Error fetching level details: ${message}` }] };
        }
      }

      // ue://console/{command}
      const consolePrefix = 'ue://console/';
      if (uri.startsWith(consolePrefix)) {
        try {
          const ok = await this.ensureConnected();
          if (!ok) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Unreal Engine not connected.' }] };
          }
          const command = decodeURIComponent(uri.slice(consolePrefix.length));
          if (!command) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Error: command parameter is required.' }] };
          }
          const commandLower = command.toLowerCase();
          if (DANGEROUS_CONSOLE_COMMANDS.some(d => commandLower.startsWith(d))) {
            return { contents: [{ uri, mimeType: 'text/plain', text: `Blocked: '${command}' is not allowed via resource URI for safety.` }] };
          }
          const result = await this.automationBridge.sendAutomationRequest('system_control', {
            action: 'console_command',
            command
          }, { timeoutMs: TEMPLATE_REQUEST_TIMEOUT_MS });
          return {
            contents: [{
              uri,
              mimeType: 'text/plain',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }]
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { contents: [{ uri, mimeType: 'text/plain', text: `Error executing console command: ${message}` }] };
        }
      }

      // Handle UE5 documentation context resources
      const docsPrefix = 'ue5-docs://';
      if (uri.startsWith(docsPrefix)) {
        const category = uri.slice(docsPrefix.length);
        const ctx = getContextByCategory(category);
        if (ctx) {
          return {
            contents: [{
              uri,
              mimeType: 'text/plain',
              text: ctx.content,
            }]
          };
        }
        throw new Error(`Unknown UE5 docs category: ${category}`);
      }

      throw new Error(`Unknown resource: ${uri}`);
    });
  }
}
