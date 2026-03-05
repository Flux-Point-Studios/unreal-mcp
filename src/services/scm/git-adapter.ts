/**
 * Git SCM Adapter (Sprint 7)
 *
 * Implements ISCMAdapter for Git repositories.
 * Uses child_process.exec for git commands.
 *
 * Important: This is not "just shell out to git."
 * It implements the ISCMAdapter interface so Perforce can
 * be swapped in later without changing any tool handler code.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { ISCMAdapter, SCMStatus, SCMCheckpointResult, SCMChangeSummary, SCMLockResult } from './adapter.js';
import { Logger } from '../../utils/logger.js';

const execAsync = promisify(exec);
const logger = new Logger('GitAdapter');

/** Maximum output buffer for git commands. */
const MAX_BUFFER = 1024 * 1024; // 1MB

export class GitAdapter implements ISCMAdapter {
    readonly provider = 'git';

    constructor(private projectPath: string) { }

    private async git(command: string): Promise<string> {
        try {
            const { stdout } = await execAsync(`git ${command}`, {
                cwd: this.projectPath,
                maxBuffer: MAX_BUFFER,
            });
            return stdout.trim();
        } catch (err) {
            const error = err as { stderr?: string; message?: string };
            throw new Error(`git ${command} failed: ${error.stderr || error.message}`);
        }
    }

    async status(): Promise<SCMStatus> {
        try {
            const branch = await this.git('rev-parse --abbrev-ref HEAD');
            const commit = await this.git('rev-parse --short HEAD');
            const statusOutput = await this.git('status --porcelain');

            const lines = statusOutput.split('\n').filter(l => l.length > 0);
            const modifiedFiles: string[] = [];
            const untrackedFiles: string[] = [];
            const stagedFiles: string[] = [];

            for (const line of lines) {
                const indexStatus = line[0];
                const workTreeStatus = line[1];
                const filePath = line.slice(3);

                if (indexStatus === '?' && workTreeStatus === '?') {
                    untrackedFiles.push(filePath);
                } else {
                    if (indexStatus !== ' ' && indexStatus !== '?') {
                        stagedFiles.push(filePath);
                    }
                    if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
                        modifiedFiles.push(filePath);
                    }
                }
            }

            return {
                provider: 'git',
                isAvailable: true,
                branch,
                commit,
                isDirty: lines.length > 0,
                modifiedFiles,
                untrackedFiles,
                stagedFiles,
            };
        } catch {
            return {
                provider: 'git',
                isAvailable: false,
                isDirty: false,
                modifiedFiles: [],
                untrackedFiles: [],
                stagedFiles: [],
            };
        }
    }

    async checkpoint(message: string, paths?: string[]): Promise<SCMCheckpointResult> {
        // Stage specified paths or all changes
        if (paths && paths.length > 0) {
            const safePaths = paths.map(p => `"${p}"`).join(' ');
            await this.git(`add ${safePaths}`);
        } else {
            await this.git('add -A');
        }

        // Check if there's anything to commit
        const statusOutput = await this.git('diff --cached --name-only');
        const stagedFiles = statusOutput.split('\n').filter(l => l.length > 0);

        if (stagedFiles.length === 0) {
            return {
                provider: 'git',
                ref: await this.git('rev-parse --short HEAD'),
                branch: await this.git('rev-parse --abbrev-ref HEAD'),
                message: 'No changes to commit',
                filesCommitted: [],
            };
        }

        // Commit
        const safeMessage = message.replace(/"/g, '\\"');
        await this.git(`commit -m "${safeMessage}"`);
        const ref = await this.git('rev-parse --short HEAD');
        const branch = await this.git('rev-parse --abbrev-ref HEAD');

        logger.info(`Git checkpoint created: ${ref} (${message})`);

        return {
            provider: 'git',
            ref,
            branch,
            message,
            filesCommitted: stagedFiles,
        };
    }

    async revert(ref: string): Promise<{ success: boolean; message: string }> {
        // Use git revert (safe, creates a new commit) rather than reset --hard
        try {
            await this.git(`revert --no-edit ${ref}..HEAD`);
            const newRef = await this.git('rev-parse --short HEAD');
            return {
                success: true,
                message: `Reverted to ${ref}. New HEAD: ${newRef}`,
            };
        } catch (err) {
            // If revert fails (conflicts), abort and report
            try { await this.git('revert --abort'); } catch { /* ignore */ }
            return {
                success: false,
                message: `Revert failed (likely conflicts): ${err instanceof Error ? err.message : String(err)}. Consider manual resolution.`,
            };
        }
    }

    async changedSince(ref: string): Promise<SCMChangeSummary> {
        const currentRef = await this.git('rev-parse --short HEAD');
        const diffOutput = await this.git(`diff --name-status ${ref}..HEAD`);
        const lines = diffOutput.split('\n').filter(l => l.length > 0);

        const filesChanged = lines.map(line => {
            const parts = line.split('\t');
            const statusChar = parts[0];
            const path = parts[1] || parts[0];
            let status: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified';
            if (statusChar === 'A') status = 'added';
            else if (statusChar === 'D') status = 'deleted';
            else if (statusChar.startsWith('R')) status = 'renamed';
            return { path, status };
        });

        const added = filesChanged.filter(f => f.status === 'added').length;
        const modified = filesChanged.filter(f => f.status === 'modified').length;
        const deleted = filesChanged.filter(f => f.status === 'deleted').length;
        const summary = `${filesChanged.length} files changed since ${ref}: ${added} added, ${modified} modified, ${deleted} deleted`;

        return {
            provider: 'git',
            fromRef: ref,
            toRef: currentRef,
            filesChanged,
            summary,
        };
    }

    async lock(path: string): Promise<SCMLockResult> {
        // Git LFS lock (requires git-lfs)
        try {
            await this.git(`lfs lock "${path}"`);
            return {
                provider: 'git',
                path,
                locked: true,
                message: `Locked ${path} via Git LFS`,
            };
        } catch (err) {
            return {
                provider: 'git',
                path,
                locked: false,
                message: `Lock failed: ${err instanceof Error ? err.message : String(err)}. Git LFS may not be installed or file may not be tracked by LFS.`,
            };
        }
    }

    async unlock(path: string): Promise<SCMLockResult> {
        try {
            await this.git(`lfs unlock "${path}"`);
            return {
                provider: 'git',
                path,
                locked: false,
                message: `Unlocked ${path} via Git LFS`,
            };
        } catch (err) {
            return {
                provider: 'git',
                path,
                locked: false,
                message: `Unlock failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    async changeSummary(fromRef?: string, toRef?: string): Promise<string> {
        const from = fromRef || 'HEAD~5';
        const to = toRef || 'HEAD';

        try {
            const logOutput = await this.git(`log --oneline ${from}..${to}`);
            const diffStat = await this.git(`diff --stat ${from}..${to}`);
            return `## Git changes ${from}..${to}\n\n### Commits\n${logOutput}\n\n### File Stats\n${diffStat}`;
        } catch (err) {
            return `Unable to generate change summary: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
}
