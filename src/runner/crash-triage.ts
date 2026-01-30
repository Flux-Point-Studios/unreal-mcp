/**
 * Location: D:\fluxPoint\clay-mini-game\Unreal_mcp\src\runner\crash-triage.ts
 *
 * Crash Triage - Intelligent crash analysis with GPU-aware debugging
 *
 * IMPORTANT: CPU callstacks are often useless for GPU crashes.
 * This module provides GPU-specific debugging workflows and actionable recommendations.
 *
 * Used by: MCP runner daemon, CI robot, test harness
 * Works with: types.ts (CrashReport, CrashType, GPUErrorType)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { CrashReport, GPUErrorType } from './types.js';

/**
 * GPU crash detection patterns
 */
const GPU_CRASH_PATTERNS = [
    'GPU crashed',
    'D3D Device Lost',
    'DXGI_ERROR',
    'GPU hang',
    'TDR',
    'Timeout Detection and Recovery',
    'VK_ERROR_DEVICE_LOST',
    'GPU Breadcrumb',
    'DXGI_ERROR_DEVICE_REMOVED',
    'DXGI_ERROR_DEVICE_HUNG',
    'DXGI_ERROR_DEVICE_RESET'
];

/**
 * Assert detection patterns
 */
const ASSERT_PATTERNS = [
    'Assertion failed',
    'check failed',
    'ensure failed',
    'Fatal error',
    'Unhandled Exception'
];

/**
 * Crash Triager - Analyzes crashes and provides actionable intelligence
 */
export class CrashTriager {
    private crashDir: string;

    constructor(crashDir: string) {
        this.crashDir = crashDir;
    }

    /**
     * Main triage entry point
     */
    async triage(crashDirOverride?: string): Promise<CrashReport> {
        const dir = crashDirOverride || this.crashDir;

        const report: CrashReport = {
            type: 'UNKNOWN',
            callstack: [],
            relevantLogs: [],
            nextActions: [],
            timestamp: new Date().toISOString()
        };

        try {
            // Parse logs first (helps classify)
            const logs = await this.parseLogs(dir);
            report.relevantLogs = this.extractRelevantLines(logs);

            // Classify crash type
            if (this.isGPUCrash(logs)) {
                report.type = 'GPU';
                await this.triageGPUCrash(dir, logs, report);
            } else if (this.isAssert(logs)) {
                report.type = 'ASSERT';
                report.suggestedCause = this.extractAssertMessage(logs);
                report.nextActions = [
                    'Check assert condition in source code',
                    'Review stack trace for context',
                    'Check recent code changes affecting this area'
                ];
                report.callstack = this.extractCallstack(logs);
            } else if (this.isHang(logs)) {
                report.type = 'HANG';
                report.suggestedCause = 'Application hang detected (possible deadlock or infinite loop)';
                report.nextActions = [
                    'Check for deadlocks in threading code',
                    'Look for infinite loops in recent changes',
                    'Profile CPU usage to find hotspots',
                    'Check for blocking I/O operations'
                ];
            } else {
                // CPU crash - parse minidump
                const minidump = await this.findMinidump(dir);
                if (minidump) {
                    report.type = 'CPU';
                    report.minidumpPath = minidump;
                    report.callstack = await this.parseMinidump(minidump);
                    report.nextActions = [
                        'Analyze callstack for null pointer dereference',
                        'Check for memory corruption',
                        'Review recent code changes',
                        'Run with AddressSanitizer if reproducible'
                    ];
                }
            }

            // Add common debugging recommendations
            this.addCommonRecommendations(report);

        } catch (err) {
            report.nextActions.push(`Triage error: ${err instanceof Error ? err.message : String(err)}`);
        }

        return report;
    }

    /**
     * Parse log files from crash directory
     */
    private async parseLogs(dir: string): Promise<string[]> {
        const logs: string[] = [];

        try {
            const files = await fs.readdir(dir);

            for (const file of files) {
                if (file.endsWith('.log') || file.endsWith('.txt')) {
                    const content = await fs.readFile(path.join(dir, file), 'utf-8');
                    logs.push(...content.split('\n'));
                }
            }
        } catch {
            // Directory might not exist or be readable
        }

        return logs;
    }

    /**
     * Extract relevant log lines (errors, warnings, crash info)
     */
    private extractRelevantLines(logs: string[]): string[] {
        const relevant: string[] = [];
        const keywords = ['error', 'fatal', 'crash', 'exception', 'assert', 'failed', 'gpu', 'd3d', 'dxgi'];

        for (const line of logs) {
            const lower = line.toLowerCase();
            if (keywords.some(kw => lower.includes(kw))) {
                relevant.push(line.trim());
            }
        }

        // Limit to most recent 50 relevant lines
        return relevant.slice(-50);
    }

    /**
     * Check if this is a GPU crash
     */
    private isGPUCrash(logs: string[]): boolean {
        const joined = logs.join('\n');
        return GPU_CRASH_PATTERNS.some(pattern =>
            joined.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    /**
     * Check if this is an assert failure
     */
    private isAssert(logs: string[]): boolean {
        const joined = logs.join('\n');
        return ASSERT_PATTERNS.some(pattern =>
            joined.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    /**
     * Check if this is a hang
     */
    private isHang(logs: string[]): boolean {
        const joined = logs.join('\n').toLowerCase();
        return joined.includes('hang') ||
               joined.includes('deadlock') ||
               joined.includes('not responding');
    }

    /**
     * GPU-specific crash triage
     */
    private async triageGPUCrash(dir: string, logs: string[], report: CrashReport): Promise<void> {
        // GPU crashes need special handling - CPU callstack is often useless
        report.suggestedCause = 'GPU crash - CPU callstack may not be useful';

        // Look for GPU-specific artifacts
        report.gpuCrashDump = await this.findGPUDump(dir);

        // Extract GPU breadcrumbs if available
        report.gpuBreadcrumbs = this.extractGPUBreadcrumbs(logs);

        // Classify the GPU error type
        report.gpuErrorType = this.classifyGPUError(logs);

        // Actionable next steps based on Epic's GPU crash debugging guide
        report.nextActions = [
            'Enable GPU crash debugging: r.GPUCrashDebugging=1',
            'Check shader compilation errors in log',
            'Verify GPU memory usage (VRAM exhaustion?)',
            'Test with -d3ddebug for D3D validation',
            'Check driver version and stability'
        ];

        // Add specific recommendations based on error type
        switch (report.gpuErrorType) {
            case 'DEVICE_LOST':
                report.nextActions.unshift('D3D Device Lost - often driver timeout (TDR)');
                report.nextActions.push('Consider increasing TDR timeout in registry');
                report.nextActions.push('Check for infinite shader loops');
                break;
            case 'OUT_OF_MEMORY':
                report.nextActions.unshift('GPU out of memory - reduce texture/mesh quality');
                report.nextActions.push('Profile VRAM usage with RenderDoc or PIX');
                report.nextActions.push('Check for texture streaming issues');
                break;
            case 'SHADER':
                report.nextActions.unshift('Shader error - check material/shader code');
                report.nextActions.push('Validate shader with FXC/DXC compiler');
                report.nextActions.push('Check for shader permutation explosions');
                break;
        }
    }

    /**
     * Classify GPU error type
     */
    private classifyGPUError(logs: string[]): GPUErrorType {
        const joined = logs.join('\n').toLowerCase();

        if (joined.includes('dxgi_error_device_removed') ||
            joined.includes('vk_error_device_lost') ||
            joined.includes('device lost')) {
            return 'DEVICE_LOST';
        }

        if (joined.includes('out of memory') ||
            joined.includes('dxgi_error_device_hung') ||
            joined.includes('vram')) {
            return 'OUT_OF_MEMORY';
        }

        if (joined.includes('shader') &&
            (joined.includes('error') || joined.includes('failed'))) {
            return 'SHADER';
        }

        return 'UNKNOWN';
    }

    /**
     * Extract GPU breadcrumbs from logs
     */
    private extractGPUBreadcrumbs(logs: string[]): string[] {
        const breadcrumbs: string[] = [];

        for (const line of logs) {
            if (line.toLowerCase().includes('breadcrumb') ||
                line.toLowerCase().includes('gpu marker')) {
                breadcrumbs.push(line.trim());
            }
        }

        return breadcrumbs;
    }

    /**
     * Find GPU crash dump file
     */
    private async findGPUDump(dir: string): Promise<string | undefined> {
        try {
            const files = await fs.readdir(dir);
            const gpuDump = files.find(f =>
                f.includes('gpu') || f.includes('d3d') || f.endsWith('.gpudmp')
            );
            return gpuDump ? path.join(dir, gpuDump) : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Find minidump file
     */
    private async findMinidump(dir: string): Promise<string | undefined> {
        try {
            const files = await fs.readdir(dir);
            const minidump = files.find(f => f.endsWith('.dmp') || f.endsWith('.mdmp'));
            return minidump ? path.join(dir, minidump) : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Parse minidump for callstack (simplified - real impl would use WinDbg/minidump-stackwalk)
     */
    private async parseMinidump(dumpPath: string): Promise<string[]> {
        // In a real implementation, this would:
        // 1. Use minidump-stackwalk or WinDbg to parse the dump
        // 2. Symbolicate addresses using PDB files
        // For now, return a placeholder
        return [
            `Minidump found at: ${dumpPath}`,
            'Use WinDbg or Visual Studio to analyze:',
            `  windbg -z "${dumpPath}"`,
            'Or use minidump-stackwalk with symbols'
        ];
    }

    /**
     * Extract callstack from logs
     */
    private extractCallstack(logs: string[]): string[] {
        const callstack: string[] = [];
        let inCallstack = false;

        for (const line of logs) {
            if (line.includes('Call stack') || line.includes('Stack trace')) {
                inCallstack = true;
                continue;
            }
            if (inCallstack) {
                if (line.trim() === '' || line.includes('---')) {
                    inCallstack = false;
                    continue;
                }
                callstack.push(line.trim());
            }
        }

        return callstack;
    }

    /**
     * Extract assert message from logs
     */
    private extractAssertMessage(logs: string[]): string {
        for (const line of logs) {
            const lower = line.toLowerCase();
            if (lower.includes('assertion') || lower.includes('assert') || lower.includes('check failed')) {
                return line.trim();
            }
        }
        return 'Assert condition not found in logs';
    }

    /**
     * Add common debugging recommendations
     */
    private addCommonRecommendations(report: CrashReport): void {
        report.nextActions.push('Check UE crash reporter uploads at crashreporter.epicgames.com');
        report.nextActions.push('Review Saved/Logs/ for additional context');
    }
}

/**
 * Quick triage function
 */
export async function triageCrash(crashDir: string): Promise<CrashReport> {
    const triager = new CrashTriager(crashDir);
    return triager.triage();
}

/**
 * Format crash report for display
 */
export function formatCrashReport(report: CrashReport): string {
    const lines: string[] = [
        '=== CRASH TRIAGE REPORT ===',
        `Type: ${report.type}`,
        `Timestamp: ${report.timestamp || 'Unknown'}`,
        ''
    ];

    if (report.suggestedCause) {
        lines.push(`Suggested Cause: ${report.suggestedCause}`);
        lines.push('');
    }

    if (report.gpuErrorType && report.gpuErrorType !== 'UNKNOWN') {
        lines.push(`GPU Error Type: ${report.gpuErrorType}`);
        lines.push('');
    }

    if (report.callstack.length > 0) {
        lines.push('Callstack:');
        for (const frame of report.callstack.slice(0, 20)) {
            lines.push(`  ${frame}`);
        }
        lines.push('');
    }

    if (report.gpuBreadcrumbs && report.gpuBreadcrumbs.length > 0) {
        lines.push('GPU Breadcrumbs:');
        for (const crumb of report.gpuBreadcrumbs) {
            lines.push(`  ${crumb}`);
        }
        lines.push('');
    }

    lines.push('Next Actions:');
    for (const action of report.nextActions) {
        lines.push(`  - ${action}`);
    }

    return lines.join('\n');
}
