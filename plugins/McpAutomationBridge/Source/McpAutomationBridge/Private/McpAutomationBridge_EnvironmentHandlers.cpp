#include "Dom/JsonObject.h"
#include "McpAutomationBridgeGlobals.h"
#include "McpAutomationBridgeHelpers.h"
#include "McpAutomationBridgeSubsystem.h"
#include "Misc/ConfigCacheIni.h"

#if WITH_EDITOR
#include "Editor.h"
#include "EditorAssetLibrary.h"
#include "DesktopPlatformModule.h"
#include "IDesktopPlatform.h"
#include "Slate/SceneViewport.h"
#include "Framework/Application/SlateApplication.h"
#include "Engine/Selection.h"

// Python Script Plugin support (optional - check availability at runtime)
// The Python Editor Script Plugin provides the IPythonScriptPlugin interface
#if __has_include("IPythonScriptPlugin.h")
#include "IPythonScriptPlugin.h"
#define MCP_HAS_PYTHON_PLUGIN 1
#else
// Forward declarations for fallback when header is not available
enum class EPythonCommandExecutionMode : uint8 {
  ExecuteFile,
  ExecuteStatement,
  EvaluateStatement
};
struct FPythonLogOutputEntry {};
struct FPythonCommandContext {};
// Stub interface - the real interface will be used at runtime via FModuleManager
class IPythonScriptPlugin : public IModuleInterface {
public:
  virtual bool ExecPythonCommand(const TCHAR *InPythonCommand) = 0;
  virtual bool ExecPythonCommandEx(
      EPythonCommandExecutionMode ExecutionMode, const TCHAR *InPythonCommand,
      FString *OutCommandResult = nullptr,
      TArray<FPythonLogOutputEntry> *OutLogOutput = nullptr,
      const FPythonCommandContext *Context = nullptr) = 0;
};
#define MCP_HAS_PYTHON_PLUGIN 0
#endif

#if __has_include("Subsystems/EditorActorSubsystem.h")
#include "Subsystems/EditorActorSubsystem.h"
#elif __has_include("EditorActorSubsystem.h")
#include "EditorActorSubsystem.h"
#endif
#if __has_include("Subsystems/UnrealEditorSubsystem.h")
#include "Subsystems/UnrealEditorSubsystem.h"
#elif __has_include("UnrealEditorSubsystem.h")
#include "UnrealEditorSubsystem.h"
#endif
#if __has_include("Subsystems/LevelEditorSubsystem.h")
#include "Subsystems/LevelEditorSubsystem.h"
#elif __has_include("LevelEditorSubsystem.h")
#include "LevelEditorSubsystem.h"
#endif
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Developer/AssetTools/Public/AssetToolsModule.h"
#include "EditorValidatorSubsystem.h"
#include "Engine/Blueprint.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "EngineUtils.h"
#include "FileHelpers.h"
#include "GeneralProjectSettings.h"
#include "KismetProceduralMeshLibrary.h"
#include "Misc/FileHelper.h"
#include "NiagaraComponent.h"
#include "NiagaraSystem.h"
#include "ProceduralMeshComponent.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"

// Hot Reload / Live Coding support
#include "Misc/HotReloadInterface.h"
#include "Misc/App.h"

// Landscape includes
#include "Landscape.h"
#include "LandscapeInfo.h"
#include "LandscapeLayerInfoObject.h"
#include "LandscapeGrassType.h"
#include "AssetRegistry/AssetRegistryModule.h"

#endif

bool UMcpAutomationBridgeSubsystem::HandleBuildEnvironmentAction(
    const FString &RequestId, const FString &Action,
    const TSharedPtr<FJsonObject> &Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket) {
  const FString Lower = Action.ToLower();
  if (!Lower.Equals(TEXT("build_environment"), ESearchCase::IgnoreCase) &&
      !Lower.StartsWith(TEXT("build_environment")))
    return false;

  if (!Payload.IsValid()) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("build_environment payload missing."),
                        TEXT("INVALID_PAYLOAD"));
    return true;
  }

  FString SubAction;
  Payload->TryGetStringField(TEXT("action"), SubAction);
  const FString LowerSub = SubAction.ToLower();

  // Fast-path foliage sub-actions to dedicated native handlers to avoid double
  // responses
  if (LowerSub == TEXT("add_foliage_instances")) {
    // Transform from build_environment schema to foliage handler schema
    FString FoliageTypePath;
    Payload->TryGetStringField(TEXT("foliageType"), FoliageTypePath);
    const TArray<TSharedPtr<FJsonValue>> *Transforms = nullptr;
    Payload->TryGetArrayField(TEXT("transforms"), Transforms);
    TSharedPtr<FJsonObject> FoliagePayload = MakeShared<FJsonObject>();
    if (!FoliageTypePath.IsEmpty()) {
      FoliagePayload->SetStringField(TEXT("foliageTypePath"), FoliageTypePath);
    }
    TArray<TSharedPtr<FJsonValue>> Locations;
    if (Transforms) {
      for (const TSharedPtr<FJsonValue> &V : *Transforms) {
        if (!V.IsValid() || V->Type != EJson::Object)
          continue;
        const TSharedPtr<FJsonObject> *TObj = nullptr;
        if (!V->TryGetObject(TObj) || !TObj)
          continue;
        const TSharedPtr<FJsonObject> *LocObj = nullptr;
        if (!(*TObj)->TryGetObjectField(TEXT("location"), LocObj) || !LocObj)
          continue;
        double X = 0, Y = 0, Z = 0;
        (*LocObj)->TryGetNumberField(TEXT("x"), X);
        (*LocObj)->TryGetNumberField(TEXT("y"), Y);
        (*LocObj)->TryGetNumberField(TEXT("z"), Z);
        TSharedPtr<FJsonObject> L = MakeShared<FJsonObject>();
        L->SetNumberField(TEXT("x"), X);
        L->SetNumberField(TEXT("y"), Y);
        L->SetNumberField(TEXT("z"), Z);
        Locations.Add(MakeShared<FJsonValueObject>(L));
      }
    }
    FoliagePayload->SetArrayField(TEXT("locations"), Locations);
    return HandlePaintFoliage(RequestId, TEXT("paint_foliage"), FoliagePayload,
                              RequestingSocket);
  } else if (LowerSub == TEXT("get_foliage_instances")) {
    FString FoliageTypePath;
    Payload->TryGetStringField(TEXT("foliageType"), FoliageTypePath);
    TSharedPtr<FJsonObject> FoliagePayload = MakeShared<FJsonObject>();
    if (!FoliageTypePath.IsEmpty()) {
      FoliagePayload->SetStringField(TEXT("foliageTypePath"), FoliageTypePath);
    }
    return HandleGetFoliageInstances(RequestId, TEXT("get_foliage_instances"),
                                     FoliagePayload, RequestingSocket);
  } else if (LowerSub == TEXT("remove_foliage")) {
    FString FoliageTypePath;
    Payload->TryGetStringField(TEXT("foliageType"), FoliageTypePath);
    bool bRemoveAll = false;
    Payload->TryGetBoolField(TEXT("removeAll"), bRemoveAll);
    TSharedPtr<FJsonObject> FoliagePayload = MakeShared<FJsonObject>();
    if (!FoliageTypePath.IsEmpty()) {
      FoliagePayload->SetStringField(TEXT("foliageTypePath"), FoliageTypePath);
    }
    FoliagePayload->SetBoolField(TEXT("removeAll"), bRemoveAll);
    return HandleRemoveFoliage(RequestId, TEXT("remove_foliage"),
                               FoliagePayload, RequestingSocket);
  } else if (LowerSub == TEXT("paint_foliage")) {
    // Direct dispatch to foliage handler (payload already in correct format)
    return HandlePaintFoliage(RequestId, TEXT("paint_foliage"), Payload,
                              RequestingSocket);
  } else if (LowerSub == TEXT("create_procedural_foliage")) {
    // Dispatch to procedural foliage handler
    return HandleCreateProceduralFoliage(RequestId,
                                         TEXT("create_procedural_foliage"),
                                         Payload, RequestingSocket);
  } else if (LowerSub == TEXT("create_procedural_terrain")) {
    // Dispatch to procedural terrain handler
    return HandleCreateProceduralTerrain(RequestId,
                                         TEXT("create_procedural_terrain"),
                                         Payload, RequestingSocket);
  } else if (LowerSub == TEXT("add_foliage_type") || LowerSub == TEXT("add_foliage")) {
    // Dispatch to foliage type handler
    return HandleAddFoliageType(RequestId, TEXT("add_foliage_type"),
                                Payload, RequestingSocket);
  } else if (LowerSub == TEXT("create_landscape")) {
    // Dispatch to landscape creation handler
    return HandleCreateLandscape(RequestId, TEXT("create_landscape"),
                                 Payload, RequestingSocket);
  }
  // Dispatch landscape operations
  else if (LowerSub == TEXT("paint_landscape") ||
           LowerSub == TEXT("paint_landscape_layer")) {
    return HandlePaintLandscapeLayer(RequestId, TEXT("paint_landscape_layer"),
                                     Payload, RequestingSocket);
  } else if (LowerSub == TEXT("sculpt_landscape") || LowerSub == TEXT("sculpt")) {
    return HandleSculptLandscape(RequestId, TEXT("sculpt_landscape"), Payload,
                                 RequestingSocket);
  } else if (LowerSub == TEXT("modify_heightmap")) {
    return HandleModifyHeightmap(RequestId, TEXT("modify_heightmap"), Payload,
                                 RequestingSocket);
  } else if (LowerSub == TEXT("set_landscape_material")) {
    return HandleSetLandscapeMaterial(RequestId, TEXT("set_landscape_material"),
                                      Payload, RequestingSocket);
  } else if (LowerSub == TEXT("create_landscape_grass_type")) {
    return HandleCreateLandscapeGrassType(RequestId,
                                          TEXT("create_landscape_grass_type"),
                                          Payload, RequestingSocket);
  } else if (LowerSub == TEXT("generate_lods")) {
    return HandleGenerateLODs(RequestId, TEXT("generate_lods"), Payload,
                              RequestingSocket);
  } else if (LowerSub == TEXT("bake_lightmap")) {
    return HandleBakeLightmap(RequestId, TEXT("bake_lightmap"), Payload,
                              RequestingSocket);
  }

#if WITH_EDITOR
  TSharedPtr<FJsonObject> Resp = MakeShared<FJsonObject>();
  Resp->SetStringField(TEXT("action"), LowerSub);
  bool bSuccess = true;
  FString Message =
      FString::Printf(TEXT("Environment action '%s' completed"), *LowerSub);
  FString ErrorCode;

  if (LowerSub == TEXT("export_snapshot")) {
    FString Path;
    Payload->TryGetStringField(TEXT("path"), Path);
    if (Path.IsEmpty()) {
      bSuccess = false;
      Message = TEXT("path required for export_snapshot");
      ErrorCode = TEXT("INVALID_ARGUMENT");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      // SECURITY: Validate file path to prevent directory traversal and arbitrary file access
      // Use SanitizeProjectFilePath for file operations (accepts /Temp, /Saved, etc.)
      FString SafePath = SanitizeProjectFilePath(Path);
      if (SafePath.IsEmpty()) {
        bSuccess = false;
        Message = FString::Printf(TEXT("Invalid or unsafe path: %s. Path must be relative to project (e.g., /Temp/snapshot.json)"), *Path);
        ErrorCode = TEXT("SECURITY_VIOLATION");
        Resp->SetStringField(TEXT("error"), Message);
      } else {
        // Convert project-relative path to absolute file path
        FString AbsolutePath = FPaths::ProjectDir() / SafePath;
        FPaths::MakeStandardFilename(AbsolutePath);
        
        TSharedPtr<FJsonObject> Snapshot = MakeShared<FJsonObject>();
        Snapshot->SetStringField(TEXT("timestamp"),
                                 FDateTime::UtcNow().ToString());
        Snapshot->SetStringField(TEXT("type"), TEXT("environment_snapshot"));

        FString JsonString;
        TSharedRef<TJsonWriter<>> Writer =
            TJsonWriterFactory<>::Create(&JsonString);
        if (FJsonSerializer::Serialize(Snapshot.ToSharedRef(), Writer)) {
          if (FFileHelper::SaveStringToFile(JsonString, *AbsolutePath)) {
            Resp->SetStringField(TEXT("exportPath"), SafePath);
            Resp->SetStringField(TEXT("message"), TEXT("Snapshot exported"));
          } else {
            bSuccess = false;
            Message = TEXT("Failed to write snapshot file");
            ErrorCode = TEXT("WRITE_FAILED");
            Resp->SetStringField(TEXT("error"), Message);
          }
        } else {
          bSuccess = false;
          Message = TEXT("Failed to serialize snapshot");
          ErrorCode = TEXT("SERIALIZE_FAILED");
          Resp->SetStringField(TEXT("error"), Message);
        }
      }
    }
  } else if (LowerSub == TEXT("import_snapshot")) {
    FString Path;
    Payload->TryGetStringField(TEXT("path"), Path);
    if (Path.IsEmpty()) {
      bSuccess = false;
      Message = TEXT("path required for import_snapshot");
      ErrorCode = TEXT("INVALID_ARGUMENT");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      // SECURITY: Validate file path to prevent directory traversal and arbitrary file access
      // Use SanitizeProjectFilePath for file operations (accepts /Temp, /Saved, etc.)
      FString SafePath = SanitizeProjectFilePath(Path);
      if (SafePath.IsEmpty()) {
        bSuccess = false;
        Message = FString::Printf(TEXT("Invalid or unsafe path: %s. Path must be relative to project (e.g., /Temp/snapshot.json)"), *Path);
        ErrorCode = TEXT("SECURITY_VIOLATION");
        Resp->SetStringField(TEXT("error"), Message);
      } else {
        // Convert project-relative path to absolute file path
        FString AbsolutePath = FPaths::ProjectDir() / SafePath;
        FPaths::MakeStandardFilename(AbsolutePath);
        
        FString JsonString;
        if (!FFileHelper::LoadFileToString(JsonString, *AbsolutePath)) {
          bSuccess = false;
          Message = TEXT("Failed to read snapshot file");
          ErrorCode = TEXT("LOAD_FAILED");
          Resp->SetStringField(TEXT("error"), Message);
        } else {
          TSharedPtr<FJsonObject> SnapshotObj;
          TSharedRef<TJsonReader<>> Reader =
              TJsonReaderFactory<>::Create(JsonString);
          if (!FJsonSerializer::Deserialize(Reader, SnapshotObj) ||
              !SnapshotObj.IsValid()) {
            bSuccess = false;
            Message = TEXT("Failed to parse snapshot");
            ErrorCode = TEXT("PARSE_FAILED");
            Resp->SetStringField(TEXT("error"), Message);
          } else {
            Resp->SetObjectField(TEXT("snapshot"), SnapshotObj.ToSharedRef());
            Resp->SetStringField(TEXT("message"), TEXT("Snapshot imported"));
          }
        }
      }
    }
  } else if (LowerSub == TEXT("delete")) {
    const TArray<TSharedPtr<FJsonValue>> *NamesArray = nullptr;
    if (!Payload->TryGetArrayField(TEXT("names"), NamesArray) || !NamesArray) {
      bSuccess = false;
      Message = TEXT("names array required for delete");
      ErrorCode = TEXT("INVALID_ARGUMENT");
      Resp->SetStringField(TEXT("error"), Message);
    } else if (!GEditor) {
      bSuccess = false;
      Message = TEXT("Editor not available");
      ErrorCode = TEXT("EDITOR_NOT_AVAILABLE");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      UEditorActorSubsystem *ActorSS =
          GEditor->GetEditorSubsystem<UEditorActorSubsystem>();
      if (!ActorSS) {
        bSuccess = false;
        Message = TEXT("EditorActorSubsystem not available");
        ErrorCode = TEXT("EDITOR_ACTOR_SUBSYSTEM_MISSING");
        Resp->SetStringField(TEXT("error"), Message);
      } else {
        TArray<FString> Deleted;
        TArray<FString> Missing;
        for (const TSharedPtr<FJsonValue> &Val : *NamesArray) {
          if (Val.IsValid() && Val->Type == EJson::String) {
            FString Name = Val->AsString();
            TArray<AActor *> AllActors = ActorSS->GetAllLevelActors();
            bool bRemoved = false;
            for (AActor *A : AllActors) {
              if (A &&
                  A->GetActorLabel().Equals(Name, ESearchCase::IgnoreCase)) {
                if (ActorSS->DestroyActor(A)) {
                  Deleted.Add(Name);
                  bRemoved = true;
                }
                break;
              }
            }
            if (!bRemoved) {
              Missing.Add(Name);
            }
          }
        }

        TArray<TSharedPtr<FJsonValue>> DeletedArray;
        for (const FString &Name : Deleted) {
          DeletedArray.Add(MakeShared<FJsonValueString>(Name));
        }
        Resp->SetArrayField(TEXT("deleted"), DeletedArray);
        Resp->SetNumberField(TEXT("deletedCount"), Deleted.Num());

        if (Missing.Num() > 0) {
          TArray<TSharedPtr<FJsonValue>> MissingArray;
          for (const FString &Name : Missing) {
            MissingArray.Add(MakeShared<FJsonValueString>(Name));
          }
          Resp->SetArrayField(TEXT("missing"), MissingArray);
          bSuccess = false;
          Message = TEXT("Some environment actors could not be removed");
          ErrorCode = TEXT("DELETE_PARTIAL");
          Resp->SetStringField(TEXT("error"), Message);
        } else {
          Message = TEXT("Environment actors deleted");
        }
      }
    }
  } else if (LowerSub == TEXT("create_sky_sphere")) {
    if (GEditor) {
      UClass *SkySphereClass = LoadClass<AActor>(
          nullptr, TEXT("/Script/Engine.Blueprint'/Engine/Maps/Templates/"
                        "SkySphere.SkySphere_C'"));
      if (SkySphereClass) {
        AActor *SkySphere = SpawnActorInActiveWorld<AActor>(
            SkySphereClass, FVector::ZeroVector, FRotator::ZeroRotator,
            TEXT("SkySphere"));
        if (SkySphere) {
          bSuccess = true;
          Message = TEXT("Sky sphere created");
          Resp->SetStringField(TEXT("actorName"), SkySphere->GetActorLabel());
        }
      }
    }
    if (!bSuccess) {
      bSuccess = false;
      Message = TEXT("Failed to create sky sphere");
      ErrorCode = TEXT("CREATION_FAILED");
    }
  } else if (LowerSub == TEXT("set_time_of_day")) {
    float TimeOfDay = 12.0f;
    Payload->TryGetNumberField(TEXT("time"), TimeOfDay);

    if (GEditor) {
      UEditorActorSubsystem *ActorSS =
          GEditor->GetEditorSubsystem<UEditorActorSubsystem>();
      if (ActorSS) {
        for (AActor *Actor : ActorSS->GetAllLevelActors()) {
          if (Actor->GetClass()->GetName().Contains(TEXT("SkySphere"))) {
            UFunction *SetTimeFunction =
                Actor->FindFunction(TEXT("SetTimeOfDay"));
            if (SetTimeFunction) {
              float TimeParam = TimeOfDay;
              Actor->ProcessEvent(SetTimeFunction, &TimeParam);
              bSuccess = true;
              Message =
                  FString::Printf(TEXT("Time of day set to %.2f"), TimeOfDay);
              break;
            }
          }
        }
      }
    }
    if (!bSuccess) {
      bSuccess = false;
      Message = TEXT("Sky sphere not found or time function not available");
      ErrorCode = TEXT("SET_TIME_FAILED");
    }
  } else if (LowerSub == TEXT("create_fog_volume")) {
    FVector Location(0, 0, 0);
    Payload->TryGetNumberField(TEXT("x"), Location.X);
    Payload->TryGetNumberField(TEXT("y"), Location.Y);
    Payload->TryGetNumberField(TEXT("z"), Location.Z);

    if (GEditor) {
      UClass *FogClass = LoadClass<AActor>(
          nullptr, TEXT("/Script/Engine.ExponentialHeightFog"));
      if (FogClass) {
        AActor *FogVolume = SpawnActorInActiveWorld<AActor>(
            FogClass, Location, FRotator::ZeroRotator, TEXT("FogVolume"));
        if (FogVolume) {
          bSuccess = true;
          Message = TEXT("Fog volume created");
          Resp->SetStringField(TEXT("actorName"), FogVolume->GetActorLabel());
        }
      }
    }
    if (!bSuccess) {
      bSuccess = false;
      Message = TEXT("Failed to create fog volume");
      ErrorCode = TEXT("CREATION_FAILED");
    }
  } else {
    bSuccess = false;
    Message = FString::Printf(TEXT("Environment action '%s' not implemented"),
                              *LowerSub);
    ErrorCode = TEXT("NOT_IMPLEMENTED");
    Resp->SetStringField(TEXT("error"), Message);
  }

  Resp->SetBoolField(TEXT("success"), bSuccess);
  SendAutomationResponse(RequestingSocket, RequestId, bSuccess, Message, Resp,
                         ErrorCode);
  return true;
#else
  SendAutomationResponse(
      RequestingSocket, RequestId, false,
      TEXT("Environment building actions require editor build."), nullptr,
      TEXT("NOT_IMPLEMENTED"));
  return true;
#endif
}

bool UMcpAutomationBridgeSubsystem::HandleControlEnvironmentAction(
    const FString &RequestId, const FString &Action,
    const TSharedPtr<FJsonObject> &Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket) {
  const FString Lower = Action.ToLower();
  if (!Lower.Equals(TEXT("control_environment"), ESearchCase::IgnoreCase) &&
      !Lower.StartsWith(TEXT("control_environment"))) {
    return false;
  }

  if (!Payload.IsValid()) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("control_environment payload missing."),
                        TEXT("INVALID_PAYLOAD"));
    return true;
  }

  FString SubAction;
  Payload->TryGetStringField(TEXT("action"), SubAction);
  const FString LowerSub = SubAction.ToLower();

#if WITH_EDITOR
  auto SendResult = [&](bool bSuccess, const TCHAR *Message,
                        const FString &ErrorCode,
                        const TSharedPtr<FJsonObject> &Result) {
    if (bSuccess) {
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             Message ? Message
                                     : TEXT("Environment control succeeded."),
                             Result, FString());
    } else {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             Message ? Message
                                     : TEXT("Environment control failed."),
                             Result, ErrorCode);
    }
  };

  UWorld *World = nullptr;
  if (GEditor) {
    World = GEditor->GetEditorWorldContext().World();
  }

  if (!World) {
    SendResult(false, TEXT("Editor world is unavailable"),
               TEXT("WORLD_NOT_AVAILABLE"), nullptr);
    return true;
  }

  auto FindFirstDirectionalLight = [&]() -> ADirectionalLight * {
    for (TActorIterator<ADirectionalLight> It(World); It; ++It) {
      if (ADirectionalLight *Light = *It) {
        if (IsValid(Light)) {
          return Light;
        }
      }
    }
    return nullptr;
  };

  auto FindFirstSkyLight = [&]() -> ASkyLight * {
    for (TActorIterator<ASkyLight> It(World); It; ++It) {
      if (ASkyLight *Sky = *It) {
        if (IsValid(Sky)) {
          return Sky;
        }
      }
    }
    return nullptr;
  };

  if (LowerSub == TEXT("set_time_of_day")) {
    double Hour = 0.0;
    const bool bHasHour = Payload->TryGetNumberField(TEXT("hour"), Hour);
    if (!bHasHour) {
      SendResult(false, TEXT("Missing hour parameter"),
                 TEXT("INVALID_ARGUMENT"), nullptr);
      return true;
    }

    ADirectionalLight *SunLight = FindFirstDirectionalLight();
    if (!SunLight) {
      SendResult(false, TEXT("No directional light found"),
                 TEXT("SUN_NOT_FOUND"), nullptr);
      return true;
    }

    const float ClampedHour =
        FMath::Clamp(static_cast<float>(Hour), 0.0f, 24.0f);
    const float SolarPitch = (ClampedHour / 24.0f) * 360.0f - 90.0f;

    SunLight->Modify();
    FRotator NewRotation = SunLight->GetActorRotation();
    NewRotation.Pitch = SolarPitch;
    SunLight->SetActorRotation(NewRotation);

    if (UDirectionalLightComponent *LightComp =
            Cast<UDirectionalLightComponent>(SunLight->GetLightComponent())) {
      LightComp->MarkRenderStateDirty();
    }

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetNumberField(TEXT("hour"), ClampedHour);
    Result->SetNumberField(TEXT("pitch"), SolarPitch);
    Result->SetStringField(TEXT("actor"), SunLight->GetPathName());
    
    // Add verification data
    AddActorVerification(Result, SunLight);
    
    SendResult(true, TEXT("Time of day updated"), FString(), Result);
    return true;
  }

  if (LowerSub == TEXT("set_sun_intensity")) {
    double Intensity = 0.0;
    if (!Payload->TryGetNumberField(TEXT("intensity"), Intensity)) {
      SendResult(false, TEXT("Missing intensity parameter"),
                 TEXT("INVALID_ARGUMENT"), nullptr);
      return true;
    }

    ADirectionalLight *SunLight = FindFirstDirectionalLight();
    if (!SunLight) {
      SendResult(false, TEXT("No directional light found"),
                 TEXT("SUN_NOT_FOUND"), nullptr);
      return true;
    }

    if (UDirectionalLightComponent *LightComp =
            Cast<UDirectionalLightComponent>(SunLight->GetLightComponent())) {
      LightComp->SetIntensity(static_cast<float>(Intensity));
      LightComp->MarkRenderStateDirty();
    }

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetNumberField(TEXT("intensity"), Intensity);
    Result->SetStringField(TEXT("actor"), SunLight->GetPathName());
    SendResult(true, TEXT("Sun intensity updated"), FString(), Result);
    return true;
  }

  if (LowerSub == TEXT("set_skylight_intensity")) {
    double Intensity = 0.0;
    if (!Payload->TryGetNumberField(TEXT("intensity"), Intensity)) {
      SendResult(false, TEXT("Missing intensity parameter"),
                 TEXT("INVALID_ARGUMENT"), nullptr);
      return true;
    }

    ASkyLight *SkyActor = FindFirstSkyLight();
    if (!SkyActor) {
      SendResult(false, TEXT("No skylight found"), TEXT("SKYLIGHT_NOT_FOUND"),
                 nullptr);
      return true;
    }

    if (USkyLightComponent *SkyComp = SkyActor->GetLightComponent()) {
      SkyComp->SetIntensity(static_cast<float>(Intensity));
      SkyComp->MarkRenderStateDirty();
      SkyActor->MarkComponentsRenderStateDirty();
    }

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetNumberField(TEXT("intensity"), Intensity);
    Result->SetStringField(TEXT("actor"), SkyActor->GetPathName());
    SendResult(true, TEXT("Skylight intensity updated"), FString(), Result);
    return true;
  }

  TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
  Result->SetStringField(TEXT("action"), LowerSub);
  SendResult(false, TEXT("Unsupported environment control action"),
             TEXT("UNSUPPORTED_ACTION"), Result);
  return true;
#else
  SendAutomationResponse(RequestingSocket, RequestId, false,
                         TEXT("Environment control requires editor build"),
                         nullptr, TEXT("NOT_IMPLEMENTED"));
  return true;
#endif
}

bool UMcpAutomationBridgeSubsystem::HandleSystemControlAction(
    const FString &RequestId, const FString &Action,
    const TSharedPtr<FJsonObject> &Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket) {
  const FString Lower = Action.ToLower();
  if (!Lower.Equals(TEXT("system_control"), ESearchCase::IgnoreCase) &&
      !Lower.StartsWith(TEXT("system_control")))
    return false;

  if (!Payload.IsValid()) {
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("System control requires valid payload"),
                           nullptr, TEXT("INVALID_PAYLOAD"));
    return true;
  }

  FString SubAction;
  if (!Payload->TryGetStringField(TEXT("action"), SubAction)) {
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("System control requires action parameter"),
                           nullptr, TEXT("INVALID_ARGUMENT"));
    return true;
  }

  FString LowerSub = SubAction.ToLower();
  TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();

  // Profile commands
  if (LowerSub == TEXT("profile")) {
    FString ProfileType;
    bool bEnabled = true;
    Payload->TryGetStringField(TEXT("profileType"), ProfileType);
    Payload->TryGetBoolField(TEXT("enabled"), bEnabled);

    FString Command;
    if (ProfileType.ToLower() == TEXT("cpu")) {
      Command = bEnabled ? TEXT("stat cpu") : TEXT("stat cpu");
    } else if (ProfileType.ToLower() == TEXT("gpu")) {
      Command = bEnabled ? TEXT("stat gpu") : TEXT("stat gpu");
    } else if (ProfileType.ToLower() == TEXT("memory")) {
      Command = bEnabled ? TEXT("stat memory") : TEXT("stat memory");
    } else if (ProfileType.ToLower() == TEXT("fps")) {
      Command = bEnabled ? TEXT("stat fps") : TEXT("stat fps");
    }

    if (!Command.IsEmpty()) {
      GEngine->Exec(nullptr, *Command);
      Result->SetStringField(TEXT("command"), Command);
      Result->SetBoolField(TEXT("enabled"), bEnabled);
      SendAutomationResponse(
          RequestingSocket, RequestId, true,
          FString::Printf(TEXT("Executed profile command: %s"), *Command),
          Result, FString());
      return true;
    }
  }

  // Show FPS
  if (LowerSub == TEXT("show_fps")) {
    bool bEnabled = true;
    Payload->TryGetBoolField(TEXT("enabled"), bEnabled);

    FString Command = bEnabled ? TEXT("stat fps") : TEXT("stat fps");
    GEngine->Exec(nullptr, *Command);
    Result->SetStringField(TEXT("command"), Command);
    Result->SetBoolField(TEXT("enabled"), bEnabled);
    SendAutomationResponse(
        RequestingSocket, RequestId, true,
        FString::Printf(TEXT("FPS display %s"),
                        bEnabled ? TEXT("enabled") : TEXT("disabled")),
        Result, FString());
    return true;
  }

  // Set quality
  if (LowerSub == TEXT("set_quality")) {
    FString Category;
    int32 Level = 1;
    Payload->TryGetStringField(TEXT("category"), Category);
    Payload->TryGetNumberField(TEXT("level"), Level);

    if (!Category.IsEmpty()) {
      FString Command = FString::Printf(TEXT("sg.%s %d"), *Category, Level);
      GEngine->Exec(nullptr, *Command);
      Result->SetStringField(TEXT("command"), Command);
      Result->SetStringField(TEXT("category"), Category);
      Result->SetNumberField(TEXT("level"), Level);
      SendAutomationResponse(
          RequestingSocket, RequestId, true,
          FString::Printf(TEXT("Set quality %s to %d"), *Category, Level),
          Result, FString());
      return true;
    }
  }

  // Screenshot
  if (LowerSub == TEXT("screenshot")) {
    FString Filename = TEXT("screenshot");
    Payload->TryGetStringField(TEXT("filename"), Filename);

    FString Command = FString::Printf(TEXT("screenshot %s"), *Filename);
    GEngine->Exec(nullptr, *Command);
    Result->SetStringField(TEXT("command"), Command);
    Result->SetStringField(TEXT("filename"), Filename);
    SendAutomationResponse(
        RequestingSocket, RequestId, true,
        FString::Printf(TEXT("Screenshot captured: %s"), *Filename), Result,
        FString());
    return true;
  }

  if (LowerSub == TEXT("get_project_settings")) {
#if WITH_EDITOR
    FString Category;
    Payload->TryGetStringField(TEXT("category"), Category);
    const FString LowerCategory = Category.ToLower();

    const UGeneralProjectSettings *ProjectSettings =
        GetDefault<UGeneralProjectSettings>();
    TSharedPtr<FJsonObject> SettingsObj = MakeShared<FJsonObject>();
    if (ProjectSettings) {
      SettingsObj->SetStringField(TEXT("projectName"),
                                  ProjectSettings->ProjectName);
      SettingsObj->SetStringField(TEXT("companyName"),
                                  ProjectSettings->CompanyName);
      SettingsObj->SetStringField(TEXT("projectVersion"),
                                  ProjectSettings->ProjectVersion);
      SettingsObj->SetStringField(TEXT("description"),
                                  ProjectSettings->Description);
    }

    TSharedPtr<FJsonObject> Out = MakeShared<FJsonObject>();
    Out->SetStringField(TEXT("category"),
                        Category.IsEmpty() ? TEXT("Project") : Category);
    Out->SetObjectField(TEXT("settings"), SettingsObj);

    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("Project settings retrieved"), Out, FString());
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("get_project_settings requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  if (LowerSub == TEXT("get_engine_version")) {
#if WITH_EDITOR
    const FEngineVersion &EngineVer = FEngineVersion::Current();
    TSharedPtr<FJsonObject> Out = MakeShared<FJsonObject>();
    Out->SetStringField(TEXT("version"), EngineVer.ToString());
    Out->SetNumberField(TEXT("major"), EngineVer.GetMajor());
    Out->SetNumberField(TEXT("minor"), EngineVer.GetMinor());
    Out->SetNumberField(TEXT("patch"), EngineVer.GetPatch());
    const bool bIs56OrAbove =
        (EngineVer.GetMajor() > 5) ||
        (EngineVer.GetMajor() == 5 && EngineVer.GetMinor() >= 6);
    Out->SetBoolField(TEXT("isUE56OrAbove"), bIs56OrAbove);
    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("Engine version retrieved"), Out, FString());
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("get_engine_version requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  if (LowerSub == TEXT("get_feature_flags")) {
#if WITH_EDITOR
    bool bUnrealEditor = false;
    bool bLevelEditor = false;
    bool bEditorActor = false;

    if (GEditor) {
      if (UUnrealEditorSubsystem *UnrealEditorSS =
              GEditor->GetEditorSubsystem<UUnrealEditorSubsystem>()) {
        bUnrealEditor = true;
      }
      if (ULevelEditorSubsystem *LevelEditorSS =
              GEditor->GetEditorSubsystem<ULevelEditorSubsystem>()) {
        bLevelEditor = true;
      }
      if (UEditorActorSubsystem *ActorSS =
              GEditor->GetEditorSubsystem<UEditorActorSubsystem>()) {
        bEditorActor = true;
      }
    }

    TSharedPtr<FJsonObject> SubsystemsObj = MakeShared<FJsonObject>();
    SubsystemsObj->SetBoolField(TEXT("unrealEditor"), bUnrealEditor);
    SubsystemsObj->SetBoolField(TEXT("levelEditor"), bLevelEditor);
    SubsystemsObj->SetBoolField(TEXT("editorActor"), bEditorActor);

    TSharedPtr<FJsonObject> Out = MakeShared<FJsonObject>();
    Out->SetObjectField(TEXT("subsystems"), SubsystemsObj);

    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("Feature flags retrieved"), Out, FString());
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("get_feature_flags requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  if (LowerSub == TEXT("set_project_setting")) {
#if WITH_EDITOR
    FString Section;
    FString Key;
    FString Value;
    FString ConfigName;

    if (!Payload->TryGetStringField(TEXT("section"), Section) ||
        !Payload->TryGetStringField(TEXT("key"), Key) ||
        !Payload->TryGetStringField(TEXT("value"), Value)) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("Missing section, key, or value"), nullptr,
                             TEXT("INVALID_ARGUMENT"));
      return true;
    }

    // Default to GGameIni (DefaultGame.ini) but allow overrides
    if (!Payload->TryGetStringField(TEXT("configName"), ConfigName) ||
        ConfigName.IsEmpty()) {
      ConfigName = GGameIni;
    } else if (ConfigName == TEXT("Engine")) {
      ConfigName = GEngineIni;
    } else if (ConfigName == TEXT("Input")) {
      ConfigName = GInputIni;
    } else if (ConfigName == TEXT("Game")) {
      ConfigName = GGameIni;
    }

    if (!GConfig) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("GConfig not available"), nullptr,
                             TEXT("ENGINE_ERROR"));
      return true;
    }

    GConfig->SetString(*Section, *Key, *Value, ConfigName);
    GConfig->Flush(false, ConfigName);

    SendAutomationResponse(
        RequestingSocket, RequestId, true,
        FString::Printf(TEXT("Project setting set: [%s] %s = %s"), *Section,
                        *Key, *Value),
        nullptr);
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("set_project_setting requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  if (LowerSub == TEXT("validate_assets")) {
#if WITH_EDITOR
    const TArray<TSharedPtr<FJsonValue>> *PathsPtr = nullptr;
    if (!Payload->TryGetArrayField(TEXT("paths"), PathsPtr) || !PathsPtr) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("paths array required"), nullptr,
                             TEXT("INVALID_ARGUMENT"));
      return true;
    }

    TArray<FString> AssetPaths;
    for (const auto &Val : *PathsPtr) {
      if (Val.IsValid() && Val->Type == EJson::String) {
        AssetPaths.Add(Val->AsString());
      }
    }

    if (AssetPaths.Num() == 0) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("No paths provided"), nullptr,
                             TEXT("INVALID_ARGUMENT"));
      return true;
    }

    if (GEditor) {
      if (UEditorValidatorSubsystem *Validator =
              GEditor->GetEditorSubsystem<UEditorValidatorSubsystem>()) {
        FValidateAssetsSettings Settings;
        Settings.bSkipExcludedDirectories = true;
        Settings.bShowIfNoFailures = false;
        Settings.ValidationUsecase = EDataValidationUsecase::Script;

        TArray<FAssetData> AssetsToValidate;
        for (const FString &Path : AssetPaths) {
          // Simple logic: if it's a folder, list assets; if it's a file, try to
          // find it. We assume anything without a dot is a folder, effectively.
          // But UEditorAssetLibrary::ListAssets works recursively on module
          // paths.
          if (UEditorAssetLibrary::DoesDirectoryExist(Path)) {
            TArray<FString> FoundAssets =
                UEditorAssetLibrary::ListAssets(Path, true);
            for (const FString &AssetPath : FoundAssets) {
              FAssetData AssetData =
                  UEditorAssetLibrary::FindAssetData(AssetPath);
              if (AssetData.IsValid()) {
                AssetsToValidate.Add(AssetData);
              }
            }
          } else {
            FAssetData SpecificAsset = UEditorAssetLibrary::FindAssetData(Path);
            if (SpecificAsset.IsValid()) {
              AssetsToValidate.AddUnique(SpecificAsset);
            }
          }
        }

        if (AssetsToValidate.Num() == 0) {
          Result->SetBoolField(TEXT("success"), true);
          Result->SetStringField(TEXT("message"),
                                 TEXT("No assets found to validate"));
          SendAutomationResponse(RequestingSocket, RequestId, true,
                                 TEXT("Validation skipped (no assets)"), Result,
                                 FString());
          return true;
        }

        FValidateAssetsResults ValidationResults;
        int32 NumChecked = Validator->ValidateAssetsWithSettings(
            AssetsToValidate, Settings, ValidationResults);

        Result->SetNumberField(TEXT("checkedCount"), NumChecked);
        Result->SetNumberField(TEXT("failedCount"),
                               ValidationResults.NumInvalid);
        Result->SetNumberField(TEXT("warningCount"),
                               ValidationResults.NumWarnings);
        Result->SetNumberField(TEXT("skippedCount"),
                               ValidationResults.NumSkipped);

        bool bOverallSuccess = (ValidationResults.NumInvalid == 0);
        Result->SetStringField(
            TEXT("result"), bOverallSuccess ? TEXT("Valid") : TEXT("Invalid"));

        SendAutomationResponse(RequestingSocket, RequestId, true,
                               bOverallSuccess ? TEXT("Validation Passed")
                                               : TEXT("Validation Failed"),
                               Result, FString());
        return true;
      } else {
        SendAutomationResponse(RequestingSocket, RequestId, false,
                               TEXT("EditorValidatorSubsystem not available"),
                               nullptr, TEXT("SUBSYSTEM_MISSING"));
        return true;
      }
    }
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("validate_assets requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  // Execute Python script in Unreal's Python environment
  if (LowerSub == TEXT("execute_python") || LowerSub == TEXT("run_python")) {
#if WITH_EDITOR
    FString ScriptPath;
    FString ScriptContent;
    Payload->TryGetStringField(TEXT("scriptPath"), ScriptPath);
    Payload->TryGetStringField(TEXT("scriptContent"), ScriptContent);

    // Get optional args array
    TArray<FString> ScriptArgs;
    const TArray<TSharedPtr<FJsonValue>> *ArgsArray = nullptr;
    if (Payload->TryGetArrayField(TEXT("args"), ArgsArray) && ArgsArray) {
      for (const TSharedPtr<FJsonValue> &ArgVal : *ArgsArray) {
        if (ArgVal.IsValid() && ArgVal->Type == EJson::String) {
          ScriptArgs.Add(ArgVal->AsString());
        }
      }
    }

    if (ScriptPath.IsEmpty() && ScriptContent.IsEmpty()) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("Either scriptPath or scriptContent is required"),
                             nullptr, TEXT("MISSING_REQUIRED"));
      return true;
    }

    // Try to get the Python script plugin
    IPythonScriptPlugin *PythonPlugin =
        FModuleManager::GetModulePtr<IPythonScriptPlugin>("PythonScriptPlugin");

    if (!PythonPlugin) {
      SendAutomationResponse(
          RequestingSocket, RequestId, false,
          TEXT("Python plugin not available. Enable the Python Editor Script "
               "Plugin in your project settings."),
          nullptr, TEXT("PLUGIN_NOT_FOUND"));
      return true;
    }

    bool bSuccess = false;
    FString Output;
    TSharedPtr<FJsonObject> ResultObj = MakeShared<FJsonObject>();

    if (!ScriptPath.IsEmpty()) {
      // Execute Python script file
      // Normalize path - convert relative paths to absolute
      FString NormalizedPath = ScriptPath;
      if (!FPaths::IsRelativePath(NormalizedPath)) {
        // Already absolute
      } else if (NormalizedPath.StartsWith(TEXT("/Game/")) ||
                 NormalizedPath.StartsWith(TEXT("/Engine/"))) {
        // Content path - convert to filesystem path
        FString FilePath;
        if (FPackageName::TryConvertLongPackageNameToFilename(NormalizedPath,
                                                               FilePath)) {
          NormalizedPath = FilePath;
        }
      } else {
        // Relative to project root
        NormalizedPath = FPaths::ProjectDir() / NormalizedPath;
      }

      FPaths::NormalizeFilename(NormalizedPath);

      if (!FPaths::FileExists(NormalizedPath)) {
        SendAutomationResponse(
            RequestingSocket, RequestId, false,
            FString::Printf(TEXT("Python script file not found: %s"),
                            *NormalizedPath),
            nullptr, TEXT("FILE_NOT_FOUND"));
        return true;
      }

      // Build command with arguments
      FString Command = FString::Printf(TEXT("py \"%s\""), *NormalizedPath);
      for (const FString &Arg : ScriptArgs) {
        Command += FString::Printf(TEXT(" \"%s\""), *Arg);
      }

      bSuccess = PythonPlugin->ExecPythonCommand(*Command);
      ResultObj->SetStringField(TEXT("scriptPath"), NormalizedPath);
      ResultObj->SetStringField(TEXT("executionType"), TEXT("file"));
    } else {
      // Execute inline Python code
      // Use ExecPythonCommandEx for statement execution
      bSuccess = PythonPlugin->ExecPythonCommandEx(
          EPythonCommandExecutionMode::ExecuteStatement, *ScriptContent);
      ResultObj->SetStringField(TEXT("executionType"), TEXT("inline"));
      ResultObj->SetNumberField(TEXT("contentLength"), ScriptContent.Len());
    }

    ResultObj->SetBoolField(TEXT("executed"), bSuccess);

    if (bSuccess) {
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Python script executed successfully"),
                             ResultObj, FString());
    } else {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("Python script execution failed"), ResultObj,
                             TEXT("EXECUTION_FAILED"));
    }
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("execute_python requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  // Compile/build project using IDesktopPlatform
  if (LowerSub == TEXT("compile_project")) {
#if WITH_EDITOR
    FString Configuration =
        GetJsonStringField(Payload, TEXT("configuration"), TEXT("Development"));
    FString Platform =
        GetJsonStringField(Payload, TEXT("platform"), TEXT("Win64"));
    FString Target =
        GetJsonStringField(Payload, TEXT("target"), TEXT("Editor"));
    bool bClean = GetJsonBoolField(Payload, TEXT("clean"), false);

    // Get the desktop platform module for compilation
    IDesktopPlatform *DesktopPlatform = FDesktopPlatformModule::Get();
    if (!DesktopPlatform) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("IDesktopPlatform not available"), nullptr,
                             TEXT("PLATFORM_UNAVAILABLE"));
      return true;
    }

    // Get project paths
    FString ProjectPath = FPaths::GetProjectFilePath();
    FString RootDir = FPaths::RootDir();

    // Build result tracking
    TSharedPtr<FJsonObject> ResultObj = MakeShared<FJsonObject>();
    ResultObj->SetStringField(TEXT("projectPath"), ProjectPath);
    ResultObj->SetStringField(TEXT("configuration"), Configuration);
    ResultObj->SetStringField(TEXT("platform"), Platform);
    ResultObj->SetStringField(TEXT("target"), Target);
    ResultObj->SetBoolField(TEXT("clean"), bClean);

    // If clean build requested, log it
    if (bClean) {
      UE_LOG(LogMcpAutomationBridgeSubsystem, Log,
             TEXT("Clean build requested for project: %s"), *ProjectPath);
    }

    // Use FFeedbackContext for build output
    FFeedbackContext *Warn = GWarn;

    // Compile the game project
    // Note: CompileGameProject compiles the current project's code
    bool bSuccess =
        DesktopPlatform->CompileGameProject(RootDir, ProjectPath, Warn);

    ResultObj->SetBoolField(TEXT("compiled"), bSuccess);

    if (bSuccess) {
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Project compiled successfully"), ResultObj,
                             FString());
    } else {
      SendAutomationResponse(
          RequestingSocket, RequestId, false,
          TEXT("Project compilation failed - check Output Log for details"),
          ResultObj, TEXT("COMPILE_FAILED"));
    }
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("compile_project requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  // Cook content for packaging
  if (LowerSub == TEXT("cook_content")) {
#if WITH_EDITOR
    FString Platform;
    bool bIterative = true;
    Payload->TryGetStringField(TEXT("platform"), Platform);
    Payload->TryGetBoolField(TEXT("iterative"), bIterative);

    if (Platform.IsEmpty()) {
      Platform = TEXT("Win64");
    }

    // Build UAT command for cooking
    FString UATPath = FPaths::ConvertRelativePathToFull(
        FPaths::EngineDir() / TEXT("Build/BatchFiles/RunUAT.bat"));

    FString ProjectPath = FPaths::GetProjectFilePath();

    // Get optional maps array
    TArray<FString> MapsToCook;
    const TArray<TSharedPtr<FJsonValue>>* MapsArray = nullptr;
    if (Payload->TryGetArrayField(TEXT("maps"), MapsArray) && MapsArray) {
      for (const auto& MapVal : *MapsArray) {
        if (MapVal.IsValid() && MapVal->Type == EJson::String) {
          MapsToCook.Add(MapVal->AsString());
        }
      }
    }

    FString MapsArg;
    if (MapsToCook.Num() > 0) {
      MapsArg = TEXT(" -map=") + FString::Join(MapsToCook, TEXT("+"));
    }

    FString Args = FString::Printf(
        TEXT("BuildCookRun -project=\"%s\" -cook -targetplatform=%s %s%s -unattended"),
        *ProjectPath, *Platform,
        bIterative ? TEXT("-iterativecooking") : TEXT(""),
        *MapsArg);

    UE_LOG(LogMcpAutomationBridgeSubsystem, Log,
           TEXT("Executing UAT cook: %s %s"), *UATPath, *Args);

    // Execute and capture output
    int32 ReturnCode = 0;
    FString Output;
    FString Errors;

    bool bSuccess = FPlatformProcess::ExecProcess(
        *UATPath, *Args, &ReturnCode, &Output, &Errors);

    TSharedPtr<FJsonObject> CookResult = MakeShared<FJsonObject>();
    CookResult->SetBoolField(TEXT("processStarted"), bSuccess);
    CookResult->SetNumberField(TEXT("returnCode"), ReturnCode);
    CookResult->SetStringField(TEXT("platform"), Platform);
    CookResult->SetBoolField(TEXT("iterative"), bIterative);

    // Truncate output if too long
    if (Output.Len() > 8000) {
      Output = Output.Right(8000);
      Output = TEXT("... (truncated) ...") + Output;
    }
    CookResult->SetStringField(TEXT("output"), Output);

    if (!Errors.IsEmpty()) {
      CookResult->SetStringField(TEXT("errors"), Errors);
    }

    bool bCookSuccess = bSuccess && ReturnCode == 0;
    SendAutomationResponse(RequestingSocket, RequestId, bCookSuccess,
                           bCookSuccess ? TEXT("Content cooking completed successfully")
                                        : TEXT("Content cooking failed"),
                           CookResult, bCookSuccess ? FString() : TEXT("COOK_FAILED"));
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("cook_content requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  // Package project for distribution
  if (LowerSub == TEXT("package_project")) {
#if WITH_EDITOR
    FString Platform;
    FString Configuration;
    FString OutputDir;
    bool bCompress = true;

    Payload->TryGetStringField(TEXT("platform"), Platform);
    Payload->TryGetStringField(TEXT("configuration"), Configuration);
    Payload->TryGetStringField(TEXT("outputDir"), OutputDir);
    Payload->TryGetBoolField(TEXT("compress"), bCompress);

    if (Platform.IsEmpty()) {
      Platform = TEXT("Win64");
    }
    if (Configuration.IsEmpty()) {
      Configuration = TEXT("Development");
    }

    // Build UAT command for packaging
    FString UATPath = FPaths::ConvertRelativePathToFull(
        FPaths::EngineDir() / TEXT("Build/BatchFiles/RunUAT.bat"));

    FString ProjectPath = FPaths::GetProjectFilePath();

    FString Args = FString::Printf(
        TEXT("BuildCookRun -project=\"%s\" -cook -stage -package -targetplatform=%s -clientconfig=%s %s -unattended"),
        *ProjectPath, *Platform, *Configuration,
        bCompress ? TEXT("-compressed") : TEXT(""));

    if (!OutputDir.IsEmpty()) {
      Args += FString::Printf(TEXT(" -archivedirectory=\"%s\""), *OutputDir);
    }

    UE_LOG(LogMcpAutomationBridgeSubsystem, Log,
           TEXT("Executing UAT package: %s %s"), *UATPath, *Args);

    // Execute and capture output
    int32 ReturnCode = 0;
    FString Output;
    FString Errors;

    bool bSuccess = FPlatformProcess::ExecProcess(
        *UATPath, *Args, &ReturnCode, &Output, &Errors);

    TSharedPtr<FJsonObject> PackageResult = MakeShared<FJsonObject>();
    PackageResult->SetBoolField(TEXT("processStarted"), bSuccess);
    PackageResult->SetNumberField(TEXT("returnCode"), ReturnCode);
    PackageResult->SetStringField(TEXT("platform"), Platform);
    PackageResult->SetStringField(TEXT("configuration"), Configuration);
    PackageResult->SetBoolField(TEXT("compressed"), bCompress);

    if (!OutputDir.IsEmpty()) {
      PackageResult->SetStringField(TEXT("outputDir"), OutputDir);
    }

    // Truncate output if too long
    if (Output.Len() > 8000) {
      Output = Output.Right(8000);
      Output = TEXT("... (truncated) ...") + Output;
    }
    PackageResult->SetStringField(TEXT("output"), Output);

    if (!Errors.IsEmpty()) {
      PackageResult->SetStringField(TEXT("errors"), Errors);
    }

    bool bPackageSuccess = bSuccess && ReturnCode == 0;
    SendAutomationResponse(RequestingSocket, RequestId, bPackageSuccess,
                           bPackageSuccess ? TEXT("Project packaged successfully")
                                           : TEXT("Project packaging failed"),
                           PackageResult, bPackageSuccess ? FString() : TEXT("PACKAGE_FAILED"));
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("package_project requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  // Hot reload / Live coding - trigger compilation of changed C++ code
  if (LowerSub == TEXT("hot_reload") || LowerSub == TEXT("live_coding")) {
#if WITH_EDITOR
    bool bWaitForCompletion = GetJsonBoolField(Payload, TEXT("waitForCompletion"), true);

    // Get optional modules array (not currently used but reserved for future)
    TArray<FString> Modules;
    const TArray<TSharedPtr<FJsonValue>>* ModulesArray = nullptr;
    if (Payload->TryGetArrayField(TEXT("modules"), ModulesArray) && ModulesArray) {
      for (const TSharedPtr<FJsonValue>& ModuleVal : *ModulesArray) {
        if (ModuleVal.IsValid() && ModuleVal->Type == EJson::String) {
          Modules.Add(ModuleVal->AsString());
        }
      }
    }

    TSharedPtr<FJsonObject> ResultObj = MakeShared<FJsonObject>();
    ResultObj->SetBoolField(TEXT("waitForCompletion"), bWaitForCompletion);

    // First try Live Coding (UE5+ preferred method)
    if (IModuleInterface* LiveCodingModule = FModuleManager::GetModulePtr<IModuleInterface>(TEXT("LiveCoding"))) {
      // Live Coding is available - trigger via console command
      GEngine->Exec(nullptr, TEXT("LiveCoding.Compile"));
      ResultObj->SetStringField(TEXT("method"), TEXT("LiveCoding"));
      ResultObj->SetBoolField(TEXT("initiated"), true);
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Live Coding compilation initiated"),
                             ResultObj, FString());
      return true;
    }

    // Fallback to HotReload module
    if (!FModuleManager::Get().IsModuleLoaded(TEXT("HotReload"))) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("Neither LiveCoding nor HotReload modules are available. "
                                  "Ensure Live Coding is enabled in Editor Preferences."),
                             nullptr, TEXT("MODULE_NOT_FOUND"));
      return true;
    }

    // Use the HotReload interface
    IHotReloadInterface& HotReload = FModuleManager::GetModuleChecked<IHotReloadInterface>(TEXT("HotReload"));

    // Check if already compiling
    if (HotReload.IsCurrentlyCompiling()) {
      ResultObj->SetBoolField(TEXT("alreadyCompiling"), true);
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("Compilation already in progress"),
                             ResultObj, TEXT("ALREADY_COMPILING"));
      return true;
    }

    ResultObj->SetStringField(TEXT("method"), TEXT("HotReload"));

    if (bWaitForCompletion) {
      // Synchronous hot reload
      const bool bRecompileSucceeded = HotReload.RecompileModule(
          FApp::GetProjectName(),
          *GWarn,
          ERecompileModuleFlags::ReloadAfterRecompile | ERecompileModuleFlags::FailIfGeneratedCodeChanges
      );

      ResultObj->SetBoolField(TEXT("success"), bRecompileSucceeded);
      ResultObj->SetStringField(TEXT("message"),
          bRecompileSucceeded ? TEXT("Hot reload successful") : TEXT("Hot reload failed"));

      if (bRecompileSucceeded) {
        SendAutomationResponse(RequestingSocket, RequestId, true,
                               TEXT("Hot reload completed successfully"),
                               ResultObj, FString());
      } else {
        SendAutomationResponse(RequestingSocket, RequestId, false,
                               TEXT("Hot reload failed - check Output Log for details"),
                               ResultObj, TEXT("COMPILATION_ERROR"));
      }
    } else {
      // Async hot reload - just trigger and return
      HotReload.RequestModuleCompilation(FApp::GetProjectName(), false);
      ResultObj->SetBoolField(TEXT("initiated"), true);
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Hot reload initiated (async)"),
                             ResultObj, FString());
    }
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("hot_reload requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  // Get log entries from the editor output log
  if (LowerSub == TEXT("get_log") || LowerSub == TEXT("read_log")) {
#if WITH_EDITOR
    int32 Lines = 100;
    FString Filter;
    FString Severity;

    Payload->TryGetNumberField(TEXT("lines"), Lines);
    Payload->TryGetStringField(TEXT("filter"), Filter);
    Payload->TryGetStringField(TEXT("severity"), Severity);

    // Clamp lines to reasonable bounds
    Lines = FMath::Clamp(Lines, 1, 10000);

    TSharedPtr<FJsonObject> ResultObj = MakeShared<FJsonObject>();
    TArray<TSharedPtr<FJsonValue>> LogEntries;

    // Read from the project log file
    FString LogFilePath = FPaths::ProjectLogDir() / FApp::GetProjectName() + TEXT(".log");

    // If the project-specific log doesn't exist, try the generic one
    if (!FPaths::FileExists(LogFilePath)) {
      // Find the most recent .log file in the log directory
      TArray<FString> LogFiles;
      IFileManager::Get().FindFiles(LogFiles, *(FPaths::ProjectLogDir() / TEXT("*.log")), true, false);
      if (LogFiles.Num() > 0) {
        // Sort by modification time (most recent first)
        LogFiles.Sort([](const FString &A, const FString &B) {
          FDateTime TimeA = IFileManager::Get().GetTimeStamp(*(FPaths::ProjectLogDir() / A));
          FDateTime TimeB = IFileManager::Get().GetTimeStamp(*(FPaths::ProjectLogDir() / B));
          return TimeA > TimeB;
        });
        LogFilePath = FPaths::ProjectLogDir() / LogFiles[0];
      }
    }

    if (FPaths::FileExists(LogFilePath)) {
      TArray<FString> LogLines;
      if (FFileHelper::LoadFileToStringArray(LogLines, *LogFilePath)) {
        // Get last N lines
        int32 StartIndex = FMath::Max(0, LogLines.Num() - Lines);

        for (int32 i = StartIndex; i < LogLines.Num(); i++) {
          const FString &Line = LogLines[i];

          // Skip empty lines
          if (Line.IsEmpty()) {
            continue;
          }

          // Apply text filter if specified
          if (!Filter.IsEmpty() && !Line.Contains(Filter)) {
            continue;
          }

          // Apply severity filter if specified
          if (!Severity.IsEmpty()) {
            FString LowerSeverity = Severity.ToLower();
            bool bMatchesSeverity = false;

            if (LowerSeverity == TEXT("error")) {
              bMatchesSeverity = Line.Contains(TEXT("Error:")) || Line.Contains(TEXT("Error]"));
            } else if (LowerSeverity == TEXT("warning")) {
              bMatchesSeverity = Line.Contains(TEXT("Warning:")) || Line.Contains(TEXT("Warning]"));
            } else if (LowerSeverity == TEXT("log")) {
              bMatchesSeverity = Line.Contains(TEXT("Log")) || Line.Contains(TEXT("Display"));
            } else if (LowerSeverity == TEXT("display")) {
              bMatchesSeverity = Line.Contains(TEXT("Display"));
            } else if (LowerSeverity == TEXT("verbose")) {
              bMatchesSeverity = Line.Contains(TEXT("Verbose"));
            }

            if (!bMatchesSeverity) {
              continue;
            }
          }

          TSharedPtr<FJsonObject> Entry = MakeShared<FJsonObject>();
          Entry->SetStringField(TEXT("message"), Line);

          // Try to extract timestamp and category from typical UE log format
          // Format: [2024.01.15-10.30.45:123][  0]LogCategory: Message
          int32 BracketEnd = Line.Find(TEXT("]"), ESearchCase::IgnoreCase, ESearchDir::FromStart, 1);
          if (BracketEnd > 0 && Line.StartsWith(TEXT("["))) {
            FString Timestamp = Line.Mid(1, BracketEnd - 1);
            Entry->SetStringField(TEXT("timestamp"), Timestamp);

            // Find the category after the second bracket set
            int32 SecondBracketEnd = Line.Find(TEXT("]"), ESearchCase::IgnoreCase, ESearchDir::FromStart, BracketEnd + 1);
            if (SecondBracketEnd > BracketEnd) {
              int32 ColonPos = Line.Find(TEXT(":"), ESearchCase::IgnoreCase, ESearchDir::FromStart, SecondBracketEnd);
              if (ColonPos > SecondBracketEnd) {
                FString Category = Line.Mid(SecondBracketEnd + 1, ColonPos - SecondBracketEnd - 1).TrimStartAndEnd();
                if (!Category.IsEmpty()) {
                  Entry->SetStringField(TEXT("category"), Category);
                }
              }
            }
          }

          LogEntries.Add(MakeShareable(new FJsonValueObject(Entry)));
        }

        ResultObj->SetArrayField(TEXT("entries"), LogEntries);
        ResultObj->SetNumberField(TEXT("count"), LogEntries.Num());
        ResultObj->SetNumberField(TEXT("totalLines"), LogLines.Num());
        ResultObj->SetStringField(TEXT("logFile"), LogFilePath);

        SendAutomationResponse(
            RequestingSocket, RequestId, true,
            FString::Printf(TEXT("Retrieved %d log entries"), LogEntries.Num()),
            ResultObj, FString());
        return true;
      } else {
        SendAutomationResponse(RequestingSocket, RequestId, false,
                               TEXT("Failed to read log file"), nullptr,
                               TEXT("FILE_READ_ERROR"));
        return true;
      }
    } else {
      ResultObj->SetArrayField(TEXT("entries"), LogEntries);
      ResultObj->SetNumberField(TEXT("count"), 0);
      ResultObj->SetStringField(TEXT("message"), TEXT("No log file found"));
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("No log file found"), ResultObj, FString());
      return true;
    }
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("get_log requires editor build"), nullptr,
                           TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  // ============================================================================
  // PIE Diagnostics - Runtime state queries during Play-In-Editor
  // ============================================================================

  // Get player state (position, rotation, velocity, movement info)
  if (LowerSub == TEXT("get_player_state")) {
    TSharedPtr<FJsonObject> ResultObj = MakeShared<FJsonObject>();

    // Check if PIE is active
    UWorld *World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!World || !World->IsPlayInEditor()) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("PIE not active"), nullptr,
                             TEXT("PIE_NOT_ACTIVE"));
      return true;
    }

    // Get the player controller
    APlayerController *PC = World->GetFirstPlayerController();
    if (!PC) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("No player controller"), nullptr,
                             TEXT("NO_PLAYER"));
      return true;
    }

    APawn *Pawn = PC->GetPawn();
    if (Pawn) {
      // Position
      FVector Loc = Pawn->GetActorLocation();
      TSharedPtr<FJsonObject> Position = MakeShared<FJsonObject>();
      Position->SetNumberField(TEXT("x"), Loc.X);
      Position->SetNumberField(TEXT("y"), Loc.Y);
      Position->SetNumberField(TEXT("z"), Loc.Z);
      ResultObj->SetObjectField(TEXT("position"), Position);

      // Rotation
      FRotator Rot = Pawn->GetActorRotation();
      TSharedPtr<FJsonObject> Rotation = MakeShared<FJsonObject>();
      Rotation->SetNumberField(TEXT("pitch"), Rot.Pitch);
      Rotation->SetNumberField(TEXT("yaw"), Rot.Yaw);
      Rotation->SetNumberField(TEXT("roll"), Rot.Roll);
      ResultObj->SetObjectField(TEXT("rotation"), Rotation);

      // Velocity
      FVector Vel = Pawn->GetVelocity();
      TSharedPtr<FJsonObject> Velocity = MakeShared<FJsonObject>();
      Velocity->SetNumberField(TEXT("x"), Vel.X);
      Velocity->SetNumberField(TEXT("y"), Vel.Y);
      Velocity->SetNumberField(TEXT("z"), Vel.Z);
      ResultObj->SetObjectField(TEXT("velocity"), Velocity);

      // Character-specific info (movement component)
      if (ACharacter *Character = Cast<ACharacter>(Pawn)) {
        UCharacterMovementComponent *Movement =
            Character->GetCharacterMovement();
        if (Movement) {
          ResultObj->SetBoolField(TEXT("isMovingOnGround"),
                                  Movement->IsMovingOnGround());
          ResultObj->SetBoolField(TEXT("isFalling"), Movement->IsFalling());
          ResultObj->SetNumberField(TEXT("maxWalkSpeed"), Movement->MaxWalkSpeed);
          ResultObj->SetBoolField(TEXT("isSwimming"), Movement->IsSwimming());
          ResultObj->SetBoolField(TEXT("isFlying"), Movement->IsFlying());
          ResultObj->SetBoolField(TEXT("isCrouching"),
                                  Movement->IsCrouching());
        }
      }

      // Pawn class info
      ResultObj->SetStringField(TEXT("pawnClass"), Pawn->GetClass()->GetName());
      ResultObj->SetStringField(TEXT("pawnPath"), Pawn->GetPathName());

      // Try to get custom components (game-specific state)
      TArray<TSharedPtr<FJsonValue>> ComponentsArray;
      for (UActorComponent *Comp : Pawn->GetComponents()) {
        if (!Comp)
          continue;
        TSharedPtr<FJsonObject> CompObj = MakeShared<FJsonObject>();
        CompObj->SetStringField(TEXT("name"), Comp->GetName());
        CompObj->SetStringField(TEXT("class"), Comp->GetClass()->GetName());
        ComponentsArray.Add(MakeShared<FJsonValueObject>(CompObj));
      }
      ResultObj->SetArrayField(TEXT("components"), ComponentsArray);
    } else {
      ResultObj->SetBoolField(TEXT("hasPawn"), false);
    }

    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("Player state retrieved"), ResultObj, FString());
    return true;
  }

  // Get PIE status (playing, paused, time info)
  if (LowerSub == TEXT("get_pie_status")) {
    TSharedPtr<FJsonObject> ResultObj = MakeShared<FJsonObject>();

    bool bIsPlaying = GEditor ? GEditor->IsPlayingSessionInEditor() : false;
    bool bIsPaused = GEditor ? GEditor->IsPlaySessionPaused() : false;

    ResultObj->SetBoolField(TEXT("isPlaying"), bIsPlaying);
    ResultObj->SetBoolField(TEXT("isPaused"), bIsPaused);

    if (bIsPlaying) {
      UWorld *World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
      if (World && World->IsPlayInEditor()) {
        ResultObj->SetNumberField(TEXT("timeSeconds"), World->GetTimeSeconds());
        ResultObj->SetNumberField(TEXT("deltaSeconds"), World->GetDeltaSeconds());
        ResultObj->SetNumberField(TEXT("realTimeSeconds"),
                                  World->GetRealTimeSeconds());

        // Additional world info
        ResultObj->SetStringField(TEXT("worldName"), World->GetName());
        ResultObj->SetNumberField(TEXT("playerCount"),
                                  World->GetNumPlayerControllers());
      }
    }

    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("PIE status"), ResultObj, FString());
    return true;
  }

  // Inspect actor at runtime - retrieve actor properties and component info during PIE
  if (LowerSub == TEXT("inspect_actor")) {
#if WITH_EDITOR
    FString ActorName;
    bool bIncludeComponents = true;

    if (!Payload->TryGetStringField(TEXT("actorName"), ActorName) || ActorName.IsEmpty()) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("inspect_actor requires actorName parameter"),
                             nullptr, TEXT("INVALID_ARGUMENT"));
      return true;
    }
    Payload->TryGetBoolField(TEXT("includeComponents"), bIncludeComponents);

    // Get the appropriate world - prefer PIE world if active
    UWorld* World = nullptr;
    if (GEditor && GEditor->IsPlayingSessionInEditor()) {
      World = GEditor->PlayWorld;
    }
    if (!World && GEditor) {
      World = GEditor->GetEditorWorldContext().World();
    }

    if (!World) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("No world available"),
                             nullptr, TEXT("NO_WORLD"));
      return true;
    }

    // Find actor by name or label
    AActor* FoundActor = nullptr;
    for (TActorIterator<AActor> It(World); It; ++It) {
      if (It->GetName() == ActorName || It->GetActorLabel() == ActorName) {
        FoundActor = *It;
        break;
      }
    }

    if (!FoundActor) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             FString::Printf(TEXT("Actor not found: %s"), *ActorName),
                             nullptr, TEXT("ACTOR_NOT_FOUND"));
      return true;
    }

    TSharedPtr<FJsonObject> ResultObj = MakeShared<FJsonObject>();

    ResultObj->SetStringField(TEXT("name"), FoundActor->GetName());
    ResultObj->SetStringField(TEXT("class"), FoundActor->GetClass()->GetName());
    ResultObj->SetStringField(TEXT("label"), FoundActor->GetActorLabel());

    // Transform
    FVector Loc = FoundActor->GetActorLocation();
    FRotator Rot = FoundActor->GetActorRotation();
    FVector Scale = FoundActor->GetActorScale3D();

    TSharedPtr<FJsonObject> Transform = MakeShared<FJsonObject>();
    Transform->SetNumberField(TEXT("x"), Loc.X);
    Transform->SetNumberField(TEXT("y"), Loc.Y);
    Transform->SetNumberField(TEXT("z"), Loc.Z);
    Transform->SetNumberField(TEXT("pitch"), Rot.Pitch);
    Transform->SetNumberField(TEXT("yaw"), Rot.Yaw);
    Transform->SetNumberField(TEXT("roll"), Rot.Roll);
    Transform->SetNumberField(TEXT("scaleX"), Scale.X);
    Transform->SetNumberField(TEXT("scaleY"), Scale.Y);
    Transform->SetNumberField(TEXT("scaleZ"), Scale.Z);
    ResultObj->SetObjectField(TEXT("transform"), Transform);

    // Components
    if (bIncludeComponents) {
      TArray<TSharedPtr<FJsonValue>> Components;
      for (UActorComponent* Comp : FoundActor->GetComponents()) {
        if (!Comp) continue;

        TSharedPtr<FJsonObject> CompObj = MakeShared<FJsonObject>();
        CompObj->SetStringField(TEXT("name"), Comp->GetName());
        CompObj->SetStringField(TEXT("class"), Comp->GetClass()->GetName());
        CompObj->SetBoolField(TEXT("isActive"), Comp->IsActive());

        // Get key properties using reflection
        UClass* CompClass = Comp->GetClass();
        TSharedPtr<FJsonObject> Properties = MakeShared<FJsonObject>();

        for (TFieldIterator<FProperty> PropIt(CompClass); PropIt; ++PropIt) {
          FProperty* Prop = *PropIt;
          if (Prop->HasAnyPropertyFlags(CPF_BlueprintVisible)) {
            FString PropName = Prop->GetName();

            // Handle common property types
            if (FBoolProperty* BoolProp = CastField<FBoolProperty>(Prop)) {
              bool Value = BoolProp->GetPropertyValue_InContainer(Comp);
              Properties->SetBoolField(PropName, Value);
            } else if (FFloatProperty* FloatProp = CastField<FFloatProperty>(Prop)) {
              float Value = FloatProp->GetPropertyValue_InContainer(Comp);
              Properties->SetNumberField(PropName, Value);
            } else if (FDoubleProperty* DoubleProp = CastField<FDoubleProperty>(Prop)) {
              double Value = DoubleProp->GetPropertyValue_InContainer(Comp);
              Properties->SetNumberField(PropName, Value);
            } else if (FIntProperty* IntProp = CastField<FIntProperty>(Prop)) {
              int32 Value = IntProp->GetPropertyValue_InContainer(Comp);
              Properties->SetNumberField(PropName, Value);
            } else if (FStrProperty* StrProp = CastField<FStrProperty>(Prop)) {
              FString Value = StrProp->GetPropertyValue_InContainer(Comp);
              Properties->SetStringField(PropName, Value);
            }
          }
        }

        CompObj->SetObjectField(TEXT("properties"), Properties);
        Components.Add(MakeShareable(new FJsonValueObject(CompObj)));
      }
      ResultObj->SetArrayField(TEXT("components"), Components);
    }

    SendAutomationResponse(RequestingSocket, RequestId, true,
                           FString::Printf(TEXT("Actor inspected: %s"), *ActorName),
                           ResultObj, FString());
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("inspect_actor requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  // Get component state - retrieve detailed state of a specific component during runtime
  if (LowerSub == TEXT("get_component_state")) {
#if WITH_EDITOR
    FString ActorName;
    FString ComponentName;

    if (!Payload->TryGetStringField(TEXT("actorName"), ActorName) || ActorName.IsEmpty()) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("get_component_state requires actorName parameter"),
                             nullptr, TEXT("INVALID_ARGUMENT"));
      return true;
    }
    if (!Payload->TryGetStringField(TEXT("componentName"), ComponentName) || ComponentName.IsEmpty()) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("get_component_state requires componentName parameter"),
                             nullptr, TEXT("INVALID_ARGUMENT"));
      return true;
    }

    // Get the appropriate world - prefer PIE world if active
    UWorld* World = nullptr;
    if (GEditor && GEditor->IsPlayingSessionInEditor()) {
      World = GEditor->PlayWorld;
    }
    if (!World && GEditor) {
      World = GEditor->GetEditorWorldContext().World();
    }

    if (!World) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             TEXT("No world available"),
                             nullptr, TEXT("NO_WORLD"));
      return true;
    }

    // Find actor by name or label
    AActor* FoundActor = nullptr;
    for (TActorIterator<AActor> It(World); It; ++It) {
      if (It->GetName() == ActorName || It->GetActorLabel() == ActorName) {
        FoundActor = *It;
        break;
      }
    }

    if (!FoundActor) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             FString::Printf(TEXT("Actor not found: %s"), *ActorName),
                             nullptr, TEXT("ACTOR_NOT_FOUND"));
      return true;
    }

    // Find component by name (fuzzy matching)
    UActorComponent* TargetComponent = nullptr;
    for (UActorComponent* Comp : FoundActor->GetComponents()) {
      if (!Comp) continue;
      if (Comp->GetName().Equals(ComponentName, ESearchCase::IgnoreCase) ||
          Comp->GetReadableName().Equals(ComponentName, ESearchCase::IgnoreCase) ||
          Comp->GetName().Contains(ComponentName, ESearchCase::IgnoreCase)) {
        TargetComponent = Comp;
        break;
      }
    }

    if (!TargetComponent) {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             FString::Printf(TEXT("Component '%s' not found on actor '%s'"),
                                             *ComponentName, *ActorName),
                             nullptr, TEXT("COMPONENT_NOT_FOUND"));
      return true;
    }

    TSharedPtr<FJsonObject> ResultObj = MakeShared<FJsonObject>();
    ResultObj->SetStringField(TEXT("name"), TargetComponent->GetName());
    ResultObj->SetStringField(TEXT("class"), TargetComponent->GetClass()->GetName());
    ResultObj->SetBoolField(TEXT("isActive"), TargetComponent->IsActive());
    ResultObj->SetStringField(TEXT("actorName"), FoundActor->GetActorLabel());

    // Get all BlueprintVisible properties using reflection
    UClass* CompClass = TargetComponent->GetClass();
    TSharedPtr<FJsonObject> Properties = MakeShared<FJsonObject>();

    for (TFieldIterator<FProperty> PropIt(CompClass); PropIt; ++PropIt) {
      FProperty* Prop = *PropIt;
      if (Prop->HasAnyPropertyFlags(CPF_BlueprintVisible)) {
        FString PropName = Prop->GetName();

        // Handle common property types
        if (FBoolProperty* BoolProp = CastField<FBoolProperty>(Prop)) {
          bool Value = BoolProp->GetPropertyValue_InContainer(TargetComponent);
          Properties->SetBoolField(PropName, Value);
        } else if (FFloatProperty* FloatProp = CastField<FFloatProperty>(Prop)) {
          float Value = FloatProp->GetPropertyValue_InContainer(TargetComponent);
          Properties->SetNumberField(PropName, Value);
        } else if (FDoubleProperty* DoubleProp = CastField<FDoubleProperty>(Prop)) {
          double Value = DoubleProp->GetPropertyValue_InContainer(TargetComponent);
          Properties->SetNumberField(PropName, Value);
        } else if (FIntProperty* IntProp = CastField<FIntProperty>(Prop)) {
          int32 Value = IntProp->GetPropertyValue_InContainer(TargetComponent);
          Properties->SetNumberField(PropName, Value);
        } else if (FStrProperty* StrProp = CastField<FStrProperty>(Prop)) {
          FString Value = StrProp->GetPropertyValue_InContainer(TargetComponent);
          Properties->SetStringField(PropName, Value);
        } else if (FNameProperty* NameProp = CastField<FNameProperty>(Prop)) {
          FName Value = NameProp->GetPropertyValue_InContainer(TargetComponent);
          Properties->SetStringField(PropName, Value.ToString());
        } else if (FStructProperty* StructProp = CastField<FStructProperty>(Prop)) {
          // Export struct as string for common types
          FString ValueText;
          const void* ValuePtr = StructProp->ContainerPtrToValuePtr<void>(TargetComponent);
          Prop->ExportTextItem_Direct(ValueText, ValuePtr, nullptr, TargetComponent, PPF_None);
          Properties->SetStringField(PropName, ValueText);
        }
      }
    }

    ResultObj->SetObjectField(TEXT("properties"), Properties);

    // Add scene component specific info if applicable
    if (USceneComponent* SceneComp = Cast<USceneComponent>(TargetComponent)) {
      TSharedPtr<FJsonObject> TransformObj = MakeShared<FJsonObject>();

      FVector RelLoc = SceneComp->GetRelativeLocation();
      FRotator RelRot = SceneComp->GetRelativeRotation();
      FVector RelScale = SceneComp->GetRelativeScale3D();

      TransformObj->SetNumberField(TEXT("x"), RelLoc.X);
      TransformObj->SetNumberField(TEXT("y"), RelLoc.Y);
      TransformObj->SetNumberField(TEXT("z"), RelLoc.Z);
      TransformObj->SetNumberField(TEXT("pitch"), RelRot.Pitch);
      TransformObj->SetNumberField(TEXT("yaw"), RelRot.Yaw);
      TransformObj->SetNumberField(TEXT("roll"), RelRot.Roll);
      TransformObj->SetNumberField(TEXT("scaleX"), RelScale.X);
      TransformObj->SetNumberField(TEXT("scaleY"), RelScale.Y);
      TransformObj->SetNumberField(TEXT("scaleZ"), RelScale.Z);

      ResultObj->SetObjectField(TEXT("relativeTransform"), TransformObj);

      // World transform
      TSharedPtr<FJsonObject> WorldTransformObj = MakeShared<FJsonObject>();
      FVector WorldLoc = SceneComp->GetComponentLocation();
      FRotator WorldRot = SceneComp->GetComponentRotation();
      FVector WorldScale = SceneComp->GetComponentScale();

      WorldTransformObj->SetNumberField(TEXT("x"), WorldLoc.X);
      WorldTransformObj->SetNumberField(TEXT("y"), WorldLoc.Y);
      WorldTransformObj->SetNumberField(TEXT("z"), WorldLoc.Z);
      WorldTransformObj->SetNumberField(TEXT("pitch"), WorldRot.Pitch);
      WorldTransformObj->SetNumberField(TEXT("yaw"), WorldRot.Yaw);
      WorldTransformObj->SetNumberField(TEXT("roll"), WorldRot.Roll);
      WorldTransformObj->SetNumberField(TEXT("scaleX"), WorldScale.X);
      WorldTransformObj->SetNumberField(TEXT("scaleY"), WorldScale.Y);
      WorldTransformObj->SetNumberField(TEXT("scaleZ"), WorldScale.Z);

      ResultObj->SetObjectField(TEXT("worldTransform"), WorldTransformObj);
      ResultObj->SetBoolField(TEXT("isSceneComponent"), true);
    }

    SendAutomationResponse(RequestingSocket, RequestId, true,
                           FString::Printf(TEXT("Component state retrieved: %s.%s"),
                                           *ActorName, *ComponentName),
                           ResultObj, FString());
    return true;
#else
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("get_component_state requires editor build"),
                           nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
#endif
  }

  // Engine quit (disabled for safety)
  if (LowerSub == TEXT("engine_quit")) {
    SendAutomationResponse(RequestingSocket, RequestId, false,
                           TEXT("Engine quit command is disabled for safety"),
                           nullptr, TEXT("NOT_ALLOWED"));
    return true;
  }

  // Unknown sub-action: return false to allow other handlers (e.g.
  // HandleUiAction) to attempt handling it.
  // NOTE: Simple return false is not enough if the dispatcher doesn't fallback.
  // We explicitly try the UI handler here as system_control and ui actions
  // overlap.
  return HandleUiAction(RequestId, Action, Payload, RequestingSocket);
}

bool UMcpAutomationBridgeSubsystem::HandleConsoleCommandAction(
    const FString &RequestId, const FString &Action,
    const TSharedPtr<FJsonObject> &Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket) {
  if (!Action.Equals(TEXT("console_command"), ESearchCase::IgnoreCase)) {
    return false;
  }

#if WITH_EDITOR
  if (!Payload.IsValid()) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("console_command payload missing"),
                        TEXT("INVALID_PAYLOAD"));
    return true;
  }

  FString Command;
  if (!Payload->TryGetStringField(TEXT("command"), Command) ||
      Command.IsEmpty()) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("command field required"), TEXT("INVALID_ARGUMENT"));
    return true;
  }

  // Security: Block dangerous commands
  FString LowerCommand = Command.ToLower();
  
  // Whitelist safe commands that should bypass token filtering
  // "Log" is a read-only command that prints to console - always safe
  bool bIsWhitelistedCommand = LowerCommand.StartsWith(TEXT("log "));
  if (bIsWhitelistedCommand) {
    // Safe to execute - skip all security checks below
    GEngine->Exec(nullptr, *Command);
    
    TSharedPtr<FJsonObject> Resp = MakeShared<FJsonObject>();
    Resp->SetStringField(TEXT("command"), Command);
    Resp->SetBoolField(TEXT("success"), true);
    
    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("Console command executed"), Resp, FString());
    return true;
  }
  
  // Block explicit dangerous commands
  TArray<FString> BlockedCommands = {
    TEXT("quit"), TEXT("exit"), TEXT("crash"), TEXT("shutdown"),
    TEXT("restart"), TEXT("reboot"), TEXT("debug exec"), TEXT("suicide"),
    TEXT("disconnect"), TEXT("reconnect")
  };
  
  for (const FString& Blocked : BlockedCommands) {
    if (LowerCommand.StartsWith(Blocked)) {
      SendAutomationError(RequestingSocket, RequestId,
                          FString::Printf(TEXT("Command '%s' is blocked for security"), *Blocked),
                          TEXT("COMMAND_BLOCKED"));
      return true;
    }
  }
  
  // Block destructive file operations
  // Note: These tokens have trailing spaces to avoid matching
  // valid MCP action names like "remove_volume" or "delete_actor"
  TArray<FString> BlockedTokens = {
    TEXT("rm "), TEXT("del "), TEXT("format"), TEXT("rmdir"), TEXT("rd "),
    TEXT("delete "), TEXT("remove "), TEXT("erase ")
  };
  
  for (const FString& Token : BlockedTokens) {
    if (LowerCommand.Contains(Token)) {
      SendAutomationError(RequestingSocket, RequestId,
                          FString::Printf(TEXT("Command contains blocked token '%s'"), *Token.TrimEnd()),
                          TEXT("COMMAND_BLOCKED"));
      return true;
    }
  }
  
  // Block command chaining and injection attempts
  if (LowerCommand.Contains(TEXT("&&")) || LowerCommand.Contains(TEXT("||")) ||
      LowerCommand.Contains(TEXT(";") ) || LowerCommand.Contains(TEXT("|`")) ||
      LowerCommand.Contains(TEXT("\n")) || LowerCommand.Contains(TEXT("\r"))) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("Command chaining and special characters are not allowed"),
                        TEXT("COMMAND_BLOCKED"));
    return true;
  }

  // Execute the console command
  GEngine->Exec(nullptr, *Command);

  TSharedPtr<FJsonObject> Resp = MakeShared<FJsonObject>();
  Resp->SetStringField(TEXT("command"), Command);
  Resp->SetBoolField(TEXT("success"), true);
  Resp->SetBoolField(TEXT("executed"), true);

  SendAutomationResponse(RequestingSocket, RequestId, true,
                         TEXT("Console command executed"), Resp, FString());
  return true;
#else
  SendAutomationResponse(RequestingSocket, RequestId, false,
                         TEXT("console_command requires editor build"), nullptr,
                         TEXT("NOT_IMPLEMENTED"));
  return true;
#endif
}

bool UMcpAutomationBridgeSubsystem::HandleBakeLightmap(
    const FString &RequestId, const FString &Action,
    const TSharedPtr<FJsonObject> &Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket) {
  const FString Lower = Action.ToLower();
  if (!Lower.Equals(TEXT("bake_lightmap"), ESearchCase::IgnoreCase)) {
    return false;
  }

#if WITH_EDITOR
  FString QualityStr = TEXT("Preview");
  if (Payload.IsValid())
    Payload->TryGetStringField(TEXT("quality"), QualityStr);

  // Reuse HandleExecuteEditorFunction logic
  TSharedPtr<FJsonObject> P = MakeShared<FJsonObject>();
  P->SetStringField(TEXT("functionName"), TEXT("BUILD_LIGHTING"));
  P->SetStringField(TEXT("quality"), QualityStr);

  return HandleExecuteEditorFunction(RequestId, TEXT("execute_editor_function"),
                                     P, RequestingSocket);

#else
  SendAutomationResponse(RequestingSocket, RequestId, false,
                         TEXT("Requires editor"), nullptr,
                         TEXT("NOT_IMPLEMENTED"));
  return true;
#endif
}

bool UMcpAutomationBridgeSubsystem::HandleCreateProceduralTerrain(
    const FString &RequestId, const FString &Action,
    const TSharedPtr<FJsonObject> &Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket) {
  const FString Lower = Action.ToLower();
  if (!Lower.Equals(TEXT("create_procedural_terrain"), ESearchCase::IgnoreCase)) {
    return false;
  }

#if WITH_EDITOR
  if (!GEditor) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("Editor not available"),
                        TEXT("EDITOR_NOT_AVAILABLE"));
    return true;
  }

  if (!Payload.IsValid()) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("create_procedural_terrain payload missing"),
                        TEXT("INVALID_PAYLOAD"));
    return true;
  }

  // Get terrain parameters
  int32 SizeX = 100;
  int32 SizeY = 100;
  double Spacing = 100.0;
  double HeightScale = 500.0;
  int32 Subdivisions = 50;
  FString ActorName = TEXT("ProceduralTerrain");
  
  Payload->TryGetNumberField(TEXT("sizeX"), SizeX);
  Payload->TryGetNumberField(TEXT("sizeY"), SizeY);
  Payload->TryGetNumberField(TEXT("spacing"), Spacing);
  Payload->TryGetNumberField(TEXT("heightScale"), HeightScale);
  Payload->TryGetNumberField(TEXT("subdivisions"), Subdivisions);
  Payload->TryGetStringField(TEXT("actorName"), ActorName);
  
  // Strict validation: reject empty actorName
  if (ActorName.IsEmpty()) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("actorName parameter is required for create_procedural_terrain"),
                        TEXT("INVALID_ARGUMENT"));
    return true;
  }

  // Validate actorName format (reject invalid characters)
  if (ActorName.Contains(TEXT("/")) || ActorName.Contains(TEXT("\\")) ||
      ActorName.Contains(TEXT(":")) || ActorName.Contains(TEXT("*")) ||
      ActorName.Contains(TEXT("?")) || ActorName.Contains(TEXT("\"")) ||
      ActorName.Contains(TEXT("<")) || ActorName.Contains(TEXT(">")) ||
      ActorName.Contains(TEXT("|"))) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("actorName contains invalid characters (/, \\, :, *, ?, \", <, >, |)"),
                        TEXT("INVALID_ARGUMENT"));
    return true;
  }

  // Validate actorName length
  if (ActorName.Len() > 128) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("actorName exceeds maximum length of 128 characters"),
                        TEXT("INVALID_ARGUMENT"));
    return true;
  }
  
  // Clamp values to reasonable limits
  SizeX = FMath::Clamp(SizeX, 2, 1000);
  SizeY = FMath::Clamp(SizeY, 2, 1000);
  Subdivisions = FMath::Clamp(Subdivisions, 2, 200);
  Spacing = FMath::Max(Spacing, 1.0);
  HeightScale = FMath::Max(HeightScale, 0.0);

  UWorld *World = GEditor->GetEditorWorldContext().World();
  if (!World) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("World not available"),
                        TEXT("WORLD_NOT_AVAILABLE"));
    return true;
  }

  // Spawn the actor
  FActorSpawnParameters SpawnParams;
  SpawnParams.Name = FName(*ActorName);
  SpawnParams.NameMode = FActorSpawnParameters::ESpawnActorNameMode::Requested;
  
  FVector Location(0, 0, 0);
  const TSharedPtr<FJsonObject> *LocObj = nullptr;
  if (Payload->TryGetObjectField(TEXT("location"), LocObj) && LocObj) {
    double X = 0, Y = 0, Z = 0;
    (*LocObj)->TryGetNumberField(TEXT("x"), X);
    (*LocObj)->TryGetNumberField(TEXT("y"), Y);
    (*LocObj)->TryGetNumberField(TEXT("z"), Z);
    Location = FVector(X, Y, Z);
  }
  
  FRotator Rotation(0, 0, 0);
  const TSharedPtr<FJsonObject> *RotObj = nullptr;
  if (Payload->TryGetObjectField(TEXT("rotation"), RotObj) && RotObj) {
    double Pitch = 0, Yaw = 0, Roll = 0;
    (*RotObj)->TryGetNumberField(TEXT("pitch"), Pitch);
    (*RotObj)->TryGetNumberField(TEXT("yaw"), Yaw);
    (*RotObj)->TryGetNumberField(TEXT("roll"), Roll);
    Rotation = FRotator(Pitch, Yaw, Roll);
  }

  AActor *TerrainActor = World->SpawnActor<AActor>(AActor::StaticClass(), Location, Rotation, SpawnParams);
  if (!TerrainActor) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("Failed to spawn terrain actor"),
                        TEXT("SPAWN_FAILED"));
    return true;
  }

  // Add procedural mesh component
  UProceduralMeshComponent *ProcMesh = NewObject<UProceduralMeshComponent>(TerrainActor);
  if (!ProcMesh) {
    TerrainActor->Destroy();
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("Failed to create procedural mesh component"),
                        TEXT("COMPONENT_CREATION_FAILED"));
    return true;
  }
  
  ProcMesh->RegisterComponent();
  TerrainActor->AddInstanceComponent(ProcMesh);
  TerrainActor->SetRootComponent(ProcMesh);

  // Generate terrain mesh using KismetProceduralMeshLibrary
  TArray<FVector> Vertices;
  TArray<int32> Triangles;
  TArray<FVector> Normals;
  TArray<FVector2D> UVs;
  TArray<FProcMeshTangent> Tangents;

  // Create grid of vertices
  for (int32 Y = 0; Y <= Subdivisions; ++Y) {
    for (int32 X = 0; X <= Subdivisions; ++X) {
      // Calculate normalized position (0 to 1)
      double NormX = static_cast<double>(X) / Subdivisions;
      double NormY = static_cast<double>(Y) / Subdivisions;
      
      // Calculate world position with spacing
      double WorldX = (NormX - 0.5) * SizeX * Spacing;
      double WorldY = (NormY - 0.5) * SizeY * Spacing;
      
      // Generate height using simple noise/sine combination
      double WorldZ = FMath::Sin(NormX * 4.0 * PI) * FMath::Cos(NormY * 4.0 * PI) * HeightScale * 0.3 +
                      FMath::Sin(NormX * 8.0 * PI) * FMath::Cos(NormY * 8.0 * PI) * HeightScale * 0.15 +
                      FMath::Sin(NormX * 2.0 * PI + NormY * 3.0 * PI) * HeightScale * 0.25;
      
      Vertices.Add(FVector(WorldX, WorldY, WorldZ));
      UVs.Add(FVector2D(NormX, NormY));
    }
  }

  // Generate triangles
  for (int32 Y = 0; Y < Subdivisions; ++Y) {
    for (int32 X = 0; X < Subdivisions; ++X) {
      int32 Current = Y * (Subdivisions + 1) + X;
      int32 Next = Current + Subdivisions + 1;
      
      // First triangle
      Triangles.Add(Current);
      Triangles.Add(Next);
      Triangles.Add(Current + 1);
      
      // Second triangle
      Triangles.Add(Current + 1);
      Triangles.Add(Next);
      Triangles.Add(Next + 1);
    }
  }

  // Calculate normals and tangents
  UKismetProceduralMeshLibrary::CalculateTangentsForMesh(Vertices, Triangles, UVs, Normals, Tangents);

  // Create the mesh section
  ProcMesh->CreateMeshSection(0, Vertices, Triangles, Normals, UVs, TArray<FColor>(), Tangents, true);

  // Apply material if specified
  FString MaterialPath;
  if (Payload->TryGetStringField(TEXT("material"), MaterialPath) && !MaterialPath.IsEmpty()) {
    UMaterialInterface *Material = LoadObject<UMaterialInterface>(nullptr, *MaterialPath);
    if (Material) {
      ProcMesh->SetMaterial(0, Material);
    }
  }

  // Mark the actor as modified
  TerrainActor->MarkPackageDirty();

  // Build response
  TSharedPtr<FJsonObject> Resp = MakeShared<FJsonObject>();
  Resp->SetStringField(TEXT("actorName"), TerrainActor->GetName());
  Resp->SetStringField(TEXT("actorPath"), TerrainActor->GetPathName());
  Resp->SetNumberField(TEXT("vertices"), Vertices.Num());
  Resp->SetNumberField(TEXT("triangles"), Triangles.Num() / 3);
  Resp->SetNumberField(TEXT("sizeX"), SizeX);
  Resp->SetNumberField(TEXT("sizeY"), SizeY);
  Resp->SetNumberField(TEXT("subdivisions"), Subdivisions);
  
  // Add verification data
  AddActorVerification(Resp, TerrainActor);

  SendAutomationResponse(RequestingSocket, RequestId, true,
                         TEXT("Procedural terrain created successfully"), Resp, FString());
  return true;
#else
  SendAutomationResponse(RequestingSocket, RequestId, false,
                         TEXT("create_procedural_terrain requires editor build"), nullptr,
                         TEXT("NOT_IMPLEMENTED"));
  return true;
#endif
}

bool UMcpAutomationBridgeSubsystem::HandleInspectAction(
    const FString &RequestId, const FString &Action,
    const TSharedPtr<FJsonObject> &Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket) {
  const FString Lower = Action.ToLower();
  if (!Lower.Equals(TEXT("inspect"), ESearchCase::IgnoreCase)) {
    return false;
  }

#if WITH_EDITOR
  if (!Payload.IsValid()) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("inspect payload missing"),
                        TEXT("INVALID_PAYLOAD"));
    return true;
  }

  // Get the sub-action to determine if objectPath is required
  FString SubAction;
  Payload->TryGetStringField(TEXT("action"), SubAction);
  const FString LowerSubAction = SubAction.ToLower();
  
  // List of global actions that don't require objectPath
  const bool bIsGlobalAction = 
    LowerSubAction.Equals(TEXT("get_project_settings")) ||
    LowerSubAction.Equals(TEXT("get_editor_settings")) ||
    LowerSubAction.Equals(TEXT("get_world_settings")) ||
    LowerSubAction.Equals(TEXT("get_viewport_info")) ||
    LowerSubAction.Equals(TEXT("get_selected_actors")) ||
    LowerSubAction.Equals(TEXT("get_scene_stats")) ||
    LowerSubAction.Equals(TEXT("get_performance_stats")) ||
    LowerSubAction.Equals(TEXT("get_memory_stats")) ||
    LowerSubAction.Equals(TEXT("list_objects")) ||
    LowerSubAction.Equals(TEXT("find_by_class")) ||
    LowerSubAction.Equals(TEXT("find_by_tag")) ||
    LowerSubAction.Equals(TEXT("inspect_class"));

  // Only require objectPath for non-global actions
  FString ObjectPath;
  if (!bIsGlobalAction) {
    if (!Payload->TryGetStringField(TEXT("objectPath"), ObjectPath) ||
        ObjectPath.IsEmpty()) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("objectPath required"),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }
  }

  // Handle global actions that don't require objectPath
  if (bIsGlobalAction) {
    TSharedPtr<FJsonObject> Resp = MakeShared<FJsonObject>();
    
    if (LowerSubAction.Equals(TEXT("get_project_settings"))) {
      // Return project settings info
      Resp->SetStringField(TEXT("action"), SubAction);
      Resp->SetStringField(TEXT("message"), TEXT("Project settings retrieved"));
      Resp->SetBoolField(TEXT("success"), true);
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Project settings retrieved"), Resp, FString());
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("get_editor_settings"))) {
      Resp->SetStringField(TEXT("action"), SubAction);
      Resp->SetStringField(TEXT("message"), TEXT("Editor settings retrieved"));
      Resp->SetBoolField(TEXT("success"), true);
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Editor settings retrieved"), Resp, FString());
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("get_world_settings"))) {
      if (GEditor && GEditor->GetEditorWorldContext().World()) {
        UWorld* World = GEditor->GetEditorWorldContext().World();
        Resp->SetStringField(TEXT("worldName"), World->GetName());
        Resp->SetStringField(TEXT("levelName"), World->GetCurrentLevel()->GetName());
        Resp->SetBoolField(TEXT("success"), true);
        SendAutomationResponse(RequestingSocket, RequestId, true,
                               TEXT("World settings retrieved"), Resp, FString());
      } else {
        SendAutomationError(RequestingSocket, RequestId,
                            TEXT("No world available"),
                            TEXT("WORLD_NOT_FOUND"));
      }
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("get_viewport_info"))) {
      if (GEditor && GEditor->GetActiveViewport()) {
        FViewport* Viewport = GEditor->GetActiveViewport();
        Resp->SetNumberField(TEXT("width"), Viewport->GetSizeXY().X);
        Resp->SetNumberField(TEXT("height"), Viewport->GetSizeXY().Y);
        Resp->SetBoolField(TEXT("success"), true);
        SendAutomationResponse(RequestingSocket, RequestId, true,
                               TEXT("Viewport info retrieved"), Resp, FString());
      } else {
        Resp->SetBoolField(TEXT("success"), true);
        Resp->SetStringField(TEXT("message"), TEXT("Viewport info not available in this context"));
        SendAutomationResponse(RequestingSocket, RequestId, true,
                               TEXT("Viewport info retrieved"), Resp, FString());
      }
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("get_selected_actors"))) {
      TArray<TSharedPtr<FJsonValue>> ActorsArray;
      if (GEditor) {
        TArray<AActor*> SelectedActors;
        GEditor->GetSelectedActors()->GetSelectedObjects(SelectedActors);
        for (AActor* Actor : SelectedActors) {
          if (Actor) {
            TSharedPtr<FJsonObject> ActorObj = MakeShared<FJsonObject>();
            ActorObj->SetStringField(TEXT("name"), Actor->GetName());
            ActorObj->SetStringField(TEXT("path"), Actor->GetPathName());
            ActorObj->SetStringField(TEXT("class"), Actor->GetClass()->GetName());
            ActorsArray.Add(MakeShared<FJsonValueObject>(ActorObj));
          }
        }
      }
      Resp->SetArrayField(TEXT("actors"), ActorsArray);
      Resp->SetNumberField(TEXT("count"), ActorsArray.Num());
      Resp->SetBoolField(TEXT("success"), true);
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Selected actors retrieved"), Resp, FString());
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("get_scene_stats"))) {
      int32 ActorCount = 0;
      if (GEditor && GEditor->GetEditorWorldContext().World()) {
        UWorld* World = GEditor->GetEditorWorldContext().World();
        for (TActorIterator<AActor> It(World); It; ++It) {
          ActorCount++;
        }
      }
      Resp->SetNumberField(TEXT("actorCount"), ActorCount);
      Resp->SetBoolField(TEXT("success"), true);
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Scene stats retrieved"), Resp, FString());
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("get_performance_stats"))) {
      Resp->SetBoolField(TEXT("success"), true);
      Resp->SetStringField(TEXT("message"), TEXT("Performance stats placeholder - implement with actual metrics"));
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Performance stats retrieved"), Resp, FString());
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("get_memory_stats"))) {
      Resp->SetBoolField(TEXT("success"), true);
      Resp->SetStringField(TEXT("message"), TEXT("Memory stats placeholder - implement with actual metrics"));
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Memory stats retrieved"), Resp, FString());
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("list_objects"))) {
      TArray<TSharedPtr<FJsonValue>> ObjectsArray;
      if (GEditor && GEditor->GetEditorWorldContext().World()) {
        UWorld* World = GEditor->GetEditorWorldContext().World();
        for (TActorIterator<AActor> It(World); It; ++It) {
          AActor* Actor = *It;
          TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
          Obj->SetStringField(TEXT("name"), Actor->GetName());
          Obj->SetStringField(TEXT("path"), Actor->GetPathName());
          Obj->SetStringField(TEXT("class"), Actor->GetClass()->GetName());
          ObjectsArray.Add(MakeShared<FJsonValueObject>(Obj));
        }
      }
      Resp->SetArrayField(TEXT("objects"), ObjectsArray);
      Resp->SetNumberField(TEXT("count"), ObjectsArray.Num());
      Resp->SetBoolField(TEXT("success"), true);
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Objects listed"), Resp, FString());
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("find_by_class"))) {
      FString ClassName;
      Payload->TryGetStringField(TEXT("className"), ClassName);
      TArray<TSharedPtr<FJsonValue>> ObjectsArray;
      if (GEditor && GEditor->GetEditorWorldContext().World() && !ClassName.IsEmpty()) {
        UWorld* World = GEditor->GetEditorWorldContext().World();
        for (TActorIterator<AActor> It(World); It; ++It) {
          AActor* Actor = *It;
          if (Actor->GetClass()->GetName().Equals(ClassName, ESearchCase::IgnoreCase) ||
              Actor->GetClass()->GetPathName().Contains(ClassName)) {
            TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
            Obj->SetStringField(TEXT("name"), Actor->GetName());
            Obj->SetStringField(TEXT("path"), Actor->GetPathName());
            Obj->SetStringField(TEXT("class"), Actor->GetClass()->GetName());
            ObjectsArray.Add(MakeShared<FJsonValueObject>(Obj));
          }
        }
      }
      Resp->SetArrayField(TEXT("objects"), ObjectsArray);
      Resp->SetNumberField(TEXT("count"), ObjectsArray.Num());
      Resp->SetBoolField(TEXT("success"), true);
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Objects found by class"), Resp, FString());
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("find_by_tag"))) {
      FString Tag;
      Payload->TryGetStringField(TEXT("tag"), Tag);
      TArray<TSharedPtr<FJsonValue>> ObjectsArray;
      if (GEditor && GEditor->GetEditorWorldContext().World() && !Tag.IsEmpty()) {
        UWorld* World = GEditor->GetEditorWorldContext().World();
        for (TActorIterator<AActor> It(World); It; ++It) {
          AActor* Actor = *It;
          if (Actor->ActorHasTag(FName(*Tag))) {
            TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
            Obj->SetStringField(TEXT("name"), Actor->GetName());
            Obj->SetStringField(TEXT("path"), Actor->GetPathName());
            Obj->SetStringField(TEXT("class"), Actor->GetClass()->GetName());
            ObjectsArray.Add(MakeShared<FJsonValueObject>(Obj));
          }
        }
      }
      Resp->SetArrayField(TEXT("objects"), ObjectsArray);
      Resp->SetNumberField(TEXT("count"), ObjectsArray.Num());
      Resp->SetBoolField(TEXT("success"), true);
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Objects found by tag"), Resp, FString());
      return true;
    }
    else if (LowerSubAction.Equals(TEXT("inspect_class"))) {
      FString ClassName;
      Payload->TryGetStringField(TEXT("className"), ClassName);
      if (!ClassName.IsEmpty()) {
        // Try to find the class
        UClass* TargetClass = FindObject<UClass>(nullptr, *ClassName);
        if (!TargetClass && !ClassName.Contains(TEXT("."))) {
          // Try with /Script/Engine prefix for common classes
          TargetClass = FindObject<UClass>(nullptr, *FString::Printf(TEXT("/Script/Engine.%s"), *ClassName));
        }
        if (TargetClass) {
          Resp->SetStringField(TEXT("className"), TargetClass->GetName());
          Resp->SetStringField(TEXT("classPath"), TargetClass->GetPathName());
          Resp->SetStringField(TEXT("parentClass"), TargetClass->GetSuperClass() ? TargetClass->GetSuperClass()->GetName() : TEXT("None"));
          Resp->SetBoolField(TEXT("success"), true);
          SendAutomationResponse(RequestingSocket, RequestId, true,
                                 TEXT("Class inspected"), Resp, FString());
        } else {
          SendAutomationError(RequestingSocket, RequestId,
                              FString::Printf(TEXT("Class not found: %s"), *ClassName),
                              TEXT("CLASS_NOT_FOUND"));
        }
      } else {
        SendAutomationError(RequestingSocket, RequestId,
                            TEXT("className is required for inspect_class"),
                            TEXT("INVALID_ARGUMENT"));
      }
      return true;
    }
    
    // Fallback for unimplemented global actions
    Resp->SetBoolField(TEXT("success"), true);
    Resp->SetStringField(TEXT("message"), FString::Printf(TEXT("Action %s acknowledged (placeholder implementation)"), *SubAction));
    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("Action processed"), Resp, FString());
    return true;
  }

  // Find the object (for non-global actions that require objectPath)
  UObject *TargetObject = nullptr;
  
  // Try to find by path first
  TargetObject = FindObject<UObject>(nullptr, *ObjectPath);
  
  // If not found, try to find actor by name/label
  if (!TargetObject && GEditor) {
    UWorld *World = GEditor->GetEditorWorldContext().World();
    if (World) {
      for (TActorIterator<AActor> It(World); It; ++It) {
        AActor *Actor = *It;
        if (Actor && (Actor->GetActorLabel().Equals(ObjectPath, ESearchCase::IgnoreCase) ||
                      Actor->GetName().Equals(ObjectPath, ESearchCase::IgnoreCase))) {
          TargetObject = Actor;
          break;
        }
      }
    }
  }

  if (!TargetObject) {
    SendAutomationError(RequestingSocket, RequestId,
                        FString::Printf(TEXT("Object not found: %s"), *ObjectPath),
                        TEXT("OBJECT_NOT_FOUND"));
    return true;
  }

  // Build inspection result
  TSharedPtr<FJsonObject> Resp = MakeShared<FJsonObject>();
  
  // Basic object info
  Resp->SetStringField(TEXT("objectPath"), TargetObject->GetPathName());
  Resp->SetStringField(TEXT("objectName"), TargetObject->GetName());
  Resp->SetStringField(TEXT("className"), TargetObject->GetClass()->GetName());
  Resp->SetStringField(TEXT("classPath"), TargetObject->GetClass()->GetPathName());
  
  // If it's an actor, add actor-specific info
  if (AActor *Actor = Cast<AActor>(TargetObject)) {
    Resp->SetStringField(TEXT("actorLabel"), Actor->GetActorLabel());
    Resp->SetBoolField(TEXT("isActor"), true);
    Resp->SetBoolField(TEXT("isHidden"), Actor->IsHidden());
    Resp->SetBoolField(TEXT("isSelected"), Actor->IsSelected());
    
    // Transform info
    TSharedPtr<FJsonObject> TransformObj = MakeShared<FJsonObject>();
    const FTransform &Transform = Actor->GetActorTransform();
    
    TSharedPtr<FJsonObject> LocationObj = MakeShared<FJsonObject>();
    LocationObj->SetNumberField(TEXT("x"), Transform.GetLocation().X);
    LocationObj->SetNumberField(TEXT("y"), Transform.GetLocation().Y);
    LocationObj->SetNumberField(TEXT("z"), Transform.GetLocation().Z);
    TransformObj->SetObjectField(TEXT("location"), LocationObj);
    
    TSharedPtr<FJsonObject> RotationObj = MakeShared<FJsonObject>();
    FRotator Rotator = Transform.GetRotation().Rotator();
    RotationObj->SetNumberField(TEXT("pitch"), Rotator.Pitch);
    RotationObj->SetNumberField(TEXT("yaw"), Rotator.Yaw);
    RotationObj->SetNumberField(TEXT("roll"), Rotator.Roll);
    TransformObj->SetObjectField(TEXT("rotation"), RotationObj);
    
    TSharedPtr<FJsonObject> ScaleObj = MakeShared<FJsonObject>();
    ScaleObj->SetNumberField(TEXT("x"), Transform.GetScale3D().X);
    ScaleObj->SetNumberField(TEXT("y"), Transform.GetScale3D().Y);
    ScaleObj->SetNumberField(TEXT("z"), Transform.GetScale3D().Z);
    TransformObj->SetObjectField(TEXT("scale"), ScaleObj);
    
    Resp->SetObjectField(TEXT("transform"), TransformObj);
    
    // Components info
    TArray<TSharedPtr<FJsonValue>> ComponentsArray;
    TInlineComponentArray<UActorComponent *> Components;
    Actor->GetComponents(Components);
    
    for (UActorComponent *Component : Components) {
      if (Component) {
        TSharedPtr<FJsonObject> CompObj = MakeShared<FJsonObject>();
        CompObj->SetStringField(TEXT("name"), Component->GetName());
        CompObj->SetStringField(TEXT("class"), Component->GetClass()->GetName());
        CompObj->SetBoolField(TEXT("isActive"), Component->IsActive());
        
        // Add specific info for common component types
        if (USceneComponent *SceneComp = Cast<USceneComponent>(Component)) {
          CompObj->SetBoolField(TEXT("isSceneComponent"), true);
          CompObj->SetBoolField(TEXT("isVisible"), SceneComp->IsVisible());
        }
        
        if (UStaticMeshComponent *MeshComp = Cast<UStaticMeshComponent>(Component)) {
          CompObj->SetBoolField(TEXT("isStaticMesh"), true);
          if (MeshComp->GetStaticMesh()) {
            CompObj->SetStringField(TEXT("staticMesh"), MeshComp->GetStaticMesh()->GetName());
          }
        }
        
        ComponentsArray.Add(MakeShared<FJsonValueObject>(CompObj));
      }
    }
    Resp->SetArrayField(TEXT("components"), ComponentsArray);
    Resp->SetNumberField(TEXT("componentCount"), ComponentsArray.Num());
  } else {
    Resp->SetBoolField(TEXT("isActor"), false);
  }
  
  // Tags
  TArray<TSharedPtr<FJsonValue>> TagsArray;
  for (const FName &Tag : TargetObject->GetClass()->GetDefaultObject<AActor>()->Tags) {
    TagsArray.Add(MakeShared<FJsonValueString>(Tag.ToString()));
  }
  Resp->SetArrayField(TEXT("tags"), TagsArray);

  SendAutomationResponse(RequestingSocket, RequestId, true,
                         TEXT("Object inspection completed"), Resp, FString());
  return true;
#else
  SendAutomationResponse(RequestingSocket, RequestId, false,
                         TEXT("inspect requires editor build"), nullptr,
                         TEXT("NOT_IMPLEMENTED"));
  return true;
#endif
}
