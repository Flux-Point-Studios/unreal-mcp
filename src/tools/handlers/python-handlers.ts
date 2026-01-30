/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\handlers\python-handlers.ts
 *
 * Summary: Handler for Python tool actions. Routes execute_python tool calls
 * to the appropriate PythonTools methods based on the requested action.
 *
 * Used by: consolidated-tool-handlers.ts
 * Depends on: PythonTools class, ITools interface, ResponseFactory
 */

import { ITools } from '../../types/tool-interfaces.js';
import { cleanObject } from '../../utils/safe-json.js';
import { ResponseFactory } from '../../utils/response-factory.js';
import type { HandlerArgs } from '../../types/handler-types.js';
import { PythonTools } from '../python.js';

/**
 * Arguments specific to Python tool operations
 */
export interface PythonArgs extends HandlerArgs {
    /** Path to Python script file (for execute_script action) */
    scriptPath?: string;
    /** Inline Python code to execute (for execute_code action) */
    code?: string;
}

/**
 * Handle Python tool actions
 * @param action - The specific action to perform (execute_script, execute_code, get_python_info)
 * @param args - Arguments for the action
 * @param tools - ITools interface providing access to tool instances
 * @returns Result of the Python operation
 */
export async function handlePythonTools(
    action: string,
    args: HandlerArgs,
    tools: ITools
): Promise<Record<string, unknown>> {
    const argsTyped = args as PythonArgs;
    const pythonTools = tools.pythonTools as PythonTools | undefined;

    if (!pythonTools) {
        return ResponseFactory.error('Python tools not available');
    }

    switch (action) {
        case 'execute_script':
            if (!argsTyped.scriptPath) {
                return ResponseFactory.error('scriptPath is required for execute_script action');
            }
            return cleanObject(await pythonTools.executeScript(argsTyped.scriptPath)) as Record<string, unknown>;

        case 'execute_code':
            if (!argsTyped.code) {
                return ResponseFactory.error('code is required for execute_code action');
            }
            return cleanObject(await pythonTools.executeCode(argsTyped.code)) as Record<string, unknown>;

        case 'get_python_info':
            return cleanObject(await pythonTools.getPythonInfo()) as Record<string, unknown>;

        default:
            return ResponseFactory.error(`Unknown Python action: ${action}`);
    }
}
