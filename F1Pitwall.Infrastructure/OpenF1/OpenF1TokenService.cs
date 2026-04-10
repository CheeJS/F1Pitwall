using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Options;

namespace F1Pitwall.Infrastructure.OpenF1
{
    /// <summary>
    /// Fetches and caches an OpenF1 OAuth2 access token.
    /// Tokens are valid for 1 hour; we proactively refresh 5 minutes before expiry.
    /// Thread-safe: SemaphoreSlim prevents concurrent refresh races.
    /// </summary>
    public class OpenF1TokenService
    {
        private readonly IHttpClientFactory _http;
        private readonly IOptions<OpenF1Options> _opts;
        private readonly SemaphoreSlim _lock = new(1, 1);

        private string? _token;
        private DateTimeOffset _expiresAt = DateTimeOffset.MinValue;

        public OpenF1TokenService(IHttpClientFactory http, IOptions<OpenF1Options> opts)
        {
            _http = http;
            _opts = opts;
        }

        /// <summary>Returns a valid access token, refreshing if needed.</summary>
        public async Task<string> GetTokenAsync(CancellationToken ct = default)
        {
            // Fast path: still valid with >5 min margin
            if (_token is not null && DateTimeOffset.UtcNow < _expiresAt - TimeSpan.FromMinutes(5))
                return _token;

            await _lock.WaitAsync(ct);
            try
            {
                // Double-check after acquiring the lock
                if (_token is not null && DateTimeOffset.UtcNow < _expiresAt - TimeSpan.FromMinutes(5))
                    return _token;

                var client = _http.CreateClient();
                var response = await client.PostAsync(
                    "https://api.openf1.org/token",
                    new FormUrlEncodedContent(new Dictionary<string, string>
                    {
                        ["username"] = _opts.Value.Username,
                        ["password"] = _opts.Value.Password,
                    }),
                    ct);

                response.EnsureSuccessStatusCode();

                var result = await response.Content
                    .ReadFromJsonAsync<TokenResponse>(cancellationToken: ct)
                    ?? throw new InvalidOperationException("OpenF1 token response was null");

                _token = result.AccessToken;
                _expiresAt = DateTimeOffset.UtcNow.AddSeconds(result.ExpiresIn);
                return _token;
            }
            finally
            {
                _lock.Release();
            }
        }

        private record TokenResponse(
            [property: JsonPropertyName("access_token")] string AccessToken,
            [property: JsonPropertyName("expires_in")] int ExpiresIn);
    }
}
