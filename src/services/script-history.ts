/**
 * In-memory history of executed scripts.
 * Stores the last N script executions for auditing and debugging.
 * Not persisted to disk.
 */

export interface ScriptEntry {
  id: string;
  scriptType: string;
  scriptName?: string;
  content: string;
  executedAt: number;
  duration_ms: number;
  success: boolean;
  output?: string;
  error?: string;
  dryRun?: boolean;
}

let idCounter = 0;

function generateId(): string {
  idCounter++;
  return `script_${Date.now()}_${idCounter}`;
}

export class ScriptHistory {
  private entries: ScriptEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 50) {
    this.maxEntries = maxEntries;
  }

  /**
   * Add a new script execution entry to history.
   * Returns the generated ID of the entry.
   */
  add(entry: Omit<ScriptEntry, 'id'>): string {
    const id = generateId();
    const fullEntry: ScriptEntry = { id, ...entry };

    this.entries.push(fullEntry);

    // Trim to maxEntries
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    return id;
  }

  /**
   * List recent script entries, optionally limited.
   */
  list(limit?: number): ScriptEntry[] {
    if (limit !== undefined && limit > 0) {
      return this.entries.slice(-limit);
    }
    return [...this.entries];
  }

  /**
   * Get a specific entry by ID.
   */
  get(id: string): ScriptEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  /**
   * Clear all history entries.
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get the count of entries in history.
   */
  get count(): number {
    return this.entries.length;
  }
}

// Singleton instance for the application
export const scriptHistory = new ScriptHistory(50);
