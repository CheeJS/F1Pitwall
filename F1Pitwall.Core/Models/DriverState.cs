using System;
using System.Collections.Generic;
using System.Text;

namespace F1Pitwall.Core.Models
{
    public record DriverState
    {
        public int DriverNumber { get; init; }
        public string Abbreviation { get; init; } = string.Empty;
        public string TeamColour { get; init; } = string.Empty;

        // Rich driver info (populated from REST /drivers endpoint)
        public string FullName { get; init; } = string.Empty;
        public string TeamName { get; init; } = string.Empty;
        public string? HeadshotUrl { get; init; }

        // Timing
        public int Position { get; init; }
        public string? LastLapTime { get; init; }
        public string? GapToLeader { get; init; }
        public string? Interval { get; init; }
        public int CurrentLap { get; init; }

        // Car telemetry
        public int Speed { get; init; }           // km/h
        public int Throttle { get; init; }        // 0-100
        public int Brake { get; init; }           // 0-100
        public int Gear { get; init; }
        public bool DrsOpen { get; init; }

        // Tyre
        public string? TyreCompound { get; init; }
        public int TyreAge { get; init; }         // laps on current set

        // Pit
        public int PitStopCount { get; init; }
        public bool InPit { get; init; }

        public DateTimeOffset LastUpdated { get; init; }
    }
}
