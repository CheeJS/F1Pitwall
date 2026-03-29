using System;

namespace F1Pitwall.Infrastructure.OpenF1
{
    /// <summary>
    /// Configuration options for connecting to OpenF1's API.
    /// These values come from appsettings.json.
    /// 
    /// BEGINNER EXPLANATION:
    /// Think of this like a settings menu in a game.
    /// Instead of hardcoding URLs in the code, we put them in a config file
    /// so we can change them without recompiling.
    /// </summary>
    public class OpenF1Options
    {
        /// <summary>
        /// WebSocket URL for live streaming data.
        /// Example: "wss://api.openf1.org/v1/live"
        /// 
        /// WSS = WebSocket Secure (like HTTPS for WebSockets)
        /// </summary>
        public string WebSocketUrl { get; set; } = string.Empty;

        /// <summary>
        /// REST API base URL for historical data.
        /// Example: "https://api.openf1.org/v1"
        /// 
        /// Used when there's no live race (to load past sessions for demos)
        /// </summary>
        public string RestBaseUrl { get; set; } = string.Empty;

        /// <summary>
        /// How many times to try reconnecting before giving up.
        /// Default: 10 attempts with exponential backoff (1s, 2s, 5s, 10s, 30s...)
        /// </summary>
        public int MaxReconnectAttempts { get; set; } = 10;
    }
}
