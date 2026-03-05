/**
 * Source Control Tool Handlers (Sprint 7)
 *
 * Actions:
 *   status              — SCM status (branch, dirty state, modified files)
 *   checkpoint          — create a source control checkpoint (commit/changelist)
 *   revert              — revert to a previous checkpoint
 *   changed_since       — files changed since a given ref
 *   lock                — lock an asset (Git LFS / Perforce)
 *   unlock              — unlock an asset
 *   change_summary      — LLM-readable summary of recent changes
 */

import { ITools } from '../../types/tool-interfaces.js';
import { ISCMAdapter } from '../../services/scm/adapter.js';
import { GitAdapter } from '../../services/scm/git-adapter.js';
import { Logger } from '../../utils/logger.js';

const logger = new Logger('SourceControlHandlers');

/** Lazily-initialized SCM adapter singleton. */
let scmAdapter: ISCMAdapter | null = null;

function getAdapter(): ISCMAdapter {
    if (!scmAdapter) {
        // Default to Git. The project path comes from UE_PROJECT_PATH env var
        // or falls back to cwd.
        const projectPath = process.env.UE_PROJECT_PATH || process.cwd();
        scmAdapter = new GitAdapter(projectPath);
        logger.info(`SCM adapter initialized: git (project: ${projectPath})`);
    }
    return scmAdapter;
}

export async function handleSourceControlTools(
    action: string,
    args: Record<string, unknown>,
    _tools: ITools
): Promise<Record<string, unknown>> {
    const adapter = getAdapter();

    switch (action) {
        case 'status': {
            const status = await adapter.status();
            return { success: true, ...status };
        }

        case 'checkpoint': {
            const message = (args.message || args.label || 'MCP checkpoint') as string;
            const paths = args.paths as string[] | undefined;
            const result = await adapter.checkpoint(message, paths);
            return { success: true, ...result };
        }

        case 'revert': {
            const ref = (args.ref || args.checkpoint) as string;
            if (!ref) {
                return { success: false, error: 'ref parameter is required (commit hash or checkpoint ref)' };
            }
            const result = await adapter.revert(ref);
            return result;
        }

        case 'changed_since': {
            const ref = (args.ref || args.since) as string;
            if (!ref) {
                return { success: false, error: 'ref parameter is required' };
            }
            const result = await adapter.changedSince(ref);
            return { success: true, ...result };
        }

        case 'lock': {
            const path = (args.path || args.assetPath) as string;
            if (!path) {
                return { success: false, error: 'path parameter is required' };
            }
            const result = await adapter.lock(path);
            return { success: result.locked, ...result };
        }

        case 'unlock': {
            const path = (args.path || args.assetPath) as string;
            if (!path) {
                return { success: false, error: 'path parameter is required' };
            }
            const result = await adapter.unlock(path);
            return { success: true, ...result };
        }

        case 'change_summary': {
            const fromRef = args.from as string | undefined;
            const toRef = args.to as string | undefined;
            const summary = await adapter.changeSummary(fromRef, toRef);
            return { success: true, summary };
        }

        default:
            return {
                success: false,
                error: `Unknown source_control action: ${action}`,
                availableActions: [
                    'status', 'checkpoint', 'revert', 'changed_since',
                    'lock', 'unlock', 'change_summary',
                ],
            };
    }
}
