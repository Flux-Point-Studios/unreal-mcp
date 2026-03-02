/**
 * UE 5.7 World/Level API Context Documentation
 *
 * Covers UWorld, ULevel, level streaming, World Partition,
 * data layers, HLOD, landscape, and foliage APIs.
 */

export const worldBuildingContext = `
# UE 5.7 World/Level API Reference

## Core Classes

### UWorld
The top-level container for all actors and components. One UWorld per game instance.
\`\`\`cpp
// Get the world
UWorld* World = GetWorld();
UWorld* World = GEngine->GetWorldContexts()[0].World();

// Spawn an actor
AActor* Actor = World->SpawnActor<AMyActor>(SpawnClass, &Location, &Rotation, SpawnParams);

// Line trace
FHitResult Hit;
bool bHit = World->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility);

// Timers
FTimerHandle TimerHandle;
World->GetTimerManager().SetTimer(TimerHandle, this, &AMyActor::MyFunc, 1.0f, true);

// Iterate actors
for (TActorIterator<AActor> It(World); It; ++It) {
    AActor* Actor = *It;
}

// Get game mode (server only)
AGameModeBase* GM = World->GetAuthGameMode();

// Get game state
AGameStateBase* GS = World->GetGameState();

// Get navigation system
UNavigationSystemV1* NavSys = UNavigationSystemV1::GetCurrent(World);
\`\`\`

### ULevel
A sublevel within the world. The persistent level is always loaded.
- \`ULevel::Actors\` - TArray<AActor*> of all actors in this level.
- \`ULevel::OwningWorld\` - The UWorld that owns this level.
- \`ULevel::bIsVisible\` - Whether the level is currently visible.
- \`ULevel::GetOutermost()\` - Returns the UPackage (the .umap file).
- \`ULevel::LevelBoundsActor\` - ALevelBounds for the level's extent.

### Level Management
\`\`\`cpp
// Get persistent level
ULevel* PersistentLevel = World->PersistentLevel;

// Get all levels (persistent + streamed)
const TArray<ULevel*>& Levels = World->GetLevels();

// Get current level (the one being edited or that owns spawned actors)
ULevel* CurrentLevel = World->GetCurrentLevel();
\`\`\`

## Level Streaming

### ULevelStreaming
Base class for streamed sublevels.
- \`ULevelStreamingDynamic\` - Loaded/unloaded at runtime.
- \`ULevelStreamingAlwaysLoaded\` - Always loaded with the world.

\`\`\`cpp
// Load a sublevel at runtime
ULevelStreamingDynamic* StreamedLevel = ULevelStreamingDynamic::LoadLevelInstance(
    World,
    LevelPath,           // e.g., "/Game/Maps/SubLevel"
    FVector(1000, 0, 0), // Location offset
    FRotator::ZeroRotator,
    bSuccess
);

// Via gameplay statics (Blueprint-friendly)
UGameplayStatics::LoadStreamLevel(World, FName("SubLevel"), true /* bMakeVisibleAfterLoad */, false /* bShouldBlockOnLoad */, FLatentActionInfo());
UGameplayStatics::UnloadStreamLevel(World, FName("SubLevel"), FLatentActionInfo(), false);

// Check if loaded
bool bLoaded = StreamedLevel->IsLevelLoaded();
bool bVisible = StreamedLevel->IsLevelVisible();

// Set visibility
StreamedLevel->SetShouldBeVisible(true);
StreamedLevel->SetShouldBeLoaded(true);
\`\`\`

## World Partition (UE 5.x)

### Overview
World Partition replaces World Composition for large worlds. It automatically streams
cells based on proximity rather than requiring manual sublevel management.

### Key Concepts
- **Grid-based streaming**: The world is divided into a grid. Cells load/unload based on streaming sources.
- **One Actor Per File (OFPA)**: Each actor is stored as a separate file, enabling collaboration.
- **Streaming Sources**: Define what cells should be loaded (player location, custom sources).
- **No manual sublevels**: Actors are placed in the persistent level and automatically partitioned.

### UWorldPartition
\`\`\`cpp
UWorldPartition* WP = World->GetWorldPartition();

// Check if world partition is enabled
if (WP) {
    // World uses World Partition
}
\`\`\`

### AWorldPartitionStreamingSource
Custom streaming source for non-player-based loading.
\`\`\`cpp
// Register a streaming source
AWorldPartitionStreamingSource* Source = World->SpawnActor<AWorldPartitionStreamingSource>();
Source->SetActorLocation(DesiredLocation);
Source->StreamingSourceConfig.TargetGrids = { TEXT("MainGrid") };
Source->StreamingSourceConfig.Priority = EStreamingSourcePriority::Normal;
\`\`\`

## Data Layers

Data Layers control which actors are loaded in which contexts:
- \`UDataLayerAsset\` - Asset defining a data layer.
- \`UDataLayerInstance\` - Runtime instance of a data layer.
- Actors can belong to multiple data layers via \`AActor::DataLayerAssets\`.

### Data Layer States
- \`EDataLayerRuntimeState::Unloaded\` - Not in memory.
- \`EDataLayerRuntimeState::Loaded\` - In memory but not visible.
- \`EDataLayerRuntimeState::Activated\` - Loaded and visible.

\`\`\`cpp
// Set data layer state at runtime
UDataLayerManager* DLM = UDataLayerManager::GetDataLayerManager(World);
if (DLM) {
    DLM->SetDataLayerInstanceRuntimeState(DataLayerInstance, EDataLayerRuntimeState::Activated);
}
\`\`\`

## HLOD (Hierarchical Level of Detail)

### Overview
HLOD generates simplified proxy meshes for distant actors, reducing draw calls.
In World Partition, HLOD is generated per-cell.

### Key Classes
- \`AWorldPartitionHLOD\` - The HLOD actor generated for a partition cell.
- \`UHLODLayer\` - Configuration for HLOD generation (merge strategy, simplification).
- \`UHLODBuilder\` / \`UHLODBuilderMeshMerge\` / \`UHLODBuilderMeshSimplify\` / \`UHLODBuilderMeshApproximate\` - Build strategies.

### HLOD Layers
- **Instancing**: Groups instances together.
- **Mesh Merge**: Combines meshes into one.
- **Mesh Simplification**: Reduces poly count.
- **Mesh Approximation**: Creates proxy mesh via voxelization.
- Nanite HLOD: In 5.7, Nanite meshes can generate Nanite-aware HLODs.

## Landscape API

### ALandscapeProxy / ALandscape
\`\`\`cpp
// Get landscape at a world position
ALandscapeProxy* Landscape = Cast<ALandscapeProxy>(HitResult.GetActor());

// Get height at location
float Height;
bool bValid = Landscape->GetHeightAtLocation(WorldLocation, Height);

// Get landscape components
TArray<ULandscapeComponent*> Components;
Landscape->GetComponents<ULandscapeComponent>(Components);
\`\`\`

### ULandscapeComponent
- Individual section of the landscape.
- Contains heightmap and layer weight data.
- \`GetComponentExtent()\` - Returns bounding box.
- \`GetLandscapeProxy()\` - Returns owning ALandscapeProxy.

### Landscape Editing (Editor Only)
\`\`\`cpp
// FLandscapeEditDataInterface for programmatic height/weight editing
FLandscapeEditDataInterface LandscapeEdit(Landscape->GetLandscapeInfo());

// Set heights
TArray<uint16> HeightData;
// ... populate height data ...
LandscapeEdit.SetHeightData(X1, Y1, X2, Y2, HeightData.GetData(), 0, false);

// Set layer weights
TArray<uint8> LayerData;
// ... populate ...
LandscapeEdit.SetAlphaData(LayerInfo, X1, Y1, X2, Y2, LayerData.GetData(), 0);
\`\`\`

### Landscape Materials
- \`ULandscapeLayerInfoObject\` - Defines a paintable layer (grass, dirt, rock, etc.).
- \`UMaterialExpressionLandscapeLayerBlend\` - Material node for layer blending.
- \`UMaterialExpressionLandscapeLayerWeight\` - Material node for layer weights.
- Landscape materials use a weight-blend approach with per-layer textures.

## Foliage

### UFoliageType
Asset defining a foliage mesh type and its placement rules.
- \`Mesh\` - UStaticMesh* to render.
- \`Density\` - Instances per 1000x1000 unit area.
- \`Radius\` - Minimum distance between instances.
- \`AlignToNormal\` / \`AlignMaxAngle\` - Surface alignment.
- \`RandomYaw\` / \`RandomPitchAngle\` - Random rotation ranges.
- \`GroundSlopeAngle\` - Min/max slope for placement.
- \`HeightRange\` - Altitude constraints.
- \`Scaling\` - EFoliageScaling (Uniform, Free, LockXY, LockXZ, LockYZ).
- \`ScaleX\` / \`ScaleY\` / \`ScaleZ\` - Scale ranges.
- \`CullDistance\` - Per-instance distance culling.

### AInstancedFoliageActor
Per-level actor that holds all foliage instances.
\`\`\`cpp
// Get the foliage actor for a level
AInstancedFoliageActor* IFA = AInstancedFoliageActor::GetInstancedFoliageActorForLevel(Level);

// Get all foliage types
for (auto& Pair : IFA->FoliageInfos) {
    UFoliageType* FoliageType = Pair.Key;
    FFoliageInfo& Info = *Pair.Value;
    int32 InstanceCount = Info.Instances.Num();
}
\`\`\`

### Procedural Foliage
- \`UProceduralFoliageSpawner\` - Defines procedural foliage volumes.
- \`AProceduralFoliageVolume\` - Volume actor for procedural placement.
- Uses simulation-based seeding for natural distribution.

## UE 5.7 World/Level Changes
- World Partition performance improvements with async cell loading.
- Data Layer editing workflow improvements in the editor.
- HLOD Nanite support for LOD-less distant geometry.
- Landscape improvements: Virtual heightfield mesh support for Nanite-based terrain rendering.
- Level instancing API improvements for runtime level duplication.
- Improved streaming source priority system for gameplay-driven loading.
`;
