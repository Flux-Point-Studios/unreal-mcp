/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\report-server.ts
 *
 * Embedded Report Server - Serve test reports and artifacts
 *
 * This module provides a simple HTTP server for viewing test results generated
 * by the CI/CD pipeline. It serves:
 * - A list of all test runs with their status and metadata
 * - Individual run details including all artifacts
 * - Artifact files (JSON, logs, images, etc.)
 * - A responsive HTML interface for browsing results
 *
 * Used by: runner daemon, CI robot, workflow orchestrator
 * Depends on: artifact-store.ts for accessing stored run data
 */

import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ArtifactStore } from './artifact-store.js';

export interface ReportServerConfig {
    port: number;
    artifactStore: ArtifactStore;
    autoOpen?: boolean;
}

/**
 * Report Server - Simple HTTP server for viewing test results
 */
export class ReportServer {
    private config: ReportServerConfig;
    private server: http.Server | null = null;
    private isRunning: boolean = false;

    constructor(config: ReportServerConfig) {
        this.config = config;
    }

    /**
     * Start the server
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            console.log('[ReportServer] Already running');
            return;
        }

        this.server = http.createServer(async (req, res) => {
            await this.handleRequest(req, res);
        });

        return new Promise((resolve, reject) => {
            this.server!.listen(this.config.port, () => {
                this.isRunning = true;
                console.log(`[ReportServer] Listening on http://localhost:${this.config.port}`);

                if (this.config.autoOpen) {
                    this.openBrowser();
                }

                resolve();
            });

            this.server!.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Stop the server
     */
    async stop(): Promise<void> {
        if (!this.server || !this.isRunning) {
            return;
        }

        return new Promise((resolve) => {
            this.server!.close(() => {
                this.isRunning = false;
                console.log('[ReportServer] Stopped');
                resolve();
            });
        });
    }

    /**
     * Handle incoming requests
     */
    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const url = new URL(req.url || '/', `http://localhost:${this.config.port}`);
        const pathname = url.pathname;

        try {
            // API Routes
            if (pathname === '/api/runs') {
                await this.handleListRuns(res);
            } else if (pathname.startsWith('/api/runs/') && !pathname.includes('/artifacts/')) {
                const runId = pathname.split('/')[3];
                await this.handleGetRun(res, runId);
            } else if (pathname.includes('/artifacts/')) {
                const parts = pathname.split('/artifacts/');
                const runId = parts[0].split('/').pop()!;
                const artifactPath = parts[1];
                await this.handleGetArtifact(res, runId, artifactPath);
            } else if (pathname === '/' || pathname === '/index.html') {
                await this.handleIndex(res);
            } else {
                this.send404(res);
            }
        } catch (err) {
            console.error('[ReportServer] Error:', err);
            this.sendError(res, 500, 'Internal Server Error');
        }
    }

    /**
     * GET /api/runs - List all test runs
     */
    private async handleListRuns(res: http.ServerResponse): Promise<void> {
        const runs = await this.config.artifactStore.listRuns();
        this.sendJson(res, { runs });
    }

    /**
     * GET /api/runs/:id - Get specific run details
     */
    private async handleGetRun(res: http.ServerResponse, runId: string): Promise<void> {
        const runArtifacts = this.config.artifactStore.getRun(runId);

        try {
            const artifacts = await runArtifacts.listArtifacts();
            const metadata = await runArtifacts.exists('metadata.json')
                ? await runArtifacts.readJSON('metadata.json')
                : null;

            this.sendJson(res, {
                runId,
                metadata,
                artifacts
            });
        } catch {
            this.send404(res);
        }
    }

    /**
     * GET /api/runs/:id/artifacts/:path - Serve artifact file
     */
    private async handleGetArtifact(
        res: http.ServerResponse,
        runId: string,
        artifactPath: string
    ): Promise<void> {
        const runArtifacts = this.config.artifactStore.getRun(runId);
        const fullPath = runArtifacts.getPath(artifactPath);

        try {
            const content = await fs.readFile(fullPath);
            const contentType = this.getContentType(artifactPath);

            res.setHeader('Content-Type', contentType);
            res.end(content);
        } catch {
            this.send404(res);
        }
    }

    /**
     * Serve index HTML page
     */
    private async handleIndex(res: http.ServerResponse): Promise<void> {
        const html = this.generateIndexHtml();
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
    }

    /**
     * Generate index HTML with run list
     */
    private generateIndexHtml(): string {
        return `<!DOCTYPE html>
<html>
<head>
    <title>MCP CI Robot - Test Reports</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #333; }
        .runs { display: grid; gap: 10px; }
        .run { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .run:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
        .run-id { font-weight: bold; color: #0066cc; }
        .run-date { color: #666; font-size: 14px; }
        .run-status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
        .run-status.completed { background: #d4edda; color: #155724; }
        .run-status.failed { background: #f8d7da; color: #721c24; }
        .run-status.in_progress { background: #fff3cd; color: #856404; }
        a { text-decoration: none; color: inherit; }
        .loading { text-align: center; padding: 40px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>MCP CI Robot - Test Reports</h1>
        <div id="runs" class="runs">
            <div class="loading">Loading runs...</div>
        </div>
    </div>
    <script>
        async function loadRuns() {
            try {
                const response = await fetch('/api/runs');
                const data = await response.json();
                const container = document.getElementById('runs');

                if (data.runs.length === 0) {
                    container.innerHTML = '<p>No test runs yet.</p>';
                    return;
                }

                container.innerHTML = data.runs.map(run => \`
                    <a href="/api/runs/\${run.runId}" class="run">
                        <div class="run-id">\${run.runId}</div>
                        <div class="run-date">\${new Date(run.createdAt).toLocaleString()}</div>
                        <span class="run-status \${run.status}">\${run.status}</span>
                    </a>
                \`).join('');
            } catch (err) {
                document.getElementById('runs').innerHTML = '<p>Error loading runs: ' + err.message + '</p>';
            }
        }
        loadRuns();
    </script>
</body>
</html>`;
    }

    /**
     * Send JSON response
     */
    private sendJson(res: http.ServerResponse, data: unknown): void {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data, null, 2));
    }

    /**
     * Send 404 response
     */
    private send404(res: http.ServerResponse): void {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Not Found' }));
    }

    /**
     * Send error response
     */
    private sendError(res: http.ServerResponse, code: number, message: string): void {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: message }));
    }

    /**
     * Get content type from file extension
     */
    private getContentType(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        const types: Record<string, string> = {
            '.json': 'application/json',
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.log': 'text/plain',
            '.txt': 'text/plain'
        };
        return types[ext] || 'application/octet-stream';
    }

    /**
     * Open browser (platform-specific)
     */
    private openBrowser(): void {
        const url = `http://localhost:${this.config.port}`;
        const platform = process.platform;

        let command: string;
        if (platform === 'win32') {
            command = `start ${url}`;
        } else if (platform === 'darwin') {
            command = `open ${url}`;
        } else {
            command = `xdg-open ${url}`;
        }

        import('child_process').then(cp => {
            cp.exec(command, (err) => {
                if (err) {
                    console.log(`[ReportServer] Open browser manually: ${url}`);
                }
            });
        });
    }

    /**
     * Get server URL
     */
    getUrl(): string {
        return `http://localhost:${this.config.port}`;
    }

    /**
     * Check if server is running
     */
    isServerRunning(): boolean {
        return this.isRunning;
    }
}

/**
 * Create and start a report server
 */
export async function createReportServer(
    artifactStore: ArtifactStore,
    port: number = 8080,
    autoOpen: boolean = false
): Promise<ReportServer> {
    const server = new ReportServer({
        port,
        artifactStore,
        autoOpen
    });

    await server.start();
    return server;
}
