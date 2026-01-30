# Task 11: Asset Provenance Tagging and MCP Asset Cleanup

## Summary

This implementation adds MCP provenance metadata tagging for assets created by the MCP server and provides APIs to find and cleanup these assets. This enables session-based asset tracking and cleanup capabilities.

## Files Modified

### `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\handlers\asset-handlers.ts`

**Changes Made:**

1. Added Logger import for warning logging:
   ```typescript
   import { Logger } from '../../utils/logger.js';
   const log = new Logger('AssetHandlers');
   ```

2. Added exported helper function `tagMcpAsset` for tagging assets with MCP provenance metadata:
   - Sets `MCP.CreatedBy`: Identifies the MCP server as the creator
   - Sets `MCP.Version`: Current MCP server version (0.6.0)
   - Sets `MCP.SessionId`: Session identifier for grouping assets
   - Sets `MCP.Timestamp`: ISO timestamp of creation
   - Non-fatal operation - logs warning on failure but does not throw

3. Added three new handler cases in the switch statement:

   **`find_mcp_assets`**: Finds all assets created by the MCP server
   - Optional `sessionId` parameter to filter by session
   - Optional `path` parameter (defaults to `/Game`)
   - Searches for assets with `MCP.CreatedBy` metadata

   **`cleanup_mcp_session`**: Cleans up all assets from a specific MCP session
   - Required `sessionId` parameter
   - `dryRun` parameter (defaults to `true` for safety)
   - Optional `path` parameter (defaults to `/Game`)
   - Returns preview of assets to delete when in dry run mode
   - Performs actual deletion when `dryRun: false`

   **`set_asset_metadata`**: Manually sets metadata on an asset
   - Required `assetPath` parameter (alias: `path`)
   - Required `metadata` object parameter
   - Useful for custom tagging beyond MCP provenance

## API Reference

### `tagMcpAsset` (Exported Helper Function)

```typescript
export async function tagMcpAsset(
  tools: ITools,
  assetPath: string,
  sessionId?: string
): Promise<void>
```

Tags an asset with MCP provenance metadata. This function is designed to be called after asset creation operations to track which assets were created by the MCP server.

**Parameters:**
- `tools`: The ITools interface for executing requests
- `assetPath`: The Unreal Engine asset path to tag
- `sessionId`: Optional session identifier for grouping assets

### `find_mcp_assets` Handler

**Action:** `find_mcp_assets`

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| sessionId | string | No | - | Filter results to a specific session |
| path | string | No | `/Game` | Root path to search |

**Response:**
```json
{
  "success": true,
  "message": "Found N MCP-created assets",
  "assets": [...]
}
```

### `cleanup_mcp_session` Handler

**Action:** `cleanup_mcp_session`

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| sessionId | string | Yes | - | Session ID to cleanup |
| dryRun | boolean | No | `true` | Preview mode (no actual deletion) |
| path | string | No | `/Game` | Root path to search |

**Response (Dry Run):**
```json
{
  "success": true,
  "message": "Would delete N assets (dry run)",
  "dryRun": true,
  "sessionId": "...",
  "assetsFound": N,
  "wouldDelete": [...],
  "hint": "Set dryRun:false to actually delete these assets"
}
```

**Response (Actual Deletion):**
```json
{
  "success": true,
  "message": "Cleaned up N assets from session ...",
  "sessionId": "...",
  "deleted": {...},
  "assetsDeleted": N
}
```

### `set_asset_metadata` Handler

**Action:** `set_asset_metadata`

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| assetPath | string | Yes | - | Path to the asset (alias: `path`) |
| metadata | object | Yes | - | Key-value pairs to set as metadata |

**Response:**
```json
{
  "success": true,
  "message": "Asset metadata updated"
}
```

## Implementation Notes

1. **Non-Fatal Tagging**: The `tagMcpAsset` helper catches errors and logs warnings instead of throwing. This ensures asset creation operations succeed even if metadata tagging fails.

2. **Dry Run Safety**: The `cleanup_mcp_session` handler defaults to `dryRun: true` to prevent accidental data loss.

3. **Metadata Keys**: All MCP-related metadata uses the `MCP.` prefix namespace:
   - `MCP.CreatedBy`
   - `MCP.Version`
   - `MCP.SessionId`
   - `MCP.Timestamp`

4. **Type Safety**: Proper type assertions are used for the response objects from the automation bridge.

## Recommended Tests

### Unit Tests

The test engineer should create tests in `D:\fluxPoint\clay-mini-game\Unreal_mcp\tests\` to verify:

1. **`tagMcpAsset` Helper Function:**
   - Test successful tagging with all parameters
   - Test tagging without sessionId (should use 'unknown')
   - Test error handling (should log warning but not throw)
   - Verify metadata structure is correct

2. **`find_mcp_assets` Handler:**
   - Test finding assets with no session filter
   - Test finding assets with session filter
   - Test with custom path parameter
   - Test empty results handling

3. **`cleanup_mcp_session` Handler:**
   - Test dry run mode returns preview without deletion
   - Test actual deletion mode (requires mock)
   - Test missing sessionId validation
   - Test no assets found scenario
   - Test path parameter usage

4. **`set_asset_metadata` Handler:**
   - Test successful metadata setting
   - Test missing assetPath validation
   - Test missing metadata validation
   - Test non-object metadata validation

### Integration Tests (If Unreal Engine Available)

1. Create an asset, tag it with `tagMcpAsset`
2. Verify `find_mcp_assets` can locate it
3. Run `cleanup_mcp_session` in dry run mode
4. Verify asset still exists
5. Run `cleanup_mcp_session` with `dryRun: false`
6. Verify asset is deleted

### Example Test Commands

```bash
# Run all asset handler tests
npm test -- --grep "asset-handlers"

# Run specific provenance tests
npm test -- --grep "MCP provenance|cleanup_mcp_session|find_mcp_assets"
```

## Instructions for Test Engineer

1. Read this documentation file at `D:\fluxPoint\clay-mini-game\Unreal_mcp\docs\task11-asset-provenance-mcp-cleanup.md`

2. Review the implementation at `D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\handlers\asset-handlers.ts`

3. Create or update test files to cover:
   - The exported `tagMcpAsset` helper function
   - The three new handler cases: `find_mcp_assets`, `cleanup_mcp_session`, `set_asset_metadata`

4. Focus on edge cases:
   - Error handling and graceful degradation
   - Input validation
   - Dry run vs actual execution modes

5. Note: The build currently has unrelated TypeScript errors in `system-handlers.ts` that need to be addressed separately.
