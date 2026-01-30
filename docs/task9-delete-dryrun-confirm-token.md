# Task 9: Add Dry-Run and ConfirmToken for Delete Operations

## Summary

This implementation adds `dryRun` and `confirmToken` parameters to delete operations in the asset handlers, enabling safer deletion with preview capabilities and confirmation workflow for assets that have references.

## Files Modified

### 1. `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\handlers\asset-handlers.ts`

**Changes Made:**

1. Added helper functions for token generation and verification at module level:
   - `generateConfirmToken(paths: string[]): string` - Generates a unique confirmation token based on sorted paths and timestamp
   - `confirmTokens` Map - Stores tokens with their associated paths and expiry times
   - `verifyConfirmToken(token: string, paths: string[]): boolean` - Validates tokens and checks path matching

2. Enhanced the `delete_assets`/`delete_asset`/`delete` case with:
   - New parameters: `dryRun`, `confirmToken`, and `force`
   - Reference checking via `manage_asset` with `get_references` subAction
   - Dry-run mode that returns preview without deletion
   - Confirmation token workflow for assets with references
   - Token expiry (5 minutes) and single-use enforcement

### 2. `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\types\tool-interfaces.ts`

**Changes Made:**

Added `force?: boolean` parameter to the `deleteAssets` method signature in the `IAssetTools` interface:
```typescript
deleteAssets(params: { paths: string[]; fixupRedirectors?: boolean; force?: boolean; timeoutMs?: number }): Promise<StandardActionResponse>;
```

## API Reference

### Delete Operation Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| assetPath | string | - | Single asset path (alias: `path`) |
| assetPaths | string[] | - | Array of asset paths (alias: `paths`) |
| fixupRedirectors | boolean | `true` | Whether to fix up redirectors after deletion |
| dryRun | boolean | `false` | Preview mode - returns what would be deleted without actually deleting |
| confirmToken | string | - | Token from dry-run to confirm deletion of referenced assets |
| force | boolean | `false` | Skip reference check and delete regardless of references |

### Workflow

#### 1. Simple Delete (No References)
```json
{
  "action": "delete",
  "assetPath": "/Game/Assets/MyAsset"
}
```
Returns success if asset has no references.

#### 2. Dry Run Preview
```json
{
  "action": "delete",
  "assetPaths": ["/Game/Assets/Asset1", "/Game/Assets/Asset2"],
  "dryRun": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Dry run complete - 2 asset(s) would be deleted",
  "dryRun": true,
  "wouldDelete": ["/Game/Assets/Asset1", "/Game/Assets/Asset2"],
  "assetCount": 2,
  "references": [
    {
      "assetPath": "/Game/Assets/Asset1",
      "referencers": ["/Game/Blueprints/BP_Example"]
    }
  ],
  "totalReferences": 1,
  "requireConfirm": true,
  "confirmToken": "confirm_xyz123",
  "expiresIn": "5 minutes",
  "hint": "Assets have references. Call again with confirmToken to proceed."
}
```

#### 3. Confirm Deletion with Token
```json
{
  "action": "delete",
  "assetPaths": ["/Game/Assets/Asset1", "/Game/Assets/Asset2"],
  "confirmToken": "confirm_xyz123"
}
```

Returns success if token is valid and not expired.

#### 4. Force Delete (Skip References)
```json
{
  "action": "delete",
  "assetPath": "/Game/Assets/MyAsset",
  "force": true
}
```

Deletes regardless of references.

### Error Responses

#### Asset Has References (No Token)
```json
{
  "success": false,
  "error": "ASSET_IN_USE",
  "message": "Assets have references. Use dryRun:true first, then pass confirmToken to proceed, or use force:true to override.",
  "references": [...],
  "totalReferences": N,
  "hint": "Add dryRun:true to preview, or force:true to delete anyway"
}
```

#### Invalid or Expired Token
```json
{
  "success": false,
  "error": "INVALID_ARGUMENT",
  "message": "Invalid or expired confirm token",
  "hint": "Token may have expired (5 min limit) or paths changed. Use dryRun:true to get a new token."
}
```

## Implementation Notes

1. **Token Security**: Tokens are generated using a simple hash of sorted paths plus timestamp. They expire after 5 minutes and can only be used once.

2. **Path Matching**: When verifying tokens, paths are sorted and compared to ensure the same assets are being deleted as were previewed.

3. **Reference Checking**: The implementation attempts to get references via the `manage_asset` automation request. If reference checking fails, it logs a warning and proceeds without reference information.

4. **Graceful Degradation**: If the reference check fails, the delete operation can still proceed (assuming no references).

5. **Token Cleanup**: Used tokens are deleted immediately after verification to prevent replay attacks.

## Recommended Tests

### Unit Tests

The test engineer should create tests in `D:\fluxPoint\clay-mini-game\Unreal_mcp\tests\` to verify:

1. **Token Generation and Verification:**
   - Test `generateConfirmToken` produces consistent tokens for same paths
   - Test `verifyConfirmToken` returns true for valid, non-expired tokens
   - Test `verifyConfirmToken` returns false for expired tokens (mock Date.now)
   - Test `verifyConfirmToken` returns false for mismatched paths
   - Test token expiry cleanup

2. **Dry Run Mode:**
   - Test dry run with no references returns no confirmToken
   - Test dry run with references returns confirmToken
   - Test dry run does not actually delete assets (verify asset still exists)
   - Test dry run response structure matches API spec

3. **Confirmation Token Flow:**
   - Test valid token allows deletion
   - Test expired token is rejected
   - Test wrong paths with valid token is rejected
   - Test token can only be used once

4. **Force Delete:**
   - Test force:true bypasses reference check
   - Test force:true with references deletes successfully

5. **Error Cases:**
   - Test ASSET_IN_USE error when references exist and no token/force
   - Test INVALID_ARGUMENT error for expired tokens
   - Test INVALID_ARGUMENT error for invalid tokens

### Integration Tests (If Unreal Engine Available)

1. Create two assets where one references the other
2. Attempt to delete the referenced asset (should fail with ASSET_IN_USE)
3. Run dryRun:true to get confirmToken
4. Use confirmToken to delete
5. Verify asset is deleted
6. Verify referencing asset still exists (with broken reference)

### Example Test Commands

```bash
# Run all asset handler tests
npm test -- --grep "asset-handlers"

# Run specific delete operation tests
npm test -- --grep "delete.*dryRun|confirmToken|force"
```

## Instructions for Test Engineer

1. Read this documentation file at `D:\fluxPoint\clay-mini-game\Unreal_mcp\docs\task9-delete-dryrun-confirm-token.md`

2. Review the implementation at:
   - `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\handlers\asset-handlers.ts` (lines 12-60 for helpers, lines 306-441 for delete handler)
   - `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\types\tool-interfaces.ts` (line 77 for interface change)

3. Create or update test files to cover:
   - Token generation/verification helper functions
   - All delete operation scenarios (dry run, confirm, force)
   - Error handling for various failure cases

4. Focus on edge cases:
   - Token expiry timing
   - Path order variations
   - Multiple paths with mixed reference states
   - Concurrent token usage attempts

5. Note: The build currently has pre-existing TypeScript errors in `system-handlers.ts` that are unrelated to this task. The asset-handlers.ts changes compile successfully.

## Build Status

The implementation compiles successfully. To verify:

```bash
cd D:\fluxPoint\clay-mini-game\Unreal_mcp
npm run build
```

Note: There are pre-existing errors in `system-handlers.ts` that are not related to this task.
