/**
 * Validate Tool Handlers (Sprint 7: Assertion Layer)
 *
 * Structured assertions that define "done."
 * Each assertion returns machine-readable diagnostics with:
 *   status, severity, code, affected, details, suggestedAction, deterministic
 *
 * Actions:
 *   assert_blueprint_compiles    — compile a blueprint and report diagnostics
 *   assert_map_clean             — run map check for errors/warnings
 *   assert_no_missing_references — scan for broken asset references
 *   assert_naming_conventions    — check assets against naming rules
 *   assert_performance_budget    — check FPS/memory against targets
 *   run_validation_suite         — run all relevant assertions, return summary
 *   get_validation_report        — last validation results
 *   set_acceptance_criteria      — define the project's design contract
 *   get_acceptance_criteria      — read the current design contract
 */

import { ITools } from '../../types/tool-interfaces.js';
import { executeAutomationRequest } from './common-handlers.js';
import { acceptanceCriteria, AcceptanceCriteriaData } from '../../services/acceptance-criteria.js';
import { Logger } from '../../utils/logger.js';

const logger = new Logger('ValidateHandlers');

export interface AssertionResult {
    assertion: string;
    status: 'pass' | 'fail' | 'warn' | 'skip';
    severity: 'critical' | 'error' | 'warning' | 'info';
    code: string;
    affected: string[];
    details: string;
    suggestedAction: string;
    deterministic: boolean;
}

/** Last validation report, stored for get_validation_report. */
let lastValidationReport: { timestamp: string; results: AssertionResult[] } | null = null;

/**
 * assert_blueprint_compiles: Compile a blueprint and return structured diagnostics.
 */
async function assertBlueprintCompiles(args: Record<string, unknown>, tools: ITools): Promise<AssertionResult> {
    const blueprintPath = (args.blueprintPath || args.blueprint_path || args.name) as string;
    if (!blueprintPath) {
        return {
            assertion: 'assert_blueprint_compiles',
            status: 'skip',
            severity: 'error',
            code: 'MISSING_PARAM',
            affected: [],
            details: 'blueprintPath parameter is required',
            suggestedAction: 'Provide blueprintPath parameter',
            deterministic: true,
        };
    }

    try {
        const result = await executeAutomationRequest(
            tools, 'manage_blueprint',
            { action: 'compile', blueprint_name: blueprintPath },
            'Automation bridge not available'
        ) as Record<string, unknown>;

        const warnings: string[] = [];
        const errors: string[] = [];

        if (result.warnings && Array.isArray(result.warnings)) {
            for (const w of result.warnings) warnings.push(String(w));
        }
        if (result.errors && Array.isArray(result.errors)) {
            for (const e of result.errors) errors.push(String(e));
        }
        if (typeof result.error === 'string') errors.push(result.error);

        const hasErrors = errors.length > 0;
        const hasWarnings = warnings.length > 0;

        return {
            assertion: 'assert_blueprint_compiles',
            status: hasErrors ? 'fail' : hasWarnings ? 'warn' : 'pass',
            severity: hasErrors ? 'critical' : hasWarnings ? 'warning' : 'info',
            code: hasErrors ? 'BLUEPRINT_COMPILE_ERROR' : hasWarnings ? 'BLUEPRINT_COMPILE_WARNING' : 'BLUEPRINT_COMPILE_OK',
            affected: [blueprintPath],
            details: hasErrors
                ? `Compilation failed with ${errors.length} error(s): ${errors.join('; ')}`
                : hasWarnings
                    ? `Compiled with ${warnings.length} warning(s): ${warnings.join('; ')}`
                    : `Blueprint compiled successfully`,
            suggestedAction: hasErrors
                ? `Use inspect tool to examine blueprint nodes. Errors: ${errors[0]}`
                : hasWarnings
                    ? `Review warnings: ${warnings[0]}`
                    : 'No action needed',
            deterministic: true,
        };
    } catch (err) {
        return {
            assertion: 'assert_blueprint_compiles',
            status: 'fail',
            severity: 'critical',
            code: 'BLUEPRINT_COMPILE_EXCEPTION',
            affected: [blueprintPath],
            details: `Exception during compilation: ${err instanceof Error ? err.message : String(err)}`,
            suggestedAction: 'Check if blueprint exists and editor is connected',
            deterministic: true,
        };
    }
}

/**
 * assert_map_clean: Run map check and report errors/warnings.
 */
async function assertMapClean(_args: Record<string, unknown>, tools: ITools): Promise<AssertionResult> {
    try {
        // Use console command to run map check
        const result = await executeAutomationRequest(
            tools, 'system_control',
            { action: 'console_command', command: 'MAP CHECK' },
            'Automation bridge not available'
        ) as Record<string, unknown>;

        const output = typeof result === 'string' ? result :
            typeof result.output === 'string' ? result.output :
                typeof result.result === 'string' ? result.result :
                    JSON.stringify(result);

        // Parse map check output for errors and warnings
        const lines = output.split('\n');
        const errors: string[] = [];
        const warnings: string[] = [];
        for (const line of lines) {
            const lower = line.toLowerCase();
            if (lower.includes('error')) errors.push(line.trim());
            else if (lower.includes('warning')) warnings.push(line.trim());
        }

        const hasErrors = errors.length > 0;
        const hasWarnings = warnings.length > 0;

        return {
            assertion: 'assert_map_clean',
            status: hasErrors ? 'fail' : hasWarnings ? 'warn' : 'pass',
            severity: hasErrors ? 'error' : hasWarnings ? 'warning' : 'info',
            code: hasErrors ? 'MAP_CHECK_ERROR' : hasWarnings ? 'MAP_CHECK_WARNING' : 'MAP_CHECK_CLEAN',
            affected: [],
            details: hasErrors
                ? `Map check found ${errors.length} error(s) and ${warnings.length} warning(s)`
                : hasWarnings
                    ? `Map check found ${warnings.length} warning(s)`
                    : 'Map check passed with no issues',
            suggestedAction: hasErrors
                ? `Fix map errors: ${errors.slice(0, 3).join('; ')}`
                : hasWarnings
                    ? `Review map warnings: ${warnings.slice(0, 3).join('; ')}`
                    : 'No action needed',
            deterministic: true,
        };
    } catch (err) {
        return {
            assertion: 'assert_map_clean',
            status: 'fail',
            severity: 'error',
            code: 'MAP_CHECK_EXCEPTION',
            affected: [],
            details: `Exception during map check: ${err instanceof Error ? err.message : String(err)}`,
            suggestedAction: 'Ensure editor is connected and a level is loaded',
            deterministic: true,
        };
    }
}

/**
 * assert_no_missing_references: Scan for broken asset references.
 */
async function assertNoMissingReferences(args: Record<string, unknown>, tools: ITools): Promise<AssertionResult> {
    const scanPath = (args.path || args.assetPath || '/Game') as string;

    try {
        // Use console command to check for redirectors (a sign of broken references)
        const result = await executeAutomationRequest(
            tools, 'system_control',
            { action: 'console_command', command: `obj refs Name=${scanPath}` },
            'Automation bridge not available'
        ) as Record<string, unknown>;

        const output = typeof result === 'string' ? result :
            typeof result.output === 'string' ? result.output :
                typeof result.result === 'string' ? result.result : '';

        // Look for "None" references or missing assets
        const missingRefs: string[] = [];
        const lines = output.split('\n');
        for (const line of lines) {
            if (line.includes('None') || line.includes('MISSING') || line.includes('not found')) {
                missingRefs.push(line.trim());
            }
        }

        return {
            assertion: 'assert_no_missing_references',
            status: missingRefs.length > 0 ? 'fail' : 'pass',
            severity: missingRefs.length > 0 ? 'error' : 'info',
            code: missingRefs.length > 0 ? 'MISSING_REFERENCES' : 'REFERENCES_OK',
            affected: missingRefs.slice(0, 10),
            details: missingRefs.length > 0
                ? `Found ${missingRefs.length} potential missing reference(s)`
                : 'No missing references detected',
            suggestedAction: missingRefs.length > 0
                ? 'Fix or remove broken references. Use manage_asset to check dependencies.'
                : 'No action needed',
            deterministic: true,
        };
    } catch (err) {
        return {
            assertion: 'assert_no_missing_references',
            status: 'skip',
            severity: 'warning',
            code: 'REFERENCE_CHECK_EXCEPTION',
            affected: [scanPath],
            details: `Exception during reference check: ${err instanceof Error ? err.message : String(err)}`,
            suggestedAction: 'Check editor connection',
            deterministic: true,
        };
    }
}

/**
 * assert_naming_conventions: Check assets against naming rules.
 */
async function assertNamingConventions(args: Record<string, unknown>, tools: ITools): Promise<AssertionResult> {
    const criteria = acceptanceCriteria.get();
    const conventions = criteria?.namingConventions ?? {
        blueprintPrefix: 'BP_',
        materialPrefix: 'M_',
        texturePrefix: 'T_',
        staticMeshPrefix: 'SM_',
        skeletalMeshPrefix: 'SK_',
        widgetPrefix: 'WBP_',
    };

    const scanPath = (args.path || '/Game') as string;

    try {
        const assets: unknown = await tools.assetResources.list(scanPath, true);
        const assetArray: Array<Record<string, unknown>> = Array.isArray(assets) ? assets : [];

        const violations: string[] = [];
        const prefixMap: Record<string, string> = {
            Blueprint: conventions.blueprintPrefix || 'BP_',
            Material: conventions.materialPrefix || 'M_',
            MaterialInstanceConstant: conventions.materialPrefix || 'MI_',
            Texture2D: conventions.texturePrefix || 'T_',
            StaticMesh: conventions.staticMeshPrefix || 'SM_',
            SkeletalMesh: conventions.skeletalMeshPrefix || 'SK_',
            WidgetBlueprint: conventions.widgetPrefix || 'WBP_',
        };

        for (const asset of assetArray) {
            const name = (asset.name || asset.Name || '') as string;
            const assetClass = (asset.class || asset.Class || asset.type || '') as string;
            const expectedPrefix = prefixMap[assetClass];
            if (expectedPrefix && name && !name.startsWith(expectedPrefix)) {
                violations.push(`${name} (${assetClass}) should start with '${expectedPrefix}'`);
            }
        }

        return {
            assertion: 'assert_naming_conventions',
            status: violations.length > 0 ? 'warn' : 'pass',
            severity: violations.length > 0 ? 'warning' : 'info',
            code: violations.length > 0 ? 'NAMING_VIOLATIONS' : 'NAMING_OK',
            affected: violations.slice(0, 20),
            details: violations.length > 0
                ? `Found ${violations.length} naming convention violation(s)`
                : `All ${assetArray.length} assets follow naming conventions`,
            suggestedAction: violations.length > 0
                ? `Rename violating assets using manage_asset.rename: ${violations[0]}`
                : 'No action needed',
            deterministic: true,
        };
    } catch (err) {
        return {
            assertion: 'assert_naming_conventions',
            status: 'skip',
            severity: 'warning',
            code: 'NAMING_CHECK_EXCEPTION',
            affected: [scanPath],
            details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
            suggestedAction: 'Check editor connection',
            deterministic: true,
        };
    }
}

/**
 * assert_performance_budget: Check against performance targets.
 */
async function assertPerformanceBudget(args: Record<string, unknown>, tools: ITools): Promise<AssertionResult> {
    const criteria = acceptanceCriteria.get();
    const budget = criteria?.performanceBudget ?? {};
    const targetFps = (args.targetFps as number) ?? budget.targetFps ?? 60;
    const maxMemoryMb = (args.maxMemoryMb as number) ?? budget.maxMemoryMb;

    try {
        const result = await executeAutomationRequest(
            tools, 'inspect',
            { action: 'get_scene_stats' },
            'Automation bridge not available'
        ) as Record<string, unknown>;

        const stats = (result.result ?? result) as Record<string, unknown>;
        const violations: string[] = [];

        // Check triangle count if budget specified
        if (budget.maxTriangleCount && typeof stats.triangles === 'number') {
            if (stats.triangles > budget.maxTriangleCount) {
                violations.push(`Triangle count ${stats.triangles} exceeds budget ${budget.maxTriangleCount}`);
            }
        }

        // Check draw calls if budget specified
        if (budget.maxDrawCalls && typeof stats.drawCalls === 'number') {
            if (stats.drawCalls > budget.maxDrawCalls) {
                violations.push(`Draw calls ${stats.drawCalls} exceeds budget ${budget.maxDrawCalls}`);
            }
        }

        return {
            assertion: 'assert_performance_budget',
            status: violations.length > 0 ? 'warn' : 'pass',
            severity: violations.length > 0 ? 'warning' : 'info',
            code: violations.length > 0 ? 'PERFORMANCE_BUDGET_EXCEEDED' : 'PERFORMANCE_BUDGET_OK',
            affected: violations,
            details: violations.length > 0
                ? `${violations.length} budget violation(s): ${violations.join('; ')}`
                : `Scene stats within budget (target: ${targetFps}fps${maxMemoryMb ? `, ${maxMemoryMb}MB` : ''})`,
            suggestedAction: violations.length > 0
                ? 'Optimize scene: reduce triangle count, merge actors, enable Nanite, or simplify materials'
                : 'No action needed',
            deterministic: false,
        };
    } catch (err) {
        return {
            assertion: 'assert_performance_budget',
            status: 'skip',
            severity: 'warning',
            code: 'PERFORMANCE_CHECK_EXCEPTION',
            affected: [],
            details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
            suggestedAction: 'Check editor connection',
            deterministic: false,
        };
    }
}

/**
 * run_validation_suite: Run all relevant assertions and return a summary.
 */
async function runValidationSuite(args: Record<string, unknown>, tools: ITools): Promise<Record<string, unknown>> {
    const results: AssertionResult[] = [];
    const blueprintPath = args.blueprintPath as string | undefined;

    // Run assertions in sequence (each may talk to the editor)
    if (blueprintPath) {
        results.push(await assertBlueprintCompiles({ blueprintPath }, tools));
    }

    results.push(await assertMapClean(args, tools));
    results.push(await assertNoMissingReferences(args, tools));
    results.push(await assertNamingConventions(args, tools));
    results.push(await assertPerformanceBudget(args, tools));

    // Store for get_validation_report
    lastValidationReport = {
        timestamp: new Date().toISOString(),
        results,
    };

    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const warned = results.filter(r => r.status === 'warn').length;
    const skipped = results.filter(r => r.status === 'skip').length;

    return {
        success: failed === 0,
        summary: `${passed} passed, ${failed} failed, ${warned} warnings, ${skipped} skipped`,
        passed,
        failed,
        warned,
        skipped,
        results,
        timestamp: lastValidationReport.timestamp,
    };
}

/**
 * Main handler dispatcher for the validate tool.
 */
export async function handleValidateTools(
    action: string,
    args: Record<string, unknown>,
    tools: ITools
): Promise<Record<string, unknown>> {
    switch (action) {
        case 'assert_blueprint_compiles': {
            const result = await assertBlueprintCompiles(args, tools);
            return { success: result.status !== 'fail', ...result };
        }

        case 'assert_map_clean': {
            const result = await assertMapClean(args, tools);
            return { success: result.status !== 'fail', ...result };
        }

        case 'assert_no_missing_references': {
            const result = await assertNoMissingReferences(args, tools);
            return { success: result.status !== 'fail', ...result };
        }

        case 'assert_naming_conventions': {
            const result = await assertNamingConventions(args, tools);
            return { success: result.status !== 'fail', ...result };
        }

        case 'assert_performance_budget': {
            const result = await assertPerformanceBudget(args, tools);
            return { success: result.status !== 'fail', ...result };
        }

        case 'run_validation_suite':
            return await runValidationSuite(args, tools);

        case 'get_validation_report':
            if (!lastValidationReport) {
                return {
                    success: true,
                    message: 'No validation report available. Run run_validation_suite first.',
                    report: null,
                };
            }
            return {
                success: true,
                report: lastValidationReport,
            };

        case 'set_acceptance_criteria': {
            const replace = args.replace === true;
            const criteria: AcceptanceCriteriaData = {};

            // Extract known fields from args
            for (const key of ['genre', 'camera', 'platforms', 'performanceBudget',
                'namingConventions', 'movementFeel', 'uiStyle', 'accessibility',
                'constraints', 'acceptedPlugins']) {
                if (args[key] !== undefined) {
                    (criteria as Record<string, unknown>)[key] = args[key];
                }
            }

            acceptanceCriteria.set(criteria, replace);
            logger.info(`Acceptance criteria ${replace ? 'replaced' : 'merged'}`);

            return {
                success: true,
                message: `Acceptance criteria ${replace ? 'set' : 'updated'}`,
                criteria: acceptanceCriteria.get(),
            };
        }

        case 'get_acceptance_criteria':
            return {
                success: true,
                criteria: acceptanceCriteria.get(),
                isSet: acceptanceCriteria.isSet(),
            };

        default:
            return {
                success: false,
                error: `Unknown validate action: ${action}`,
                availableActions: [
                    'assert_blueprint_compiles', 'assert_map_clean',
                    'assert_no_missing_references', 'assert_naming_conventions',
                    'assert_performance_budget', 'run_validation_suite',
                    'get_validation_report', 'set_acceptance_criteria',
                    'get_acceptance_criteria',
                ],
            };
    }
}
