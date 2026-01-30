// Location: McpAutomationBridge/Private/McpAutomationBridge_SystemHandlers.cpp
// Summary: System-level handlers for the MCP Automation Bridge plugin.
//          Provides handlers for system introspection, capabilities discovery,
//          and plugin configuration queries. These handlers enable MCP clients
//          to discover what actions the plugin supports, understand security
//          profiles, and retrieve engine/plugin version information.
// Usage: Handler methods are called from ProcessAutomationRequest via the
//        registered handler registry. The describe_capabilities action is
//        particularly useful for CI/CD pipelines and automated tooling to
//        understand the plugin's capabilities before issuing commands.

#include "McpAutomationBridgeSubsystem.h"
#include "McpAutomationBridgeGlobals.h"
#include "McpAutomationBridgeSettings.h"
#include "Misc/EngineVersion.h"

// Plugin version - update this when releasing new versions
#define MCP_AUTOMATION_BRIDGE_VERSION TEXT("1.0.0")

bool UMcpAutomationBridgeSubsystem::HandleDescribeCapabilities(
    const FString& RequestId,
    const FString& Action,
    const TSharedPtr<FJsonObject>& Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket)
{
    if (!Action.Equals(TEXT("describe_capabilities"), ESearchCase::IgnoreCase))
    {
        return false;
    }

#if WITH_EDITOR
    TSharedPtr<FJsonObject> Caps = MakeShared<FJsonObject>();

    // Engine and plugin version
    Caps->SetStringField(TEXT("engineVersion"), FEngineVersion::Current().ToString());
    Caps->SetStringField(TEXT("pluginVersion"), MCP_AUTOMATION_BRIDGE_VERSION);

    // Security profile (dev or ci based on config/environment)
    // TODO: Read from project settings or environment variable when CI mode is implemented
    FString SecurityProfile = TEXT("dev");
    const UMcpAutomationBridgeSettings* Settings = GetDefault<UMcpAutomationBridgeSettings>();
    if (Settings)
    {
        // Could add a security profile setting in the future
        // For now, default to "dev" for development builds
#if UE_BUILD_SHIPPING
        SecurityProfile = TEXT("shipping");
#elif UE_BUILD_TEST
        SecurityProfile = TEXT("test");
#endif
    }
    Caps->SetStringField(TEXT("securityProfile"), SecurityProfile);

    // DDC configuration info (important for CI robots)
    TSharedPtr<FJsonObject> DDCInfo = MakeShared<FJsonObject>();
    DDCInfo->SetStringField(TEXT("mode"), TEXT("local")); // Could detect actual mode in future
    DDCInfo->SetStringField(TEXT("networkWarning"),
        TEXT("Zen server is unauthenticated - LAN/VPN only, not safe on public networks"));
    Caps->SetObjectField(TEXT("ddcConfig"), DDCInfo);

    // Supported actions list - comprehensive list of all registered actions
    TArray<TSharedPtr<FJsonValue>> Actions;

    // Core & Properties
    Actions.Add(MakeShared<FJsonValueString>(TEXT("execute_editor_function")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("set_object_property")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("get_object_property")));

    // Containers
    Actions.Add(MakeShared<FJsonValueString>(TEXT("array_append")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("array_remove")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("array_insert")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("array_get_element")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("array_set_element")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("array_clear")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("map_set_value")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("map_get_value")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("map_remove_key")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("map_has_key")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("map_get_keys")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("map_clear")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("set_add")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("set_remove")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("set_contains")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("set_clear")));

    // Asset Management
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_asset")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("get_asset_references")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("get_asset_dependencies")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("fixup_redirectors")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("source_control_checkout")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("source_control_submit")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("bulk_rename_assets")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("bulk_delete_assets")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("generate_thumbnail")));

    // Actor Control
    Actions.Add(MakeShared<FJsonValueString>(TEXT("control_actor")));

    // Editor Control
    Actions.Add(MakeShared<FJsonValueString>(TEXT("control_editor")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("quit_editor")));

    // Level Management
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_level")));

    // Landscape & Foliage
    Actions.Add(MakeShared<FJsonValueString>(TEXT("create_landscape")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("create_procedural_terrain")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("create_landscape_grass_type")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("sculpt_landscape")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("set_landscape_material")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("edit_landscape")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("add_foliage_type")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("create_procedural_foliage")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("paint_foliage")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("add_foliage_instances")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("remove_foliage")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("get_foliage_instances")));

    // Niagara
    Actions.Add(MakeShared<FJsonValueString>(TEXT("create_niagara_system")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("create_niagara_ribbon")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("create_niagara_emitter")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("spawn_niagara_actor")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("modify_niagara_parameter")));

    // Animation
    Actions.Add(MakeShared<FJsonValueString>(TEXT("create_anim_blueprint")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("play_anim_montage")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("setup_ragdoll")));

    // Material
    Actions.Add(MakeShared<FJsonValueString>(TEXT("add_material_texture_sample")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("add_material_expression")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("create_material_nodes")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("rebuild_material")));

    // Sequencer
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_sequence")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("add_sequencer_keyframe")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_sequencer_track")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("add_camera_track")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("add_animation_track")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("add_transform_track")));

    // UI & Environment
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_ui")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("control_environment")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("build_environment")));

    // Tools & System
    Actions.Add(MakeShared<FJsonValueString>(TEXT("console_command")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("inspect")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("system_control")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("describe_capabilities")));

    // Blueprint
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_blueprint")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_blueprint_graph")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("list_blueprints")));

    // World & Render
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_world_partition")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_render")));

    // Input
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_input")));

    // Behavior Trees
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_behavior_tree")));

    // Audio & Lighting
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_audio")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_lighting")));

    // Physics & Effects
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_physics")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_effect")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("create_effect")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("clear_debug_shapes")));

    // Performance
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_performance")));

    // Python Execution
    Actions.Add(MakeShared<FJsonValueString>(TEXT("execute_python")));

    // Game Framework Phases
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_skeleton")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_material_authoring")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_texture")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_animation_authoring")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_audio_authoring")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_niagara_authoring")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_gas")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_character")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_combat")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_ai")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_inventory")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_interaction")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_widget_authoring")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_networking")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_game_framework")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_sessions")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_level_structure")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_volumes")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_navigation")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_splines")));

    // Pipeline & Testing
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_pipeline")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_test")));

    // Logging & Debug
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_log")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_debug")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_insights")));
    Actions.Add(MakeShared<FJsonValueString>(TEXT("manage_asset_query")));

    Caps->SetArrayField(TEXT("supportedActions"), Actions);

    // Allowlisted paths (for CI security) - these are template patterns
    TArray<TSharedPtr<FJsonValue>> AllowedPaths;
    AllowedPaths.Add(MakeShared<FJsonValueString>(TEXT("${PROJECT_DIR}/**")));
    AllowedPaths.Add(MakeShared<FJsonValueString>(TEXT("${ENGINE_DIR}/Build/**")));
    AllowedPaths.Add(MakeShared<FJsonValueString>(TEXT("${ENGINE_DIR}/Content/**")));
    AllowedPaths.Add(MakeShared<FJsonValueString>(TEXT("/Game/**")));
    AllowedPaths.Add(MakeShared<FJsonValueString>(TEXT("/Engine/**")));
    Caps->SetArrayField(TEXT("allowlistedPaths"), AllowedPaths);

    // Allowlisted console commands (safe for automation)
    TArray<TSharedPtr<FJsonValue>> AllowedCommands;
    AllowedCommands.Add(MakeShared<FJsonValueString>(TEXT("Automation")));
    AllowedCommands.Add(MakeShared<FJsonValueString>(TEXT("Cook")));
    AllowedCommands.Add(MakeShared<FJsonValueString>(TEXT("CompileAllBlueprints")));
    AllowedCommands.Add(MakeShared<FJsonValueString>(TEXT("BuildLighting")));
    AllowedCommands.Add(MakeShared<FJsonValueString>(TEXT("BuildNavigation")));
    AllowedCommands.Add(MakeShared<FJsonValueString>(TEXT("BuildHLODs")));
    AllowedCommands.Add(MakeShared<FJsonValueString>(TEXT("Stat")));
    AllowedCommands.Add(MakeShared<FJsonValueString>(TEXT("ShowFlag")));
    AllowedCommands.Add(MakeShared<FJsonValueString>(TEXT("r.")));
    AllowedCommands.Add(MakeShared<FJsonValueString>(TEXT("t.")));
    Caps->SetArrayField(TEXT("allowlistedCommands"), AllowedCommands);

    // Platform info
    TSharedPtr<FJsonObject> PlatformInfo = MakeShared<FJsonObject>();
#if PLATFORM_WINDOWS
    PlatformInfo->SetStringField(TEXT("platform"), TEXT("Windows"));
#elif PLATFORM_MAC
    PlatformInfo->SetStringField(TEXT("platform"), TEXT("Mac"));
#elif PLATFORM_LINUX
    PlatformInfo->SetStringField(TEXT("platform"), TEXT("Linux"));
#else
    PlatformInfo->SetStringField(TEXT("platform"), TEXT("Unknown"));
#endif
    PlatformInfo->SetBoolField(TEXT("isEditor"), true);
    Caps->SetObjectField(TEXT("platformInfo"), PlatformInfo);

    SendAutomationResponse(RequestingSocket, RequestId, true,
        TEXT("Capabilities retrieved successfully"), Caps, FString());
    return true;
#else
    SendAutomationError(RequestingSocket, RequestId,
        TEXT("describe_capabilities is only available in editor builds"),
        TEXT("EDITOR_ONLY"));
    return true;
#endif
}
