/**
 * UE 5.7 Enhanced Input API Context Documentation
 *
 * Covers UInputAction, UInputMappingContext, triggers,
 * modifiers, and input action values.
 */

export const enhancedInputContext = `
# UE 5.7 Enhanced Input API Reference

## Overview

Enhanced Input replaces the legacy input system in UE5. It provides:
- **Input Actions** - Abstract input events (e.g., "Jump", "Move") decoupled from physical keys.
- **Input Mapping Contexts** - Map physical inputs to actions. Multiple contexts can be active with priorities.
- **Triggers** - Define when an action fires (pressed, released, held, chord, etc.).
- **Modifiers** - Transform input values (negate, scale, swizzle, dead zone, etc.).

## Core Classes

### UInputAction
An abstract input event. Does not know about specific keys.
- \`ValueType\` - EInputActionValueType: Bool, Axis1D (float), Axis2D (FVector2D), Axis3D (FVector).
- \`bConsumeInput\` - Whether this action consumes the input.
- \`Triggers\` - TArray<UInputTrigger*> - Default triggers applied to all mappings.
- \`Modifiers\` - TArray<UInputModifier*> - Default modifiers applied to all mappings.

\`\`\`cpp
// Create in editor as a Data Asset of type UInputAction
// Or at runtime:
UInputAction* JumpAction = NewObject<UInputAction>(this);
JumpAction->ValueType = EInputActionValueType::Bool;
\`\`\`

### UInputMappingContext (IMC)
Maps physical keys/axes to Input Actions, with optional per-mapping triggers and modifiers.
- \`Mappings\` - TArray<FEnhancedActionKeyMapping>.
- \`MapKey(UInputAction*, FKey)\` - Add a key mapping programmatically.
- \`UnmapKey(UInputAction*, FKey)\` - Remove a key mapping.
- \`UnmapAction(UInputAction*)\` - Remove all mappings for an action.
- \`UnmapAll()\` - Clear all mappings.

### FEnhancedActionKeyMapping
A single key-to-action mapping within a context.
- \`Action\` - UInputAction* target action.
- \`Key\` - FKey (e.g., EKeys::W, EKeys::Gamepad_LeftStick_X).
- \`Triggers\` - TArray<UInputTrigger*> per-mapping triggers.
- \`Modifiers\` - TArray<UInputModifier*> per-mapping modifiers.
- \`bIsPlayerMappable\` - Whether players can rebind this in settings.

### UEnhancedInputLocalPlayerSubsystem
Per-player subsystem managing active mapping contexts.
\`\`\`cpp
UEnhancedInputLocalPlayerSubsystem* Subsystem =
    ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PlayerController->GetLocalPlayer());

// Add a mapping context (higher priority = takes precedence)
Subsystem->AddMappingContext(DefaultMappingContext, 0 /* priority */);
Subsystem->AddMappingContext(VehicleMappingContext, 1 /* higher priority */);

// Remove a mapping context
Subsystem->RemoveMappingContext(VehicleMappingContext);

// Clear all
Subsystem->ClearAllMappings();

// Check if context is active
bool bActive = Subsystem->HasMappingContext(DefaultMappingContext);

// Query mapped keys for an action
TArray<FKey> Keys = Subsystem->QueryKeysMappedToAction(MoveAction);
\`\`\`

### UEnhancedInputComponent
Replaces UInputComponent for binding Enhanced Input actions.
\`\`\`cpp
void AMyCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    UEnhancedInputComponent* EIC = CastChecked<UEnhancedInputComponent>(PlayerInputComponent);

    // Bind actions
    EIC->BindAction(JumpAction, ETriggerEvent::Triggered, this, &AMyCharacter::Jump);
    EIC->BindAction(JumpAction, ETriggerEvent::Completed, this, &AMyCharacter::StopJumping);
    EIC->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AMyCharacter::Move);
    EIC->BindAction(LookAction, ETriggerEvent::Triggered, this, &AMyCharacter::Look);
}
\`\`\`

## Trigger Events (ETriggerEvent)

Triggers fire at different phases of input:

- \`ETriggerEvent::None\` - No trigger event (internal use).
- \`ETriggerEvent::Triggered\` - **Most common.** Fires when trigger conditions are met (key down for pressed, etc.).
- \`ETriggerEvent::Started\` - Fires once when triggering begins (first frame of trigger).
- \`ETriggerEvent::Ongoing\` - Fires continuously while triggering conditions remain true (after Started, before Triggered completes).
- \`ETriggerEvent::Canceled\` - Fires when trigger conditions fail before completing.
- \`ETriggerEvent::Completed\` - Fires when trigger conditions end normally (key released for pressed trigger).

## Input Trigger Types (UInputTrigger subclasses)

### UInputTriggerPressed
- Fires once when input goes from inactive to active.
- Default trigger for Bool actions.

### UInputTriggerReleased
- Fires once when input goes from active to inactive.

### UInputTriggerDown
- Fires every frame while input is active (held down).
- Default trigger for Axis actions.

### UInputTriggerHold
- Fires after holding input for a specified duration.
- \`HoldTimeThreshold\` - float seconds.
- \`bIsOneShot\` - If true, fires once; if false, fires every frame after threshold.

### UInputTriggerHoldAndRelease
- Fires on release only if held for the required duration.
- \`HoldTimeThreshold\` - float seconds.

### UInputTriggerTap
- Fires on release only if pressed and released within the time threshold.
- \`TapReleaseTimeThreshold\` - float seconds.

### UInputTriggerPulse
- Fires repeatedly at an interval while held.
- \`bTriggerOnStart\` - Whether to fire immediately.
- \`Interval\` - float seconds between pulses.
- \`TriggerLimit\` - Max number of pulses (0 = unlimited).

### UInputTriggerChordAction
- Requires another Input Action to also be active.
- \`ChordAction\` - The required UInputAction*.
- Useful for combos (e.g., Shift+Click).

### UInputTriggerCombo (UE 5.7)
- Fires when a sequence of actions are performed in order within time windows.
- \`ComboActions\` - TArray of combo step definitions.

## Input Modifier Types (UInputModifier subclasses)

### UInputModifierNegate
- Inverts input value. \`bX\`, \`bY\`, \`bZ\` control which axes.
- Common for making S/Down move backward by negating the forward axis.

### UInputModifierSwizzleAxis
- Reorders axes. \`Order\` - EInputAxisSwizzle (YXZ, ZYX, etc.).
- Common for mapping D key to Y axis of a 2D move action.

### UInputModifierScalar
- Multiplies input by a scale factor.
- \`Scalar\` - FVector (per-axis scale).

### UInputModifierDeadZone
- Applies a dead zone to eliminate small analog stick noise.
- \`LowerThreshold\` / \`UpperThreshold\` - Range thresholds.
- \`Type\` - EDeadZoneType (Axial, Radial).

### UInputModifierSmooth
- Smooths input over time.
- \`SmoothingMethod\` - No smoothing, exponential, etc.

### UInputModifierResponseCurve
- Applies a curve to the input value.
- \`ResponseCurve\` - FRuntimeFloatCurve per axis.
- \`CurveExponent\` - For exponential curve type.

### UInputModifierFOVScaling
- Scales input based on camera FOV (useful for look sensitivity).
- \`FOVScale\` - float.

### UInputModifierToWorldSpace
- Transforms input from player space to world space.

## Input Action Values

### FInputActionValue
The value delivered to action callbacks.
\`\`\`cpp
void AMyCharacter::Move(const FInputActionValue& Value)
{
    // For Axis2D (e.g., WASD movement)
    FVector2D MovementVector = Value.Get<FVector2D>();
    float ForwardValue = MovementVector.Y;
    float RightValue = MovementVector.X;

    // For Bool (e.g., jump)
    bool bJump = Value.Get<bool>();

    // For Axis1D (e.g., throttle)
    float Throttle = Value.Get<float>();

    // For Axis3D (e.g., VR controller)
    FVector Motion = Value.Get<FVector>();
}
\`\`\`

## Common Setup Pattern

### Character Header
\`\`\`cpp
UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
UInputAction* MoveAction;

UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
UInputAction* LookAction;

UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
UInputAction* JumpAction;

UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
UInputMappingContext* DefaultMappingContext;
\`\`\`

### Character BeginPlay
\`\`\`cpp
void AMyCharacter::BeginPlay()
{
    Super::BeginPlay();

    if (APlayerController* PC = Cast<APlayerController>(Controller))
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
            ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
        {
            Subsystem->AddMappingContext(DefaultMappingContext, 0);
        }
    }
}
\`\`\`

### Mapping Context Setup (Editor or C++)
\`\`\`
MoveAction (Axis2D):
  W -> Modifiers: [Swizzle(YXZ)]                    // W = +Y (forward)
  S -> Modifiers: [Negate(Y), Swizzle(YXZ)]         // S = -Y (backward)
  A -> Modifiers: [Negate(X)]                        // A = -X (left)
  D -> Modifiers: []                                 // D = +X (right)
  Gamepad_LeftStick_2D -> Modifiers: [DeadZone(0.2)] // Analog stick

LookAction (Axis2D):
  Mouse_XY -> Modifiers: [Negate(Y)]                 // Invert mouse Y
  Gamepad_RightStick_2D -> Modifiers: [DeadZone(0.2), Scalar(25.0)]
\`\`\`

## UE 5.7 Enhanced Input Changes
- UInputTriggerCombo for defining input sequences.
- Player-mappable keys: \`bIsPlayerMappable\` flag on mappings with \`FPlayerMappableKeySlot\`.
- Improved modifier chaining with clearer evaluation order documentation.
- Input injection API refinements for automated testing and AI controllers.
- \`UEnhancedInputLocalPlayerSubsystem::QueryKeysMappedToAction\` for reverse lookup.
`;
