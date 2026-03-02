/**
 * Location: src/services/subscription-manager.ts
 *
 * Summary:
 *   Manages MCP resource subscriptions and sends update notifications to
 *   connected clients. When a client subscribes to a resource URI (e.g.
 *   "ue://actors"), this manager tracks the subscription and can later send
 *   "resources/updated" notifications when the underlying data changes.
 *
 * Usage with other files:
 *   - src/server/resource-registry.ts: Registers Subscribe/Unsubscribe request
 *     handlers that delegate to this manager.
 *   - src/server/tool-registry.ts: After a tool call succeeds with a mutating
 *     action, calls notifyForToolAction() to trigger relevant subscriptions.
 *   - src/index.ts: Capabilities declare { resources: { subscribe: true } }
 *     to advertise subscription support to MCP clients.
 *
 * Design decisions:
 *   - Singleton pattern so the manager can be accessed from multiple modules
 *     without threading it through constructor chains.
 *   - Debounced notifications (default 500ms) prevent flooding the client
 *     when rapid successive changes occur (e.g. bulk actor operations).
 *   - All notification failures are caught and logged at debug level --
 *     subscriptions are strictly best-effort and must never break tool
 *     execution or other server operations.
 *   - A conservative TOOL_RESOURCE_MAP only maps tools where the affected
 *     resources are well-understood. Read-only actions are filtered out to
 *     avoid unnecessary notifications.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Logger } from '../utils/logger.js';

const log = new Logger('SubscriptionManager');

/**
 * Manages MCP resource subscriptions and sends update notifications.
 *
 * Clients subscribe to resource URIs via the MCP resources/subscribe
 * request. When the server detects that a subscribed resource has
 * changed (e.g. after a tool call that mutates actors), it sends a
 * notifications/resources/updated notification so the client can
 * re-fetch the resource.
 */
export class SubscriptionManager {
  /** Active subscription URIs. */
  private subscriptions = new Set<string>();

  /** Reference to the MCP Server instance for sending notifications. */
  private server: Server | null = null;

  /** Pending debounce timers keyed by URI to coalesce rapid updates. */
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Singleton instance. */
  private static instance: SubscriptionManager;

  /**
   * Returns the singleton SubscriptionManager instance.
   * Creates it on first access.
   */
  static getInstance(): SubscriptionManager {
    if (!SubscriptionManager.instance) {
      SubscriptionManager.instance = new SubscriptionManager();
    }
    return SubscriptionManager.instance;
  }

  /**
   * Inject the MCP Server reference so the manager can send notifications.
   * Must be called during server initialization before any notifications
   * can be sent.
   *
   * @param server - The MCP Server instance.
   */
  setServer(server: Server): void {
    this.server = server;
  }

  /**
   * Register a subscription for the given resource URI.
   * Called when a client sends a resources/subscribe request.
   *
   * @param uri - The resource URI to subscribe to (e.g. "ue://actors").
   */
  subscribe(uri: string): void {
    this.subscriptions.add(uri);
    log.info(`Subscribed to: ${uri}`);
  }

  /**
   * Remove a subscription for the given resource URI.
   * Called when a client sends a resources/unsubscribe request.
   * Also clears any pending debounce timer for the URI.
   *
   * @param uri - The resource URI to unsubscribe from.
   */
  unsubscribe(uri: string): void {
    this.subscriptions.delete(uri);
    const timer = this.debounceTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(uri);
    }
    log.info(`Unsubscribed from: ${uri}`);
  }

  /**
   * Check whether a given URI is currently subscribed.
   *
   * @param uri - The resource URI to check.
   * @returns true if the URI has an active subscription.
   */
  isSubscribed(uri: string): boolean {
    return this.subscriptions.has(uri);
  }

  /**
   * Notify that a specific resource URI has been updated.
   *
   * The notification is debounced: if multiple updates arrive for the
   * same URI within the debounce window, only the last one triggers
   * a notification. This prevents flooding the client during rapid
   * successive changes (e.g. a loop that modifies many actor properties).
   *
   * @param uri - The resource URI that has changed.
   * @param debounceMs - Debounce window in milliseconds. Defaults to 500.
   */
  notifyResourceUpdated(uri: string, debounceMs = 500): void {
    if (!this.subscriptions.has(uri) || !this.server) return;

    // Clear any pending notification for this URI
    const existing = this.debounceTimers.get(uri);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      uri,
      setTimeout(() => {
        this.debounceTimers.delete(uri);
        if (this.server && this.subscriptions.has(uri)) {
          this.server.sendResourceUpdated({ uri }).catch((err) => {
            log.debug(`Failed to send resource update for ${uri}`, err);
          });
          log.debug(`Sent resource updated notification: ${uri}`);
        }
      }, debounceMs)
    );
  }

  /**
   * Notify all subscriptions whose URI starts with (or equals) the
   * given pattern. Useful for triggering updates across a family of
   * related resources (e.g. "ue://actor/" matches "ue://actor/Cube_1").
   *
   * @param pattern - A URI prefix to match against subscriptions.
   * @param debounceMs - Debounce window in milliseconds. Defaults to 500.
   */
  notifyByPattern(pattern: string, debounceMs = 500): void {
    for (const uri of this.subscriptions) {
      if (uri.startsWith(pattern) || uri === pattern) {
        this.notifyResourceUpdated(uri, debounceMs);
      }
    }
  }

  /**
   * Notify relevant resource subscriptions based on a tool action.
   *
   * This method maps tool names to the resource URIs they affect and
   * triggers notifications for any active subscriptions. Read-only
   * actions (list, get, inspect, etc.) are filtered out since they
   * do not mutate resources.
   *
   * Call this after a tool execution succeeds to let subscribed clients
   * know they should re-fetch affected resources.
   *
   * @param toolName - The name of the tool that was executed.
   * @param action - The action parameter passed to the tool.
   */
  notifyForToolAction(toolName: string, action: string): void {
    // Map tool names to the resource URI patterns they affect
    const TOOL_RESOURCE_MAP: Record<string, string[]> = {
      control_actor: ['ue://actors', 'ue://actor/'],
      manage_blueprint: ['ue://blueprint/'],
      manage_asset: ['ue://assets', 'ue://asset/'],
      manage_level: ['ue://level', 'ue://level/'],
      manage_environment: ['ue://actors'],
      manage_lighting: ['ue://actors'],
      control_editor: [],
    };

    // Read-only actions do not trigger update notifications
    const READ_ONLY_ACTIONS = new Set([
      'list',
      'get',
      'get_properties',
      'get_blueprint',
      'get_actor_properties',
      'find',
      'search',
      'inspect',
      'get_class_info',
      'get_level_info',
      'get_details',
      'list_actors',
      'get_node_details',
      'get_graph_details',
    ]);

    if (READ_ONLY_ACTIONS.has(action)) return;

    const affectedResources = TOOL_RESOURCE_MAP[toolName];
    if (!affectedResources) return;

    for (const resourcePattern of affectedResources) {
      this.notifyByPattern(resourcePattern);
    }
  }

  /**
   * Returns the number of active subscriptions.
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Returns an array of all actively subscribed URIs.
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  /**
   * Clean up all timers and subscriptions.
   * Should be called during server shutdown to avoid dangling timers.
   */
  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.subscriptions.clear();
    log.debug('SubscriptionManager disposed');
  }
}

/** Pre-instantiated singleton for convenient import. */
export const subscriptionManager = SubscriptionManager.getInstance();
