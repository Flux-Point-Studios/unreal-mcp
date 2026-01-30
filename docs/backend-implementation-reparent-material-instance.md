# Backend Implementation: Reparent Material Instance Handler

## Summary

This document summarizes the backend implementation for Task 4: adding the `reparent_material_instance` TypeScript handler and updating `create_material_instance` to use reparent when `overwrite=true`.

## Files Modified

### `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\handlers\material-authoring-handlers.ts`

## Changes Made

### 1. New `reparent_material_instance` Handler (Lines 652-681)

Added a new case handler for `reparent_material_instance` action that:

- **Parameters**:
  - `assetPath` (required) - aliases: `path`, `materialInstance`
  - `parentMaterial` (required) - aliases: `newParent`, `parent`
  - `preserveParameters` (default: `true`) - whether to keep existing parameter values
  - `save` (default: `true`) - whether to save after reparenting

- **Behavior**:
  - Validates that both `assetPath` and `parentMaterial` are provided
  - Calls the automation backend with `subAction: 'reparent_material_instance'`
  - Returns appropriate success/error responses
  - Uses error code `INVALID_PARENT` for failures
  - Uses error code `INVALID_ARGUMENT` for missing required parameters

### 2. Updated `create_material_instance` Handler (Lines 592-650)

Enhanced the existing handler to support `overwrite` functionality using reparent:

- **New Parameter**:
  - `overwrite` (default: `false`) - when true, reparents existing material instance instead of failing

- **New Behavior**:
  - When `overwrite=true`, first checks if the asset exists via `manage_asset.exists`
  - If exists, calls `reparent_material_instance` with `preserveParameters: false` (fresh start)
  - If reparent succeeds, returns success with message indicating reparenting occurred
  - If reparent fails (e.g., asset wasn't a material instance), falls through to normal creation
  - Normal creation path unchanged for new assets or when `overwrite=false`

### 3. Updated Default Error Message (Line 878)

Added `reparent_material_instance` to the list of available actions in the default error message.

## Code Snippets

### reparent_material_instance Handler

```typescript
case 'reparent_material_instance': {
  const params = normalizeArgs(args, [
    { key: 'assetPath', aliases: ['path', 'materialInstance'], required: true },
    { key: 'parentMaterial', aliases: ['newParent', 'parent'], required: true },
    { key: 'preserveParameters', default: true },
    { key: 'save', default: true },
  ]);

  const assetPath = extractString(params, 'assetPath');
  const parentMaterial = extractString(params, 'parentMaterial');
  const preserveParameters = extractOptionalBoolean(params, 'preserveParameters') ?? true;
  const save = extractOptionalBoolean(params, 'save') ?? true;

  if (!assetPath || !parentMaterial) {
    return ResponseFactory.error('assetPath and parentMaterial are required', 'INVALID_ARGUMENT');
  }

  const res = (await executeAutomationRequest(tools, 'manage_material_authoring', {
    subAction: 'reparent_material_instance',
    assetPath,
    parentMaterial,
    preserveParameters,
    save,
  })) as MaterialAuthoringResponse;

  if (res.success === false) {
    return ResponseFactory.error(res.error ?? 'Failed to reparent', 'INVALID_PARENT');
  }
  return ResponseFactory.success(res, res.message ?? `Material instance parent changed to ${parentMaterial}`);
}
```

### Updated create_material_instance with Overwrite Logic

```typescript
// If exists and overwrite=true, REPARENT instead of delete+recreate
if (overwrite) {
  const existsRes = (await executeAutomationRequest(tools, 'manage_asset', {
    subAction: 'exists',
    assetPath: fullPath,
  })) as { exists?: boolean };

  if (existsRes.exists) {
    // Reparent in place - preserves references!
    const reparentRes = (await executeAutomationRequest(tools, 'manage_material_authoring', {
      subAction: 'reparent_material_instance',
      assetPath: fullPath,
      parentMaterial,
      preserveParameters: false, // Fresh start for overwrite
      save,
    })) as MaterialAuthoringResponse;

    if (reparentRes.success !== false) {
      return ResponseFactory.success(reparentRes, `Material instance '${name}' reparented to ${parentMaterial}`);
    }
    // Fall through to create if reparent failed (maybe it wasn't a MI)
  }
}
```

## Recommended Tests

The Test Engineer should verify the following:

### Unit Tests

1. **reparent_material_instance handler tests**:
   - Test with valid assetPath and parentMaterial
   - Test with missing assetPath (expect INVALID_ARGUMENT error)
   - Test with missing parentMaterial (expect INVALID_ARGUMENT error)
   - Test preserveParameters=true behavior
   - Test preserveParameters=false behavior
   - Test save=true and save=false options
   - Test alias parameters ('path', 'materialInstance', 'newParent', 'parent')

2. **create_material_instance handler tests**:
   - Test normal creation (overwrite=false, asset doesn't exist)
   - Test with overwrite=false when asset exists (should fail or create new)
   - Test with overwrite=true when asset doesn't exist (should create new)
   - Test with overwrite=true when asset exists (should reparent)
   - Test fallthrough when reparent fails (should attempt creation)

### Integration Tests

1. **End-to-end reparent workflow**:
   - Create a material instance with parent A
   - Reparent to parent B
   - Verify parent is now B
   - Verify references are preserved

2. **End-to-end overwrite workflow**:
   - Create material instance with parent A
   - Call create_material_instance with overwrite=true and parent B
   - Verify instance now has parent B
   - Verify asset path unchanged (references preserved)

### Test Commands

```bash
# Navigate to the Unreal_mcp directory
cd D:\fluxPoint\clay-mini-game\Unreal_mcp

# Run TypeScript compiler to check for errors
npx tsc --noEmit

# Run tests (if test framework is configured)
npm test -- --grep "material-authoring"
npm test -- --grep "reparent"
```

## Instructions for Test Engineer

Please read this file and verify the implementation by:

1. Running the TypeScript compiler to ensure no type errors
2. Executing the unit tests for the material-authoring-handlers module
3. Running integration tests if available
4. Manually testing the reparent_material_instance action via the MCP interface
5. Testing the create_material_instance with overwrite=true scenario

Report any failures or issues found during testing.
