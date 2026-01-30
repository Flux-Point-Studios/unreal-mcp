#include "McpAutomationBridgeGlobals.h"
#include "McpAutomationBridgeHelpers.h"
#include "McpAutomationBridgeSubsystem.h"

// Enhanced Input (Editor Only)
#if WITH_EDITOR
#include "AssetToolsModule.h"
#include "EditorAssetLibrary.h"
#include "EnhancedInputEditorSubsystem.h"
#include "Factories/Factory.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "EnhancedInputSubsystems.h"
#include "InputActionValue.h"
#include "Engine/LocalPlayer.h"
#include "GameFramework/PlayerController.h"
#include "Engine/GameViewportClient.h"
// Input Modifiers for add_mapping support
#include "InputModifiers.h"

#endif

// Static tracking for injected input actions (to support clear_injected_inputs)
namespace McpInputInjection
{
    static TSet<FString> InjectedActionPaths;
    static FCriticalSection InjectedActionsMutex;

    void TrackInjectedAction(const FString& ActionPath)
    {
        FScopeLock Lock(&InjectedActionsMutex);
        InjectedActionPaths.Add(ActionPath);
    }

    void UntrackInjectedAction(const FString& ActionPath)
    {
        FScopeLock Lock(&InjectedActionsMutex);
        InjectedActionPaths.Remove(ActionPath);
    }

    TArray<FString> GetInjectedActions()
    {
        FScopeLock Lock(&InjectedActionsMutex);
        return InjectedActionPaths.Array();
    }

    void ClearAllTracking()
    {
        FScopeLock Lock(&InjectedActionsMutex);
        InjectedActionPaths.Empty();
    }
}

bool UMcpAutomationBridgeSubsystem::HandleInputAction(
    const FString &RequestId, const FString &Action,
    const TSharedPtr<FJsonObject> &Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket) {
  if (Action != TEXT("manage_input")) {
    return false;
  }

#if WITH_EDITOR
  if (!Payload.IsValid()) {
    SendAutomationError(RequestingSocket, RequestId, TEXT("Missing payload."),
                        TEXT("INVALID_PAYLOAD"));
    return true;
  }

  FString SubAction;
  if (!Payload->TryGetStringField(TEXT("action"), SubAction)) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("Missing 'action' field in payload."),
                        TEXT("INVALID_ARGUMENT"));
    return true;
  }

  UE_LOG(LogMcpAutomationBridgeSubsystem, Log, TEXT("HandleInputAction: %s"),
         *SubAction);

  if (SubAction == TEXT("create_input_action")) {
    FString Name;
    Payload->TryGetStringField(TEXT("name"), Name);
    FString Path;
    Payload->TryGetStringField(TEXT("path"), Path);

    if (Name.IsEmpty() || Path.IsEmpty()) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("Name and path are required."),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }

    const FString FullPath = FString::Printf(TEXT("%s/%s"), *Path, *Name);
    if (UEditorAssetLibrary::DoesAssetExist(FullPath)) {
      SendAutomationError(
          RequestingSocket, RequestId,
          FString::Printf(TEXT("Asset already exists at %s"), *FullPath),
          TEXT("ASSET_EXISTS"));
      return true;
    }

    IAssetTools &AssetTools =
        FModuleManager::Get()
            .LoadModuleChecked<FAssetToolsModule>("AssetTools")
            .Get();

    // UInputActionFactory is not exposed directly in public headers sometimes,
    // but we can rely on AssetTools to create it if we have the class.
    UClass *ActionClass = UInputAction::StaticClass();
    UObject *NewAsset =
        AssetTools.CreateAsset(Name, Path, ActionClass, nullptr);

    if (NewAsset) {
      // Force save
      SaveLoadedAssetThrottled(NewAsset, -1.0, true);
      TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
      Result->SetStringField(TEXT("assetPath"), NewAsset->GetPathName());
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Input Action created."), Result);
    } else {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("Failed to create Input Action."),
                          TEXT("CREATION_FAILED"));
    }
  } else if (SubAction == TEXT("create_input_mapping_context")) {
    FString Name;
    Payload->TryGetStringField(TEXT("name"), Name);
    FString Path;
    Payload->TryGetStringField(TEXT("path"), Path);

    if (Name.IsEmpty() || Path.IsEmpty()) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("Name and path are required."),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }

    const FString FullPath = FString::Printf(TEXT("%s/%s"), *Path, *Name);
    if (UEditorAssetLibrary::DoesAssetExist(FullPath)) {
      SendAutomationError(
          RequestingSocket, RequestId,
          FString::Printf(TEXT("Asset already exists at %s"), *FullPath),
          TEXT("ASSET_EXISTS"));
      return true;
    }

    IAssetTools &AssetTools =
        FModuleManager::Get()
            .LoadModuleChecked<FAssetToolsModule>("AssetTools")
            .Get();

    UClass *ContextClass = UInputMappingContext::StaticClass();
    UObject *NewAsset =
        AssetTools.CreateAsset(Name, Path, ContextClass, nullptr);

    if (NewAsset) {
      SaveLoadedAssetThrottled(NewAsset, -1.0, true);
      TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
      Result->SetStringField(TEXT("assetPath"), NewAsset->GetPathName());
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Input Mapping Context created."), Result);
    } else {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("Failed to create Input Mapping Context."),
                          TEXT("CREATION_FAILED"));
    }
  } else if (SubAction == TEXT("add_mapping")) {
    FString ContextPath;
    Payload->TryGetStringField(TEXT("contextPath"), ContextPath);
    FString ActionPath;
    Payload->TryGetStringField(TEXT("actionPath"), ActionPath);
    FString KeyName;
    Payload->TryGetStringField(TEXT("key"), KeyName);

    UInputMappingContext *Context =
        Cast<UInputMappingContext>(UEditorAssetLibrary::LoadAsset(ContextPath));
    UInputAction *InAction =
        Cast<UInputAction>(UEditorAssetLibrary::LoadAsset(ActionPath));

    if (!Context || !InAction || KeyName.IsEmpty()) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("Invalid context, action, or key."),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }

    FKey Key = FKey(FName(*KeyName));
    if (!Key.IsValid()) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("Invalid key name."), TEXT("INVALID_ARGUMENT"));
      return true;
    }

    FEnhancedActionKeyMapping &Mapping = Context->MapKey(InAction, Key);

    // Parse and apply modifiers from payload
    int32 ModifierCount = 0;
    const TArray<TSharedPtr<FJsonValue>>* ModifiersArray = nullptr;
    if (Payload->TryGetArrayField(TEXT("modifiers"), ModifiersArray) && ModifiersArray)
    {
      for (const TSharedPtr<FJsonValue>& ModifierValue : *ModifiersArray)
      {
        FString ModifierType;
        float ModifierVal = 1.0f;

        // Handle both string and object formats
        if (ModifierValue->Type == EJson::String)
        {
          ModifierType = ModifierValue->AsString();
        }
        else if (ModifierValue->Type == EJson::Object)
        {
          TSharedPtr<FJsonObject> ModObj = ModifierValue->AsObject();
          ModObj->TryGetStringField(TEXT("type"), ModifierType);
          ModObj->TryGetNumberField(TEXT("value"), ModifierVal);
        }

        // Create the appropriate modifier
        UInputModifier* NewModifier = nullptr;
        if (ModifierType.Equals(TEXT("Negate"), ESearchCase::IgnoreCase))
        {
          NewModifier = NewObject<UInputModifierNegate>();
        }
        else if (ModifierType.Equals(TEXT("Scalar"), ESearchCase::IgnoreCase))
        {
          UInputModifierScalar* ScalarMod = NewObject<UInputModifierScalar>();
          ScalarMod->Scalar = FVector(ModifierVal, ModifierVal, ModifierVal);
          NewModifier = ScalarMod;
        }
        else if (ModifierType.Equals(TEXT("DeadZone"), ESearchCase::IgnoreCase))
        {
          UInputModifierDeadZone* DeadZoneMod = NewObject<UInputModifierDeadZone>();
          DeadZoneMod->LowerThreshold = ModifierVal;
          NewModifier = DeadZoneMod;
        }
        else if (ModifierType.Equals(TEXT("Swizzle"), ESearchCase::IgnoreCase))
        {
          NewModifier = NewObject<UInputModifierSwizzleAxis>();
        }

        if (NewModifier)
        {
          Mapping.Modifiers.Add(NewModifier);
          ModifierCount++;
        }
      }
    }

    // Save changes
    SaveLoadedAssetThrottled(Context, -1.0, true);

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("key"), KeyName);
    Result->SetStringField(TEXT("action"), ActionPath);
    Result->SetNumberField(TEXT("modifierCount"), ModifierCount);
    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("Mapping added."), Result);
  } else if (SubAction == TEXT("remove_mapping")) {
    FString ContextPath;
    Payload->TryGetStringField(TEXT("contextPath"), ContextPath);
    FString ActionPath;
    Payload->TryGetStringField(TEXT("actionPath"), ActionPath);

    UInputMappingContext *Context =
        Cast<UInputMappingContext>(UEditorAssetLibrary::LoadAsset(ContextPath));
    UInputAction *InAction =
        Cast<UInputAction>(UEditorAssetLibrary::LoadAsset(ActionPath));

    if (!Context || !InAction) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("Invalid context or action."),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }

    // Context->UnmapAction(InAction); // Not available in 5.x
    TArray<FKey> KeysToRemove;
    for (const FEnhancedActionKeyMapping &Mapping : Context->GetMappings()) {
      if (Mapping.Action == InAction) {
        KeysToRemove.Add(Mapping.Key);
      }
    }
    for (const FKey &KeyToRemove : KeysToRemove) {
      Context->UnmapKey(InAction, KeyToRemove);
    }
    SaveLoadedAssetThrottled(Context, -1.0, true);

    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("Mappings removed for action."), nullptr);
  } else if (SubAction == TEXT("inject_input_for_action")) {
    // Inject input directly into the Enhanced Input subsystem using InjectInputForAction API
    // This bypasses Slate/viewport key events and avoids "stuck key" issues

    FString InputActionPath;
    if (!Payload->TryGetStringField(TEXT("inputActionPath"), InputActionPath) || InputActionPath.IsEmpty()) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("inputActionPath is required for inject_input_for_action."),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }

    // Load the Input Action asset
    UInputAction* Action = LoadObject<UInputAction>(nullptr, *InputActionPath);
    if (!Action) {
      SendAutomationError(RequestingSocket, RequestId,
                          FString::Printf(TEXT("Failed to load Input Action at path: %s"), *InputActionPath),
                          TEXT("ASSET_NOT_FOUND"));
      return true;
    }

    // Parse the input value - can be boolean, number, 2D vector, or 3D vector
    FInputActionValue RawValue;
    bool bValueParsed = false;

    // Debug: Log the raw JSON value field
    const TSharedPtr<FJsonValue>* RawJsonValue = Payload->Values.Find(TEXT("value"));
    if (RawJsonValue && RawJsonValue->IsValid())
    {
      UE_LOG(LogTemp, Warning, TEXT("[MCP INPUT] Raw JSON value type: %d"), static_cast<int>((*RawJsonValue)->Type));
    }

    // Try boolean first
    bool BoolValue;
    if (Payload->TryGetBoolField(TEXT("value"), BoolValue)) {
      UE_LOG(LogTemp, Warning, TEXT("[MCP INPUT] Parsed as BOOL: %s"), BoolValue ? TEXT("true") : TEXT("false"));
      RawValue = FInputActionValue(BoolValue ? 1.0f : 0.0f);
      bValueParsed = true;
    }

    // Try object FIRST (before number) - handles wrapped negative numbers {x: -1, y: 0}
    // and 2D/3D vectors. This must come before number parsing because negative numbers
    // are wrapped in objects by the TypeScript layer to preserve their sign.
    if (!bValueParsed) {
      const TSharedPtr<FJsonObject>* ValueObj;
      if (Payload->TryGetObjectField(TEXT("value"), ValueObj) && ValueObj->IsValid()) {
        double X = 0.0, Y = 0.0, Z = 0.0;
        bool bHasX = (*ValueObj)->TryGetNumberField(TEXT("x"), X);
        bool bHasY = (*ValueObj)->TryGetNumberField(TEXT("y"), Y);
        bool bHasZ = (*ValueObj)->TryGetNumberField(TEXT("z"), Z);

        UE_LOG(LogTemp, Warning, TEXT("[MCP INPUT] Parsed as OBJECT: X=%f (has=%s), Y=%f (has=%s), Z=%f (has=%s)"),
          X, bHasX ? TEXT("yes") : TEXT("no"),
          Y, bHasY ? TEXT("yes") : TEXT("no"),
          Z, bHasZ ? TEXT("yes") : TEXT("no"));

        if (bHasX && bHasY && bHasZ) {
          // 3D vector
          RawValue = FInputActionValue(FVector(X, Y, Z));
          bValueParsed = true;
        } else if (bHasX && bHasY) {
          // 2D vector - also handles wrapped negative numbers {x: -1, y: 0}
          // For 1D actions, only X component is used
          RawValue = FInputActionValue(FVector2D(X, Y));
          bValueParsed = true;
        } else if (bHasX) {
          // Just X - treat as 1D
          RawValue = FInputActionValue(static_cast<float>(X));
          bValueParsed = true;
        }
      }
    }

    // Try number (1D axis) - for positive numbers sent directly
    if (!bValueParsed) {
      double NumValue;
      if (Payload->TryGetNumberField(TEXT("value"), NumValue)) {
        UE_LOG(LogTemp, Warning, TEXT("[MCP INPUT] Parsed as NUMBER: %f"), NumValue);
        RawValue = FInputActionValue(static_cast<float>(NumValue));
        bValueParsed = true;
      }
    }

    if (!bValueParsed) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("value field is required and must be boolean, number, or object with x,y(,z) fields."),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }

    // Find the player controller and Enhanced Input subsystem
    // We need to run this on the game thread during PIE
    UEnhancedInputLocalPlayerSubsystem* Subsystem = nullptr;
    APlayerController* PC = nullptr;

    // Try to get player controller from PIE world
    if (GEditor && GEditor->PlayWorld) {
      PC = GEditor->PlayWorld->GetFirstPlayerController();
    }

    // Fallback: try GEngine's game viewport
    if (!PC && GEngine && GEngine->GameViewport) {
      UWorld* World = GEngine->GameViewport->GetWorld();
      if (World) {
        PC = World->GetFirstPlayerController();
      }
    }

    if (!PC) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("No PlayerController found. Is PIE running?"),
                          TEXT("NO_PLAYER_CONTROLLER"));
      return true;
    }

    ULocalPlayer* LocalPlayer = PC->GetLocalPlayer();
    if (!LocalPlayer) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("No LocalPlayer found for PlayerController."),
                          TEXT("NO_LOCAL_PLAYER"));
      return true;
    }

    Subsystem = LocalPlayer->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>();
    if (!Subsystem) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("Enhanced Input subsystem not available for LocalPlayer."),
                          TEXT("NO_ENHANCED_INPUT_SUBSYSTEM"));
      return true;
    }

    // Parse optional modifiers and triggers
    TArray<UInputModifier*> Modifiers;
    TArray<UInputTrigger*> Triggers;

    // Note: For now we pass empty arrays. Full modifier/trigger support would require
    // loading modifier/trigger classes by name and instantiating them.
    // The InjectInputForAction API accepts these as optional parameters.

    // Inject the input
    Subsystem->InjectInputForAction(Action, RawValue, Modifiers, Triggers);

    // Track this action for potential clearing later
    McpInputInjection::TrackInjectedAction(InputActionPath);

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("inputActionPath"), InputActionPath);
    Result->SetStringField(TEXT("valueType"),
        RawValue.GetValueType() == EInputActionValueType::Boolean ? TEXT("Boolean") :
        RawValue.GetValueType() == EInputActionValueType::Axis1D ? TEXT("Axis1D") :
        RawValue.GetValueType() == EInputActionValueType::Axis2D ? TEXT("Axis2D") :
        RawValue.GetValueType() == EInputActionValueType::Axis3D ? TEXT("Axis3D") : TEXT("Unknown"));

    SendAutomationResponse(RequestingSocket, RequestId, true,
                           FString::Printf(TEXT("Input injected for action: %s"), *InputActionPath),
                           Result);

  } else if (SubAction == TEXT("clear_injected_inputs")) {
    // Clear injected inputs by injecting zero values for tracked actions

    TArray<FString> ActionPathsToClear;

    // Check if specific paths were provided
    const TArray<TSharedPtr<FJsonValue>>* PathsArray;
    if (Payload->TryGetArrayField(TEXT("inputActionPaths"), PathsArray) && PathsArray->Num() > 0) {
      for (const TSharedPtr<FJsonValue>& PathValue : *PathsArray) {
        FString PathStr;
        if (PathValue->TryGetString(PathStr) && !PathStr.IsEmpty()) {
          ActionPathsToClear.Add(PathStr);
        }
      }
    } else {
      // Clear all tracked actions
      ActionPathsToClear = McpInputInjection::GetInjectedActions();
    }

    if (ActionPathsToClear.Num() == 0) {
      TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
      Result->SetNumberField(TEXT("clearedCount"), 0);
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("No injected inputs to clear."), Result);
      return true;
    }

    // Find the Enhanced Input subsystem
    APlayerController* PC = nullptr;
    if (GEditor && GEditor->PlayWorld) {
      PC = GEditor->PlayWorld->GetFirstPlayerController();
    }
    if (!PC && GEngine && GEngine->GameViewport) {
      UWorld* World = GEngine->GameViewport->GetWorld();
      if (World) {
        PC = World->GetFirstPlayerController();
      }
    }

    UEnhancedInputLocalPlayerSubsystem* Subsystem = nullptr;
    if (PC) {
      ULocalPlayer* LocalPlayer = PC->GetLocalPlayer();
      if (LocalPlayer) {
        Subsystem = LocalPlayer->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>();
      }
    }

    int32 ClearedCount = 0;
    TArray<FString> FailedPaths;

    for (const FString& ActionPath : ActionPathsToClear) {
      UInputAction* Action = LoadObject<UInputAction>(nullptr, *ActionPath);
      if (Action && Subsystem) {
        // Inject zero value to clear the input
        FInputActionValue ZeroValue(0.0f);
        Subsystem->InjectInputForAction(Action, ZeroValue, {}, {});
        McpInputInjection::UntrackInjectedAction(ActionPath);
        ClearedCount++;
      } else {
        FailedPaths.Add(ActionPath);
      }
    }

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetNumberField(TEXT("clearedCount"), ClearedCount);

    if (FailedPaths.Num() > 0) {
      TArray<TSharedPtr<FJsonValue>> FailedArray;
      for (const FString& Path : FailedPaths) {
        FailedArray.Add(MakeShared<FJsonValueString>(Path));
      }
      Result->SetArrayField(TEXT("failedPaths"), FailedArray);
    }

    SendAutomationResponse(RequestingSocket, RequestId, true,
                           FString::Printf(TEXT("Cleared %d injected inputs."), ClearedCount),
                           Result);

  } else if (SubAction == TEXT("get_injected_input_status")) {
    // Get the current status of injected inputs

    TArray<FString> InjectedActions = McpInputInjection::GetInjectedActions();

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();

    TArray<TSharedPtr<FJsonValue>> ActionsArray;
    for (const FString& ActionPath : InjectedActions) {
      ActionsArray.Add(MakeShared<FJsonValueString>(ActionPath));
    }
    Result->SetArrayField(TEXT("injectedActions"), ActionsArray);
    Result->SetNumberField(TEXT("count"), InjectedActions.Num());

    // Check if PIE is running and Enhanced Input is available
    bool bPIERunning = GEditor && GEditor->PlayWorld != nullptr;
    Result->SetBoolField(TEXT("pieRunning"), bPIERunning);

    bool bSubsystemAvailable = false;
    if (bPIERunning) {
      APlayerController* PC = GEditor->PlayWorld->GetFirstPlayerController();
      if (PC) {
        ULocalPlayer* LocalPlayer = PC->GetLocalPlayer();
        if (LocalPlayer) {
          bSubsystemAvailable = LocalPlayer->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>() != nullptr;
        }
      }
    }
    Result->SetBoolField(TEXT("enhancedInputAvailable"), bSubsystemAvailable);

    SendAutomationResponse(RequestingSocket, RequestId, true,
                           FString::Printf(TEXT("Currently tracking %d injected inputs."), InjectedActions.Num()),
                           Result);

  } else {
    SendAutomationError(
        RequestingSocket, RequestId,
        FString::Printf(TEXT("Unknown sub-action: %s"), *SubAction),
        TEXT("UNKNOWN_ACTION"));
  }

  return true;
#else
  SendAutomationError(RequestingSocket, RequestId,
                      TEXT("Input management requires Editor build."),
                      TEXT("NOT_AVAILABLE"));
  return true;
#endif
}
