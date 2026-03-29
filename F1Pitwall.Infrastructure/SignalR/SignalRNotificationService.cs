using F1Pitwall.Core.Interfaces;
using F1Pitwall.Core.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using System;
using System.Threading.Tasks;

namespace F1Pitwall.Infrastructure.SignalR
{
    /// <summary>
    /// SignalR implementation of INotificationService.
    /// This is the "glue" between Core (which doesn't know about SignalR)
    /// and the actual SignalR hub.
    /// 
    /// BEGINNER EXPLANATION:
    /// RaceStateService says: "Send this notification"
    /// This service says: "OK, I'll use SignalR to do it"
    /// 
    /// IHubContext is like a "remote control" for the SignalR hub.
    /// We can call client methods WITHOUT being inside the hub itself.
    /// 
    /// WHY this pattern?
    /// - RaceStateService (Core) doesn't reference SignalR
    /// - This service (Infrastructure) handles the SignalR details
    /// - Clean separation of concerns
    /// </summary>
    /// <typeparam name="THub">The SignalR hub type (TimingHub)</typeparam>
    /// <typeparam name="TClient">The client interface (ITimingClient)</typeparam>
    public class SignalRNotificationService<THub, TClient> : INotificationService
        where THub : Hub<TClient>
        where TClient : class
    {
        private readonly IHubContext<THub, TClient> _hubContext;
        private readonly ILogger<SignalRNotificationService<THub, TClient>> _logger;

        /// <summary>
        /// Constructor - DI will inject the hub context
        /// </summary>
        public SignalRNotificationService(
            IHubContext<THub, TClient> hubContext,
            ILogger<SignalRNotificationService<THub, TClient>> logger)
        {
            _hubContext = hubContext;
            _logger = logger;
        }

        /// <summary>
        /// Sends the full race state to a specific client or all clients.
        /// </summary>
        public async Task SendFullStateAsync(RaceState state, string? connectionId = null)
        {
            try
            {
                // Cast to dynamic to call the actual client method
                // This is necessary because TClient is generic
                dynamic clients = connectionId != null
                    ? _hubContext.Clients.Client(connectionId)
                    : _hubContext.Clients.All;

                await clients.ReceiveFullState(state);

                _logger.LogDebug("Sent full state to {Target}",
                    connectionId != null ? $"client {connectionId}" : "all clients");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending full state");
            }
        }

        /// <summary>
        /// Notifies all clients of a position change.
        /// </summary>
        public async Task NotifyPositionUpdateAsync(int driverNumber, int position)
        {
            try
            {
                dynamic clients = _hubContext.Clients.All;

                await clients.ReceiveDriverUpdate(new PositionUpdateDto(
                    UpdateType: "position",
                    DriverNumber: driverNumber,
                    Position: position,
                    Timestamp: DateTimeOffset.UtcNow));

                _logger.LogDebug("Notified position update: Driver {Driver} → P{Position}",
                    driverNumber, position);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error notifying position update");
            }
        }

        /// <summary>
        /// Notifies all clients of car telemetry.
        /// </summary>
        public async Task NotifyCarDataUpdateAsync(
            int driverNumber,
            int speed,
            int throttle,
            int brake,
            int gear,
            bool drsOpen)
        {
            try
            {
                dynamic clients = _hubContext.Clients.All;

                await clients.ReceiveCarData(new CarDataDto(
                    DriverNumber: driverNumber,
                    Speed: speed,
                    Throttle: throttle,
                    Brake: brake,
                    Gear: gear,
                    DrsOpen: drsOpen,
                    Timestamp: DateTimeOffset.UtcNow));

                // Don't log every telemetry update (too noisy!)
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error notifying car data update");
            }
        }

        /// <summary>
        /// Notifies all clients of timing data.
        /// </summary>
        public async Task NotifyTimingDataUpdateAsync(
            int driverNumber,
            string? lastLapTime,
            string? gapToLeader,
            string? interval,
            int currentLap)
        {
            try
            {
                dynamic clients = _hubContext.Clients.All;

                await clients.ReceiveDriverUpdate(new TimingDataDto(
                    UpdateType: "timing",
                    DriverNumber: driverNumber,
                    LastLapTime: lastLapTime,
                    GapToLeader: gapToLeader,
                    Interval: interval,
                    CurrentLap: currentLap,
                    Timestamp: DateTimeOffset.UtcNow));

                _logger.LogDebug("Notified timing update: Driver {Driver}, Lap {Lap}",
                    driverNumber, currentLap);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error notifying timing data update");
            }
        }

        /// <summary>
        /// Notifies all clients of a pit stop.
        /// </summary>
        public async Task NotifyPitUpdateAsync(
            int driverNumber,
            bool inPit,
            int pitStopCount,
            string? newCompound)
        {
            try
            {
                dynamic clients = _hubContext.Clients.All;

                await clients.ReceiveDriverUpdate(new PitUpdateDto(
                    UpdateType: "pit",
                    DriverNumber: driverNumber,
                    InPit: inPit,
                    PitStopCount: pitStopCount,
                    NewCompound: newCompound,
                    Timestamp: DateTimeOffset.UtcNow));

                _logger.LogInformation("🏁 Pit stop: Driver {Driver} {Status}, Count: {Count}, Compound: {Compound}",
                    driverNumber,
                    inPit ? "ENTERED" : "EXITED",
                    pitStopCount,
                    newCompound ?? "N/A");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error notifying pit update");
            }
        }

        /// <summary>
        /// Notifies all clients of session status change.
        /// </summary>
        public async Task NotifySessionStatusAsync(SessionStatus status, int totalLaps)
        {
            try
            {
                dynamic clients = _hubContext.Clients.All;

                await clients.ReceiveSessionStatus(new SessionStatusDto(
                    Status: status.ToString(),
                    TotalLaps: totalLaps,
                    Timestamp: DateTimeOffset.UtcNow));

                _logger.LogInformation("🚦 Session status: {Status} ({Laps} laps)",
                    status, totalLaps);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error notifying session status");
            }
        }

        /// <summary>
        /// Notifies all clients of safety car deployment.
        /// </summary>
        public async Task NotifySafetyCarStatusAsync(string status)
        {
            try
            {
                dynamic clients = _hubContext.Clients.All;

                await clients.ReceiveSafetyCarStatus(new SafetyCarStatusDto(
                    Status: status,
                    Timestamp: DateTimeOffset.UtcNow));

                _logger.LogInformation("🚗 Safety Car: {Status}", status);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error notifying safety car status");
            }
        }
    }
}
