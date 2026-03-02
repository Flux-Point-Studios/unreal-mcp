/**
 * src/prompts/index.ts
 *
 * MCP Prompts module for Unreal Engine workflows.
 *
 * Exports an array of prompt templates that guide AI assistants through
 * common Unreal Engine development workflows using the MCP tools exposed
 * by this server. Each prompt includes parametric arguments (using
 * {{paramName}} substitution syntax) and step-by-step messages that
 * reference specific MCP tool names and actions.
 *
 * Used by: src/server-setup.ts -- registered via ListPromptsRequestSchema
 * and GetPromptRequestSchema handlers so that MCP clients can discover
 * and invoke these workflow templates.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text';
    text: string;
  };
}

export interface PromptTemplate {
  name: string;
  description: string;
  arguments: PromptArgument[];
  messages: PromptMessage[];
}

// ---------------------------------------------------------------------------
// Prompt Definitions
// ---------------------------------------------------------------------------

export const prompts: PromptTemplate[] = [

  // -----------------------------------------------------------------------
  // 1. create-playable-character
  // -----------------------------------------------------------------------
  {
    name: 'create-playable-character',
    description: 'Set up a playable character Blueprint with movement component, spring-arm camera, capsule collision, and Enhanced Input bindings.',
    arguments: [
      { name: 'characterName', description: 'Name for the character Blueprint (e.g. BP_PlayerCharacter)', required: true },
      { name: 'savePath', description: 'Content-browser path to save into (e.g. /Game/Blueprints/Characters)', required: true },
      { name: 'skeletalMeshPath', description: 'Path to the skeletal mesh asset (optional, leave blank to skip)', required: false },
      { name: 'walkSpeed', description: 'Max walk speed in cm/s (default: 600)', required: false },
      { name: 'jumpHeight', description: 'Jump Z velocity in cm/s (default: 420)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create a fully playable third-person character called "{{characterName}}" saved at "{{savePath}}".

Requirements:
- Skeletal mesh: {{skeletalMeshPath}}
- Walk speed: {{walkSpeed}} cm/s
- Jump height: {{jumpHeight}} cm/s
- Third-person camera on a spring arm with camera lag
- Enhanced Input for Move, Look, and Jump actions`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will set up the playable character step by step using our MCP tools.

## Step 1 -- Create the Character Blueprint

Use \`manage_character\` with action \`create_character_blueprint\`:
- name: "{{characterName}}"
- path: "{{savePath}}"
- parentClass: "Character"
- save: true

## Step 2 -- Configure the Capsule Component

Use \`manage_character\` with action \`configure_capsule_component\`:
- blueprintPath: "{{savePath}}/{{characterName}}"
- capsuleRadius: 34
- capsuleHalfHeight: 88

## Step 3 -- Assign the Skeletal Mesh

If a skeletal mesh path was provided, use \`manage_character\` with action \`configure_mesh_component\`:
- blueprintPath: "{{savePath}}/{{characterName}}"
- skeletalMeshPath: "{{skeletalMeshPath}}"
- meshOffset: { x: 0, y: 0, z: -88 }
- meshRotation: { pitch: 0, yaw: -90, roll: 0 }

## Step 4 -- Add Spring Arm and Camera

Use \`manage_character\` with action \`configure_camera_component\`:
- blueprintPath: "{{savePath}}/{{characterName}}"
- springArmLength: 300
- springArmLagEnabled: true
- springArmLagSpeed: 10
- cameraUsePawnControlRotation: true

## Step 5 -- Configure Movement Speeds

Use \`manage_character\` with action \`configure_movement_speeds\`:
- blueprintPath: "{{savePath}}/{{characterName}}"
- walkSpeed: {{walkSpeed}}
- runSpeed: 600
- acceleration: 2048
- deceleration: 2048
- groundFriction: 8

## Step 6 -- Configure Jump

Use \`manage_character\` with action \`configure_jump\`:
- blueprintPath: "{{savePath}}/{{characterName}}"
- jumpHeight: {{jumpHeight}}
- airControl: 0.2
- gravityScale: 1.0

## Step 7 -- Configure Rotation

Use \`manage_character\` with action \`configure_rotation\`:
- blueprintPath: "{{savePath}}/{{characterName}}"
- orientToMovement: true
- useControllerRotationYaw: false
- rotationRate: 540

## Step 8 -- Create Enhanced Input Actions

Use \`manage_input\` with action \`create_input_action\` three times:
1. name: "IA_Move", path: "{{savePath}}/Input"
2. name: "IA_Look", path: "{{savePath}}/Input"
3. name: "IA_Jump", path: "{{savePath}}/Input"

## Step 9 -- Create Input Mapping Context

Use \`manage_input\` with action \`create_input_mapping_context\`:
- name: "IMC_Default"
- path: "{{savePath}}/Input"

## Step 10 -- Map Keys to Actions

Use \`manage_input\` with action \`add_mapping\` for each binding:
1. contextPath: "{{savePath}}/Input/IMC_Default", actionPath: "{{savePath}}/Input/IA_Move", key: "W"
2. contextPath: "{{savePath}}/Input/IMC_Default", actionPath: "{{savePath}}/Input/IA_Look", key: "Mouse2D"
3. contextPath: "{{savePath}}/Input/IMC_Default", actionPath: "{{savePath}}/Input/IA_Jump", key: "SpaceBar"

## Step 11 -- Spawn and Test

Use \`control_actor\` with action \`spawn_blueprint\`:
- blueprintPath: "{{savePath}}/{{characterName}}"
- location: [0, 0, 100]

Then use \`control_editor\` with action \`play\` to enter PIE and verify movement works.

The character is now ready with full third-person movement, camera, and input.`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 2. setup-gas-ability
  // -----------------------------------------------------------------------
  {
    name: 'setup-gas-ability',
    description: 'Create a complete GAS (Gameplay Ability System) ability with attribute set, gameplay effect, cooldown, cost, and cue.',
    arguments: [
      { name: 'abilityName', description: 'Name for the ability (e.g. GA_Fireball)', required: true },
      { name: 'savePath', description: 'Content-browser save path (e.g. /Game/Blueprints/GAS)', required: true },
      { name: 'damageAmount', description: 'Base damage dealt by the ability (default: 50)', required: false },
      { name: 'cooldownDuration', description: 'Cooldown in seconds (default: 5)', required: false },
      { name: 'manaCost', description: 'Mana cost to activate (default: 25)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Set up a GAS ability called "{{abilityName}}" at "{{savePath}}".

Requirements:
- Deals {{damageAmount}} damage
- {{cooldownDuration}} second cooldown
- Costs {{manaCost}} mana
- Include attribute set, gameplay effect, and gameplay cue`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will build the full GAS pipeline for "{{abilityName}}" step by step.

## Step 1 -- Create the Attribute Set

Use \`manage_gas\` with action \`create_attribute_set\`:
- name: "AS_Combat"
- path: "{{savePath}}"
- save: true

Then add attributes with \`add_attribute\`:
1. assetPath: "{{savePath}}/AS_Combat", attributeName: "Health", attributeType: "Health", baseValue: 100
2. assetPath: "{{savePath}}/AS_Combat", attributeName: "MaxHealth", attributeType: "MaxHealth", baseValue: 100
3. assetPath: "{{savePath}}/AS_Combat", attributeName: "Mana", attributeType: "Mana", baseValue: 100
4. assetPath: "{{savePath}}/AS_Combat", attributeName: "MaxMana", attributeType: "MaxMana", baseValue: 100

Set clamping with \`set_attribute_clamping\`:
- assetPath: "{{savePath}}/AS_Combat", attributeName: "Health", clampMode: "MinMax", minValue: 0, maxValue: 100
- assetPath: "{{savePath}}/AS_Combat", attributeName: "Mana", clampMode: "MinMax", minValue: 0, maxValue: 100

## Step 2 -- Create the Damage Gameplay Effect

Use \`manage_gas\` with action \`create_gameplay_effect\`:
- name: "GE_{{abilityName}}_Damage"
- path: "{{savePath}}"
- save: true

Configure it as instant damage:
- \`set_effect_duration\`: effectPath: "{{savePath}}/GE_{{abilityName}}_Damage", durationType: "Instant"
- \`add_effect_modifier\`: effectPath: "{{savePath}}/GE_{{abilityName}}_Damage", targetAttribute: "Health", modifierOperation: "Add", modifierMagnitude: -{{damageAmount}}

## Step 3 -- Create the Cooldown Effect

Use \`manage_gas\` with action \`create_gameplay_effect\`:
- name: "GE_{{abilityName}}_Cooldown"
- path: "{{savePath}}"

Configure duration:
- \`set_effect_duration\`: effectPath: "{{savePath}}/GE_{{abilityName}}_Cooldown", durationType: "HasDuration", duration: {{cooldownDuration}}
- \`set_effect_tags\`: effectPath: "{{savePath}}/GE_{{abilityName}}_Cooldown", grantedTags: ["Ability.Cooldown.{{abilityName}}"]

## Step 4 -- Create the Cost Effect

Use \`manage_gas\` with action \`create_gameplay_effect\`:
- name: "GE_{{abilityName}}_Cost"
- path: "{{savePath}}"

- \`set_effect_duration\`: effectPath: "{{savePath}}/GE_{{abilityName}}_Cost", durationType: "Instant"
- \`add_effect_modifier\`: effectPath: "{{savePath}}/GE_{{abilityName}}_Cost", targetAttribute: "Mana", modifierOperation: "Add", modifierMagnitude: -{{manaCost}}

## Step 5 -- Create the Gameplay Ability

Use \`manage_gas\` with action \`create_gameplay_ability\`:
- name: "{{abilityName}}"
- path: "{{savePath}}"
- save: true

Configure the ability:
- \`set_ability_tags\`: abilityPath: "{{savePath}}/{{abilityName}}", abilityTags: ["Ability.Active.{{abilityName}}"]
- \`set_ability_costs\`: abilityPath: "{{savePath}}/{{abilityName}}", costEffectPath: "{{savePath}}/GE_{{abilityName}}_Cost", costAttribute: "Mana", costMagnitude: {{manaCost}}
- \`set_ability_cooldown\`: abilityPath: "{{savePath}}/{{abilityName}}", cooldownEffectPath: "{{savePath}}/GE_{{abilityName}}_Cooldown", cooldownDuration: {{cooldownDuration}}, cooldownTags: ["Ability.Cooldown.{{abilityName}}"]
- \`set_activation_policy\`: abilityPath: "{{savePath}}/{{abilityName}}", activationPolicy: "OnInputPressed"
- \`set_instancing_policy\`: abilityPath: "{{savePath}}/{{abilityName}}", instancingPolicy: "InstancedPerActor"

## Step 6 -- Add Ability Task

Use \`manage_gas\` with action \`add_ability_task\`:
- abilityPath: "{{savePath}}/{{abilityName}}"
- taskType: "PlayMontageAndWait"
- taskSettings: { montagePath: "" }  (fill in with an animation montage if available)

## Step 7 -- Create Gameplay Cue

Use \`manage_gas\` with action \`create_gameplay_cue_notify\`:
- name: "GC_{{abilityName}}_Impact"
- path: "{{savePath}}"
- cueType: "Static"

- \`configure_cue_trigger\`: cuePath: "{{savePath}}/GC_{{abilityName}}_Impact", triggerType: "Executed"
- \`add_effect_cue\`: effectPath: "{{savePath}}/GE_{{abilityName}}_Damage", cueTag: "GameplayCue.{{abilityName}}.Impact"

## Step 8 -- Wire Up the ASC

Use \`manage_gas\` with action \`add_ability_system_component\` on the character Blueprint that should have this ability:
- blueprintPath: "<your_character_blueprint_path>"
- replicationMode: "Mixed"

The GAS ability "{{abilityName}}" is now fully configured with damage, cost, cooldown, and visual feedback via cue.`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 3. create-multiplayer-lobby
  // -----------------------------------------------------------------------
  {
    name: 'create-multiplayer-lobby',
    description: 'Set up a multiplayer lobby with session management, game mode, player state, and network replication.',
    arguments: [
      { name: 'projectName', description: 'Project identifier used in asset naming (e.g. MyShooter)', required: true },
      { name: 'savePath', description: 'Content-browser save path (e.g. /Game/Blueprints/Framework)', required: true },
      { name: 'maxPlayers', description: 'Maximum number of players (default: 8)', required: false },
      { name: 'useLAN', description: 'Whether to configure for LAN play (true/false, default: true)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create a multiplayer lobby system for "{{projectName}}" at "{{savePath}}".

Requirements:
- Max players: {{maxPlayers}}
- LAN support: {{useLAN}}
- Includes GameMode, GameState, PlayerState, PlayerController, and session management`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will build the multiplayer lobby infrastructure for "{{projectName}}" piece by piece.

## Step 1 -- Create the Game Mode

Use \`manage_game_framework\` with action \`create_game_mode\`:
- name: "GM_{{projectName}}_Lobby"
- path: "{{savePath}}"
- save: true

## Step 2 -- Create the Game State

Use \`manage_game_framework\` with action \`create_game_state\`:
- name: "GS_{{projectName}}_Lobby"
- path: "{{savePath}}"

## Step 3 -- Create the Player State

Use \`manage_game_framework\` with action \`create_player_state\`:
- name: "PS_{{projectName}}"
- path: "{{savePath}}"

Add replicated properties for the player name and ready status:
Use \`manage_blueprint\` with action \`add_variable\` (twice):
1. blueprintPath: "{{savePath}}/PS_{{projectName}}", variableName: "PlayerDisplayName", variableType: "String"
2. blueprintPath: "{{savePath}}/PS_{{projectName}}", variableName: "bIsReady", variableType: "Boolean"

Mark them replicated with \`manage_networking\`:
- \`set_property_replicated\`: blueprintPath: "{{savePath}}/PS_{{projectName}}", propertyName: "PlayerDisplayName", replicated: true
- \`set_property_replicated\`: blueprintPath: "{{savePath}}/PS_{{projectName}}", propertyName: "bIsReady", replicated: true

## Step 4 -- Create the Player Controller

Use \`manage_game_framework\` with action \`create_player_controller\`:
- name: "PC_{{projectName}}_Lobby"
- path: "{{savePath}}"

## Step 5 -- Wire Up the Game Mode

Use \`manage_game_framework\`:
- \`set_default_pawn_class\`: gameModeBlueprint: "{{savePath}}/GM_{{projectName}}_Lobby", defaultPawnClass: "DefaultPawn"
- \`set_player_controller_class\`: gameModeBlueprint: "{{savePath}}/GM_{{projectName}}_Lobby", playerControllerClass: "{{savePath}}/PC_{{projectName}}_Lobby"
- \`set_game_state_class\`: gameModeBlueprint: "{{savePath}}/GM_{{projectName}}_Lobby", gameStateClass: "{{savePath}}/GS_{{projectName}}_Lobby"
- \`set_player_state_class\`: gameModeBlueprint: "{{savePath}}/GM_{{projectName}}_Lobby", playerStateClass: "{{savePath}}/PS_{{projectName}}"

## Step 6 -- Configure Session Settings

Use \`manage_sessions\` with action \`configure_local_session_settings\`:
- sessionName: "{{projectName}}Session"
- maxPlayers: {{maxPlayers}}
- bIsLANMatch: {{useLAN}}
- bAllowJoinInProgress: true
- bShouldAdvertise: true
- bUsesPresence: true

## Step 7 -- Create Server/Client RPCs

Use \`manage_networking\` with action \`create_rpc_function\` on the Player Controller:
1. Server RPC for requesting ready-up:
   - blueprintPath: "{{savePath}}/PC_{{projectName}}_Lobby"
   - functionName: "ServerSetReady"
   - rpcType: "Server"
   - reliable: true
   - parameters: [{ name: "bReady", type: "Boolean" }]

2. Client RPC for receiving lobby update:
   - blueprintPath: "{{savePath}}/PC_{{projectName}}_Lobby"
   - functionName: "ClientUpdateLobby"
   - rpcType: "Client"
   - reliable: true

3. Multicast for match countdown:
   - blueprintPath: "{{savePath}}/PC_{{projectName}}_Lobby"
   - functionName: "MulticastStartCountdown"
   - rpcType: "NetMulticast"
   - reliable: true
   - parameters: [{ name: "CountdownSeconds", type: "Integer" }]

## Step 8 -- Create the Lobby UI Widget

Use \`manage_widget_authoring\` with action \`create_widget_blueprint\`:
- name: "WBP_LobbyScreen"
- folder: "{{savePath}}/UI"

Add elements:
- \`add_vertical_box\`: widgetPath: "{{savePath}}/UI/WBP_LobbyScreen", slotName: "PlayerList"
- \`add_text_block\`: widgetPath: "{{savePath}}/UI/WBP_LobbyScreen", slotName: "ServerName", text: "{{projectName}} Lobby"
- \`add_button\`: widgetPath: "{{savePath}}/UI/WBP_LobbyScreen", slotName: "ReadyButton"
- \`add_button\`: widgetPath: "{{savePath}}/UI/WBP_LobbyScreen", slotName: "StartButton"

## Step 9 -- Configure LAN Hosting/Joining

If LAN is enabled, use \`manage_sessions\`:
- \`configure_lan_play\`: enabled: true
- For hosting: \`host_lan_server\`: serverName: "{{projectName}}Server", mapName: "/Game/Maps/LobbyMap", maxPlayers: {{maxPlayers}}
- For joining: \`join_lan_server\`: serverAddress: "<discovered_address>"

The multiplayer lobby framework is now complete with session management, network replication, and UI.`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 4. level-performance-audit
  // -----------------------------------------------------------------------
  {
    name: 'level-performance-audit',
    description: 'Analyze the current level for performance issues: draw calls, triangle counts, texture memory, lighting cost, and LOD configuration.',
    arguments: [
      { name: 'levelPath', description: 'Path to the level to audit (e.g. /Game/Maps/MainLevel). Leave blank for current level.', required: false },
      { name: 'targetFPS', description: 'Target framerate to benchmark against (default: 60)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Run a performance audit on level "{{levelPath}}" targeting {{targetFPS}} FPS.

Identify bottlenecks, suggest optimizations, and apply safe automated fixes where possible.`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will perform a comprehensive performance audit. Each step collects data or applies an optimization.

## Step 1 -- Load the Level (if needed)

If a level path was provided, use \`manage_level\` with action \`load\`:
- levelPath: "{{levelPath}}"

## Step 2 -- Gather Scene Statistics

Use \`inspect\` with action \`get_scene_stats\` to get actor counts, triangle counts, and draw-call estimates.

Use \`inspect\` with action \`get_performance_stats\` for frame time breakdown (Game thread, Render thread, GPU).

Use \`inspect\` with action \`get_memory_stats\` for texture memory, mesh memory, and total allocation.

## Step 3 -- Run a GPU Profile

Use \`manage_performance\` with action \`start_profiling\`:
- type: "GPU"
- duration: 10

Wait for completion, then \`stop_profiling\` to gather the results.

## Step 4 -- Run a Benchmark

Use \`manage_performance\` with action \`run_benchmark\`:
- This provides average FPS, frame-time percentiles, and bottleneck identification.

## Step 5 -- Show Real-Time Stats

Use \`manage_performance\` with action \`show_fps\` and \`show_stats\` to enable on-screen statistics.

Use \`control_editor\` with action \`show_stats\` for detailed stat categories.

## Step 6 -- Audit Lighting

Use \`inspect\` with action \`list_objects\` with className: "Light" to enumerate all lights.

Check for:
- Overlapping dynamic shadow-casting lights (expensive)
- Missing or stale lightmaps
- Excessive point lights in a small area

If issues found, use \`manage_lighting\` with action \`build_lighting\` for a fresh bake.

## Step 7 -- Check LOD Configuration

Use \`manage_performance\` with action \`configure_lod\`:
- Inspect current LOD bias and distance scale settings.
- If meshes lack LODs, use \`manage_asset\` with action \`generate_lods\` on heavy meshes.

## Step 8 -- Configure Nanite (if applicable)

Use \`manage_performance\` with action \`configure_nanite\`:
- Enable Nanite for static meshes with high polygon counts.
- Set appropriate maxPixelsPerEdge.

## Step 9 -- Optimize Draw Calls

Use \`manage_performance\` with action \`optimize_draw_calls\`:
- enableInstancing: true
- enableBatching: true

## Step 10 -- Configure Occlusion Culling

Use \`manage_performance\` with action \`configure_occlusion_culling\`:
- Enable hardware occlusion queries (hzb: true).

## Step 11 -- Apply Scalability Baseline

Use \`manage_performance\` with action \`apply_baseline_settings\` to set a reasonable default scalability profile.

## Step 12 -- Take a Screenshot for Reference

Use \`control_editor\` with action \`screenshot\`:
- filename: "PerformanceAudit_Before"

## Summary Report

After all data is collected, I will produce a summary with:
- Current FPS vs target ({{targetFPS}})
- Top 5 performance bottlenecks
- Optimizations applied
- Remaining manual recommendations (e.g., reduce unique materials, merge static meshes, enable World Partition streaming)`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 5. setup-material-instance
  // -----------------------------------------------------------------------
  {
    name: 'setup-material-instance',
    description: 'Create a material instance from a parent material with parameter overrides for color, texture, roughness, and metallic values.',
    arguments: [
      { name: 'instanceName', description: 'Name for the material instance (e.g. MI_BrickWall_Red)', required: true },
      { name: 'parentMaterialPath', description: 'Path to the parent material (e.g. /Game/Materials/M_Master_Surface)', required: true },
      { name: 'savePath', description: 'Content-browser save directory (e.g. /Game/Materials/Instances)', required: true },
      { name: 'baseColor', description: 'Base color hex or parameter name override (e.g. #FF3300)', required: false },
      { name: 'roughness', description: 'Roughness scalar value 0.0-1.0 (default: 0.5)', required: false },
      { name: 'metallic', description: 'Metallic scalar value 0.0-1.0 (default: 0.0)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create a material instance "{{instanceName}}" from parent "{{parentMaterialPath}}" at "{{savePath}}".

Overrides:
- Base color: {{baseColor}}
- Roughness: {{roughness}}
- Metallic: {{metallic}}`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will create the material instance and configure its parameters.

## Step 1 -- Inspect the Parent Material

Use \`inspect\` with action \`get_material_details\`:
- objectPath: "{{parentMaterialPath}}"

This reveals what parameters are exposed (scalar, vector, texture) so we know which to override.

## Step 2 -- Create the Material Instance

Use \`manage_asset\` with action \`create_material_instance\`:
- name: "{{instanceName}}"
- path: "{{savePath}}"
- parentMaterial: "{{parentMaterialPath}}"
- save: true

## Step 3 -- Set Base Color

Use \`manage_material_authoring\` or \`manage_asset\` to set the vector parameter:
- If the parent exposes a "BaseColor" vector parameter, use \`manage_asset\` with action \`set_metadata\` or set parameter on the instance:
  - assetPath: "{{savePath}}/{{instanceName}}"
  - parameters: { "BaseColor": "{{baseColor}}" }

Alternatively, use \`inspect\` with action \`set_property\`:
- objectPath: "{{savePath}}/{{instanceName}}"
- propertyName: "ScalarParameterValues" or "VectorParameterValues"

## Step 4 -- Set Roughness

Use \`inspect\` with action \`set_property\`:
- objectPath: "{{savePath}}/{{instanceName}}"
- propertyName: "Roughness"
- value: {{roughness}}

## Step 5 -- Set Metallic

Use \`inspect\` with action \`set_property\`:
- objectPath: "{{savePath}}/{{instanceName}}"
- propertyName: "Metallic"
- value: {{metallic}}

## Step 6 -- Verify and Preview

Use \`inspect\` with action \`get_material_details\`:
- objectPath: "{{savePath}}/{{instanceName}}"

Use \`manage_asset\` with action \`get_material_stats\`:
- assetPath: "{{savePath}}/{{instanceName}}"

This confirms the parameter overrides are applied and shows instruction count / texture sampler usage.

## Step 7 -- Apply to an Actor (Optional)

To preview in the viewport, use \`control_actor\` with action \`set_component_properties\`:
- actorName: "<target_actor>"
- componentName: "StaticMeshComponent0"
- properties: { "Material": "{{savePath}}/{{instanceName}}" }

The material instance "{{instanceName}}" is ready with the specified parameter overrides.`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 6. create-ai-npc
  // -----------------------------------------------------------------------
  {
    name: 'create-ai-npc',
    description: 'Set up an AI NPC character with AI Controller, Behavior Tree, Blackboard, perception senses, and patrol logic.',
    arguments: [
      { name: 'npcName', description: 'Name for the NPC (e.g. BP_EnemyGuard)', required: true },
      { name: 'savePath', description: 'Content-browser save path (e.g. /Game/Blueprints/AI)', required: true },
      { name: 'sightRadius', description: 'AI sight perception radius in cm (default: 2000)', required: false },
      { name: 'hearingRadius', description: 'AI hearing perception radius in cm (default: 1500)', required: false },
      { name: 'patrolSpeed', description: 'Patrol walk speed in cm/s (default: 200)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create an AI NPC called "{{npcName}}" at "{{savePath}}".

Requirements:
- AI Controller with Behavior Tree and Blackboard
- Sight radius: {{sightRadius}} cm
- Hearing radius: {{hearingRadius}} cm
- Patrol speed: {{patrolSpeed}} cm/s
- Patrol between waypoints, chase player on detection`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will build the complete AI NPC system step by step.

## Step 1 -- Create the NPC Character Blueprint

Use \`manage_character\` with action \`create_character_blueprint\`:
- name: "{{npcName}}"
- path: "{{savePath}}"
- parentClass: "Character"
- save: true

Configure movement:
- \`configure_movement_speeds\`: blueprintPath: "{{savePath}}/{{npcName}}", walkSpeed: {{patrolSpeed}}, runSpeed: 600

## Step 2 -- Create the Blackboard

Use \`manage_ai\` with action \`create_blackboard_asset\`:
- name: "BB_{{npcName}}"
- path: "{{savePath}}"

Add keys:
- \`add_blackboard_key\`: blackboardPath: "{{savePath}}/BB_{{npcName}}", keyName: "TargetActor", keyType: "Object", baseObjectClass: "Actor"
- \`add_blackboard_key\`: blackboardPath: "{{savePath}}/BB_{{npcName}}", keyName: "PatrolLocation", keyType: "Vector"
- \`add_blackboard_key\`: blackboardPath: "{{savePath}}/BB_{{npcName}}", keyName: "HasLineOfSight", keyType: "Bool"
- \`add_blackboard_key\`: blackboardPath: "{{savePath}}/BB_{{npcName}}", keyName: "DistanceToTarget", keyType: "Float"

## Step 3 -- Create the Behavior Tree

Use \`manage_ai\` with action \`create_behavior_tree\`:
- name: "BT_{{npcName}}"
- path: "{{savePath}}"

Build the tree structure:
- \`add_composite_node\`: behaviorTreePath: "{{savePath}}/BT_{{npcName}}", compositeType: "Selector" (root selector)

Chase branch:
- \`add_composite_node\`: parentNodeId: "root", compositeType: "Sequence"
- \`add_decorator\`: parentNodeId: the chase sequence, decoratorType: "Blackboard" (check TargetActor is set)
- \`add_task_node\`: parentNodeId: the chase sequence, taskType: "MoveTo" (move to TargetActor)

Patrol branch:
- \`add_composite_node\`: parentNodeId: "root", compositeType: "Sequence"
- \`add_task_node\`: parentNodeId: the patrol sequence, taskType: "MoveTo" (move to PatrolLocation)
- \`add_task_node\`: parentNodeId: the patrol sequence, taskType: "Wait" (wait 2-4 seconds)

Add an EQS service for finding patrol points:
- \`add_service\`: parentNodeId: the patrol sequence, serviceType: "RunEQS"

## Step 4 -- Create the AI Controller

Use \`manage_ai\` with action \`create_ai_controller\`:
- name: "AIC_{{npcName}}"
- path: "{{savePath}}"
- autoRunBehaviorTree: true

Assign tree and blackboard:
- \`assign_behavior_tree\`: controllerPath: "{{savePath}}/AIC_{{npcName}}", behaviorTreePath: "{{savePath}}/BT_{{npcName}}"
- \`assign_blackboard\`: controllerPath: "{{savePath}}/AIC_{{npcName}}", blackboardPath: "{{savePath}}/BB_{{npcName}}"

## Step 5 -- Configure AI Perception

Use \`manage_ai\` with action \`add_ai_perception_component\`:
- blueprintPath: "{{savePath}}/AIC_{{npcName}}"
- dominantSense: "Sight"

Configure sight:
- \`configure_sight_config\`: blueprintPath: "{{savePath}}/AIC_{{npcName}}", sightConfig: { sightRadius: {{sightRadius}}, loseSightRadius: {{sightRadius}} * 1.2, peripheralVisionAngle: 60, detectionByAffiliation: { enemies: true, neutrals: false, friendlies: false } }

Configure hearing:
- \`configure_hearing_config\`: blueprintPath: "{{savePath}}/AIC_{{npcName}}", hearingConfig: { hearingRange: {{hearingRadius}}, detectFriendly: false }

Set team:
- \`set_perception_team\`: blueprintPath: "{{savePath}}/AIC_{{npcName}}", teamId: 2

## Step 6 -- Create a Simple EQS Query for Patrol

Use \`manage_ai\` with action \`create_eqs_query\`:
- name: "EQS_{{npcName}}_Patrol"
- path: "{{savePath}}"

- \`add_eqs_generator\`: queryPath: "{{savePath}}/EQS_{{npcName}}_Patrol", generatorType: "SimpleGrid", generatorSettings: { searchRadius: 1500, gridSize: 200 }
- \`add_eqs_test\`: queryPath: "{{savePath}}/EQS_{{npcName}}_Patrol", testType: "Distance"
- \`add_eqs_test\`: queryPath: "{{savePath}}/EQS_{{npcName}}_Patrol", testType: "Pathfinding"

## Step 7 -- Assign the AI Controller to the NPC

Use \`manage_blueprint\` with action \`set_default\`:
- blueprintPath: "{{savePath}}/{{npcName}}"
- propertyName: "AIControllerClass"
- value: "{{savePath}}/AIC_{{npcName}}"

## Step 8 -- Spawn and Test

Use \`control_actor\` with action \`spawn_blueprint\`:
- blueprintPath: "{{savePath}}/{{npcName}}"
- location: [500, 0, 100]

Use \`control_editor\` with action \`play\` to test the AI behavior in PIE.

The NPC "{{npcName}}" is now fully set up with perception, behavior tree patrol/chase logic, and an AI controller.`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 7. blueprint-health-check
  // -----------------------------------------------------------------------
  {
    name: 'blueprint-health-check',
    description: 'Analyze a Blueprint for common issues: compilation errors, disconnected nodes, unused variables, missing references, and excessive complexity.',
    arguments: [
      { name: 'blueprintPath', description: 'Path to the Blueprint to analyze (e.g. /Game/Blueprints/BP_Player)', required: true },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Run a health check on Blueprint "{{blueprintPath}}".

Find and report:
- Compilation errors
- Disconnected or orphaned nodes
- Unused variables
- Missing asset references
- Overly complex graphs
- Best-practice violations`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will perform a thorough Blueprint health check on "{{blueprintPath}}".

## Step 1 -- Compile the Blueprint

Use \`manage_blueprint\` with action \`compile\`:
- blueprintPath: "{{blueprintPath}}"
- saveAfterCompile: false

Check the result for compilation errors or warnings. Any errors must be resolved before further analysis.

## Step 2 -- Inspect Blueprint Details

Use \`inspect\` with action \`get_blueprint_details\`:
- objectPath: "{{blueprintPath}}"

This returns the class hierarchy, parent class, interfaces, variables, functions, event graphs, and component list.

## Step 3 -- Analyze the Event Graph

Use \`manage_blueprint\` with action \`get_graph_details\`:
- blueprintPath: "{{blueprintPath}}"
- graphName: "EventGraph"

Review node count, connection patterns, and identify:
- Nodes with no output connections (dead code)
- Nodes with no input connections (orphaned)
- Very long execution chains (spaghetti)

## Step 4 -- Check All Functions

For each function returned in Step 2, use \`manage_blueprint\` with action \`get_graph_details\`:
- blueprintPath: "{{blueprintPath}}"
- graphName: "<function_name>"

Look for functions with:
- No callers (potentially unused)
- Excessive node counts (> 50 nodes suggests refactoring needed)
- Missing return nodes

## Step 5 -- Inspect Components (SCS)

Use \`manage_blueprint\` with action \`get_scs\`:
- blueprintPath: "{{blueprintPath}}"

Check for:
- Components with no mesh assigned
- Duplicate component names
- Deeply nested component hierarchies

## Step 6 -- Check Asset References

Use \`manage_asset\` with action \`get_dependencies\`:
- assetPath: "{{blueprintPath}}"

Look for:
- Missing or broken references (assets that no longer exist)
- Circular dependencies
- Dependencies on content outside the project

## Step 7 -- Validate Variables

From the details in Step 2, check each variable:
- Is it referenced in any graph? (Search for it in graph details)
- Is the default value sensible?
- For replicated variables, is the replication condition set correctly?

## Step 8 -- Check for Common Anti-Patterns

Using the graph details, look for:
- Tick event with heavy logic (recommend timers or event-driven)
- Cast nodes in Tick (cache the cast result)
- Get All Actors of Class in Tick (extremely expensive)
- Unnecessary delay nodes in loops
- Hard-coded asset references (should use data assets or soft references)

## Step 9 -- Run Asset Validation

Use \`system_control\` with action \`validate_assets\`:
- Check for general asset validation warnings.

## Summary Report

I will compile findings into categories:

**Critical** (must fix):
- Compilation errors
- Missing asset references

**Warning** (should fix):
- Unused variables
- Disconnected graph nodes
- Functions with no callers

**Suggestion** (nice to have):
- Complex graphs that could be refactored
- Anti-patterns in Tick event
- Hard-coded references

Each finding includes the specific node/variable and recommended fix.`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 8. setup-niagara-effect
  // -----------------------------------------------------------------------
  {
    name: 'setup-niagara-effect',
    description: 'Create a Niagara particle system with emitters, spawn rate, velocity, color, and renderer modules.',
    arguments: [
      { name: 'effectName', description: 'Name for the Niagara system (e.g. NS_Fire)', required: true },
      { name: 'savePath', description: 'Content-browser save path (e.g. /Game/Effects)', required: true },
      { name: 'effectType', description: 'Type of effect: fire, smoke, sparks, magic, rain, custom (default: fire)', required: false },
      { name: 'spawnRate', description: 'Particles per second (default: 100)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create a Niagara particle effect called "{{effectName}}" at "{{savePath}}".

- Effect type: {{effectType}}
- Spawn rate: {{spawnRate}} particles/second`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will build the Niagara system "{{effectName}}" with appropriate modules for a "{{effectType}}" effect.

## Step 1 -- Create the Niagara System

Use \`manage_effect\` with action \`create_niagara_system\`:
- name: "{{effectName}}"
- savePath: "{{savePath}}"

## Step 2 -- Create the Main Emitter

Use \`manage_effect\` with action \`create_niagara_emitter\`:
- name: "{{effectName}}_MainEmitter"
- savePath: "{{savePath}}"

Add it to the system:
- \`add_emitter_to_system\`: systemPath: "{{savePath}}/{{effectName}}", emitterName: "{{effectName}}_MainEmitter"

## Step 3 -- Configure Emitter Properties

Use \`manage_effect\` with action \`set_emitter_properties\`:
- systemPath: "{{savePath}}/{{effectName}}"
- emitterName: "{{effectName}}_MainEmitter"
- loopBehavior: "Infinite"

## Step 4 -- Add Spawn Rate Module

Use \`manage_effect\` with action \`add_spawn_rate_module\`:
- systemPath: "{{savePath}}/{{effectName}}"
- emitterName: "{{effectName}}_MainEmitter"
- spawnRate: {{spawnRate}}

## Step 5 -- Add Initialize Particle Module

Use \`manage_effect\` with action \`add_initialize_particle_module\`:
- systemPath: "{{savePath}}/{{effectName}}"
- emitterName: "{{effectName}}_MainEmitter"
- attributes: { lifetime: { min: 0.5, max: 2.0 }, mass: 1.0 }

## Step 6 -- Add Velocity Module

Use \`manage_effect\` with action \`add_velocity_module\`:
- systemPath: "{{savePath}}/{{effectName}}"
- emitterName: "{{effectName}}_MainEmitter"
- velocityMode: "FromPoint"
- speedMin: 50
- speedMax: 200

For fire/smoke, direct velocity upward. For sparks, use random directions.

## Step 7 -- Add Force/Gravity Module

Use \`manage_effect\` with action \`add_force_module\`:
- systemPath: "{{savePath}}/{{effectName}}"
- emitterName: "{{effectName}}_MainEmitter"
- forceType: "Gravity" (or "Wind" for rain/smoke)
- strength: -100 (negative for upward buoyancy on fire, positive for gravity on sparks)

## Step 8 -- Add Size Module

Use \`manage_effect\` with action \`add_size_module\`:
- systemPath: "{{savePath}}/{{effectName}}"
- emitterName: "{{effectName}}_MainEmitter"
- sizeMode: "RandomRange"
- sizeMin: [5, 5, 5]
- sizeMax: [20, 20, 20]

## Step 9 -- Add Color Module

Use \`manage_effect\` with action \`add_color_module\`:
- systemPath: "{{savePath}}/{{effectName}}"
- emitterName: "{{effectName}}_MainEmitter"
- colorMode: "Gradient"
- gradientStart: [1.0, 0.8, 0.2, 1.0] (warm yellow for fire)
- gradientEnd: [1.0, 0.1, 0.0, 0.0] (red fade-out for fire)

Adjust colors based on {{effectType}}: smoke uses gray tones, magic uses blues/purples, etc.

## Step 10 -- Add Sprite Renderer

Use \`manage_effect\` with action \`add_sprite_renderer_module\`:
- systemPath: "{{savePath}}/{{effectName}}"
- emitterName: "{{effectName}}_MainEmitter"
- material: "/Engine/EngineMaterials/DefaultParticleMaterial" (or a custom particle material)

## Step 11 -- Add Collision (Optional)

For sparks or rain, use \`manage_effect\` with action \`add_collision_module\`:
- systemPath: "{{savePath}}/{{effectName}}"
- emitterName: "{{effectName}}_MainEmitter"
- collisionMode: "SceneDepth"

## Step 12 -- Add Light Renderer (Optional for Fire/Magic)

Use \`manage_effect\` with action \`add_light_renderer_module\`:
- systemPath: "{{savePath}}/{{effectName}}"
- emitterName: "{{effectName}}_MainEmitter"
- lightIntensity: 5000
- lightRadius: 200

## Step 13 -- Validate the System

Use \`manage_effect\` with action \`validate_niagara_system\`:
- systemPath: "{{savePath}}/{{effectName}}"

## Step 14 -- Spawn in the Level for Preview

Use \`manage_effect\` with action \`spawn_niagara\`:
- system: "{{savePath}}/{{effectName}}"
- location: [0, 0, 100]

The Niagara system "{{effectName}}" is ready with spawn, velocity, color, size, and rendering modules.`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 9. create-ui-widget
  // -----------------------------------------------------------------------
  {
    name: 'create-ui-widget',
    description: 'Create a UMG widget Blueprint with layout panels, text, buttons, bindings, and animations for HUD or menu screens.',
    arguments: [
      { name: 'widgetName', description: 'Name for the widget Blueprint (e.g. WBP_MainHUD)', required: true },
      { name: 'savePath', description: 'Content-browser save path (e.g. /Game/UI)', required: true },
      { name: 'widgetType', description: 'Type of widget: hud, main_menu, pause_menu, settings, inventory, dialog (default: hud)', required: false },
      { name: 'includeHealthBar', description: 'Include a health bar element (true/false, default: true)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create a UMG widget "{{widgetName}}" of type "{{widgetType}}" at "{{savePath}}".

Include health bar: {{includeHealthBar}}`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will build the "{{widgetName}}" widget step by step based on the "{{widgetType}}" template.

## Step 1 -- Create the Widget Blueprint

Use \`manage_widget_authoring\` with action \`create_widget_blueprint\`:
- name: "{{widgetName}}"
- folder: "{{savePath}}"

## Step 2 -- Add Root Layout Panel

Use \`manage_widget_authoring\` with action \`add_canvas_panel\`:
- widgetPath: "{{savePath}}/{{widgetName}}"
- slotName: "RootCanvas"

## Step 3 -- Build Layout Based on Widget Type

### If {{widgetType}} is "hud":

Use \`manage_widget_authoring\` with action \`create_hud_widget\`:
- widgetPath: "{{savePath}}/{{widgetName}}"
- elements: ["health", "ammo", "crosshair", "minimap", "compass"]

If {{includeHealthBar}} is true:
- \`add_health_bar\`: widgetPath: "{{savePath}}/{{widgetName}}", barStyle: "simple", showNumbers: true, barColor: { r: 0.2, g: 0.8, b: 0.2, a: 1.0 }
- \`add_ammo_counter\`: widgetPath: "{{savePath}}/{{widgetName}}", ammoStyle: "numeric", showReserve: true
- \`add_crosshair\`: widgetPath: "{{savePath}}/{{widgetName}}", crosshairStyle: "cross", crosshairSize: 20
- \`add_minimap\`: widgetPath: "{{savePath}}/{{widgetName}}", minimapSize: 200, minimapShape: "circle", rotateWithPlayer: true

### If {{widgetType}} is "main_menu":

Use \`manage_widget_authoring\` with action \`create_main_menu\`:
- widgetPath: "{{savePath}}/{{widgetName}}"
- titleText: "Game Title"
- includePlayButton: true
- includeSettingsButton: true
- includeQuitButton: true

### If {{widgetType}} is "pause_menu":

Use \`manage_widget_authoring\` with action \`create_pause_menu\`:
- widgetPath: "{{savePath}}/{{widgetName}}"
- includeResumeButton: true
- includeSettingsButton: true
- includeQuitToMenuButton: true

### If {{widgetType}} is "settings":

Use \`manage_widget_authoring\` with action \`create_settings_menu\`:
- widgetPath: "{{savePath}}/{{widgetName}}"
- settingsType: "all"
- includeApplyButton: true
- includeResetButton: true

### If {{widgetType}} is "inventory":

Use \`manage_widget_authoring\` with action \`create_inventory_ui\`:
- widgetPath: "{{savePath}}/{{widgetName}}"
- gridSize: { columns: 8, rows: 4 }
- slotSize: 64
- showEquipment: true
- showDetails: true

### If {{widgetType}} is "dialog":

Use \`manage_widget_authoring\` with action \`create_dialog_widget\`:
- widgetPath: "{{savePath}}/{{widgetName}}"
- showPortrait: true
- showSpeakerName: true
- choiceLayout: "vertical"

## Step 4 -- Add Custom Elements

For additional text:
- \`add_text_block\`: widgetPath: "{{savePath}}/{{widgetName}}", slotName: "StatusText", text: "Ready", fontSize: 18

For additional buttons:
- \`add_button\`: widgetPath: "{{savePath}}/{{widgetName}}", slotName: "ActionButton"

## Step 5 -- Set Up Bindings

Use \`manage_widget_authoring\`:
- \`bind_text\`: widgetPath: "{{savePath}}/{{widgetName}}", slotName: "StatusText", bindingType: "variable", bindingSource: "StatusMessage"
- \`bind_visibility\`: widgetPath: "{{savePath}}/{{widgetName}}", slotName: "ActionButton", bindingType: "function", bindingSource: "ShouldShowAction"

## Step 6 -- Create Widget Animation

Use \`manage_widget_authoring\` with action \`create_widget_animation\`:
- widgetPath: "{{savePath}}/{{widgetName}}"
- animationName: "FadeIn"
- length: 0.5

- \`add_animation_track\`: widgetPath: "{{savePath}}/{{widgetName}}", animationName: "FadeIn", trackType: "opacity"
- \`add_animation_keyframe\`: widgetPath: "{{savePath}}/{{widgetName}}", animationName: "FadeIn", time: 0, value: 0, interpolation: "cubic"
- \`add_animation_keyframe\`: widgetPath: "{{savePath}}/{{widgetName}}", animationName: "FadeIn", time: 0.5, value: 1, interpolation: "cubic"

## Step 7 -- Preview

Use \`manage_widget_authoring\` with action \`preview_widget\`:
- widgetPath: "{{savePath}}/{{widgetName}}"
- previewSize: "1080p"

The widget "{{widgetName}}" is ready with layout, elements, bindings, and animations.`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 10. setup-enhanced-input
  // -----------------------------------------------------------------------
  {
    name: 'setup-enhanced-input',
    description: 'Configure the Enhanced Input system with Input Actions, an Input Mapping Context, keyboard/gamepad bindings, modifiers, and triggers.',
    arguments: [
      { name: 'contextName', description: 'Name for the Input Mapping Context (e.g. IMC_Player)', required: true },
      { name: 'savePath', description: 'Content-browser save path (e.g. /Game/Input)', required: true },
      { name: 'includeGamepad', description: 'Include gamepad bindings alongside keyboard/mouse (true/false, default: true)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Set up Enhanced Input with context "{{contextName}}" at "{{savePath}}".

Include gamepad bindings: {{includeGamepad}}

Create standard actions: Move, Look, Jump, Interact, Sprint, Crouch, Fire, Aim, Reload, Pause.`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will configure the full Enhanced Input setup with all standard gameplay actions.

## Step 1 -- Create Input Actions

Use \`manage_input\` with action \`create_input_action\` for each:

1. name: "IA_Move", path: "{{savePath}}" (2D axis for WASD)
2. name: "IA_Look", path: "{{savePath}}" (2D axis for mouse delta)
3. name: "IA_Jump", path: "{{savePath}}" (digital/bool)
4. name: "IA_Interact", path: "{{savePath}}" (digital/bool)
5. name: "IA_Sprint", path: "{{savePath}}" (digital/bool)
6. name: "IA_Crouch", path: "{{savePath}}" (digital/bool)
7. name: "IA_Fire", path: "{{savePath}}" (digital/bool)
8. name: "IA_Aim", path: "{{savePath}}" (digital/bool)
9. name: "IA_Reload", path: "{{savePath}}" (digital/bool)
10. name: "IA_Pause", path: "{{savePath}}" (digital/bool)

## Step 2 -- Create the Input Mapping Context

Use \`manage_input\` with action \`create_input_mapping_context\`:
- name: "{{contextName}}"
- path: "{{savePath}}"

## Step 3 -- Map Keyboard/Mouse Bindings

Use \`manage_input\` with action \`add_mapping\` for each:

Movement (WASD):
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Move", key: "W"
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Move", key: "S" (with negate modifier)
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Move", key: "A" (with swizzle + negate)
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Move", key: "D" (with swizzle)

Mouse Look:
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Look", key: "Mouse2D"

Actions:
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Jump", key: "SpaceBar"
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Interact", key: "E"
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Sprint", key: "LeftShift"
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Crouch", key: "LeftControl"
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Fire", key: "LeftMouseButton"
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Aim", key: "RightMouseButton"
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Reload", key: "R"
- contextPath: "{{savePath}}/{{contextName}}", actionPath: "{{savePath}}/IA_Pause", key: "Escape"

## Step 4 -- Add Input Modifiers

Use \`manage_input\` with action \`set_input_modifier\`:
- For IA_Move W-key mapping: modifierType: "Negate" on Y axis for S
- For IA_Move A-key mapping: modifierType: "SwizzleInputAxisValues" then "Negate"
- For IA_Look mouse: modifierType: "Negate" on Y axis (invert vertical if desired)

## Step 5 -- Add Input Triggers

Use \`manage_input\` with action \`set_input_trigger\`:
- For IA_Sprint: triggerType: "Hold" (hold to sprint)
- For IA_Aim: triggerType: "Hold" (hold to aim)
- For IA_Fire: triggerType: "Pressed" (single fire) or "Hold" (full auto)
- For IA_Pause: triggerType: "Pressed" (tap to toggle)

## Step 6 -- Map Gamepad Bindings (if enabled)

If {{includeGamepad}} is true, use \`manage_input\` with action \`add_mapping\`:

- IA_Move: key: "Gamepad_LeftStick2D"
- IA_Look: key: "Gamepad_RightStick2D"
- IA_Jump: key: "Gamepad_FaceButton_Bottom" (A/Cross)
- IA_Interact: key: "Gamepad_FaceButton_Left" (X/Square)
- IA_Sprint: key: "Gamepad_LeftStickButton" (L3)
- IA_Crouch: key: "Gamepad_RightStickButton" (R3)
- IA_Fire: key: "Gamepad_RightTrigger"
- IA_Aim: key: "Gamepad_LeftTrigger"
- IA_Reload: key: "Gamepad_FaceButton_Right" (B/Circle)
- IA_Pause: key: "Gamepad_Special_Right" (Start/Options)

## Step 7 -- Enable the Mapping Context

Use \`manage_input\` with action \`enable_input_mapping\`:
- contextPath: "{{savePath}}/{{contextName}}"
- priority: 0

## Step 8 -- Verify

Use \`manage_input\` with action \`get_input_info\`:
- assetPath: "{{savePath}}/{{contextName}}"

This confirms all actions and mappings are registered correctly.

The Enhanced Input system is now fully configured with keyboard, mouse, and optional gamepad support.`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 11. create-save-system
  // -----------------------------------------------------------------------
  {
    name: 'create-save-system',
    description: 'Set up a save/load game system using a SaveGame Blueprint with serialized player state, world state, and slot management.',
    arguments: [
      { name: 'saveClassName', description: 'Name for the SaveGame Blueprint (e.g. BP_MySaveGame)', required: true },
      { name: 'savePath', description: 'Content-browser save path (e.g. /Game/Blueprints/SaveSystem)', required: true },
      { name: 'slotName', description: 'Default save slot name (default: Slot1)', required: false },
      { name: 'includeAutoSave', description: 'Include auto-save timer logic (true/false, default: true)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create a save/load system with class "{{saveClassName}}" at "{{savePath}}".

- Default slot: {{slotName}}
- Include auto-save: {{includeAutoSave}}`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will build a complete save/load system using UE's SaveGame framework.

## Step 1 -- Create the SaveGame Blueprint

Use \`manage_blueprint\` with action \`create\`:
- name: "{{saveClassName}}"
- savePath: "{{savePath}}"
- parentClass: "SaveGame"
- save: true

## Step 2 -- Add Save Data Variables

Use \`manage_blueprint\` with action \`add_variable\` for each piece of data to persist:

Player state:
1. variableName: "PlayerLocation", variableType: "Vector", blueprintPath: "{{savePath}}/{{saveClassName}}"
2. variableName: "PlayerRotation", variableType: "Rotator", blueprintPath: "{{savePath}}/{{saveClassName}}"
3. variableName: "PlayerHealth", variableType: "Float", defaultValue: 100, blueprintPath: "{{savePath}}/{{saveClassName}}"
4. variableName: "PlayerLevel", variableType: "Integer", defaultValue: 1, blueprintPath: "{{savePath}}/{{saveClassName}}"
5. variableName: "ExperiencePoints", variableType: "Float", defaultValue: 0, blueprintPath: "{{savePath}}/{{saveClassName}}"

World state:
6. variableName: "CurrentLevelName", variableType: "String", blueprintPath: "{{savePath}}/{{saveClassName}}"
7. variableName: "CompletedObjectives", variableType: "Array<String>", blueprintPath: "{{savePath}}/{{saveClassName}}"
8. variableName: "CollectedItems", variableType: "Array<String>", blueprintPath: "{{savePath}}/{{saveClassName}}"

Metadata:
9. variableName: "SaveTimestamp", variableType: "String", blueprintPath: "{{savePath}}/{{saveClassName}}"
10. variableName: "PlayTimeSeconds", variableType: "Float", blueprintPath: "{{savePath}}/{{saveClassName}}"
11. variableName: "SaveSlotName", variableType: "String", defaultValue: "{{slotName}}", blueprintPath: "{{savePath}}/{{saveClassName}}"

## Step 3 -- Create the Save Manager Blueprint

Use \`manage_blueprint\` with action \`create\`:
- name: "BP_SaveManager"
- savePath: "{{savePath}}"
- parentClass: "Actor"
- save: true

## Step 4 -- Add Save/Load Functions

Use \`manage_blueprint\` with action \`add_function\` on BP_SaveManager:

1. functionName: "SaveGame"
   - inputs: [{ name: "SlotName", type: "String" }]
   - outputs: [{ name: "bSuccess", type: "Boolean" }]

2. functionName: "LoadGame"
   - inputs: [{ name: "SlotName", type: "String" }]
   - outputs: [{ name: "bSuccess", type: "Boolean" }, { name: "SaveData", type: "{{saveClassName}}" }]

3. functionName: "DeleteSave"
   - inputs: [{ name: "SlotName", type: "String" }]
   - outputs: [{ name: "bSuccess", type: "Boolean" }]

4. functionName: "DoesSaveExist"
   - inputs: [{ name: "SlotName", type: "String" }]
   - outputs: [{ name: "bExists", type: "Boolean" }]

5. functionName: "GetAllSaveSlots"
   - outputs: [{ name: "SlotNames", type: "Array<String>" }]

## Step 5 -- Build Save Function Graph

In the SaveGame function, use \`manage_blueprint\` with action \`create_node\` to add:
1. "Create Save Game Object" node (class: {{saveClassName}})
2. Nodes to populate each variable from game state
3. "Save Game to Slot" node with SlotName parameter
4. Return success boolean

## Step 6 -- Build Load Function Graph

In the LoadGame function:
1. "Does Save Game Exist" node to check slot
2. "Load Game from Slot" node
3. Cast to {{saveClassName}}
4. Return the save data and success bool

## Step 7 -- Add Auto-Save Logic (if enabled)

If {{includeAutoSave}} is true:

Use \`manage_blueprint\` with action \`add_variable\`:
- variableName: "AutoSaveIntervalSeconds", variableType: "Float", defaultValue: 300, blueprintPath: "{{savePath}}/BP_SaveManager"

Add a timer in BeginPlay that calls SaveGame every AutoSaveIntervalSeconds:
- Create a "Set Timer by Function Name" node calling "AutoSave"
- Add an "AutoSave" custom event that calls SaveGame with slot "AutoSave"

## Step 8 -- Create a Simple Save/Load UI

Use \`manage_widget_authoring\` with action \`create_widget_blueprint\`:
- name: "WBP_SaveLoadMenu"
- folder: "{{savePath}}/UI"

Add elements:
- \`add_vertical_box\`: slotName: "SlotList"
- \`add_button\`: slotName: "SaveButton"
- \`add_button\`: slotName: "LoadButton"
- \`add_button\`: slotName: "DeleteButton"
- \`add_text_block\`: slotName: "StatusText", text: "Select a save slot"

## Step 9 -- Integrate with Game Instance

Use \`manage_game_framework\` with action \`create_game_instance\`:
- name: "GI_{{saveClassName}}"
- path: "{{savePath}}"

The Game Instance persists across level loads, making it an ideal owner for the save manager reference.

## Step 10 -- Compile and Test

Use \`manage_blueprint\` with action \`compile\`:
- blueprintPath: "{{savePath}}/{{saveClassName}}"
- blueprintPath: "{{savePath}}/BP_SaveManager"

The save/load system is ready with persistent data, auto-save, UI, and Game Instance integration.`
        }
      }
    ]
  },

  // -----------------------------------------------------------------------
  // 12. setup-inventory-system
  // -----------------------------------------------------------------------
  {
    name: 'setup-inventory-system',
    description: 'Create a complete inventory system with item data assets, inventory component, world pickups, equipment slots, and loot tables.',
    arguments: [
      { name: 'projectPrefix', description: 'Naming prefix for assets (e.g. RPG, Shooter)', required: true },
      { name: 'savePath', description: 'Content-browser save path (e.g. /Game/Blueprints/Inventory)', required: true },
      { name: 'slotCount', description: 'Number of inventory slots (default: 20)', required: false },
      { name: 'includeEquipment', description: 'Include equipment/gear slots (true/false, default: true)', required: false },
      { name: 'includeCrafting', description: 'Include crafting recipe system (true/false, default: false)', required: false },
    ],
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create an inventory system for project "{{projectPrefix}}" at "{{savePath}}".

- Inventory slots: {{slotCount}}
- Include equipment: {{includeEquipment}}
- Include crafting: {{includeCrafting}}`
        }
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `I will build the full inventory system from data assets to world pickups.

## Step 1 -- Create Item Categories

Use \`manage_inventory\` with action \`create_item_category\` for each:
1. name: "{{projectPrefix}}_Cat_Weapons", path: "{{savePath}}/Categories"
2. name: "{{projectPrefix}}_Cat_Armor", path: "{{savePath}}/Categories"
3. name: "{{projectPrefix}}_Cat_Consumables", path: "{{savePath}}/Categories"
4. name: "{{projectPrefix}}_Cat_Materials", path: "{{savePath}}/Categories"
5. name: "{{projectPrefix}}_Cat_Quest", path: "{{savePath}}/Categories"

## Step 2 -- Create Sample Item Data Assets

Use \`manage_inventory\` with action \`create_item_data_asset\`:

1. Weapon item:
   - name: "{{projectPrefix}}_Item_Sword"
   - path: "{{savePath}}/Items"
   - save: true

   \`set_item_properties\`: itemPath: "{{savePath}}/Items/{{projectPrefix}}_Item_Sword"
   - displayName: "Iron Sword"
   - stackSize: 1
   - weight: 5.0
   - rarity: "Common"
   - value: 100
   - tags: ["Weapon.Melee.Sword"]

   \`assign_item_category\`: itemPath: "{{savePath}}/Items/{{projectPrefix}}_Item_Sword", categoryPath: "{{savePath}}/Categories/{{projectPrefix}}_Cat_Weapons"

2. Consumable item:
   - name: "{{projectPrefix}}_Item_HealthPotion"
   - path: "{{savePath}}/Items"

   \`set_item_properties\`:
   - displayName: "Health Potion"
   - stackSize: 99
   - weight: 0.5
   - rarity: "Common"
   - value: 25

3. Material item:
   - name: "{{projectPrefix}}_Item_IronOre"
   - path: "{{savePath}}/Items"

   \`set_item_properties\`:
   - displayName: "Iron Ore"
   - stackSize: 999
   - weight: 1.0
   - rarity: "Common"
   - value: 10

## Step 3 -- Create the Inventory Component

Use \`manage_inventory\` with action \`create_inventory_component\`:
- name: "{{projectPrefix}}_InventoryComponent"
- path: "{{savePath}}"
- save: true

Configure slots:
- \`configure_inventory_slots\`: blueprintPath: "{{savePath}}/{{projectPrefix}}_InventoryComponent", slotCount: {{slotCount}}, allowStacking: true, maxWeight: 200

Add functions:
- \`add_inventory_functions\`: blueprintPath: "{{savePath}}/{{projectPrefix}}_InventoryComponent"
  (Adds AddItem, RemoveItem, HasItem, GetItemCount, TransferItem, SortInventory)

Configure events:
- \`configure_inventory_events\`: blueprintPath: "{{savePath}}/{{projectPrefix}}_InventoryComponent"
  (Adds OnItemAdded, OnItemRemoved, OnInventoryChanged, OnWeightChanged)

Enable replication:
- \`set_inventory_replication\`: blueprintPath: "{{savePath}}/{{projectPrefix}}_InventoryComponent", replicated: true, replicationCondition: "OwnerOnly"

## Step 4 -- Create Equipment Component (if enabled)

If {{includeEquipment}} is true:

Use \`manage_inventory\` with action \`create_equipment_component\`:
- name: "{{projectPrefix}}_EquipmentComponent"
- path: "{{savePath}}"

Define slots:
- \`define_equipment_slots\`: blueprintPath: "{{savePath}}/{{projectPrefix}}_EquipmentComponent", slots: [
    { name: "Head", socketName: "HeadSocket", allowedCategories: ["Armor"] },
    { name: "Chest", socketName: "ChestSocket", allowedCategories: ["Armor"] },
    { name: "MainHand", socketName: "WeaponSocket_R", allowedCategories: ["Weapon"] },
    { name: "OffHand", socketName: "WeaponSocket_L", allowedCategories: ["Weapon", "Shield"] },
    { name: "Feet", socketName: "FeetSocket", allowedCategories: ["Armor"] }
  ]

Configure stat modifiers:
- \`configure_equipment_effects\`: Apply stat bonuses/penalties when equipping.

Add equipment functions:
- \`add_equipment_functions\`: (Equip, Unequip, SwapSlots, GetEquippedItem)

## Step 5 -- Create World Pickups

Use \`manage_inventory\` with action \`create_pickup_actor\`:
- name: "{{projectPrefix}}_PickupBase"
- path: "{{savePath}}/Pickups"

Configure interaction:
- \`configure_pickup_interaction\`: pickupPath: "{{savePath}}/Pickups/{{projectPrefix}}_PickupBase", interactionType: "Interact", interactionRadius: 200, prompt: "Press E to pick up"

Configure effects:
- \`configure_pickup_effects\`: pickupPath: "{{savePath}}/Pickups/{{projectPrefix}}_PickupBase", bobbing: true, rotation: true, glowEffect: true

Configure respawn:
- \`configure_pickup_respawn\`: pickupPath: "{{savePath}}/Pickups/{{projectPrefix}}_PickupBase", respawnable: false

## Step 6 -- Create Loot Table

Use \`manage_inventory\` with action \`create_loot_table\`:
- name: "{{projectPrefix}}_LootTable_Common"
- path: "{{savePath}}/Loot"

Add entries:
- \`add_loot_entry\`: lootTablePath: "{{savePath}}/Loot/{{projectPrefix}}_LootTable_Common", itemPath: "{{savePath}}/Items/{{projectPrefix}}_Item_HealthPotion", lootWeight: 50, minQuantity: 1, maxQuantity: 3
- \`add_loot_entry\`: lootTablePath: "{{savePath}}/Loot/{{projectPrefix}}_LootTable_Common", itemPath: "{{savePath}}/Items/{{projectPrefix}}_Item_IronOre", lootWeight: 30, minQuantity: 1, maxQuantity: 5

Configure loot quality tiers:
- \`set_loot_quality_tiers\`: lootTablePath: "{{savePath}}/Loot/{{projectPrefix}}_LootTable_Common", tiers: [
    { name: "Common", color: { r: 0.8, g: 0.8, b: 0.8, a: 1 }, dropWeight: 60, statMultiplier: 1.0 },
    { name: "Uncommon", color: { r: 0.2, g: 0.8, b: 0.2, a: 1 }, dropWeight: 25, statMultiplier: 1.2 },
    { name: "Rare", color: { r: 0.2, g: 0.4, b: 1.0, a: 1 }, dropWeight: 10, statMultiplier: 1.5 },
    { name: "Epic", color: { r: 0.6, g: 0.1, b: 0.9, a: 1 }, dropWeight: 4, statMultiplier: 2.0 },
    { name: "Legendary", color: { r: 1.0, g: 0.7, b: 0.0, a: 1 }, dropWeight: 1, statMultiplier: 3.0 }
  ]

## Step 7 -- Create Crafting System (if enabled)

If {{includeCrafting}} is true:

Use \`manage_inventory\` with action \`create_crafting_recipe\`:
- name: "{{projectPrefix}}_Recipe_IronSword"
- path: "{{savePath}}/Crafting"

Configure recipe:
- \`configure_recipe_requirements\`: recipePath: "{{savePath}}/Crafting/{{projectPrefix}}_Recipe_IronSword"
  - outputItemPath: "{{savePath}}/Items/{{projectPrefix}}_Item_Sword"
  - outputQuantity: 1
  - ingredients: [{ itemPath: "{{savePath}}/Items/{{projectPrefix}}_Item_IronOre", quantity: 5 }]
  - craftTime: 3
  - requiredLevel: 1

Create crafting station:
- \`create_crafting_station\`: name: "{{projectPrefix}}_CraftingAnvil", path: "{{savePath}}/Crafting", stationType: "Anvil", recipes: ["{{savePath}}/Crafting/{{projectPrefix}}_Recipe_IronSword"]

## Step 8 -- Create Inventory UI

Use \`manage_widget_authoring\` with action \`create_inventory_ui\`:
- widgetPath: "{{savePath}}/UI/WBP_Inventory"
- gridSize: { columns: 5, rows: Math.ceil({{slotCount}} / 5) }
- slotSize: 64
- showEquipment: {{includeEquipment}}
- showDetails: true

## Step 9 -- Verify Setup

Use \`manage_inventory\` with action \`get_inventory_info\`:
- blueprintPath: "{{savePath}}/{{projectPrefix}}_InventoryComponent"

This confirms slot count, weight limits, replication, and registered events.

The inventory system is now complete with items, categories, pickups, loot tables, optional equipment, and optional crafting.`
        }
      }
    ]
  },

];
