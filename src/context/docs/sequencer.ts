/**
 * UE 5.7 Sequencer API Context Documentation
 *
 * Covers ULevelSequence, UMovieScene, tracks, sections,
 * channels, keyframe manipulation, and cinematics.
 */

export const sequencerContext = `
# UE 5.7 Sequencer API Reference

## Overview

Sequencer is UE5's cinematic and animation timeline system. It uses a track/section/channel
hierarchy to animate actors, properties, events, and cameras over time.

## Core Classes

### ULevelSequence
The top-level asset that contains a movie scene and binding references.
- \`ULevelSequence::MovieScene\` - UMovieScene* containing all tracks and data.
- \`ULevelSequence::GetMovieScene()\` - Returns the UMovieScene.
- \`ULevelSequence::FindBindingFromObject(UObject*, UWorld*)\` - Find a binding for an object.
- \`ULevelSequence::FindOrAddBinding(UObject*)\` - Find or create a binding.

### ALevelSequenceActor
The actor placed in a level that references and plays a ULevelSequence.
- \`LevelSequenceAsset\` - TSoftObjectPtr<ULevelSequence>.
- \`PlaybackSettings\` - FMovieSceneSequencePlaybackSettings.
- \`SequencePlayer\` - ULevelSequencePlayer* (runtime player).

### ULevelSequencePlayer
Runtime playback controller.
\`\`\`cpp
// Create and play a sequence
ALevelSequenceActor* SequenceActor;
ULevelSequencePlayer* Player = ULevelSequencePlayer::CreateLevelSequencePlayer(
    GetWorld(),
    LevelSequence,
    FMovieSceneSequencePlaybackSettings(),
    SequenceActor
);

Player->Play();
Player->Pause();
Player->Stop();
Player->GoToEndAndStop();
Player->PlayReverse();

// Set playback position
FFrameTime TargetFrame(100);
Player->SetPlaybackPosition(FMovieSceneSequencePlaybackParams(TargetFrame, EUpdatePositionMethod::Play));

// Playback rate
Player->SetPlayRate(2.0f);

// Looping
FMovieSceneSequencePlaybackSettings Settings;
Settings.LoopCount.Value = 3; // Loop 3 times (-1 = infinite)
Player->SetPlaybackSettings(Settings);

// Events
Player->OnPlay.AddDynamic(this, &AMyActor::OnSequencePlay);
Player->OnPause.AddDynamic(this, &AMyActor::OnSequencePause);
Player->OnStop.AddDynamic(this, &AMyActor::OnSequenceStop);
Player->OnFinished.AddDynamic(this, &AMyActor::OnSequenceFinished);
\`\`\`

### UMovieScene
The container for all sequencer data within a level sequence.
- \`UMovieScene::GetPlaybackRange()\` - TRange<FFrameNumber> playback range.
- \`UMovieScene::SetPlaybackRange(FFrameNumber Start, int32 Duration)\` - Set range.
- \`UMovieScene::GetTickResolution()\` - FFrameRate (typically 24000fps internal).
- \`UMovieScene::GetDisplayRate()\` - FFrameRate (typically 30fps display).
- \`UMovieScene::GetMasterTracks()\` - TArray<UMovieSceneTrack*> non-bound tracks.
- \`UMovieScene::GetBindings()\` - TArray<FMovieSceneBinding> actor bindings.
- \`UMovieScene::FindBinding(FGuid)\` - Find a specific binding by GUID.

### FMovieSceneBinding
Links a track group to a bound object (actor, component, etc.).
- \`GetObjectGuid()\` - FGuid identifier.
- \`GetName()\` - Display name.
- \`GetTracks()\` - TArray<UMovieSceneTrack*> tracks for this binding.

## Track Types (UMovieSceneTrack subclasses)

### Property Tracks
- \`UMovieSceneFloatTrack\` - Animates a float property.
- \`UMovieSceneDoubleTrack\` - Animates a double property.
- \`UMovieSceneBoolTrack\` - Animates a bool property.
- \`UMovieSceneIntegerTrack\` - Animates an integer property.
- \`UMovieSceneByteTrack\` - Animates a byte/enum property.
- \`UMovieSceneStringTrack\` - Animates a string property.
- \`UMovieSceneColorTrack\` - Animates FLinearColor.
- \`UMovieSceneVectorTrack\` - Animates FVector.
- \`UMovieScene3DTransformTrack\` - Animates Location/Rotation/Scale (9 channels).
- \`UMovieSceneEnumTrack\` - Animates enum properties.

### Specialized Tracks
- \`UMovieSceneSkeletalAnimationTrack\` - Plays UAnimSequence on SkeletalMesh.
- \`UMovieSceneParticleTrack\` - Controls particle systems (activate/deactivate).
- \`UMovieSceneAudioTrack\` - Plays audio clips.
- \`UMovieSceneCameraCutTrack\` - Switches between camera viewpoints.
- \`UMovieSceneFadeTrack\` - Screen fade in/out.
- \`UMovieSceneEventTrack\` - Triggers Blueprint/C++ events at specific frames.
- \`UMovieSceneLevelVisibilityTrack\` - Shows/hides sublevels.
- \`UMovieSceneSpawnTrack\` - Spawns/despawns actors.
- \`UMovieSceneMaterialParameterCollectionTrack\` - Animates MPC parameters.
- \`UMovieSceneSubTrack\` - Embeds a sub-sequence.
- \`UMovieSceneObjectPropertyTrack\` - Animates UObject* references.
- \`UMovieSceneCVarTrack\` - Animates console variables.

## Sections (UMovieSceneSection subclasses)

Sections define time ranges within tracks and contain the actual data channels.

### UMovieSceneSection (base)
- \`GetRange()\` / \`SetRange(TRange<FFrameNumber>)\` - Time range.
- \`GetInclusiveStartFrame()\` / \`GetExclusiveEndFrame()\` - Frame boundaries.
- \`IsActive()\` / \`SetIsActive(bool)\` - Whether the section is evaluated.
- \`GetBlendType()\` - EMovieSceneBlendType (Absolute, Additive, Relative).
- \`GetRowIndex()\` - Row within the track.

### Common Section Types
- \`UMovieSceneFloatSection\` - Contains FMovieSceneFloatChannel.
- \`UMovieScene3DTransformSection\` - Contains 9 float channels (Location XYZ, Rotation XYZ, Scale XYZ).
- \`UMovieSceneSkeletalAnimationSection\` - References a UAnimSequence with playback params.
- \`UMovieSceneAudioSection\` - References a USoundBase.
- \`UMovieSceneEventSection\` / \`UMovieSceneEventTriggerSection\` / \`UMovieSceneEventRepeaterSection\` - Event types.
- \`UMovieSceneCameraCutSection\` - Camera binding reference.
- \`UMovieSceneSubSection\` - Sub-sequence reference.

## Channels and Keyframes

### FMovieSceneFloatChannel
The most common channel type. Stores float keyframes.
\`\`\`cpp
// Get channel from a float section
FMovieSceneFloatChannel* Channel = Section->GetChannel();

// Add a keyframe
FFrameNumber Frame(30);
float Value = 100.0f;
Channel->AddCubicKey(Frame, Value); // Cubic interpolation
// or
FMovieSceneFloatValue KeyValue(Value);
KeyValue.InterpMode = RCIM_Cubic;
KeyValue.TangentMode = RCTM_Auto;
int32 KeyIndex = Channel->AddLinearKey(Frame, Value);

// Set keyframe value
Channel->GetData().GetValues()[KeyIndex] = FMovieSceneFloatValue(NewValue);

// Remove a keyframe
Channel->GetData().RemoveKey(KeyIndex);

// Evaluate at a frame
float Result;
Channel->Evaluate(Frame, Result);

// Set default value (when no keys exist)
Channel->SetDefault(0.0f);
\`\`\`

### Interpolation Modes (ERichCurveInterpMode)
- \`RCIM_Linear\` - Linear interpolation between keys.
- \`RCIM_Constant\` - Step/hold interpolation.
- \`RCIM_Cubic\` - Cubic spline interpolation (smooth curves).
- \`RCIM_None\` - No interpolation.

### Tangent Modes (ERichCurveTangentMode)
- \`RCTM_Auto\` - Automatic tangent calculation.
- \`RCTM_User\` - User-defined tangent handles.
- \`RCTM_Break\` - Broken tangent (in/out tangents independent).
- \`RCTM_None\` - No tangent mode.

## Camera Animation

### Camera Cuts
\`\`\`cpp
// Add a camera cut track
UMovieSceneCameraCutTrack* CutTrack = MovieScene->AddMasterTrack<UMovieSceneCameraCutTrack>();

// Add a camera cut section
UMovieSceneCameraCutSection* CutSection = Cast<UMovieSceneCameraCutSection>(
    CutTrack->CreateNewSection()
);
CutSection->SetRange(TRange<FFrameNumber>(StartFrame, EndFrame));

// Bind to a camera actor
FMovieSceneObjectBindingID BindingID = ...; // From FindBindingFromObject
CutSection->SetCameraBindingID(BindingID);
CutTrack->AddSection(*CutSection);
\`\`\`

### Camera Shake
- \`UMovieSceneCameraShakeSection\` - Triggers a camera shake.
- Bind to a CameraShakeBase class.

## Working with Bindings

### Adding an Actor to a Sequence
\`\`\`cpp
// Get or create a binding for an actor
FGuid BindingGuid = MovieScene->AddPossessable(
    Actor->GetFName().ToString(),
    Actor->GetClass()
);

// Or for spawnables (sequence owns the actor)
FGuid SpawnableGuid = MovieScene->AddSpawnable(
    Actor->GetFName().ToString(),
    *Actor
);

// Add a transform track to the binding
UMovieScene3DTransformTrack* TransformTrack = MovieScene->AddTrack<UMovieScene3DTransformTrack>(BindingGuid);
\`\`\`

### Binding Actors at Runtime
\`\`\`cpp
// Override bindings at runtime
ALevelSequenceActor* SeqActor = ...;
FMovieSceneObjectBindingID BindingID = ...;
SeqActor->SetBinding(BindingID, { TargetActor });

// Or via the player
ULevelSequencePlayer* Player = SeqActor->GetSequencePlayer();
Player->SetBinding(BindingID, { TargetActor });
\`\`\`

## Event Tracks

### Triggering Events
\`\`\`cpp
// UMovieSceneEventTrack for calling Blueprint events or C++ functions
// Events are bound via FMovieSceneEvent:
// - FunctionName: name of the UFunction to call
// - BoundObjectProperty: which bound object to call on
\`\`\`

### Event Section Types
- \`UMovieSceneEventTriggerSection\` - One-shot events at specific frames.
- \`UMovieSceneEventRepeaterSection\` - Events that fire every frame within a range.

## Programmatic Sequence Creation
\`\`\`cpp
// 1. Create the level sequence asset
ULevelSequence* NewSequence = NewObject<ULevelSequence>(Package, FName("LS_MyCutscene"), RF_Public | RF_Standalone);
NewSequence->Initialize();

UMovieScene* MovieScene = NewSequence->GetMovieScene();

// 2. Set frame rate and range
MovieScene->SetDisplayRate(FFrameRate(30, 1));
FFrameNumber StartFrame(0);
FFrameNumber EndFrame(150); // 5 seconds at 30fps
MovieScene->SetPlaybackRange(StartFrame, (EndFrame - StartFrame).Value);

// 3. Add a camera cut track
UMovieSceneCameraCutTrack* CutTrack = MovieScene->AddMasterTrack<UMovieSceneCameraCutTrack>();

// 4. Add actor binding
FGuid ActorBinding = MovieScene->AddPossessable("MyActor", AMyActor::StaticClass());

// 5. Add a transform track
UMovieScene3DTransformTrack* TransformTrack = MovieScene->AddTrack<UMovieScene3DTransformTrack>(ActorBinding);
UMovieScene3DTransformSection* TransformSection = Cast<UMovieScene3DTransformSection>(
    TransformTrack->CreateNewSection()
);
TransformSection->SetRange(TRange<FFrameNumber>(StartFrame, EndFrame));
TransformTrack->AddSection(*TransformSection);

// 6. Set keyframes on the Location X channel
TArrayView<FMovieSceneFloatChannel*> Channels = TransformSection->GetChannelProxy().GetChannels<FMovieSceneFloatChannel>();
// Channels[0] = Location.X, [1] = Location.Y, [2] = Location.Z
// Channels[3] = Rotation.X, [4] = Rotation.Y, [5] = Rotation.Z
// Channels[6] = Scale.X, [7] = Scale.Y, [8] = Scale.Z
Channels[0]->AddCubicKey(FFrameNumber(0), 0.0f);
Channels[0]->AddCubicKey(FFrameNumber(150), 1000.0f);
\`\`\`

## UE 5.7 Sequencer Changes
- Improved multi-user editing support for sequences.
- Track filtering and organization improvements in the Sequencer UI.
- Better subsequence instancing for reusable cinematic segments.
- FMovieSceneDoubleChannel is now the default for transform tracks (higher precision).
- Enhanced event track debugging with timeline visualization of fired events.
- Camera rig rail and crane improvements for virtual production workflows.
`;
