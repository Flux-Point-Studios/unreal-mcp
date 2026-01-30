/**
 * BuildGraph Executor - Execute BuildGraph scripts for parallel deterministic builds
 *
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\buildgraph-executor.ts
 *
 * This file provides a TypeScript wrapper for executing Unreal BuildGraph scripts.
 * BuildGraph is Epic's build orchestration system that enables parallel, deterministic
 * builds with proper dependency management between nodes.
 *
 * IMPORTANT: Use -Set: prefix for passing options (not positional arguments)
 * Use -ListOnly for validation without execution
 *
 * Used by: CI robot modules, workflow orchestrator, build pipeline handlers
 */

import { UATRunner } from './uat-runner.js';
import { BuildGraphOptions, BuildGraphResult, ValidationResult, NodeResult, ArtifactInfo } from './types.js';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * BuildGraph Executor - Run BuildGraph scripts via UAT
 */
export class BuildGraphExecutor {
    private _enginePath: string;
    private projectPath: string;
    private uatRunner: UATRunner;

    constructor(enginePath: string, projectPath: string) {
        this._enginePath = enginePath;
        this.projectPath = projectPath;
        this.uatRunner = new UATRunner(enginePath, projectPath);
    }

    /**
     * Execute a BuildGraph script
     */
    async execute(
        scriptPath: string,
        targets: string[],
        options: BuildGraphOptions = {}
    ): Promise<BuildGraphResult> {
        const startTime = Date.now();

        // Build command line args using -Set: prefix (CORRECT mechanism)
        const args = this.buildArgs(scriptPath, targets, options);

        console.log(`[BuildGraph] Executing: ${targets.join('+')}`);
        console.log(`[BuildGraph] Script: ${scriptPath}`);
        console.log(`[BuildGraph] Options: ${JSON.stringify(options)}`);

        const result = await this.uatRunner.run('BuildGraph', args, {
            timeout: options.timeout || 3600000  // 1 hour default for builds
        });

        return {
            success: result.exitCode === 0,
            nodes: this.parseNodeResults(result.stdout),
            artifacts: await this.collectArtifacts(result),
            duration: Date.now() - startTime,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr
        };
    }

    /**
     * Validate a BuildGraph script without executing (fail fast)
     */
    async validate(scriptPath: string, targets: string[]): Promise<ValidationResult> {
        const args = [
            `-Script="${scriptPath}"`,
            `-Target="${targets.join('+')}"`,
            '-ListOnly'  // Just validate and list nodes, don't execute
        ];

        console.log(`[BuildGraph] Validating script: ${scriptPath}`);

        const result = await this.uatRunner.run('BuildGraph', args, {
            timeout: 60000  // 1 minute for validation
        });

        return {
            valid: result.exitCode === 0,
            availableNodes: this.parseAvailableNodes(result.stdout),
            errors: this.parseErrors(result.stderr)
        };
    }

    /**
     * Generate BuildGraph schema for documentation
     */
    async generateSchema(outputPath: string): Promise<void> {
        const args = [`-Schema="${outputPath}"`];

        console.log(`[BuildGraph] Generating schema to: ${outputPath}`);

        await this.uatRunner.run('BuildGraph', args);
    }

    /**
     * Build command line arguments
     * IMPORTANT: Use -Set: prefix for all custom options
     */
    private buildArgs(scriptPath: string, targets: string[], options: BuildGraphOptions): string[] {
        const args: string[] = [
            `-Script="${scriptPath}"`,
            `-Target="${targets.join('+')}"`,
            // Use -Set: prefix for passing options (official mechanism)
            `-Set:ProjectPath="${this.projectPath}"`
        ];

        // Platform
        if (options.platform) {
            args.push(`-Set:Platform=${options.platform}`);
        } else {
            args.push('-Set:Platform=Win64');
        }

        // Configuration
        if (options.configuration) {
            args.push(`-Set:Configuration=${options.configuration}`);
        }

        // Shared DDC
        if (options.sharedDDC) {
            args.push(`-Set:SharedStorageDir="${options.sharedDDC}"`);
        }

        // Perforce integration
        if (options.noP4) {
            args.push('-NoP4');
        } else {
            args.push('-P4');
        }

        // Distributed build
        if (options.distributedBuild) {
            args.push('-DistributedBuild');
        }

        // Additional arguments
        if (options.additionalArgs) {
            args.push(...options.additionalArgs);
        }

        return args;
    }

    /**
     * Parse node results from stdout
     */
    private parseNodeResults(stdout: string): NodeResult[] {
        const nodes: NodeResult[] = [];
        const lines = stdout.split('\n');

        // Look for node execution patterns
        // Format varies but typically: "Running node X..." followed by success/failure
        let currentNode: Partial<NodeResult> | null = null;

        for (const line of lines) {
            // Detect node start
            const startMatch = line.match(/Running (?:node |)['"]?(\w+)['"]?/i);
            if (startMatch) {
                if (currentNode && currentNode.name) {
                    // Previous node finished (assume success if we got to next)
                    nodes.push({
                        name: currentNode.name,
                        success: true,
                        duration: 0,
                        output: currentNode.output
                    });
                }
                currentNode = { name: startMatch[1], output: '' };
                continue;
            }

            // Detect node completion
            const completeMatch = line.match(/(?:Completed|Finished) (?:node |)['"]?(\w+)['"]?/i);
            if (completeMatch && currentNode) {
                nodes.push({
                    name: currentNode.name || completeMatch[1],
                    success: true,
                    duration: 0,
                    output: currentNode.output
                });
                currentNode = null;
                continue;
            }

            // Detect node failure
            const failMatch = line.match(/(?:Failed|Error in) (?:node |)['"]?(\w+)['"]?/i);
            if (failMatch && currentNode) {
                nodes.push({
                    name: currentNode.name || failMatch[1],
                    success: false,
                    duration: 0,
                    output: currentNode.output
                });
                currentNode = null;
                continue;
            }

            // Accumulate output for current node
            if (currentNode) {
                currentNode.output = (currentNode.output || '') + line + '\n';
            }
        }

        // Handle last node if not explicitly finished
        if (currentNode && currentNode.name) {
            nodes.push({
                name: currentNode.name,
                success: true,
                duration: 0,
                output: currentNode.output
            });
        }

        return nodes;
    }

    /**
     * Parse available nodes from -ListOnly output
     */
    private parseAvailableNodes(stdout: string): string[] {
        const nodes: string[] = [];
        const lines = stdout.split('\n');

        for (const line of lines) {
            // Look for node listings - format varies
            const nodeMatch = line.match(/^\s*(?:Node:|-)?\s*['"]?(\w+)['"]?\s*$/);
            if (nodeMatch) {
                nodes.push(nodeMatch[1]);
            }

            // Also check for graph node format
            const graphMatch = line.match(/Node\s+['"]?(\w+)['"]?/);
            if (graphMatch && !nodes.includes(graphMatch[1])) {
                nodes.push(graphMatch[1]);
            }
        }

        return nodes;
    }

    /**
     * Parse errors from stderr
     */
    private parseErrors(stderr: string): string[] {
        const errors: string[] = [];
        const lines = stderr.split('\n');

        for (const line of lines) {
            if (line.toLowerCase().includes('error') ||
                line.toLowerCase().includes('failed') ||
                line.toLowerCase().includes('exception')) {
                errors.push(line.trim());
            }
        }

        return errors;
    }

    /**
     * Collect build artifacts
     */
    private async collectArtifacts(result: { stdout: string; stderr: string; logPath?: string }): Promise<ArtifactInfo[]> {
        const artifacts: ArtifactInfo[] = [];

        // Add log file if available
        if (result.logPath) {
            artifacts.push({
                name: 'build_log',
                path: result.logPath,
                type: 'text/plain'
            });
        }

        // Look for artifact paths mentioned in stdout
        const pathMatches = result.stdout.match(/(?:Output|Created|Built):\s*["']?([^\s"'\n]+)/gi);
        if (pathMatches) {
            for (const match of pathMatches) {
                const pathMatch = match.match(/["']?([^\s"'\n]+)["']?$/);
                if (pathMatch) {
                    const artifactPath = pathMatch[1];
                    try {
                        const stats = await fs.stat(artifactPath);
                        artifacts.push({
                            name: path.basename(artifactPath),
                            path: artifactPath,
                            size: stats.size
                        });
                    } catch {
                        // Artifact doesn't exist or not accessible
                    }
                }
            }
        }

        return artifacts;
    }
}

/**
 * Create a BuildGraph executor
 */
export function createBuildGraphExecutor(enginePath: string, projectPath: string): BuildGraphExecutor {
    return new BuildGraphExecutor(enginePath, projectPath);
}

/**
 * Sample BuildGraph XML script template
 */
export const SAMPLE_BUILDGRAPH_SCRIPT = `<?xml version='1.0' ?>
<BuildGraph xmlns="http://www.epicgames.com/BuildGraph">
    <!-- Declare options that can be passed via -Set: -->
    <Option Name="ProjectPath" DefaultValue="" Description="Path to .uproject file"/>
    <Option Name="Platform" DefaultValue="Win64" Description="Target platform"/>
    <Option Name="Configuration" DefaultValue="Development" Description="Build configuration"/>
    <Option Name="SharedStorageDir" DefaultValue="" Description="Shared DDC path"/>

    <Agent Name="CompileAgent" Type="$(Platform)">
        <Node Name="CompileEditor" Produces="#EditorBinaries">
            <Compile Target="UnrealEditor" Platform="$(Platform)" Configuration="$(Configuration)"
                     Arguments="-Project=$(ProjectPath)"/>
        </Node>
    </Agent>

    <Agent Name="CookAgent" Type="$(Platform)">
        <Node Name="CookContent" Requires="#EditorBinaries" Produces="#CookedContent">
            <Cook Project="$(ProjectPath)" Platform="$(Platform)"/>
        </Node>

        <Node Name="CompileAllBlueprints" Requires="#EditorBinaries">
            <Command Name="CompileAllBlueprints" Arguments="-Project=$(ProjectPath)"/>
        </Node>
    </Agent>

    <Agent Name="TestAgent" Type="$(Platform)">
        <Node Name="RunAutomationTests" Requires="#EditorBinaries">
            <Command Name="RunAutomationTests" Arguments="-Project=$(ProjectPath) -Filter=Project."/>
        </Node>
    </Agent>
</BuildGraph>`;

/**
 * Write a sample BuildGraph script to disk
 */
export async function createSampleBuildGraphScript(outputPath: string): Promise<void> {
    await fs.writeFile(outputPath, SAMPLE_BUILDGRAPH_SCRIPT, 'utf-8');
}
