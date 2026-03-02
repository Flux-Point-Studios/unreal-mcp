/**
 * UE 5.7 Niagara/VFX API Context Documentation
 *
 * Covers UNiagaraSystem, emitters, modules, renderers,
 * data interfaces, and GPU simulation.
 */

export const niagaraContext = `
# UE 5.7 Niagara/VFX API Reference

## Core Architecture

Niagara is UE5's modular VFX system replacing Cascade. It uses a stack-based architecture:
- **System** contains one or more **Emitters**.
- Each Emitter has a **Module Stack** organized by execution stage.
- Modules are **Niagara Scripts** (written in the Niagara graph or HLSL).
- Data flows through **Parameters** and **Attributes** on particles.

## Core Classes

### UNiagaraSystem
The top-level VFX asset containing emitters and system-level scripts.
- \`UNiagaraSystem::GetEmitterHandles()\` - Returns TArray<FNiagaraEmitterHandle>.
- \`UNiagaraSystem::GetSystemSpawnScript()\` / \`GetSystemUpdateScript()\` - System-level scripts.
- \`UNiagaraSystem::GetExposedParameters()\` - FNiagaraUserRedirectionParameterStore for user parameters.
- \`UNiagaraSystem::bFixedBounds\` - Whether bounds are manually set.
- \`UNiagaraSystem::FixedBounds\` - FBox manual bounds.
- \`UNiagaraSystem::WarmupTime\` / \`WarmupTickCount\` / \`WarmupTickDelta\` - Warmup settings.
- \`UNiagaraSystem::bDeterminism\` - Deterministic simulation.

### UNiagaraEmitter
An individual particle emitter within a system.
- \`UNiagaraEmitter::SimTarget\` - ENiagaraSimTarget::CPUSim or GPUComputeSim.
- \`UNiagaraEmitter::SpawnScriptProps\` / \`UpdateScriptProps\` - Script configuration.
- \`UNiagaraEmitter::GetRenderers()\` - TArray<UNiagaraRendererProperties*>.
- \`UNiagaraEmitter::AllocationMode\` - EParticleAllocationMode (AutomaticEstimate, ManualEstimate, FixedCount).
- \`UNiagaraEmitter::CalculateBoundsMode\` - Fixed, Dynamic, or Programmable.
- Versioning: UE 5.x emitters support versioned inheritance for reuse.

### FNiagaraEmitterHandle
Wrapper referencing an emitter instance within a system.
- \`GetInstance()\` - Returns UNiagaraEmitter*.
- \`GetName()\` - FName of the emitter.
- \`GetIsEnabled()\` - Whether the emitter is active.
- \`SetIsEnabled(bool)\` - Enable/disable.

### UNiagaraComponent
The scene component that spawns and manages a Niagara system instance.
\`\`\`cpp
// Spawning a Niagara system
UNiagaraComponent* NiagaraComp = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
    GetWorld(),
    NiagaraSystem,
    SpawnLocation,
    SpawnRotation,
    FVector(1.f),        // Scale
    true,                // bAutoDestroy
    true,                // bAutoActivate
    ENCPoolMethod::None  // Pooling
);

// Or attach to an actor
UNiagaraComponent* NiagaraComp = UNiagaraFunctionLibrary::SpawnSystemAttached(
    NiagaraSystem,
    MeshComponent,
    SocketName,
    FVector::ZeroVector,
    FRotator::ZeroRotator,
    EAttachLocation::SnapToTarget,
    true  // bAutoDestroy
);
\`\`\`

#### UNiagaraComponent Key Methods
\`\`\`cpp
void Activate(bool bReset = false);
void Deactivate();
void DeactivateImmediate();
bool IsActive() const;
void ResetSystem();

// Parameter setters
void SetVariableFloat(FName InVariableName, float InValue);
void SetVariableVec2(FName InVariableName, FVector2D InValue);
void SetVariableVec3(FName InVariableName, FVector InValue);
void SetVariableVec4(FName InVariableName, FVector4 InValue);
void SetVariableLinearColor(FName InVariableName, const FLinearColor& InValue);
void SetVariableQuat(FName InVariableName, const FQuat& InValue);
void SetVariableInt(FName InVariableName, int32 InValue);
void SetVariableBool(FName InVariableName, bool InValue);
void SetVariableObject(FName InVariableName, UObject* InValue);
void SetVariableMaterial(FName InVariableName, UMaterialInterface* InValue);
void SetVariableStaticMesh(FName InVariableName, UStaticMesh* InValue);
void SetVariableTexture(FName InVariableName, UTexture* InValue);

// Set via FNiagaraVariable
void SetNiagaraVariableFloat(const FString& InVariableName, float InValue);
\`\`\`

## Module Stack Stages

Each emitter processes modules in these stages (in order):

1. **Emitter Spawn** - Runs once when the emitter first activates.
2. **Emitter Update** - Runs every frame for the emitter.
3. **Particle Spawn** - Runs for each newly spawned particle.
4. **Particle Update** - Runs every frame for each living particle.
5. **Event Handlers** - Responds to events (particle death, collision, custom).
6. **Render** - Configures how particles are rendered.

## Built-in Modules (commonly used)

### Spawn Modules
- \`Spawn Rate\` - Continuous spawn at a rate.
- \`Spawn Burst Instantaneous\` - One-shot burst of particles.
- \`Spawn Per Unit\` - Spawn based on emitter movement distance.

### Initialize Modules
- \`Initialize Particle\` - Sets initial Lifetime, Mass, SpriteSize, Color, Position, etc.
- \`Shape Location\` - Position particles on geometric shapes (sphere, box, cylinder, mesh surface, etc.).

### Update Modules
- \`Gravity Force\` - Applies gravity.
- \`Drag\` - Velocity drag.
- \`Curl Noise Force\` - Procedural curl noise turbulence.
- \`Point Attraction Force\` - Attracts toward a point.
- \`Vortex Force\` - Swirling motion.
- \`Scale Color\` / \`Scale Sprite Size\` - Animate properties over lifetime via curves.
- \`Solve Forces and Velocity\` - Integrates forces into velocity and position.
- \`Collision\` - Depth buffer or trace-based collision.
- \`Kill Particles in Volume\` - Kill particles inside/outside a shape.
- \`Apply Mesh Orientation\` - For mesh renderer rotation.

### Dynamic Inputs
Dynamic inputs are expression nodes inside module parameters:
- \`Float From Curve\` - Sample a curve over normalized lifetime.
- \`Uniform Ranged Float\` - Random value in range.
- \`Vector From Curve\` - Vector curve sample.
- \`Uniform Ranged Vector\` - Random vector in range.
- \`Make Linear Color From Curve\` - Color curve.
- \`Map Particle Attribute\` - Remap one attribute to another.

## Renderers (UNiagaraRendererProperties subclasses)

### UNiagaraSpriteRendererProperties
- Renders particles as camera-facing quads.
- \`Material\` - Material to render.
- \`Alignment\` - Camera facing, velocity aligned, custom alignment.
- \`FacingMode\` - FaceCamera, FaceCameraPosition, FaceCameraDistanceBlend, CustomFacingVector.
- Bindings: SpriteSizeBinding, SpriteRotationBinding, ColorBinding, etc.

### UNiagaraMeshRendererProperties
- Renders particles as mesh instances.
- \`Meshes\` - TArray of mesh entries (UStaticMesh* + material overrides).
- \`FacingMode\` - Default, Velocity, CameraPosition, CameraPlane.
- Bindings: ScaleBinding, MeshOrientationBinding, etc.

### UNiagaraRibbonRendererProperties
- Renders connected ribbon/trail geometry.
- \`Material\` - Ribbon material.
- \`FacingMode\` - Screen, Custom, CustomSideVector.
- \`UV0Settings\` / \`UV1Settings\` - Ribbon UV distribution.
- \`TessellationMode\` - Disabled or Automatic for smoother curves.

### UNiagaraLightRendererProperties
- Each particle emits a dynamic light.
- Bindings: ColorBinding, RadiusBinding, etc.
- Performance-heavy; use sparingly.

### UNiagaraComponentRendererProperties
- Spawns full UE components per particle (expensive).
- \`ComponentType\` - TSubclassOf<USceneComponent>.

## Data Interfaces (UNiagaraDataInterface subclasses)

Data interfaces provide external data or functionality to Niagara modules.

- \`UNiagaraDataInterfaceSkeletalMesh\` - Sample positions/normals/UVs from a skeletal mesh.
- \`UNiagaraDataInterfaceStaticMesh\` - Sample from a static mesh surface.
- \`UNiagaraDataInterfaceSpline\` - Sample along a spline component.
- \`UNiagaraDataInterfaceCurve\` / \`Vector2DCurve\` / \`VectorCurve\` / \`Vector4Curve\` / \`ColorCurve\` - Curve sampling.
- \`UNiagaraDataInterfaceAudioSpectrum\` / \`AudioOscilloscope\` - Audio reactive VFX.
- \`UNiagaraDataInterfaceGrid2D\` / \`Grid3D\` - Grid-based simulation (fluid, etc.).
- \`UNiagaraDataInterfaceRenderTarget2D\` / \`RenderTargetVolume\` - Write to render targets from GPU particles.
- \`UNiagaraDataInterfaceParticleRead\` - Read other emitter particle data.
- \`UNiagaraDataInterfaceExport\` - Export particle data to Blueprint/C++.
- \`UNiagaraDataInterfaceCollisionQuery\` - Perform collision queries.
- \`UNiagaraDataInterfaceLandscape\` - Sample landscape height/normal.
- \`UNiagaraDataInterfacePhysicsField\` - Read from physics fields.

## GPU Simulation

- Set \`SimTarget = ENiagaraSimTarget::GPUComputeSim\` on the emitter.
- GPU particles run compute shaders; much higher particle counts possible (millions).
- Limitations: Cannot use CPU-only data interfaces, cannot call Blueprint functions.
- GPU-compatible data interfaces: Grid2D/3D, RenderTarget, SkeletalMesh (read-only), StaticMesh (read-only), Collision.
- In UE 5.7, GPU simulation supports larger dispatch sizes and improved memory management.

## Niagara Parameters and Attributes

### Parameter Namespaces
- \`System.*\` - System-level parameters shared across emitters.
- \`Emitter.*\` - Per-emitter parameters.
- \`Particles.*\` - Per-particle attributes (Position, Velocity, Color, etc.).
- \`User.*\` - Exposed to Blueprint/C++ via UNiagaraComponent.
- \`Engine.*\` - Engine-provided (DeltaTime, Owner transform, etc.).
- \`Transient.*\` - Temporary per-frame values.

### Common Particle Attributes
\`\`\`
Particles.Position       - FVector3f
Particles.Velocity       - FVector3f
Particles.Color          - FLinearColor
Particles.SpriteSize     - FVector2f
Particles.SpriteRotation - float (radians)
Particles.Scale          - FVector3f (mesh scale)
Particles.MeshOrientation- FQuat4f
Particles.Lifetime       - float (total lifetime)
Particles.Age            - float (current age)
Particles.NormalizedAge  - float [0, 1]
Particles.Mass           - float
Particles.ID             - FNiagaraID
Particles.UniqueID       - int32
Particles.RibbonID       - int32 (ribbon linkage)
\`\`\`

## UE 5.7 Niagara Changes
- Improved GPU dispatch scalability for very large particle counts.
- New Fluid Simulation template system for built-in fluid effects.
- Niagara Debugger HUD improvements with per-emitter GPU profiling.
- Data Interface GPU read-back performance improvements.
- Emitter inheritance and versioning refinements for team collaboration.
- Simulation Stage improvements with better iteration source controls.
`;
