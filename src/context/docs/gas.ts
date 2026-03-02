/**
 * UE 5.7 Gameplay Ability System (GAS) API Context Documentation
 *
 * Covers UGameplayAbility, UGameplayEffect, UAbilitySystemComponent,
 * gameplay tags, cues, and attributes.
 */

export const gasContext = `
# UE 5.7 Gameplay Ability System (GAS) API Reference

## Overview

The Gameplay Ability System (GAS) is a framework for building abilities, buffs/debuffs, attributes,
and game effects. It lives in the GameplayAbilities plugin (enabled by default in UE5).

Core flow: Abilities are granted to actors via AbilitySystemComponent. When activated, abilities
can apply GameplayEffects that modify Attributes and trigger GameplayCues.

## Core Classes

### UAbilitySystemComponent (ASC)
The central component that manages abilities, effects, and attributes for an actor.
\`\`\`cpp
// Grant an ability
FGameplayAbilitySpecHandle GrantedHandle = ASC->GiveAbility(
    FGameplayAbilitySpec(AbilityClass, Level, InputID, SourceObject)
);

// Activate by class
bool bSuccess = ASC->TryActivateAbilityByClass(AbilityClass);

// Activate by tag
ASC->TryActivateAbilitiesByTag(FGameplayTagContainer(AbilityTag));

// Activate by handle
ASC->TryActivateAbility(GrantedHandle);

// Cancel abilities by tag
ASC->CancelAbilities(&CancelTag);

// Apply a Gameplay Effect
FGameplayEffectSpecHandle SpecHandle = ASC->MakeOutgoingSpec(EffectClass, Level, ASC->MakeEffectContext());
ASC->ApplyGameplayEffectSpecToSelf(*SpecHandle.Data.Get());

// Apply effect to another target
ASC->ApplyGameplayEffectSpecToTarget(*SpecHandle.Data.Get(), TargetASC);

// Remove active effect
ASC->RemoveActiveGameplayEffect(ActiveEffectHandle);

// Check if ability is active
bool bActive = ASC->IsAbilityActive(AbilityClass);

// Get active abilities by tag
TArray<FGameplayAbilitySpec*> Specs;
ASC->GetActivatableGameplayAbilitySpecsByAllMatchingTags(TagContainer, Specs);
\`\`\`

### Key ASC Properties
- \`ActivatableAbilities\` - FGameplayAbilitySpecContainer of all granted abilities.
- \`ActiveGameplayEffects\` - FActiveGameplayEffectsContainer of applied effects.
- \`SpawnedAttributes\` - TArray<UAttributeSet*> of attribute sets.

### ASC on PlayerState vs Pawn
- **On Pawn**: Simpler setup. ASC is created with the pawn, destroyed with it.
- **On PlayerState**: Persists across pawn respawns. Recommended for multiplayer.

## UGameplayAbility

### Key Properties
- \`AbilityTags\` - FGameplayTagContainer: Tags that describe this ability.
- \`CancelAbilitiesWithTag\` - Abilities with these tags are canceled when this activates.
- \`BlockAbilitiesWithTag\` - Abilities with these tags cannot activate while this is active.
- \`ActivationRequiredTags\` - ASC must have these tags for activation.
- \`ActivationBlockedTags\` - ASC must NOT have these tags for activation.
- \`CooldownGameplayEffectClass\` - TSubclassOf<UGameplayEffect> for cooldown.
- \`CostGameplayEffectClass\` - TSubclassOf<UGameplayEffect> for cost.
- \`NetExecutionPolicy\` - EGameplayAbilityNetExecutionPolicy (LocalPredicted, LocalOnly, ServerInitiated, ServerOnly).
- \`InstancingPolicy\` - EGameplayAbilityInstancingPolicy (InstancedPerActor, InstancedPerExecution, NonInstanced).

### Key Virtual Methods
\`\`\`cpp
// Can this ability be activated?
virtual bool CanActivateAbility(
    const FGameplayAbilitySpecHandle Handle,
    const FGameplayAbilityActorInfo* ActorInfo,
    const FGameplayTagContainer* SourceTags,
    const FGameplayTagContainer* TargetTags,
    FGameplayTagContainer* OptionalRelevantTags
) const;

// Called when the ability is activated
virtual void ActivateAbility(
    const FGameplayAbilitySpecHandle Handle,
    const FGameplayAbilityActorInfo* ActorInfo,
    const FGameplayAbilityActivationInfo ActivationInfo,
    const FGameplayEventData* TriggerEventData
);

// End the ability
void EndAbility(
    const FGameplayAbilitySpecHandle Handle,
    const FGameplayAbilityActorInfo* ActorInfo,
    const FGameplayAbilityActivationInfo ActivationInfo,
    bool bReplicateEndAbility,
    bool bWasCancelled
);

// Get cooldown effect
virtual UGameplayEffect* GetCooldownGameplayEffect() const;

// Get cost effect
virtual UGameplayEffect* GetCostGameplayEffect() const;

// Commit ability (apply cost and cooldown)
virtual bool CommitAbility(
    const FGameplayAbilitySpecHandle Handle,
    const FGameplayAbilityActorInfo* ActorInfo,
    const FGameplayAbilityActivationInfo ActivationInfo
);

// Apply gameplay effect to owner
FActiveGameplayEffectHandle ApplyGameplayEffectToOwner(
    const FGameplayAbilitySpecHandle Handle,
    const FGameplayAbilityActorInfo* ActorInfo,
    const FGameplayAbilityActivationInfo ActivationInfo,
    const UGameplayEffect* GameplayEffect,
    float GameplayEffectLevel,
    int32 Stacking = 1
);
\`\`\`

### Ability Tasks
Latent nodes within abilities (async operations):
- \`UAbilityTask_PlayMontageAndWait\` - Play a montage, wait for end/interrupted/cancelled.
- \`UAbilityTask_WaitGameplayEvent\` - Wait for a gameplay event by tag.
- \`UAbilityTask_WaitTargetData\` - Wait for targeting data.
- \`UAbilityTask_WaitInputPress\` / \`WaitInputRelease\` - Wait for input.
- \`UAbilityTask_WaitDelay\` - Timer delay.
- \`UAbilityTask_WaitGameplayEffectRemoved\` - Wait for effect removal.
- \`UAbilityTask_WaitAbilityActivate\` / \`WaitAbilityCommit\` - Wait for other abilities.
- \`UAbilityTask_WaitGameplayTagAdded\` / \`Removed\` - Wait for tag changes.
- \`UAbilityTask_SpawnActor\` - Spawn with ability context.

\`\`\`cpp
// Example: Play montage in ability
UAbilityTask_PlayMontageAndWait* Task = UAbilityTask_PlayMontageAndWait::CreatePlayMontageAndWaitProxy(
    this,
    NAME_None,
    AttackMontage,
    1.0f,   // Rate
    NAME_None, // StartSection
    false   // bStopWhenAbilityEnds
);
Task->OnCompleted.AddDynamic(this, &UMyAbility::OnMontageCompleted);
Task->OnInterrupted.AddDynamic(this, &UMyAbility::OnMontageCancelled);
Task->OnCancelled.AddDynamic(this, &UMyAbility::OnMontageCancelled);
Task->ReadyForActivation();
\`\`\`

## UGameplayEffect (GE)

### Duration Policies (EGameplayEffectDurationType)
- \`Instant\` - Applied immediately and permanently (e.g., damage).
- \`HasDuration\` - Lasts for a specified duration. Removed when duration expires.
- \`Infinite\` - Lasts until explicitly removed.

### Modifiers (FGameplayModifierInfo)
Each modifier targets an attribute:
- \`Attribute\` - FGameplayAttribute to modify.
- \`ModifierOp\` - EGameplayModOp (Additive, Multiplicative, Division, Override).
- \`ModifierMagnitude\` - FGameplayEffectModifierMagnitude (ScalableFloat, AttributeBased, CustomCalculation, SetByCaller).

### Modifier Magnitude Types
- \`ScalableFloat\` - A float or curve table value.
- \`AttributeBased\` - Based on another attribute value.
- \`CustomCalculationClass\` - Uses a UGameplayModMagnitudeCalculation subclass.
- \`SetByCaller\` - Magnitude set at runtime via tag.

\`\`\`cpp
// SetByCaller example
FGameplayEffectSpecHandle Spec = ASC->MakeOutgoingSpec(DamageEffect, 1, Context);
Spec.Data->SetSetByCallerMagnitude(DamageTag, 50.f);
ASC->ApplyGameplayEffectSpecToTarget(*Spec.Data, TargetASC);
\`\`\`

### Effect Stacking
- \`StackingType\` - EGameplayEffectStackingType (None, AggregateBySource, AggregateByTarget).
- \`StackLimitCount\` - Max stacks.
- \`StackDurationRefreshPolicy\` - RefreshOnSuccessfulApplication, NeverRefresh.
- \`StackPeriodResetPolicy\` - ResetOnSuccessfulApplication, NeverReset.
- \`StackExpirationPolicy\` - ClearEntireStack, RemoveSingleStackAndRefreshDuration, RefreshDuration.

### Granted Tags
- \`InheritableOwnedTagsContainer\` - Tags granted to the target while effect is active.
- \`InheritableBlockedTagsContainer\` - Tags blocked on the target while effect is active.

### Application Requirements
- \`ApplicationTagRequirements\` - Target must have/not have these tags for application.
- \`RemovalTagRequirements\` - Effect is removed when these tag conditions are met.

## FGameplayAttributeData

### UAttributeSet
\`\`\`cpp
UCLASS()
class UMyAttributeSet : public UAttributeSet
{
    GENERATED_BODY()
public:
    UPROPERTY(BlueprintReadOnly, Category = "Health", ReplicatedUsing = OnRep_Health)
    FGameplayAttributeData Health;
    ATTRIBUTE_ACCESSORS(UMyAttributeSet, Health)

    UPROPERTY(BlueprintReadOnly, Category = "Health", ReplicatedUsing = OnRep_MaxHealth)
    FGameplayAttributeData MaxHealth;
    ATTRIBUTE_ACCESSORS(UMyAttributeSet, MaxHealth)

    UPROPERTY(BlueprintReadOnly, Category = "Damage")
    FGameplayAttributeData Damage; // Meta attribute, not replicated

    // Clamp values before effects are applied
    virtual void PreAttributeChange(const FGameplayAttribute& Attribute, float& NewValue) override;

    // Respond to attribute changes after GE application
    virtual void PostGameplayEffectExecute(const FGameplayEffectModCallbackData& Data) override;

    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
};
\`\`\`

### ATTRIBUTE_ACCESSORS Macro
\`\`\`cpp
#define ATTRIBUTE_ACCESSORS(ClassName, PropertyName) \\
    GAMEPLAYATTRIBUTE_PROPERTY_GETTER(ClassName, PropertyName) \\
    GAMEPLAYATTRIBUTE_VALUE_GETTER(PropertyName) \\
    GAMEPLAYATTRIBUTE_VALUE_SETTER(PropertyName) \\
    GAMEPLAYATTRIBUTE_VALUE_INITTER(PropertyName)

// This generates:
// static FGameplayAttribute GetPropertyNameAttribute();
// float GetPropertyName() const;
// void SetPropertyName(float NewVal);
// void InitPropertyName(float NewVal);
\`\`\`

## Gameplay Tags

### FGameplayTag
Hierarchical tag (e.g., "Ability.Skill.Fireball", "State.Dead", "Damage.Type.Fire").
\`\`\`cpp
FGameplayTag FireTag = FGameplayTag::RequestGameplayTag(FName("Damage.Type.Fire"));

// Check tag matching
bool bMatches = Tag1.MatchesTag(Tag2);         // Exact or parent match
bool bExact = Tag1.MatchesTagExact(Tag2);      // Exact match only
\`\`\`

### FGameplayTagContainer
Collection of gameplay tags.
\`\`\`cpp
FGameplayTagContainer Tags;
Tags.AddTag(FireTag);
Tags.RemoveTag(FireTag);
bool bHas = Tags.HasTag(FireTag);                    // Has this or parent
bool bHasExact = Tags.HasTagExact(FireTag);           // Exact match
bool bHasAny = Tags.HasAny(OtherContainer);           // Any overlap
bool bHasAll = Tags.HasAll(OtherContainer);            // Contains all
\`\`\`

## Gameplay Cues

Visual/audio effects triggered by GAS. Handled by \`AGameplayCueNotify_Actor\` or \`UGameplayCueNotify_Static\`.
- Tags must start with "GameplayCue." (e.g., "GameplayCue.Ability.Fireball.Impact").
- \`OnActive\` / \`WhileActive\` / \`OnRemove\` / \`OnExecute\` callbacks.

\`\`\`cpp
// Trigger from ability
FGameplayCueParameters CueParams;
CueParams.Location = HitLocation;
CueParams.Normal = HitNormal;
ASC->ExecuteGameplayCue(GameplayCueTag, CueParams);

// Or add persistent cue (lasts until removed)
ASC->AddGameplayCue(GameplayCueTag, CueParams);
ASC->RemoveGameplayCue(GameplayCueTag);
\`\`\`

## UE 5.7 GAS Changes
- Gameplay Effect Component system refactored for cleaner effect composition.
- Improved SetByCaller debugging with named magnitude logging.
- Ability batching improvements for reducing RPC count in multiplayer.
- Gameplay Cue manager performance improvements for large cue libraries.
- AttributeSet property change callbacks have additional context data.
- Enhanced support for predictive ability activation with rollback.
`;
