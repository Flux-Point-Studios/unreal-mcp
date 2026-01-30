# Get Log Implementation Summary

## Overview

Added the `get_log` and `read_log` actions to the MCP system_control tool, enabling reading of recent log output from Unreal Editor. This feature allows external tools and AI agents to inspect editor logs for debugging, error tracking, and monitoring purposes.

## Files Modified

### 1. TypeScript Handler
**File:** `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\handlers\system-handlers.ts`

**Changes:**
- Added import for `extractOptionalNumber` from `./argument-helper.js`
- Modified the `read_log` case to also handle `get_log` action
- Routes the request through the automation bridge to the C++ handler with parameters:
  - `lines`: Number of log lines to retrieve (default: 100)
  - `filter`: Text filter to match log entries
  - `severity`: Severity level filter (Error, Warning, Log, Display, Verbose)

**Code snippet:**
```typescript
case 'get_log':
case 'read_log': {
  const params = normalizeArgs(args, [
    { key: 'lines', default: 100 },
    { key: 'filter' },
    { key: 'severity' },
  ]);

  const res = await executeAutomationRequest(tools, 'system_control', {
    subAction: 'get_log',
    lines: extractOptionalNumber(params, 'lines') ?? 100,
    filter: extractOptionalString(params, 'filter'),
    severity: extractOptionalString(params, 'severity'),
  });

  return ResponseFactory.success(res, `Retrieved log entries`);
}
```

### 2. Tool Definitions
**File:** `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\consolidated-tool-definitions.ts`

**Changes:**
- Added `get_log` and `read_log` to the system_control action enum
- Added `lines` parameter (number, default: 100)
- Added `severity` parameter (enum: Error, Warning, Log, Display, Verbose)
- Added output schema fields for `entries` (array) and `count` (number)

### 3. C++ Handler
**File:** `D:\fluxPoint\clay-mini-game\Unreal_mcp\plugins\McpAutomationBridge\Source\McpAutomationBridge\Private\McpAutomationBridge_EnvironmentHandlers.cpp`

**Changes:**
Added handler in `HandleSystemControlAction` function that:
- Reads the project log file from `FPaths::ProjectLogDir()`
- Falls back to finding the most recent .log file if project-specific log not found
- Applies text filter and severity filter
- Parses log entries to extract timestamp and category when possible
- Returns structured JSON response with entries array

**Response format:**
```json
{
  "success": true,
  "message": "Retrieved N log entries",
  "data": {
    "entries": [
      {
        "message": "Full log line",
        "timestamp": "2024.01.15-10.30.45:123",
        "category": "LogCategory"
      }
    ],
    "count": 100,
    "totalLines": 5000,
    "logFile": "C:/Project/Saved/Logs/Project.log"
  }
}
```

## Usage Examples

### Get last 100 log entries
```json
{
  "tool": "system_control",
  "arguments": {
    "action": "get_log"
  }
}
```

### Get last 500 log entries with text filter
```json
{
  "tool": "system_control",
  "arguments": {
    "action": "get_log",
    "lines": 500,
    "filter": "Blueprint"
  }
}
```

### Get only error entries
```json
{
  "tool": "system_control",
  "arguments": {
    "action": "get_log",
    "lines": 200,
    "severity": "Error"
  }
}
```

### Get warnings containing specific text
```json
{
  "tool": "system_control",
  "arguments": {
    "action": "read_log",
    "lines": 100,
    "filter": "Material",
    "severity": "Warning"
  }
}
```

## Recommended Tests

The Test Engineer should verify the following scenarios:

### Unit Tests (TypeScript)
1. **Parameter normalization**: Verify default values are applied when parameters omitted
2. **Filter handling**: Test that empty filter string is properly handled
3. **Severity enum**: Verify all severity values are accepted

### Integration Tests (with Unreal Editor)
1. **Basic log retrieval**: Call `get_log` with no parameters, verify entries returned
2. **Lines limit**: Call with `lines: 10`, verify at most 10 entries returned
3. **Text filter**: Create a log entry with unique text, filter by that text
4. **Severity filter - Error**: Trigger an error, filter by `severity: "Error"`, verify only errors returned
5. **Severity filter - Warning**: Trigger a warning, filter by `severity: "Warning"`
6. **Combined filters**: Test text filter and severity filter together
7. **Empty results**: Filter for non-existent text, verify empty array returned
8. **Large line count**: Request 10000 lines, verify no crash and response within timeout

### Edge Cases
1. **No log file**: Test behavior when log file doesn't exist (fresh project)
2. **Empty log file**: Test with minimal/empty log
3. **Very long lines**: Verify long log entries don't cause issues
4. **Special characters**: Log entries with Unicode, quotes, newlines

### Instructions for Test Engineer
Please read this file and implement tests covering the above scenarios. The test file should be created at:
`D:\fluxPoint\clay-mini-game\Unreal_mcp\tests\integration\get-log.test.ts`

Focus on integration testing since the C++ component handles the core logic.
