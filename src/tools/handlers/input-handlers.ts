import { ITools } from '../../types/tool-interfaces.js';
import { cleanObject } from '../../utils/safe-json.js';
import { ResponseFactory } from '../../utils/response-factory.js';
import type { HandlerArgs, InputArgs } from '../../types/handler-types.js';
import { InputTools } from '../input.js';

export async function handleInputTools(
    action: string,
    args: HandlerArgs,
    tools: ITools
): Promise<Record<string, unknown>> {
    const argsTyped = args as InputArgs;
    const inputTools = tools.inputTools as InputTools;
    if (!inputTools) {
        return ResponseFactory.error('Input tools not available');
    }

    switch (action) {
        case 'create_input_action':
            return cleanObject(await inputTools.createInputAction(argsTyped.name || '', argsTyped.path || '')) as Record<string, unknown>;
        case 'create_input_mapping_context':
            return cleanObject(await inputTools.createInputMappingContext(argsTyped.name || '', argsTyped.path || '')) as Record<string, unknown>;
        case 'add_mapping':
            return cleanObject(await inputTools.addMapping(
                argsTyped.contextPath ?? '',
                argsTyped.actionPath ?? '',
                argsTyped.key ?? '',
                argsTyped.modifiers as (string | { type: string; value?: number })[] | undefined
            )) as Record<string, unknown>;
        case 'remove_mapping':
            return cleanObject(await inputTools.removeMapping(argsTyped.contextPath ?? '', argsTyped.actionPath ?? '')) as Record<string, unknown>;
        case 'inject_input_for_action':
            return cleanObject(await inputTools.injectInputForAction(
                argsTyped.inputActionPath ?? '',
                argsTyped.value as boolean | number | { x: number; y: number } | { x: number; y: number; z: number },
                argsTyped.modifiers as string[] | undefined,
                argsTyped.triggers as string[] | undefined
            )) as Record<string, unknown>;
        case 'clear_injected_inputs':
            return cleanObject(await inputTools.clearInjectedInputs(
                argsTyped.inputActionPaths as string[] | undefined
            )) as Record<string, unknown>;
        case 'get_injected_input_status':
            return cleanObject(await inputTools.getInjectedInputStatus()) as Record<string, unknown>;
        default:
            return ResponseFactory.error(`Unknown input action: ${action}`);
    }
}
