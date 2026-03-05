/**
 * Location: src/server/resource-registry.ts
 *
 * Summary:
 *   Registers MCP resource list handlers, resource template listing,
 *   and resource subscription (subscribe/unsubscribe) request handlers.
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
    ListResourceTemplatesRequestSchema,
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

        // Register static resource listing (fixed URIs that always exist)
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
            return {
                resources: [
                    { uri: 'ue://assets', name: 'Assets', description: 'Project assets', mimeType: 'application/json' },
                    { uri: 'ue://actors', name: 'Actors', description: 'Actors in the current level', mimeType: 'application/json' },
                    { uri: 'ue://level', name: 'Current Level', description: 'Current level name and path', mimeType: 'application/json' },
                    { uri: 'ue://health', name: 'Health Status', description: 'Server health and performance metrics', mimeType: 'application/json' },
                    { uri: 'ue://automation-bridge', name: 'Automation Bridge', description: 'Automation bridge diagnostics and recent activity', mimeType: 'application/json' },
                    { uri: 'ue://version', name: 'Engine Version', description: 'Unreal Engine version and compatibility info', mimeType: 'application/json' },
                    { uri: 'ue://project-summary', name: 'Project Summary', description: 'Sharp opinionated summary: game mode, maps, key BPs, actor counts, engine version', mimeType: 'application/json' },
                    { uri: 'ue://recent-changes', name: 'Recent Changes', description: 'Last 15 mutating operations with semantic summaries (from operation journal)', mimeType: 'application/json' },
                    { uri: 'ue://recent-errors', name: 'Recent Errors', description: 'Recent tool failures and warnings with structured diagnostics', mimeType: 'application/json' },
                    { uri: 'ue://acceptance-criteria', name: 'Acceptance Criteria', description: 'Machine-readable design contract: genre, perf budget, naming conventions, platform targets', mimeType: 'application/json' },
                    ...docsResources,
                ]
            };
        });

        // Register resource templates (parameterized URI patterns for dynamic lookups)
        this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
            return {
                resourceTemplates: [
                    {
                        uriTemplate: 'ue://actor/{actorPath}',
                        name: 'Actor Details',
                        description: 'Get detailed information about a specific actor by path (e.g., /Game/Maps/Main.Main:BP_Player_C_0)',
                        mimeType: 'application/json'
                    },
                    {
                        uriTemplate: 'ue://blueprint/{className}',
                        name: 'Blueprint Details',
                        description: 'Get details of a Blueprint class (e.g., BP_Player_C, BP_Enemy_Base)',
                        mimeType: 'application/json'
                    },
                    {
                        uriTemplate: 'ue://asset/{assetPath}',
                        name: 'Asset Details',
                        description: 'Get metadata for an asset by path (e.g., /Game/Materials/M_Base, /Game/Meshes/SM_Rock)',
                        mimeType: 'application/json'
                    },
                    {
                        uriTemplate: 'ue://class/{className}',
                        name: 'Class Info',
                        description: 'Get class hierarchy and property info for any UE class',
                        mimeType: 'application/json'
                    },
                    {
                        uriTemplate: 'ue://level/{levelPath}',
                        name: 'Level Details',
                        description: 'Get detailed info about a specific level/map',
                        mimeType: 'application/json'
                    },
                    {
                        uriTemplate: 'ue://console/{command}',
                        name: 'Console Command Result',
                        description: 'Execute a console command and return the output (read-only commands only)',
                        mimeType: 'text/plain'
                    }
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
