using F1Pitwall.Core.Interfaces;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace F1PitWall.Api.Controllers
{
    [ApiController]
    [Route("api/sessions")]
    public class SessionsController : ControllerBase
    {
        private readonly IOpenF1Client _openF1Client;

        public SessionsController(IOpenF1Client openF1Client) => _openF1Client = openF1Client;

        // GET /api/sessions?year=2026
        [HttpGet]
        public async Task<IActionResult> GetSessions([FromQuery] int? year, CancellationToken ct)
        {
            var resolvedYear = year ?? DateTimeOffset.UtcNow.Year;
            var sessions = await _openF1Client.GetSessionsAsync(resolvedYear, ct);
            return Ok(sessions.OrderByDescending(s => s.DateStart));
        }

        // GET /api/sessions/{key}/drivers
        [HttpGet("{sessionKey:int}/drivers")]
        public async Task<IActionResult> GetDriversForSession(int sessionKey, CancellationToken ct)
        {
            var drivers = await _openF1Client.GetDriversForSessionAsync(sessionKey, ct);
            return Ok(drivers);
        }

        // GET /api/sessions/{key}/classification
        // Uses official session_result if available; falls back to computed from laps.
        // Always includes stints (tyre strategy) per driver.
        [HttpGet("{sessionKey:int}/classification")]
        public async Task<IActionResult> GetClassification(int sessionKey, CancellationToken ct)
        {
            var driversTask = _openF1Client.GetDriversForSessionAsync(sessionKey, ct);
            var resultsTask = _openF1Client.GetSessionResultAsync(sessionKey, ct);
            var stintsTask  = _openF1Client.GetStintsAsync(sessionKey, ct);
            var lapsTask    = _openF1Client.GetLapsAsync(sessionKey, null, ct);

            await Task.WhenAll(driversTask, resultsTask, stintsTask, lapsTask);

            var driverMap   = driversTask.Result.ToDictionary(d => d.DriverNumber);
            var officialRes = resultsTask.Result.ToList();
            var stintsByDrv = stintsTask.Result
                .GroupBy(s => s.DriverNumber)
                .ToDictionary(g => g.Key, g => g.OrderBy(s => s.StintNumber).ToList());

            IEnumerable<dynamic> ranked;

            if (officialRes.Count > 0)
            {
                // Official results from OpenF1 session_result endpoint
                ranked = officialRes
                    .OrderBy(r => r.Position)
                    .Select(r =>
                    {
                        var driver = driverMap.TryGetValue(r.DriverNumber, out var d) ? d : null;
                        var stints = stintsByDrv.TryGetValue(r.DriverNumber, out var sl) ? sl : [];
                        return (dynamic)new
                        {
                            Position      = r.Position,
                            DriverNumber  = r.DriverNumber,
                            Abbreviation  = driver?.Abbreviation ?? $"#{r.DriverNumber}",
                            TeamColour    = driver?.TeamColour ?? string.Empty,
                            TeamName      = driver?.TeamName ?? string.Empty,
                            FullName      = driver?.FullName ?? string.Empty,
                            HeadshotUrl   = driver?.HeadshotUrl,
                            TotalLaps     = r.NumberOfLaps,
                            BestLapTime   = FormatLapTime(r.Duration),
                            BestLapSeconds= r.Duration,
                            GapToLeader   = r.GapToLeader,
                            Dnf           = r.Dnf,
                            Dns           = r.Dns,
                            Dsq           = r.Dsq,
                            Stints        = stints.Select(s => new
                            {
                                s.Compound, s.LapStart, s.LapEnd, s.TyreAgeAtStart
                            })
                        };
                    });
            }
            else
            {
                // Fallback: compute from laps (session_result not yet available)
                var lapsByDriver = lapsTask.Result
                    .GroupBy(l => l.DriverNumber)
                    .ToDictionary(g => g.Key, g => g.ToList());

                var allNums = driverMap.Keys.Union(lapsByDriver.Keys).Distinct();

                ranked = allNums
                    .Select(num =>
                    {
                        var driver = driverMap.TryGetValue(num, out var d) ? d : null;
                        var laps   = lapsByDriver.TryGetValue(num, out var ls) ? ls : [];
                        var stints = stintsByDrv.TryGetValue(num, out var sl) ? sl : [];

                        var validLaps  = laps.Where(l => !l.IsPitOutLap && l.LapDuration.HasValue).ToList();
                        var bestSec    = validLaps.Count > 0 ? validLaps.Min(l => l.LapDuration!.Value) : (double?)null;
                        var totalLaps  = laps.Count > 0 ? laps.Max(l => l.LapNumber) : 0;

                        return new { num, driver, bestSec, totalLaps, stints };
                    })
                    .OrderByDescending(x => x.totalLaps)
                    .ThenBy(x => x.bestSec ?? double.MaxValue)
                    .Select((x, i) => (dynamic)new
                    {
                        Position      = i + 1,
                        DriverNumber  = x.num,
                        Abbreviation  = x.driver?.Abbreviation ?? $"#{x.num}",
                        TeamColour    = x.driver?.TeamColour ?? string.Empty,
                        TeamName      = x.driver?.TeamName ?? string.Empty,
                        FullName      = x.driver?.FullName ?? string.Empty,
                        HeadshotUrl   = x.driver?.HeadshotUrl,
                        TotalLaps     = x.totalLaps,
                        BestLapTime   = FormatLapTime(x.bestSec),
                        BestLapSeconds= x.bestSec,
                        GapToLeader   = (string?)null,
                        Dnf           = false,
                        Dns           = false,
                        Dsq           = false,
                        Stints        = x.stints.Select(s => new
                        {
                            s.Compound, s.LapStart, s.LapEnd, s.TyreAgeAtStart
                        })
                    });
            }

            return Ok(ranked.ToList());
        }

        // GET /api/sessions/{key}/stints
        [HttpGet("{sessionKey:int}/stints")]
        public async Task<IActionResult> GetStints(int sessionKey, CancellationToken ct) =>
            Ok(await _openF1Client.GetStintsAsync(sessionKey, ct));

        // GET /api/sessions/{key}/pits
        [HttpGet("{sessionKey:int}/pits")]
        public async Task<IActionResult> GetPits(int sessionKey, CancellationToken ct) =>
            Ok(await _openF1Client.GetPitsAsync(sessionKey, ct));

        // GET /api/sessions/{key}/result
        [HttpGet("{sessionKey:int}/result")]
        public async Task<IActionResult> GetResult(int sessionKey, CancellationToken ct) =>
            Ok(await _openF1Client.GetSessionResultAsync(sessionKey, ct));

        // GET /api/sessions/{key}/starting-grid
        [HttpGet("{sessionKey:int}/starting-grid")]
        public async Task<IActionResult> GetStartingGrid(int sessionKey, CancellationToken ct) =>
            Ok(await _openF1Client.GetStartingGridAsync(sessionKey, ct));

        // GET /api/sessions/{key}/race-control
        [HttpGet("{sessionKey:int}/race-control")]
        public async Task<IActionResult> GetRaceControl(int sessionKey, CancellationToken ct) =>
            Ok((await _openF1Client.GetRaceControlAsync(sessionKey, ct)).OrderBy(m => m.Date));

        // GET /api/sessions/{key}/weather
        [HttpGet("{sessionKey:int}/weather")]
        public async Task<IActionResult> GetWeather(int sessionKey, CancellationToken ct) =>
            Ok(await _openF1Client.GetWeatherAsync(sessionKey, ct));

        // GET /api/sessions/{key}/team-radio
        [HttpGet("{sessionKey:int}/team-radio")]
        public async Task<IActionResult> GetTeamRadio(int sessionKey, CancellationToken ct) =>
            Ok((await _openF1Client.GetTeamRadioAsync(sessionKey, ct)).OrderBy(r => r.Date));

        // GET /api/sessions/{key}/championship/drivers
        [HttpGet("{sessionKey:int}/championship/drivers")]
        public async Task<IActionResult> GetDriversChampionship(int sessionKey, CancellationToken ct) =>
            Ok((await _openF1Client.GetDriversChampionshipAsync(sessionKey, ct)).OrderBy(d => d.PositionCurrent));

        // GET /api/sessions/{key}/championship/teams
        [HttpGet("{sessionKey:int}/championship/teams")]
        public async Task<IActionResult> GetTeamsChampionship(int sessionKey, CancellationToken ct) =>
            Ok((await _openF1Client.GetTeamsChampionshipAsync(sessionKey, ct)).OrderBy(t => t.PositionCurrent));

        // ── Helpers ─────────────────────────────────────────────────────

        private static string? FormatLapTime(double? seconds)
        {
            if (seconds is null) return null;
            var s = seconds.Value;
            var minutes = (int)(s / 60);
            var rem = s % 60;
            return minutes > 0 ? $"{minutes}:{rem:00.000}" : $"{rem:0.000}";
        }
    }
}
