/**
 * Location: src/services/sampling-client.ts
 *
 * MCP Sampling Client -- wraps `server.createMessage` for server-initiated AI
 * requests.  MCP Sampling allows the SERVER to ask the connected CLIENT's AI
 * model to reason about data (e.g. viewport screenshots, performance stats,
 * error logs).
 *
 * Usage:
 *   - Import the singleton `samplingClient` and call `setServer(server)` once
 *     after the MCP `Server` instance is created (done in src/index.ts).
 *   - Any handler file can then `import { samplingClient }` and call methods
 *     such as `analyzeViewport`, `analyzeData`, or `generateRecommendations`.
 *   - Sampling is entirely optional.  Many MCP clients do not support it yet
 *     (Claude Desktop does; most IDE clients do not).  All public methods
 *     gracefully degrade: they return `null` or empty arrays when sampling is
 *     unavailable.
 *
 * Related files:
 *   - src/index.ts                   -- wires `samplingClient.setServer(server)`
 *   - src/tools/handlers/performance-handlers.ts -- optional consumer
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type {
  CreateMessageResult,
  CreateMessageRequestParamsBase,
} from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../utils/logger.js';

const log = new Logger('SamplingClient');

/**
 * Default maximum tokens for analysis requests.  Kept moderate so that
 * sampling calls stay responsive and avoid excessive token usage.
 */
const DEFAULT_ANALYSIS_MAX_TOKENS = 1024;

/**
 * Default maximum tokens for shorter, simpler responses (e.g. yes/no,
 * classification, or brief summaries).
 */
const DEFAULT_SHORT_MAX_TOKENS = 512;

/**
 * Timeout in milliseconds for sampling requests.  If the client takes
 * longer than this we abort and return null so the caller can continue.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

export class SamplingClient {
  private server: Server | null = null;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Wire the MCP Server instance so the client can call `server.createMessage`.
   * Must be called once, after the Server is constructed in src/index.ts.
   */
  setServer(server: Server): void {
    this.server = server;
    log.debug('SamplingClient wired to MCP Server instance');
  }

  // -----------------------------------------------------------------------
  // Availability check
  // -----------------------------------------------------------------------

  /**
   * Returns true when the connected MCP client has declared `sampling`
   * support in its capabilities AND a server instance has been wired.
   *
   * Always call this before issuing any sampling request so that handlers
   * can gracefully skip the feature when it is not available.
   */
  isAvailable(): boolean {
    if (!this.server) {
      return false;
    }
    try {
      const caps = this.server.getClientCapabilities();
      return Boolean(caps?.sampling);
    } catch {
      // getClientCapabilities may throw if called before initialization
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Public analysis methods
  // -----------------------------------------------------------------------

  /**
   * Ask the client AI to analyse a viewport screenshot.
   *
   * @param base64Image - Base-64 encoded image data (PNG, JPEG, etc.)
   * @param mimeType    - MIME type of the image, e.g. "image/png"
   * @param prompt      - Natural-language instruction for the analysis
   * @returns The AI's textual response, or `null` when sampling is
   *          unavailable or the request fails.
   */
  async analyzeViewport(
    base64Image: string,
    mimeType: string,
    prompt: string,
  ): Promise<string | null> {
    if (!this.isAvailable() || !this.server) {
      return null;
    }

    try {
      const params: CreateMessageRequestParamsBase = {
        messages: [
          {
            role: 'user',
            content: { type: 'image', data: base64Image, mimeType },
          },
          {
            role: 'user',
            content: { type: 'text', text: prompt },
          },
        ],
        maxTokens: DEFAULT_ANALYSIS_MAX_TOKENS,
      };

      const result: CreateMessageResult = await this.server.createMessage(
        params,
        { timeout: DEFAULT_TIMEOUT_MS },
      );

      return this.extractText(result);
    } catch (error) {
      log.debug('analyzeViewport sampling request failed:', error);
      return null;
    }
  }

  /**
   * Ask the client AI to analyse arbitrary text data (performance stats,
   * error logs, configuration dumps, etc.).
   *
   * @param data   - The raw data string to be analysed
   * @param prompt - Natural-language instruction for the analysis
   * @param maxTokens - Optional override for the maximum response length
   * @returns The AI's textual response, or `null` when sampling is
   *          unavailable or the request fails.
   */
  async analyzeData(
    data: string,
    prompt: string,
    maxTokens: number = DEFAULT_ANALYSIS_MAX_TOKENS,
  ): Promise<string | null> {
    if (!this.isAvailable() || !this.server) {
      return null;
    }

    try {
      const params: CreateMessageRequestParamsBase = {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `${prompt}\n\n--- Data ---\n${data}`,
            },
          },
        ],
        maxTokens,
      };

      const result: CreateMessageResult = await this.server.createMessage(
        params,
        { timeout: DEFAULT_TIMEOUT_MS },
      );

      return this.extractText(result);
    } catch (error) {
      log.debug('analyzeData sampling request failed:', error);
      return null;
    }
  }

  /**
   * Ask the client AI to classify or give a short answer about a topic.
   *
   * Useful for quick yes/no, severity ratings, or one-line summaries.
   *
   * @param prompt - The question or classification request
   * @returns The AI's textual response, or `null` when unavailable.
   */
  async quickQuery(prompt: string): Promise<string | null> {
    return this.analyzeData('', prompt, DEFAULT_SHORT_MAX_TOKENS);
  }

  /**
   * Ask the client AI to produce actionable recommendations from a
   * structured audit / diagnostic payload.
   *
   * Each recommendation is returned as a plain string (without a leading
   * bullet character).  Returns an empty array when sampling is
   * unavailable or the response cannot be parsed.
   *
   * @param auditData - Arbitrary JSON-serialisable diagnostic data
   * @returns An array of recommendation strings.
   */
  async generateRecommendations(
    auditData: Record<string, unknown>,
  ): Promise<string[]> {
    const systemPrompt =
      'You are a UE5 performance expert. Analyze this level audit data and ' +
      'provide specific, actionable recommendations for improving performance. ' +
      'Return each recommendation on a new line, prefixed with "- ".';

    const analysis = await this.analyzeData(
      JSON.stringify(auditData, null, 2),
      systemPrompt,
    );

    if (!analysis) {
      return [];
    }

    // Parse bullet-prefixed lines out of the free-form response
    return analysis
      .split('\n')
      .filter((line) => line.trim().startsWith('- '))
      .map((line) => line.trim().substring(2).trim())
      .filter((line) => line.length > 0);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Extract the plain text from a `CreateMessageResult`.
   * Returns `null` for non-text content types (image, audio).
   */
  private extractText(result: CreateMessageResult): string | null {
    if (result.content.type === 'text') {
      return result.content.text;
    }
    log.debug(
      `Sampling response was non-text (type=${result.content.type}); ignoring.`,
    );
    return null;
  }
}

/**
 * Singleton instance.  Import this from any handler file to access
 * sampling without needing to pass the Server around.
 */
export const samplingClient = new SamplingClient();
