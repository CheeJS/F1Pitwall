using F1Pitwall.Core.Interfaces;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace F1PitWall.Api.Controllers
{
    [ApiController]
    [Route("api/meetings")]
    public class MeetingsController : ControllerBase
    {
        private readonly IOpenF1Client _openF1Client;

        public MeetingsController(IOpenF1Client openF1Client) => _openF1Client = openF1Client;

        // GET /api/meetings?year=2026
        [HttpGet]
        public async Task<IActionResult> GetMeetings([FromQuery] int? year, CancellationToken ct)
        {
            var resolvedYear = year ?? DateTimeOffset.UtcNow.Year;
            var meetings = await _openF1Client.GetMeetingsAsync(resolvedYear, ct);
            return Ok(meetings.OrderByDescending(m => m.DateStart));
        }
    }
}
