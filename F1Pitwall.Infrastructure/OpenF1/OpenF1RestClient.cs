using F1Pitwall.Core.Interfaces;
using F1Pitwall.Core.Models;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace F1Pitwall.Infrastructure.OpenF1
{
    /// <summary>
    /// HTTP client for the OpenF1 REST API.
    /// All session-keyed calls are cached in memory for 1 hour (historical data is immutable).
    /// Year-level lists (sessions, meetings) are cached for 30 minutes.
    /// </summary>
    public class OpenF1RestClient : IOpenF1Client
    {
        private readonly HttpClient _http;
        private readonly IMemoryCache _cache;
        private readonly ILogger<OpenF1RestClient> _logger;

        private static readonly TimeSpan SessionDataTtl = TimeSpan.FromHours(1);
        private static readonly TimeSpan ListDataTtl = TimeSpan.FromMinutes(30);

        public OpenF1RestClient(
            IHttpClientFactory httpClientFactory,
            IMemoryCache cache,
            ILogger<OpenF1RestClient> logger)
        {
            _http = httpClientFactory.CreateClient("OpenF1");
            _cache = cache;
            _logger = logger;
        }

        // ── Generic cached fetch ────────────────────────────────────

        private async Task<IEnumerable<T>> FetchAsync<T>(
            string url, TimeSpan ttl, Func<JsonElement, T?> map, CancellationToken ct)
        {
            if (_cache.TryGetValue(url, out IEnumerable<T>? cached) && cached is not null)
                return cached;

            try
            {
                var elements = await _http.GetFromJsonAsync<JsonElement[]>(url, ct);
                if (elements is null) return [];

                var result = elements.Select(map).Where(x => x is not null).Select(x => x!).ToList();
                _cache.Set(url, (IEnumerable<T>)result, ttl);
                return result;
            }
            catch (OperationCanceledException) { return []; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "OpenF1 fetch failed: {Url}", url);
                return [];
            }
        }

        // ── Drivers ─────────────────────────────────────────────────

        public Task<IEnumerable<DriverState>> GetDriversForSessionAsync(
            int sessionKey, CancellationToken ct = default) =>
            FetchAsync($"drivers?session_key={sessionKey}", SessionDataTtl, d =>
            {
                var num = d.GetInt32OrDefault("driver_number");
                if (num == 0) return null;
                return new DriverState
                {
                    DriverNumber = num,
                    Abbreviation = d.GetStringOrDefault("name_acronym"),
                    TeamColour = d.GetStringOrDefault("team_colour"),
                    FullName = d.GetStringOrDefault("full_name"),
                    TeamName = d.GetStringOrDefault("team_name"),
                    HeadshotUrl = d.GetStringOrNull("headshot_url"),
                };
            }, ct);

        // ── Sessions ─────────────────────────────────────────────────

        public Task<IEnumerable<F1Session>> GetSessionsAsync(
            int? year = null, CancellationToken ct = default)
        {
            var url = year.HasValue ? $"sessions?year={year}" : "sessions";
            return FetchAsync(url, ListDataTtl, s =>
            {
                var key = s.GetInt32OrDefault("session_key");
                if (key == 0) return null;
                return new F1Session(
                    SessionKey: key,
                    SessionName: s.GetStringOrDefault("session_name"),
                    SessionType: s.GetStringOrDefault("session_type"),
                    DateStart: s.GetDateOrDefault("date_start"),
                    CircuitShortName: s.GetStringOrDefault("circuit_short_name"),
                    CountryName: s.GetStringOrDefault("country_name"),
                    Year: s.GetInt32OrDefault("year"),
                    MeetingKey: s.GetInt32OrDefault("meeting_key"),
                    MeetingName: s.GetStringOrDefault("meeting_name")
                );
            }, ct);
        }

        // ── Meetings ─────────────────────────────────────────────────

        public Task<IEnumerable<MeetingInfo>> GetMeetingsAsync(
            int? year = null, CancellationToken ct = default)
        {
            var url = year.HasValue ? $"meetings?year={year}" : "meetings";
            return FetchAsync(url, ListDataTtl, m =>
            {
                var key = m.GetInt32OrDefault("meeting_key");
                if (key == 0) return null;
                return new MeetingInfo(
                    MeetingKey: key,
                    MeetingName: m.GetStringOrDefault("meeting_name"),
                    MeetingOfficialName: m.GetStringOrDefault("meeting_official_name"),
                    DateStart: m.GetDateOrDefault("date_start"),
                    DateEnd: m.GetDateOrDefault("date_end"),
                    CircuitShortName: m.GetStringOrDefault("circuit_short_name"),
                    CountryName: m.GetStringOrDefault("country_name"),
                    Location: m.GetStringOrDefault("location"),
                    GmtOffset: m.GetStringOrDefault("gmt_offset"),
                    Year: m.GetInt32OrDefault("year"),
                    CircuitImage: m.GetStringOrNull("circuit_image"),
                    CircuitInfoUrl: m.GetStringOrNull("circuit_info_url"),
                    CountryFlag: m.GetStringOrNull("country_flag")
                );
            }, ct);
        }

        // ── Laps ─────────────────────────────────────────────────────

        public Task<IEnumerable<LapRecord>> GetLapsAsync(
            int sessionKey, int? driverNumber = null, CancellationToken ct = default)
        {
            var url = $"laps?session_key={sessionKey}";
            if (driverNumber.HasValue) url += $"&driver_number={driverNumber}";
            return FetchAsync(url, SessionDataTtl, l =>
            {
                var num = l.GetInt32OrDefault("driver_number");
                if (num == 0) return null;
                return new LapRecord(
                    DriverNumber: num,
                    LapNumber: l.GetInt32OrDefault("lap_number"),
                    LapDuration: l.TryGetProperty("lap_duration", out var ld) && ld.ValueKind == JsonValueKind.Number
                        ? ld.GetDouble() : null,
                    IsPitOutLap: l.TryGetProperty("is_pit_out_lap", out var pit) && pit.ValueKind == JsonValueKind.True
                );
            }, ct);
        }

        // ── Stints ───────────────────────────────────────────────────

        public Task<IEnumerable<StintRecord>> GetStintsAsync(
            int sessionKey, CancellationToken ct = default) =>
            FetchAsync($"stints?session_key={sessionKey}", SessionDataTtl, s =>
            {
                var num = s.GetInt32OrDefault("driver_number");
                if (num == 0) return null;
                return new StintRecord(
                    DriverNumber: num,
                    SessionKey: s.GetInt32OrDefault("session_key"),
                    StintNumber: s.GetInt32OrDefault("stint_number"),
                    Compound: s.GetStringOrDefault("compound"),
                    LapStart: s.GetInt32OrDefault("lap_start"),
                    LapEnd: s.GetInt32OrDefault("lap_end"),
                    TyreAgeAtStart: s.GetInt32OrDefault("tyre_age_at_start")
                );
            }, ct);

        // ── Session Result ────────────────────────────────────────────

        public Task<IEnumerable<SessionResultEntry>> GetSessionResultAsync(
            int sessionKey, CancellationToken ct = default) =>
            FetchAsync($"session_result?session_key={sessionKey}", SessionDataTtl, e =>
            {
                var num = e.GetInt32OrDefault("driver_number");
                if (num == 0) return null;

                // duration may be a number or array [q1, q2, q3] (qualifying)
                double? duration = null;
                if (e.TryGetProperty("duration", out var dur))
                {
                    if (dur.ValueKind == JsonValueKind.Number)
                        duration = dur.GetDouble();
                    else if (dur.ValueKind == JsonValueKind.Array)
                    {
                        var arr = dur.EnumerateArray().ToList();
                        for (int i = arr.Count - 1; i >= 0; i--)
                            if (arr[i].ValueKind == JsonValueKind.Number) { duration = arr[i].GetDouble(); break; }
                    }
                }

                // gap_to_leader may be null / number / string / array
                string? gap = null;
                if (e.TryGetProperty("gap_to_leader", out var gapProp))
                {
                    if (gapProp.ValueKind == JsonValueKind.Number)
                        gap = $"+{gapProp.GetDouble():0.000}";
                    else if (gapProp.ValueKind == JsonValueKind.String)
                        gap = gapProp.GetString();
                    else if (gapProp.ValueKind == JsonValueKind.Array)
                    {
                        var arr = gapProp.EnumerateArray().ToList();
                        for (int i = arr.Count - 1; i >= 0; i--)
                        {
                            if (arr[i].ValueKind == JsonValueKind.Number) { gap = $"+{arr[i].GetDouble():0.000}"; break; }
                            if (arr[i].ValueKind == JsonValueKind.String) { gap = arr[i].GetString(); break; }
                        }
                    }
                }

                return new SessionResultEntry(
                    DriverNumber: num,
                    Position: e.GetInt32OrDefault("position"),
                    Dnf: e.TryGetProperty("dnf", out var dnf) && dnf.ValueKind == JsonValueKind.True,
                    Dns: e.TryGetProperty("dns", out var dns) && dns.ValueKind == JsonValueKind.True,
                    Dsq: e.TryGetProperty("dsq", out var dsq) && dsq.ValueKind == JsonValueKind.True,
                    Duration: duration,
                    GapToLeader: gap,
                    NumberOfLaps: e.GetInt32OrDefault("number_of_laps"),
                    SessionKey: sessionKey
                );
            }, ct);

        // ── Starting Grid ─────────────────────────────────────────────

        public Task<IEnumerable<StartingGridEntry>> GetStartingGridAsync(
            int sessionKey, CancellationToken ct = default) =>
            FetchAsync($"starting_grid?session_key={sessionKey}", SessionDataTtl, g =>
            {
                var num = g.GetInt32OrDefault("driver_number");
                if (num == 0) return null;
                return new StartingGridEntry(
                    DriverNumber: num,
                    Position: g.GetInt32OrDefault("position"),
                    LapDuration: g.TryGetProperty("lap_duration", out var ld) && ld.ValueKind == JsonValueKind.Number
                        ? ld.GetDouble() : null,
                    SessionKey: sessionKey
                );
            }, ct);

        // ── Pit stops ────────────────────────────────────────────────

        public Task<IEnumerable<PitRecord>> GetPitsAsync(
            int sessionKey, CancellationToken ct = default) =>
            FetchAsync($"pit?session_key={sessionKey}", SessionDataTtl, p =>
            {
                var num = p.GetInt32OrDefault("driver_number");
                if (num == 0) return null;
                return new PitRecord(
                    DriverNumber: num,
                    SessionKey: sessionKey,
                    LapNumber: p.GetInt32OrDefault("lap_number"),
                    LaneDuration: p.TryGetProperty("lane_duration", out var ld) && ld.ValueKind == JsonValueKind.Number
                        ? ld.GetDouble() : 0.0,
                    StopDuration: p.TryGetProperty("stop_duration", out var sd) && sd.ValueKind == JsonValueKind.Number
                        ? sd.GetDouble() : null,
                    Date: p.GetDateOrDefault("date")
                );
            }, ct);

        // ── Race control ──────────────────────────────────────────────

        public Task<IEnumerable<RaceControlMessage>> GetRaceControlAsync(
            int sessionKey, CancellationToken ct = default) =>
            FetchAsync($"race_control?session_key={sessionKey}", SessionDataTtl, r =>
            {
                if (!r.TryGetProperty("date", out _)) return null;
                return new RaceControlMessage(
                    Date: r.GetDateOrDefault("date"),
                    Category: r.GetStringOrDefault("category"),
                    DriverNumber: r.TryGetProperty("driver_number", out var dn) && dn.ValueKind == JsonValueKind.Number
                        ? dn.GetInt32() : null,
                    Flag: r.GetStringOrNull("flag"),
                    LapNumber: r.TryGetProperty("lap_number", out var ln) && ln.ValueKind == JsonValueKind.Number
                        ? ln.GetInt32() : null,
                    Message: r.GetStringOrDefault("message"),
                    Scope: r.GetStringOrNull("scope"),
                    Sector: r.TryGetProperty("sector", out var sct) && sct.ValueKind == JsonValueKind.Number
                        ? sct.GetInt32() : null,
                    QualifyingPhase: r.GetStringOrNull("qualifying_phase"),
                    SessionKey: sessionKey
                );
            }, ct);

        // ── Weather ───────────────────────────────────────────────────

        public Task<IEnumerable<WeatherRecord>> GetWeatherAsync(
            int sessionKey, CancellationToken ct = default) =>
            FetchAsync($"weather?session_key={sessionKey}", SessionDataTtl, w =>
            {
                if (!w.TryGetProperty("date", out _)) return null;
                return new WeatherRecord(
                    Date: w.GetDateOrDefault("date"),
                    AirTemperature: w.GetDoubleOrDefault("air_temperature"),
                    Humidity: w.GetDoubleOrDefault("humidity"),
                    Pressure: w.GetDoubleOrDefault("pressure"),
                    Rainfall: w.TryGetProperty("rainfall", out var rain) &&
                        (rain.ValueKind == JsonValueKind.True ||
                         (rain.ValueKind == JsonValueKind.Number && rain.GetInt32() > 0)),
                    TrackTemperature: w.GetDoubleOrDefault("track_temperature"),
                    WindDirection: w.GetInt32OrDefault("wind_direction"),
                    WindSpeed: w.GetDoubleOrDefault("wind_speed"),
                    SessionKey: sessionKey
                );
            }, ct);

        // ── Team Radio ────────────────────────────────────────────────

        public Task<IEnumerable<TeamRadioMessage>> GetTeamRadioAsync(
            int sessionKey, CancellationToken ct = default) =>
            FetchAsync($"team_radio?session_key={sessionKey}", SessionDataTtl, t =>
            {
                var num = t.GetInt32OrDefault("driver_number");
                var url = t.GetStringOrNull("recording_url");
                if (num == 0 || url is null) return null;
                return new TeamRadioMessage(
                    Date: t.GetDateOrDefault("date"),
                    DriverNumber: num,
                    RecordingUrl: url,
                    SessionKey: sessionKey
                );
            }, ct);

        // ── Championship ──────────────────────────────────────────────

        public Task<IEnumerable<DriverChampionshipStanding>> GetDriversChampionshipAsync(
            int sessionKey, CancellationToken ct = default) =>
            FetchAsync($"championship_drivers?session_key={sessionKey}", SessionDataTtl, d =>
            {
                var num = d.GetInt32OrDefault("driver_number");
                if (num == 0) return null;
                return new DriverChampionshipStanding(
                    DriverNumber: num,
                    SessionKey: sessionKey,
                    MeetingKey: d.GetInt32OrDefault("meeting_key"),
                    PointsCurrent: d.GetDoubleOrDefault("points_current"),
                    PointsStart: d.GetDoubleOrDefault("points_start"),
                    PositionCurrent: d.GetInt32OrDefault("position_current"),
                    PositionStart: d.GetInt32OrDefault("position_start")
                );
            }, ct);

        public Task<IEnumerable<TeamChampionshipStanding>> GetTeamsChampionshipAsync(
            int sessionKey, CancellationToken ct = default) =>
            FetchAsync($"championship_teams?session_key={sessionKey}", SessionDataTtl, t =>
            {
                var name = t.GetStringOrNull("team_name");
                if (name is null) return null;
                return new TeamChampionshipStanding(
                    TeamName: name,
                    SessionKey: sessionKey,
                    MeetingKey: t.GetInt32OrDefault("meeting_key"),
                    PointsCurrent: t.GetDoubleOrDefault("points_current"),
                    PointsStart: t.GetDoubleOrDefault("points_start"),
                    PositionCurrent: t.GetInt32OrDefault("position_current"),
                    PositionStart: t.GetInt32OrDefault("position_start")
                );
            }, ct);
    }

    // ── JsonElement helpers ───────────────────────────────────────────
    internal static class JsonElementExtensions
    {
        public static string GetStringOrDefault(this JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString() ?? string.Empty : string.Empty;

        public static string? GetStringOrNull(this JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString() : null;

        public static int GetInt32OrDefault(this JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number
                ? v.GetInt32() : 0;

        public static double GetDoubleOrDefault(this JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number
                ? v.GetDouble() : 0.0;

        public static DateTimeOffset GetDateOrDefault(this JsonElement el, string prop)
        {
            if (el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String)
                if (DateTimeOffset.TryParse(v.GetString(), out var dto)) return dto;
            return DateTimeOffset.MinValue;
        }
    }
}
