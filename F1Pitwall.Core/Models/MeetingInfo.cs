namespace F1Pitwall.Core.Models
{
    public record MeetingInfo(
        int MeetingKey,
        string MeetingName,
        string MeetingOfficialName,
        DateTimeOffset DateStart,
        DateTimeOffset DateEnd,
        string CircuitShortName,
        string CountryName,
        string Location,
        string GmtOffset,
        int Year,
        string? CircuitImage,
        string? CircuitInfoUrl,
        string? CountryFlag
    );
}
