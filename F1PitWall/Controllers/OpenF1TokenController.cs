using System.Threading;
using System.Threading.Tasks;
using F1Pitwall.Infrastructure.OpenF1;
using Microsoft.AspNetCore.Mvc;

namespace F1PitWall.Api.Controllers
{
    /// <summary>
    /// Proxies OpenF1 auth tokens to the frontend without exposing credentials.
    /// The frontend calls GET /api/openf1/token, receives a short-lived bearer token,
    /// then uses it to connect directly to the OpenF1 MQTT broker.
    /// </summary>
    [ApiController]
    [Route("api/openf1")]
    public class OpenF1TokenController : ControllerBase
    {
        private readonly OpenF1TokenService _tokens;

        public OpenF1TokenController(OpenF1TokenService tokens) => _tokens = tokens;

        /// <summary>Returns a valid OpenF1 access token (refreshed automatically before expiry).</summary>
        [HttpGet("token")]
        public async Task<IActionResult> GetToken(CancellationToken ct)
        {
            var token = await _tokens.GetTokenAsync(ct);
            return Ok(new { token });
        }
    }
}
