using System;

namespace F1Pitwall.Core.Models
{
    /// <summary>
    /// Represents a single F1 session (Race, Qualifying, Practice etc.)
    /// as returned by the OpenF1 REST API.
    /// </summary>
    public record F1Session(
        int SessionKey,
        string SessionName,
        string SessionType,
        DateTimeOffset DateStart,
        string CircuitShortName,
        string CountryName,
        int Year,
        int MeetingKey,
        string MeetingName
    );
}
