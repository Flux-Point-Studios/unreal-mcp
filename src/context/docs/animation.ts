/**
 * UE 5.7 Animation API Context Documentation
 *
 * Covers UAnimInstance, state machines, montages, blend spaces,
 * control rigs, IK, and retargeting.
 */

export const animationContext = `
# UE 5.7 Animation API Reference

## Core Classes

### UAnimInstance
The runtime instance of an Animation Blueprint, created per SkeletalMeshComponent.
- \`UAnimInstance::GetOwningActor()\` - Returns the AActor that owns this anim instance.
- \`UAnimInstance::GetSkelMeshComponent()\` - Returns the owning USkeletalMeshComponent.
- \`UAnimInstance::GetCurrentStateName(int32 MachineIndex)\` - Returns current state FName.
- \`UAnimInstance::Montage_Play(UAnimMontage*, float PlayRate, EMontagePlayReturnType, float StartPosition, bool bStopAllMontages)\` - Plays a montage.
- \`UAnimInstance::Montage_Stop(float BlendOutTime, UAnimMontage*)\` - Stops a montage.
- \`UAnimInstance::Montage_IsPlaying(UAnimMontage*)\` - Check if montage is active.
- \`UAnimInstance::Montage_JumpToSection(FName SectionName, UAnimMontage*)\` - Jump to montage section.
- \`UAnimInstance::GetInstanceAssetPlayerIndex(FName MachineName)\` - Gets asset player index.
- \`UAnimInstance::NativeInitializeAnimation()\` - Override for C++ init (called once).
- \`UAnimInstance::NativeUpdateAnimation(float DeltaSeconds)\` - Override for C++ per-frame update.
- \`UAnimInstance::NativeThreadSafeUpdateAnimation(float DeltaSeconds)\` - Thread-safe update (UE 5.x preferred path).

### UAnimBlueprintGeneratedClass
The compiled class from an Animation Blueprint. Contains:
- \`BakedStateMachines\` - TArray<FBakedAnimationStateMachine> of compiled state machines.
- \`AnimNodeProperties\` - TArray<FStructProperty*> referencing anim node structs.
- \`AnimNotifyHandlerNodeProperties\` - Properties for anim notify handlers.

### UAnimationAsset (base class)
- \`UAnimSequence\` - Single animation clip. Contains bone transform keyframes.
- \`UAnimMontage\` - Composite animation with sections, notifies, and slots.
- \`UBlendSpace\` / \`UBlendSpace1D\` - Parameter-driven blend between animations.
- \`UAimOffsetBlendSpace\` - Specialized blend space for aim offsets.
- \`UAnimComposite\` - Sequential animation segments.
- \`UPoseAsset\` - Pose-driven animation (for facial, etc.).

## Animation Blueprint Structure

### Anim Graph vs Event Graph
- **Event Graph**: Standard Blueprint logic (BeginPlay, Tick events). Use for setting variables.
- **Anim Graph**: Specialized graph producing pose output. Uses FAnimNode_* structs. Runs on worker thread in 5.7.
- Variables set in Event Graph are consumed in Anim Graph for blending/state transitions.

### FAnimNode_Base
All animation nodes in the anim graph derive from FAnimNode_Base.
- \`FAnimNode_Base::Initialize_AnyThread(const FAnimationInitializeContext&)\`
- \`FAnimNode_Base::Update_AnyThread(const FAnimationUpdateContext&)\`
- \`FAnimNode_Base::Evaluate_AnyThread(FPoseContext&)\` or \`EvaluateComponentSpace_AnyThread(FComponentSpacePoseContext&)\`

### Key Anim Nodes
- \`FAnimNode_SequencePlayer\` - Plays a UAnimSequence.
- \`FAnimNode_BlendSpacePlayer\` - Evaluates a UBlendSpace.
- \`FAnimNode_StateMachine\` - Runs a state machine.
- \`FAnimNode_TwoWayBlend\` - Blends between two poses by alpha.
- \`FAnimNode_BlendListByBool\` / \`FAnimNode_BlendListByEnum\` / \`FAnimNode_BlendListByInt\` - Conditional pose selection.
- \`FAnimNode_LayeredBoneBlend\` - Per-bone layered blending (upper/lower body).
- \`FAnimNode_Slot\` - Slot for montage playback (e.g., "DefaultSlot", "UpperBody").
- \`FAnimNode_SaveCachedPose\` / \`FAnimNode_UseCachedPose\` - Cache and reuse poses.
- \`FAnimNode_ApplyAdditiveMeshSpaceAnimation\` - Applies additive animation.
- \`FAnimNode_ModifyCurve\` - Modifies animation curves.

## State Machines

### FBakedAnimationStateMachine
Compiled representation of a state machine.
- \`MachineName\` - FName.
- \`States\` - TArray<FBakedAnimationState>.

### FBakedAnimationState
- \`StateName\` - FName.
- \`Transitions\` - TArray<FAnimationTransitionBetweenStates>.
- \`bIsAConduit\` - If true, state is a conduit (pass-through).

### FAnimationTransitionBetweenStates
- \`PreviousState\` / \`NextState\` - Indices into the States array.
- \`CrossfadeDuration\` - Blend time.
- \`BlendMode\` - EAlphaBlendOption (Linear, Cubic, HermiteCubic, Sinusoidal, etc.).
- \`CrossfadeMode\` - ETransitionBlendMode::Proportional or NonProportional.
- \`LogicType\` - ETransitionLogicType (StandardBlend, Inertialization, Custom).

### UE 5.7: Inertialization is the default transition mode for new state machines. It provides smoother transitions without requiring source pose evaluation.

## Montages

### UAnimMontage
- \`SlotAnimTracks\` - TArray<FSlotAnimationTrack>. Each track targets a slot (e.g., "DefaultSlot").
- \`CompositeSections\` - TArray<FCompositeSection>. Named sections for jumping.
- \`Notifies\` - TArray<FAnimNotifyEvent>. Timed events.
- \`BlendIn\` / \`BlendOut\` - FAlphaBlend settings.
- \`GetSectionIndex(FName SectionName)\` - Find section by name.
- \`GetSectionName(int32 SectionIndex)\` - Get name from index.

### Playing Montages from C++
\`\`\`cpp
UAnimInstance* AnimInstance = Mesh->GetAnimInstance();
if (AnimInstance) {
    float Duration = AnimInstance->Montage_Play(AttackMontage, 1.0f);
    if (Duration > 0.f) {
        // Montage started successfully
        FOnMontageEnded EndDelegate;
        EndDelegate.BindUObject(this, &AMyCharacter::OnAttackMontageEnded);
        AnimInstance->Montage_SetEndDelegate(EndDelegate, AttackMontage);
    }
}
\`\`\`

## Blend Spaces

### UBlendSpace
2D blend space: two input parameters (X, Y) blend between sample animations.
- \`SampleData\` - TArray<FBlendSample>. Each sample has an Animation and SampleValue (FVector).
- \`GetBlendSamples()\` - Returns current blend samples.
- \`AxisToScaleAnimation\` - Which axis scales playback rate.

### UBlendSpace1D
1D blend space: single parameter.
- Same structure but only uses X axis.

## IK Systems

### FAnimNode_FABRIK
- Full-body IK using Forward And Backward Reaching Inverse Kinematics.
- \`EffectorTarget\` - FBoneSocketTarget for the IK goal.
- \`TipBone\` / \`RootBone\` - Define the IK chain.
- \`Precision\`, \`MaxIterations\` - Solver settings.

### FAnimNode_TwoBoneIK
- Classic two-bone IK (e.g., arms, legs).
- \`IKBone\` - The effector bone.
- \`EffectorLocation\` - World or component space target.
- \`JointTargetLocation\` - Pole vector target.

### FAnimNode_CCDIK
- Cyclic Coordinate Descent IK. Good for chains (tails, tentacles).

### Control Rig (UE 5.7)
- \`UControlRig\` - Blueprint-based procedural rig system.
- \`URigHierarchy\` - The rig's skeletal hierarchy.
- \`FRigUnit_*\` - Individual rig operations (transforms, math, constraints).
- Control Rig can be used as an anim graph node via \`FAnimNode_ControlRig\`.
- In UE 5.7, Control Rig supports modular rigging with \`UModularRig\` for reusable rig modules.

## Animation Retargeting

### IK Retargeter (UE 5.7 preferred)
- \`UIKRetargeter\` - Asset defining retargeting mapping between two IK Rigs.
- \`UIKRigDefinition\` - Defines IK goals and chains on a skeleton.
- \`URetargetChainSettings\` - Per-chain retarget settings (FK/IK mode, speed planting).

### Setup
\`\`\`cpp
// In editor: Create IK Rig for source and target skeletons
// Create IK Retargeter referencing both IK Rigs
// Use FIKRetargetProcessor at runtime or batch-retarget in editor
\`\`\`

## Animation Notifies

### UAnimNotify
- Fires at a single frame. Override \`Notify(USkeletalMeshComponent*, UAnimSequenceBase*)\`.
- Common built-in: \`UAnimNotify_PlaySound\`, \`UAnimNotify_PlayParticleEffect\`.

### UAnimNotifyState
- Fires over a duration (Begin/Tick/End). Override \`NotifyBegin\`, \`NotifyTick\`, \`NotifyEnd\`.
- Common: \`UAnimNotifyState_Trail\`, \`UAnimNotifyState_TimedParticleEffect\`.

## Animation Curves
- \`FFloatCurve\` - Per-bone or morph target curves baked into sequences.
- \`UAnimInstance::GetCurveValue(FName CurveName)\` - Read a curve value at runtime.
- Material parameter curves drive material instances from animation.

## UE 5.7 Animation Changes
- Thread-safe animation update is now enforced; NativeThreadSafeUpdateAnimation is preferred over NativeUpdateAnimation.
- Inertialization blending is default for new state machine transitions.
- Control Rig modular rigging with UModularRig for composable rig authoring.
- Animation compression improvements reduce memory for large animation libraries.
- Distance matching and stride warping helpers moved to AnimationLocomotionLibrary plugin.
- Multi-threaded animation evaluation expanded to cover more node types.
`;
