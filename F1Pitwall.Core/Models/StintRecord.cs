namespace F1Pitwall.Core.Models
{
    public record StintRecord(
        int DriverNumber,
        int SessionKey,
        int StintNumber,
        string Compound,
        int LapStart,
        int LapEnd,
        int TyreAgeAtStart
    );
}
