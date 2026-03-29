namespace F1Pitwall.Core.Models
{
    public record PitRecord(
        int DriverNumber,
        int SessionKey,
        int LapNumber,
        double LaneDuration,
        double? StopDuration,
        DateTimeOffset Date
    );
}
