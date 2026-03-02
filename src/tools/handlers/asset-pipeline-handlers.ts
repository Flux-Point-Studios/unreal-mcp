/**
 * Location: src/tools/handlers/asset-pipeline-handlers.ts
 *
 * External AI Asset Generation Pipeline Handlers.
 *
 * Bridges external AI asset generation services (Meshy, Tripo) with Unreal Engine
 * import via the existing manage_asset automation tool. This is the first open-source
 * UE MCP implementation to support text-to-3D and text-to-texture workflows.
 *
 * Actions:
 *   - list_providers: Enumerate configured and unconfigured AI providers
 *   - generate_3d_model: Submit text-to-3D generation request
 *   - generate_texture: Submit text-to-texture generation request
 *   - check_generation_status: Poll an async generation task for progress/completion
 *   - download_and_import: Download a generated asset file and import it into UE
 *
 * Used by: consolidated-tool-handlers.ts (registered as 'asset_pipeline' tool)
 * Depends on: common-handlers.ts (executeAutomationRequest for UE import)
 */

import { ITools } from '../../types/tool-interfaces.js';
import { executeAutomationRequest } from './common-handlers.js';
import { Logger } from '../../utils/logger.js';

const log = new Logger('AssetPipelineHandlers');

type HandlerArgs = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

/**
 * Describes a supported external AI generation service.
 * Each provider requires an API key set via an environment variable.
 */
interface ProviderConfig {
  /** Human-readable provider name */
  name: string;
  /** Environment variable that must hold the API key */
  apiKeyEnv: string;
  /** Base URL for the provider REST API */
  baseUrl: string;
}

/**
 * Registry of supported providers.
 * Add new providers here -- the rest of the handler code is provider-aware
 * via switch/if blocks in each action function.
 */
const PROVIDERS: Record<string, ProviderConfig> = {
  meshy: {
    name: 'Meshy',
    apiKeyEnv: 'MESHY_API_KEY',
    baseUrl: 'https://api.meshy.ai',
  },
  tripo: {
    name: 'Tripo',
    apiKeyEnv: 'TRIPO_API_KEY',
    baseUrl: 'https://api.tripo3d.ai/v2/openapi',
  },
};

/**
 * Retrieve an API key for the given provider from the environment.
 * Returns null if the provider is unknown or the env var is not set.
 */
function getApiKey(provider: string): string | null {
  const config = PROVIDERS[provider];
  if (!config) return null;
  return process.env[config.apiKeyEnv] || null;
}

/**
 * Safely extract a progress reporter from the tools object.
 * The progress reporter is an optional capability and may not be present.
 */
function getProgressReporter(
  tools: ITools
): { report: (current: number, total: number, message?: string) => Promise<void> } | undefined {
  const toolsRecord = tools as Record<string, unknown>;
  const reporter = toolsRecord.progressReporter as
    | { report: (p: number, t: number, m?: string) => Promise<void> }
    | undefined;
  return reporter;
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

/**
 * Top-level handler for the asset_pipeline tool.
 *
 * @param action - The sub-action string (e.g. 'generate_3d_model')
 * @param args   - Arguments from the MCP tool call
 * @param tools  - ITools object providing automation bridge access
 * @returns A result object with at minimum { success, action }
 */
export async function handleAssetPipelineTools(
  action: string,
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  log.info(`Asset pipeline action: ${action}`);

  switch (action) {
    case 'list_providers':
      return listProviders();

    case 'generate_3d_model':
      return await generate3DModel(args, tools);

    case 'generate_texture':
      return await generateTexture(args, tools);

    case 'check_generation_status':
      return await checkGenerationStatus(args);

    case 'download_and_import':
      return await downloadAndImport(args, tools);

    default:
      return {
        success: false,
        error: `Unknown asset pipeline action: ${action}`,
      };
  }
}

// ---------------------------------------------------------------------------
// Action: list_providers
// ---------------------------------------------------------------------------

/**
 * Lists all known providers and whether their API keys are configured.
 * No external calls are made -- purely reads environment state.
 */
function listProviders(): Record<string, unknown> {
  const available: Record<string, unknown>[] = [];
  const unavailable: Record<string, unknown>[] = [];

  for (const [key, config] of Object.entries(PROVIDERS)) {
    const hasKey = Boolean(process.env[config.apiKeyEnv]);
    const entry = {
      provider: key,
      name: config.name,
      configured: hasKey,
      apiKeyEnv: config.apiKeyEnv,
    };
    if (hasKey) {
      available.push(entry);
    } else {
      unavailable.push(entry);
    }
  }

  return {
    success: true,
    action: 'list_providers',
    available,
    unavailable,
    message: `${available.length} provider(s) configured, ${unavailable.length} need API keys.`,
  };
}

// ---------------------------------------------------------------------------
// Action: generate_3d_model
// ---------------------------------------------------------------------------

/**
 * Submits a text-to-3D generation request to the specified provider.
 * Generation is asynchronous -- the response includes a task_id to poll.
 *
 * @param args.prompt   - Required: text description of the 3D model
 * @param args.provider - Optional: 'meshy' (default) or 'tripo'
 * @param args.style    - Optional: art style hint (provider-dependent)
 */
async function generate3DModel(
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const provider = (args.provider as string) || 'meshy';
  const prompt = args.prompt as string;
  const style = args.style as string | undefined;

  if (!prompt) {
    return {
      success: false,
      error: 'prompt is required (describe the 3D model to generate)',
    };
  }

  const apiKey = getApiKey(provider);
  if (!apiKey) {
    return {
      success: false,
      error: `Provider '${provider}' not configured. Set ${PROVIDERS[provider]?.apiKeyEnv || 'API_KEY'} environment variable.`,
      hint: 'Use action list_providers to see available providers.',
    };
  }

  const progress = getProgressReporter(tools);

  try {
    // --- Meshy: POST /v2/text-to-3d ---
    if (provider === 'meshy') {
      await progress?.report(1, 3, `Submitting 3D generation request to Meshy...`);

      const response = await fetch(`${PROVIDERS.meshy.baseUrl}/v2/text-to-3d`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'preview',
          prompt,
          art_style: style || 'realistic',
          should_remesh: true,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        log.error(`Meshy API error (${response.status}): ${errText}`);
        return {
          success: false,
          error: `Meshy API error (${response.status}): ${errText}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      await progress?.report(2, 3, 'Generation submitted, processing...');

      return {
        success: true,
        action: 'generate_3d_model',
        provider,
        taskId: data.result,
        prompt,
        style: style || 'realistic',
        status: 'processing',
        message:
          '3D model generation submitted. Use check_generation_status with task_id to monitor progress.',
      };
    }

    // --- Tripo: POST /task ---
    if (provider === 'tripo') {
      await progress?.report(1, 3, `Submitting 3D generation request to Tripo...`);

      const response = await fetch(`${PROVIDERS.tripo.baseUrl}/task`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'text_to_model',
          prompt,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        log.error(`Tripo API error (${response.status}): ${errText}`);
        return {
          success: false,
          error: `Tripo API error (${response.status}): ${errText}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const taskData = data.data as Record<string, unknown> | undefined;

      await progress?.report(2, 3, 'Generation submitted, processing...');

      return {
        success: true,
        action: 'generate_3d_model',
        provider,
        taskId: taskData?.task_id || data.task_id,
        prompt,
        status: 'processing',
        message:
          'Generation submitted. Use check_generation_status to monitor.',
      };
    }

    return {
      success: false,
      error: `Provider '${provider}' not supported for 3D generation`,
    };
  } catch (error) {
    log.error('generate_3d_model failed:', error);
    return {
      success: false,
      action: 'generate_3d_model',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Action: generate_texture
// ---------------------------------------------------------------------------

/**
 * Submits a text-to-texture generation request.
 * Currently only Meshy is supported for texture generation.
 *
 * @param args.prompt    - Required: text description of the texture
 * @param args.provider  - Optional: 'meshy' (default)
 * @param args.model_url - Optional: URL of a 3D model to apply texture to
 */
async function generateTexture(
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const provider = (args.provider as string) || 'meshy';
  const prompt = args.prompt as string;
  const modelUrl = args.model_url as string | undefined;

  if (!prompt) {
    return {
      success: false,
      error: 'prompt is required (describe the texture to generate)',
    };
  }

  const apiKey = getApiKey(provider);
  if (!apiKey) {
    return {
      success: false,
      error: `Provider '${provider}' not configured. Set ${PROVIDERS[provider]?.apiKeyEnv || 'API_KEY'} environment variable.`,
    };
  }

  const progress = getProgressReporter(tools);

  try {
    // --- Meshy: POST /v2/text-to-texture ---
    if (provider === 'meshy') {
      await progress?.report(1, 3, 'Submitting texture generation to Meshy...');

      const response = await fetch(
        `${PROVIDERS.meshy.baseUrl}/v2/text-to-texture`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model_url: modelUrl || '',
            prompt,
            art_style: 'pbr',
          }),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        log.error(`Meshy texture API error (${response.status}): ${errText}`);
        return {
          success: false,
          error: `Meshy API error (${response.status}): ${errText}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      await progress?.report(2, 3, 'Texture generation submitted.');

      return {
        success: true,
        action: 'generate_texture',
        provider,
        taskId: data.result,
        prompt,
        status: 'processing',
        message:
          'Texture generation submitted. Use check_generation_status to monitor.',
      };
    }

    return {
      success: false,
      error: `Provider '${provider}' not supported for texture generation`,
    };
  } catch (error) {
    log.error('generate_texture failed:', error);
    return {
      success: false,
      action: 'generate_texture',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Action: check_generation_status
// ---------------------------------------------------------------------------

/**
 * Polls the status of an async generation task.
 * Returns status, progress percentage, and download URLs when complete.
 *
 * @param args.task_id  - Required: task identifier from a generate_* call
 * @param args.provider - Optional: 'meshy' (default) or 'tripo'
 */
async function checkGenerationStatus(
  args: HandlerArgs
): Promise<Record<string, unknown>> {
  const provider = (args.provider as string) || 'meshy';
  const taskId = args.task_id as string;

  if (!taskId) {
    return { success: false, error: 'task_id is required' };
  }

  const apiKey = getApiKey(provider);
  if (!apiKey) {
    return {
      success: false,
      error: `Provider '${provider}' not configured`,
    };
  }

  try {
    // --- Meshy: GET /v2/text-to-3d/:taskId ---
    if (provider === 'meshy') {
      const response = await fetch(
        `${PROVIDERS.meshy.baseUrl}/v2/text-to-3d/${taskId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        return {
          success: false,
          error: `Meshy API error (${response.status}): ${errText}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      return {
        success: true,
        action: 'check_generation_status',
        provider,
        taskId,
        status: data.status,
        progress: data.progress,
        modelUrls: data.model_urls,
        thumbnailUrl: data.thumbnail_url,
        message: `Status: ${data.status}${data.progress ? ` (${data.progress}%)` : ''}`,
      };
    }

    // --- Tripo: GET /task/:taskId ---
    if (provider === 'tripo') {
      const response = await fetch(
        `${PROVIDERS.tripo.baseUrl}/task/${taskId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        return {
          success: false,
          error: `Tripo API error (${response.status}): ${errText}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const taskData = data.data as Record<string, unknown> | undefined;
      return {
        success: true,
        action: 'check_generation_status',
        provider,
        taskId,
        status: taskData?.status,
        progress: taskData?.progress,
        output: taskData?.output,
        message: `Status: ${taskData?.status}`,
      };
    }

    return { success: false, error: `Unknown provider: ${provider}` };
  } catch (error) {
    log.error('check_generation_status failed:', error);
    return {
      success: false,
      action: 'check_generation_status',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Action: download_and_import
// ---------------------------------------------------------------------------

/**
 * Downloads a generated asset from a URL and imports it into UE via the
 * automation bridge's manage_asset import action.
 *
 * @param args.download_url - Required: public URL of the generated asset file
 * @param args.import_path  - Required: UE content path (e.g. /Game/GeneratedAssets/)
 * @param args.asset_name   - Optional: name for the imported asset
 */
async function downloadAndImport(
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const downloadUrl = args.download_url as string;
  const importPath = args.import_path as string;
  const assetName = args.asset_name as string | undefined;

  if (!downloadUrl) {
    return {
      success: false,
      error:
        'download_url is required (URL of the generated asset file)',
    };
  }
  if (!importPath) {
    return {
      success: false,
      error:
        'import_path is required (UE content path, e.g., /Game/GeneratedAssets/)',
    };
  }

  // Basic URL validation to avoid fetching arbitrary local resources
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    return {
      success: false,
      error: 'download_url is not a valid URL',
    };
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return {
      success: false,
      error: 'download_url must use http or https protocol',
    };
  }

  const resolvedName = assetName || `Generated_${Date.now()}`;
  const progress = getProgressReporter(tools);

  try {
    await progress?.report(1, 3, 'Downloading generated asset...');

    const response = await fetch(downloadUrl);
    if (!response.ok) {
      return {
        success: false,
        error: `Download failed (${response.status}): ${response.statusText}`,
      };
    }

    const buffer = await response.arrayBuffer();
    const fileSizeBytes = buffer.byteLength;

    // Determine file extension from URL path
    const urlPath = parsedUrl.pathname;
    const lastDot = urlPath.lastIndexOf('.');
    const ext = lastDot >= 0 ? urlPath.substring(lastDot + 1) : 'fbx';

    log.info(
      `Downloaded ${(fileSizeBytes / 1024).toFixed(1)}KB asset (${ext}) from ${parsedUrl.hostname}`
    );

    await progress?.report(2, 3, 'Importing into Unreal Engine...');

    // Delegate import to the UE automation bridge via manage_asset
    const importResult = await executeAutomationRequest(
      tools,
      'manage_asset',
      {
        action: 'import',
        source_path: downloadUrl,
        destination_path: importPath,
        asset_name: resolvedName,
      },
      'Failed to import asset into UE'
    );

    await progress?.report(3, 3, 'Import complete');

    return {
      success: true,
      action: 'download_and_import',
      downloadUrl,
      importPath,
      assetName: resolvedName,
      fileSize: fileSizeBytes,
      fileType: ext,
      importResult,
      message: `Asset downloaded (${(fileSizeBytes / 1024).toFixed(1)}KB) and import initiated at ${importPath}`,
    };
  } catch (error) {
    log.error('download_and_import failed:', error);
    return {
      success: false,
      action: 'download_and_import',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
