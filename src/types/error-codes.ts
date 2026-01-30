/**
 * Location: src/types/error-codes.ts
 *
 * Summary:
 * Defines structured error codes for consistent error handling across the MCP server.
 * These error codes follow SCREAMING_SNAKE_CASE convention and are used by ResponseFactory
 * to provide machine-readable error categorization alongside human-readable messages.
 *
 * Usage:
 * - Import ErrorCodes in handlers and tools to provide consistent error categorization
 * - Used by ResponseFactory.error() to detect error code patterns and format responses
 * - Enables clients to programmatically handle specific error conditions
 */

/**
 * Centralized error codes for the Unreal MCP server.
 * All error codes use SCREAMING_SNAKE_CASE format.
 */
export const ErrorCodes = {
    // Validation errors - input/argument issues
    INVALID_ARGUMENT: 'INVALID_ARGUMENT',
    MISSING_REQUIRED: 'MISSING_REQUIRED',
    INVALID_PATH: 'INVALID_PATH',
    INVALID_FORMAT: 'INVALID_FORMAT',
    OUT_OF_RANGE: 'OUT_OF_RANGE',
    TYPE_MISMATCH: 'TYPE_MISMATCH',

    // Asset errors - asset management issues
    ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
    ASSET_EXISTS: 'ASSET_EXISTS',
    ASSET_IN_USE: 'ASSET_IN_USE',
    DELETE_FAILED: 'DELETE_FAILED',
    IMPORT_FAILED: 'IMPORT_FAILED',
    EXPORT_FAILED: 'EXPORT_FAILED',
    SAVE_FAILED: 'SAVE_FAILED',

    // Material errors - material graph issues
    MATERIAL_NOT_FOUND: 'MATERIAL_NOT_FOUND',
    NODE_NOT_FOUND: 'NODE_NOT_FOUND',
    CONNECTION_FAILED: 'CONNECTION_FAILED',
    INVALID_PARENT: 'INVALID_PARENT',
    PARAMETER_NOT_FOUND: 'PARAMETER_NOT_FOUND',
    INVALID_NODE_TYPE: 'INVALID_NODE_TYPE',

    // Blueprint errors - blueprint compilation and modification issues
    BLUEPRINT_NOT_FOUND: 'BLUEPRINT_NOT_FOUND',
    COMPILATION_FAILED: 'COMPILATION_FAILED',
    COMPONENT_NOT_FOUND: 'COMPONENT_NOT_FOUND',
    VARIABLE_NOT_FOUND: 'VARIABLE_NOT_FOUND',
    FUNCTION_NOT_FOUND: 'FUNCTION_NOT_FOUND',
    EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',

    // Actor errors - actor manipulation issues
    ACTOR_NOT_FOUND: 'ACTOR_NOT_FOUND',
    SPAWN_FAILED: 'SPAWN_FAILED',
    TRANSFORM_FAILED: 'TRANSFORM_FAILED',
    ATTACHMENT_FAILED: 'ATTACHMENT_FAILED',

    // Level errors - level management issues
    LEVEL_NOT_FOUND: 'LEVEL_NOT_FOUND',
    LEVEL_LOAD_FAILED: 'LEVEL_LOAD_FAILED',
    LEVEL_SAVE_FAILED: 'LEVEL_SAVE_FAILED',

    // Sequence errors - sequencer issues
    SEQUENCE_NOT_FOUND: 'SEQUENCE_NOT_FOUND',
    TRACK_NOT_FOUND: 'TRACK_NOT_FOUND',
    BINDING_NOT_FOUND: 'BINDING_NOT_FOUND',

    // System errors - infrastructure issues
    BRIDGE_DISCONNECTED: 'BRIDGE_DISCONNECTED',
    TIMEOUT: 'TIMEOUT',
    VERSION_MISMATCH: 'VERSION_MISMATCH',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
    PERMISSION_DENIED: 'PERMISSION_DENIED',

    // Editor state errors
    EDITOR_BUSY: 'EDITOR_BUSY',
    PIE_ACTIVE: 'PIE_ACTIVE',
    PIE_NOT_ACTIVE: 'PIE_NOT_ACTIVE',

    // Operation errors - general operation failures
    OPERATION_FAILED: 'OPERATION_FAILED',
    OPERATION_CANCELLED: 'OPERATION_CANCELLED',
    DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
} as const;

/**
 * Type representing any valid error code from the ErrorCodes object.
 */
export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Helper function to check if a string is a valid error code.
 * Error codes follow SCREAMING_SNAKE_CASE pattern.
 *
 * @param value - The string to check
 * @returns True if the string matches error code pattern
 */
export function isErrorCode(value: unknown): value is ErrorCode {
    return typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value);
}

/**
 * Helper function to get a user-friendly description for an error code.
 * Returns undefined if the code is not recognized.
 *
 * @param code - The error code to describe
 * @returns Human-readable description or undefined
 */
export function getErrorDescription(code: ErrorCode): string | undefined {
    const descriptions: Record<ErrorCode, string> = {
        // Validation
        INVALID_ARGUMENT: 'The provided argument is invalid',
        MISSING_REQUIRED: 'A required parameter is missing',
        INVALID_PATH: 'The specified path is invalid or malformed',
        INVALID_FORMAT: 'The data format is invalid',
        OUT_OF_RANGE: 'The value is outside the acceptable range',
        TYPE_MISMATCH: 'The value type does not match the expected type',

        // Assets
        ASSET_NOT_FOUND: 'The specified asset could not be found',
        ASSET_EXISTS: 'An asset already exists at this location',
        ASSET_IN_USE: 'The asset is currently in use and cannot be modified',
        DELETE_FAILED: 'Failed to delete the asset',
        IMPORT_FAILED: 'Failed to import the asset',
        EXPORT_FAILED: 'Failed to export the asset',
        SAVE_FAILED: 'Failed to save the asset',

        // Materials
        MATERIAL_NOT_FOUND: 'The specified material could not be found',
        NODE_NOT_FOUND: 'The specified node could not be found',
        CONNECTION_FAILED: 'Failed to create the connection',
        INVALID_PARENT: 'The specified parent is invalid',
        PARAMETER_NOT_FOUND: 'The specified parameter could not be found',
        INVALID_NODE_TYPE: 'The node type is invalid',

        // Blueprints
        BLUEPRINT_NOT_FOUND: 'The specified blueprint could not be found',
        COMPILATION_FAILED: 'Blueprint compilation failed',
        COMPONENT_NOT_FOUND: 'The specified component could not be found',
        VARIABLE_NOT_FOUND: 'The specified variable could not be found',
        FUNCTION_NOT_FOUND: 'The specified function could not be found',
        EVENT_NOT_FOUND: 'The specified event could not be found',

        // Actors
        ACTOR_NOT_FOUND: 'The specified actor could not be found',
        SPAWN_FAILED: 'Failed to spawn the actor',
        TRANSFORM_FAILED: 'Failed to apply the transform',
        ATTACHMENT_FAILED: 'Failed to attach the actor',

        // Levels
        LEVEL_NOT_FOUND: 'The specified level could not be found',
        LEVEL_LOAD_FAILED: 'Failed to load the level',
        LEVEL_SAVE_FAILED: 'Failed to save the level',

        // Sequences
        SEQUENCE_NOT_FOUND: 'The specified sequence could not be found',
        TRACK_NOT_FOUND: 'The specified track could not be found',
        BINDING_NOT_FOUND: 'The specified binding could not be found',

        // System
        BRIDGE_DISCONNECTED: 'The automation bridge is disconnected',
        TIMEOUT: 'The operation timed out',
        VERSION_MISMATCH: 'Version mismatch detected',
        INTERNAL_ERROR: 'An internal error occurred',
        NOT_IMPLEMENTED: 'This feature is not implemented',
        PERMISSION_DENIED: 'Permission denied for this operation',

        // Editor state
        EDITOR_BUSY: 'The editor is currently busy',
        PIE_ACTIVE: 'Play-in-Editor is currently active',
        PIE_NOT_ACTIVE: 'Play-in-Editor is not active',

        // Operations
        OPERATION_FAILED: 'The operation failed',
        OPERATION_CANCELLED: 'The operation was cancelled',
        DUPLICATE_OPERATION: 'A duplicate operation was detected',
    };

    return descriptions[code];
}
