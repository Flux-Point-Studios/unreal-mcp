
import { AutomationBridge } from '../automation/index.js';
import { Logger } from '../utils/logger.js';

const log = new Logger('InputTools');

interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: object;
    outputSchema: object;
}

// Common valid key names for UE5 Enhanced Input (not exhaustive, but covers primary cases)
const VALID_KEY_NAMES = new Set([
    // Keyboard - Letters
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    // Keyboard - Numbers
    'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    // Keyboard - Function keys
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    // Keyboard - Special
    'SpaceBar', 'Enter', 'Escape', 'Tab', 'BackSpace', 'CapsLock',
    'LeftShift', 'RightShift', 'LeftControl', 'RightControl', 'LeftAlt', 'RightAlt',
    'LeftCommand', 'RightCommand', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
    'Up', 'Down', 'Left', 'Right',
    // Keyboard - Punctuation
    'Semicolon', 'Equals', 'Comma', 'Hyphen', 'Underscore', 'Period', 'Slash', 'Tilde',
    'LeftBracket', 'Backslash', 'RightBracket', 'Apostrophe', 'Quote',
    // Mouse - Buttons
    'LeftMouseButton', 'RightMouseButton', 'MiddleMouseButton', 'ThumbMouseButton', 'ThumbMouseButton2',
    // Mouse - Axes (must be mapped separately, not as composite 2D)
    'MouseX', 'MouseY', 'MouseWheelAxis', 'MouseScrollUp', 'MouseScrollDown',
    // Gamepad - Face Buttons
    'Gamepad_FaceButton_Bottom', 'Gamepad_FaceButton_Right', 'Gamepad_FaceButton_Left', 'Gamepad_FaceButton_Top',
    // Gamepad - Shoulder/Trigger
    'Gamepad_LeftShoulder', 'Gamepad_RightShoulder', 'Gamepad_LeftTrigger', 'Gamepad_RightTrigger',
    'Gamepad_LeftTriggerAxis', 'Gamepad_RightTriggerAxis',
    // Gamepad - Sticks
    'Gamepad_LeftThumbstick', 'Gamepad_RightThumbstick',
    'Gamepad_LeftStick_Up', 'Gamepad_LeftStick_Down', 'Gamepad_LeftStick_Left', 'Gamepad_LeftStick_Right',
    'Gamepad_RightStick_Up', 'Gamepad_RightStick_Down', 'Gamepad_RightStick_Left', 'Gamepad_RightStick_Right',
    // Gamepad - D-Pad
    'Gamepad_DPad_Up', 'Gamepad_DPad_Down', 'Gamepad_DPad_Left', 'Gamepad_DPad_Right',
    // Gamepad - Special
    'Gamepad_Special_Left', 'Gamepad_Special_Right'
]);

export class InputTools {
    private automationBridge: AutomationBridge | null = null;

    constructor() { }

    setAutomationBridge(bridge: AutomationBridge) {
        this.automationBridge = bridge;
    }

    async createInputAction(name: string, path: string) {
        if (!this.automationBridge) throw new Error('Automation bridge not set');
        return this.automationBridge.sendAutomationRequest('manage_input', {
            action: 'create_input_action',
            name,
            path
        });
    }

    async createInputMappingContext(name: string, path: string) {
        if (!this.automationBridge) throw new Error('Automation bridge not set');
        return this.automationBridge.sendAutomationRequest('manage_input', {
            action: 'create_input_mapping_context',
            name,
            path
        });
    }

    /**
     * Add a key mapping to an Input Mapping Context.
     * @param contextPath - Path to the Input Mapping Context asset
     * @param actionPath - Path to the Input Action asset
     * @param key - Key name (e.g., "W", "S", "SpaceBar")
     * @param modifiers - Optional array of modifiers to apply. Can be:
     *                    - String: "Negate", "Scalar", "DeadZone", "Swizzle"
     *                    - Object: { type: "Negate" } or { type: "Scalar", value: -1 }
     */
    async addMapping(contextPath: string, actionPath: string, key: string, modifiers?: (string | { type: string; value?: number })[]) {
        if (!this.automationBridge) throw new Error('Automation bridge not set');

        // Validate key name
        if (!key || typeof key !== 'string' || key.trim().length === 0) {
            return { success: false, error: 'INVALID_ARGUMENT', message: 'Key name is required.' };
        }

        const trimmedKey = key.trim();

        // Check for common mistakes (composite 2D axis names)
        if (trimmedKey === 'MouseXY2D' || trimmedKey === 'Mouse2D' || trimmedKey === 'MouseXY') {
            return {
                success: false,
                error: 'INVALID_ARGUMENT',
                message: `Invalid key name '${trimmedKey}'. For mouse axis input, use separate mappings with 'MouseX' and 'MouseY' keys instead of composite 2D axis names.`
            };
        }

        // Warn if key is not in our known list (but still attempt the mapping)
        if (!VALID_KEY_NAMES.has(trimmedKey)) {
            log.warn(`Key '${trimmedKey}' is not in the standard key list. Attempting mapping anyway.`);
        }

        const payload: Record<string, unknown> = {
            action: 'add_mapping',
            contextPath,
            actionPath,
            key: trimmedKey
        };

        // Add modifiers if provided
        if (modifiers && Array.isArray(modifiers) && modifiers.length > 0) {
            payload.modifiers = modifiers;
        }

        return this.automationBridge.sendAutomationRequest('manage_input', payload);
    }

    async removeMapping(contextPath: string, actionPath: string) {
        if (!this.automationBridge) throw new Error('Automation bridge not set');
        return this.automationBridge.sendAutomationRequest('manage_input', {
            action: 'remove_mapping',
            contextPath,
            actionPath
        });
    }

    /**
     * Inject input directly into the Enhanced Input subsystem using UE5's InjectInputForAction API.
     * This bypasses Slate/viewport key events and injects values directly into the input system,
     * avoiding "stuck key" issues that occur with simulate_input.
     *
     * @param inputActionPath - Path to the Input Action asset (e.g., '/Game/Input/Actions/IA_MoveForward')
     * @param value - The input value. Can be:
     *                - boolean: for digital actions (true = 1.0, false = 0.0)
     *                - number: for 1D axis actions (-1.0 to 1.0)
     *                - {x, y}: for 2D axis actions (e.g., movement)
     *                - {x, y, z}: for 3D axis actions
     * @param modifiers - Optional array of modifier class names to apply
     * @param triggers - Optional array of trigger class names to apply
     */
    async injectInputForAction(
        inputActionPath: string,
        value: boolean | number | { x: number; y: number } | { x: number; y: number; z: number },
        modifiers?: string[],
        triggers?: string[]
    ) {
        if (!this.automationBridge) throw new Error('Automation bridge not set');

        if (!inputActionPath || typeof inputActionPath !== 'string' || inputActionPath.trim().length === 0) {
            return { success: false, error: 'INVALID_ARGUMENT', message: 'inputActionPath is required.' };
        }

        // Workaround: Negative numbers as plain values get corrupted in JSON parsing.
        // Wrap negative numbers in object format {x: value, y: 0} which preserves the sign.
        // The C++ side handles {x: value} objects and extracts just the x component for 1D axes.
        let processedValue: boolean | number | { x: number; y: number } | { x: number; y: number; z: number } = value;
        if (typeof value === 'number' && value < 0) {
            processedValue = { x: value, y: 0 };
        }

        const payload: Record<string, unknown> = {
            action: 'inject_input_for_action',
            inputActionPath: inputActionPath.trim(),
            value: processedValue
        };

        if (modifiers && Array.isArray(modifiers) && modifiers.length > 0) {
            payload.modifiers = modifiers;
        }

        if (triggers && Array.isArray(triggers) && triggers.length > 0) {
            payload.triggers = triggers;
        }

        return this.automationBridge.sendAutomationRequest('manage_input', payload);
    }

    /**
     * Clear all previously injected inputs by injecting zero values.
     * This ensures no "stuck" input states remain in the Enhanced Input system.
     *
     * @param inputActionPaths - Optional array of specific action paths to clear.
     *                           If not provided, clears all tracked injected actions.
     */
    async clearInjectedInputs(inputActionPaths?: string[]) {
        if (!this.automationBridge) throw new Error('Automation bridge not set');

        const payload: Record<string, unknown> = {
            action: 'clear_injected_inputs'
        };

        if (inputActionPaths && Array.isArray(inputActionPaths) && inputActionPaths.length > 0) {
            payload.inputActionPaths = inputActionPaths;
        }

        return this.automationBridge.sendAutomationRequest('manage_input', payload);
    }

    /**
     * Get the current status of injected inputs including which actions are currently being injected.
     */
    async getInjectedInputStatus() {
        if (!this.automationBridge) throw new Error('Automation bridge not set');
        return this.automationBridge.sendAutomationRequest('manage_input', {
            action: 'get_injected_input_status'
        });
    }
}


export const inputTools: ToolDefinition = {
    name: 'manage_input',
    description: `Enhanced Input management and runtime input injection.

Use it when you need to:
- create Input Actions (IA_*)
- create Input Mapping Contexts (IMC_*)
- bind keys to actions in a mapping context with optional modifiers
- inject input values directly into the Enhanced Input subsystem (for testing/automation)
- clear injected inputs to prevent "stuck key" issues

Supported actions:
- create_input_action: Create a UInputAction asset.
- create_input_mapping_context: Create a UInputMappingContext asset.
- add_mapping: Add a key mapping to a context with optional modifiers (Negate, Scalar, DeadZone, Swizzle).
- remove_mapping: Remove a mapping from a context.
- inject_input_for_action: Inject input values directly into the Enhanced Input subsystem using UE5's InjectInputForAction API. This bypasses Slate events and avoids "stuck key" issues.
- clear_injected_inputs: Clear all or specific injected inputs by setting them to zero.
- get_injected_input_status: Get the current status of injected inputs.

Example - Adding S key with Negate modifier for backward movement:
  action: "add_mapping"
  contextPath: "/Game/Input/IMC_Default"
  actionPath: "/Game/Input/Actions/IA_MoveForward"
  key: "S"
  modifiers: ["Negate"]

Example - Injecting movement input directly (avoids stuck key issues):
  action: "inject_input_for_action"
  inputActionPath: "/Game/Input/Actions/IA_Move"
  value: { "x": 1.0, "y": 0.0 }

Example - Clearing injected inputs:
  action: "clear_injected_inputs"
  inputActionPaths: ["/Game/Input/Actions/IA_Move"]`,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: [
                    'create_input_action',
                    'create_input_mapping_context',
                    'add_mapping',
                    'remove_mapping',
                    'inject_input_for_action',
                    'clear_injected_inputs',
                    'get_injected_input_status'
                ],
                description: 'Action to perform'
            },
            name: { type: 'string', description: 'Name of the asset (for creation).' },
            path: { type: 'string', description: 'Path to save the asset (e.g. /Game/Input).' },
            contextPath: { type: 'string', description: 'Path to the Input Mapping Context.' },
            actionPath: { type: 'string', description: 'Path to the Input Action.' },
            key: { type: 'string', description: 'Key name (e.g. "SpaceBar", "W", "Gamepad_FaceButton_Bottom").' },
            modifiers: {
                type: 'array',
                description: 'Optional modifiers for the key mapping. Supported: "Negate", "Scalar", "DeadZone", "Swizzle". Can also use objects like {"type": "Scalar", "value": 0.5}.',
                items: {
                    oneOf: [
                        { type: 'string', enum: ['Negate', 'Scalar', 'DeadZone', 'Swizzle'] },
                        {
                            type: 'object',
                            properties: {
                                type: { type: 'string', enum: ['Negate', 'Scalar', 'DeadZone', 'Swizzle'] },
                                value: { type: 'number', description: 'Value for Scalar or DeadZone modifiers' }
                            },
                            required: ['type']
                        }
                    ]
                }
            },
            inputActionPath: {
                type: 'string',
                description: 'Path to the Input Action asset for injection (e.g. "/Game/Input/Actions/IA_Move").'
            },
            value: {
                description: 'Input value for injection. Can be: boolean (digital), number (1D axis), {x,y} (2D axis), or {x,y,z} (3D axis).',
                oneOf: [
                    { type: 'boolean' },
                    { type: 'number' },
                    {
                        type: 'object',
                        properties: {
                            x: { type: 'number' },
                            y: { type: 'number' }
                        },
                        required: ['x', 'y']
                    },
                    {
                        type: 'object',
                        properties: {
                            x: { type: 'number' },
                            y: { type: 'number' },
                            z: { type: 'number' }
                        },
                        required: ['x', 'y', 'z']
                    }
                ]
            },
            inputActionPaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of Input Action paths to clear (for clear_injected_inputs action).'
            },
            triggers: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional trigger class names to apply during input injection.'
            }
        },
        required: ['action']
    },
    outputSchema: {
        type: 'object',
        properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            assetPath: { type: 'string' },
            modifierCount: { type: 'number' },
            injectedActions: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of currently injected action paths (for get_injected_input_status)'
            },
            clearedCount: { type: 'number', description: 'Number of actions cleared (for clear_injected_inputs)' }
        }
    }
};
