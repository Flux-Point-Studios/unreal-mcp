/**
 * Source Control Adapter Interface (Sprint 7)
 *
 * Abstract interface for source control operations.
 * Designed to support Git now, Perforce later, without
 * painting the architecture into a single-provider corner.
 *
 * Key design decisions:
 * - Asset-centric (paths, not generic file ops)
 * - Lock/unlock abstraction (critical for Perforce/Unreal workflows)
 * - Checkpoint ties into the checkpoint manager
 * - Change summaries are LLM-readable
 */

export interface SCMStatus {
    provider: string;
    isAvailable: boolean;
    branch?: string;
    commit?: string;
    isDirty: boolean;
    modifiedFiles: string[];
    untrackedFiles: string[];
    stagedFiles: string[];
}

export interface SCMCheckpointResult {
    provider: string;
    ref: string;
    branch?: string;
    message: string;
    filesCommitted: string[];
}

export interface SCMChangeSummary {
    provider: string;
    fromRef: string;
    toRef: string;
    filesChanged: Array<{
        path: string;
        status: 'added' | 'modified' | 'deleted' | 'renamed';
    }>;
    summary: string;
}

export interface SCMLockResult {
    provider: string;
    path: string;
    locked: boolean;
    lockedBy?: string;
    message: string;
}

/**
 * Source Control Adapter Interface.
 * Implement this for each SCM provider (Git, Perforce, etc.).
 */
export interface ISCMAdapter {
    /** Provider name (e.g., 'git', 'perforce'). */
    readonly provider: string;

    /** Check if the SCM provider is available and the project is under source control. */
    status(): Promise<SCMStatus>;

    /** Create a source control checkpoint (commit/changelist). */
    checkpoint(message: string, paths?: string[]): Promise<SCMCheckpointResult>;

    /** Revert to a previous checkpoint (ref/changelist number). */
    revert(ref: string): Promise<{ success: boolean; message: string }>;

    /** Get changed files since a given ref. */
    changedSince(ref: string): Promise<SCMChangeSummary>;

    /** Lock an asset (Perforce-style; Git LFS lock). */
    lock(path: string): Promise<SCMLockResult>;

    /** Unlock an asset. */
    unlock(path: string): Promise<SCMLockResult>;

    /** Get summary of changes for LLM consumption. */
    changeSummary(fromRef?: string, toRef?: string): Promise<string>;
}
