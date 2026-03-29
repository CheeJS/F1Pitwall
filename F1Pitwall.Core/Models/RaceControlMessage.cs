namespace F1Pitwall.Core.Models
{
    public record RaceControlMessage(
        DateTimeOffset Date,
        string Category,
        int? DriverNumber,
        string? Flag,
        int? LapNumber,
        string Message,
        string? Scope,
        int? Sector,
        string? QualifyingPhase,
        int SessionKey
    );
}
