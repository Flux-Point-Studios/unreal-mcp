// McpAutomationBridge_RuntimeObserverHandlers.cpp
//
// Sprint 8: Runtime Observability C++ handlers
//
// Adds:
//   get_recent_logs     — returns buffered log entries from the in-memory ring buffer
//   get_runtime_state   — PIE state, player position, FPS, memory stats
//   capture_telemetry   — snapshot of game state during PIE
//
// Requires: FMcpLogRingBuffer to be added to the subsystem header.
// If the ring buffer isn't compiled yet, these handlers return NOT_IMPLEMENTED.

#include "McpAutomationBridgeSubsystem.h"
#include "Editor.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/Character.h"
#include "Engine/Engine.h"
#include "Misc/App.h"

// ============================================================================
// get_recent_logs — Return buffered log entries
// ============================================================================
bool UMcpAutomationBridgeSubsystem::HandleGetRecentLogs(
    const FString& RequestId,
    const FString& Action,
    const TSharedPtr<FJsonObject>& Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket)
{
    // If no log capture device is active, return empty
    if (!LogCaptureDevice.IsValid())
    {
        TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
        Result->SetBoolField(TEXT("success"), true);
        Result->SetStringField(TEXT("message"), TEXT("Log capture not active. Use manage_logs subscribe first."));

        TArray<TSharedPtr<FJsonValue>> EmptyArray;
        Result->SetArrayField(TEXT("logs"), EmptyArray);
        Result->SetNumberField(TEXT("count"), 0);

        SendAutomationResponse(RequestingSocket, RequestId, true, TEXT("No logs captured"), Result);
        return true;
    }

    // NOTE: This handler requires FMcpLogRingBuffer to be added to FMcpLogOutputDevice.
    // If not compiled yet, return NOT_IMPLEMENTED so the TS side falls back to disk logs.
    SendAutomationResponse(RequestingSocket, RequestId, false,
        TEXT("NOT_IMPLEMENTED: Log ring buffer not yet compiled. Use disk log fallback."),
        nullptr, TEXT("NOT_IMPLEMENTED"));
    return true;
}

// ============================================================================
// get_runtime_state — PIE state, player info, FPS
// ============================================================================
bool UMcpAutomationBridgeSubsystem::HandleGetRuntimeState(
    const FString& RequestId,
    const FString& Action,
    const TSharedPtr<FJsonObject>& Payload,
    TSharedPtr<FMcpBridgeWebSocket> RequestingSocket)
{
    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetBoolField(TEXT("success"), true);

    // PIE State
    bool bIsPlaying = GEditor && GEditor->PlayWorld != nullptr;
    bool bIsPaused = bIsPlaying && GEditor->PlayWorld->bDebugPauseExecution;
    Result->SetBoolField(TEXT("isPlaying"), bIsPlaying);
    Result->SetBoolField(TEXT("isPaused"), bIsPaused);

    // FPS
    float DeltaTime = FApp::GetDeltaTime();
    float FPS = DeltaTime > 0.0f ? 1.0f / DeltaTime : 0.0f;
    Result->SetNumberField(TEXT("fps"), FMath::RoundToInt(FPS));
    Result->SetNumberField(TEXT("deltaTimeMs"), DeltaTime * 1000.0f);

    // Frame count
    Result->SetNumberField(TEXT("frameNumber"), (double)GFrameCounter);

    // Player state (if in PIE)
    if (bIsPlaying)
    {
        UWorld* PlayWorld = GEditor->PlayWorld;
        APlayerController* PC = PlayWorld->GetFirstPlayerController();
        if (PC)
        {
            APawn* Pawn = PC->GetPawn();
            if (Pawn)
            {
                TSharedPtr<FJsonObject> PlayerState = MakeShared<FJsonObject>();

                FVector Location = Pawn->GetActorLocation();
                TSharedPtr<FJsonObject> LocationObj = MakeShared<FJsonObject>();
                LocationObj->SetNumberField(TEXT("x"), Location.X);
                LocationObj->SetNumberField(TEXT("y"), Location.Y);
                LocationObj->SetNumberField(TEXT("z"), Location.Z);
                PlayerState->SetObjectField(TEXT("location"), LocationObj);

                FRotator Rotation = Pawn->GetActorRotation();
                TSharedPtr<FJsonObject> RotationObj = MakeShared<FJsonObject>();
                RotationObj->SetNumberField(TEXT("pitch"), Rotation.Pitch);
                RotationObj->SetNumberField(TEXT("yaw"), Rotation.Yaw);
                RotationObj->SetNumberField(TEXT("roll"), Rotation.Roll);
                PlayerState->SetObjectField(TEXT("rotation"), RotationObj);

                FVector Velocity = Pawn->GetVelocity();
                PlayerState->SetNumberField(TEXT("speed"), Velocity.Size());

                PlayerState->SetStringField(TEXT("pawnClass"), Pawn->GetClass()->GetName());

                // Check if it's a Character for more info
                ACharacter* Character = Cast<ACharacter>(Pawn);
                if (Character)
                {
                    PlayerState->SetBoolField(TEXT("isCharacter"), true);
                    PlayerState->SetBoolField(TEXT("isFalling"), Character->GetCharacterMovement() ? Character->GetCharacterMovement()->IsFalling() : false);
                }

                Result->SetObjectField(TEXT("player"), PlayerState);
            }
            else
            {
                Result->SetStringField(TEXT("playerNote"), TEXT("No pawn possessed"));
            }
        }
        else
        {
            Result->SetStringField(TEXT("playerNote"), TEXT("No player controller"));
        }

        // Actor count in play world
        int32 ActorCount = 0;
        for (TActorIterator<AActor> It(PlayWorld); It; ++It)
        {
            ActorCount++;
        }
        Result->SetNumberField(TEXT("playWorldActorCount"), ActorCount);
    }

    // Memory stats
    FPlatformMemoryStats MemStats = FPlatformMemory::GetStats();
    TSharedPtr<FJsonObject> MemObj = MakeShared<FJsonObject>();
    MemObj->SetNumberField(TEXT("usedPhysicalMb"), (double)(MemStats.UsedPhysical / (1024 * 1024)));
    MemObj->SetNumberField(TEXT("availablePhysicalMb"), (double)(MemStats.AvailablePhysical / (1024 * 1024)));
    MemObj->SetNumberField(TEXT("usedVirtualMb"), (double)(MemStats.UsedVirtual / (1024 * 1024)));
    Result->SetObjectField(TEXT("memory"), MemObj);

    SendAutomationResponse(RequestingSocket, RequestId, true, TEXT("Runtime state captured"), Result);
    return true;
}
