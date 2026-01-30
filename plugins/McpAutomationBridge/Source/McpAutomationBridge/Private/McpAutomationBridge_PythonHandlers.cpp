/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\plugins\McpAutomationBridge\Source\McpAutomationBridge\Private\McpAutomationBridge_PythonHandlers.cpp
 *
 * Summary: Handler for execute_python automation requests. Enables MCP to run
 * Python scripts in Unreal Editor without manual intervention via Tools menu.
 * Supports executing script files, inline code, and querying Python environment info.
 *
 * Used by: McpAutomationBridgeSubsystem (registered as execute_python handler)
 * Depends on: IPythonScriptPlugin for Python execution
 */

#include "McpAutomationBridgeGlobals.h"
#include "McpAutomationBridgeHelpers.h"
#include "McpAutomationBridgeSubsystem.h"

#if WITH_EDITOR

// Python scripting plugin interface
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformFilemanager.h"

// Check for Python plugin availability
#if PLATFORM_WINDOWS || PLATFORM_MAC || PLATFORM_LINUX
#define MCP_HAS_PYTHON_SUPPORT 1
#else
#define MCP_HAS_PYTHON_SUPPORT 0
#endif

#if MCP_HAS_PYTHON_SUPPORT
// Try to include Python script plugin headers
#if __has_include("IPythonScriptPlugin.h")
#include "IPythonScriptPlugin.h"
#define MCP_PYTHON_PLUGIN_AVAILABLE 1
#else
#define MCP_PYTHON_PLUGIN_AVAILABLE 0
#endif
#endif

// Output capture for Python execution
namespace McpPythonExecution
{
    // Simple output capture that hooks into Python's stdout/stderr
    static FString LastPythonOutput;
    static FString LastPythonError;
    static FCriticalSection OutputMutex;

    void ClearOutput()
    {
        FScopeLock Lock(&OutputMutex);
        LastPythonOutput.Empty();
        LastPythonError.Empty();
    }

    void AppendOutput(const FString& Output)
    {
        FScopeLock Lock(&OutputMutex);
        if (!LastPythonOutput.IsEmpty())
        {
            LastPythonOutput += TEXT("\n");
        }
        LastPythonOutput += Output;
    }

    void AppendError(const FString& Error)
    {
        FScopeLock Lock(&OutputMutex);
        if (!LastPythonError.IsEmpty())
        {
            LastPythonError += TEXT("\n");
        }
        LastPythonError += Error;
    }

    FString GetOutput()
    {
        FScopeLock Lock(&OutputMutex);
        return LastPythonOutput;
    }

    FString GetError()
    {
        FScopeLock Lock(&OutputMutex);
        return LastPythonError;
    }
}

/**
 * Execute a Python command string using Unreal's Python scripting interface.
 * Returns true on success, false on failure.
 */
static bool ExecutePythonCommand(const FString& Command, FString& OutOutput, FString& OutError)
{
    OutOutput.Empty();
    OutError.Empty();

#if MCP_HAS_PYTHON_SUPPORT && MCP_PYTHON_PLUGIN_AVAILABLE
    // Use IPythonScriptPlugin interface
    IPythonScriptPlugin* PythonPlugin = IPythonScriptPlugin::Get();
    if (!PythonPlugin)
    {
        OutError = TEXT("Python scripting plugin not available. Ensure PythonScriptPlugin is enabled in your project.");
        return false;
    }

    // Clear previous output
    McpPythonExecution::ClearOutput();

    // Execute the command
    // The ExecPythonCommand returns true if the command executed without Python exceptions
    bool bSuccess = PythonPlugin->ExecPythonCommand(*Command);

    // Get any captured output (note: output capture may require additional setup)
    OutOutput = McpPythonExecution::GetOutput();
    OutError = McpPythonExecution::GetError();

    return bSuccess;
#else
    // Fallback: Use GEngine->Exec with "py" command
    if (GEngine)
    {
        // Wrap the command in the py console command format
        // Note: This approach has limitations - no direct output capture
        FString PyCommand = FString::Printf(TEXT("py %s"), *Command);

        // Create an output device to capture results
        FMcpOutputCapture OutputCapture;
        GLog->AddOutputDevice(&OutputCapture);

        // Execute the command
        bool bSuccess = GEngine->Exec(GEditor ? GEditor->GetEditorWorldContext().World() : nullptr, *PyCommand);

        // Remove output device
        GLog->RemoveOutputDevice(&OutputCapture);

        // Get captured output
        TArray<FString> CapturedLines = OutputCapture.Consume();
        for (const FString& Line : CapturedLines)
        {
            if (!OutOutput.IsEmpty())
            {
                OutOutput += TEXT("\n");
            }
            OutOutput += Line;
        }

        if (!bSuccess)
        {
            OutError = TEXT("Python command execution failed. Check if Python scripting plugin is enabled.");
        }

        return bSuccess;
    }

    OutError = TEXT("GEngine not available for Python command execution.");
    return false;
#endif
}

/**
 * Execute a Python script file.
 * Returns true on success, false on failure.
 */
static bool ExecutePythonScript(const FString& ScriptPath, FString& OutOutput, FString& OutError)
{
    OutOutput.Empty();
    OutError.Empty();

    // Validate script path
    FString ResolvedPath = ScriptPath;

    // If it's a relative path, try to resolve it relative to project directory
    if (!FPaths::FileExists(ResolvedPath))
    {
        FString ProjectPath = FPaths::ProjectDir() / ResolvedPath;
        if (FPaths::FileExists(ProjectPath))
        {
            ResolvedPath = ProjectPath;
        }
    }

    // Check if file exists
    if (!FPaths::FileExists(ResolvedPath))
    {
        OutError = FString::Printf(TEXT("Python script file not found: %s"), *ScriptPath);
        return false;
    }

    // Verify it's a Python file
    if (!ResolvedPath.EndsWith(TEXT(".py")))
    {
        OutError = FString::Printf(TEXT("File does not appear to be a Python script (expected .py extension): %s"), *ScriptPath);
        return false;
    }

#if MCP_HAS_PYTHON_SUPPORT && MCP_PYTHON_PLUGIN_AVAILABLE
    // Use IPythonScriptPlugin interface for file execution
    IPythonScriptPlugin* PythonPlugin = IPythonScriptPlugin::Get();
    if (!PythonPlugin)
    {
        OutError = TEXT("Python scripting plugin not available. Ensure PythonScriptPlugin is enabled in your project.");
        return false;
    }

    // Clear previous output
    McpPythonExecution::ClearOutput();

    // Execute the script file
    bool bSuccess = PythonPlugin->ExecPythonCommand(*FString::Printf(TEXT("exec(open(r'%s').read())"), *ResolvedPath));

    OutOutput = McpPythonExecution::GetOutput();
    OutError = McpPythonExecution::GetError();

    return bSuccess;
#else
    // Fallback: Read the file and execute as a command
    FString ScriptContent;
    if (!FFileHelper::LoadFileToString(ScriptContent, *ResolvedPath))
    {
        OutError = FString::Printf(TEXT("Failed to read Python script file: %s"), *ResolvedPath);
        return false;
    }

    // Execute using GEngine with the py console command
    if (GEngine)
    {
        // For file execution, use the py command with file path
        FString PyCommand = FString::Printf(TEXT("py \"%s\""), *ResolvedPath);

        FMcpOutputCapture OutputCapture;
        GLog->AddOutputDevice(&OutputCapture);

        bool bSuccess = GEngine->Exec(GEditor ? GEditor->GetEditorWorldContext().World() : nullptr, *PyCommand);

        GLog->RemoveOutputDevice(&OutputCapture);

        TArray<FString> CapturedLines = OutputCapture.Consume();
        for (const FString& Line : CapturedLines)
        {
            if (!OutOutput.IsEmpty())
            {
                OutOutput += TEXT("\n");
            }
            OutOutput += Line;
        }

        if (!bSuccess)
        {
            OutError = TEXT("Python script execution failed. Check if Python scripting plugin is enabled.");
        }

        return bSuccess;
    }

    OutError = TEXT("GEngine not available for Python script execution.");
    return false;
#endif
}

#endif // WITH_EDITOR

/**
 * Handle the execute_python automation action.
 * Supports actions: execute_script, execute_code, get_python_info
 */
bool UMcpAutomationBridgeSubsystem::HandleExecutePythonAction(
    const FString& RequestId,
    const FString& Action,
    const TSharedPtr<FJsonObject>& Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket)
{
    if (Action != TEXT("execute_python"))
    {
        return false;
    }

#if WITH_EDITOR
    if (!Payload.IsValid())
    {
        SendAutomationError(RequestingSocket, RequestId, TEXT("Missing payload."), TEXT("INVALID_PAYLOAD"));
        return true;
    }

    FString SubAction;
    if (!Payload->TryGetStringField(TEXT("action"), SubAction))
    {
        SendAutomationError(RequestingSocket, RequestId, TEXT("Missing 'action' field in payload."), TEXT("INVALID_ARGUMENT"));
        return true;
    }

    UE_LOG(LogMcpAutomationBridgeSubsystem, Log, TEXT("HandleExecutePythonAction: %s"), *SubAction);

    if (SubAction == TEXT("execute_script"))
    {
        FString ScriptPath;
        if (!Payload->TryGetStringField(TEXT("scriptPath"), ScriptPath) || ScriptPath.IsEmpty())
        {
            SendAutomationError(RequestingSocket, RequestId, TEXT("scriptPath is required for execute_script action."), TEXT("INVALID_ARGUMENT"));
            return true;
        }

        FString Output, Error;
        bool bSuccess = ExecutePythonScript(ScriptPath, Output, Error);

        TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
        Result->SetStringField(TEXT("scriptPath"), ScriptPath);

        if (!Output.IsEmpty())
        {
            Result->SetStringField(TEXT("output"), Output);
        }

        if (bSuccess)
        {
            SendAutomationResponse(RequestingSocket, RequestId, true,
                FString::Printf(TEXT("Python script executed successfully: %s"), *ScriptPath),
                Result);
        }
        else
        {
            Result->SetStringField(TEXT("error"), Error);
            SendAutomationError(RequestingSocket, RequestId, Error, TEXT("PYTHON_EXECUTION_FAILED"));
        }
    }
    else if (SubAction == TEXT("execute_code"))
    {
        FString Code;
        if (!Payload->TryGetStringField(TEXT("code"), Code) || Code.IsEmpty())
        {
            SendAutomationError(RequestingSocket, RequestId, TEXT("code is required for execute_code action."), TEXT("INVALID_ARGUMENT"));
            return true;
        }

        FString Output, Error;
        bool bSuccess = ExecutePythonCommand(Code, Output, Error);

        TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
        Result->SetNumberField(TEXT("codeLength"), Code.Len());

        if (!Output.IsEmpty())
        {
            Result->SetStringField(TEXT("output"), Output);
        }

        if (bSuccess)
        {
            SendAutomationResponse(RequestingSocket, RequestId, true,
                TEXT("Python code executed successfully."),
                Result);
        }
        else
        {
            Result->SetStringField(TEXT("error"), Error);
            SendAutomationError(RequestingSocket, RequestId, Error, TEXT("PYTHON_EXECUTION_FAILED"));
        }
    }
    else if (SubAction == TEXT("get_python_info"))
    {
        TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();

#if MCP_HAS_PYTHON_SUPPORT && MCP_PYTHON_PLUGIN_AVAILABLE
        IPythonScriptPlugin* PythonPlugin = IPythonScriptPlugin::Get();
        if (PythonPlugin)
        {
            Result->SetBoolField(TEXT("pythonAvailable"), true);
            Result->SetStringField(TEXT("pluginStatus"), TEXT("IPythonScriptPlugin available"));

            // Try to get Python version by executing a simple command
            FString Output, Error;
            if (ExecutePythonCommand(TEXT("import sys; print(sys.version)"), Output, Error))
            {
                Result->SetStringField(TEXT("pythonVersion"), Output.TrimStartAndEnd());
            }
        }
        else
        {
            Result->SetBoolField(TEXT("pythonAvailable"), false);
            Result->SetStringField(TEXT("pluginStatus"), TEXT("IPythonScriptPlugin not loaded"));
        }
#else
        // Check if Python can be executed via GEngine
        if (GEngine)
        {
            Result->SetBoolField(TEXT("pythonAvailable"), true);
            Result->SetStringField(TEXT("pluginStatus"), TEXT("Using GEngine fallback (py console command)"));
            Result->SetStringField(TEXT("note"), TEXT("Direct Python plugin API not available. Using console command fallback."));
        }
        else
        {
            Result->SetBoolField(TEXT("pythonAvailable"), false);
            Result->SetStringField(TEXT("pluginStatus"), TEXT("Python execution not available"));
        }
#endif

        SendAutomationResponse(RequestingSocket, RequestId, true,
            TEXT("Python environment information retrieved."),
            Result);
    }
    else
    {
        SendAutomationError(RequestingSocket, RequestId,
            FString::Printf(TEXT("Unknown sub-action: %s"), *SubAction),
            TEXT("UNKNOWN_ACTION"));
    }

    return true;
#else
    SendAutomationError(RequestingSocket, RequestId,
        TEXT("Python execution requires Editor build."),
        TEXT("NOT_AVAILABLE"));
    return true;
#endif
}
