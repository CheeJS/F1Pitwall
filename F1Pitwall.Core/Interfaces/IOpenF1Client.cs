using F1Pitwall.Core.Models;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace F1Pitwall.Core.Interfaces
{
    public interface IOpenF1Client
    {
        // ── Drivers & Sessions ──────────────────────────────────────
        Task<IEnumerable<DriverState>> GetDriversForSessionAsync(int sessionKey, CancellationToken ct = default);
        Task<IEnumerable<F1Session>> GetSessionsAsync(int? year = null, CancellationToken ct = default);
        Task<IEnumerable<MeetingInfo>> GetMeetingsAsync(int? year = null, CancellationToken ct = default);

        // ── Lap & Stint data ────────────────────────────────────────
        Task<IEnumerable<LapRecord>> GetLapsAsync(int sessionKey, int? driverNumber = null, CancellationToken ct = default);
        Task<IEnumerable<StintRecord>> GetStintsAsync(int sessionKey, CancellationToken ct = default);

        // ── Race results ────────────────────────────────────────────
        Task<IEnumerable<SessionResultEntry>> GetSessionResultAsync(int sessionKey, CancellationToken ct = default);
        Task<IEnumerable<StartingGridEntry>> GetStartingGridAsync(int sessionKey, CancellationToken ct = default);

        // ── Pit stops ───────────────────────────────────────────────
        Task<IEnumerable<PitRecord>> GetPitsAsync(int sessionKey, CancellationToken ct = default);

        // ── Race control & Weather ──────────────────────────────────
        Task<IEnumerable<RaceControlMessage>> GetRaceControlAsync(int sessionKey, CancellationToken ct = default);
        Task<IEnumerable<WeatherRecord>> GetWeatherAsync(int sessionKey, CancellationToken ct = default);

        // ── Media ───────────────────────────────────────────────────
        Task<IEnumerable<TeamRadioMessage>> GetTeamRadioAsync(int sessionKey, CancellationToken ct = default);

        // ── Championship standings (race sessions only) ─────────────
        Task<IEnumerable<DriverChampionshipStanding>> GetDriversChampionshipAsync(int sessionKey, CancellationToken ct = default);
        Task<IEnumerable<TeamChampionshipStanding>> GetTeamsChampionshipAsync(int sessionKey, CancellationToken ct = default);
    }
}
