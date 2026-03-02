/**
 * Async Task Queue for Long-Running Operations
 *
 * Allows MCP tool operations to be submitted, polled, and retrieved without
 * hitting HTTP/WebSocket timeouts. Operations like landscape sculpting, large
 * asset imports, or blueprint compilation can take 30+ seconds and need a
 * non-blocking pattern.
 */

import { Logger } from '../utils/logger.js';

const log = new Logger('TaskQueue');

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AsyncTask {
  id: string;
  status: TaskStatus;
  toolName: string;
  action: string;
  args: Record<string, unknown>;
  submittedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  progress?: number; // 0-100
  progressMessage?: string;
}

export interface TaskQueueOptions {
  maxConcurrent?: number;
  taskTimeout?: number; // ms
  cleanupInterval?: number; // ms
  completedTaskMaxAge?: number; // ms
}

/**
 * Execute function type - the task queue needs a way to invoke tool handlers.
 * This is set externally after construction to avoid circular dependencies.
 */
export type TaskExecutor = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<unknown>;

export class TaskQueue {
  private tasks: Map<string, AsyncTask> = new Map();
  private readonly maxConcurrent: number;
  private readonly taskTimeout: number;
  private readonly completedTaskMaxAge: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private executor: TaskExecutor | null = null;
  private runningCount = 0;
  private pendingQueue: string[] = []; // task IDs waiting to run

  constructor(options: TaskQueueOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 5;
    this.taskTimeout = options.taskTimeout ?? 120_000; // 120 seconds
    this.completedTaskMaxAge = options.completedTaskMaxAge ?? 300_000; // 5 minutes

    const cleanupInterval = options.cleanupInterval ?? 60_000; // 1 minute
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, cleanupInterval);

    // Prevent the timer from keeping the process alive
    if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }

    log.info(
      `TaskQueue initialized: maxConcurrent=${this.maxConcurrent}, ` +
      `taskTimeout=${this.taskTimeout}ms, completedMaxAge=${this.completedTaskMaxAge}ms`
    );
  }

  /**
   * Set the executor function used to run tool handlers.
   * Must be called before submitting tasks.
   */
  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  /**
   * Submit a new task for async execution.
   * Returns the task ID immediately.
   */
  submit(toolName: string, action: string, args: Record<string, unknown>): string {
    if (!this.executor) {
      throw new Error('TaskQueue executor not configured. Call setExecutor() first.');
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    const task: AsyncTask = {
      id,
      status: 'pending',
      toolName,
      action,
      args: { ...args, action },
      submittedAt: now,
    };

    this.tasks.set(id, task);
    this.pendingQueue.push(id);

    log.info(`Task submitted: id=${id}, tool=${toolName}, action=${action}`);

    // Attempt to pick up the task immediately
    this.processQueue();

    return id;
  }

  /**
   * Get the current status of a task.
   */
  getStatus(taskId: string): AsyncTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get the result of a completed task.
   * Returns undefined if the task doesn't exist or isn't completed/failed.
   */
  getResult(taskId: string): { result?: unknown; error?: string; status: TaskStatus } | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    if (task.status === 'completed') {
      return { result: task.result, status: task.status };
    }

    if (task.status === 'failed') {
      return { error: task.error, status: task.status };
    }

    return { status: task.status };
  }

  /**
   * Cancel a pending or running task.
   * Only pending tasks can be effectively cancelled (removed from the queue).
   * Running tasks will be marked as cancelled but the underlying operation
   * may continue until it naturally completes.
   */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return false; // Already in terminal state
    }

    if (task.status === 'pending') {
      // Remove from pending queue
      const queueIndex = this.pendingQueue.indexOf(taskId);
      if (queueIndex !== -1) {
        this.pendingQueue.splice(queueIndex, 1);
      }
    }

    if (task.status === 'running') {
      this.runningCount = Math.max(0, this.runningCount - 1);
    }

    task.status = 'cancelled';
    task.completedAt = Date.now();
    log.info(`Task cancelled: id=${taskId}`);

    // Try to process more tasks from the queue
    this.processQueue();

    return true;
  }

  /**
   * List tasks, optionally filtered by status.
   */
  list(filter?: { status?: string }): AsyncTask[] {
    const tasks: AsyncTask[] = [];
    for (const task of this.tasks.values()) {
      if (filter?.status && task.status !== filter.status) {
        continue;
      }
      tasks.push({ ...task });
    }
    return tasks;
  }

  /**
   * Remove old completed/failed/cancelled tasks.
   * @param maxAge Maximum age in milliseconds (defaults to completedTaskMaxAge)
   * @returns Number of tasks removed
   */
  cleanup(maxAge?: number): number {
    const cutoff = Date.now() - (maxAge ?? this.completedTaskMaxAge);
    let removed = 0;

    for (const [id, task] of this.tasks) {
      if (
        (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') &&
        task.completedAt &&
        task.completedAt < cutoff
      ) {
        this.tasks.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      log.debug(`Cleanup removed ${removed} old tasks`);
    }

    return removed;
  }

  /**
   * Process the pending queue, starting tasks up to maxConcurrent.
   */
  private processQueue(): void {
    while (this.runningCount < this.maxConcurrent && this.pendingQueue.length > 0) {
      const taskId = this.pendingQueue.shift();
      if (!taskId) break;

      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'pending') continue;

      this.executeTask(task);
    }
  }

  /**
   * Execute a single task in the background.
   */
  private executeTask(task: AsyncTask): void {
    task.status = 'running';
    task.startedAt = Date.now();
    this.runningCount++;

    log.info(`Task started: id=${task.id}, tool=${task.toolName}, action=${task.action}`);

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (task.status === 'running') {
        task.status = 'failed';
        task.error = `Task timed out after ${this.taskTimeout}ms`;
        task.completedAt = Date.now();
        this.runningCount = Math.max(0, this.runningCount - 1);
        log.warn(`Task timed out: id=${task.id}`);
        this.processQueue();
      }
    }, this.taskTimeout);

    // Execute the tool handler
    const executor = this.executor!;
    executor(task.toolName, task.args)
      .then((result) => {
        clearTimeout(timeoutId);
        if (task.status === 'cancelled') {
          // Task was cancelled while running; don't overwrite status
          return;
        }
        task.status = 'completed';
        task.result = result;
        task.completedAt = Date.now();
        const duration = task.completedAt - (task.startedAt ?? task.submittedAt);
        log.info(`Task completed: id=${task.id}, duration=${duration}ms`);
      })
      .catch((error: unknown) => {
        clearTimeout(timeoutId);
        if (task.status === 'cancelled') {
          return;
        }
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : String(error);
        task.completedAt = Date.now();
        const duration = task.completedAt - (task.startedAt ?? task.submittedAt);
        log.error(`Task failed: id=${task.id}, duration=${duration}ms, error=${task.error}`);
      })
      .finally(() => {
        if (task.status !== 'cancelled') {
          this.runningCount = Math.max(0, this.runningCount - 1);
        }
        this.processQueue();
      });
  }

  /**
   * Update progress on a running task (can be called by the executor or externally).
   */
  updateProgress(taskId: string, progress: number, message?: string): void {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'running') {
      task.progress = Math.max(0, Math.min(100, progress));
      if (message !== undefined) {
        task.progressMessage = message;
      }
    }
  }

  /**
   * Get summary statistics about the queue.
   */
  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    maxConcurrent: number;
  } {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'pending': pending++; break;
        case 'running': running++; break;
        case 'completed': completed++; break;
        case 'failed': failed++; break;
        case 'cancelled': cancelled++; break;
      }
    }

    return {
      total: this.tasks.size,
      pending,
      running,
      completed,
      failed,
      cancelled,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * Stop the cleanup timer and release resources.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    log.info('TaskQueue disposed');
  }
}

// Singleton instance
export const taskQueue = new TaskQueue();
