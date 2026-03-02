/**
 * Task Queue Handler
 *
 * Handles the manage_tasks MCP tool for async task management.
 * Allows submitting, polling, retrieving, cancelling, and cleaning up
 * long-running tool operations.
 */

import { ITools } from '../../types/tool-interfaces.js';
import { ResponseFactory } from '../../utils/response-factory.js';
import { taskQueue } from '../../services/task-queue.js';
import { toolRegistry } from '../dynamic-handler-registry.js';
import { Logger } from '../../utils/logger.js';

const log = new Logger('TaskHandlers');

/**
 * Handle manage_tasks actions.
 */
export async function handleTaskTools(
  action: string,
  args: Record<string, unknown>,
  tools: ITools
): Promise<Record<string, unknown>> {
  try {
    // Ensure the task queue executor is wired up.
    // This is safe to call multiple times; it just overwrites the same function reference.
    taskQueue.setExecutor(async (toolName: string, toolArgs: Record<string, unknown>) => {
      const handler = toolRegistry.getHandler(toolName);
      if (!handler) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      return await handler(toolArgs, tools);
    });

    switch (action) {
      // ===== Submit a task =====
      case 'submit': {
        const toolName = typeof args.tool_name === 'string' ? args.tool_name.trim() : '';
        const targetAction = typeof args.target_action === 'string' ? args.target_action.trim() : '';
        const taskArgs = (args.args && typeof args.args === 'object' && !Array.isArray(args.args))
          ? args.args as Record<string, unknown>
          : {};

        if (!toolName) {
          return ResponseFactory.validationError('tool_name is required');
        }
        if (!targetAction) {
          return ResponseFactory.validationError('target_action is required');
        }

        // Validate that the target tool exists
        if (!toolRegistry.hasHandler(toolName)) {
          return ResponseFactory.error(
            `Tool '${toolName}' does not exist. Use manage_tools list_tools to see available tools.`,
            'UNKNOWN_TOOL'
          );
        }

        // Prevent submitting manage_tasks itself to avoid recursion
        if (toolName === 'manage_tasks') {
          return ResponseFactory.error(
            'Cannot submit manage_tasks as an async task (would cause recursion).',
            'RECURSIVE_SUBMIT'
          );
        }

        const taskId = taskQueue.submit(toolName, targetAction, taskArgs);

        return ResponseFactory.success({
          taskId,
          status: 'pending',
          toolName,
          action: targetAction,
        }, `Task submitted successfully. Use status action with task_id '${taskId}' to check progress.`);
      }

      // ===== Check task status =====
      case 'status': {
        const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
        if (!taskId) {
          return ResponseFactory.validationError('task_id is required');
        }

        const task = taskQueue.getStatus(taskId);
        if (!task) {
          return ResponseFactory.error(`Task '${taskId}' not found`, 'TASK_NOT_FOUND');
        }

        const response: Record<string, unknown> = {
          taskId: task.id,
          status: task.status,
          toolName: task.toolName,
          action: task.action,
          submittedAt: task.submittedAt,
        };

        if (task.startedAt !== undefined) response.startedAt = task.startedAt;
        if (task.completedAt !== undefined) response.completedAt = task.completedAt;
        if (task.progress !== undefined) response.progress = task.progress;
        if (task.progressMessage !== undefined) response.progressMessage = task.progressMessage;

        // Include duration info for running/completed tasks
        if (task.startedAt) {
          const endTime = task.completedAt ?? Date.now();
          response.durationMs = endTime - task.startedAt;
        }

        return ResponseFactory.success(response, `Task '${taskId}' is ${task.status}`);
      }

      // ===== Get task result =====
      case 'result': {
        const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
        if (!taskId) {
          return ResponseFactory.validationError('task_id is required');
        }

        const taskResult = taskQueue.getResult(taskId);
        if (!taskResult) {
          return ResponseFactory.error(`Task '${taskId}' not found`, 'TASK_NOT_FOUND');
        }

        if (taskResult.status === 'pending' || taskResult.status === 'running') {
          return ResponseFactory.success({
            taskId,
            status: taskResult.status,
            ready: false,
          }, `Task '${taskId}' is still ${taskResult.status}. Try again later.`);
        }

        if (taskResult.status === 'cancelled') {
          return ResponseFactory.success({
            taskId,
            status: 'cancelled',
            ready: false,
          }, `Task '${taskId}' was cancelled.`);
        }

        if (taskResult.status === 'failed') {
          return ResponseFactory.success({
            taskId,
            status: 'failed',
            ready: true,
            error: taskResult.error,
          }, `Task '${taskId}' failed: ${taskResult.error}`);
        }

        // Completed
        return ResponseFactory.success({
          taskId,
          status: 'completed',
          ready: true,
          result: taskResult.result,
        }, `Task '${taskId}' completed successfully.`);
      }

      // ===== List tasks =====
      case 'list': {
        const statusFilter = typeof args.status_filter === 'string' ? args.status_filter.trim() : undefined;
        const filter = statusFilter ? { status: statusFilter } : undefined;
        const tasks = taskQueue.list(filter);

        const summaries = tasks.map(task => ({
          taskId: task.id,
          status: task.status,
          toolName: task.toolName,
          action: task.action,
          submittedAt: task.submittedAt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          progress: task.progress,
          progressMessage: task.progressMessage,
          durationMs: task.startedAt
            ? (task.completedAt ?? Date.now()) - task.startedAt
            : undefined,
        }));

        const stats = taskQueue.getStats();

        return ResponseFactory.success({
          tasks: summaries,
          count: summaries.length,
          stats: {
            total: stats.total,
            pending: stats.pending,
            running: stats.running,
            completed: stats.completed,
            failed: stats.failed,
            cancelled: stats.cancelled,
            maxConcurrent: stats.maxConcurrent,
          }
        }, `${summaries.length} task(s) found${statusFilter ? ` with status '${statusFilter}'` : ''}`);
      }

      // ===== Cancel a task =====
      case 'cancel': {
        const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
        if (!taskId) {
          return ResponseFactory.validationError('task_id is required');
        }

        const success = taskQueue.cancel(taskId);

        if (success) {
          return ResponseFactory.success({
            taskId,
            cancelled: true,
          }, `Task '${taskId}' cancelled successfully`);
        }

        // Check if the task exists at all
        const task = taskQueue.getStatus(taskId);
        if (!task) {
          return ResponseFactory.error(`Task '${taskId}' not found`, 'TASK_NOT_FOUND');
        }

        return ResponseFactory.error(
          `Task '${taskId}' cannot be cancelled (status: ${task.status})`,
          'CANCEL_FAILED'
        );
      }

      // ===== Cleanup old tasks =====
      case 'cleanup': {
        const maxAgeSeconds = typeof args.max_age_seconds === 'number'
          ? args.max_age_seconds
          : 300;

        const maxAgeMs = Math.max(0, maxAgeSeconds * 1000);
        const removedCount = taskQueue.cleanup(maxAgeMs);

        return ResponseFactory.success({
          removedCount,
          maxAgeSeconds,
        }, `Removed ${removedCount} old task(s)`);
      }

      default:
        return ResponseFactory.error(
          `Unknown action: ${action}. Available: submit, status, result, list, cancel, cleanup`,
          'UNKNOWN_ACTION'
        );
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error(`Task handler error: ${err.message}`, error);
    return ResponseFactory.error(`Task queue error: ${err.message}`, 'TASK_QUEUE_ERROR');
  }
}
