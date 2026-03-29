namespace F1Pitwall.Core.Models
{
    /// <summary>
    /// Official session result entry from the OpenF1 /session_result endpoint.
    /// Duration: best lap time in seconds (practice/qualifying) or total race time.
    /// GapToLeader: "+X.XXX" or "+N LAP(S)" string, null for session leader.
    /// </summary>
    public record SessionResultEntry(
        int DriverNumber,
        int Position,
        bool Dnf,
        bool Dns,
        bool Dsq,
        double? Duration,
        string? GapToLeader,
        int NumberOfLaps,
        int SessionKey
    );
}
