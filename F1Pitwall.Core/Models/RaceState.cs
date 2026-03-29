using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Text;

namespace F1Pitwall.Core.Models
{
    public record RaceState

    {
        public SessionType SessionType { get; init; }
        public SessionStatus Status { get; init; }   // Inactive, Started, Finished, Aborted
        public string? SafetyCarStatus { get; init; } // None, SC, VSC, Red
        public int TotalLaps { get; init; }
        public IReadOnlyDictionary<int, DriverState> Drivers { get; init; } = ImmutableDictionary<int, DriverState>.Empty;
        public DateTimeOffset LastUpdated { get; init; }
    }
    public enum SessionType { Practice, Qualifying, Sprint, Race }
    public enum SessionStatus { Inactive, Started, Aborted, Finished }
}
