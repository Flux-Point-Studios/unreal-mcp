/**
 * MCP Server Instructions
 *
 * Sent once at connection time via the `InitializeResult.instructions` field.
 * Gives connected AI clients guidance on the action-based dispatch pattern,
 * available tools, resources, and prompt templates.
 */

export const SERVER_INSTRUCTIONS = `
# Unreal Engine MCP Server

This server controls a live Unreal Editor instance. All 40 tools use an **action-based dispatch pattern**: each tool accepts an \`action\` enum that selects the operation, plus action-specific parameters. Always check a tool's \`action\` enum before calling it.

## Quick Start
- Use the \`workflow\` tool first for common multi-step tasks (performance audits, blueprint checks, scene population, quick tests).
- Check \`prompts/list\` for 12 step-by-step workflow templates before building sequences manually.
- Use \`manage_tools\` to enable/disable tool categories and reduce noise.

## Tools by Category

**Scene & Actors**
- \`control_actor\` — spawn, move, rotate, scale, delete, get/set properties, attach, set visibility/mobility
- \`manage_level\` — load, save, list actors, get level info, stream levels
- \`manage_level_structure\` — sub-levels, level instances, world partition
- \`build_environment\` — landscape, foliage, sky/atmosphere, weather
- \`manage_volumes\` — blocking, trigger, physics, audio, post-process volumes

**Editor & Viewport**
- \`control_editor\` — PIE play/stop, save, capture_viewport (screenshot), undo/redo, focus actor, editor preferences
- \`inspect\` — get details, search, class hierarchy, memory stats, object references

**Blueprints & Code**
- \`manage_blueprint\` — create, add nodes, connect_pins, compile, get graph, add variables/functions/events
- \`manage_game_framework\` — game mode, game state, player controller, HUD, game instance

**Assets & Materials**
- \`manage_asset\` — import, create, delete, rename, move, duplicate, list, get info, bulk operations
- \`manage_material_authoring\` — create materials, add expressions, connect, set parameters, material instances
- \`manage_texture\` — import, resize, set compression, create render targets
- \`asset_pipeline\` — AI-powered 3D model/texture generation via Meshy and Tripo APIs

**Animation & Physics**
- \`animation_physics\` — play montage, set anim mode, physics simulation, blend spaces, anim notify
- \`manage_skeleton\` — skeleton management, bone transforms, sockets, retargeting
- \`manage_character\` — character movement, capsule, mesh, character defaults

**Visual Effects & Audio**
- \`manage_effect\` — Niagara particle systems, cascade, decals
- \`manage_lighting\` — point/spot/directional/rect lights, sky light, light parameters
- \`manage_audio\` — sound cues, attenuation, ambient sounds, audio volumes

**UI**
- \`manage_widget_authoring\` — UMG widgets, buttons, text, images, layout
- \`manage_input\` — Enhanced Input actions, mappings, input contexts

**Gameplay Systems**
- \`manage_gas\` — Gameplay Ability System: abilities, effects, attribute sets, gameplay cues
- \`manage_combat\` — damage system, hit detection, projectiles
- \`manage_ai\` — behavior trees (see also \`manage_behavior_tree\`), blackboard, AI perception, EQS
- \`manage_behavior_tree\` — BT nodes, decorators, services, tasks
- \`manage_inventory\` — inventory components, items, stacking, equipment
- \`manage_interaction\` — interaction components, interactables, prompts

**Networking & Sessions**
- \`manage_networking\` — replication, RPCs, net relevancy
- \`manage_sessions\` — online sessions, matchmaking, lobbies

**Geometry & Splines**
- \`manage_geometry\` — procedural mesh, static mesh operations
- \`manage_splines\` — spline components, spline meshes, landscaping splines

**Sequences**
- \`manage_sequence\` — Level Sequencer tracks, keyframes, playback

**Navigation**
- \`manage_navigation\` — nav mesh, nav modifiers, pathfinding

**Performance & Testing**
- \`manage_performance\` — stat commands, profiling, benchmarks, GPU/CPU metrics
- \`manage_tests\` — run UE automation tests, list tests, get results

**System & Orchestration**
- \`system_control\` — console commands, project settings, execute scripts (Python, console batch, editor utility), script history
- \`manage_tasks\` — async task queue: submit long operations, check status, get results
- \`manage_tools\` — enable/disable tool categories to reduce tool count
- \`workflow\` — composite operations: level_performance_audit, blueprint_health_check, scene_populate, quick_test
- \`manage_pipeline\` — asset build pipeline configuration

## Resources

**Static** — read with \`resources/read\`:
- \`ue://assets\` — all project assets
- \`ue://actors\` — all actors in current level
- \`ue://level\` — current level info
- \`ue://health\` — server connection status
- \`ue://automation-bridge\` — bridge status
- \`ue://version\` — UE version info
- \`ue5-docs://{category}\` — curated UE5 docs (blueprint, animation, actor, materials, niagara, enhanced-input, networking, gas, world-building, sequencer)

**Templates** — parameterized lookups:
- \`ue://actor/{actorPath}\` — specific actor details
- \`ue://blueprint/{className}\` — blueprint class info
- \`ue://asset/{assetPath}\` — asset metadata
- \`ue://class/{className}\` — class hierarchy
- \`ue://level/{levelPath}\` — specific level info
- \`ue://console/{command}\` — run a console command

## Prompt Templates

Use \`prompts/get\` with these names for guided step-by-step workflows:
create-playable-character, setup-gas-ability, create-multiplayer-lobby, level-performance-audit, setup-material-instance, create-ai-npc, blueprint-health-check, setup-niagara-effect, create-ui-widget, setup-enhanced-input, create-save-system, setup-inventory-system

## Tips
- Every tool returns structured JSON. Check the \`success\` field first.
- Resource subscriptions are supported — subscribe to \`ue://actors\` etc. for live updates.
- \`capture_viewport\` on \`control_editor\` returns a base64 screenshot — useful after visual changes.
- Visual feedback is auto-appended to responses from visual tools (actor, lighting, materials, etc.).
- For AI-generated 3D assets, use \`asset_pipeline\` with a Meshy or Tripo API key.
`.trim();
