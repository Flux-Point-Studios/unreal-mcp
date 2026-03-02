/**
 * Location: src/server/resource-registry.ts
 *
 * Summary:
 *   Registers MCP resource list handlers and resource subscription
 *   (subscribe/unsubscribe) request handlers with the MCP Server.
 *
 * Usage with other files:
 *   - src/server-setup.ts: Instantiates this class and calls register().
 *   - src/services/subscription-manager.ts: Receives the Server reference
 *     and handles subscribe/unsubscribe bookkeeping.
 *   - src/handlers/resource-handlers.ts: Handles ReadResource requests.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    ListResourcesRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { UnrealBridge } from '../unreal-bridge.js';
import { AutomationBridge } from '../automation/index.js';
import { HealthMonitor } from '../services/health-monitor.js';
import { ResourceHandler } from '../handlers/resource-handlers.js';
import { AssetResources } from '../resources/assets.js';
import { ActorResources } from '../resources/actors.js';
import { LevelResources } from '../resources/levels.js';
import { getContextCategories } from '../context/index.js';
import { subscriptionManager } from '../services/subscription-manager.js';

export class ResourceRegistry {
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

    register() {
        // Wire the subscription manager to the MCP server so it can send
        // notifications/resources/updated when subscribed resources change.
        subscriptionManager.setServer(this.server);

        // Register subscribe/unsubscribe request handlers so clients can
        // opt in to resource change notifications.
        this.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
            subscriptionManager.subscribe(request.params.uri);
            return {};
        });

        this.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
            subscriptionManager.unsubscribe(request.params.uri);
            return {};
        });

        // Build the dynamic list of UE5 docs resources from the context system
        const docsResources = getContextCategories().map((cat) => ({
            uri: `ue5-docs://${cat.name}`,
            name: `UE5 Docs: ${cat.name}`,
            description: cat.description,
            mimeType: 'text/plain' as const,
        }));

        this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
            return {
                resources: [
                    { uri: 'ue://assets', name: 'Assets', description: 'Project assets', mimeType: 'application/json' },
                    { uri: 'ue://actors', name: 'Actors', description: 'Actors in the current level', mimeType: 'application/json' },
                    { uri: 'ue://level', name: 'Current Level', description: 'Current level name and path', mimeType: 'application/json' },
                    { uri: 'ue://health', name: 'Health Status', description: 'Server health and performance metrics', mimeType: 'application/json' },
                    { uri: 'ue://automation-bridge', name: 'Automation Bridge', description: 'Automation bridge diagnostics and recent activity', mimeType: 'application/json' },
                    { uri: 'ue://version', name: 'Engine Version', description: 'Unreal Engine version and compatibility info', mimeType: 'application/json' },
                    ...docsResources,
                ]
            };
        });

        const resourceHandler = new ResourceHandler(
            this.server,
            this.bridge,
            this.automationBridge,
            this.assetResources,
            this.actorResources,
            this.levelResources,
            this.healthMonitor,
            this.ensureConnected
        );
        resourceHandler.registerHandlers();
    }
}
