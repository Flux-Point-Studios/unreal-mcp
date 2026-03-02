/**
 * UE 5.7 Documentation Context System
 *
 * Provides curated API documentation that can be queried by category,
 * keyword, or tool name to inject relevant context into MCP interactions.
 */

import { blueprintContext } from './docs/blueprint.js';
import { animationContext } from './docs/animation.js';
import { actorContext } from './docs/actor.js';
import { materialsContext } from './docs/materials.js';
import { niagaraContext } from './docs/niagara.js';
import { enhancedInputContext } from './docs/enhanced-input.js';
import { networkingContext } from './docs/networking.js';
import { gasContext } from './docs/gas.js';
import { worldBuildingContext } from './docs/world-building.js';
import { sequencerContext } from './docs/sequencer.js';

/**
 * A context category containing curated UE 5.7 API documentation.
 */
export interface ContextCategory {
  /** Unique identifier for this context category (e.g., "blueprint", "animation"). */
  name: string;
  /** Human-readable description of what this context covers. */
  description: string;
  /** Keywords used for fuzzy matching when searching for relevant context. */
  keywords: string[];
  /** The full documentation content string. */
  content: string;
}

/**
 * All registered context categories.
 */
const CATEGORIES: ContextCategory[] = [
  {
    name: 'blueprint',
    description: 'Blueprint API: K2Nodes, pins, graph manipulation, compilation, and FBlueprintEditorUtils',
    keywords: [
      'blueprint', 'k2node', 'edgraph', 'edgraphpin', 'edgraphnode',
      'kismet', 'compilier', 'function graph', 'event graph', 'variable',
      'pin', 'node', 'graph', 'ubergraph', 'macro', 'cast',
      'blueprinteditorutils', 'blueprintgeneratedclass',
    ],
    content: blueprintContext,
  },
  {
    name: 'animation',
    description: 'Animation API: UAnimInstance, state machines, montages, blend spaces, control rigs, IK, retargeting',
    keywords: [
      'animation', 'anim', 'animinstance', 'montage', 'blendspace',
      'statemachine', 'state machine', 'ik', 'fabrik', 'twoboneik',
      'controlrig', 'control rig', 'retarget', 'skeleton', 'animsequence',
      'animnode', 'animblueprint', 'slot', 'notify', 'curve',
      'locomotion', 'inertialization',
    ],
    content: animationContext,
  },
  {
    name: 'actor',
    description: 'Actor/Component API: AActor lifecycle, component hierarchy, spawning, attachment, transforms',
    keywords: [
      'actor', 'component', 'scenecomponent', 'primitivecomponent',
      'staticmeshcomponent', 'skeletalmeshcomponent', 'spawn', 'beginplay',
      'tick', 'endplay', 'transform', 'location', 'rotation', 'scale',
      'attachment', 'mobility', 'collision', 'overlap', 'hit',
      'createdefaultsubobject', 'rootcomponent', 'childactor',
    ],
    content: actorContext,
  },
  {
    name: 'materials',
    description: 'Material API: UMaterial, UMaterialInstance, expressions, shading models, parameters, Nanite/Lumen',
    keywords: [
      'material', 'materialinstance', 'materialinstancedynamic', 'mid',
      'shader', 'shading', 'blend mode', 'opaque', 'translucent', 'masked',
      'basecolor', 'roughness', 'metallic', 'normal', 'emissive',
      'texture', 'expression', 'parameter', 'nanite', 'lumen',
      'substrate', 'strata', 'materialfunction', 'mpc',
    ],
    content: materialsContext,
  },
  {
    name: 'niagara',
    description: 'Niagara/VFX API: UNiagaraSystem, emitters, modules, renderers, data interfaces, GPU simulation',
    keywords: [
      'niagara', 'vfx', 'particle', 'emitter', 'niagarasystem',
      'niagaracomponent', 'niagaraemitter', 'sprite', 'ribbon', 'mesh renderer',
      'data interface', 'gpu', 'module', 'spawn rate', 'curl noise',
      'fluid', 'effect', 'fx',
    ],
    content: niagaraContext,
  },
  {
    name: 'enhanced-input',
    description: 'Enhanced Input API: UInputAction, UInputMappingContext, triggers, modifiers, input values',
    keywords: [
      'input', 'enhanced input', 'inputaction', 'inputmappingcontext',
      'trigger', 'modifier', 'keybind', 'key binding', 'gamepad',
      'mouse', 'keyboard', 'dead zone', 'swizzle', 'negate',
      'pressed', 'released', 'held', 'chord', 'combo',
    ],
    content: enhancedInputContext,
  },
  {
    name: 'networking',
    description: 'Networking/Replication: property replication, RPCs, authority, prediction, relevancy, dormancy',
    keywords: [
      'network', 'networking', 'replication', 'replicate', 'replicated',
      'rpc', 'server', 'client', 'multicast', 'authority', 'authoritative',
      'prediction', 'correction', 'relevancy', 'dormancy', 'netrole',
      'doreplifetime', 'repnotify', 'iris',
    ],
    content: networkingContext,
  },
  {
    name: 'gas',
    description: 'Gameplay Ability System: abilities, effects, attributes, gameplay tags, gameplay cues',
    keywords: [
      'gas', 'gameplay ability', 'gameplayability', 'gameplayeffect',
      'abilitysystemcomponent', 'asc', 'attributeset', 'attribute',
      'gameplaytag', 'gameplaycue', 'modifier', 'cooldown', 'cost',
      'ability task', 'montage', 'setbycaller', 'stacking',
    ],
    content: gasContext,
  },
  {
    name: 'world-building',
    description: 'World/Level API: UWorld, level streaming, World Partition, data layers, HLOD, landscape, foliage',
    keywords: [
      'world', 'level', 'streaming', 'world partition', 'data layer',
      'hlod', 'landscape', 'foliage', 'terrain', 'spawn', 'trace',
      'linetrace', 'timer', 'sublevel', 'persistent level',
      'instanced foliage', 'procedural', 'heightmap',
    ],
    content: worldBuildingContext,
  },
  {
    name: 'sequencer',
    description: 'Sequencer API: ULevelSequence, UMovieScene, tracks, sections, channels, keyframes, cinematics',
    keywords: [
      'sequencer', 'sequence', 'levelsequence', 'moviescene', 'track',
      'section', 'channel', 'keyframe', 'camera', 'cinematic',
      'cutscene', 'animation', 'timeline', 'camera cut', 'event track',
      'playback', 'binding',
    ],
    content: sequencerContext,
  },
];

/**
 * Mapping from MCP tool names to context category names.
 */
const TOOL_TO_CONTEXT_MAP: Record<string, string[]> = {
  'manage_blueprint': ['blueprint'],
  'animation_physics': ['animation'],
  'control_actor': ['actor'],
  'manage_material_authoring': ['materials'],
  'manage_effect': ['niagara'],
  'manage_input': ['enhanced-input'],
  'manage_networking': ['networking'],
  'manage_gas': ['gas'],
  'build_environment': ['world-building'],
  'manage_level': ['world-building'],
  'manage_level_structure': ['world-building'],
  'manage_sequence': ['sequencer'],
  'manage_asset': ['actor', 'materials'],
  'manage_lighting': ['materials', 'world-building'],
  'manage_skeleton': ['animation'],
  'manage_texture': ['materials'],
  'manage_audio': ['actor'],
  'manage_character': ['actor', 'animation', 'enhanced-input'],
  'manage_combat': ['gas', 'animation'],
  'manage_ai': ['actor', 'world-building'],
  'manage_inventory': ['gas'],
  'manage_interaction': ['actor', 'enhanced-input'],
  'manage_widget_authoring': ['actor'],
  'manage_navigation': ['world-building', 'actor'],
  'manage_volumes': ['world-building'],
  'manage_splines': ['world-building'],
  'manage_geometry': ['materials', 'actor'],
  'manage_performance': ['niagara', 'materials'],
  'manage_game_framework': ['networking', 'gas'],
  'manage_sessions': ['networking'],
  'inspect': ['actor', 'blueprint'],
};

/**
 * Returns all registered context categories.
 */
export function getContextCategories(): ContextCategory[] {
  return [...CATEGORIES];
}

/**
 * Returns a context category by its exact name.
 */
export function getContextByCategory(category: string): ContextCategory | undefined {
  const normalized = category.toLowerCase().trim();
  return CATEGORIES.find((c) => c.name === normalized);
}

/**
 * Returns all context categories matching a keyword (case-insensitive partial match).
 */
export function getContextByKeyword(keyword: string): ContextCategory[] {
  const normalized = keyword.toLowerCase().trim();
  if (!normalized) return [];

  return CATEGORIES.filter((c) =>
    c.keywords.some((kw) => kw.includes(normalized) || normalized.includes(kw))
  );
}

/**
 * Returns the relevant context categories for a given MCP tool name.
 * Uses the tool-to-context mapping table.
 */
export function getContextForTool(toolName: string): ContextCategory[] {
  const normalized = toolName.toLowerCase().trim();
  const categoryNames = TOOL_TO_CONTEXT_MAP[normalized];
  if (!categoryNames) return [];

  return categoryNames
    .map((name) => CATEGORIES.find((c) => c.name === name))
    .filter((c): c is ContextCategory => c !== undefined);
}

/**
 * Returns all category names for listing purposes.
 */
export function listContextCategoryNames(): string[] {
  return CATEGORIES.map((c) => c.name);
}
