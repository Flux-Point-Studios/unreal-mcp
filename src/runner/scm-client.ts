/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\scm-client.ts
 *
 * SCM Client - Source Control Management integration for rollback/commit
 * Supports Git and Perforce (P4)
 *
 * This module provides:
 * - Abstract SCM client interface for version control operations
 * - Git client with branch-based attempt tracking
 * - Perforce client with changelist-based attempt tracking
 * - Factory functions for client creation and auto-detection
 *
 * Used by: workflow orchestrator, CI robot, rollback handler
 */

import { spawn, SpawnOptions } from 'child_process';
import { RunId, SCMAttempt, SCMCommitResult } from './types.js';

export interface SCMClientConfig {
    type: 'git' | 'perforce';
    workingDir: string;
    // Git-specific
    remoteName?: string;
    mainBranch?: string;
    // Perforce-specific
    p4Port?: string;
    p4User?: string;
    p4Client?: string;
}

export abstract class SCMClient {
    protected config: SCMClientConfig;

    constructor(config: SCMClientConfig) {
        this.config = config;
    }

    abstract createAttempt(runId: RunId): Promise<SCMAttempt>;
    abstract commitAttempt(attempt: SCMAttempt, summary: string): Promise<SCMCommitResult>;
    abstract revertAttempt(attempt: SCMAttempt): Promise<boolean>;
    abstract getCurrentBranch(): Promise<string>;
    abstract hasUncommittedChanges(): Promise<boolean>;

    protected async exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        return new Promise((resolve) => {
            const opts: SpawnOptions = {
                cwd: this.config.workingDir,
                shell: true,
                stdio: 'pipe'
            };

            const proc = spawn(command, args, opts);
            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data) => { stdout += data.toString(); });
            proc.stderr?.on('data', (data) => { stderr += data.toString(); });

            proc.on('close', (code) => {
                resolve({ stdout, stderr, exitCode: code ?? 1 });
            });

            proc.on('error', (err) => {
                resolve({ stdout, stderr: err.message, exitCode: 1 });
            });
        });
    }
}

/**
 * Git SCM Client
 */
export class GitClient extends SCMClient {
    private mainBranch: string;

    constructor(config: SCMClientConfig) {
        super(config);
        // remoteName can be used for push operations in future enhancements
        this.mainBranch = config.mainBranch || 'main';
    }

    async createAttempt(runId: RunId): Promise<SCMAttempt> {
        const branchName = `mcp-attempt/${runId}`;

        // Create and checkout new branch
        const result = await this.exec('git', ['checkout', '-b', branchName]);

        if (result.exitCode !== 0) {
            throw new Error(`Failed to create attempt branch: ${result.stderr}`);
        }

        return {
            runId,
            branch: branchName,
            timestamp: new Date().toISOString()
        };
    }

    async commitAttempt(attempt: SCMAttempt, summary: string): Promise<SCMCommitResult> {
        // Stage all changes
        await this.exec('git', ['add', '-A']);

        // Check if there are changes to commit
        const status = await this.exec('git', ['status', '--porcelain']);
        if (!status.stdout.trim()) {
            return {
                success: true,
                message: 'No changes to commit'
            };
        }

        // Commit with summary
        const commitMessage = `[MCP Robot] ${summary}\n\nRun ID: ${attempt.runId}`;
        const commitResult = await this.exec('git', ['commit', '-m', commitMessage]);

        if (commitResult.exitCode !== 0) {
            return {
                success: false,
                message: `Commit failed: ${commitResult.stderr}`
            };
        }

        // Get commit hash
        const hashResult = await this.exec('git', ['rev-parse', 'HEAD']);
        const commitHash = hashResult.stdout.trim();

        // Optionally merge back to main
        await this.exec('git', ['checkout', this.mainBranch]);
        const mergeResult = await this.exec('git', ['merge', attempt.branch!, '--no-ff', '-m', `Merge ${attempt.branch}`]);

        if (mergeResult.exitCode !== 0) {
            // Abort merge and return
            await this.exec('git', ['merge', '--abort']);
            return {
                success: false,
                commitHash,
                message: `Merge to ${this.mainBranch} failed: ${mergeResult.stderr}`
            };
        }

        // Delete attempt branch
        await this.exec('git', ['branch', '-d', attempt.branch!]);

        return {
            success: true,
            commitHash,
            message: `Successfully committed and merged to ${this.mainBranch}`
        };
    }

    async revertAttempt(attempt: SCMAttempt): Promise<boolean> {
        // Discard all uncommitted changes
        await this.exec('git', ['reset', '--hard']);
        await this.exec('git', ['clean', '-fd']);

        // Switch back to main branch
        const checkoutResult = await this.exec('git', ['checkout', this.mainBranch]);

        if (checkoutResult.exitCode !== 0) {
            console.error(`Failed to checkout ${this.mainBranch}:`, checkoutResult.stderr);
            return false;
        }

        // Delete attempt branch if it exists
        if (attempt.branch) {
            await this.exec('git', ['branch', '-D', attempt.branch]);
        }

        return true;
    }

    async getCurrentBranch(): Promise<string> {
        const result = await this.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
        return result.stdout.trim();
    }

    async hasUncommittedChanges(): Promise<boolean> {
        const result = await this.exec('git', ['status', '--porcelain']);
        return result.stdout.trim().length > 0;
    }

    async getRecentCommits(count: number = 10): Promise<{ hash: string; message: string; date: string }[]> {
        const result = await this.exec('git', ['log', `--format=%H|%s|%ci`, `-${count}`]);

        return result.stdout.trim().split('\n')
            .filter(line => line.trim())
            .map(line => {
                const [hash, message, date] = line.split('|');
                return { hash, message, date };
            });
    }
}

/**
 * Perforce SCM Client
 */
export class PerforceClient extends SCMClient {
    private p4Port: string;
    private p4User: string;
    private p4Client: string;

    constructor(config: SCMClientConfig) {
        super(config);
        this.p4Port = config.p4Port || process.env.P4PORT || '';
        this.p4User = config.p4User || process.env.P4USER || '';
        this.p4Client = config.p4Client || process.env.P4CLIENT || '';
    }

    /**
     * Get Perforce environment variables for command execution.
     * Reserved for future use when exec() supports custom environment.
     */
    protected getP4Env(): NodeJS.ProcessEnv {
        return {
            ...process.env,
            P4PORT: this.p4Port,
            P4USER: this.p4User,
            P4CLIENT: this.p4Client
        };
    }

    async createAttempt(runId: RunId): Promise<SCMAttempt> {
        // Create a new pending changelist
        const description = `[MCP Robot] Attempt ${runId}`;

        const result = await this.exec('p4', ['change', '-o']);
        if (result.exitCode !== 0) {
            throw new Error(`Failed to get changelist template: ${result.stderr}`);
        }

        // Modify the template for changelist creation
        // Note: template would be piped to p4 change -i in a full implementation
        void result.stdout.replace(/<enter description here>/, description);

        // Create the changelist
        // TODO: Implement proper stdin piping for p4 change -i
        const createResult = await this.exec('p4', ['change', '-i']);

        // Parse changelist number from output
        const match = createResult.stdout.match(/Change (\d+) created/);
        const changelist = match ? parseInt(match[1], 10) : undefined;

        return {
            runId,
            changelist,
            timestamp: new Date().toISOString()
        };
    }

    async commitAttempt(attempt: SCMAttempt, _summary: string): Promise<SCMCommitResult> {
        if (!attempt.changelist) {
            return {
                success: false,
                message: 'No changelist number in attempt'
            };
        }

        // Update changelist description (fetch current for potential modification)
        // Note: In a full implementation, summary would be used to update the description
        await this.exec('p4', [
            'change', '-o', attempt.changelist.toString()
        ]);

        // Submit the changelist
        const submitResult = await this.exec('p4', [
            'submit', '-c', attempt.changelist.toString()
        ]);

        if (submitResult.exitCode !== 0) {
            return {
                success: false,
                changelist: attempt.changelist,
                message: `Submit failed: ${submitResult.stderr}`
            };
        }

        return {
            success: true,
            changelist: attempt.changelist,
            message: `Changelist ${attempt.changelist} submitted`
        };
    }

    async revertAttempt(attempt: SCMAttempt): Promise<boolean> {
        if (!attempt.changelist) {
            return false;
        }

        // Revert all files in the changelist
        await this.exec('p4', [
            'revert', '-c', attempt.changelist.toString(), '//...'
        ]);

        // Delete the changelist
        const deleteResult = await this.exec('p4', [
            'change', '-d', attempt.changelist.toString()
        ]);

        return deleteResult.exitCode === 0;
    }

    async getCurrentBranch(): Promise<string> {
        // Perforce doesn't have branches in the same way
        // Return the client workspace name
        return this.p4Client;
    }

    async hasUncommittedChanges(): Promise<boolean> {
        const result = await this.exec('p4', ['opened']);
        return result.stdout.trim().length > 0;
    }
}

/**
 * Factory function to create appropriate SCM client
 */
export function createSCMClient(config: SCMClientConfig): SCMClient {
    switch (config.type) {
        case 'git':
            return new GitClient(config);
        case 'perforce':
            return new PerforceClient(config);
        default:
            throw new Error(`Unsupported SCM type: ${config.type}`);
    }
}

/**
 * Auto-detect SCM type from working directory
 */
export async function detectSCMType(workingDir: string): Promise<'git' | 'perforce' | null> {
    const fs = await import('fs/promises');
    const path = await import('path');

    // Check for .git directory
    try {
        await fs.access(path.join(workingDir, '.git'));
        return 'git';
    } catch {
        // Not git
    }

    // Check for P4CONFIG or common Perforce indicators
    if (process.env.P4PORT || process.env.P4CLIENT) {
        return 'perforce';
    }

    return null;
}
