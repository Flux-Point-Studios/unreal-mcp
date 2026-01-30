# Backend Implementation: Execute Python Script Action

**Location:** `D:\fluxPoint\clay-mini-game\Unreal_mcp\docs\backend-implementation-execute-python.md`

**Summary:** This document describes the implementation of the `execute_python` action for the MCP system, enabling execution of Python scripts within Unreal Engine's Python environment.

## Overview

The `execute_python` action allows executing Python scripts through the MCP automation bridge. It supports:
- Executing Python script files by path
- Executing inline Python code content
- Passing arguments to scripts

## Files Modified

### 1. TypeScript Handler
**File:** `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\handlers\system-handlers.ts`

Added:
- Helper functions `normalizeArgs()` and `extractOptionalString()` for parameter handling
- `ResponseFactory` object for consistent response generation
- New case handlers for `execute_python` and `run_python` actions

```typescript
case 'execute_python':
case 'run_python': {
    const params = normalizeArgs(args, [
        { key: 'scriptPath' },
        { key: 'scriptContent' },
        { key: 'args', default: [] },
    ]);

    const scriptPath = extractOptionalString(params, 'scriptPath');
    const scriptContent = extractOptionalString(params, 'scriptContent');

    if (!scriptPath && !scriptContent) {
        return ResponseFactory.error('Either scriptPath or scriptContent is required', 'MISSING_REQUIRED');
    }

    const res = await executeAutomationRequest(tools, 'system_control', {
        subAction: 'execute_python',
        scriptPath,
        scriptContent,
        args: params.args,
    });

    return cleanObject({ ...resObj, action: 'execute_python' });
}
```

### 2. Tool Definitions
**File:** `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\consolidated-tool-definitions.ts`

Added to `system_control` tool:
- Actions: `execute_python`, `run_python`
- Parameters:
  - `scriptPath` (string, optional): Path to Python script file
  - `scriptContent` (string, optional): Inline Python code to execute
  - `scriptArgs` (array, optional): Arguments to pass to the script
- Output schema includes `pythonOutput` and `returnValue` fields

### 3. C++ Handler
**File:** `D:\fluxPoint\clay-mini-game\Unreal_mcp\plugins\McpAutomationBridge\Source\McpAutomationBridge\Private\McpAutomationBridge_EnvironmentHandlers.cpp`

Added:
- Include for `IPythonScriptPlugin.h` with fallback stub interface for builds without the plugin
- Handler for `execute_python`/`run_python` sub-actions within `HandleSystemControlAction()`

Key features:
- Validates that either `scriptPath` or `scriptContent` is provided
- Checks for Python plugin availability at runtime
- Normalizes file paths (handles absolute, relative, and content paths)
- Executes scripts via `ExecPythonCommand()` for files or `ExecPythonCommandEx()` for inline code
- Returns execution status with metadata

### 4. Build Configuration
**File:** `D:\fluxPoint\clay-mini-game\Unreal_mcp\plugins\McpAutomationBridge\Source\McpAutomationBridge\McpAutomationBridge.Build.cs`

Added conditional module dependency:
```csharp
TryAddConditionalModule(Target, EngineDir, "PythonScriptPlugin", "PythonScriptPlugin");
```

## Usage Examples

### Execute Python File
```json
{
  "action": "execute_python",
  "scriptPath": "Scripts/my_automation_script.py",
  "args": ["arg1", "arg2"]
}
```

### Execute Inline Python Code
```json
{
  "action": "execute_python",
  "scriptContent": "import unreal\nprint(unreal.get_editor_world())"
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `MISSING_REQUIRED` | Neither scriptPath nor scriptContent was provided |
| `PLUGIN_NOT_FOUND` | Python Editor Script Plugin is not enabled |
| `FILE_NOT_FOUND` | Specified script file does not exist |
| `EXECUTION_FAILED` | Python script execution returned failure |

## Prerequisites

The **Python Editor Script Plugin** must be enabled in the Unreal project:
1. Open Edit > Plugins
2. Search for "Python"
3. Enable "Python Editor Script Plugin"
4. Restart the editor

## Test Recommendations

For the Test Engineer, run the following tests:

### Unit Tests
1. **Missing Parameters Test**: Call `execute_python` without scriptPath or scriptContent, expect `MISSING_REQUIRED` error
2. **Plugin Check Test**: Test on a project without Python plugin enabled, expect `PLUGIN_NOT_FOUND` error
3. **File Not Found Test**: Provide non-existent scriptPath, expect `FILE_NOT_FOUND` error

### Integration Tests
1. **Execute File Test**: Create a simple Python script that creates an actor, verify actor exists after execution
2. **Inline Code Test**: Execute inline Python to modify editor state, verify state change
3. **Args Passing Test**: Execute script with args, verify args are received correctly

### Test Commands
```bash
# From the Unreal_mcp directory
npm test -- --grep "execute_python"

# Or run the full system test suite
npm run test:integration
```

---
**Orchestrator Instructions:** Please have the test engineer read this file at `D:\fluxPoint\clay-mini-game\Unreal_mcp\docs\backend-implementation-execute-python.md` and proceed with the recommended tests.
