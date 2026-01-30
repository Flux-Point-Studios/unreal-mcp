/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\artifact-store.ts
 *
 * Artifact Store - Manage test artifacts and run history
 *
 * This module provides a structured way to store and retrieve artifacts generated
 * during test runs and CI workflows. It supports:
 * - Creating new runs with unique identifiers
 * - Writing text, JSON, and binary artifacts
 * - Copying files and directories into the artifact store
 * - Listing and reading artifacts from existing runs
 * - Managing run metadata and status
 * - Cleaning up old runs
 *
 * Used by: runner daemon, CI robot, workflow orchestrator, test harness
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { RunId, ArtifactInfo, generateRunId } from './types.js';

/**
 * Run Artifacts - Helper for writing artifacts to a specific run
 */
export class RunArtifacts {
    private runDir: string;
    private runId: RunId;

    constructor(runDir: string, runId: RunId) {
        this.runDir = runDir;
        this.runId = runId;
    }

    /**
     * Get the run ID
     */
    getRunId(): RunId {
        return this.runId;
    }

    /**
     * Get the base directory for this run
     */
    getRunDir(): string {
        return this.runDir;
    }

    /**
     * Write a text artifact
     */
    async write(filename: string, content: string): Promise<string> {
        const filePath = path.join(this.runDir, filename);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        return filePath;
    }

    /**
     * Write a JSON artifact
     */
    async writeJSON(filename: string, data: unknown): Promise<string> {
        const content = JSON.stringify(data, null, 2);
        return this.write(filename.endsWith('.json') ? filename : `${filename}.json`, content);
    }

    /**
     * Write binary data
     */
    async writeBinary(filename: string, data: Buffer): Promise<string> {
        const filePath = path.join(this.runDir, filename);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, data);
        return filePath;
    }

    /**
     * Copy a file into the artifact store
     */
    async copyFile(sourcePath: string, destFilename?: string): Promise<string> {
        const filename = destFilename || path.basename(sourcePath);
        const destPath = path.join(this.runDir, filename);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(sourcePath, destPath);
        return destPath;
    }

    /**
     * Copy a directory into the artifact store
     */
    async copyDir(sourceDir: string, destDirname?: string): Promise<string> {
        const dirname = destDirname || path.basename(sourceDir);
        const destPath = path.join(this.runDir, dirname);
        await this.copyDirRecursive(sourceDir, destPath);
        return destPath;
    }

    private async copyDirRecursive(src: string, dest: string): Promise<void> {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirRecursive(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }

    /**
     * Get full path to an artifact
     */
    getPath(filename: string): string {
        return path.join(this.runDir, filename);
    }

    /**
     * Check if an artifact exists
     */
    async exists(filename: string): Promise<boolean> {
        try {
            await fs.access(this.getPath(filename));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Read an artifact
     */
    async read(filename: string): Promise<string> {
        return fs.readFile(this.getPath(filename), 'utf-8');
    }

    /**
     * Read JSON artifact
     */
    async readJSON<T = unknown>(filename: string): Promise<T> {
        const content = await this.read(filename);
        return JSON.parse(content);
    }

    /**
     * List all artifacts in this run
     */
    async listArtifacts(): Promise<ArtifactInfo[]> {
        const artifacts: ArtifactInfo[] = [];
        await this.listArtifactsRecursive(this.runDir, '', artifacts);
        return artifacts;
    }

    private async listArtifactsRecursive(dir: string, prefix: string, artifacts: ArtifactInfo[]): Promise<void> {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    await this.listArtifactsRecursive(fullPath, relativePath, artifacts);
                } else {
                    const stats = await fs.stat(fullPath);
                    artifacts.push({
                        name: entry.name,
                        path: relativePath,
                        size: stats.size,
                        type: this.getFileType(entry.name)
                    });
                }
            }
        } catch {
            // Directory doesn't exist yet
        }
    }

    private getFileType(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        const typeMap: Record<string, string> = {
            '.json': 'application/json',
            '.log': 'text/plain',
            '.txt': 'text/plain',
            '.html': 'text/html',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg'
        };
        return typeMap[ext] || 'application/octet-stream';
    }
}

/**
 * Artifact Store - Main store for all test runs
 */
export class ArtifactStore {
    private baseDir: string;

    constructor(baseDir: string) {
        this.baseDir = baseDir;
    }

    /**
     * Create a new run and return its artifacts helper
     */
    async createRun(runId?: RunId): Promise<RunArtifacts> {
        const id = runId || generateRunId();
        const runDir = path.join(this.baseDir, 'runs', id);

        await fs.mkdir(runDir, { recursive: true });

        // Write run metadata
        const metadata = {
            runId: id,
            createdAt: new Date().toISOString(),
            status: 'in_progress'
        };
        await fs.writeFile(
            path.join(runDir, 'metadata.json'),
            JSON.stringify(metadata, null, 2)
        );

        return new RunArtifacts(runDir, id);
    }

    /**
     * Get artifacts for an existing run
     */
    getRun(runId: RunId): RunArtifacts {
        const runDir = path.join(this.baseDir, 'runs', runId);
        return new RunArtifacts(runDir, runId);
    }

    /**
     * List all runs
     */
    async listRuns(): Promise<{ runId: RunId; createdAt: string; status: string }[]> {
        const runsDir = path.join(this.baseDir, 'runs');
        const runs: { runId: RunId; createdAt: string; status: string }[] = [];

        try {
            const entries = await fs.readdir(runsDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    try {
                        const metadataPath = path.join(runsDir, entry.name, 'metadata.json');
                        const content = await fs.readFile(metadataPath, 'utf-8');
                        const metadata = JSON.parse(content);
                        runs.push({
                            runId: entry.name,
                            createdAt: metadata.createdAt,
                            status: metadata.status
                        });
                    } catch {
                        // Skip runs without valid metadata
                        runs.push({
                            runId: entry.name,
                            createdAt: 'unknown',
                            status: 'unknown'
                        });
                    }
                }
            }
        } catch {
            // Runs directory doesn't exist yet
        }

        // Sort by creation date (newest first)
        return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    /**
     * Update run status
     */
    async updateRunStatus(runId: RunId, status: 'in_progress' | 'completed' | 'failed'): Promise<void> {
        const metadataPath = path.join(this.baseDir, 'runs', runId, 'metadata.json');

        try {
            const content = await fs.readFile(metadataPath, 'utf-8');
            const metadata = JSON.parse(content);
            metadata.status = status;
            metadata.updatedAt = new Date().toISOString();
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        } catch {
            // Create metadata if it doesn't exist
            const metadata = {
                runId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status
            };
            await fs.mkdir(path.dirname(metadataPath), { recursive: true });
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        }
    }

    /**
     * Delete a run and all its artifacts
     */
    async deleteRun(runId: RunId): Promise<void> {
        const runDir = path.join(this.baseDir, 'runs', runId);
        await fs.rm(runDir, { recursive: true, force: true });
    }

    /**
     * Clean up old runs
     */
    async cleanup(olderThanDays: number): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

        const runs = await this.listRuns();
        let deletedCount = 0;

        for (const run of runs) {
            if (run.createdAt !== 'unknown') {
                const runDate = new Date(run.createdAt);
                if (runDate < cutoffDate) {
                    await this.deleteRun(run.runId);
                    deletedCount++;
                }
            }
        }

        return deletedCount;
    }

    /**
     * Get total size of all artifacts
     */
    async getTotalSize(): Promise<number> {
        let totalSize = 0;
        const runs = await this.listRuns();

        for (const run of runs) {
            const artifacts = await this.getRun(run.runId).listArtifacts();
            for (const artifact of artifacts) {
                totalSize += artifact.size || 0;
            }
        }

        return totalSize;
    }

    /**
     * Get the base directory
     */
    getBaseDir(): string {
        return this.baseDir;
    }
}

/**
 * Create artifact store with default location
 */
export function createArtifactStore(projectDir: string): ArtifactStore {
    const storeDir = path.join(projectDir, '.mcp-artifacts');
    return new ArtifactStore(storeDir);
}
