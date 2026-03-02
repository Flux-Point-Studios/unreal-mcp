/**
 * UE 5.7 Actor/Component API Context Documentation
 *
 * Covers AActor lifecycle, component hierarchy, spawning,
 * attachment rules, and transforms.
 */

export const actorContext = `
# UE 5.7 Actor/Component API Reference

## Core Classes

### AActor
The base class for all objects that can be placed in a level.
- Not a "game object" in the Unity sense; Actors are containers for components.
- Every placed object in a level is an AActor or subclass.

#### Lifecycle Methods
\`\`\`cpp
// Called when the Actor is first created or spawned (before first Tick)
virtual void BeginPlay() override;

// Called every frame
virtual void Tick(float DeltaTime) override;

// Called when the Actor is being removed from the level
virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

// Called after all components are initialized, before BeginPlay
virtual void PostInitializeComponents() override;

// Construction script equivalent in C++
virtual void OnConstruction(const FTransform& Transform) override;
\`\`\`

#### Lifecycle Order
1. \`Constructor\` - C++ constructor. Set defaults, create components with CreateDefaultSubobject.
2. \`PostInitProperties()\` - After UObject properties are initialized.
3. \`OnConstruction()\` - Called in editor and at runtime when transform changes.
4. \`PostInitializeComponents()\` - All components are registered and initialized.
5. \`BeginPlay()\` - Gameplay has started. Safe to access other actors.
6. \`Tick()\` - Every frame (if ticking enabled).
7. \`EndPlay()\` - Actor is being destroyed or level is unloading.
8. \`Destroyed()\` - After EndPlay, actor is marked for GC.

#### Key Properties
- \`RootComponent\` - USceneComponent* that defines the actor's transform.
- \`bReplicates\` - Whether this actor replicates over the network.
- \`bCanBeDamaged\` - Whether TakeDamage is processed.
- \`bActorIsBeingDestroyed\` - True during destruction.
- \`Tags\` - TArray<FName> for gameplay tagging.
- \`InputComponent\` - UInputComponent* for input bindings.

#### Key Methods
\`\`\`cpp
// Transform
FTransform GetActorTransform() const;
FVector GetActorLocation() const;
FRotator GetActorRotation() const;
FVector GetActorScale3D() const;
bool SetActorLocation(const FVector& NewLocation, bool bSweep = false, FHitResult* OutHit = nullptr);
bool SetActorRotation(FRotator NewRotation);
bool SetActorTransform(const FTransform& NewTransform, bool bSweep = false);
void AddActorWorldOffset(FVector DeltaLocation, bool bSweep = false);
void AddActorWorldRotation(FRotator DeltaRotation);

// Components
UActorComponent* GetComponentByClass(TSubclassOf<UActorComponent> ComponentClass) const;
TArray<UActorComponent*> GetComponentsByClass(TSubclassOf<UActorComponent> ComponentClass) const;
template<class T> T* FindComponentByClass() const;
UActorComponent* AddComponentByClass(TSubclassOf<UActorComponent> Class, bool bManualAttach, const FTransform& RelativeTransform, bool bDeferredFinish);
void FinishAddComponent(UActorComponent* Component, bool bManualAttach, const FTransform& RelativeTransform);

// Destruction
void Destroy(bool bNetForce = false, bool bShouldModifyLevel = true);
bool IsActorBeingDestroyed() const;

// Ownership
void SetOwner(AActor* NewOwner);
AActor* GetOwner() const;

// Attachment
void AttachToActor(AActor* ParentActor, const FAttachmentTransformRules& AttachmentRules, FName SocketName = NAME_None);
void DetachFromActor(const FDetachmentTransformRules& DetachmentRules);

// Damage
float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent, AController* EventInstigator, AActor* DamageCauser);

// Overlap / Hit
virtual void NotifyActorBeginOverlap(AActor* OtherActor);
virtual void NotifyHit(UPrimitiveComponent* MyComp, AActor* Other, UPrimitiveComponent* OtherComp, bool bSelfMoved, FVector HitLocation, FVector HitNormal, FVector NormalImpulse, const FHitResult& Hit);
\`\`\`

## Component Hierarchy

### UActorComponent (base)
Non-spatial component. No transform. Used for logic, data, or systems.
- \`RegisterComponent()\` - Registers with the world (required for runtime-added components).
- \`DestroyComponent()\` - Removes and destroys the component.
- \`IsActive()\` / \`Activate()\` / \`Deactivate()\` - Activity state.
- \`GetOwner()\` - Returns the owning AActor*.

### USceneComponent : UActorComponent
Has a transform (location, rotation, scale) and supports attachment hierarchy.
- \`SetRelativeLocation()\` / \`SetWorldLocation()\` - Position.
- \`SetRelativeRotation()\` / \`SetWorldRotation()\` - Rotation.
- \`SetRelativeScale3D()\` - Scale.
- \`GetComponentTransform()\` - World transform.
- \`GetRelativeTransform()\` - Relative to parent.
- \`AttachToComponent(USceneComponent*, FAttachmentTransformRules, FName SocketName)\` - Attach.
- \`DetachFromComponent(FDetachmentTransformRules)\` - Detach.
- \`GetChildrenComponents(bool bIncludeAllDescendants, TArray<USceneComponent*>& Children)\` - Get children.
- \`SetMobility(EComponentMobility::Type)\` - Static, Stationary, or Movable.
- \`SetVisibility(bool bNewVisibility, bool bPropagateToChildren)\` - Visibility.

### UPrimitiveComponent : USceneComponent
Renderable component with collision. Base for meshes, shapes, etc.
- \`SetCollisionEnabled(ECollisionEnabled::Type)\` - None, QueryOnly, PhysicsOnly, QueryAndPhysics.
- \`SetCollisionProfileName(FName)\` - e.g., "BlockAll", "OverlapAll", "NoCollision".
- \`SetSimulatePhysics(bool)\` - Enable physics simulation.
- \`OnComponentBeginOverlap\` / \`OnComponentEndOverlap\` - Overlap delegates.
- \`OnComponentHit\` - Hit delegate.
- \`SetMaterial(int32 ElementIndex, UMaterialInterface*)\` - Set material.
- \`GetMaterial(int32 ElementIndex)\` - Get material.

### Common Component Types
- \`UStaticMeshComponent\` - Renders a UStaticMesh.
- \`USkeletalMeshComponent\` - Renders a USkeletalMesh with animation.
- \`UCameraComponent\` - Camera viewpoint.
- \`USpringArmComponent\` - Camera boom with collision.
- \`UPointLightComponent\` / \`USpotLightComponent\` / \`UDirectionalLightComponent\` - Lights.
- \`UBoxComponent\` / \`USphereComponent\` / \`UCapsuleComponent\` - Collision shapes.
- \`UAudioComponent\` - Positional audio.
- \`UParticleSystemComponent\` - Legacy Cascade particles.
- \`UNiagaraComponent\` - Niagara particle system.
- \`UWidgetComponent\` - In-world UMG widget.
- \`UArrowComponent\` - Debug directional arrow.
- \`UBillboardComponent\` - Editor sprite.
- \`UChildActorComponent\` - Spawns a child AActor.
- \`UTextRenderComponent\` - 3D text.
- \`UDecalComponent\` - Projected decal.
- \`USplineComponent\` / \`USplineMeshComponent\` - Spline paths.

## Spawning

### UWorld::SpawnActor
\`\`\`cpp
// Template version
template<class T>
T* UWorld::SpawnActor(
    UClass* Class,
    const FVector* Location = nullptr,
    const FRotator* Rotation = nullptr,
    const FActorSpawnParameters& SpawnParameters = FActorSpawnParameters()
);

// Simple usage
FActorSpawnParameters SpawnParams;
SpawnParams.Owner = this;
SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
SpawnParams.Name = FName("MyActor_01");

AMyActor* NewActor = GetWorld()->SpawnActor<AMyActor>(
    AMyActor::StaticClass(),
    &SpawnLocation,
    &SpawnRotation,
    SpawnParams
);
\`\`\`

### FActorSpawnParameters
- \`Name\` - FName for the spawned actor.
- \`Template\` - AActor* template to copy properties from.
- \`Owner\` - AActor* owner.
- \`Instigator\` - APawn* instigator.
- \`OverrideLevel\` - ULevel* to spawn into.
- \`SpawnCollisionHandlingOverride\` - ESpawnActorCollisionHandlingMethod.
- \`bDeferConstruction\` - If true, BeginPlay is not called until FinishSpawning.
- \`bNoFail\` - If true, always spawn even if collision blocks.

### Deferred Spawning
\`\`\`cpp
FTransform SpawnTransform(FRotator::ZeroRotator, SpawnLocation);
AMyActor* Actor = GetWorld()->SpawnActorDeferred<AMyActor>(
    AMyActor::StaticClass(),
    SpawnTransform,
    nullptr,     // Owner
    nullptr,     // Instigator
    ESpawnActorCollisionHandlingMethod::AlwaysSpawn
);
// Configure actor before construction
Actor->MyProperty = SomeValue;
Actor->FinishSpawning(SpawnTransform);
\`\`\`

## Attachment Rules

### FAttachmentTransformRules
\`\`\`cpp
// Common presets:
FAttachmentTransformRules::KeepRelativeTransform    // Preserve relative offset
FAttachmentTransformRules::KeepWorldTransform        // Maintain world position
FAttachmentTransformRules::SnapToTargetNotIncludingScale  // Snap to parent, keep scale
FAttachmentTransformRules::SnapToTargetIncludingScale     // Snap completely

// Custom rules:
FAttachmentTransformRules Rules(
    EAttachmentRule::SnapToTarget,   // Location rule
    EAttachmentRule::SnapToTarget,   // Rotation rule
    EAttachmentRule::KeepWorld,      // Scale rule
    true                             // bWeldSimulatedBodies
);
\`\`\`

### FDetachmentTransformRules
\`\`\`cpp
FDetachmentTransformRules::KeepRelativeTransform
FDetachmentTransformRules::KeepWorldTransform
\`\`\`

## Mobility
- \`EComponentMobility::Static\` - Cannot move at runtime. Best performance, baked lighting.
- \`EComponentMobility::Stationary\` - Cannot move but can change (e.g., light color). Mixed lighting.
- \`EComponentMobility::Movable\` - Fully dynamic. Dynamic lighting, no baked shadows.

## CreateDefaultSubobject Pattern
\`\`\`cpp
AMyActor::AMyActor()
{
    // Create root component
    RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));

    // Create mesh
    MeshComp = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    MeshComp->SetupAttachment(RootComponent);

    // Create collision
    BoxComp = CreateDefaultSubobject<UBoxComponent>(TEXT("Box"));
    BoxComp->SetupAttachment(RootComponent);
    BoxComp->SetBoxExtent(FVector(50.f, 50.f, 50.f));
    BoxComp->SetCollisionProfileName(TEXT("Trigger"));

    // Tick settings
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.bStartWithTickEnabled = true;
    PrimaryActorTick.TickInterval = 0.0f; // Every frame
}
\`\`\`

## UE 5.7 Actor/Component Changes
- Enhanced component registration supports batch operations for faster level loading.
- SetActorLocation sweep improvements provide more accurate collision detection with complex geometry.
- Actor iterator performance improvements for levels with World Partition.
- UChildActorComponent destruction order is now deterministic.
- AddComponentByClass supports an optional bDeferredFinish parameter for batch component creation.
`;
