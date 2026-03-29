using System;

namespace F1Pitwall.Infrastructure.SignalR
{
    /// <summary>
    /// Typed DTOs for all SignalR server→client messages.
    /// Using named records instead of anonymous types gives:
    /// - Consistent JSON property names across serialization
    /// - Compile-time safety when constructing payloads
    /// - Discoverability for future client code generators
    /// </summary>

    public record PositionUpdateDto(
        string UpdateType,
        int DriverNumber,
        int Position,
        DateTimeOffset Timestamp);

    public record CarDataDto(
        int DriverNumber,
        int Speed,
        int Throttle,
        int Brake,
        int Gear,
        bool DrsOpen,
        DateTimeOffset Timestamp);

    public record TimingDataDto(
        string UpdateType,
        int DriverNumber,
        string? LastLapTime,
        string? GapToLeader,
        string? Interval,
        int CurrentLap,
        DateTimeOffset Timestamp);

    public record PitUpdateDto(
        string UpdateType,
        int DriverNumber,
        bool InPit,
        int PitStopCount,
        string? NewCompound,
        DateTimeOffset Timestamp);

    public record SessionStatusDto(
        string Status,
        int TotalLaps,
        DateTimeOffset Timestamp);

    public record SafetyCarStatusDto(
        string Status,
        DateTimeOffset Timestamp);
}
