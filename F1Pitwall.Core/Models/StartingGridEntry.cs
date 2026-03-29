namespace F1Pitwall.Core.Models
{
    public record StartingGridEntry(
        int DriverNumber,
        int Position,
        double? LapDuration,
        int SessionKey
    );
}
