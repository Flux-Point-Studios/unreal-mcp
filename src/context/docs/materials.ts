/**
 * UE 5.7 Material API Context Documentation
 *
 * Covers UMaterial, UMaterialInstance, material expressions,
 * shading models, parameters, and Nanite/Lumen considerations.
 */

export const materialsContext = `
# UE 5.7 Material API Reference

## Core Classes

### UMaterial
The base material asset. Contains a node graph of UMaterialExpression nodes compiled into shader code.
- \`UMaterial::Expressions\` - TArray<TObjectPtr<UMaterialExpression>> of all nodes in the material graph.
- \`UMaterial::EditorComments\` - TArray<TObjectPtr<UMaterialExpressionComment>> for editor comments.
- \`UMaterial::ShadingModel\` - EMaterialShadingModel (DefaultLit, Unlit, SubsurfaceProfile, etc.).
- \`UMaterial::BlendMode\` - EBlendMode (Opaque, Masked, Translucent, Additive, Modulate, AlphaComposite, AlphaHoldout).
- \`UMaterial::MaterialDomain\` - EMaterialDomain (Surface, DeferredDecal, LightFunction, Volume, PostProcess, UI).
- \`UMaterial::TwoSided\` - bool.
- \`UMaterial::OpacityMaskClipValue\` - Clip threshold for Masked blend mode.
- \`UMaterial::bUsedWithSkeletalMesh\` - Usage flags for shader permutation compilation.

### UMaterialInterface
Abstract base for UMaterial and UMaterialInstanceDynamic/Constant.
- \`GetMaterial()\` - Returns the base UMaterial.
- \`GetPhysicalMaterial()\` - Returns the physical material.
- \`GetScalarParameterValue(FName ParameterName, float& OutValue)\` - Read scalar param.
- \`GetVectorParameterValue(FName ParameterName, FLinearColor& OutValue)\` - Read vector param.
- \`GetTextureParameterValue(FName ParameterName, UTexture*& OutValue)\` - Read texture param.

### UMaterialInstance
Base class for material instances (constant and dynamic).
- \`Parent\` - UMaterialInterface* parent material or material instance.

### UMaterialInstanceConstant (MIC)
Editor-time material instance. Parameters are set in editor and baked.
- Created via "Create Material Instance" in content browser.
- \`ScalarParameterValues\` - TArray<FScalarParameterValue>.
- \`VectorParameterValues\` - TArray<FVectorParameterValue>.
- \`TextureParameterValues\` - TArray<FTextureParameterValue>.

### UMaterialInstanceDynamic (MID)
Runtime material instance. Create and modify parameters at runtime.
\`\`\`cpp
// Create from a material or material instance
UMaterialInstanceDynamic* MID = UMaterialInstanceDynamic::Create(BaseMaterial, this);
MeshComponent->SetMaterial(0, MID);

// Set parameters
MID->SetScalarParameterValue(FName("Roughness"), 0.5f);
MID->SetVectorParameterValue(FName("BaseColor"), FLinearColor(1.f, 0.f, 0.f, 1.f));
MID->SetTextureParameterValue(FName("DiffuseTexture"), MyTexture);
\`\`\`

### UMaterialFunction
Reusable material node subgraph. Can be called from any material via MaterialFunctionCall.
- \`UMaterialFunction::FunctionExpressions\` - The expressions inside the function.
- \`UMaterialFunction::Description\` - User description.
- Referenced via \`UMaterialExpressionMaterialFunctionCall\` in materials.

## Material Expression Nodes

### Common Expression Classes
\`\`\`
UMaterialExpressionScalarParameter   - Named scalar input (float)
UMaterialExpressionVectorParameter   - Named vector input (FLinearColor)
UMaterialExpressionTextureObjectParameter - Named texture input
UMaterialExpressionStaticSwitchParameter  - Compile-time bool switch
UMaterialExpressionStaticBoolParameter    - Compile-time bool

UMaterialExpressionTextureSample     - Samples a texture at UVs
UMaterialExpressionTextureCoordinate - UV coordinate node
UMaterialExpressionPanner            - UV panning
UMaterialExpressionRotator           - UV rotation

UMaterialExpressionAdd               - A + B
UMaterialExpressionSubtract          - A - B
UMaterialExpressionMultiply          - A * B
UMaterialExpressionDivide            - A / B
UMaterialExpressionPower             - pow(A, B)
UMaterialExpressionDotProduct        - dot(A, B)
UMaterialExpressionCrossProduct      - cross(A, B)
UMaterialExpressionClamp             - clamp(Value, Min, Max)
UMaterialExpressionLinearInterpolate - lerp(A, B, Alpha)
UMaterialExpressionOneMinus          - 1 - X
UMaterialExpressionAbs               - abs(X)
UMaterialExpressionFloor / Ceil / Frac / Fmod

UMaterialExpressionAppendVector      - Combines channels (e.g., float2 + float = float3)
UMaterialExpressionComponentMask     - Swizzle/mask channels (R, G, B, A)
UMaterialExpressionBreakMaterialAttributes - Split material attributes

UMaterialExpressionTime              - World time
UMaterialExpressionWorldPosition     - Pixel world position
UMaterialExpressionVertexNormalWS    - Vertex normal in world space
UMaterialExpressionPixelNormalWS     - Pixel normal in world space
UMaterialExpressionCameraPosition    - Camera world position
UMaterialExpressionObjectRadius      - Bounding sphere radius

UMaterialExpressionFresnel           - Fresnel effect
UMaterialExpressionDepthFade         - Soft particle depth fade
UMaterialExpressionSceneDepth        - Scene depth buffer
UMaterialExpressionSceneColor        - Scene color buffer (post-process only)
UMaterialExpressionNoise             - Procedural noise

UMaterialExpressionIf                - Runtime conditional (A > B ? True : False)
UMaterialExpressionStaticSwitch      - Compile-time switch
UMaterialExpressionMaterialFunctionCall - Calls a UMaterialFunction
UMaterialExpressionCustom            - Custom HLSL code node
\`\`\`

## Shading Models (EMaterialShadingModel)

- \`MSM_DefaultLit\` - Standard PBR (BaseColor, Metallic, Specular, Roughness, Normal).
- \`MSM_Unlit\` - Emissive only, no lighting. Uses EmissiveColor output.
- \`MSM_Subsurface\` - Subsurface scattering (SubsurfaceColor input).
- \`MSM_SubsurfaceProfile\` - Screen-space subsurface scattering with profile asset.
- \`MSM_ClearCoat\` - Additional clear coat layer (ClearCoat, ClearCoatRoughness inputs).
- \`MSM_TwoSidedFoliage\` - Foliage with backface subsurface transmission.
- \`MSM_Hair\` - Strand-based hair shading (Marschner model).
- \`MSM_Cloth\` - Fabric shading with fuzz color.
- \`MSM_Eye\` - Eye shading with iris caustics.
- \`MSM_Strata\` - UE 5.x Substrate system (experimental in 5.7). Replaces traditional shading models with layered material system.

## Blend Modes (EBlendMode)

- \`BLEND_Opaque\` - No transparency. Required for Nanite.
- \`BLEND_Masked\` - Binary opacity via OpacityMask and clip value. Supported with Nanite in 5.7.
- \`BLEND_Translucent\` - Per-pixel alpha blending. NOT compatible with Nanite.
- \`BLEND_Additive\` - Additive blending (add to background).
- \`BLEND_Modulate\` - Multiplicative blending (darken background).
- \`BLEND_AlphaComposite\` - Pre-multiplied alpha.
- \`BLEND_AlphaHoldout\` - Holdout mask.

## Material Parameters

### Creating Parameters Programmatically
\`\`\`cpp
// Create a scalar parameter expression
UMaterialExpressionScalarParameter* ScalarParam = NewObject<UMaterialExpressionScalarParameter>(Material);
ScalarParam->ParameterName = FName("Roughness");
ScalarParam->DefaultValue = 0.5f;
ScalarParam->Group = FName("Surface");
ScalarParam->SortPriority = 0;
Material->Expressions.Add(ScalarParam);

// Connect to material output
Material->Roughness.Expression = ScalarParam;
\`\`\`

### Parameter Collections
\`\`\`cpp
// UMaterialParameterCollection - shared parameter set across all materials
UMaterialParameterCollection* MPC = LoadObject<UMaterialParameterCollection>(...);

// Set at runtime via the world
UKismetMaterialLibrary::SetScalarParameterValue(
    GetWorld(), MPC, FName("GlobalWetness"), 0.8f
);
\`\`\`

## Material Outputs (Pin connections on the material node)
\`\`\`
BaseColor          - FLinearColor (RGB)
Metallic           - float [0, 1]
Specular           - float [0, 1] (default 0.5)
Roughness          - float [0, 1]
Anisotropy         - float [-1, 1]
EmissiveColor      - FLinearColor (HDR)
Normal             - float3 tangent-space normal
Tangent            - float3 tangent (for anisotropic materials)
Opacity            - float [0, 1] (Translucent only)
OpacityMask        - float, compared against clip value (Masked only)
WorldPositionOffset - float3 vertex offset in world space
SubsurfaceColor    - FLinearColor (Subsurface shading model)
AmbientOcclusion   - float [0, 1]
Refraction         - float, index of refraction (Translucent)
PixelDepthOffset   - float, adjusts depth buffer value
ShadingModelFromMaterialExpression - int (per-pixel shading model selection)
\`\`\`

## Nanite Material Considerations (UE 5.7)
- Nanite supports Opaque and Masked blend modes.
- Nanite does NOT support Translucent, Additive, or Modulate.
- World Position Offset is supported with Nanite in UE 5.4+.
- Pixel Depth Offset is supported with Nanite meshes.
- Two-sided materials work with Nanite.
- Custom UV expressions work but may reduce Nanite cluster efficiency.
- Material complexity affects Nanite rasterization performance.

## Lumen Material Considerations (UE 5.7)
- Lumen GI works best with Opaque materials.
- Emissive materials contribute to Lumen GI automatically.
- Translucent materials do not receive Lumen reflections by default; use \`bSupportLumenFrontLayerTranslucency\`.
- High roughness values (>0.4) cause Lumen to use lower-quality screen traces.
- Substrate shading model provides more physically accurate Lumen interaction.

## Programmatic Material Creation
\`\`\`cpp
// Create a new material asset
UMaterialFactoryNew* Factory = NewObject<UMaterialFactoryNew>();
UMaterial* NewMaterial = Cast<UMaterial>(
    Factory->FactoryCreateNew(UMaterial::StaticClass(), Package, FName("M_New"), RF_Public | RF_Standalone, nullptr, GWarn)
);

// Set properties
NewMaterial->SetShadingModel(MSM_DefaultLit);
NewMaterial->BlendMode = BLEND_Opaque;
NewMaterial->TwoSided = false;

// Add expressions and connect...
// After modifications:
NewMaterial->PreEditChange(nullptr);
NewMaterial->PostEditChange();
NewMaterial->MarkPackageDirty();
\`\`\`

## UE 5.7 Material Changes
- Substrate (previously Strata) shading model expanded with more layer types.
- Nanite masked material support improved with better dithering.
- Material compilation caching reduces iteration times for complex materials.
- New UMaterialExpressionHairColor for physically-based hair coloring.
- Virtual texture streaming improvements for material atlasing.
`;
