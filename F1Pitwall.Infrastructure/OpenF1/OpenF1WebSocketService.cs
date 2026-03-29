using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace F1Pitwall.Infrastructure.OpenF1
{
    /// <summary>
    /// Background service that connects to OpenF1's WebSocket and streams live race data.
    /// Handles reconnection with exponential backoff if the connection drops.
    /// 
    /// BEGINNER EXPLANATION:
    /// This is like making a phone call to F1 headquarters that stays open the entire race.
    /// - If the call drops, we automatically redial (with delays: 1s, 2s, 5s, 10s, 30s)
    /// - Messages come in continuously (not request/response like normal HTTP)
    /// - We write incoming messages to a Channel (the "conveyor belt" to MessageDispatcher)
    /// 
    /// WHY this is the most complex file:
    /// - WebSocket connections are fragile (they drop randomly)
    /// - We need a state machine (Disconnected → Connecting → Connected → Reconnecting)
    /// - Messages can be split across multiple frames (need buffering)
    /// </summary>
    public class OpenF1WebSocketService : BackgroundService
    {
        // ============================================
        // CONSTANTS - Reconnection delays
        // ============================================

        /// <summary>
        /// Exponential backoff delays for reconnection attempts.
        /// Attempt 1: 1s, Attempt 2: 2s, Attempt 3: 5s, Attempt 4: 10s, Attempt 5+: 30s
        /// 
        /// WHY exponential backoff?
        /// - If OpenF1 is down, we don't want to spam them with reconnect attempts
        /// - Give the server time to recover
        /// - Standard practice for any network reconnection logic
        /// </summary>
        private static readonly TimeSpan[] BackoffDelays = new[]
        {
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(2),
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(10),
            TimeSpan.FromSeconds(30)
        };

        // ============================================
        // DEPENDENCIES
        // ============================================

        private readonly Channel<string> _rawMessageChannel;
        private readonly OpenF1Options _options;
        private readonly ILogger<OpenF1WebSocketService> _logger;

        // ============================================
        // STATE TRACKING
        // ============================================

        /// <summary>
        /// How many times we've tried to reconnect in a row.
        /// Resets to 0 when successfully connected.
        /// </summary>
        private int _reconnectAttempts = 0;

        // ============================================
        // CONSTRUCTOR
        // ============================================

        public OpenF1WebSocketService(
            Channel<string> rawMessageChannel,
            IOptions<OpenF1Options> options,
            ILogger<OpenF1WebSocketService> logger)
        {
            _rawMessageChannel = rawMessageChannel;
            _options = options.Value; // Extract the actual options object
            _logger = logger;
        }

        // ============================================
        // MAIN EXECUTION METHOD
        // ============================================

        /// <summary>
        /// Main loop: Connect → Receive messages → If disconnected, reconnect
        /// Runs until the app shuts down.
        /// </summary>
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("OpenF1WebSocketService starting");

            // Keep trying to connect forever (until app shutdown)
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    // Connect and receive messages
                    // This will block until the connection drops
                    await ConnectAndReceiveAsync(stoppingToken);

                    // If we reach here, the connection closed gracefully
                    _logger.LogInformation("WebSocket closed gracefully");
                    break; // Exit the loop (only happens on app shutdown)
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    // App is shutting down - this is expected
                    _logger.LogInformation("OpenF1WebSocketService stopping (app shutdown)");
                    break;
                }
                catch (Exception ex)
                {
                    // Connection dropped unexpectedly
                    if (_reconnectAttempts == 0)
                    {
                        _logger.LogInformation("⚠️ No live F1 session detected. Will keep trying...");
                    }

                    _logger.LogDebug(ex, "WebSocket disconnected. Reconnecting... (Attempt {Attempt})", _reconnectAttempts + 1);

                    // Wait before reconnecting (exponential backoff)
                    await ApplyBackoffAsync(stoppingToken);
                }
            }

            _logger.LogInformation("OpenF1WebSocketService stopped");
        }

        // ============================================
        // CONNECTION LOGIC
        // ============================================

        /// <summary>
        /// Connects to the WebSocket and receives messages until disconnection.
        /// </summary>
        private async Task ConnectAndReceiveAsync(CancellationToken ct)
        {
            // Create a new WebSocket client
            using var ws = new ClientWebSocket();

            _logger.LogInformation("Connecting to OpenF1 WebSocket: {Url}", _options.WebSocketUrl);

            // Connect to OpenF1's WebSocket endpoint
            await ws.ConnectAsync(new Uri(_options.WebSocketUrl), ct);

            _logger.LogInformation("✅ Connected to OpenF1 WebSocket");
            _reconnectAttempts = 0; // Reset counter on successful connection

            // Buffer for receiving data
            // 64KB is enough for OpenF1 messages (they're usually < 10KB each)
            var buffer = new byte[64 * 1024];

            // StringBuilder for accumulating multi-frame messages
            var messageBuilder = new StringBuilder();

            // Keep receiving until the connection closes
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                // Receive one "chunk" of data
                var result = await ws.ReceiveAsync(new Memory<byte>(buffer), ct);

                // Check if the server is closing the connection
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.LogInformation("Server sent close frame");
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", ct);
                    break;
                }

                // Convert bytes → string and append to builder
                var chunk = Encoding.UTF8.GetString(buffer, 0, result.Count);
                messageBuilder.Append(chunk);

                // Check if this is the last frame of the message
                if (result.EndOfMessage)
                {
                    // We have a complete message!
                    var completeMessage = messageBuilder.ToString();
                    messageBuilder.Clear();

                    // Write to the channel (non-blocking)
                    // If the channel is full, drop the message (old telemetry is worthless)
                    if (!_rawMessageChannel.Writer.TryWrite(completeMessage))
                    {
                        _logger.LogDebug("Channel full - dropping message");
                    }
                }
            }
        }

        // ============================================
        // RECONNECTION LOGIC
        // ============================================

        /// <summary>
        /// Applies exponential backoff delay before reconnecting.
        /// </summary>
        private async Task ApplyBackoffAsync(CancellationToken ct)
        {
            // Pick the delay based on attempt count
            // If we've tried 10 times, keep using the max delay (30s)
            var delay = BackoffDelays[Math.Min(_reconnectAttempts, BackoffDelays.Length - 1)];

            _reconnectAttempts++;

            _logger.LogInformation("⏳ Reconnecting in {Delay} seconds...", delay.TotalSeconds);

            try
            {
                await Task.Delay(delay, ct);
            }
            catch (OperationCanceledException)
            {
                // App is shutting down during the delay - this is fine
                throw;
            }
        }
    }
}
