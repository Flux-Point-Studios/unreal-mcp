#include "McpAutomationBridgeGlobals.h"
#include "Dom/JsonObject.h"
#include "McpAutomationBridgeHelpers.h"
#include "McpAutomationBridgeSubsystem.h"

#if WITH_EDITOR
#include "Editor/UnrealEd/Public/Editor.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformFileManager.h"
#include "HAL/PlatformProcess.h"
#include "Misc/Paths.h"
#include "Misc/App.h"
#include "Misc/MonitoredProcess.h"
#include "EditorAssetLibrary.h"
#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "Engine/StaticMesh.h"
#include "Engine/SkeletalMesh.h"
#include "Materials/Material.h"
#include "Materials/MaterialInstanceConstant.h"
#include "Exporters/Exporter.h"
#include "Misc/FileHelper.h"
#include "Misc/OutputDeviceRedirector.h"

// Editor Utility classes for execute_script (editor_utility type)
#include "EditorUtilitySubsystem.h"
#include "EditorUtilityWidgetBlueprint.h"
#include "EditorUtilityBlueprint.h"
#include "EditorUtilityObject.h"
#endif

bool UMcpAutomationBridgeSubsystem::HandleSystemControlAction(
    const FString &RequestId, const FString &Action,
    const TSharedPtr<FJsonObject> &Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket) {
  // The sub-action is in the payload's "action" field
  FString SubAction;
  if (Payload.IsValid()) {
    Payload->TryGetStringField(TEXT("action"), SubAction);
  }
  
  const FString Lower = SubAction.ToLower();
  
  // Check if this handler should process this sub-action
  if (!Lower.StartsWith(TEXT("run_ubt")) &&
      !Lower.StartsWith(TEXT("run_tests")) &&
      !Lower.StartsWith(TEXT("test_progress")) &&
      !Lower.StartsWith(TEXT("test_stale")) &&
      Lower != TEXT("export_asset") &&
      Lower != TEXT("execute_script")) {
    return false; // Not handled by this function
  }

#if WITH_EDITOR
  if (!Payload.IsValid()) {
    SendAutomationError(RequestingSocket, RequestId,
                        TEXT("System control payload missing"),
                        TEXT("INVALID_PAYLOAD"));
    return true;
  }

  if (Lower == TEXT("run_ubt")) {
    // Extract optional parameters
    FString Target;
    Payload->TryGetStringField(TEXT("target"), Target);
    
    FString Platform;
    Payload->TryGetStringField(TEXT("platform"), Platform);
    
    FString Configuration;
    Payload->TryGetStringField(TEXT("configuration"), Configuration);
    
    FString AdditionalArgs;
    Payload->TryGetStringField(TEXT("additionalArgs"), AdditionalArgs);

    // Build UBT path
    FString EngineDir = FPaths::EngineDir();
    FString UBTPath;
    
#if PLATFORM_WINDOWS
    UBTPath = FPaths::Combine(EngineDir, TEXT("Build/BatchFiles/Build.bat"));
#else
    UBTPath = FPaths::Combine(EngineDir, TEXT("Build/BatchFiles/Build.sh"));
#endif

    if (!FPaths::FileExists(UBTPath)) {
      SendAutomationError(RequestingSocket, RequestId,
                          FString::Printf(TEXT("UBT not found at: %s"), *UBTPath),
                          TEXT("UBT_NOT_FOUND"));
      return true;
    }

    // Build command line arguments
    FString Arguments;
    
    // Target (project or engine target)
    if (!Target.IsEmpty()) {
      Arguments += Target + TEXT(" ");
    } else {
      // Default to current project
      FString ProjectPath = FPaths::GetProjectFilePath();
      if (!ProjectPath.IsEmpty()) {
        Arguments += FString::Printf(TEXT("-project=\"%s\" "), *ProjectPath);
      }
    }
    
    // Platform
    if (!Platform.IsEmpty()) {
      Arguments += Platform + TEXT(" ");
    } else {
#if PLATFORM_WINDOWS
      Arguments += TEXT("Win64 ");
#elif PLATFORM_MAC
      Arguments += TEXT("Mac ");
#else
      Arguments += TEXT("Linux ");
#endif
    }
    
    // Configuration
    if (!Configuration.IsEmpty()) {
      Arguments += Configuration + TEXT(" ");
    } else {
      Arguments += TEXT("Development ");
    }
    
    // Additional args
    if (!AdditionalArgs.IsEmpty()) {
      Arguments += AdditionalArgs;
    }

    // Use FMonitoredProcess for non-blocking execution with output capture
    // For simplicity, we'll use a synchronous approach with timeout
    int32 ReturnCode = -1;
    FString StdOut;
    FString StdErr;
    
    // Note: FPlatformProcess::ExecProcess is simpler but blocks
    // Using CreateProc with pipes for better control
    void* ReadPipe = nullptr;
    void* WritePipe = nullptr;
    FPlatformProcess::CreatePipe(ReadPipe, WritePipe);
    
    FProcHandle ProcessHandle = FPlatformProcess::CreateProc(
        *UBTPath,
        *Arguments,
        false,  // bLaunchDetached
        true,   // bLaunchHidden
        true,   // bLaunchReallyHidden
        nullptr, // OutProcessID
        0,      // PriorityModifier
        nullptr, // OptionalWorkingDirectory
        WritePipe // PipeWriteChild
    );

    if (!ProcessHandle.IsValid()) {
      FPlatformProcess::ClosePipe(ReadPipe, WritePipe);
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("Failed to launch UBT process"),
                          TEXT("PROCESS_LAUNCH_FAILED"));
      return true;
    }

    // Read output with timeout (30 seconds max wait, but check periodically)
    const double TimeoutSeconds = 300.0; // 5 minute timeout for builds
    const double StartTime = FPlatformTime::Seconds();
    
    while (FPlatformProcess::IsProcRunning(ProcessHandle)) {
      // Read available output
      FString NewOutput = FPlatformProcess::ReadPipe(ReadPipe);
      if (!NewOutput.IsEmpty()) {
        StdOut += NewOutput;
      }
      
      // Check timeout
      if (FPlatformTime::Seconds() - StartTime > TimeoutSeconds) {
        FPlatformProcess::TerminateProc(ProcessHandle, true);
        FPlatformProcess::ClosePipe(ReadPipe, WritePipe);
        
        TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
        Result->SetStringField(TEXT("output"), StdOut);
        Result->SetBoolField(TEXT("timedOut"), true);
        
        SendAutomationResponse(RequestingSocket, RequestId, false,
                               TEXT("UBT process timed out"), Result,
                               TEXT("TIMEOUT"));
        return true;
      }
      
      // Small sleep to avoid busy waiting
      FPlatformProcess::Sleep(0.1f);
    }

    // Read any remaining output
    FString FinalOutput = FPlatformProcess::ReadPipe(ReadPipe);
    if (!FinalOutput.IsEmpty()) {
      StdOut += FinalOutput;
    }

    // Get return code
    FPlatformProcess::GetProcReturnCode(ProcessHandle, &ReturnCode);
    FPlatformProcess::CloseProc(ProcessHandle);
    FPlatformProcess::ClosePipe(ReadPipe, WritePipe);

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("output"), StdOut);
    Result->SetNumberField(TEXT("returnCode"), ReturnCode);
    Result->SetStringField(TEXT("ubtPath"), UBTPath);
    Result->SetStringField(TEXT("arguments"), Arguments);

    if (ReturnCode == 0) {
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("UBT completed successfully"), Result);
    } else {
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             FString::Printf(TEXT("UBT failed with code %d"), ReturnCode),
                             Result, TEXT("UBT_FAILED"));
    }
    return true;
  } else if (Lower == TEXT("run_tests")) {
    // Extract test filter
    FString Filter;
    Payload->TryGetStringField(TEXT("filter"), Filter);
    
    FString TestName;
    Payload->TryGetStringField(TEXT("test"), TestName);
    
    // If specific test name provided, use it as filter
    if (!TestName.IsEmpty() && Filter.IsEmpty()) {
      Filter = TestName;
    }
    
    // Build automation test command
    FString TestCommand;
    if (Filter.IsEmpty()) {
      // Run all tests
      TestCommand = TEXT("automation RunAll");
    } else {
      // Run filtered tests
      TestCommand = FString::Printf(TEXT("automation RunTests %s"), *Filter);
    }

    // Execute the automation command
    if (GEngine && GEditor && GEditor->GetEditorWorldContext().World()) {
      GEngine->Exec(GEditor->GetEditorWorldContext().World(), *TestCommand);
      
      TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
      Result->SetStringField(TEXT("command"), TestCommand);
      Result->SetStringField(TEXT("filter"), Filter);
      
      // Note: Automation tests run asynchronously in UE.
      // The command starts the tests, but results come later via automation framework.
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             TEXT("Automation tests started. Check Output Log for results."),
                             Result);
    } else {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("Editor world not available for running tests"),
                          TEXT("EDITOR_NOT_AVAILABLE"));
    }
    return true;
  } else   if (Lower == TEXT("test_progress_protocol")) {
    // Test action for heartbeat/progress protocol
    // Simulates a long-running operation with progress updates
    UE_LOG(LogMcpAutomationBridgeSubsystem, Log,
           TEXT("test_progress_protocol: Handler called successfully"));
    int32 Steps = 5;
    Payload->TryGetNumberField(TEXT("steps"), Steps);
    Steps = FMath::Clamp(Steps, 1, 20);
    
    float StepDurationMs = 500.0f;
    Payload->TryGetNumberField(TEXT("stepDurationMs"), StepDurationMs);
    StepDurationMs = FMath::Clamp(StepDurationMs, 100.0f, 5000.0f);
    
    bool bSendProgress = true;
    if (Payload->HasField(TEXT("sendProgress"))) {
      bSendProgress = Payload->GetBoolField(TEXT("sendProgress"));
    }
    
    UE_LOG(LogMcpAutomationBridgeSubsystem, Log,
           TEXT("test_progress_protocol: Starting %d steps, %.0fms each, progress=%s"),
           Steps, StepDurationMs, bSendProgress ? TEXT("true") : TEXT("false"));
    
    for (int32 i = 1; i <= Steps; i++) {
      // Send progress update before each step
      if (bSendProgress) {
        float Percent = (static_cast<float>(i) / static_cast<float>(Steps)) * 100.0f;
        FString StatusMsg = FString::Printf(TEXT("Step %d/%d"), i, Steps);
        SendProgressUpdate(RequestId, Percent, StatusMsg, true);
      }
      
      // Simulate work by sleeping
      FPlatformProcess::Sleep(StepDurationMs / 1000.0f);
    }
    
    // Send final progress indicating completion
    if (bSendProgress) {
      SendProgressUpdate(RequestId, 100.0f, TEXT("Complete"), false);
    }
    
    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetNumberField(TEXT("steps"), Steps);
    Result->SetNumberField(TEXT("stepDurationMs"), StepDurationMs);
    Result->SetBoolField(TEXT("progressSent"), bSendProgress);
    Result->SetStringField(TEXT("message"), TEXT("Progress protocol test completed"));
    
    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("Progress protocol test completed successfully"), Result);
    return true;
  } else if (Lower == TEXT("test_stale_progress")) {
    // Test action for stale progress detection
    // Sends the same progress percent multiple times to trigger stale detection
    int32 StaleCount = 5;
    Payload->TryGetNumberField(TEXT("staleCount"), StaleCount);
    StaleCount = FMath::Clamp(StaleCount, 1, 10);
    
    UE_LOG(LogMcpAutomationBridgeSubsystem, Log,
           TEXT("test_stale_progress: Sending %d stale updates"), StaleCount);
    
    // Send same progress repeatedly to trigger stale detection
    for (int32 i = 0; i < StaleCount; i++) {
      FString StatusMsg = FString::Printf(TEXT("Stale update %d/%d"), i + 1, StaleCount);
      SendProgressUpdate(RequestId, 50.0f, StatusMsg, true);  // Always 50%
      FPlatformProcess::Sleep(0.1f);  // 100ms between updates
    }
    
    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetNumberField(TEXT("staleUpdatesSent"), StaleCount);
    Result->SetBoolField(TEXT("staleDetectionExpected"), true);
    
    SendAutomationResponse(RequestingSocket, RequestId, true,
                           TEXT("Stale progress test completed"), Result);
    return true;
  } else if (Lower == TEXT("execute_script")) {
    // Execute a script inside the editor context
    FString ScriptType;
    Payload->TryGetStringField(TEXT("script_type"), ScriptType);

    FString ScriptContent;
    Payload->TryGetStringField(TEXT("script_content"), ScriptContent);

    FString ScriptName;
    Payload->TryGetStringField(TEXT("script_name"), ScriptName);

    double TimeoutSeconds = 30.0;
    Payload->TryGetNumberField(TEXT("timeout_seconds"), TimeoutSeconds);
    TimeoutSeconds = FMath::Clamp(TimeoutSeconds, 1.0, 300.0);

    if (ScriptType.IsEmpty())
    {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("script_type is required (python, console_batch, or editor_utility)"),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }

    if (ScriptContent.IsEmpty())
    {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("script_content is required"),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }

    const FString ScriptTypeLower = ScriptType.ToLower();
    const double StartTime = FPlatformTime::Seconds();

    // ---- Capture output log during script execution ----
    // We use a custom FOutputDevice to capture log messages
    class FMcpScriptOutputDevice : public FOutputDevice
    {
    public:
      FString CapturedOutput;

      virtual void Serialize(const TCHAR* V, ELogVerbosity::Type Verbosity, const FName& Category) override
      {
        if (CapturedOutput.Len() < 65536)  // Cap output size
        {
          CapturedOutput += V;
          CapturedOutput += TEXT("\n");
        }
      }
    };

    FMcpScriptOutputDevice OutputCapture;
    GLog->AddOutputDevice(&OutputCapture);

    bool bSuccess = false;
    FString ErrorMessage;

    if (ScriptTypeLower == TEXT("python"))
    {
      // Execute Python script via the Python plugin
      // Check if Python scripting plugin is available
      IModuleInterface* PythonModule = FModuleManager::Get().GetModule(TEXT("PythonScriptPlugin"));
      if (!PythonModule)
      {
        // Try alternative module name
        PythonModule = FModuleManager::Get().GetModule(TEXT("PythonEditor"));
      }

      if (PythonModule)
      {
        // Use the IPythonScriptPlugin interface to execute Python
        // The Python plugin provides ExecPythonCommand via the console
        // We route through GEngine->Exec which the Python plugin hooks into
        if (GEngine && GEditor && GEditor->GetEditorWorldContext().World())
        {
          // Build the Python command - the Python plugin intercepts "py" console commands
          FString PythonCommand = FString::Printf(TEXT("py %s"), *ScriptContent);
          GEngine->Exec(GEditor->GetEditorWorldContext().World(), *PythonCommand);
          bSuccess = true;
        }
        else
        {
          ErrorMessage = TEXT("Editor world context not available for Python execution");
        }
      }
      else
      {
        // Fallback: Try direct console command approach
        // The Python Scripting Plugin registers a console command handler for "py"
        if (GEngine && GEditor && GEditor->GetEditorWorldContext().World())
        {
          FString PythonCommand = FString::Printf(TEXT("py %s"), *ScriptContent);
          GEngine->Exec(GEditor->GetEditorWorldContext().World(), *PythonCommand);
          bSuccess = true;
        }
        else
        {
          ErrorMessage = TEXT("Python scripting plugin not found and editor world not available. "
                            "Enable the Python Editor Script Plugin in Edit > Plugins.");
        }
      }
    }
    else if (ScriptTypeLower == TEXT("console_batch"))
    {
      // Execute multiple console commands separated by newlines
      if (GEngine && GEditor && GEditor->GetEditorWorldContext().World())
      {
        TArray<FString> Commands;
        ScriptContent.ParseIntoArrayLines(Commands);

        int32 ExecutedCount = 0;
        int32 FailedCount = 0;

        for (const FString& Cmd : Commands)
        {
          FString TrimmedCmd = Cmd.TrimStartAndEnd();

          // Skip empty lines and comments
          if (TrimmedCmd.IsEmpty() || TrimmedCmd.StartsWith(TEXT("//")) || TrimmedCmd.StartsWith(TEXT("#")))
          {
            continue;
          }

          // Check timeout
          if (FPlatformTime::Seconds() - StartTime > TimeoutSeconds)
          {
            ErrorMessage = FString::Printf(TEXT("Timeout after %d/%d commands (%.1fs)"),
                                           ExecutedCount, Commands.Num(), TimeoutSeconds);
            break;
          }

          GEngine->Exec(GEditor->GetEditorWorldContext().World(), *TrimmedCmd);
          ExecutedCount++;
        }

        bSuccess = ErrorMessage.IsEmpty();
        if (bSuccess)
        {
          OutputCapture.CapturedOutput += FString::Printf(
            TEXT("Executed %d console commands successfully.\n"), ExecutedCount);
        }
      }
      else
      {
        ErrorMessage = TEXT("Editor world context not available for console command execution");
      }
    }
    else if (ScriptTypeLower == TEXT("editor_utility"))
    {
      // Run an Editor Utility Blueprint/Widget by asset path
      FString UtilityPath = ScriptContent.TrimStartAndEnd();

      // Try to load as Editor Utility Widget Blueprint first
      UObject* LoadedObject = LoadObject<UObject>(nullptr, *UtilityPath);

      if (!LoadedObject)
      {
        // Try with _C suffix for blueprint class
        FString ClassPath = UtilityPath;
        if (!ClassPath.EndsWith(TEXT("_C")))
        {
          ClassPath += TEXT("_C");
        }
        LoadedObject = LoadObject<UObject>(nullptr, *ClassPath);
      }

      if (LoadedObject)
      {
        // Check if it's an Editor Utility Widget Blueprint
        UBlueprint* Blueprint = Cast<UBlueprint>(LoadedObject);
        if (Blueprint)
        {
          // Use the Editor Utility Subsystem to run it
          UEditorUtilitySubsystem* UtilitySubsystem = GEditor->GetEditorSubsystem<UEditorUtilitySubsystem>();
          if (UtilitySubsystem)
          {
            // Try to run as Editor Utility Widget
            UEditorUtilityWidgetBlueprint* WidgetBP = Cast<UEditorUtilityWidgetBlueprint>(Blueprint);
            if (WidgetBP)
            {
              UtilitySubsystem->SpawnAndRegisterTab(WidgetBP);
              bSuccess = true;
              OutputCapture.CapturedOutput += FString::Printf(
                TEXT("Spawned Editor Utility Widget: %s\n"), *UtilityPath);
            }
            else
            {
              // Try as general Editor Utility Blueprint (action utility)
              UEditorUtilityBlueprint* ActionBP = Cast<UEditorUtilityBlueprint>(Blueprint);
              if (ActionBP)
              {
                UEditorUtilityObject* DefaultObj = Cast<UEditorUtilityObject>(
                  ActionBP->GeneratedClass->GetDefaultObject());
                if (DefaultObj)
                {
                  DefaultObj->Run();
                  bSuccess = true;
                  OutputCapture.CapturedOutput += FString::Printf(
                    TEXT("Executed Editor Utility Blueprint: %s\n"), *UtilityPath);
                }
                else
                {
                  ErrorMessage = FString::Printf(
                    TEXT("Failed to get default object for Editor Utility: %s"), *UtilityPath);
                }
              }
              else
              {
                ErrorMessage = FString::Printf(
                  TEXT("Blueprint is not an Editor Utility Widget or Action: %s"), *UtilityPath);
              }
            }
          }
          else
          {
            ErrorMessage = TEXT("Editor Utility Subsystem not available");
          }
        }
        else
        {
          ErrorMessage = FString::Printf(
            TEXT("Loaded object is not a Blueprint: %s (type: %s)"),
            *UtilityPath, *LoadedObject->GetClass()->GetName());
        }
      }
      else
      {
        ErrorMessage = FString::Printf(TEXT("Failed to load Editor Utility: %s"), *UtilityPath);
      }
    }
    else
    {
      ErrorMessage = FString::Printf(
        TEXT("Unknown script_type: %s. Expected: python, console_batch, or editor_utility"),
        *ScriptType);
    }

    // Remove our output capture device
    GLog->RemoveOutputDevice(&OutputCapture);

    const double EndTime = FPlatformTime::Seconds();
    const double DurationMs = (EndTime - StartTime) * 1000.0;

    // Build result JSON
    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("scriptType"), ScriptType);
    Result->SetStringField(TEXT("scriptName"), ScriptName);
    Result->SetNumberField(TEXT("duration_ms"), DurationMs);
    Result->SetStringField(TEXT("output"), OutputCapture.CapturedOutput);

    if (bSuccess)
    {
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             FString::Printf(TEXT("Script executed successfully (%.0fms)"), DurationMs),
                             Result);
    }
    else
    {
      Result->SetStringField(TEXT("error"), ErrorMessage);
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             ErrorMessage.IsEmpty() ? TEXT("Script execution failed") : ErrorMessage,
                             Result, TEXT("SCRIPT_EXECUTION_FAILED"));
    }
    return true;
  } else if (Lower == TEXT("export_asset")) {
    // Export asset to FBX/OBJ/other format
    FString AssetPath;
    Payload->TryGetStringField(TEXT("assetPath"), AssetPath);
    
    FString ExportPath;
    Payload->TryGetStringField(TEXT("exportPath"), ExportPath);
    
    if (AssetPath.IsEmpty()) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("assetPath is required for export"),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }
    
    if (ExportPath.IsEmpty()) {
      SendAutomationError(RequestingSocket, RequestId,
                          TEXT("exportPath is required for export"),
                          TEXT("INVALID_ARGUMENT"));
      return true;
    }
    
    // Check if asset exists
    if (!UEditorAssetLibrary::DoesAssetExist(AssetPath)) {
      SendAutomationError(RequestingSocket, RequestId,
                          FString::Printf(TEXT("Asset not found: %s"), *AssetPath),
                          TEXT("ASSET_NOT_FOUND"));
      return true;
    }
    
    // Ensure export directory exists
    FString ExportDir = FPaths::GetPath(ExportPath);
    IPlatformFile& PlatformFile = FPlatformFileManager::Get().GetPlatformFile();
    if (!PlatformFile.DirectoryExists(*ExportDir)) {
      PlatformFile.CreateDirectoryTree(*ExportDir);
    }
    
    // Load the asset
    UObject* Asset = UEditorAssetLibrary::LoadAsset(AssetPath);
    if (!Asset) {
      SendAutomationError(RequestingSocket, RequestId,
                          FString::Printf(TEXT("Failed to load asset: %s"), *AssetPath),
                          TEXT("LOAD_FAILED"));
      return true;
    }
    
    // Determine export format from file extension
    FString Extension = FPaths::GetExtension(ExportPath).ToLower();
    
    // Try generic asset export via AssetTools
    bool bExportSuccess = false;
    FString ExportError;
    
    // CRITICAL FIX: Use AssetTools ExportAssets with explicit export path
    // This performs automated export without showing modal dialogs
    // The bPromptForIndividualFilenames=false suppresses file dialogs
    FAssetToolsModule& AssetToolsModule = FModuleManager::LoadModuleChecked<FAssetToolsModule>(TEXT("AssetTools"));
    IAssetTools& AssetTools = AssetToolsModule.Get();
    
    // Use ExportAssets with explicit path - this suppresses dialogs for automated export
    // The asset will be exported with its original name to the specified directory
    TArray<UObject*> AssetsToExport;
    AssetsToExport.Add(Asset);
    
    // ExportAssets exports to the specified directory with the asset's name
    // For custom filename, we need to rename temporarily or use UExporter directly
    AssetTools.ExportAssets(AssetsToExport, ExportDir);
    
    // Check if file was created
    FString ExpectedExportPath = ExportDir / FPaths::GetBaseFilename(AssetPath) + TEXT(".") + Extension;
    if (FPaths::FileExists(ExpectedExportPath))
    {
      bExportSuccess = true;
    }
    else
    {
      // Try with the actual requested filename
      bExportSuccess = FPaths::FileExists(ExportPath);
    }
    
    if (!bExportSuccess)
    {
      // Fallback: Use UExporter::ExportToFile directly with Prompt=false
      UExporter* Exporter = nullptr;
      
      // Find appropriate exporter for the asset type and extension
      for (TObjectIterator<UClass> ClassIt; ClassIt; ++ClassIt) {
        UClass* CurrentClass = *ClassIt;
        if (CurrentClass->IsChildOf(UExporter::StaticClass()) && !CurrentClass->HasAnyClassFlags(CLASS_Abstract)) {
          UExporter* DefaultExporter = Cast<UExporter>(CurrentClass->GetDefaultObject());
          if (DefaultExporter && DefaultExporter->SupportedClass) {
            if (Asset->GetClass()->IsChildOf(DefaultExporter->SupportedClass)) {
              if (DefaultExporter->PreferredFormatIndex < DefaultExporter->FormatExtension.Num()) {
                FString PreferredExt = DefaultExporter->FormatExtension[DefaultExporter->PreferredFormatIndex].ToLower();
                if (PreferredExt == Extension || PreferredExt.Contains(Extension)) {
                  Exporter = DefaultExporter;
                  break;
                }
              }
              if (!Exporter) {
                Exporter = DefaultExporter;
              }
            }
          }
        }
      }
      
      if (Exporter) {
        // ExportToFile signature: (Object, Exporter, Filename, InSelectedOnly, NoReplaceIdentical, Prompt)
        // The last parameter (Prompt=false) should suppress dialogs for most exporters
        int32 ExportResult = UExporter::ExportToFile(Asset, Exporter, *ExportPath, false, false, false);
        bExportSuccess = (ExportResult != 0);
      }
      
      if (!bExportSuccess) {
        ExportError = FString::Printf(TEXT("Export failed for asset type '%s' and format '%s'"),
                                       *Asset->GetClass()->GetName(), *Extension);
      }
    }
    
    if (bExportSuccess) {
      TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
      AddAssetVerification(Result, Asset);
      Result->SetStringField(TEXT("assetPath"), AssetPath);
      Result->SetStringField(TEXT("exportPath"), ExportPath);
      Result->SetStringField(TEXT("format"), Extension);
      Result->SetBoolField(TEXT("success"), true);
      
      SendAutomationResponse(RequestingSocket, RequestId, true,
                             FString::Printf(TEXT("Asset exported to: %s"), *ExportPath),
                             Result);
    } else {
      TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
      Result->SetStringField(TEXT("assetPath"), AssetPath);
      Result->SetStringField(TEXT("exportPath"), ExportPath);
      Result->SetStringField(TEXT("format"), Extension);
      Result->SetStringField(TEXT("error"), ExportError);
      
      SendAutomationResponse(RequestingSocket, RequestId, false,
                             FString::Printf(TEXT("Export failed: %s"), *ExportError),
                             Result, TEXT("EXPORT_FAILED"));
    }
    return true;
  }

  return false;
#else
  SendAutomationResponse(RequestingSocket, RequestId, false,
                         TEXT("System control actions require editor build"),
                         nullptr, TEXT("NOT_IMPLEMENTED"));
  return true;
#endif
}
