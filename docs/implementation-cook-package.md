# Implementation Summary: Asset Cooking and Project Packaging for MCP

## Overview

This document summarizes the implementation of asset cooking and project packaging functionality added to the MCP (Model Context Protocol) automation bridge for Unreal Engine.

## Files Modified

### 1. TypeScript Handler: `src/tools/handlers/system-handlers.ts`

Added two new action handlers to the `handleSystemTools` function:

#### `cook_content` Action
- **Purpose**: Cook game content for a target platform using UAT (Unreal Automation Tool)
- **Parameters**:
  - `platform` (string, default: "Win64"): Target platform (e.g., "Win64", "Linux", "Mac", "Android", "IOS")
  - `maps` (array of strings, default: []): Specific maps to cook; empty cooks all maps
  - `iterative` (boolean, default: true): Use iterative cooking for faster incremental builds
- **Timeout**: 600000ms (10 minutes)

#### `package_project` Action
- **Purpose**: Package the entire project for distribution
- **Parameters**:
  - `platform` (string, default: "Win64"): Target platform
  - `configuration` (string, default: "Development"): Build configuration ("Debug", "Development", "Shipping")
  - `outputDir` (string, optional): Output directory for packaged files
  - `compress` (boolean, default: true): Enable compression for packaged files
- **Timeout**: 1800000ms (30 minutes)

### 2. Tool Definitions: `src/tools/consolidated-tool-definitions.ts`

Updated the `system_control` tool definition:
- Added `cook_content` and `package_project` to the action enum
- Added new schema properties:
  - `maps`: Array of map paths to cook
  - `iterative`: Boolean for iterative cooking mode
  - `outputDir`: String for package output directory
  - `compress`: Boolean for package compression
- Updated description to include cooking and packaging capabilities

### 3. C++ Handler: `plugins/McpAutomationBridge/Source/McpAutomationBridge/Private/McpAutomationBridge_EnvironmentHandlers.cpp`

Added two new sub-action handlers within `HandleSystemControlAction`:

#### `cook_content` Handler
- Constructs UAT command: `BuildCookRun -project="..." -cook -targetplatform=... [-iterativecooking] [-map=...] -unattended`
- Executes via `FPlatformProcess::ExecProcess`
- Returns JSON result with:
  - `processStarted`: Whether UAT was successfully launched
  - `returnCode`: UAT exit code
  - `platform`: Target platform used
  - `iterative`: Whether iterative cooking was enabled
  - `output`: Captured stdout (truncated to 8000 chars if needed)
  - `errors`: Captured stderr if any

#### `package_project` Handler
- Constructs UAT command: `BuildCookRun -project="..." -cook -stage -package -targetplatform=... -clientconfig=... [-compressed] [-archivedirectory="..."] -unattended`
- Executes via `FPlatformProcess::ExecProcess`
- Returns JSON result with:
  - `processStarted`: Whether UAT was successfully launched
  - `returnCode`: UAT exit code
  - `platform`: Target platform
  - `configuration`: Build configuration
  - `compressed`: Whether compression was enabled
  - `outputDir`: Output directory if specified
  - `output`: Captured stdout (truncated if needed)
  - `errors`: Captured stderr if any

## Usage Examples

### Cook Content
```json
{
  "tool": "system_control",
  "args": {
    "action": "cook_content",
    "platform": "Win64",
    "iterative": true,
    "maps": ["/Game/Maps/MainMenu", "/Game/Maps/Level1"]
  }
}
```

### Package Project
```json
{
  "tool": "system_control",
  "args": {
    "action": "package_project",
    "platform": "Win64",
    "configuration": "Shipping",
    "outputDir": "D:/Builds/MyGame",
    "compress": true
  }
}
```

## Recommended Tests

The Test Engineer should verify the following:

### Unit Tests
1. **Parameter Validation**
   - Verify default values are applied correctly when parameters are omitted
   - Verify invalid platform names are handled gracefully
   - Verify invalid configuration names are handled gracefully

2. **TypeScript Handler Tests**
   - Test `cook_content` action routes correctly to automation bridge
   - Test `package_project` action routes correctly to automation bridge
   - Test timeout values are properly passed (600s for cook, 1800s for package)

### Integration Tests (Requires Unreal Editor)
1. **Cook Content**
   - Test cooking with default parameters (Win64, iterative)
   - Test cooking specific maps
   - Test cooking without iterative mode
   - Verify output includes cook progress information

2. **Package Project**
   - Test packaging with Development configuration
   - Test packaging with Shipping configuration
   - Test packaging with custom output directory
   - Test packaging with compression enabled/disabled
   - Verify packaged output exists at expected location

### Error Handling Tests
1. Test behavior when UAT is not found (invalid engine path)
2. Test behavior when project file is not found
3. Test behavior when specified maps do not exist
4. Test timeout handling for long-running operations

### Instructions for Test Engineer

Read this file at: `D:\fluxPoint\clay-mini-game\Unreal_mcp\docs\implementation-cook-package.md`

To run the TypeScript build verification:
```bash
cd D:\fluxPoint\clay-mini-game\Unreal_mcp
npm run build
```

To run existing tests:
```bash
cd D:\fluxPoint\clay-mini-game\Unreal_mcp
npm test
```

Note: Full integration testing requires:
1. Unreal Engine 5.x installed with UAT available
2. An active Unreal Editor session with the McpAutomationBridge plugin loaded
3. A valid project to cook/package

## Platform Notes

- The implementation uses `RunUAT.bat` for Windows
- For Mac/Linux, the path would need to be adjusted to use `RunUAT.sh`
- Current implementation is Windows-focused; cross-platform support may require additional conditionals in the C++ handler
