/**
 * Location: McpAutomationBridge/Private/McpAutomationBridge_UiHandlers.cpp
 *
 * Summary:
 * This file implements UI automation handlers for the MCP Automation Bridge plugin.
 * It provides functionality for:
 * - Widget creation and manipulation (create_widget, add_widget_child)
 * - Screenshot capture (screenshot)
 * - Play-in-Editor control (play_in_editor, stop_play)
 * - Input simulation (simulate_input)
 * - HUD management (create_hud, set_widget_text, set_widget_image, set_widget_visibility)
 * - Automation Driver session management (ui_session_start, ui_session_end, ui_click,
 *   ui_type, ui_hover, ui_focus, ui_wait_for, ui_element_exists, ui_get_element_text)
 *
 * The Automation Driver provides programmatic UI testing capabilities through
 * Unreal Engine's IAutomationDriver API. IMPORTANT: When enabled, the Automation
 * Driver blocks platform input to ensure deterministic test execution.
 *
 * Usage:
 * These handlers are registered with the McpAutomationBridgeSubsystem and invoked
 * via HandleUiAction() when "system_control" or "manage_ui" actions are received
 * from the MCP server.
 *
 * Related Files:
 * - McpAutomationBridgeSubsystem.h/cpp - Main subsystem that routes actions
 * - McpAutomationBridgeHelpers.h - Common helper functions
 * - McpAutomationBridgeGlobals.h - Global definitions and macros
 */

#include "McpAutomationBridgeGlobals.h"
#include "McpAutomationBridgeHelpers.h"
#include "McpAutomationBridgeSubsystem.h"
#if WITH_EDITOR
#include "AssetToolsModule.h"
#include "Blueprint/UserWidget.h"
#include "Blueprint/WidgetBlueprintLibrary.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Image.h"
#include "Components/PanelWidget.h"
#include "Components/TextBlock.h"
#include "EditorAssetLibrary.h"
#include "Engine/GameViewportClient.h"
#include "Engine/Texture2D.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/FileManager.h"
#include "IImageWrapper.h"
#include "IImageWrapperModule.h"
#include "ImageUtils.h"
#include "Misc/Base64.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "UnrealClient.h"
#include "WidgetBlueprint.h"
#if __has_include("Factories/WidgetBlueprintFactory.h")
#include "Factories/WidgetBlueprintFactory.h"
#define MCP_HAS_WIDGET_FACTORY 1
#else
#define MCP_HAS_WIDGET_FACTORY 0
#endif

// Automation Driver includes for UI testing capabilities
#if __has_include("IAutomationDriverModule.h")
#include "IAutomationDriverModule.h"
#include "IAutomationDriver.h"
#include "IDriverElement.h"
#include "IElementLocator.h"
#include "LocateBy.h"
#include "WaitUntil.h"
#include "AutomationDriverTypeDefs.h"
#define MCP_HAS_AUTOMATION_DRIVER 1
#else
#define MCP_HAS_AUTOMATION_DRIVER 0
#endif
#endif

// ============================================================================
// Automation Driver Session State
// ============================================================================
// The Automation Driver MUST be explicitly enabled/disabled for each session.
// When enabled, it BLOCKS platform input to ensure deterministic test execution.
// Always follow the pattern: Enable() -> run sequence -> Disable()
// ============================================================================
#if WITH_EDITOR && MCP_HAS_AUTOMATION_DRIVER
namespace McpUIAutomation
{
    // Active driver instance - only valid while session is active
    static TSharedPtr<IAutomationDriver, ESPMode::ThreadSafe> ActiveDriver;

    // Thread-safety mutex for driver access
    static FCriticalSection DriverMutex;

    // Helper to create locator from type and value strings
    static TSharedRef<IElementLocator, ESPMode::ThreadSafe> CreateLocator(
        const FString& LocatorType, const FString& LocatorValue)
    {
        if (LocatorType.Equals(TEXT("id"), ESearchCase::IgnoreCase))
        {
            return By::Id(LocatorValue);
        }
        else if (LocatorType.Equals(TEXT("path"), ESearchCase::IgnoreCase))
        {
            return By::Path(LocatorValue);
        }
        else if (LocatorType.Equals(TEXT("cursor"), ESearchCase::IgnoreCase))
        {
            return By::Cursor();
        }
        else if (LocatorType.Equals(TEXT("focus"), ESearchCase::IgnoreCase) ||
                 LocatorType.Equals(TEXT("keyboard_focus"), ESearchCase::IgnoreCase))
        {
            return By::KeyboardFocus();
        }
        else if (LocatorType.Equals(TEXT("user_focus"), ESearchCase::IgnoreCase))
        {
            // Default to user 0 if not specified
            return By::UserFocus(0);
        }
        // Default to path-based locator
        return By::Path(LocatorValue);
    }
}
#endif // WITH_EDITOR && MCP_HAS_AUTOMATION_DRIVER

bool UMcpAutomationBridgeSubsystem::HandleUiAction(
    const FString &RequestId, const FString &Action,
    const TSharedPtr<FJsonObject> &Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket) {
  const FString LowerAction = Action.ToLower();
  bool bIsSystemControl =
      LowerAction.Equals(TEXT("system_control"), ESearchCase::IgnoreCase);
  bool bIsManageUi =
      LowerAction.Equals(TEXT("manage_ui"), ESearchCase::IgnoreCase);

  if (!bIsSystemControl && !bIsManageUi) {
    return false;
  }

  if (!Payload.IsValid()) {
    SendAutomationError(RequestingSocket, RequestId, TEXT("Payload missing."),
                        TEXT("INVALID_PAYLOAD"));
    return true;
  }

  FString SubAction;
  if (Payload->HasField(TEXT("subAction"))) {
    SubAction = Payload->GetStringField(TEXT("subAction"));
  } else {
    Payload->TryGetStringField(TEXT("action"), SubAction);
  }
  const FString LowerSub = SubAction.ToLower();

  TSharedPtr<FJsonObject> Resp = MakeShared<FJsonObject>();
  Resp->SetStringField(TEXT("action"), LowerSub);

  bool bSuccess = false;
  FString Message;
  FString ErrorCode;

#if WITH_EDITOR
  if (LowerSub == TEXT("create_widget")) {
#if WITH_EDITOR && MCP_HAS_WIDGET_FACTORY
    FString WidgetName;
    if (!Payload->TryGetStringField(TEXT("name"), WidgetName) ||
        WidgetName.IsEmpty()) {
      Message = TEXT("name field required for create_widget");
      ErrorCode = TEXT("INVALID_ARGUMENT");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FString SavePath;
      Payload->TryGetStringField(TEXT("savePath"), SavePath);
      if (SavePath.IsEmpty()) {
        SavePath = TEXT("/Game/UI/Widgets");
      }

      FString WidgetType;
      Payload->TryGetStringField(TEXT("widgetType"), WidgetType);

      const FString NormalizedPath = SavePath.TrimStartAndEnd();
      const FString TargetPath =
          FString::Printf(TEXT("%s/%s"), *NormalizedPath, *WidgetName);
      if (UEditorAssetLibrary::DoesAssetExist(TargetPath)) {
        bSuccess = true;
        Message = FString::Printf(TEXT("Widget blueprint already exists at %s"),
                                  *TargetPath);
        Resp->SetStringField(TEXT("widgetPath"), TargetPath);
        Resp->SetBoolField(TEXT("exists"), true);
        if (!WidgetType.IsEmpty()) {
          Resp->SetStringField(TEXT("widgetType"), WidgetType);
        }
        Resp->SetStringField(TEXT("widgetName"), WidgetName);
      } else {
        UWidgetBlueprintFactory *Factory = NewObject<UWidgetBlueprintFactory>();
        if (!Factory) {
          Message = TEXT("Failed to create widget blueprint factory");
          ErrorCode = TEXT("FACTORY_CREATION_FAILED");
          Resp->SetStringField(TEXT("error"), Message);
        } else {
          UObject *NewAsset = Factory->FactoryCreateNew(
              UWidgetBlueprint::StaticClass(),
              UEditorAssetLibrary::DoesAssetExist(NormalizedPath)
                  ? UEditorAssetLibrary::LoadAsset(NormalizedPath)
                  : nullptr,
              FName(*WidgetName), RF_Standalone, nullptr, GWarn);

          UWidgetBlueprint *WidgetBlueprint = Cast<UWidgetBlueprint>(NewAsset);

          if (!WidgetBlueprint) {
            Message = TEXT("Failed to create widget blueprint asset");
            ErrorCode = TEXT("ASSET_CREATION_FAILED");
            Resp->SetStringField(TEXT("error"), Message);
          } else {
            // Force immediate save and registry scan
            SaveLoadedAssetThrottled(WidgetBlueprint, -1.0, true);
            ScanPathSynchronous(WidgetBlueprint->GetOutermost()->GetName());

            bSuccess = true;
            Message = FString::Printf(TEXT("Widget blueprint created at %s"),
                                      *WidgetBlueprint->GetPathName());
            Resp->SetStringField(TEXT("widgetPath"),
                                 WidgetBlueprint->GetPathName());
            Resp->SetStringField(TEXT("widgetName"), WidgetName);
            if (!WidgetType.IsEmpty()) {
              Resp->SetStringField(TEXT("widgetType"), WidgetType);
            }
          }
        }
      }
    }
#else
    Message =
        TEXT("create_widget requires editor build with widget factory support");
    ErrorCode = TEXT("NOT_AVAILABLE");
    Resp->SetStringField(TEXT("error"), Message);
#endif
  } else if (LowerSub == TEXT("add_widget_child")) {
#if WITH_EDITOR && MCP_HAS_WIDGET_FACTORY
    FString WidgetPath;
    if (!Payload->TryGetStringField(TEXT("widgetPath"), WidgetPath) ||
        WidgetPath.IsEmpty()) {
      Message = TEXT("widgetPath required for add_widget_child");
      ErrorCode = TEXT("INVALID_ARGUMENT");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      UWidgetBlueprint *WidgetBP =
          LoadObject<UWidgetBlueprint>(nullptr, *WidgetPath);
      if (!WidgetBP) {
        Message = FString::Printf(TEXT("Could not find Widget Blueprint at %s"),
                                  *WidgetPath);
        ErrorCode = TEXT("ASSET_NOT_FOUND");
        Resp->SetStringField(TEXT("error"), Message);
      } else {
        FString ChildClassPath;
        if (!Payload->TryGetStringField(TEXT("childClass"), ChildClassPath) ||
            ChildClassPath.IsEmpty()) {
          // Fallback to commonly used types if only short name provided?
          // For now require full path or class name if it can be found.
          Message = TEXT("childClass required (e.g. /Script/UMG.Button)");
          ErrorCode = TEXT("INVALID_ARGUMENT");
          Resp->SetStringField(TEXT("error"), Message);
        } else {
          UClass *WidgetClass =
              UEditorAssetLibrary::FindAssetData(ChildClassPath)
                      .GetAsset()
                      .IsValid()
                  ? LoadClass<UObject>(nullptr, *ChildClassPath)
                  : FindObject<UClass>(nullptr, *ChildClassPath);

          // Try partial search for common UMG widgets
          if (!WidgetClass) {
            if (ChildClassPath.Contains(TEXT(".")))
              WidgetClass = FindObject<UClass>(nullptr, *ChildClassPath);
            else
              WidgetClass = FindObject<UClass>(
                  nullptr,
                  *FString::Printf(TEXT("/Script/UMG.%s"), *ChildClassPath));
          }

          if (!WidgetClass || !WidgetClass->IsChildOf(UWidget::StaticClass())) {
            Message = FString::Printf(
                TEXT("Could not resolve valid UWidget class from '%s'"),
                *ChildClassPath);
            ErrorCode = TEXT("CLASS_NOT_FOUND");
            Resp->SetStringField(TEXT("error"), Message);
          } else {
            FString ParentName;
            Payload->TryGetStringField(TEXT("parentName"), ParentName);

            WidgetBP->Modify();

            UWidget *NewWidget =
                WidgetBP->WidgetTree->ConstructWidget<UWidget>(WidgetClass);

            bool bAdded = false;
            bool bIsRoot = false;

            if (ParentName.IsEmpty()) {
              // Try to set as RootWidget if empty
              if (WidgetBP->WidgetTree->RootWidget == nullptr) {
                WidgetBP->WidgetTree->RootWidget = NewWidget;
                bAdded = true;
                bIsRoot = true;
              } else {
                // Try to add to existing root if it's a panel
                UPanelWidget *RootPanel =
                    Cast<UPanelWidget>(WidgetBP->WidgetTree->RootWidget);
                if (RootPanel) {
                  RootPanel->AddChild(NewWidget);
                  bAdded = true;
                } else {
                  Message = TEXT("Root widget is not a panel and already "
                                 "exists. Specify parentName.");
                  ErrorCode = TEXT("ROOT_Full");
                }
              }
            } else {
              // Find parent
              UWidget *ParentWidget =
                  WidgetBP->WidgetTree->FindWidget(FName(*ParentName));
              UPanelWidget *ParentPanel = Cast<UPanelWidget>(ParentWidget);
              if (ParentPanel) {
                ParentPanel->AddChild(NewWidget);
                bAdded = true;
              } else {
                Message = FString::Printf(
                    TEXT("Parent '%s' not found or is not a PanelWidget"),
                    *ParentName);
                ErrorCode = TEXT("PARENT_NOT_FOUND");
              }
            }

            if (bAdded) {
              bSuccess = true;
              Message = FString::Printf(TEXT("Added %s to %s"),
                                        *WidgetClass->GetName(),
                                        *WidgetBP->GetName());
              Resp->SetStringField(TEXT("widgetName"), NewWidget->GetName());
              Resp->SetStringField(TEXT("childClass"), WidgetClass->GetName());
            } else {
              if (Message.IsEmpty())
                Message = TEXT("Failed to add widget child.");
              Resp->SetStringField(TEXT("error"), Message);
            }
          }
        }
      }
    }
#else
    Message = TEXT("add_widget_child requires editor build");
    ErrorCode = TEXT("NOT_AVAILABLE");
    Resp->SetStringField(TEXT("error"), Message);
#endif
  } else if (LowerSub == TEXT("screenshot")) {
    // Take a screenshot of the viewport and return as base64
    FString ScreenshotPath;
    Payload->TryGetStringField(TEXT("path"), ScreenshotPath);
    if (ScreenshotPath.IsEmpty()) {
      ScreenshotPath =
          FPaths::ProjectSavedDir() / TEXT("Screenshots/WindowsEditor");
    }

    FString Filename;
    Payload->TryGetStringField(TEXT("filename"), Filename);
    if (Filename.IsEmpty()) {
      Filename = FString::Printf(TEXT("Screenshot_%lld"),
                                 FDateTime::Now().ToUnixTimestamp());
    }

    bool bReturnBase64 = true;
    Payload->TryGetBoolField(TEXT("returnBase64"), bReturnBase64);

    // Get viewport
    if (!GEngine || !GEngine->GameViewport) {
      Message = TEXT("No game viewport available");
      ErrorCode = TEXT("NO_VIEWPORT");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      UGameViewportClient *ViewportClient = GEngine->GameViewport;
      FViewport *Viewport = ViewportClient->Viewport;

      if (!Viewport) {
        Message = TEXT("No viewport available");
        ErrorCode = TEXT("NO_VIEWPORT");
        Resp->SetStringField(TEXT("error"), Message);
      } else {
        // Capture viewport pixels
        TArray<FColor> Bitmap;
        FIntVector Size(Viewport->GetSizeXY().X, Viewport->GetSizeXY().Y, 0);

        bool bReadSuccess = Viewport->ReadPixels(Bitmap);

        if (!bReadSuccess || Bitmap.Num() == 0) {
          Message = TEXT("Failed to read viewport pixels");
          ErrorCode = TEXT("CAPTURE_FAILED");
          Resp->SetStringField(TEXT("error"), Message);
        } else {
          // Ensure we have the right size
          const int32 Width = Size.X;
          const int32 Height = Size.Y;

          // Compress to PNG
          TArray<uint8> PngData;
          FImageUtils::ThumbnailCompressImageArray(Width, Height, Bitmap,
                                                   PngData);

          if (PngData.Num() == 0) {
            // Alternative: compress as PNG using IImageWrapper
            IImageWrapperModule &ImageWrapperModule =
                FModuleManager::LoadModuleChecked<IImageWrapperModule>(
                    FName("ImageWrapper"));
            TSharedPtr<IImageWrapper> ImageWrapper =
                ImageWrapperModule.CreateImageWrapper(EImageFormat::PNG);

            if (ImageWrapper.IsValid()) {
              TArray<uint8> RawData;
              RawData.SetNum(Width * Height * 4);
              for (int32 i = 0; i < Bitmap.Num(); ++i) {
                RawData[i * 4 + 0] = Bitmap[i].R;
                RawData[i * 4 + 1] = Bitmap[i].G;
                RawData[i * 4 + 2] = Bitmap[i].B;
                RawData[i * 4 + 3] = Bitmap[i].A;
              }

              if (ImageWrapper->SetRaw(RawData.GetData(), RawData.Num(), Width,
                                       Height, ERGBFormat::RGBA, 8)) {
                PngData = ImageWrapper->GetCompressed(100);
              }
            }
          }

          FString FullPath =
              FPaths::Combine(ScreenshotPath, Filename + TEXT(".png"));
          FPaths::MakeStandardFilename(FullPath);

          // Always save to disk
          IFileManager::Get().MakeDirectory(*ScreenshotPath, true);
          bool bSaved = FFileHelper::SaveArrayToFile(PngData, *FullPath);

          bSuccess = true;
          Message = FString::Printf(TEXT("Screenshot captured (%dx%d)"), Width,
                                    Height);
          Resp->SetStringField(TEXT("screenshotPath"), FullPath);
          Resp->SetStringField(TEXT("filename"), Filename);
          Resp->SetNumberField(TEXT("width"), Width);
          Resp->SetNumberField(TEXT("height"), Height);
          Resp->SetNumberField(TEXT("sizeBytes"), PngData.Num());

          // Return base64 encoded image if requested
          if (bReturnBase64 && PngData.Num() > 0) {
            FString Base64Data = FBase64::Encode(PngData);
            Resp->SetStringField(TEXT("imageBase64"), Base64Data);
            Resp->SetStringField(TEXT("mimeType"), TEXT("image/png"));
          }
        }
      }
    }
  } else if (LowerSub == TEXT("play_in_editor")) {
    // Start play in editor
    if (GEditor && GEditor->PlayWorld) {
      Message = TEXT("Already playing in editor");
      ErrorCode = TEXT("ALREADY_PLAYING");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      // Execute play command
      bool bCommandSuccess = GEditor->Exec(nullptr, TEXT("Play In Editor"));
      if (bCommandSuccess) {
        bSuccess = true;
        Message = TEXT("Started play in editor");
        Resp->SetStringField(TEXT("status"), TEXT("playing"));
      } else {
        Message = TEXT("Failed to start play in editor");
        ErrorCode = TEXT("PLAY_FAILED");
        Resp->SetStringField(TEXT("error"), Message);
      }
    }
  } else if (LowerSub == TEXT("stop_play")) {
    // Stop play in editor
    if (GEditor && GEditor->PlayWorld) {
      // Execute stop command
      bool bCommandSuccess =
          GEditor->Exec(nullptr, TEXT("Stop Play In Editor"));
      if (bCommandSuccess) {
        bSuccess = true;
        Message = TEXT("Stopped play in editor");
        Resp->SetStringField(TEXT("status"), TEXT("stopped"));
      } else {
        Message = TEXT("Failed to stop play in editor");
        ErrorCode = TEXT("STOP_FAILED");
        Resp->SetStringField(TEXT("error"), Message);
      }
    } else {
      Message = TEXT("Not currently playing in editor");
      ErrorCode = TEXT("NOT_PLAYING");
      Resp->SetStringField(TEXT("error"), Message);
    }
  } else if (LowerSub == TEXT("save_all")) {
    // Save all assets and levels
    bool bCommandSuccess = GEditor->Exec(nullptr, TEXT("Asset Save All"));
    if (bCommandSuccess) {
      bSuccess = true;
      Message = TEXT("Saved all assets");
      Resp->SetStringField(TEXT("status"), TEXT("saved"));
    } else {
      Message = TEXT("Failed to save all assets");
      ErrorCode = TEXT("SAVE_FAILED");
      Resp->SetStringField(TEXT("error"), Message);
    }
  } else if (LowerSub == TEXT("simulate_input")) {
    FString KeyName;
    Payload->TryGetStringField(TEXT("keyName"),
                               KeyName); // Changed to keyName to match schema
    if (KeyName.IsEmpty())
      Payload->TryGetStringField(TEXT("key"), KeyName); // Fallback

    FString EventType;
    Payload->TryGetStringField(TEXT("eventType"), EventType);

    FKey Key = FKey(FName(*KeyName));
    if (Key.IsValid()) {
      const uint32 CharacterCode = 0;
      const uint32 KeyCode = 0;
      const bool bIsRepeat = false;
      FModifierKeysState ModifierState;

      if (EventType == TEXT("KeyDown")) {
        FKeyEvent KeyEvent(Key, ModifierState,
                           FSlateApplication::Get().GetUserIndexForKeyboard(),
                           bIsRepeat, CharacterCode, KeyCode);
        FSlateApplication::Get().ProcessKeyDownEvent(KeyEvent);
      } else if (EventType == TEXT("KeyUp")) {
        FKeyEvent KeyEvent(Key, ModifierState,
                           FSlateApplication::Get().GetUserIndexForKeyboard(),
                           bIsRepeat, CharacterCode, KeyCode);
        FSlateApplication::Get().ProcessKeyUpEvent(KeyEvent);
      } else {
        // Press and Release
        FKeyEvent KeyDownEvent(
            Key, ModifierState,
            FSlateApplication::Get().GetUserIndexForKeyboard(), bIsRepeat,
            CharacterCode, KeyCode);
        FSlateApplication::Get().ProcessKeyDownEvent(KeyDownEvent);

        FKeyEvent KeyUpEvent(Key, ModifierState,
                             FSlateApplication::Get().GetUserIndexForKeyboard(),
                             bIsRepeat, CharacterCode, KeyCode);
        FSlateApplication::Get().ProcessKeyUpEvent(KeyUpEvent);
      }

      bSuccess = true;
      Message = FString::Printf(TEXT("Simulated input for key: %s"), *KeyName);
    } else {
      Message = FString::Printf(TEXT("Invalid key name: %s"), *KeyName);
      ErrorCode = TEXT("INVALID_KEY");
      Resp->SetStringField(TEXT("error"), Message);
    }
  } else if (LowerSub == TEXT("create_hud")) {
    FString WidgetPath;
    Payload->TryGetStringField(TEXT("widgetPath"), WidgetPath);
    UClass *WidgetClass = LoadClass<UUserWidget>(nullptr, *WidgetPath);
    if (WidgetClass && GEngine && GEngine->GameViewport) {
      UWorld *World = GEngine->GameViewport->GetWorld();
      if (World) {
        UUserWidget *Widget = CreateWidget<UUserWidget>(World, WidgetClass);
        if (Widget) {
          Widget->AddToViewport();
          bSuccess = true;
          Message = TEXT("HUD created and added to viewport");
          Resp->SetStringField(TEXT("widgetName"), Widget->GetName());
        } else {
          Message = TEXT("Failed to create widget");
          ErrorCode = TEXT("CREATE_FAILED");
        }
      } else {
        Message = TEXT("No world context found (is PIE running?)");
        ErrorCode = TEXT("NO_WORLD");
      }
    } else {
      Message =
          FString::Printf(TEXT("Failed to load widget class: %s"), *WidgetPath);
      ErrorCode = TEXT("CLASS_NOT_FOUND");
    }
  } else if (LowerSub == TEXT("set_widget_text")) {
    FString Key, Value;
    Payload->TryGetStringField(TEXT("key"), Key);
    Payload->TryGetStringField(TEXT("value"), Value);

    bool bFound = false;
    // Iterate all widgets to find one matching Key (Name)
    TArray<UUserWidget *> Widgets;
    UWidgetBlueprintLibrary::GetAllWidgetsOfClass(
        GEditor->GetEditorWorldContext().World(), Widgets,
        UUserWidget::StaticClass(), false);
    // Also try Game Viewport world if Editor World is not right context (PIE)
    if (GEngine && GEngine->GameViewport && GEngine->GameViewport->GetWorld()) {
      UWidgetBlueprintLibrary::GetAllWidgetsOfClass(
          GEngine->GameViewport->GetWorld(), Widgets,
          UUserWidget::StaticClass(), false);
    }

    for (UUserWidget *Widget : Widgets) {
      // Search inside this widget for a TextBlock named Key
      UWidget *Child = Widget->GetWidgetFromName(FName(*Key));
      if (UTextBlock *TextBlock = Cast<UTextBlock>(Child)) {
        TextBlock->SetText(FText::FromString(Value));
        bFound = true;
        bSuccess = true;
        Message =
            FString::Printf(TEXT("Set text on '%s' to '%s'"), *Key, *Value);
        break;
      }
      // Also check if the widget ITSELF is the one (though UserWidget !=
      // TextBlock usually)
      if (Widget->GetName() == Key) {
        // Can't set text on UserWidget directly unless it implements interface?
        // Assuming Key refers to child widget name usually
      }
    }

    if (!bFound) {
      // Fallback: Use TObjectIterator to find ANY UTextBlock with that name,
      // risky but covers cases
      for (TObjectIterator<UTextBlock> It; It; ++It) {
        if (It->GetName() == Key && It->GetWorld()) {
          It->SetText(FText::FromString(Value));
          bFound = true;
          bSuccess = true;
          Message = FString::Printf(TEXT("Set text on global '%s'"), *Key);
          break;
        }
      }
    }

    if (!bFound) {
      Message = FString::Printf(TEXT("Widget/TextBlock '%s' not found"), *Key);
      ErrorCode = TEXT("WIDGET_NOT_FOUND");
    }
  } else if (LowerSub == TEXT("set_widget_image")) {
    FString Key, TexturePath;
    Payload->TryGetStringField(TEXT("key"), Key);
    Payload->TryGetStringField(TEXT("texturePath"), TexturePath);
    UTexture2D *Texture = LoadObject<UTexture2D>(nullptr, *TexturePath);
    if (Texture) {
      bool bFound = false;
      for (TObjectIterator<UImage> It; It; ++It) {
        if (It->GetName() == Key && It->GetWorld()) {
          It->SetBrushFromTexture(Texture);
          bFound = true;
          bSuccess = true;
          Message = FString::Printf(TEXT("Set image on '%s'"), *Key);
          break;
        }
      }
      if (!bFound) {
        Message = FString::Printf(TEXT("Image widget '%s' not found"), *Key);
        ErrorCode = TEXT("WIDGET_NOT_FOUND");
      }
    } else {
      Message = TEXT("Failed to load texture");
      ErrorCode = TEXT("ASSET_NOT_FOUND");
    }
  } else if (LowerSub == TEXT("set_widget_visibility")) {
    FString Key;
    bool bVisible = true;
    Payload->TryGetStringField(TEXT("key"), Key);
    Payload->TryGetBoolField(TEXT("visible"), bVisible);

    bool bFound = false;
    // Try UserWidgets
    for (TObjectIterator<UUserWidget> It; It; ++It) {
      if (It->GetName() == Key && It->GetWorld()) {
        It->SetVisibility(bVisible ? ESlateVisibility::Visible
                                   : ESlateVisibility::Collapsed);
        bFound = true;
        bSuccess = true;
        break;
      }
    }
    // If not found, try generic UWidget
    if (!bFound) {
      for (TObjectIterator<UWidget> It; It; ++It) {
        if (It->GetName() == Key && It->GetWorld()) {
          It->SetVisibility(bVisible ? ESlateVisibility::Visible
                                     : ESlateVisibility::Collapsed);
          bFound = true;
          bSuccess = true;
          break;
        }
      }
    }

    if (bFound) {
      Message = FString::Printf(TEXT("Set visibility on '%s' to %s"), *Key,
                                bVisible ? TEXT("Visible") : TEXT("Collapsed"));
    } else {
      Message = FString::Printf(TEXT("Widget '%s' not found"), *Key);
      ErrorCode = TEXT("WIDGET_NOT_FOUND");
    }
  } else if (LowerSub == TEXT("remove_widget_from_viewport")) {
    FString Key;
    Payload->TryGetStringField(TEXT("key"),
                               Key); // If empty, remove all? OR specific

    if (Key.IsEmpty()) {
      // Remove all user widgets?
      TArray<UUserWidget *> TempWidgets;
      UWidgetBlueprintLibrary::GetAllWidgetsOfClass(
          GEditor->GetEditorWorldContext().World(), TempWidgets,
          UUserWidget::StaticClass(), true);
      // Implementation:
      if (GEngine && GEngine->GameViewport &&
          GEngine->GameViewport->GetWorld()) {
        TArray<UUserWidget *> Widgets;
        UWidgetBlueprintLibrary::GetAllWidgetsOfClass(
            GEngine->GameViewport->GetWorld(), Widgets,
            UUserWidget::StaticClass(), true);
        for (UUserWidget *W : Widgets) {
          W->RemoveFromParent();
        }
        bSuccess = true;
        Message = TEXT("Removed all widgets");
      }
    } else {
      bool bFound = false;
      for (TObjectIterator<UUserWidget> It; It; ++It) {
        if (It->GetName() == Key && It->GetWorld()) {
          It->RemoveFromParent();
          bFound = true;
          bSuccess = true;
          break;
        }
      }
      if (bFound) {
        Message = FString::Printf(TEXT("Removed widget '%s'"), *Key);
      } else {
        Message = FString::Printf(TEXT("Widget '%s' not found"), *Key);
        ErrorCode = TEXT("WIDGET_NOT_FOUND");
      }
    }
  }
  // ============================================================================
  // Automation Driver Session Management Handlers
  // ============================================================================
  // These handlers provide programmatic UI testing capabilities through
  // Unreal Engine's Automation Driver API. The driver MUST be explicitly
  // enabled/disabled for each test session.
  //
  // CRITICAL: When enabled, the Automation Driver BLOCKS platform input!
  // Always follow: ui_session_start -> operations -> ui_session_end
  // ============================================================================
#if MCP_HAS_AUTOMATION_DRIVER
  else if (LowerSub == TEXT("ui_session_start")) {
    // Enable Automation Driver and create session
    // WARNING: This blocks nearly all platform input until ui_session_end!
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("UI automation session already active - call ui_session_end first");
      ErrorCode = TEXT("SESSION_ACTIVE");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      // Load and enable the Automation Driver module
      IAutomationDriverModule& Module = FModuleManager::LoadModuleChecked<IAutomationDriverModule>("AutomationDriver");

      // Enable the driver - THIS BLOCKS PLATFORM INPUT
      Module.Enable();

      // Create driver instance
      McpUIAutomation::ActiveDriver = Module.CreateDriver();

      bSuccess = true;
      Message = TEXT("UI automation session started - platform input is now blocked");
      Resp->SetBoolField(TEXT("sessionActive"), true);
      Resp->SetStringField(TEXT("warning"), TEXT("Platform input is blocked while session is active"));
    }
  } else if (LowerSub == TEXT("ui_session_end")) {
    // Disable Automation Driver and end session
    // This restores platform input
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      // Disable the driver - restores platform input
      IAutomationDriverModule& Module = FModuleManager::GetModuleChecked<IAutomationDriverModule>("AutomationDriver");
      Module.Disable();

      // Clear driver reference
      McpUIAutomation::ActiveDriver.Reset();

      bSuccess = true;
      Message = TEXT("UI automation session ended - platform input restored");
      Resp->SetBoolField(TEXT("sessionActive"), false);
    }
  } else if (LowerSub == TEXT("ui_session_status")) {
    // Get current session status
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    bool bSessionActive = McpUIAutomation::ActiveDriver.IsValid();
    bool bModuleEnabled = false;

    if (FModuleManager::Get().IsModuleLoaded("AutomationDriver")) {
      IAutomationDriverModule& Module = FModuleManager::GetModuleChecked<IAutomationDriverModule>("AutomationDriver");
      bModuleEnabled = Module.IsEnabled();
    }

    bSuccess = true;
    Message = bSessionActive ? TEXT("UI automation session is active") : TEXT("No UI automation session active");
    Resp->SetBoolField(TEXT("sessionActive"), bSessionActive);
    Resp->SetBoolField(TEXT("moduleEnabled"), bModuleEnabled);
    Resp->SetBoolField(TEXT("inputBlocked"), bModuleEnabled);
  } else if (LowerSub == TEXT("ui_click")) {
    // Click on element by locator
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FString LocatorType, LocatorValue;
      Payload->TryGetStringField(TEXT("locatorType"), LocatorType);
      Payload->TryGetStringField(TEXT("locatorValue"), LocatorValue);

      if (LocatorType.IsEmpty()) {
        LocatorType = TEXT("path"); // Default to path-based locator
      }

      // Create locator and find element
      TSharedRef<IElementLocator, ESPMode::ThreadSafe> Locator =
          McpUIAutomation::CreateLocator(LocatorType, LocatorValue);
      TSharedRef<IDriverElement, ESPMode::ThreadSafe> Element =
          McpUIAutomation::ActiveDriver->FindElement(Locator);

      // Check if element exists before clicking
      if (Element->Exists()) {
        bool bClickResult = Element->Click();
        if (bClickResult) {
          bSuccess = true;
          Message = FString::Printf(TEXT("Clicked element: %s=%s"), *LocatorType, *LocatorValue);
          Resp->SetStringField(TEXT("locatorType"), LocatorType);
          Resp->SetStringField(TEXT("locatorValue"), LocatorValue);
        } else {
          Message = FString::Printf(TEXT("Click failed on element: %s=%s"), *LocatorType, *LocatorValue);
          ErrorCode = TEXT("CLICK_FAILED");
          Resp->SetStringField(TEXT("error"), Message);
        }
      } else {
        Message = FString::Printf(TEXT("Element not found: %s=%s"), *LocatorType, *LocatorValue);
        ErrorCode = TEXT("ELEMENT_NOT_FOUND");
        Resp->SetStringField(TEXT("error"), Message);
      }
    }
  } else if (LowerSub == TEXT("ui_double_click")) {
    // Double-click on element by locator
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FString LocatorType, LocatorValue;
      Payload->TryGetStringField(TEXT("locatorType"), LocatorType);
      Payload->TryGetStringField(TEXT("locatorValue"), LocatorValue);

      if (LocatorType.IsEmpty()) {
        LocatorType = TEXT("path");
      }

      TSharedRef<IElementLocator, ESPMode::ThreadSafe> Locator =
          McpUIAutomation::CreateLocator(LocatorType, LocatorValue);
      TSharedRef<IDriverElement, ESPMode::ThreadSafe> Element =
          McpUIAutomation::ActiveDriver->FindElement(Locator);

      if (Element->Exists()) {
        bool bClickResult = Element->DoubleClick();
        if (bClickResult) {
          bSuccess = true;
          Message = FString::Printf(TEXT("Double-clicked element: %s=%s"), *LocatorType, *LocatorValue);
        } else {
          Message = FString::Printf(TEXT("Double-click failed on element: %s=%s"), *LocatorType, *LocatorValue);
          ErrorCode = TEXT("CLICK_FAILED");
          Resp->SetStringField(TEXT("error"), Message);
        }
      } else {
        Message = FString::Printf(TEXT("Element not found: %s=%s"), *LocatorType, *LocatorValue);
        ErrorCode = TEXT("ELEMENT_NOT_FOUND");
        Resp->SetStringField(TEXT("error"), Message);
      }
    }
  } else if (LowerSub == TEXT("ui_hover")) {
    // Hover over element by locator
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FString LocatorType, LocatorValue;
      Payload->TryGetStringField(TEXT("locatorType"), LocatorType);
      Payload->TryGetStringField(TEXT("locatorValue"), LocatorValue);

      if (LocatorType.IsEmpty()) {
        LocatorType = TEXT("path");
      }

      TSharedRef<IElementLocator, ESPMode::ThreadSafe> Locator =
          McpUIAutomation::CreateLocator(LocatorType, LocatorValue);
      TSharedRef<IDriverElement, ESPMode::ThreadSafe> Element =
          McpUIAutomation::ActiveDriver->FindElement(Locator);

      if (Element->Exists()) {
        bool bHoverResult = Element->Hover();
        if (bHoverResult) {
          bSuccess = true;
          Message = FString::Printf(TEXT("Hovering over element: %s=%s"), *LocatorType, *LocatorValue);
          Resp->SetBoolField(TEXT("isHovered"), Element->IsHovered());
        } else {
          Message = FString::Printf(TEXT("Hover failed on element: %s=%s"), *LocatorType, *LocatorValue);
          ErrorCode = TEXT("HOVER_FAILED");
          Resp->SetStringField(TEXT("error"), Message);
        }
      } else {
        Message = FString::Printf(TEXT("Element not found: %s=%s"), *LocatorType, *LocatorValue);
        ErrorCode = TEXT("ELEMENT_NOT_FOUND");
        Resp->SetStringField(TEXT("error"), Message);
      }
    }
  } else if (LowerSub == TEXT("ui_type")) {
    // Type text into focused element or specified element
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FString Text;
      Payload->TryGetStringField(TEXT("text"), Text);

      FString LocatorType, LocatorValue;
      Payload->TryGetStringField(TEXT("locatorType"), LocatorType);
      Payload->TryGetStringField(TEXT("locatorValue"), LocatorValue);

      TSharedRef<IDriverElement, ESPMode::ThreadSafe> Element =
          (LocatorType.IsEmpty() || LocatorValue.IsEmpty())
              ? McpUIAutomation::ActiveDriver->FindElement(By::KeyboardFocus())
              : McpUIAutomation::ActiveDriver->FindElement(
                    McpUIAutomation::CreateLocator(LocatorType, LocatorValue));

      if (Element->Exists()) {
        bool bTypeResult = Element->Type(Text);
        if (bTypeResult) {
          bSuccess = true;
          Message = FString::Printf(TEXT("Typed text: '%s'"), *Text);
          Resp->SetStringField(TEXT("typedText"), Text);
        } else {
          Message = TEXT("Type operation failed");
          ErrorCode = TEXT("TYPE_FAILED");
          Resp->SetStringField(TEXT("error"), Message);
        }
      } else {
        Message = TEXT("Target element not found for typing");
        ErrorCode = TEXT("ELEMENT_NOT_FOUND");
        Resp->SetStringField(TEXT("error"), Message);
      }
    }
  } else if (LowerSub == TEXT("ui_focus")) {
    // Focus on element by locator
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FString LocatorType, LocatorValue;
      Payload->TryGetStringField(TEXT("locatorType"), LocatorType);
      Payload->TryGetStringField(TEXT("locatorValue"), LocatorValue);

      if (LocatorType.IsEmpty()) {
        LocatorType = TEXT("path");
      }

      TSharedRef<IElementLocator, ESPMode::ThreadSafe> Locator =
          McpUIAutomation::CreateLocator(LocatorType, LocatorValue);
      TSharedRef<IDriverElement, ESPMode::ThreadSafe> Element =
          McpUIAutomation::ActiveDriver->FindElement(Locator);

      if (Element->Exists()) {
        if (Element->CanFocus()) {
          bool bFocusResult = Element->Focus();
          if (bFocusResult) {
            bSuccess = true;
            Message = FString::Printf(TEXT("Focused element: %s=%s"), *LocatorType, *LocatorValue);
            Resp->SetBoolField(TEXT("isFocused"), Element->IsFocused());
          } else {
            Message = FString::Printf(TEXT("Focus failed on element: %s=%s"), *LocatorType, *LocatorValue);
            ErrorCode = TEXT("FOCUS_FAILED");
            Resp->SetStringField(TEXT("error"), Message);
          }
        } else {
          Message = FString::Printf(TEXT("Element cannot be focused: %s=%s"), *LocatorType, *LocatorValue);
          ErrorCode = TEXT("NOT_FOCUSABLE");
          Resp->SetStringField(TEXT("error"), Message);
        }
      } else {
        Message = FString::Printf(TEXT("Element not found: %s=%s"), *LocatorType, *LocatorValue);
        ErrorCode = TEXT("ELEMENT_NOT_FOUND");
        Resp->SetStringField(TEXT("error"), Message);
      }
    }
  } else if (LowerSub == TEXT("ui_scroll")) {
    // Scroll element by delta
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FString LocatorType, LocatorValue;
      Payload->TryGetStringField(TEXT("locatorType"), LocatorType);
      Payload->TryGetStringField(TEXT("locatorValue"), LocatorValue);
      double Delta = 1.0;
      Payload->TryGetNumberField(TEXT("delta"), Delta);

      if (LocatorType.IsEmpty()) {
        LocatorType = TEXT("path");
      }

      TSharedRef<IElementLocator, ESPMode::ThreadSafe> Locator =
          McpUIAutomation::CreateLocator(LocatorType, LocatorValue);
      TSharedRef<IDriverElement, ESPMode::ThreadSafe> Element =
          McpUIAutomation::ActiveDriver->FindElement(Locator);

      if (Element->Exists()) {
        bool bScrollResult = Element->ScrollBy(static_cast<float>(Delta));
        if (bScrollResult) {
          bSuccess = true;
          Message = FString::Printf(TEXT("Scrolled element by delta: %.2f"), Delta);
          Resp->SetNumberField(TEXT("delta"), Delta);
        } else {
          Message = TEXT("Scroll operation failed");
          ErrorCode = TEXT("SCROLL_FAILED");
          Resp->SetStringField(TEXT("error"), Message);
        }
      } else {
        Message = FString::Printf(TEXT("Element not found: %s=%s"), *LocatorType, *LocatorValue);
        ErrorCode = TEXT("ELEMENT_NOT_FOUND");
        Resp->SetStringField(TEXT("error"), Message);
      }
    }
  } else if (LowerSub == TEXT("ui_wait_for")) {
    // Wait for element to appear/become visible/interactable
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FString LocatorType, LocatorValue;
      Payload->TryGetStringField(TEXT("locatorType"), LocatorType);
      Payload->TryGetStringField(TEXT("locatorValue"), LocatorValue);

      double TimeoutMs = 5000.0;
      Payload->TryGetNumberField(TEXT("timeoutMs"), TimeoutMs);

      FString WaitCondition;
      Payload->TryGetStringField(TEXT("condition"), WaitCondition);
      if (WaitCondition.IsEmpty()) {
        WaitCondition = TEXT("exists"); // Default wait condition
      }

      if (LocatorType.IsEmpty()) {
        LocatorType = TEXT("path");
      }

      TSharedRef<IElementLocator, ESPMode::ThreadSafe> Locator =
          McpUIAutomation::CreateLocator(LocatorType, LocatorValue);

      // Create appropriate wait delegate based on condition
      FDriverWaitDelegate WaitDelegate;
      FWaitTimeout Timeout = FWaitTimeout::InMilliseconds(TimeoutMs);

      if (WaitCondition.Equals(TEXT("visible"), ESearchCase::IgnoreCase)) {
        WaitDelegate = Until::ElementIsVisible(Locator, Timeout);
      } else if (WaitCondition.Equals(TEXT("hidden"), ESearchCase::IgnoreCase)) {
        WaitDelegate = Until::ElementIsHidden(Locator, Timeout);
      } else if (WaitCondition.Equals(TEXT("interactable"), ESearchCase::IgnoreCase)) {
        WaitDelegate = Until::ElementIsInteractable(Locator, Timeout);
      } else if (WaitCondition.Equals(TEXT("focused"), ESearchCase::IgnoreCase)) {
        WaitDelegate = Until::ElementIsFocusedByKeyboard(Locator, Timeout);
      } else {
        // Default: wait for element to exist
        WaitDelegate = Until::ElementExists(Locator, Timeout);
      }

      bool bWaitResult = McpUIAutomation::ActiveDriver->Wait(WaitDelegate);

      Resp->SetBoolField(TEXT("found"), bWaitResult);
      Resp->SetStringField(TEXT("condition"), WaitCondition);
      Resp->SetNumberField(TEXT("timeoutMs"), TimeoutMs);

      if (bWaitResult) {
        bSuccess = true;
        Message = FString::Printf(TEXT("Wait condition '%s' satisfied for: %s=%s"),
            *WaitCondition, *LocatorType, *LocatorValue);
      } else {
        Message = FString::Printf(TEXT("Timeout waiting for condition '%s': %s=%s"),
            *WaitCondition, *LocatorType, *LocatorValue);
        ErrorCode = TEXT("TIMEOUT");
        Resp->SetStringField(TEXT("error"), Message);
      }
    }
  } else if (LowerSub == TEXT("ui_element_exists")) {
    // Check if element exists
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FString LocatorType, LocatorValue;
      Payload->TryGetStringField(TEXT("locatorType"), LocatorType);
      Payload->TryGetStringField(TEXT("locatorValue"), LocatorValue);

      if (LocatorType.IsEmpty()) {
        LocatorType = TEXT("path");
      }

      TSharedRef<IElementLocator, ESPMode::ThreadSafe> Locator =
          McpUIAutomation::CreateLocator(LocatorType, LocatorValue);
      TSharedRef<IDriverElement, ESPMode::ThreadSafe> Element =
          McpUIAutomation::ActiveDriver->FindElement(Locator);

      bool bExists = Element->Exists();
      bSuccess = true;
      Message = bExists
          ? FString::Printf(TEXT("Element exists: %s=%s"), *LocatorType, *LocatorValue)
          : FString::Printf(TEXT("Element does not exist: %s=%s"), *LocatorType, *LocatorValue);

      Resp->SetBoolField(TEXT("exists"), bExists);
      Resp->SetStringField(TEXT("locatorType"), LocatorType);
      Resp->SetStringField(TEXT("locatorValue"), LocatorValue);
    }
  } else if (LowerSub == TEXT("ui_get_element_info")) {
    // Get comprehensive element information
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FString LocatorType, LocatorValue;
      Payload->TryGetStringField(TEXT("locatorType"), LocatorType);
      Payload->TryGetStringField(TEXT("locatorValue"), LocatorValue);

      if (LocatorType.IsEmpty()) {
        LocatorType = TEXT("path");
      }

      TSharedRef<IElementLocator, ESPMode::ThreadSafe> Locator =
          McpUIAutomation::CreateLocator(LocatorType, LocatorValue);
      TSharedRef<IDriverElement, ESPMode::ThreadSafe> Element =
          McpUIAutomation::ActiveDriver->FindElement(Locator);

      if (Element->Exists()) {
        bSuccess = true;
        Message = FString::Printf(TEXT("Element info retrieved: %s=%s"), *LocatorType, *LocatorValue);

        // Get element properties
        Resp->SetBoolField(TEXT("exists"), true);
        Resp->SetBoolField(TEXT("visible"), Element->IsVisible());
        Resp->SetBoolField(TEXT("interactable"), Element->IsInteractable());
        Resp->SetBoolField(TEXT("focused"), Element->IsFocused());
        Resp->SetBoolField(TEXT("canFocus"), Element->CanFocus());
        Resp->SetBoolField(TEXT("hovered"), Element->IsHovered());
        Resp->SetBoolField(TEXT("checked"), Element->IsChecked());
        Resp->SetBoolField(TEXT("scrollable"), Element->IsScrollable());

        // Get position and size
        FVector2D Position = Element->GetAbsolutePosition();
        FVector2D Size = Element->GetSize();

        TSharedPtr<FJsonObject> PositionObj = MakeShared<FJsonObject>();
        PositionObj->SetNumberField(TEXT("x"), Position.X);
        PositionObj->SetNumberField(TEXT("y"), Position.Y);
        Resp->SetObjectField(TEXT("position"), PositionObj);

        TSharedPtr<FJsonObject> SizeObj = MakeShared<FJsonObject>();
        SizeObj->SetNumberField(TEXT("width"), Size.X);
        SizeObj->SetNumberField(TEXT("height"), Size.Y);
        Resp->SetObjectField(TEXT("size"), SizeObj);

        // Get text if available
        FText ElementText = Element->GetText();
        if (!ElementText.IsEmpty()) {
          Resp->SetStringField(TEXT("text"), ElementText.ToString());
        }
      } else {
        Message = FString::Printf(TEXT("Element not found: %s=%s"), *LocatorType, *LocatorValue);
        ErrorCode = TEXT("ELEMENT_NOT_FOUND");
        Resp->SetStringField(TEXT("error"), Message);
        Resp->SetBoolField(TEXT("exists"), false);
      }
    }
  } else if (LowerSub == TEXT("ui_get_cursor_position")) {
    // Get current cursor position
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      FVector2D CursorPos = McpUIAutomation::ActiveDriver->GetCursorPosition();
      bSuccess = true;
      Message = FString::Printf(TEXT("Cursor position: (%.2f, %.2f)"), CursorPos.X, CursorPos.Y);

      TSharedPtr<FJsonObject> PositionObj = MakeShared<FJsonObject>();
      PositionObj->SetNumberField(TEXT("x"), CursorPos.X);
      PositionObj->SetNumberField(TEXT("y"), CursorPos.Y);
      Resp->SetObjectField(TEXT("cursorPosition"), PositionObj);
    }
  } else if (LowerSub == TEXT("ui_wait_time")) {
    // Wait for a specified duration
    FScopeLock Lock(&McpUIAutomation::DriverMutex);

    if (!McpUIAutomation::ActiveDriver.IsValid()) {
      Message = TEXT("No UI automation session active - call ui_session_start first");
      ErrorCode = TEXT("NO_SESSION");
      Resp->SetStringField(TEXT("error"), Message);
    } else {
      double DurationMs = 1000.0;
      Payload->TryGetNumberField(TEXT("durationMs"), DurationMs);

      bool bWaitResult = McpUIAutomation::ActiveDriver->Wait(FTimespan::FromMilliseconds(DurationMs));

      bSuccess = bWaitResult;
      Message = FString::Printf(TEXT("Waited for %.0f ms"), DurationMs);
      Resp->SetNumberField(TEXT("durationMs"), DurationMs);
      Resp->SetBoolField(TEXT("completed"), bWaitResult);
    }
  }
#endif // MCP_HAS_AUTOMATION_DRIVER
  else {
    Message = FString::Printf(
        TEXT("System control action '%s' not implemented"), *LowerSub);
    ErrorCode = TEXT("NOT_IMPLEMENTED");
    Resp->SetStringField(TEXT("error"), Message);
  }
#else
  Message = TEXT("System control actions require editor build.");
  ErrorCode = TEXT("NOT_IMPLEMENTED");
  Resp->SetStringField(TEXT("error"), Message);
#endif

  Resp->SetBoolField(TEXT("success"), bSuccess);
  if (Message.IsEmpty()) {
    Message = bSuccess ? TEXT("System control action completed")
                       : TEXT("System control action failed");
  }

  SendAutomationResponse(RequestingSocket, RequestId, bSuccess, Message, Resp,
                         ErrorCode);
  return true;
}
