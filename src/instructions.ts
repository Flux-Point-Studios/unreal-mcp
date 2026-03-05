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

## Common Patterns

**Always capture a screenshot after visual changes** — use \`control_editor\` action \`capture_viewport\` (params: width, height, format, quality). This returns a base64 image so you can see the result. Visual feedback is also auto-appended to responses from visual tools.

**Use \`inspect\` for any object investigation** — actions: \`get_actor_details\`, \`get_blueprint_details\`, \`get_material_details\`, \`get_mesh_details\`, \`get_texture_details\`, \`get_component_details\`, \`get_property\`, \`set_property\`, \`get_components\`, \`get_scene_stats\`, \`get_memory_stats\`, \`get_selected_actors\`. This is your primary investigation tool.

**Use \`workflow\` for multi-step operations** — actions: \`level_performance_audit\`, \`blueprint_health_check\`, \`scene_populate\`, \`quick_test\`. These chain multiple tool calls together.

**If an action returns NOT_IMPLEMENTED** — that action requires a C++ handler in the McpAutomationBridge plugin that hasn't been compiled into the current editor build. Try an alternative approach.

**Every tool returns structured JSON** — always check the \`success\` field first. Error responses include an \`error\` field with details.

## Tools by Category with Key Actions

**Scene & Actors**
- \`control_actor\` — \`spawn\`, \`delete\`, \`list\`, \`find_by_name\`, \`find_by_tag\`, \`find_by_class\`, \`set_transform\`, \`get_transform\`, \`set_visibility\`, \`add_component\`, \`get_components\`, \`set_blueprint_variables\`, \`get_component_property\`, \`set_component_property\`, \`attach\`, \`detach\`, \`call_actor_function\`, \`duplicate\`
- \`manage_level\` — \`get_current_level\`, \`get_summary\`, \`list_levels\`, \`load\`, \`save\`, \`create_level\`, \`stream\`, \`build_lighting\`
- \`manage_level_structure\` — \`create_sublevel\`, \`configure_level_streaming\`, \`enable_world_partition\`, \`create_data_layer\`, \`create_level_instance\`
- \`build_environment\` — \`create_landscape\`, \`sculpt\`, \`paint_landscape\`, \`add_foliage\`, \`create_sky_sphere\`, \`set_time_of_day\`
- \`manage_volumes\` — \`create_trigger_volume\`, \`create_blocking_volume\`, \`create_post_process_volume\`, \`create_physics_volume\`, \`create_audio_volume\`, \`set_volume_properties\`

**Editor & Viewport**
- \`control_editor\` — \`play\`, \`stop\`, \`pause\`, \`resume\`, \`capture_viewport\`, \`screenshot\`, \`save_all\`, \`undo\`, \`redo\`, \`focus_actor\`, \`open_level\`, \`open_asset\`, \`set_viewport_camera\`, \`console_command\`, \`set_preferences\`
- \`inspect\` — \`get_actor_details\`, \`get_blueprint_details\`, \`get_material_details\`, \`get_mesh_details\`, \`get_texture_details\`, \`get_component_details\`, \`get_property\`, \`set_property\`, \`get_components\`, \`get_scene_stats\`, \`get_memory_stats\`, \`get_selected_actors\`, \`get_viewport_info\`, \`find_by_class\`, \`list_objects\`

**Blueprints & Code**
- \`manage_blueprint\` — \`create\`, \`get\`, \`compile\`, \`add_component\`, \`add_variable\`, \`add_function\`, \`add_event\`, \`add_node\`, \`connect_pins\`, \`set_default\`, \`get_graph_details\`, \`get_node_details\`, \`set_pin_default_value\`
- \`manage_game_framework\` — \`create_game_mode\`, \`create_game_state\`, \`create_player_controller\`, \`create_hud_class\`, \`set_default_pawn_class\`

**Assets & Materials**
- \`manage_asset\` — \`list\`, \`import\`, \`delete\`, \`rename\`, \`move\`, \`duplicate\`, \`search_assets\`, \`get_dependencies\`, \`exists\`, \`get_material_stats\`, \`dump_asset\`, \`create_material\`, \`create_material_instance\`, \`validate\`, \`bulk_rename\`, \`bulk_delete\`
- \`manage_material_authoring\` — \`create_material\`, \`add_texture_sample\`, \`add_scalar_parameter\`, \`add_vector_parameter\`, \`connect_nodes\`, \`create_material_instance\`, \`set_scalar_parameter_value\`, \`set_vector_parameter_value\`, \`set_texture_parameter_value\`, \`compile_material\`, \`set_blend_mode\`, \`set_shading_model\`
- \`manage_texture\` — \`create_noise_texture\`, \`resize_texture\`, \`set_compression_settings\`, \`channel_pack\`, \`get_texture_info\`
- \`asset_pipeline\` — \`list_providers\`, \`generate_3d_model\`, \`generate_texture\`, \`check_generation_status\`, \`download_and_import\` (AI-powered via Meshy/Tripo APIs)

**Animation & Physics**
- \`animation_physics\` — \`play_montage\`, \`create_animation_blueprint\`, \`create_blend_space\`, \`create_montage\`, \`create_state_machine\`, \`setup_ragdoll\`, \`create_control_rig\`, \`create_ik_rig\`
- \`manage_skeleton\` — \`create_skeleton\`, \`add_bone\`, \`create_socket\`, \`create_physics_asset\`, \`list_bones\`, \`list_sockets\`, \`get_skeleton_info\`
- \`manage_character\` — \`create_character_blueprint\`, \`setup_movement\`, \`set_walk_speed\`, \`set_jump_height\`, \`configure_crouch\`, \`configure_sprint\`, \`get_character_info\`

**Visual Effects & Audio**
- \`manage_effect\` — \`create_niagara_system\`, \`create_niagara_emitter\`, \`spawn_niagara\`, \`add_niagara_module\`, \`set_niagara_parameter\`, \`activate\`, \`deactivate\`, \`get_niagara_info\`
- \`manage_lighting\` — \`spawn_light\`, \`create_sky_light\`, \`setup_global_illumination\`, \`configure_shadows\`, \`set_exposure\`, \`build_lighting\`, \`list_light_types\`
- \`manage_audio\` — \`play_sound_at_location\`, \`play_sound_2d\`, \`create_sound_cue\`, \`create_ambient_sound\`, \`create_metasound\`, \`get_audio_info\`

**UI**
- \`manage_widget_authoring\` — \`create_widget_blueprint\`, \`add_canvas_panel\`, \`add_text_block\`, \`add_image\`, \`add_button\`, \`add_progress_bar\`, \`set_anchor\`, \`set_position\`, \`set_size\`, \`create_hud_widget\`, \`preview_widget\`, \`get_widget_info\`
- \`manage_input\` — \`create_input_action\`, \`create_input_mapping_context\`, \`add_mapping\`, \`map_input_action\`, \`get_input_info\`

**Gameplay Systems**
- \`manage_gas\` — \`add_ability_system_component\`, \`create_attribute_set\`, \`create_gameplay_ability\`, \`create_gameplay_effect\`, \`create_gameplay_cue_notify\`, \`get_gas_info\`
- \`manage_combat\` — \`create_weapon_blueprint\`, \`setup_damage_type\`, \`configure_hit_detection\`, \`apply_damage\`, \`heal\`, \`get_combat_info\`
- \`manage_ai\` — \`create_ai_controller\`, \`create_behavior_tree\`, \`create_blackboard\`, \`setup_perception\`, \`run_behavior_tree\`, \`set_blackboard_value\`, \`get_ai_info\`
- \`manage_behavior_tree\` — \`create\`, \`add_node\`, \`connect_nodes\`, \`remove_node\`, \`set_node_properties\`
- \`manage_inventory\` — \`create_item_data_asset\`, \`create_inventory_component\`, \`create_pickup_actor\`, \`create_equipment_component\`, \`create_loot_table\`, \`get_inventory_info\`
- \`manage_interaction\` — \`create_interaction_component\`, \`create_door_actor\`, \`create_switch_actor\`, \`create_trigger_actor\`, \`get_interaction_info\`

**Networking & Sessions**
- \`manage_networking\` — \`set_property_replicated\`, \`create_rpc_function\`, \`configure_movement_prediction\`, \`get_networking_info\`
- \`manage_sessions\` — \`configure_local_session_settings\`, \`host_lan_server\`, \`join_lan_server\`, \`enable_voice_chat\`, \`get_sessions_info\`

**Geometry & Splines**
- \`manage_geometry\` — \`create_box\`, \`create_sphere\`, \`create_cylinder\`, \`boolean_union\`, \`boolean_subtract\`, \`extrude\`, \`bevel\`, \`mirror\`, \`convert_to_static_mesh\`, \`get_mesh_info\`
- \`manage_splines\` — \`create_spline_actor\`, \`add_spline_point\`, \`create_spline_mesh_component\`, \`create_road_spline\`, \`scatter_meshes_along_spline\`, \`get_splines_info\`

**Sequences**
- \`manage_sequence\` — Level Sequencer tracks, keyframes, playback

**Navigation**
- \`manage_navigation\` — \`configure_nav_mesh_settings\`, \`rebuild_navigation\`, \`create_nav_modifier_component\`, \`create_nav_link_proxy\`, \`get_navigation_info\`

**Performance & Testing**
- \`manage_performance\` — \`start_profiling\`, \`stop_profiling\`, \`run_benchmark\`, \`show_fps\`, \`generate_memory_report\`, \`set_scalability\`, \`configure_nanite\`
- \`manage_tests\` — \`list_tests\`, \`run_test\`, \`run_all_tests\`, \`run_tests_by_filter\`, \`get_test_results\`

**System & Orchestration**
- \`system_control\` — \`console_command\`, \`execute_command\`, \`get_project_settings\`, \`set_project_setting\`, \`set_cvar\`, \`execute_script\` (Python/console batch/editor utility — requires C++ handler), \`get_script_history\`
- \`manage_tasks\` — \`submit\`, \`status\`, \`result\`, \`list\`, \`cancel\`, \`cleanup\`
- \`manage_tools\` — \`list_tools\`, \`list_categories\`, \`enable_category\`, \`disable_category\`, \`get_status\`, \`reset\`
- \`workflow\` — \`level_performance_audit\`, \`blueprint_health_check\`, \`scene_populate\`, \`quick_test\`
- \`manage_pipeline\` — \`run_ubt\`, \`list_categories\`, \`get_status\`

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

## Troubleshooting

**"Unreal Engine is not connected"** — The editor hasn't connected to the MCP bridge yet. Read \`ue://health\` to check status. Wait for the user to confirm the editor is loaded before retrying. Do NOT retry the same call immediately.

**\`dump_asset\` times out** — This action serializes full UObject properties and can be slow for complex assets (materials, blueprints). Alternatives:
- Use \`inspect\` → \`get_material_details\` or \`get_mesh_details\` for targeted info (much faster)
- Use \`manage_asset\` → \`get_material_stats\` for material overview
- Use \`system_control\` → \`console_command\` with \`obj dump ClassName\` for raw UE output
- Reduce scope: pass \`maxDepth: 1\` and \`propertyAllowlist\` to limit data

**Action returns unexpected errors** — Try these investigation steps in order:
1. \`inspect\` → \`get_actor_details\` / \`get_material_details\` / \`get_mesh_details\` (primary investigation tool)
2. \`control_editor\` → \`capture_viewport\` to see the current visual state
3. \`system_control\` → \`console_command\` for UE console diagnostics
4. \`workflow\` → \`quick_test\` for a fast overview of editor state

## Tips
- Resource subscriptions are supported — subscribe to \`ue://actors\` etc. for live updates.
- For AI-generated 3D assets, use \`asset_pipeline\` with a Meshy or Tripo API key.
- The MCP tools operate on the **editor world**. PIE (Play In Editor) spawns a separate world that these tools cannot directly access. To test runtime behavior, use \`control_editor\` actions \`play\`/\`stop\` and \`capture_viewport\` to observe results.
`.trim();
