/**
 * Test Automation Handlers
 *
 * Location: src/tools/handlers/test-handlers.ts
 *
 * Exposes Unreal Engine's built-in Automation Testing Framework (Gauntlet) via
 * MCP so that AI agents can discover, run, and inspect automated tests without
 * leaving the conversation. All communication happens through the existing
 * console-command pathway provided by the automation bridge -- no C++ plugin
 * changes are required.
 *
 * Supported actions:
 *   - list_tests      : List available automation tests, optionally filtered.
 *   - run_test        : Execute a single test by its full hierarchical name.
 *   - run_all_tests   : Execute every registered automation test.
 *   - run_tests_by_filter : Execute tests whose names match a filter pattern.
 *   - get_test_results : Retrieve the most recent automation test report.
 *
 * Used by:
 *   - consolidated-tool-handlers.ts  (registered as 'manage_tests')
 *   - consolidated-tool-definitions.ts (schema definition for 'manage_tests')
 *
 * Dependencies:
 *   - common-handlers.ts  (executeAutomationRequest helper)
 *   - tool-interfaces.ts  (ITools interface)
 *   - logger.ts           (structured logging)
 */

import { ITools } from '../../types/tool-interfaces.js';
import { executeAutomationRequest } from './common-handlers.js';
import { Logger } from '../../utils/logger.js';

const log = new Logger('TestHandlers');

type HandlerArgs = Record<string, unknown>;

/**
 * Optional progress reporter that may be attached to the tools object by the
 * MCP server when streaming progress tokens are available.
 */
interface ProgressReporter {
  report: (current: number, total: number, message?: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Route an incoming manage_tests action to the appropriate handler function.
 *
 * @param action - One of the supported test actions (list_tests, run_test, etc.)
 * @param args   - Caller-supplied arguments (test_name, filter, etc.)
 * @param tools  - MCP tools interface providing access to the automation bridge
 * @returns A result object with success/failure status and relevant data
 */
export async function handleTestTools(
  action: string,
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  log.info(`Test action requested: ${action}`);

  switch (action) {
    case 'list_tests':
      return await listTests(args, tools);
    case 'run_test':
      return await runTest(args, tools);
    case 'run_all_tests':
      return await runAllTests(args, tools);
    case 'run_tests_by_filter':
      return await runTestsByFilter(args, tools);
    case 'get_test_results':
      return await getTestResults(args, tools);
    default:
      log.warn(`Unknown test action received: ${action}`);
      return { success: false, error: `Unknown test action: ${action}` };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract a ProgressReporter from the tools object if available.
 */
function getProgressReporter(tools: ITools): ProgressReporter | undefined {
  const toolsRecord = tools as unknown as Record<string, unknown>;
  const reporter = toolsRecord.progressReporter as ProgressReporter | undefined;
  if (reporter && typeof reporter.report === 'function') {
    return reporter;
  }
  return undefined;
}

/**
 * Execute a UE console command via the existing system_control / console_command
 * pathway and return the raw result.
 *
 * @param tools   - MCP tools interface
 * @param command - The console command string to execute (e.g. "Automation List")
 * @param errorCtx - Human-readable context for error messages
 */
async function executeConsoleCommand(
  tools: ITools,
  command: string,
  errorCtx: string
): Promise<Record<string, unknown>> {
  const result = await executeAutomationRequest(tools, 'system_control', {
    action: 'console_command',
    command
  }, errorCtx);

  // Normalise to Record<string, unknown> regardless of what the bridge returns
  if (result && typeof result === 'object') {
    return result as Record<string, unknown>;
  }
  return { output: String(result ?? '') };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Discover available automation tests. Sends `Automation List` to UE and
 * parses the line-delimited output into an array.
 *
 * @param args.filter - Optional substring filter applied to test names
 */
async function listTests(
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const filter = args.filter as string | undefined;

  try {
    const result = await executeConsoleCommand(
      tools,
      'Automation List',
      'Failed to list automation tests'
    );

    const output = (result.output || result.result || '') as string;

    // Parse test names from the line-delimited console output
    let tests = output
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);

    if (filter) {
      const filterLower = filter.toLowerCase();
      tests = tests.filter((t: string) => t.toLowerCase().includes(filterLower));
    }

    log.info(`Listed ${tests.length} tests${filter ? ` (filter: "${filter}")` : ''}`);

    return {
      success: true,
      action: 'list_tests',
      filter: filter || null,
      testCount: tests.length,
      tests,
      message: `Found ${tests.length} tests${filter ? ` matching '${filter}'` : ''}`
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`list_tests failed: ${errorMsg}`);
    return {
      success: false,
      action: 'list_tests',
      error: errorMsg
    };
  }
}

/**
 * Execute a single automation test by its full hierarchical name
 * (e.g. "Project.Gameplay.Character.Movement"). Waits briefly for execution,
 * then retrieves the report.
 *
 * @param args.test_name - Full test name (required)
 */
async function runTest(
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const testName = args.test_name as string;
  if (!testName) {
    return { success: false, action: 'run_test', error: 'test_name is required' };
  }

  const progress = getProgressReporter(tools);

  try {
    await progress?.report(1, 3, `Running test: ${testName}...`);

    const result = await executeConsoleCommand(
      tools,
      `Automation RunTests ${testName}`,
      `Failed to run test: ${testName}`
    );

    await progress?.report(2, 3, 'Collecting results...');

    // Allow UE time to finish executing the test before requesting the report
    await new Promise(resolve => setTimeout(resolve, 2000));

    const reportResult = await executeConsoleCommand(
      tools,
      'Automation Report',
      'Failed to get test report'
    );

    await progress?.report(3, 3, 'Test complete');

    log.info(`Test '${testName}' execution completed`);

    return {
      success: true,
      action: 'run_test',
      testName,
      executionResult: result,
      report: reportResult,
      message: `Test '${testName}' execution completed. Check report for details.`
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`run_test '${testName}' failed: ${errorMsg}`);
    return {
      success: false,
      action: 'run_test',
      testName,
      error: errorMsg
    };
  }
}

/**
 * Execute all registered automation tests. Uses `Automation RunAll` and waits
 * a longer period before collecting results since this may involve many tests.
 */
async function runAllTests(
  _args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const progress = getProgressReporter(tools);

  try {
    await progress?.report(1, 3, 'Running all automation tests...');

    const result = await executeConsoleCommand(
      tools,
      'Automation RunAll',
      'Failed to run all tests'
    );

    await progress?.report(2, 3, 'Tests executing...');

    // Wait longer for all tests to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    await progress?.report(3, 3, 'Collecting results...');

    const reportResult = await executeConsoleCommand(
      tools,
      'Automation Report',
      'Failed to get test report'
    );

    log.info('All automation tests executed');

    return {
      success: true,
      action: 'run_all_tests',
      executionResult: result,
      report: reportResult,
      message: 'All automation tests executed. Check report for details.'
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`run_all_tests failed: ${errorMsg}`);
    return {
      success: false,
      action: 'run_all_tests',
      error: errorMsg
    };
  }
}

/**
 * Execute tests whose names match a given filter pattern. Uses
 * `Automation RunFilter <pattern>` to let UE handle the matching.
 *
 * @param args.filter - Filter pattern to match test names (required)
 */
async function runTestsByFilter(
  args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  const filter = args.filter as string;
  if (!filter) {
    return {
      success: false,
      action: 'run_tests_by_filter',
      error: 'filter is required (e.g., "Project.Gameplay" or "Character")'
    };
  }

  try {
    const result = await executeConsoleCommand(
      tools,
      `Automation RunFilter ${filter}`,
      `Failed to run tests matching: ${filter}`
    );

    // Allow time for filtered tests to execute
    await new Promise(resolve => setTimeout(resolve, 3000));

    const reportResult = await executeConsoleCommand(
      tools,
      'Automation Report',
      'Failed to get test report'
    );

    log.info(`Tests matching '${filter}' executed`);

    return {
      success: true,
      action: 'run_tests_by_filter',
      filter,
      executionResult: result,
      report: reportResult,
      message: `Tests matching '${filter}' executed. Check report for details.`
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`run_tests_by_filter '${filter}' failed: ${errorMsg}`);
    return {
      success: false,
      action: 'run_tests_by_filter',
      filter,
      error: errorMsg
    };
  }
}

/**
 * Retrieve the latest automation test report. This simply invokes
 * `Automation Report` and returns the raw output for AI interpretation.
 */
async function getTestResults(
  _args: HandlerArgs,
  tools: ITools
): Promise<Record<string, unknown>> {
  try {
    const result = await executeConsoleCommand(
      tools,
      'Automation Report',
      'Failed to get test report'
    );

    log.info('Test results retrieved');

    return {
      success: true,
      action: 'get_test_results',
      report: result,
      message: 'Test results retrieved.'
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`get_test_results failed: ${errorMsg}`);
    return {
      success: false,
      action: 'get_test_results',
      error: errorMsg
    };
  }
}
