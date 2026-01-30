import { cleanObject } from '../../utils/safe-json.js';
import { ITools } from '../../types/tool-interfaces.js';
import type { HandlerArgs, SystemArgs } from '../../types/handler-types.js';
import { executeAutomationRequest } from './common-handlers.js';
import {
  launchEditor,
  waitForEditorReady,
  validateProjectPath,
  type LaunchMode
} from '../../utils/editor-launch.js';
import { extractOptionalNumber } from './argument-helper.js';

/**
 * Helper to normalize args and extract values with defaults.
 * @param args The raw handler arguments
 * @param keys Array of key definitions with optional defaults
 * @returns Normalized params object
 */
function normalizeArgs(args: HandlerArgs, keys: Array<{ key: string; default?: unknown }>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const argsRecord = args as Record<string, unknown>;
  for (const { key, default: defaultValue } of keys) {
    params[key] = argsRecord[key] !== undefined ? argsRecord[key] : defaultValue;
  }
  return params;
}

/**
 * Extract optional string from params object.
 * @param params The params object
 * @param key The key to extract
 * @returns The string value or undefined
 */
function extractOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

/** Response factory for consistent response structure */
const ResponseFactory = {
  success: (data: unknown, message: string): Record<string, unknown> => ({
    success: true,
    message,
    data: typeof data === 'object' && data !== null ? data : { result: data },
  }),
  error: (message: string, errorCode: string): Record<string, unknown> => ({
    success: false,
    error: errorCode,
    message,
  }),
};

/** Response from various operations */
interface OperationResponse {
  success?: boolean;
  error?: string;
  message?: string;
  settings?: unknown;
  data?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

/** Validation result for an asset */
interface AssetValidationResult {
  assetPath: string;
  success?: boolean;
  error?: string | null;
  [key: string]: unknown;
}

export async function handleSystemTools(action: string, args: HandlerArgs, tools: ITools): Promise<Record<string, unknown>> {
  const argsTyped = args as SystemArgs;
  const sysAction = String(action || '').toLowerCase();
  
  switch (sysAction) {
    case 'show_fps':
      await tools.systemTools.executeConsoleCommand(argsTyped.enabled !== false ? 'stat fps' : 'stat fps 0');
      return { success: true, message: `FPS display ${argsTyped.enabled !== false ? 'enabled' : 'disabled'}`, action: 'show_fps' };
    case 'profile': {
      const rawType = typeof argsTyped.profileType === 'string' ? argsTyped.profileType.trim() : '';
      const profileKey = rawType ? rawType.toLowerCase() : 'cpu';
      const enabled = argsTyped.enabled !== false;

      // Use built-in stat commands that are known to exist in editor builds.
      // "stat unit" is a safe choice for CPU profiling in most configurations.
      const profileMap: Record<string, string> = {
        cpu: 'stat unit',
        gamethread: 'stat game',
        renderthread: 'stat scenerendering',
        gpu: 'stat gpu',
        memory: 'stat memory',
        fps: 'stat fps',
        all: 'stat unit'
      };

      const cmd = profileMap[profileKey];
      if (!cmd) {
        return {
          success: false,
          error: 'INVALID_PROFILE_TYPE',
          message: `Unsupported profileType: ${rawType || String(argsTyped.profileType ?? '')}`,
          action: 'profile',
          profileType: argsTyped.profileType
        };
      }

      await tools.systemTools.executeConsoleCommand(cmd);
      return {
        success: true,
        message: `Profiling ${enabled ? 'enabled' : 'disabled'} (${rawType || 'CPU'})`,
        action: 'profile',
        profileType: rawType || 'CPU'
      };
    }
    case 'show_stats': {
      const category = typeof argsTyped.category === 'string' ? argsTyped.category.trim() : 'Unit';
      const enabled = argsTyped.enabled !== false;
      const cmd = `stat ${category}`;
      await tools.systemTools.executeConsoleCommand(cmd);
      return {
        success: true,
        message: `Stats display ${enabled ? 'enabled' : 'disabled'} for category: ${category}`,
        action: 'show_stats',
        category,
        enabled
      };
    }
    case 'set_quality': {
      const quality = argsTyped.level ?? 'medium';
      let qVal: number;
      if (typeof quality === 'number') {
        qVal = quality;
      } else {
        const qStr = String(quality).toLowerCase();
        qVal = (qStr === 'high' || qStr === 'epic') ? 3 : (qStr === 'low' ? 0 : (qStr === 'cinematic' ? 4 : 1));
      }
      // Clamp quality level to valid range 0-4
      qVal = Math.max(0, Math.min(4, qVal));

      const category = String(argsTyped.category || 'ViewDistance').toLowerCase();
      let cvar = 'sg.ViewDistanceQuality';

      if (category.includes('shadow')) cvar = 'sg.ShadowQuality';
      else if (category.includes('texture')) cvar = 'sg.TextureQuality';
      else if (category.includes('effect')) cvar = 'sg.EffectsQuality';
      else if (category.includes('postprocess')) cvar = 'sg.PostProcessQuality';
      else if (category.includes('foliage')) cvar = 'sg.FoliageQuality';
      else if (category.includes('shading')) cvar = 'sg.ShadingQuality';
      else if (category.includes('globalillumination') || category.includes('gi')) cvar = 'sg.GlobalIlluminationQuality';
      else if (category.includes('reflection')) cvar = 'sg.ReflectionQuality';
      else if (category.includes('viewdistance')) cvar = 'sg.ViewDistanceQuality';

      await tools.systemTools.executeConsoleCommand(`${cvar} ${qVal}`);
      return { success: true, message: `${category} quality derived from '${quality}' set to ${qVal} via ${cvar}`, action: 'set_quality' };
    }
    case 'execute_command':
      return cleanObject(await tools.systemTools.executeConsoleCommand(argsTyped.command ?? '') as Record<string, unknown>);
    case 'create_widget': {
      const name = typeof argsTyped.name === 'string' ? argsTyped.name.trim() : '';
      const widgetPathRaw = typeof argsTyped.widgetPath === 'string' ? argsTyped.widgetPath.trim() : '';
      const widgetType = typeof (argsTyped as Record<string, unknown>).widgetType === 'string' 
        ? ((argsTyped as Record<string, unknown>).widgetType as string).trim() 
        : undefined;

      // If name is missing but widgetPath is provided, try to extract name from path
      let effectiveName = name || `NewWidget_${Date.now()}`;
      let effectivePath = typeof (argsTyped as Record<string, unknown>).savePath === 'string' 
        ? ((argsTyped as Record<string, unknown>).savePath as string).trim() 
        : '';

      if (!name && widgetPathRaw) {
        const parts = widgetPathRaw.split('/').filter((p: string) => p.length > 0);
        if (parts.length > 0) {
          effectiveName = parts[parts.length - 1];
          // If path was provided as widgetPath, use the directory as savePath if savePath wasn't explicit
          if (!effectivePath) {
            effectivePath = '/' + parts.slice(0, parts.length - 1).join('/');
          }
        }
      }

      if (!effectiveName) {
        return {
          success: false,
          error: 'INVALID_ARGUMENT',
          message: 'Widget name is required for creation',
          action: 'create_widget'
        };
      }

      try {
        const res = await tools.uiTools.createWidget({
          name: effectiveName,
          type: widgetType, // Pass widgetType to C++
          savePath: effectivePath
        });

        return cleanObject({
          ...res,
          action: 'create_widget'
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Failed to create widget: ${msg}`,
          message: msg,
          action: 'create_widget'
        };
      }
    }
    case 'show_widget': {
      const widgetId = typeof (argsTyped as Record<string, unknown>).widgetId === 'string' 
        ? ((argsTyped as Record<string, unknown>).widgetId as string).trim() 
        : '';

      if (widgetId.toLowerCase() === 'notification') {
        const message = typeof (argsTyped as Record<string, unknown>).message === 'string'
          ? ((argsTyped as Record<string, unknown>).message as string).trim()
          : '';
        const text = message.length > 0 ? message : 'Notification';
        const duration = typeof (argsTyped as Record<string, unknown>).duration === 'number' 
          ? (argsTyped as Record<string, unknown>).duration as number 
          : undefined;

        try {
          const res = await tools.uiTools.showNotification({ text, duration }) as OperationResponse;
          const ok = res && res.success !== false;
          if (ok) {
            return {
              success: true,
              message: res.message || 'Notification shown',
              action: 'show_widget',
              widgetId,
              handled: true
            };
          }
          return cleanObject({
            success: false,
            error: res?.error || 'NOTIFICATION_FAILED',
            message: res?.message || 'Failed to show notification',
            action: 'show_widget',
            widgetId
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            error: 'NOTIFICATION_FAILED',
            message: msg,
            action: 'show_widget',
            widgetId
          };
        }
      }

      const widgetPath = (typeof argsTyped.widgetPath === 'string' ? argsTyped.widgetPath.trim() : '') 
        || (typeof argsTyped.name === 'string' ? argsTyped.name.trim() : '');
      if (!widgetPath) {
        return {
          success: false,
          error: 'INVALID_ARGUMENT',
          message: 'widgetPath (or name) is required to show a widget',
          action: 'show_widget',
          widgetId
        };
      }

      return cleanObject(await tools.uiTools.showWidget(widgetPath));
    }
    case 'add_widget_child': {
      const widgetPath = typeof argsTyped.widgetPath === 'string' ? argsTyped.widgetPath.trim() : '';
      const childClass = typeof argsTyped.childClass === 'string' ? argsTyped.childClass.trim() : '';
      const parentName = typeof argsTyped.parentName === 'string' ? argsTyped.parentName.trim() : undefined;

      if (!widgetPath || !childClass) {
        return {
          success: false,
          error: 'INVALID_ARGUMENT',
          message: 'widgetPath and childClass are required',
          action: 'add_widget_child'
        };
      }

      try {
        const res = await tools.uiTools.addWidgetComponent({
          widgetName: widgetPath,
          componentType: childClass,
          componentName: 'NewChild',
          slot: parentName ? { position: [0, 0] } : undefined
        });
        return cleanObject({
          ...res,
          action: 'add_widget_child'
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Failed to add widget child: ${msg}`,
          message: msg,
          action: 'add_widget_child'
        };
      }
    }
    case 'set_cvar': {
      // Accept multiple parameter names: name, cvar, key
      const nameVal = typeof argsTyped.name === 'string' && argsTyped.name.trim().length > 0
        ? argsTyped.name.trim()
        : '';
      const cvarVal = typeof (argsTyped as Record<string, unknown>).cvar === 'string'
        ? ((argsTyped as Record<string, unknown>).cvar as string).trim()
        : '';
      const keyVal = typeof argsTyped.key === 'string' ? argsTyped.key.trim() : '';
      const cmdVal = typeof argsTyped.command === 'string' ? argsTyped.command.trim() : '';
      
      const rawInput = nameVal || cvarVal || keyVal || cmdVal;

      // Some callers pass a full "cvar value" command string.
      const tokens = rawInput.split(/\s+/).filter(Boolean);
      const rawName = tokens[0] ?? '';

      if (!rawName) {
        return {
          success: false,
          error: 'INVALID_ARGUMENT',
          message: 'CVar name is required',
          action: 'set_cvar'
        };
      }

      const value = (argsTyped.value !== undefined && argsTyped.value !== null)
        ? argsTyped.value
        : (tokens.length > 1 ? tokens.slice(1).join(' ') : '');
      await tools.systemTools.executeConsoleCommand(`${rawName} ${value}`);
      return {
        success: true,
        message: `CVar ${rawName} set to ${value}`,
        action: 'set_cvar',
        cvar: rawName,
        value
      };
    }
    case 'get_project_settings': {
      const section = typeof argsTyped.category === 'string' && argsTyped.category.trim().length > 0
        ? argsTyped.category
        : argsTyped.section;
      const resp = await tools.systemTools.getProjectSettings(section) as OperationResponse;
      if (resp && resp.success && (resp.settings || resp.data || resp.result)) {
        return cleanObject({
          success: true,
          message: 'Project settings retrieved',
          settings: resp.settings || resp.data || resp.result,
          ...resp
        });
      }
      return cleanObject(resp);
    }
    case 'validate_assets': {
      const paths: string[] = Array.isArray((argsTyped as Record<string, unknown>).paths) 
        ? (argsTyped as Record<string, unknown>).paths as string[]
        : [];
      if (!paths.length) {
        return {
          success: false,
          error: 'INVALID_ARGUMENT',
          message: 'Please provide array of "paths" to validate assets.',
          action: 'validate_assets',
          results: []
        };
      }

      const results: AssetValidationResult[] = [];
      for (const rawPath of paths) {
        const assetPath = typeof rawPath === 'string' ? rawPath : String(rawPath ?? '');
        try {
          const res = await tools.assetTools.validate({ assetPath });
          // Extract error message from potentially complex error object
          let errorStr: string | null = null;
          if (res.error) {
            if (typeof res.error === 'string') {
              errorStr = res.error;
            } else if (typeof res.error === 'object' && res.error !== null && 'message' in res.error) {
              errorStr = String((res.error as { message: string }).message);
            } else {
              errorStr = String(res.error);
            }
          }
          results.push({ assetPath, success: res.success, error: errorStr });
        } catch (error) {
          results.push({
            assetPath,
            success: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      return {
        success: true,
        message: 'Asset validation completed',
        action: 'validate_assets',
        results
      };
    }
    case 'play_sound': {
      const soundPath = typeof (argsTyped as Record<string, unknown>).soundPath === 'string' 
        ? ((argsTyped as Record<string, unknown>).soundPath as string).trim() 
        : '';
      const volume = typeof (argsTyped as Record<string, unknown>).volume === 'number' 
        ? (argsTyped as Record<string, unknown>).volume as number 
        : undefined;
      const pitch = typeof (argsTyped as Record<string, unknown>).pitch === 'number' 
        ? (argsTyped as Record<string, unknown>).pitch as number 
        : undefined;

      // Volume 0 should behave as a silent, handled no-op
      if (typeof volume === 'number' && volume <= 0) {
        return {
          success: true,
          message: 'Sound request handled (volume is 0 - silent)',
          action: 'play_sound',
          soundPath,
          volume,
          pitch,
          handled: true
        };
      }

      try {
        const res = await tools.audioTools.playSound(soundPath, volume, pitch) as OperationResponse;
        if (!res || res.success === false) {
          const errText = String(res?.error || '').toLowerCase();
          const isMissingAsset = errText.includes('asset_not_found') || errText.includes('asset not found');

          if (isMissingAsset || !soundPath) {
            // Attempt fallback to a known engine sound
            const fallbackPath = '/Engine/EditorSounds/Notifications/CompileSuccess_Cue';
            if (soundPath !== fallbackPath) {
              const fallbackRes = await tools.audioTools.playSound(fallbackPath, volume, pitch) as OperationResponse;
              if (fallbackRes.success) {
                return {
                  success: true,
                  message: `Sound asset not found, played fallback sound: ${fallbackPath}`,
                  action: 'play_sound',
                  soundPath: fallbackPath,
                  originalPath: soundPath,
                  volume,
                  pitch
                };
              }
            }

            return {
              success: false,
              error: 'ASSET_NOT_FOUND',
              message: 'Sound asset not found (and fallback failed)',
              action: 'play_sound',
              soundPath,
              volume,
              pitch
            };
          }

          return cleanObject({
            success: false,
            error: res?.error || 'Failed to play 2D sound',
            action: 'play_sound',
            soundPath,
            volume,
            pitch
          });
        }

        return cleanObject({
          ...res,
          action: 'play_sound',
          soundPath,
          volume,
          pitch
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const lowered = msg.toLowerCase();
        const isMissingAsset = lowered.includes('asset_not_found') || lowered.includes('asset not found');

        if (isMissingAsset || !soundPath) {
          return {
            success: false,
            error: 'ASSET_NOT_FOUND',
            message: 'Sound asset not found',
            action: 'play_sound',
            soundPath,
            volume,
            pitch
          };
        }

        // Fallback: If asset not found, try playing default engine sound
        if (isMissingAsset) {
          const fallbackSound = '/Engine/EditorSounds/Notifications/CompileSuccess_Cue';
          try {
            const fallbackRes = await tools.audioTools.playSound(fallbackSound, volume, pitch) as OperationResponse;
            if (fallbackRes && fallbackRes.success) {
              return {
                success: true,
                message: `Original sound not found. Played fallback sound: ${fallbackSound}`,
                action: 'play_sound',
                soundPath,
                fallback: true,
                volume,
                pitch
              };
            }
          } catch (_fallbackErr) {
            // Ignore fallback failure and return original error
          }
        }

        return {
          success: false,
          error: `Failed to play 2D sound: ${msg}`,
          action: 'play_sound',
          soundPath,
          volume,
          pitch
        };
      }
    }
    case 'screenshot': {
      const includeMetadata = (argsTyped as Record<string, unknown>).includeMetadata === true;
      const filenameArg = typeof (argsTyped as Record<string, unknown>).filename === 'string' 
        ? (argsTyped as Record<string, unknown>).filename as string 
        : undefined;
      const metadata = (argsTyped as Record<string, unknown>).metadata;
      const resolution = (argsTyped as Record<string, unknown>).resolution;

      if (includeMetadata) {
        const baseName = filenameArg && filenameArg.trim().length > 0
          ? filenameArg.trim()
          : `Screenshot_${Date.now()}`;

        try {
          // Try to pass metadata to C++ screenshot handler
          const screenshotRes = await executeAutomationRequest(tools, 'control_editor', {
            action: 'screenshot',
            filename: baseName,
            resolution,
            metadata
          });
          const cleanedRes = typeof screenshotRes === 'object' && screenshotRes !== null ? screenshotRes : {};
          return cleanObject({
            ...cleanedRes,
            action: 'screenshot',
            filename: baseName,
            includeMetadata: true,
            metadata
          });
        } catch {
          // Fallback to standard screenshot
          await tools.editorTools.takeScreenshot(baseName);
        }

        return {
          success: true,
          message: `Metadata screenshot captured: ${baseName}`,
          filename: baseName,
          includeMetadata: true,
          metadata,
          action: 'screenshot',
          handled: true
        };
      }

      // Standard screenshot - pass all args through
      const res = await tools.editorTools.takeScreenshot(filenameArg, resolution as string | undefined);
      const cleanedStdRes = typeof res === 'object' && res !== null ? res : {};
      return cleanObject({
        ...cleanedStdRes,
        metadata,
        action: 'screenshot'
      });
    }
    case 'set_resolution': {
      const parseResolution = (value: unknown): { width?: number; height?: number } => {
        if (typeof value !== 'string') return {};
        const m = value.trim().match(/^(\d+)x(\d+)$/i);
        if (!m) return {};
        return { width: Number(m[1]), height: Number(m[2]) };
      };

      const parsed = parseResolution(argsTyped.resolution);
      const argsRecord = argsTyped as Record<string, unknown>;
      const width = Number.isFinite(Number(argsRecord.width)) ? Number(argsRecord.width) : (parsed.width ?? NaN);
      const height = Number.isFinite(Number(argsRecord.height)) ? Number(argsRecord.height) : (parsed.height ?? NaN);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Validation error: Invalid resolution: width and height must be positive numbers',
          action: 'set_resolution'
        };
      }
      const windowed = argsRecord.windowed !== false; // default to windowed=true
      const suffix = windowed ? 'w' : 'f';
      await tools.systemTools.executeConsoleCommand(`r.SetRes ${width}x${height}${suffix}`);
      return {
        success: true,
        message: `Resolution set to ${width}x${height} (${windowed ? 'windowed' : 'fullscreen'})`,
        action: 'set_resolution'
      };
    }
    case 'set_fullscreen': {
      const parseResolution = (value: unknown): { width?: number; height?: number } => {
        if (typeof value !== 'string') return {};
        const m = value.trim().match(/^(\d+)x(\d+)$/i);
        if (!m) return {};
        return { width: Number(m[1]), height: Number(m[2]) };
      };

      const parsed = parseResolution(argsTyped.resolution);
      const argsRecord = argsTyped as Record<string, unknown>;
      const width = Number.isFinite(Number(argsRecord.width)) ? Number(argsRecord.width) : (parsed.width ?? NaN);
      const height = Number.isFinite(Number(argsRecord.height)) ? Number(argsRecord.height) : (parsed.height ?? NaN);

      const windowed = argsRecord.windowed === true || argsTyped.enabled === false;
      const suffix = windowed ? 'w' : 'f';

      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        // If only toggling mode and no resolution provided, attempt a mode toggle.
        if (typeof argsRecord.windowed === 'boolean' || typeof argsTyped.enabled === 'boolean') {
          await tools.systemTools.executeConsoleCommand(`r.FullScreenMode ${windowed ? 1 : 0}`);
          return {
            success: true,
            message: `Fullscreen mode toggled (${windowed ? 'windowed' : 'fullscreen'})`,
            action: 'set_fullscreen',
            handled: true
          };
        }

        return {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid resolution: provide width/height or resolution like "1920x1080"',
          action: 'set_fullscreen'
        };
      }

      await tools.systemTools.executeConsoleCommand(`r.SetRes ${width}x${height}${suffix}`);
      return {
        success: true,
        message: `Fullscreen mode set to ${width}x${height} (${windowed ? 'windowed' : 'fullscreen'})`,
        action: 'set_fullscreen'
      };
    }
    case 'get_log':
    case 'read_log': {
      const params = normalizeArgs(args, [
        { key: 'lines', default: 100 },
        { key: 'filter' },
        { key: 'severity' },
      ]);

      const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'get_log',
        lines: extractOptionalNumber(params, 'lines') ?? 100,
        filter: extractOptionalString(params, 'filter'),
        severity: extractOptionalString(params, 'severity'),
      });

      return ResponseFactory.success(res, 'Retrieved log entries');
    }

    case 'cook_content': {
      // Cook content for the specified platform
      const platform = typeof (argsTyped as Record<string, unknown>).platform === 'string'
        ? ((argsTyped as Record<string, unknown>).platform as string).trim()
        : 'Win64';
      const maps = Array.isArray((argsTyped as Record<string, unknown>).maps)
        ? (argsTyped as Record<string, unknown>).maps as string[]
        : [];
      const iterative = (argsTyped as Record<string, unknown>).iterative !== false;

      const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'cook_content',
        platform,
        maps,
        iterative,
      }, 'Automation bridge not available for cook_content', { timeoutMs: 600000 }); // 10 min timeout for cooking

      const resObj = typeof res === 'object' && res !== null ? res as Record<string, unknown> : {};
      return cleanObject({
        ...resObj,
        action: 'cook_content',
        platform,
        maps,
        iterative,
      });
    }

    case 'package_project': {
      // Package the project for distribution
      const platform = typeof (argsTyped as Record<string, unknown>).platform === 'string'
        ? ((argsTyped as Record<string, unknown>).platform as string).trim()
        : 'Win64';
      const configuration = typeof (argsTyped as Record<string, unknown>).configuration === 'string'
        ? ((argsTyped as Record<string, unknown>).configuration as string).trim()
        : 'Development';
      const outputDir = typeof (argsTyped as Record<string, unknown>).outputDir === 'string'
        ? ((argsTyped as Record<string, unknown>).outputDir as string).trim()
        : undefined;
      const compress = (argsTyped as Record<string, unknown>).compress !== false;

      const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'package_project',
        platform,
        configuration,
        outputDir,
        compress,
      }, 'Automation bridge not available for package_project', { timeoutMs: 1800000 }); // 30 min timeout for packaging

      const resObj = typeof res === 'object' && res !== null ? res as Record<string, unknown> : {};
      return cleanObject({
        ...resObj,
        action: 'package_project',
        platform,
        configuration,
        outputDir,
        compress,
      });
    }

    // Transaction support for undo/redo grouping
    case 'begin_transaction': {
      const name = typeof argsTyped.name === 'string' ? argsTyped.name.trim() : '';
      const transactionName = name || 'MCP Transaction';
      const description = typeof (argsTyped as Record<string, unknown>).description === 'string'
        ? ((argsTyped as Record<string, unknown>).description as string).trim()
        : undefined;

      const res = await executeAutomationRequest(tools, 'control_editor', {
        subAction: 'begin_transaction',
        transactionName,
        description,
      });

      const resObj = typeof res === 'object' && res !== null ? res as Record<string, unknown> : {};
      return cleanObject({
        ...resObj,
        action: 'begin_transaction',
        transactionName,
      });
    }

    case 'commit_transaction':
    case 'end_transaction': {
      const res = await executeAutomationRequest(tools, 'control_editor', {
        subAction: 'commit_transaction',
      });

      const resObj = typeof res === 'object' && res !== null ? res as Record<string, unknown> : {};
      return cleanObject({
        ...resObj,
        action: 'commit_transaction',
      });
    }

    case 'rollback_transaction':
    case 'cancel_transaction': {
      const res = await executeAutomationRequest(tools, 'control_editor', {
        subAction: 'rollback_transaction',
      });

      const resObj = typeof res === 'object' && res !== null ? res as Record<string, unknown> : {};
      return cleanObject({
        ...resObj,
        action: 'rollback_transaction',
      });
    }

    case 'undo':
    case 'undo_last': {
      const count = typeof (argsTyped as Record<string, unknown>).count === 'number'
        ? Math.max(1, (argsTyped as Record<string, unknown>).count as number)
        : 1;

      const res = await executeAutomationRequest(tools, 'control_editor', {
        subAction: 'undo',
        count,
      });

      const resObj = typeof res === 'object' && res !== null ? res as Record<string, unknown> : {};
      return cleanObject({
        ...resObj,
        action: 'undo',
        requestedCount: count,
      });
    }

    case 'redo': {
      const count = typeof (argsTyped as Record<string, unknown>).count === 'number'
        ? Math.max(1, (argsTyped as Record<string, unknown>).count as number)
        : 1;

      const res = await executeAutomationRequest(tools, 'control_editor', {
        subAction: 'redo',
        count,
      });

      const resObj = typeof res === 'object' && res !== null ? res as Record<string, unknown> : {};
      return cleanObject({
        ...resObj,
        action: 'redo',
        requestedCount: count,
      });
    }

    case 'describe_capabilities':
    case 'get_capabilities':
    case 'capabilities': {
      const capabilities = {
        server: {
          name: 'unreal-engine-mcp-server',
          version: '0.6.0',
          features: [
            'transactions',
            'dryRun',
            'semanticMaterialGraph',
            'reparentMaterialInstance',
            'structuredErrors',
            'hotReload',
            'liveCoding',
            'headlessLaunch',
            'autoLaunch',
          ],
        },
        actions: {
          manage_asset: {
            subActions: [
              'list', 'delete', 'rename', 'move', 'duplicate',
              'exists', 'get_references', 'bulk_delete', 'bulk_rename',
            ],
            aliases: {
              paths: ['assetPaths', 'paths'],
              assetPath: ['assetPath', 'path'],
            },
          },
          manage_material_authoring: {
            subActions: [
              'create_material', 'create_material_instance', 'reparent_material_instance',
              'add_texture_sample', 'add_scalar_parameter', 'add_vector_parameter',
              'connect_nodes', 'disconnect_nodes', 'compile_material', 'get_material_info',
              'get_material_output_node', 'find_nodes',
            ],
            materialOutputPins: [
              'BaseColor', 'Metallic', 'Specular', 'Roughness', 'Normal',
              'EmissiveColor', 'Opacity', 'OpacityMask', 'AmbientOcclusion',
              'SubsurfaceColor', 'WorldPositionOffset',
            ],
          },
          control_editor: {
            subActions: [
              'begin_transaction', 'commit_transaction', 'rollback_transaction',
              'undo', 'redo', 'screenshot', 'execute_command',
            ],
          },
          system_control: {
            subActions: [
              'launch_editor', 'launch_headless', 'get_editor_status',
              'hot_reload', 'live_coding', 'compile_project', 'cook_content', 'package_project',
              'profile', 'show_fps', 'set_quality', 'screenshot', 'execute_command',
              'set_cvar', 'get_project_settings', 'execute_python',
            ],
            launchModes: ['editor', 'headless', 'game', 'server', 'commandlet'],
          },
        },
        errorCodes: {
          validation: ['INVALID_ARGUMENT', 'MISSING_REQUIRED', 'INVALID_PATH'],
          assets: ['ASSET_NOT_FOUND', 'ASSET_EXISTS', 'ASSET_IN_USE', 'DELETE_FAILED'],
          materials: ['MATERIAL_NOT_FOUND', 'NODE_NOT_FOUND', 'CONNECTION_FAILED', 'INVALID_PARENT'],
          system: ['BRIDGE_DISCONNECTED', 'TIMEOUT', 'VERSION_MISMATCH', 'COMPILATION_ERROR', 'ALREADY_COMPILING', 'LAUNCH_FAILED'],
        },
      };

      return cleanObject({
        success: true,
        message: 'Capabilities retrieved',
        action: 'describe_capabilities',
        capabilities,
      });
    }

    case 'compile_project': {
      // Compile/build the Unreal project using IDesktopPlatform
      const params = normalizeArgs(args, [
        { key: 'configuration', default: 'Development' },
        { key: 'platform', default: 'Win64' },
        { key: 'target', default: 'Editor' },
        { key: 'clean', default: false },
      ]);

      const configuration = extractOptionalString(params, 'configuration') ?? 'Development';
      const platform = extractOptionalString(params, 'platform') ?? 'Win64';
      const target = extractOptionalString(params, 'target') ?? 'Editor';
      const clean = params.clean === true || params.clean === 'true';

      const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'compile_project',
        configuration,
        platform,
        target,
        clean,
      });

      return ResponseFactory.success(res, 'Project compilation initiated');
    }

    // Hot reload / Live coding support for C++ code changes
    case 'hot_reload':
    case 'live_coding': {
      const params = normalizeArgs(args, [
        { key: 'waitForCompletion', default: true },
        { key: 'modules', default: [] },
      ]);

      const waitForCompletion = params.waitForCompletion !== false;
      const modules = Array.isArray(params.modules) ? params.modules as string[] : [];

      const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'hot_reload',
        waitForCompletion,
        modules,
      }) as OperationResponse;

      if (res.success === false) {
        return cleanObject({
          success: false,
          error: res.error ?? 'COMPILATION_ERROR',
          message: res.message ?? 'Hot reload failed',
          action: sysAction,
          ...res,
        });
      }

      return cleanObject({
        success: true,
        message: res.message ?? 'Hot reload completed',
        action: sysAction,
        ...res,
      });
    }

    // ============================================================================
    // EDITOR LAUNCH ACTIONS - For CI/CD automation and headless mode
    // ============================================================================
    case 'launch_editor':
    case 'launch_headless': {
      const argsRecord = args as Record<string, unknown>;

      // Extract project path (required)
      const projectPath = typeof argsRecord.projectPath === 'string' ? argsRecord.projectPath.trim() :
        typeof argsRecord.project === 'string' ? argsRecord.project.trim() :
        typeof argsRecord.uprojectPath === 'string' ? argsRecord.uprojectPath.trim() : '';

      if (!projectPath) {
        return {
          success: false,
          error: 'MISSING_REQUIRED',
          message: 'projectPath is required',
          action: sysAction
        };
      }

      // Validate the project path
      const validation = validateProjectPath(projectPath);
      if (!validation.valid) {
        return {
          success: false,
          error: 'INVALID_PATH',
          message: validation.error || 'Invalid project path',
          action: sysAction,
          projectPath
        };
      }

      // Extract optional parameters
      const mode = (typeof argsRecord.mode === 'string' ? argsRecord.mode.trim() :
        (sysAction === 'launch_headless' ? 'headless' : 'editor')) as LaunchMode;
      const additionalArgs = typeof argsRecord.additionalArgs === 'string' ? argsRecord.additionalArgs.trim() :
        typeof argsRecord.extraArgs === 'string' ? argsRecord.extraArgs.trim() :
        typeof argsRecord.args === 'string' ? argsRecord.args.trim() : '';
      const waitForReady = argsRecord.waitForReady !== false && argsRecord.waitForConnection !== false;
      const timeoutMs = typeof argsRecord.timeoutMs === 'number' ? argsRecord.timeoutMs :
        typeof argsRecord.timeout === 'number' ? argsRecord.timeout : 60000;
      const editorPath = typeof argsRecord.editorPath === 'string' ? argsRecord.editorPath.trim() :
        typeof argsRecord.unrealPath === 'string' ? argsRecord.unrealPath.trim() :
        typeof argsRecord.enginePath === 'string' ? argsRecord.enginePath.trim() : undefined;
      const commandletName = typeof argsRecord.commandletName === 'string' ? argsRecord.commandletName.trim() :
        typeof argsRecord.commandlet === 'string' ? argsRecord.commandlet.trim() : undefined;
      const commandletArgs = typeof argsRecord.commandletArgs === 'string' ? argsRecord.commandletArgs.trim() : undefined;

      // Validate mode
      const validModes = ['editor', 'headless', 'game', 'server', 'commandlet'];
      if (!validModes.includes(mode)) {
        return {
          success: false,
          error: 'INVALID_ARGUMENT',
          message: `Invalid mode '${mode}'. Valid modes: ${validModes.join(', ')}`,
          action: sysAction,
          mode
        };
      }

      // Commandlet mode requires a commandlet name
      if (mode === 'commandlet' && !commandletName) {
        return {
          success: false,
          error: 'MISSING_REQUIRED',
          message: 'commandletName is required when mode is "commandlet"',
          action: sysAction,
          mode
        };
      }

      try {
        // Launch the editor
        const result = await launchEditor({
          projectPath,
          mode,
          additionalArgs,
          editorPath,
          commandletName,
          commandletArgs,
          detached: true
        });

        // If requested, wait for the MCP connection to be established
        if (waitForReady && mode !== 'commandlet') {
          try {
            // Use the automation bridge to check connection status
            const bridge = tools.automationBridge;
            if (bridge && typeof bridge.isConnected === 'function') {
              await waitForEditorReady(
                timeoutMs,
                2000,
                () => bridge.isConnected()
              );
            }
          } catch (waitError) {
            // Editor launched but connection not established
            const errMsg = waitError instanceof Error ? waitError.message : String(waitError);
            return cleanObject({
              success: true,
              warning: `Editor launched but MCP connection not established: ${errMsg}`,
              message: 'Editor process started, but MCP connection timed out',
              action: sysAction,
              pid: result.pid,
              command: result.command,
              args: result.args,
              mode,
              projectPath,
              connectionEstablished: false
            });
          }
        }

        return cleanObject({
          success: true,
          message: `Unreal Editor launched successfully in ${mode} mode`,
          action: sysAction,
          pid: result.pid,
          command: result.command,
          args: result.args,
          mode,
          projectPath,
          connectionEstablished: waitForReady && mode !== 'commandlet'
        });

      } catch (launchError) {
        const errMsg = launchError instanceof Error ? launchError.message : String(launchError);
        return {
          success: false,
          error: 'LAUNCH_FAILED',
          message: `Failed to launch editor: ${errMsg}`,
          action: sysAction,
          mode,
          projectPath
        };
      }
    }

    case 'get_editor_status': {
      // Return the current status of the automation bridge connection
      const bridge = tools.automationBridge;
      if (!bridge) {
        return {
          success: true,
          message: 'Automation bridge not configured',
          action: 'get_editor_status',
          connected: false,
          status: null
        };
      }

      const isConnected = typeof bridge.isConnected === 'function' ? bridge.isConnected() : false;
      const status = typeof bridge.getStatus === 'function' ? bridge.getStatus() : null;

      return cleanObject({
        success: true,
        message: isConnected ? 'Editor is connected' : 'Editor is not connected',
        action: 'get_editor_status',
        connected: isConnected,
        status
      });
    }

    // ============================================================================
    // PIE DIAGNOSTICS - Runtime state queries during Play-In-Editor
    // ============================================================================
    case 'get_player_state': {
      // Get current player state during PIE (position, rotation, velocity, movement info)
      const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'get_player_state',
      });
      return ResponseFactory.success(res, 'Player state retrieved');
    }

    case 'get_pie_status': {
      // Get PIE session status (playing, paused, time info)
      const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'get_pie_status',
      });
      return ResponseFactory.success(res, 'PIE status retrieved');
    }

    case 'inspect_actor': {
      // Inspect actor properties at runtime during PIE
      const params = normalizeArgs(args, [
        { key: 'actorName' },
        { key: 'includeComponents', default: true },
      ]);

      const actorName = extractOptionalString(params, 'actorName');
      if (!actorName) {
        return ResponseFactory.error('actorName is required', 'MISSING_REQUIRED');
      }

      const includeComponents = params.includeComponents !== false;

      const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'inspect_actor',
        actorName,
        includeComponents,
      });

      return ResponseFactory.success(res, 'Actor inspected');
    }

    case 'get_component_state': {
      // Get detailed state of a specific component on an actor during runtime
      const params = normalizeArgs(args, [
        { key: 'actorName' },
        { key: 'componentName' },
      ]);

      const actorName = extractOptionalString(params, 'actorName');
      const componentName = extractOptionalString(params, 'componentName');

      if (!actorName) {
        return ResponseFactory.error('actorName is required', 'MISSING_REQUIRED');
      }
      if (!componentName) {
        return ResponseFactory.error('componentName is required', 'MISSING_REQUIRED');
      }

      const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'get_component_state',
        actorName,
        componentName,
      });

      return ResponseFactory.success(res, 'Component state retrieved');
    }

    case 'execute_python':
    case 'run_python': {
      const params = normalizeArgs(args, [
        { key: 'scriptPath' },
        { key: 'scriptContent' },
        { key: 'args', default: [] },
      ]);

      const scriptPath = extractOptionalString(params, 'scriptPath');
      const scriptContent = extractOptionalString(params, 'scriptContent');

      if (!scriptPath && !scriptContent) {
        return ResponseFactory.error('Either scriptPath or scriptContent is required', 'MISSING_REQUIRED');
      }

      const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'execute_python',
        scriptPath,
        scriptContent,
        args: params.args,
      });

      const resObj = typeof res === 'object' && res !== null ? res as Record<string, unknown> : {};
      return cleanObject({
        ...resObj,
        action: 'execute_python',
      });
    }

    default: {
      const res = await executeAutomationRequest(tools, 'system_control', args, 'Automation bridge not available for system control operations');
      return cleanObject(res) as Record<string, unknown>;
    }
  }
}

export async function handleConsoleCommand(args: HandlerArgs, tools: ITools): Promise<Record<string, unknown>> {
  const rawCommand = typeof args?.command === 'string' ? args.command : '';
  const trimmed = rawCommand.trim();

  if (!trimmed) {
    return cleanObject({
      success: false,
      error: 'EMPTY_COMMAND',
      message: 'Console command is empty',
      command: rawCommand
    });
  }

  const res = await executeAutomationRequest(
    tools,
    'console_command',
    { ...args, command: trimmed },
    'Automation bridge not available for console command operations'
  );
  return cleanObject(res) as Record<string, unknown>;
}
