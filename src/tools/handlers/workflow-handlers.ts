/**
 * Location: src/tools/handlers/workflow-handlers.ts
 *
 * Composite workflow handler that chains multiple existing tool actions into
 * cohesive, higher-level workflows. Each workflow calls several underlying
 * MCP tools (via executeAutomationRequest) and aggregates results into a
 * single structured report.
 *
 * Actions:
 *   - level_performance_audit  -- Comprehensive level analysis (scene stats,
 *     actor summary, perf frame capture, lighting status, recommendations).
 *   - blueprint_health_check   -- Inspects and compiles a blueprint, producing
 *     a health report with warnings and recommendations.
 *   - scene_populate           -- Fills a bounding box with randomised actors
 *     using the provided mesh asset paths.
 *   - quick_test               -- Smoke-tests the current level by gathering
 *     info, starting PIE, and capturing the viewport.
 *
 * Used by: consolidated-tool-handlers.ts (registered as the 'workflow' tool).
 * Depends on: common-handlers.ts (executeAutomationRequest), logger.
 */

import { ITools } from '../../types/tool-interfaces.js';
import { executeAutomationRequest } from './common-handlers.js';
import { Logger } from '../../utils/logger.js';

const log = new Logger('WorkflowHandlers');

/** Convenience alias for handler argument maps. */
type HandlerArgs = Record<string, unknown>;

/**
 * Optional progress reporter that some ITools implementations expose.
 * We access it defensively since the interface uses an index signature.
 */
interface ProgressReporter {
  report: (current: number, total: number, message?: string) => Promise<void>;
}

/**
 * Safely retrieve the progress reporter from the tools bag, if present.
 */
function getProgressReporter(tools: ITools): ProgressReporter | undefined {
  const candidate = (tools as Record<string, unknown>).progressReporter;
  if (
    candidate &&
    typeof candidate === 'object' &&
    typeof (candidate as ProgressReporter).report === 'function'
  ) {
    return candidate as ProgressReporter;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Entry point for the composite workflow tool.
 *
 * @param action - One of the supported workflow action names.
 * @param args   - Action-specific arguments.
 * @param tools  - Injected tool dependencies (automation bridge, etc.).
 * @returns A structured result object with { success, workflow, ... }.
 */
export async function handleWorkflowTools(
  action: string,
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  switch (action) {
    case 'level_performance_audit':
      return await levelPerformanceAudit(args, tools);
    case 'blueprint_health_check':
      return await blueprintHealthCheck(args, tools);
    case 'scene_populate':
      return await scenePopulate(args, tools);
    case 'quick_test':
      return await quickTest(args, tools);
    default:
      return { success: false, error: `Unknown workflow action: ${action}` };
  }
}

// ---------------------------------------------------------------------------
// level_performance_audit
// ---------------------------------------------------------------------------

/**
 * Chains level info, scene stats, actor listing, performance frame capture,
 * and lighting build status into a single audit report with recommendations.
 *
 * Every step is wrapped in try/catch so partial results are returned even
 * when individual sub-calls fail (e.g. the automation bridge may not support
 * every action in every project configuration).
 */
async function levelPerformanceAudit(
  _args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  const recommendations: string[] = [];
  const progress = getProgressReporter(tools);

  // Step 1: Level info
  await progress?.report(1, 6, 'Getting level info...');
  try {
    results.levelInfo = await executeAutomationRequest(
      tools,
      'manage_level',
      { action: 'get_level_info' },
      'Failed to get level info'
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Level info: ${msg}`);
    log.warn(`level_performance_audit step 1 failed: ${msg}`);
  }

  // Step 2: Scene stats
  await progress?.report(2, 6, 'Gathering scene statistics...');
  try {
    results.sceneStats = await executeAutomationRequest(
      tools,
      'inspect',
      { action: 'get_scene_stats' },
      'Failed to get scene stats'
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Scene stats: ${msg}`);
    log.warn(`level_performance_audit step 2 failed: ${msg}`);
  }

  // Step 3: Actor summary
  await progress?.report(3, 6, 'Analyzing actors...');
  try {
    results.actors = await executeAutomationRequest(
      tools,
      'inspect',
      { action: 'list_actors' },
      'Failed to list actors'
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Actor list: ${msg}`);
    log.warn(`level_performance_audit step 3 failed: ${msg}`);
  }

  // Step 4: Performance stats
  await progress?.report(4, 6, 'Capturing performance frame...');
  try {
    results.perfStats = await executeAutomationRequest(
      tools,
      'manage_performance',
      { action: 'capture_stat_frame' },
      'Failed to capture stats'
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Perf stats: ${msg}`);
    log.warn(`level_performance_audit step 4 failed: ${msg}`);
  }

  // Step 5: Lighting build status
  await progress?.report(5, 6, 'Checking lighting status...');
  try {
    results.lighting = await executeAutomationRequest(
      tools,
      'manage_lighting',
      { action: 'get_light_build_info' },
      'Failed to get light info'
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Lighting: ${msg}`);
    log.warn(`level_performance_audit step 5 failed: ${msg}`);
  }

  // Step 6: Generate recommendations from the gathered data
  await progress?.report(6, 6, 'Generating audit report...');

  const actorResult = results.actors as Record<string, unknown> | undefined;
  const actorCount = actorResult?.actorCount ?? actorResult?.count;
  if (typeof actorCount === 'number' && actorCount > 1000) {
    recommendations.push(
      `High actor count (${actorCount}). Consider using Level Streaming or World Partition to reduce in-memory actors.`
    );
  }

  const sceneStats = results.sceneStats as Record<string, unknown> | undefined;
  const triangleCount = sceneStats?.triangleCount ?? sceneStats?.triangles;
  if (typeof triangleCount === 'number' && triangleCount > 5_000_000) {
    recommendations.push(
      `High triangle count (${triangleCount.toLocaleString()}). Consider enabling Nanite or reducing mesh complexity.`
    );
  }

  const lightingResult = results.lighting as Record<string, unknown> | undefined;
  if (lightingResult?.needsRebuild === true) {
    recommendations.push(
      'Lighting needs rebuilding. Run a lighting build to improve visual quality and bake performance.'
    );
  }

  log.info(
    `level_performance_audit complete: ${errors.length} errors, ${recommendations.length} recommendations`
  );

  return {
    success: true,
    workflow: 'level_performance_audit',
    ...results,
    errors: errors.length > 0 ? errors : undefined,
    recommendations,
    summary: `Audit complete. ${errors.length} error(s), ${recommendations.length} recommendation(s).`
  };
}

// ---------------------------------------------------------------------------
// blueprint_health_check
// ---------------------------------------------------------------------------

/**
 * Inspects a blueprint's info, graph details, and compilation result to
 * produce a health report. Identifies common issues such as large
 * EventGraphs and compilation failures.
 *
 * @param args.blueprint_name - Required. The name of the blueprint to check.
 */
async function blueprintHealthCheck(
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const blueprintName = args.blueprint_name as string | undefined;
  if (!blueprintName) {
    return { success: false, error: 'blueprint_name is required for blueprint_health_check' };
  }

  const results: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];
  const progress = getProgressReporter(tools);

  // Step 1: Get blueprint info
  await progress?.report(1, 4, `Getting blueprint info for ${blueprintName}...`);
  try {
    results.blueprintInfo = await executeAutomationRequest(
      tools,
      'manage_blueprint',
      { action: 'get_blueprint', blueprint_name: blueprintName },
      'Failed to get blueprint'
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Blueprint info: ${msg}`);
    log.warn(`blueprint_health_check step 1 failed: ${msg}`);
  }

  // Step 2: Get graph details (EventGraph)
  await progress?.report(2, 4, 'Analyzing graphs...');
  try {
    results.graphDetails = await executeAutomationRequest(
      tools,
      'manage_blueprint',
      { action: 'get_graph_details', blueprint_name: blueprintName, graph_name: 'EventGraph' },
      'Failed to get graph details'
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Graph details: ${msg}`);
    log.warn(`blueprint_health_check step 2 failed: ${msg}`);
  }

  // Step 3: Compile the blueprint
  await progress?.report(3, 4, 'Compiling blueprint...');
  try {
    results.compileResult = await executeAutomationRequest(
      tools,
      'manage_blueprint',
      { action: 'compile', blueprint_name: blueprintName },
      'Failed to compile blueprint'
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Compilation: ${msg}`);
    log.warn(`blueprint_health_check step 3 failed: ${msg}`);
  }

  // Step 4: Analyse results and produce warnings
  await progress?.report(4, 4, 'Generating health report...');

  const compileResult = results.compileResult as Record<string, unknown> | undefined;
  if (compileResult?.warnings) {
    warnings.push('Compilation produced warnings.');
  }
  if (compileResult?.success === false) {
    warnings.push('Blueprint failed to compile.');
  }

  const graphDetails = results.graphDetails as Record<string, unknown> | undefined;
  const nodeCount = graphDetails?.nodeCount ?? graphDetails?.node_count;
  if (typeof nodeCount === 'number' && nodeCount > 200) {
    warnings.push(
      `EventGraph has ${nodeCount} nodes. Consider splitting logic into functions for maintainability.`
    );
  }

  const graphCount = (results.blueprintInfo as Record<string, unknown> | undefined)?.graphCount;
  if (typeof graphCount === 'number' && graphCount > 10) {
    warnings.push(
      `Blueprint has ${graphCount} graphs. Review whether all are necessary.`
    );
  }

  log.info(
    `blueprint_health_check for ${blueprintName}: ${warnings.length} warnings, ${errors.length} errors`
  );

  return {
    success: true,
    workflow: 'blueprint_health_check',
    blueprintName,
    ...results,
    warnings,
    errors: errors.length > 0 ? errors : undefined,
    healthy: warnings.length === 0 && errors.length === 0,
    summary: `Health check complete. ${warnings.length} warning(s), ${errors.length} error(s).`
  };
}

// ---------------------------------------------------------------------------
// scene_populate
// ---------------------------------------------------------------------------

/**
 * Fills a bounding box with actors, cycling through the supplied mesh asset
 * paths. Supports random yaw rotation and random uniform scaling.
 *
 * @param args.origin            - [x,y,z] centre of the bounding box.
 * @param args.extent            - [x,y,z] half-extents of the bounding box.
 * @param args.asset_paths       - Array of static mesh asset paths to cycle.
 * @param args.count             - Number of actors to place (default 10).
 * @param args.random_rotation   - Apply random Y-axis rotation (default true).
 * @param args.random_scale_range - [min, max] uniform scale range (default [0.8, 1.2]).
 */
async function scenePopulate(
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const origin = args.origin as [number, number, number] | undefined;
  const extent = args.extent as [number, number, number] | undefined;
  const assetPaths = args.asset_paths as string[] | undefined;
  const count = typeof args.count === 'number' && args.count > 0 ? args.count : 10;
  const randomRotation = args.random_rotation !== false; // default true
  const scaleRange = (args.random_scale_range as [number, number]) || [0.8, 1.2];

  // Validate required params
  if (!origin || !Array.isArray(origin) || origin.length < 3) {
    return { success: false, error: 'Required: origin [x, y, z] (center of area to populate)' };
  }
  if (!extent || !Array.isArray(extent) || extent.length < 3) {
    return { success: false, error: 'Required: extent [x, y, z] (half-extents of bounding box)' };
  }
  if (!assetPaths || !Array.isArray(assetPaths) || assetPaths.length === 0) {
    return { success: false, error: 'Required: asset_paths (non-empty array of static mesh asset paths)' };
  }

  // Clamp count to a sensible maximum to avoid runaway requests
  const maxCount = 500;
  const effectiveCount = Math.min(count, maxCount);
  if (count > maxCount) {
    log.warn(`scene_populate: count ${count} clamped to maximum ${maxCount}`);
  }

  const progress = getProgressReporter(tools);
  const created: Record<string, unknown>[] = [];
  let failedCount = 0;

  for (let i = 0; i < effectiveCount; i++) {
    // Report progress every actor (or at reasonable intervals for large counts)
    if (i % 10 === 0 || i === effectiveCount - 1) {
      await progress?.report(i + 1, effectiveCount, `Placing actor ${i + 1}/${effectiveCount}...`);
    }

    // Random position within the bounding box
    const x = origin[0] + (Math.random() * 2 - 1) * extent[0];
    const y = origin[1] + (Math.random() * 2 - 1) * extent[1];
    const z = origin[2] + (Math.random() * 2 - 1) * extent[2];

    // Cycle through asset paths
    const mesh = assetPaths[i % assetPaths.length];

    // Random yaw rotation if enabled
    const rot = randomRotation ? [0, Math.random() * 360, 0] : [0, 0, 0];

    // Random uniform scale within the provided range
    const scale =
      scaleRange[0] + Math.random() * (scaleRange[1] - scaleRange[0]);

    try {
      const result = await executeAutomationRequest(
        tools,
        'control_actor',
        {
          action: 'create_actor',
          actor_class: 'StaticMeshActor',
          location: [x, y, z],
          rotation: rot,
          scale: [scale, scale, scale],
          static_mesh: mesh,
          actor_name: `Populated_${i}`
        },
        `Failed to create actor ${i}`
      );
      created.push({ index: i, mesh, location: [x, y, z], result });
    } catch (e) {
      failedCount++;
      log.debug(`scene_populate: failed to create actor ${i}: ${e}`);
    }
  }

  log.info(`scene_populate: placed ${created.length}/${effectiveCount}, ${failedCount} failed`);

  return {
    success: true,
    workflow: 'scene_populate',
    created: created.length,
    failed: failedCount,
    total: effectiveCount,
    boundingBox: { origin, extent },
    assets: assetPaths,
    actors: created,
    summary: `Placed ${created.length}/${effectiveCount} actors. ${failedCount} failed.`
  };
}

// ---------------------------------------------------------------------------
// quick_test
// ---------------------------------------------------------------------------

/**
 * Basic smoke test for the current level:
 * 1. Get level info.
 * 2. Count actors.
 * 3. Start PIE (Play In Editor).
 * 4. Capture viewport for visual verification.
 *
 * All steps are non-fatal: individual failures are recorded in the results
 * object rather than aborting the whole workflow.
 */
async function quickTest(
  _args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const progress = getProgressReporter(tools);

  // Step 1: Level info
  await progress?.report(1, 4, 'Getting level info...');
  try {
    results.levelInfo = await executeAutomationRequest(
      tools,
      'manage_level',
      { action: 'get_level_info' },
      'Failed to get level info'
    );
  } catch (e) {
    results.levelInfo = { error: e instanceof Error ? e.message : String(e) };
  }

  // Step 2: Actor count
  await progress?.report(2, 4, 'Counting actors...');
  try {
    results.actors = await executeAutomationRequest(
      tools,
      'inspect',
      { action: 'list_actors' },
      'Failed to list actors'
    );
  } catch (e) {
    results.actors = { error: e instanceof Error ? e.message : String(e) };
  }

  // Step 3: Start PIE
  await progress?.report(3, 4, 'Starting Play In Editor...');
  try {
    results.pie = await executeAutomationRequest(
      tools,
      'control_editor',
      { action: 'play' },
      'Failed to start PIE'
    );
  } catch (e) {
    results.pie = { error: e instanceof Error ? e.message : String(e) };
  }

  // Step 4: Capture viewport (acts as both a brief wait and visual check)
  await progress?.report(4, 4, 'Capturing viewport...');
  try {
    const bridge = tools.automationBridge;
    if (bridge && typeof bridge.sendAutomationRequest === 'function') {
      const capture = await bridge.sendAutomationRequest(
        'control_editor',
        {
          action: 'capture_viewport',
          width: 800,
          height: 450,
          format: 'jpeg',
          quality: 80
        },
        { timeoutMs: 8000 }
      );

      const captureResult = capture as Record<string, unknown>;
      if (captureResult?.base64Data) {
        results.viewport = {
          captured: true,
          mimeType: captureResult.mimeType || 'image/jpeg',
          base64Data: captureResult.base64Data
        };
      } else {
        results.viewport = { captured: false, note: 'No base64 data returned' };
      }
    } else {
      results.viewport = { captured: false, error: 'Automation bridge not available' };
    }
  } catch (e) {
    results.viewport = { captured: false, error: e instanceof Error ? e.message : String(e) };
  }

  log.info('quick_test complete');

  return {
    success: true,
    workflow: 'quick_test',
    ...results,
    summary:
      'Quick test complete. Check results for level info, actor count, PIE status, and viewport capture.'
  };
}
