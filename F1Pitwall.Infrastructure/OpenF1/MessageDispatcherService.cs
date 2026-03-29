using F1Pitwall.Core.Interfaces;
using F1Pitwall.Core.Models;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace F1Pitwall.Infrastructure.OpenF1
{
    /// <summary>
    /// Background service that reads raw JSON messages from a Channel,
    /// parses them into typed TimingUpdate objects, and sends them to RaceStateService.
    /// 
    /// BEGINNER EXPLANATION:
    /// Imagine a conveyor belt (the Channel):
    /// - OpenF1WebSocketService drops raw JSON strings onto one end
    /// - This service picks them up from the other end
    /// - Parses them (converts JSON → C# objects)
    /// - Sends the parsed objects to RaceStateService
    /// 
    /// WHY separate parsing from WebSocket receiving?
    /// - If parsing throws an error, it won't kill the WebSocket connection
    /// - The WebSocket can keep receiving while parsing catches up
    /// - Easier to test each part independently
    /// </summary>
    public class MessageDispatcherService : BackgroundService
    {
        // ============================================
        // DEPENDENCIES (injected via constructor)
        // ============================================

        /// <summary>
        /// The channel that connects WebSocketService → Dispatcher
        /// Think of it as a queue/buffer between the two services
        /// </summary>
        private readonly Channel<string> _rawMessageChannel;

        /// <summary>
        /// The service that manages race state (where we send parsed updates)
        /// </summary>
        private readonly IRaceStateService _raceStateService;

        /// <summary>
        /// The parser that converts JSON strings → TimingUpdate objects
        /// </summary>
        private readonly OpenF1MessageParser _parser;

        /// <summary>
        /// Logger for debugging and error tracking
        /// </summary>
        private readonly ILogger<MessageDispatcherService> _logger;

        // ============================================
        // CONSTRUCTOR
        // ============================================

        /// <summary>
        /// Constructor - ASP.NET Core will inject these dependencies automatically
        /// via Dependency Injection (DI).
        /// 
        /// BEGINNER NOTE:
        /// You don't call "new MessageDispatcherService(...)" yourself.
        /// The framework creates it for you and passes in the dependencies.
        /// </summary>
        public MessageDispatcherService(
            Channel<string> rawMessageChannel,
            IRaceStateService raceStateService,
            OpenF1MessageParser parser,
            ILogger<MessageDispatcherService> logger)
        {
            _rawMessageChannel = rawMessageChannel;
            _raceStateService = raceStateService;
            _parser = parser;
            _logger = logger;
        }

        // ============================================
        // MAIN EXECUTION METHOD
        // ============================================

        /// <summary>
        /// This method runs when the service starts.
        /// It loops forever (until the app shuts down) reading messages from the channel.
        /// 
        /// BackgroundService = runs in the background, doesn't block the main app
        /// </summary>
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("MessageDispatcherService started");

            try
            {
                // ReadAllAsync = continuously read from channel until it's closed
                // This is like: while(true) { read next message }
                // But it respects cancellation (when app shuts down)
                await foreach (var rawMessage in _rawMessageChannel.Reader.ReadAllAsync(stoppingToken))
                {
                    // Process each message
                    await ProcessMessageAsync(rawMessage);
                }
            }
            catch (OperationCanceledException)
            {
                // This is expected when the app is shutting down
                _logger.LogInformation("MessageDispatcherService stopping (app shutdown)");
            }
            catch (Exception ex)
            {
                // Unexpected error - log it but don't crash the entire app
                _logger.LogError(ex, "MessageDispatcherService failed unexpectedly");
            }
        }

        // ============================================
        // HELPER METHODS
        // ============================================

        /// <summary>
        /// Processes a single raw JSON message.
        /// Steps:
        /// 1. Parse JSON → List of TimingUpdate objects
        /// 2. For each update, send it to RaceStateService
        /// </summary>
        private async Task ProcessMessageAsync(string rawMessage)
        {
            try
            {
                // Step 1: Parse the JSON string
                // Returns a LIST because one message might contain multiple updates
                // Example: ["Position.z", {...}] might contain 20 driver position updates
                var updates = _parser.Parse(rawMessage);

                // Step 2: Send each update to RaceStateService
                foreach (var update in updates)
                {
                    await _raceStateService.ApplyUpdateAsync(update);
                }
            }
            catch (JsonException ex)
            {
                // JSON parsing failed - log it but DON'T crash
                // Bad messages happen sometimes (network corruption, API changes)
                // Just skip this message and continue with the next one
                
                // Truncate message for logging (don't log huge messages)
                var preview = rawMessage.Length > 200 
                    ? rawMessage.Substring(0, 200) + "..." 
                    : rawMessage;

                _logger.LogWarning(ex, "Failed to parse message: {Preview}", preview);
            }
            catch (Exception ex)
            {
                // Some other unexpected error - log it
                _logger.LogError(ex, "Error processing message");
            }
        }
    }
}
