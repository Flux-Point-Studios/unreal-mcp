/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\tools\python.ts
 *
 * Summary: PythonTools class for executing Python scripts in Unreal Editor.
 * Provides methods to execute Python script files or inline Python code through
 * the MCP automation bridge without requiring manual user intervention.
 *
 * Used by: consolidated-tool-handlers.ts, python-handlers.ts
 * Depends on: AutomationBridge for communication with Unreal Editor
 */

import { AutomationBridge } from '../automation/index.js';
import { Logger } from '../utils/logger.js';

const log = new Logger('PythonTools');

interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: object;
    outputSchema: object;
}

export class PythonTools {
    private automationBridge: AutomationBridge | null = null;

    constructor() { }

    setAutomationBridge(bridge: AutomationBridge) {
        this.automationBridge = bridge;
    }

    /**
     * Execute a Python script file in Unreal Editor.
     * @param scriptPath - Absolute or project-relative path to the Python script file
     * @returns Result of the script execution
     */
    async executeScript(scriptPath: string) {
        if (!this.automationBridge) throw new Error('Automation bridge not set');

        if (!scriptPath || typeof scriptPath !== 'string' || scriptPath.trim().length === 0) {
            return { success: false, error: 'INVALID_ARGUMENT', message: 'scriptPath is required.' };
        }

        log.info(`Executing Python script: ${scriptPath}`);

        return this.automationBridge.sendAutomationRequest('execute_python', {
            action: 'execute_script',
            scriptPath: scriptPath.trim()
        });
    }

    /**
     * Execute inline Python code in Unreal Editor.
     * @param code - Python code to execute
     * @returns Result of the code execution
     */
    async executeCode(code: string) {
        if (!this.automationBridge) throw new Error('Automation bridge not set');

        if (!code || typeof code !== 'string' || code.trim().length === 0) {
            return { success: false, error: 'INVALID_ARGUMENT', message: 'code is required.' };
        }

        log.info(`Executing inline Python code (${code.length} characters)`);

        return this.automationBridge.sendAutomationRequest('execute_python', {
            action: 'execute_code',
            code: code
        });
    }

    /**
     * Get Python environment information from Unreal Editor.
     * @returns Python version and available modules information
     */
    async getPythonInfo() {
        if (!this.automationBridge) throw new Error('Automation bridge not set');

        log.info('Getting Python environment info');

        return this.automationBridge.sendAutomationRequest('execute_python', {
            action: 'get_python_info'
        });
    }
}

export const pythonTools: ToolDefinition = {
    name: 'execute_python',
    description: `Execute Python scripts in Unreal Editor without manual intervention.

Use this tool when you need to:
- Run Python scripts for editor automation
- Execute custom Python code for asset manipulation
- Perform batch operations using Python
- Access Unreal Python API (unreal module)

Supported actions:
- execute_script: Execute a Python script file from disk
- execute_code: Execute inline Python code directly
- get_python_info: Get Python environment information

Example - Execute a script file:
  action: "execute_script"
  scriptPath: "D:/Scripts/my_automation.py"

Example - Execute inline code:
  action: "execute_code"
  code: "import unreal; print(unreal.EditorAssetLibrary.list_assets('/Game/'))"

Note: Unreal Editor must have Python scripting plugin enabled.
The Python environment has access to the 'unreal' module for editor operations.`,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['execute_script', 'execute_code', 'get_python_info'],
                description: 'Action to perform'
            },
            scriptPath: {
                type: 'string',
                description: 'Absolute or project-relative path to Python script file (for execute_script action)'
            },
            code: {
                type: 'string',
                description: 'Python code to execute inline (for execute_code action)'
            }
        },
        required: ['action']
    },
    outputSchema: {
        type: 'object',
        properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            output: {
                type: 'string',
                description: 'Standard output from the Python script/code execution'
            },
            error: {
                type: 'string',
                description: 'Error message if execution failed'
            },
            returnValue: {
                description: 'Return value from the Python execution (if any)'
            },
            pythonVersion: {
                type: 'string',
                description: 'Python version (for get_python_info action)'
            },
            unrealPythonVersion: {
                type: 'string',
                description: 'Unreal Python plugin version (for get_python_info action)'
            }
        }
    }
};
