/**
 * Acceptance Criteria Store
 *
 * Machine-readable design contract for the current project.
 * Set via the validate tool, read via ue://acceptance-criteria resource.
 *
 * Stores: genre, camera, platforms, performance budget, naming conventions,
 * accessibility requirements, constraints, and custom fields.
 */

export interface PerformanceBudget {
    targetFps?: number;
    maxMemoryMb?: number;
    maxDrawCalls?: number;
    maxTriangleCount?: number;
}

export interface NamingConventions {
    blueprintPrefix?: string;
    materialPrefix?: string;
    texturePrefix?: string;
    staticMeshPrefix?: string;
    skeletalMeshPrefix?: string;
    widgetPrefix?: string;
    levelPrefix?: string;
    [key: string]: string | undefined;
}

export interface AcceptanceCriteriaData {
    /** Game genre (e.g., top-down-shooter, survival, platformer). */
    genre?: string;
    /** Camera style (e.g., orthographic-top-down, third-person, first-person). */
    camera?: string;
    /** Target platforms. */
    platforms?: string[];
    /** Performance targets. */
    performanceBudget?: PerformanceBudget;
    /** Asset naming convention rules. */
    namingConventions?: NamingConventions;
    /** Movement/feel targets. */
    movementFeel?: Record<string, unknown>;
    /** UI style guidelines. */
    uiStyle?: Record<string, unknown>;
    /** Accessibility requirements. */
    accessibility?: string[];
    /** Hard constraints. */
    constraints?: string[];
    /** Accepted plugins. */
    acceptedPlugins?: string[];
    /** Custom fields. */
    [key: string]: unknown;
}

class AcceptanceCriteriaStore {
    private data: AcceptanceCriteriaData | null = null;

    /**
     * Set or merge acceptance criteria.
     * Pass `replace: true` to overwrite entirely; otherwise merges.
     */
    set(criteria: AcceptanceCriteriaData, replace = false): void {
        if (replace || !this.data) {
            this.data = { ...criteria };
        } else {
            this.data = { ...this.data, ...criteria };
        }
    }

    /** Get current acceptance criteria (or null if not set). */
    get(): AcceptanceCriteriaData | null {
        return this.data ? { ...this.data } : null;
    }

    /** Check if criteria have been set. */
    isSet(): boolean {
        return this.data !== null;
    }

    /** Clear all criteria. */
    clear(): void {
        this.data = null;
    }
}

/** Singleton instance. */
export const acceptanceCriteria = new AcceptanceCriteriaStore();
