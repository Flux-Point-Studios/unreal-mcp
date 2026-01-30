# Implementation Summary: ResponseFactory Error Handling with Structured Error Codes

**Date:** 2026-01-28
**Task:** Fix ResponseFactory error handling with structured error codes
**Status:** Complete

## Overview

This implementation fixes the argument confusion in `ResponseFactory.error()` where handlers call it like `(message, errorCode)` but it expected `(error, defaultMessage)`. The new implementation is backward-compatible while adding support for structured error codes.

## Files Modified

### 1. `src/utils/response-factory.ts`

**Changes Made:**
- Added import for `isErrorCode` and `ErrorCode` type from new error-codes.ts
- Created new `ErrorResponse` interface extending `StandardActionResponse` with optional `errorCode` and `context` fields
- Rewrote `error()` method to detect calling convention based on second argument pattern
- Updated `validationError()` to use new error code system
- Added new convenience methods:
  - `missingRequired(paramName, context?)` - For missing parameter errors
  - `notFound(resourceType, identifier, context?)` - For not found errors with automatic error code mapping
  - `timeout(operation, timeoutMs, context?)` - For timeout errors

**Key Implementation Details:**
- The `error()` method detects if the second argument is an error code by checking for SCREAMING_SNAKE_CASE pattern
- Backward compatible: legacy calls like `error(new Error('msg'), 'default')` still work
- New style calls: `error('message', 'ERROR_CODE', { context })` now work correctly
- Error messages include the error code prefix when present: `"ERROR_CODE: message"`

### 2. `src/types/error-codes.ts` (New File)

**Contents:**
- `ErrorCodes` constant object with categorized error codes
- `ErrorCode` type derived from ErrorCodes
- `isErrorCode(value)` helper function for detecting SCREAMING_SNAKE_CASE patterns
- `getErrorDescription(code)` helper for user-friendly error descriptions

**Error Code Categories:**
- Validation: `INVALID_ARGUMENT`, `MISSING_REQUIRED`, `INVALID_PATH`, etc.
- Assets: `ASSET_NOT_FOUND`, `ASSET_EXISTS`, `DELETE_FAILED`, etc.
- Materials: `MATERIAL_NOT_FOUND`, `NODE_NOT_FOUND`, `CONNECTION_FAILED`, etc.
- Blueprints: `BLUEPRINT_NOT_FOUND`, `COMPILATION_FAILED`, etc.
- Actors: `ACTOR_NOT_FOUND`, `SPAWN_FAILED`, etc.
- Levels: `LEVEL_NOT_FOUND`, `LEVEL_LOAD_FAILED`, etc.
- Sequences: `SEQUENCE_NOT_FOUND`, `TRACK_NOT_FOUND`, etc.
- System: `BRIDGE_DISCONNECTED`, `TIMEOUT`, `INTERNAL_ERROR`, etc.
- Editor State: `EDITOR_BUSY`, `PIE_ACTIVE`, etc.
- Operations: `OPERATION_FAILED`, `OPERATION_CANCELLED`, etc.

## Usage Examples

### New Style (with error codes)
```typescript
import { ResponseFactory } from '../utils/response-factory.js';
import { ErrorCodes } from '../types/error-codes.js';

// With error code constant
return ResponseFactory.error('Asset path is invalid', ErrorCodes.INVALID_PATH, { path: '/Game/Missing' });
// Output: { success: false, message: "INVALID_PATH: Asset path is invalid", errorCode: "INVALID_PATH", context: { path: "/Game/Missing" } }

// With string error code
return ResponseFactory.error('Node not found in graph', 'NODE_NOT_FOUND');
// Output: { success: false, message: "NODE_NOT_FOUND: Node not found in graph", errorCode: "NODE_NOT_FOUND", context: null }
```

### Legacy Style (backward compatible)
```typescript
// With Error object
return ResponseFactory.error(new Error('Something failed'), 'Default message');
// Output: { success: false, message: "Something failed", errorCode: undefined, context: null }

// With message only
return ResponseFactory.error('Operation failed');
// Output: { success: false, message: "Operation failed", errorCode: undefined, context: null }
```

### Convenience Methods
```typescript
// Missing required parameter
return ResponseFactory.missingRequired('blueprintPath');
// Output: { success: false, message: "MISSING_REQUIRED: Missing required parameter: blueprintPath", errorCode: "MISSING_REQUIRED", context: { parameter: "blueprintPath" } }

// Not found with automatic code mapping
return ResponseFactory.notFound('Material', '/Game/Materials/Missing');
// Output: { success: false, message: "MATERIAL_NOT_FOUND: Material not found: /Game/Materials/Missing", errorCode: "MATERIAL_NOT_FOUND", context: { resourceType: "Material", identifier: "/Game/Materials/Missing" } }

// Timeout
return ResponseFactory.timeout('Blueprint compilation', 30000);
// Output: { success: false, message: "TIMEOUT: Operation timed out after 30000ms: Blueprint compilation", errorCode: "TIMEOUT", context: { operation: "Blueprint compilation", timeoutMs: 30000 } }
```

## Recommended Tests

The Test Engineer should verify the following test cases:

### Unit Tests for ResponseFactory.error()

1. **New Style Detection Tests**
   - Test that `error('message', 'ERROR_CODE')` correctly detects error code
   - Test that `error('message', 'ERROR_CODE', { key: 'value' })` includes context
   - Test various SCREAMING_SNAKE_CASE patterns are detected

2. **Legacy Style Compatibility Tests**
   - Test that `error(new Error('msg'))` extracts error message from Error object
   - Test that `error(new Error('msg'), 'fallback')` uses Error.message not fallback
   - Test that `error('string message')` works without second argument
   - Test that `error(null, 'default')` uses default message
   - Test that `error('', 'default')` uses default message

3. **Edge Cases**
   - Test mixed case strings like `'Error_Code'` are NOT treated as error codes
   - Test lowercase strings like `'fallback message'` are NOT treated as error codes
   - Test that error code prefix appears in formatted message

4. **Convenience Method Tests**
   - Test `missingRequired()` produces correct error code and message
   - Test `notFound()` maps resource types to correct error codes
   - Test `validationError()` uses INVALID_ARGUMENT code
   - Test `timeout()` includes operation and timeout values

### Unit Tests for error-codes.ts

1. **isErrorCode() Tests**
   - Test `isErrorCode('VALID_CODE')` returns true
   - Test `isErrorCode('VALID123_CODE')` returns true
   - Test `isErrorCode('invalid_code')` returns false
   - Test `isErrorCode('Mixed_Case')` returns false
   - Test `isErrorCode(123)` returns false
   - Test `isErrorCode(null)` returns false

2. **getErrorDescription() Tests**
   - Test all error codes have descriptions
   - Test descriptions are meaningful strings

### Integration Tests

1. **Handler Integration**
   - Test that handlers using new error style produce expected responses
   - Test that existing handlers using legacy style still work

## Test Instructions for Test Engineer

Please read this file and execute the following test plan:

1. Create a new test file at `src/utils/__tests__/response-factory.test.ts`
2. Implement unit tests covering all cases listed above
3. Create a test file at `src/types/__tests__/error-codes.test.ts`
4. Run tests with: `npm test` or `npx jest response-factory error-codes`
5. Verify all tests pass and report any failures

## Notes

- TypeScript compilation verified - no errors in modified files
- All changes are additive and backward compatible
- The ErrorResponse interface extends StandardActionResponse for type compatibility
- Context is always included in response (as null if not provided) for consistent response shape
