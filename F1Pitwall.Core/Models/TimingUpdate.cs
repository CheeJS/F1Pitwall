using System;
using F1Pitwall.Core.Models;

namespace F1Pitwall.Core.Models
{
    // Note: JsonPolymorphic attributes removed for .NET 6 compatibility
    public abstract record TimingUpdate
{
    public DateTimeOffset Date { get; init; }
}

public record PositionUpdate(int DriverNumber, int Position) : TimingUpdate;

public record CarDataUpdate(
    int DriverNumber,
    int Speed,
    int Throttle,
    int Brake,
    int Gear,
    bool DrsOpen
) : TimingUpdate;

public record TimingDataUpdate(
    int DriverNumber,
    string? LastLapTime,
    string? GapToLeader,
    string? Interval,
    int CurrentLap
) : TimingUpdate;

public record PitUpdate(
    int DriverNumber,
    bool InPit,
    int PitStopCount,
    string? NewCompound
) : TimingUpdate;

    public record SessionStatusUpdate(SessionStatus Status, int TotalLaps) : TimingUpdate;
    public record SafetyCarUpdate(string Status) : TimingUpdate;
    public record SessionInfoUpdate(SessionType SessionType, string Name) : TimingUpdate;
}