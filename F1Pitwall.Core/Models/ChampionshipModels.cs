namespace F1Pitwall.Core.Models
{
    public record TeamRadioMessage(
        DateTimeOffset Date,
        int DriverNumber,
        string RecordingUrl,
        int SessionKey
    );

    public record DriverChampionshipStanding(
        int DriverNumber,
        int SessionKey,
        int MeetingKey,
        double PointsCurrent,
        double PointsStart,
        int PositionCurrent,
        int PositionStart
    );

    public record TeamChampionshipStanding(
        string TeamName,
        int SessionKey,
        int MeetingKey,
        double PointsCurrent,
        double PointsStart,
        int PositionCurrent,
        int PositionStart
    );
}
