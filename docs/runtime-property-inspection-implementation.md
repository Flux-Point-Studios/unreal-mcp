# Runtime Property Inspection Implementation Summary

## Overview

This document summarizes the implementation of runtime property inspection capabilities for the MCP (Model Context Protocol) Automation Bridge. The feature adds the ability to inspect actor and component properties at runtime during Play-In-Editor (PIE) sessions.

## Files Modified

### TypeScript Changes

#### `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\handlers\system-handlers.ts`

Added two new case handlers after `get_pie_status`:

1. **`inspect_actor`** - Inspects an actor's properties and components during runtime
   - Parameters:
     - `actorName` (required): Name or label of the actor to inspect
     - `includeComponents` (optional, default: true): Whether to include component details
   - Returns: Actor name, class, label, transform (location, rotation, scale), and optionally an array of components with their properties

2. **`get_component_state`** - Gets detailed state of a specific component on an actor
   - Parameters:
     - `actorName` (required): Name or label of the actor
     - `componentName` (required): Name of the component to inspect
   - Returns: Component name, class, isActive status, all BlueprintVisible properties, and for scene components: relative and world transforms

#### `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\consolidated-tool-definitions.ts`

Updated the `system_control` tool definition:
- Added `inspect_actor` and `get_component_state` to the action enum
- Added new input schema properties: `actorName`, `componentName`, `includeComponents`
- Added new output schema properties: `name`, `class`, `label`, `transform`, `components`, `properties`, `isActive`

### C++ Changes

#### `D:\fluxPoint\clay-mini-game\Unreal_mcp\plugins\McpAutomationBridge\Source\McpAutomationBridge\Private\McpAutomationBridge_EnvironmentHandlers.cpp`

Added two new sub-action handlers in `HandleSystemControlAction`:

1. **`inspect_actor` handler** (after `get_pie_status`)
   - Uses `TActorIterator` to find actors by name or label
   - Prefers PIE world (`GEditor->PlayWorld`) if active
   - Uses UE reflection (`TFieldIterator<FProperty>`) to extract BlueprintVisible properties
   - Supports: bool, float, double, int32, and string property types
   - Returns JSON with actor info, transform, and components array

2. **`get_component_state` handler**
   - Finds actor, then finds component with fuzzy name matching
   - Extracts all BlueprintVisible properties via reflection
   - Additional support for FName and FStruct properties (exported as text)
   - For scene components: includes both relative and world transforms
   - Returns comprehensive component state JSON

## Usage Examples

### Inspect Actor

```typescript
// From MCP client
const result = await tools.systemControl({
  action: 'inspect_actor',
  actorName: 'BP_PlayerCharacter_C_0',
  includeComponents: true
});

// Response:
{
  success: true,
  data: {
    name: 'BP_PlayerCharacter_C_0',
    class: 'BP_PlayerCharacter_C',
    label: 'PlayerCharacter',
    transform: {
      x: 100.0, y: 200.0, z: 50.0,
      pitch: 0.0, yaw: 90.0, roll: 0.0,
      scaleX: 1.0, scaleY: 1.0, scaleZ: 1.0
    },
    components: [
      {
        name: 'CharacterMovement0',
        class: 'CharacterMovementComponent',
        isActive: true,
        properties: {
          MaxWalkSpeed: 600.0,
          MaxAcceleration: 2048.0,
          // ... other BlueprintVisible properties
        }
      }
    ]
  }
}
```

### Get Component State

```typescript
const result = await tools.systemControl({
  action: 'get_component_state',
  actorName: 'BP_PlayerCharacter_C_0',
  componentName: 'CharacterMovement'
});

// Response:
{
  success: true,
  data: {
    name: 'CharacterMovement0',
    class: 'CharacterMovementComponent',
    isActive: true,
    actorName: 'PlayerCharacter',
    properties: {
      MaxWalkSpeed: 600.0,
      MaxAcceleration: 2048.0,
      GravityScale: 1.0,
      // ... all BlueprintVisible properties
    },
    relativeTransform: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
    worldTransform: { x: 100, y: 200, z: 50, pitch: 0, yaw: 90, roll: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
    isSceneComponent: true
  }
}
```

## Recommended Tests

The Test Engineer should verify the following scenarios:

### Unit Tests

1. **Test `inspect_actor` with valid actor name** - Should return actor info and components
2. **Test `inspect_actor` with actor label** - Should find actor by label as well as name
3. **Test `inspect_actor` with `includeComponents: false`** - Should omit components array
4. **Test `inspect_actor` with non-existent actor** - Should return `ACTOR_NOT_FOUND` error
5. **Test `get_component_state` with valid actor and component** - Should return full component state
6. **Test `get_component_state` with fuzzy component name** - Should match partial names
7. **Test `get_component_state` with non-existent component** - Should return `COMPONENT_NOT_FOUND` error
8. **Test both actions without PIE active** - Should still work using editor world
9. **Test both actions during PIE** - Should prefer PIE world and show runtime state

### Integration Tests

1. **PIE Runtime State Test**: Start PIE, move player, call `inspect_actor` on player pawn, verify position matches
2. **Component Property Test**: During PIE, modify a component property via gameplay, call `get_component_state`, verify change reflected
3. **Performance Test**: Call `inspect_actor` on actor with many components, verify reasonable response time

### Test Commands

```bash
# Build the plugin
cd D:\fluxPoint\clay-mini-game\Unreal_mcp
npm run build

# Run TypeScript tests (if configured)
npm test

# For C++ testing, rebuild the Unreal project with the updated plugin
# Then in Unreal Editor, enable PIE and test via MCP client
```

## Notes for Test Engineer

- The implementation uses UE reflection which only exposes `BlueprintVisible` properties
- Struct properties are exported as text via `ExportTextItem_Direct`
- The component search uses fuzzy matching (contains check after exact match)
- When PIE is not active, the handlers will use the editor world instead
- Both handlers are wrapped in `#if WITH_EDITOR` guards for safety

## Related Documentation

- `D:\fluxPoint\clay-mini-game\Unreal_mcp\docs\handler-mapping.md` - Full handler mapping reference
- `D:\fluxPoint\clay-mini-game\Unreal_mcp\docs\Engine-API-Reference.md` - Engine API details
