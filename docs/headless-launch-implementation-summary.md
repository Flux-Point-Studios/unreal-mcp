# Headless/Commandlet Mode Support Implementation Summary

## Overview

This implementation adds headless/commandlet mode support to the MCP server, enabling Unreal Engine to be launched in various modes for CI/CD automation scenarios. The feature allows launching the editor in headless mode (no rendering), game mode, server mode, or commandlet mode directly from the MCP interface.

## Files Modified

### 1. `src/utils/editor-launch.ts` (NEW FILE)

**Location**: `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\utils\editor-launch.ts`

**Purpose**: Utility module for launching Unreal Editor in various modes.

**Key Features**:
- `findUnrealEditorPath()` - Locates the Unreal Editor executable by:
  - Checking custom path
  - Checking `UE_EDITOR_PATH` environment variable
  - Deriving from `.uproject` file's `EngineAssociation`
  - Checking common installation paths for Windows, Mac, and Linux

- `buildLaunchArgs()` - Constructs command-line arguments based on mode:
  - **editor**: Standard editor mode
  - **headless**: `-nullrhi -nosplash -unattended -nopause -nosound`
  - **game**: `-game -windowed -ResX=1280 -ResY=720`
  - **server**: `-server -log -unattended`
  - **commandlet**: `-run=<commandletName> -unattended -nopause`

- `launchEditor()` - Spawns the editor process with proper configuration
- `waitForEditorReady()` - Waits for MCP connection to be established
- `validateProjectPath()` - Validates the project file exists and has correct extension

### 2. `src/tools/handlers/system-handlers.ts`

**Location**: `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\handlers\system-handlers.ts`

**Added Actions**:
- `launch_editor` - Launch Unreal Editor (defaults to editor mode)
- `launch_headless` - Launch Unreal Editor in headless mode (no rendering)
- `get_editor_status` - Check current connection status

**Parameters for launch actions**:
```typescript
{
  projectPath: string;      // Required: Path to .uproject file
  mode?: string;            // 'editor' | 'headless' | 'game' | 'server' | 'commandlet'
  additionalArgs?: string;  // Extra command-line arguments
  waitForReady?: boolean;   // Wait for MCP connection (default: true)
  timeoutMs?: number;       // Timeout in ms (default: 60000)
  editorPath?: string;      // Custom editor executable path
  commandletName?: string;  // Required when mode is 'commandlet'
  commandletArgs?: string;  // Arguments for commandlet
}
```

### 3. `src/automation/bridge.ts`

**Location**: `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\automation\bridge.ts`

**Added Features**:
- **Auto-launch configuration**: `configureAutoLaunch(options)` method
- **Auto-launch on connection failure**: Automatically launches editor when connection fails
- **Manual launch**: `launchAndConnect(options)` method for explicit launching
- **Status tracking**: `getAutoLaunchConfig()` to check auto-launch state

**Auto-launch configuration**:
```typescript
bridge.configureAutoLaunch({
  projectPath: 'path/to/project.uproject',
  mode: 'headless',      // Launch mode
  enabled: true,         // Enable auto-launch
  timeoutMs: 120000      // Wait up to 2 minutes for connection
});
```

### 4. `src/tools/consolidated-tool-definitions.ts`

**Location**: `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\consolidated-tool-definitions.ts`

**Updated**: `system_control` tool definition to include:
- Added `launch_editor`, `launch_headless`, `get_editor_status` to action enum
- Added input properties for launch parameters
- Added output properties for launch results (`pid`, `connectionEstablished`)

## Usage Examples

### Launch Editor in Headless Mode

```json
{
  "action": "launch_headless",
  "projectPath": "D:/Projects/MyGame/MyGame.uproject"
}
```

### Launch Editor with Custom Parameters

```json
{
  "action": "launch_editor",
  "projectPath": "D:/Projects/MyGame/MyGame.uproject",
  "mode": "game",
  "additionalArgs": "-log -windowed",
  "waitForReady": false
}
```

### Run a Commandlet

```json
{
  "action": "launch_editor",
  "projectPath": "D:/Projects/MyGame/MyGame.uproject",
  "mode": "commandlet",
  "commandletName": "ResavePackages",
  "commandletArgs": "-PROJECTONLY"
}
```

### Check Editor Status

```json
{
  "action": "get_editor_status"
}
```

### Configure Auto-Launch (programmatic)

```typescript
import { AutomationBridge } from './automation/bridge.js';

const bridge = new AutomationBridge();
bridge.configureAutoLaunch({
  projectPath: 'D:/Projects/MyGame/MyGame.uproject',
  mode: 'headless',
  enabled: true,
  timeoutMs: 120000
});

// Now when connection fails, the editor will be launched automatically
bridge.start();
```

## CI/CD Integration

For CI/CD pipelines, the headless mode is recommended:

```bash
# Environment variable to set editor path (optional)
export UE_EDITOR_PATH="C:/Program Files/Epic Games/UE_5.7/Engine/Binaries/Win64/UnrealEditor.exe"

# Use the MCP server with auto-launch
node dist/index.js --auto-launch --project="D:/Projects/MyGame/MyGame.uproject" --mode=headless
```

## Recommended Tests

### Unit Tests

1. **editor-launch.ts tests**:
   - `findUnrealEditorPath()` - Test with various path configurations
   - `buildLaunchArgs()` - Test all launch modes produce correct arguments
   - `validateProjectPath()` - Test validation logic

2. **system-handlers.ts tests**:
   - `launch_editor` action - Test with valid/invalid project paths
   - `launch_headless` action - Test headless mode flags
   - `get_editor_status` action - Test status reporting

3. **bridge.ts tests**:
   - `configureAutoLaunch()` - Test configuration storage
   - `launchAndConnect()` - Test launch and connection flow
   - Auto-launch on connection failure - Test retry logic

### Integration Tests

1. **End-to-end launch test**:
   ```typescript
   // Test launching editor and establishing MCP connection
   const result = await tools.call('system_control', {
     action: 'launch_editor',
     projectPath: testProjectPath,
     mode: 'headless',
     waitForReady: true,
     timeoutMs: 120000
   });
   expect(result.success).toBe(true);
   expect(result.connectionEstablished).toBe(true);
   ```

2. **Commandlet execution test**:
   ```typescript
   // Test running a commandlet
   const result = await tools.call('system_control', {
     action: 'launch_editor',
     projectPath: testProjectPath,
     mode: 'commandlet',
     commandletName: 'ResavePackages',
     waitForReady: false
   });
   expect(result.success).toBe(true);
   expect(result.pid).toBeDefined();
   ```

### Manual Testing Checklist

- [ ] Launch editor in normal mode
- [ ] Launch editor in headless mode
- [ ] Launch editor in game mode
- [ ] Launch editor in server mode
- [ ] Run a commandlet
- [ ] Test auto-launch on connection failure
- [ ] Test timeout handling
- [ ] Test with invalid project path
- [ ] Test with custom editor path
- [ ] Test `get_editor_status` action

## Instructions for Test Engineer

Please read this document and perform the following verification steps:

1. **Code Review**: Review the modified files for code quality and adherence to project patterns.

2. **Unit Tests**: Create or run unit tests for the new functions in `editor-launch.ts`.

3. **Integration Tests**: Test the full launch flow by:
   - Using the MCP client to call `launch_headless` with a test project
   - Verifying the editor process starts
   - Verifying MCP connection is established

4. **CI/CD Simulation**: Test in a CI-like environment:
   - Run without a pre-existing editor connection
   - Verify auto-launch functionality works
   - Verify headless mode produces no GUI

5. **Error Handling**: Test error cases:
   - Invalid project path
   - Missing editor executable
   - Connection timeout
   - Invalid mode parameter

## Notes

- The implementation uses `child_process.spawn` with `detached: true` to allow the editor to run independently
- On Windows, `shell: true` is used to handle paths with spaces correctly
- The MCP plugin command `-ExecCmds=MCP.Enable` is automatically added to ensure the automation bridge is active
- Auto-launch only triggers once per bridge lifetime to prevent launch loops
