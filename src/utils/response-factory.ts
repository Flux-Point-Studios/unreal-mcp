/**
 * Location: src/utils/response-factory.ts
 *
 * Summary:
 * Factory class for creating standardized API responses throughout the MCP server.
 * Provides consistent success and error response formatting with support for
 * structured error codes, context data, and backward compatibility.
 *
 * Usage:
 * - ResponseFactory.success(data, message) - Create success responses
 * - ResponseFactory.error(errOrMessage, codeOrDefault, context) - Create error responses
 * - ResponseFactory.validationError(message, context) - Create validation error responses
 * - Used by all tool handlers and API endpoints to ensure consistent response format
 */

import { StandardActionResponse } from '../types/tool-interfaces.js';
import { Logger } from './logger.js';
import { cleanObject } from './safe-json.js';
import { isErrorCode, type ErrorCode } from '../types/error-codes.js';

const log = new Logger('ResponseFactory');

/**
 * Extended error response interface with optional structured fields.
 */
export interface ErrorResponse extends StandardActionResponse {
    success: false;
    message: string;
    errorCode?: ErrorCode | string;
    context?: Record<string, unknown> | null;
}

export class ResponseFactory {
    /**
     * Create a standard success response.
     *
     * @param data - The response payload data
     * @param message - Human-readable success message
     * @returns Standardized success response
     */
    static success(data: unknown, message: string = 'Operation successful'): StandardActionResponse {
        return {
            success: true,
            message,
            data: cleanObject(data)
        };
    }

    /**
     * Create a standard error response with backward-compatible signature.
     *
     * This method supports two calling conventions:
     * 1. New style: error(message, errorCode, context?) - when arg2 is SCREAMING_SNAKE_CASE
     * 2. Legacy style: error(errorOrMessage, defaultMessage?) - original behavior
     *
     * @param errOrMessage - Error object, error message string, or any value
     * @param messageOrCode - Either an error code (SCREAMING_SNAKE_CASE) or a default message
     * @param maybeContext - Optional context object for additional error details
     * @returns Standardized error response
     *
     * @example
     * // New style with error code
     * ResponseFactory.error('Asset path is invalid', 'INVALID_PATH', { path: '/Game/Missing' });
     *
     * @example
     * // Legacy style with Error object
     * ResponseFactory.error(new Error('Something failed'), 'Default message');
     *
     * @example
     * // Legacy style with message only
     * ResponseFactory.error('Operation failed');
     */
    static error(
        errOrMessage: unknown,
        messageOrCode?: string,
        maybeContext?: Record<string, unknown>
    ): ErrorResponse {
        // Detect if arg2 looks like an error code (SCREAMING_SNAKE_CASE pattern)
        const isSecondArgErrorCode = isErrorCode(messageOrCode);

        let message: string;
        let errorCode: ErrorCode | string | undefined;
        const context = maybeContext;

        if (isSecondArgErrorCode) {
            // New style: error(message, errorCode, context?)
            // First argument is the message, second is the error code
            message = String(errOrMessage);
            errorCode = messageOrCode;
        } else {
            // Legacy style: error(error, defaultMessage?)
            // First argument is an error or message, second is fallback
            if (errOrMessage instanceof Error) {
                message = errOrMessage.message;
            } else if (errOrMessage !== null && errOrMessage !== undefined && errOrMessage !== '') {
                message = String(errOrMessage);
            } else {
                message = messageOrCode || 'Operation failed';
            }
            errorCode = undefined;
        }

        // Log the full error details for debugging
        log.error('[ResponseFactory] Error:', { message, errorCode, context });

        // Format the final message - include error code prefix if present
        const formattedMessage = errorCode ? `${errorCode}: ${message}` : message;

        return {
            success: false,
            message: formattedMessage,
            errorCode,
            context: context ?? null,
            data: null
        };
    }

    /**
     * Create a validation error response.
     * Convenience method for input validation failures.
     *
     * @param message - Description of the validation failure
     * @param context - Optional context with validation details
     * @returns Standardized validation error response
     */
    static validationError(message: string, context?: Record<string, unknown>): ErrorResponse {
        return ResponseFactory.error(message, 'INVALID_ARGUMENT', context);
    }

    /**
     * Create an error response for missing required parameters.
     *
     * @param paramName - Name of the missing parameter
     * @param context - Optional additional context
     * @returns Standardized missing parameter error response
     */
    static missingRequired(paramName: string, context?: Record<string, unknown>): ErrorResponse {
        return ResponseFactory.error(
            `Missing required parameter: ${paramName}`,
            'MISSING_REQUIRED',
            { parameter: paramName, ...context }
        );
    }

    /**
     * Create an error response for not found resources.
     *
     * @param resourceType - Type of resource (e.g., 'Asset', 'Actor', 'Blueprint')
     * @param identifier - The identifier that was not found
     * @param context - Optional additional context
     * @returns Standardized not found error response
     */
    static notFound(
        resourceType: string,
        identifier: string,
        context?: Record<string, unknown>
    ): ErrorResponse {
        // Map resource types to specific error codes
        const codeMap: Record<string, string> = {
            asset: 'ASSET_NOT_FOUND',
            material: 'MATERIAL_NOT_FOUND',
            blueprint: 'BLUEPRINT_NOT_FOUND',
            actor: 'ACTOR_NOT_FOUND',
            level: 'LEVEL_NOT_FOUND',
            sequence: 'SEQUENCE_NOT_FOUND',
            node: 'NODE_NOT_FOUND',
            component: 'COMPONENT_NOT_FOUND',
            variable: 'VARIABLE_NOT_FOUND',
            function: 'FUNCTION_NOT_FOUND',
            track: 'TRACK_NOT_FOUND',
        };

        const errorCode = codeMap[resourceType.toLowerCase()] || 'ASSET_NOT_FOUND';

        return ResponseFactory.error(
            `${resourceType} not found: ${identifier}`,
            errorCode,
            { resourceType, identifier, ...context }
        );
    }

    /**
     * Create an error response for timeout conditions.
     *
     * @param operation - Description of the operation that timed out
     * @param timeoutMs - The timeout duration in milliseconds
     * @param context - Optional additional context
     * @returns Standardized timeout error response
     */
    static timeout(
        operation: string,
        timeoutMs: number,
        context?: Record<string, unknown>
    ): ErrorResponse {
        return ResponseFactory.error(
            `Operation timed out after ${timeoutMs}ms: ${operation}`,
            'TIMEOUT',
            { operation, timeoutMs, ...context }
        );
    }
}
