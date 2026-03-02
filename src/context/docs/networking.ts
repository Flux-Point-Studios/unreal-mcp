/**
 * UE 5.7 Networking/Replication API Context Documentation
 *
 * Covers property replication, RPCs, authority, prediction,
 * relevancy, and dormancy.
 */

export const networkingContext = `
# UE 5.7 Networking/Replication API Reference

## Overview

Unreal Engine uses a server-authoritative networking model:
- The **server** is the authority. It simulates gameplay and replicates state to clients.
- **Clients** receive replicated data and can request actions via RPCs.
- Replication is property-based (not state snapshot): only changed properties are sent.

## Property Replication

### Declaring Replicated Properties
\`\`\`cpp
// In the class header:
UPROPERTY(Replicated)
float Health;

UPROPERTY(ReplicatedUsing = OnRep_Health)
float Health;

// RepNotify callback
UFUNCTION()
void OnRep_Health();
\`\`\`

### GetLifetimeReplicatedProps
Every class with replicated properties must implement this:
\`\`\`cpp
void AMyActor::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);

    // Basic replication
    DOREPLIFETIME(AMyActor, Health);

    // With conditions
    DOREPLIFETIME_CONDITION(AMyActor, Health, COND_OwnerOnly);

    // With notification
    DOREPLIFETIME_CONDITION_NOTIFY(AMyActor, Health, COND_None, REPNOTIFY_OnChanged);
}
\`\`\`

### Replication Conditions (ELifetimeCondition)
- \`COND_None\` - Always replicate. No condition.
- \`COND_InitialOnly\` - Only replicate on initial bunch (first replication).
- \`COND_OwnerOnly\` - Only to the owning connection (e.g., health bar for your character).
- \`COND_SkipOwner\` - Replicate to everyone except the owner.
- \`COND_SimulatedOnly\` - Only to simulated proxies (non-owning clients).
- \`COND_AutonomousOnly\` - Only to the autonomous proxy (owning client).
- \`COND_SimulatedOrPhysics\` - Simulated proxies or those with physics.
- \`COND_InitialOrOwner\` - Initial replication or to owner.
- \`COND_Custom\` - Uses PreReplication to decide per-connection. \`DOREPLIFETIME_ACTIVE_OVERRIDE\` macro.
- \`COND_ReplayOrOwner\` - During replays or to owner.
- \`COND_ReplayOnly\` - Only during replays.
- \`COND_SkipReplay\` - Never during replays.
- \`COND_Dynamic\` - UE 5.x: runtime-togglable replication condition.

### REPNOTIFY Options
- \`REPNOTIFY_OnChanged\` - Only fire RepNotify when value actually changes (default).
- \`REPNOTIFY_Always\` - Always fire RepNotify even if value is the same.

### Custom Replication Conditions
\`\`\`cpp
// In header:
UPROPERTY(Replicated)
int32 SecretValue;

// In GetLifetimeReplicatedProps:
DOREPLIFETIME_CONDITION(AMyActor, SecretValue, COND_Custom);

// In PreReplication:
void AMyActor::PreReplication(IRepChangedPropertyTracker& ChangedPropertyTracker)
{
    Super::PreReplication(ChangedPropertyTracker);
    DOREPLIFETIME_ACTIVE_OVERRIDE(AMyActor, SecretValue, bShouldReplicate);
}
\`\`\`

## Remote Procedure Calls (RPCs)

### RPC Types
\`\`\`cpp
// Server RPC: Client -> Server. Only the owning client can call.
UFUNCTION(Server, Reliable)
void ServerDoAction(float Param);

// Client RPC: Server -> Owning Client.
UFUNCTION(Client, Reliable)
void ClientShowNotification(const FString& Message);

// NetMulticast RPC: Server -> All Connected Clients (and server).
UFUNCTION(NetMulticast, Reliable)
void MulticastPlayEffect(FVector Location);
\`\`\`

### Reliability
- \`Reliable\` - Guaranteed delivery, ordered. Use for important gameplay events. NEVER use for frequent updates.
- \`Unreliable\` - May be dropped. Use for cosmetic or frequently-sent data (e.g., aim direction).

### RPC Validation
\`\`\`cpp
// Validate RPC parameters server-side to prevent cheating
UFUNCTION(Server, Reliable, WithValidation)
void ServerUseAbility(int32 AbilityIndex);

bool AMyCharacter::ServerUseAbility_Validate(int32 AbilityIndex)
{
    return AbilityIndex >= 0 && AbilityIndex < MaxAbilities;
}

void AMyCharacter::ServerUseAbility_Implementation(int32 AbilityIndex)
{
    // Execute ability on server
}
\`\`\`

### RPC Execution Rules
| Actor Ownership | Server RPC | Client RPC | NetMulticast |
|:---:|:---:|:---:|:---:|
| Client-owned | Runs on server | Runs on owning client | Runs everywhere |
| Server-owned | Runs on server | Runs on server | Runs everywhere |
| Unowned | Dropped | Dropped | Runs everywhere |

## Authority and Roles

### ENetRole
- \`ROLE_Authority\` - This machine is authoritative (server for replicated actors).
- \`ROLE_AutonomousProxy\` - Client's locally controlled pawn.
- \`ROLE_SimulatedProxy\` - Client sees this actor but doesn't control it.
- \`ROLE_None\` - Not replicated.

### Checking Authority
\`\`\`cpp
// Am I the server/authority?
bool bIsServer = HasAuthority();
// or
bool bIsServer = GetLocalRole() == ROLE_Authority;

// Am I the owning client?
bool bIsLocallyControlled = IsLocallyControlled(); // for APawn

// Check remote role
ENetRole RemoteRole = GetRemoteRole();
\`\`\`

### Common Pattern
\`\`\`cpp
void AMyCharacter::Fire()
{
    // Local prediction: play effects immediately
    PlayFireAnimation();
    SpawnMuzzleFlash();

    if (!HasAuthority())
    {
        // Client: send RPC to server
        ServerFire();
    }
    else
    {
        // Server: apply damage directly
        PerformFire();
    }
}

void AMyCharacter::ServerFire_Implementation()
{
    PerformFire();
    // Multicast cosmetic effects to all clients
    MulticastPlayFireEffects();
}
\`\`\`

## Net Prediction and Correction

### Character Movement Prediction
\`UCharacterMovementComponent\` has built-in prediction:
- Client predicts movement locally.
- Sends moves to server.
- Server validates and corrects if needed.
- Client replays unacknowledged moves on correction.

Key properties:
- \`NetworkSmoothingMode\` - Disabled, Linear, Exponential.
- \`NetworkSimulatedSmoothLocationTime\` - Smoothing duration for corrections.
- \`NetworkSimulatedSmoothRotationTime\` - Rotation smoothing.

### Custom Prediction
For custom predictive gameplay, use the pattern:
1. Client predicts locally and saves state.
2. Client sends input to server via Server RPC.
3. Server processes and replicates authoritative state.
4. Client compares predicted vs. authoritative state on RepNotify.
5. If mismatch, client corrects and replays subsequent inputs.

## Relevancy

### Actor Relevancy
Not all actors are replicated to all clients. An actor is relevant to a connection if:
- \`bAlwaysRelevant\` is true.
- It is owned by or is the Pawn of that connection.
- It is the ViewTarget of that connection.
- It passes the \`IsNetRelevantFor()\` check (default: distance-based).

### Overriding Relevancy
\`\`\`cpp
bool AMyActor::IsNetRelevantFor(const AActor* RealViewer, const AActor* ViewTarget, const FVector& SrcLocation) const
{
    if (bAlwaysRelevant) return true;
    // Custom relevancy logic
    return FVector::DistSquared(GetActorLocation(), SrcLocation) < RelevancyRadius * RelevancyRadius;
}
\`\`\`

### Net Update Frequency
- \`NetUpdateFrequency\` - How many times per second the actor checks for replication (default 100).
- \`MinNetUpdateFrequency\` - Minimum update rate when not changing (adaptive).
- \`NetPriority\` - Higher priority actors get bandwidth first (default 1.0).

## Dormancy

Dormancy optimizes replication by stopping updates for actors that haven't changed.

### ENetDormancy
- \`DORM_Never\` - Never go dormant. Always check for replication.
- \`DORM_Awake\` - Currently awake, will check for dormancy conditions.
- \`DORM_DormantAll\` - Dormant for all connections. No replication.
- \`DORM_DormantPartial\` - Dormant for some connections.
- \`DORM_Initial\` - Start dormant, wake on first interaction.

### Usage
\`\`\`cpp
// Set dormancy
SetNetDormancy(DORM_DormantAll);

// Wake up (forces replication check)
ForceNetUpdate();
// or
FlushNetDormancy();
\`\`\`

## Replicated Subobjects

### UActorComponent Replication
\`\`\`cpp
// In the component:
AMyActor::AMyActor()
{
    MyComponent = CreateDefaultSubobject<UMyComponent>(TEXT("MyComp"));
    MyComponent->SetIsReplicatedByDefault(true);
}

// Or at runtime:
MyComponent->SetIsReplicated(true);
\`\`\`

### Subobject Replication (UE 5.x)
\`\`\`cpp
// Register subobjects for replication
void AMyActor::ReplicateSubobjects(UActorChannel* Channel, FOutBunch* Bunch, FReplicationFlags* RepFlags)
{
    Super::ReplicateSubobjects(Channel, Bunch, RepFlags);
    Channel->ReplicateSubobject(MySubobject, *Bunch, *RepFlags);
}
\`\`\`

## UE 5.7 Networking Changes
- Iris replication system is the default replication backend, replacing the legacy system.
- Iris provides better scalability with spatial hashing for relevancy.
- Network prediction plugin stabilized for custom gameplay prediction beyond movement.
- Replicated subobject list API improvements for dynamic component replication.
- COND_Dynamic allows toggling replication conditions at runtime without class changes.
- Net serialization performance improvements for large property sets.
`;
