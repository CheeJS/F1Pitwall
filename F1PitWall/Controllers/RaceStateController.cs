using F1Pitwall.Core.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace F1PitWall.Api.Controllers
{
    /// <summary>
    /// REST endpoint for querying the current live race state.
    /// Useful for clients that do an initial HTTP fetch before subscribing to SignalR,
    /// or for server-side rendering / non-WebSocket consumers.
    /// </summary>
    [ApiController]
    [Route("api/race")]
    public class RaceStateController : ControllerBase
    {
        private readonly IRaceStateService _raceStateService;

        public RaceStateController(IRaceStateService raceStateService)
        {
            _raceStateService = raceStateService;
        }

        /// <summary>
        /// GET /api/race
        /// Returns the full current race state: all drivers, session status, safety car.
        /// </summary>
        [HttpGet]
        public IActionResult GetCurrentState() =>
            Ok(_raceStateService.GetCurrentState());

        /// <summary>
        /// GET /api/race/drivers
        /// Returns every driver's current state as a flat list.
        /// </summary>
        [HttpGet("drivers")]
        public IActionResult GetDrivers() =>
            Ok(_raceStateService.GetCurrentState().Drivers.Values);

        /// <summary>
        /// GET /api/race/drivers/{driverNumber}
        /// Returns a single driver's current state.
        /// </summary>
        [HttpGet("drivers/{driverNumber:int}")]
        public IActionResult GetDriver(int driverNumber)
        {
            var state = _raceStateService.GetCurrentState();
            if (!state.Drivers.TryGetValue(driverNumber, out var driver))
                return NotFound(new { message = $"Driver {driverNumber} not found in current session." });

            return Ok(driver);
        }
    }
}
