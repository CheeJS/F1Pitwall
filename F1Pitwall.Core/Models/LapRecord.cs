namespace F1Pitwall.Core.Models
{
    /// <summary>
    /// A single lap entry from the OpenF1 /laps endpoint.
    /// LapDuration is null for incomplete or interrupted laps.
    /// </summary>
    public record LapRecord(
        int DriverNumber,
        int LapNumber,
        double? LapDuration,   // seconds, e.g. 80.456
        bool IsPitOutLap
    );
}
