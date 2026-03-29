using F1Pitwall.Core.Interfaces;
using F1Pitwall.Core.Models;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Threading.Tasks;

namespace F1Pitwall.Core.Services
{
    /// <summary>
    /// Manages the current race state and applies incoming updates from OpenF1.
    /// This is the "brain" of the system - it reconciles all incoming data.
    /// </summary>
    public class RaceStateService : IRaceStateService
    {
        // ============================================
        // STEP 1: FIELDS (the data this service stores)
        // ============================================

        /// <summary>
        /// Thread-safe dictionary storing all driver states.
        /// Key = driver number (44), Value = that driver's current state
        /// 
        /// WHY ConcurrentDictionary?
        /// - Multiple threads might read/write at the same time
        /// - The WebSocket service writes on one thread
        /// - SignalR reads on many threads (one per connected client)
        /// </summary>
        private readonly ConcurrentDictionary<int, DriverState> _drivers = new();

        /// <summary>
        /// Current session status (Inactive, Started, Finished, etc.)
        /// </summary>
        private SessionStatus _sessionStatus = SessionStatus.Inactive;

        /// <summary>
        /// Safety car status ("None", "SC", "VSC", "Red")
        /// </summary>
        private string _safetyCarStatus = "None";

        /// <summary>
        /// Total laps in the race (e.g., 58 for Monaco)
        /// </summary>
        private int _totalLaps = 0;

        /// <summary>
        /// Session type (Practice, Qualifying, Sprint, Race) — updated from SessionInfo messages.
        /// </summary>
        private SessionType _sessionType = SessionType.Race;

        /// <summary>
        /// Tracks the last time telemetry was pushed per driver (for throttling).
        /// Key = driver number, Value = Environment.TickCount64 at last push.
        /// </summary>
        private readonly ConcurrentDictionary<int, long> _lastTelemetryPush = new();

        private const int TelemetryThrottleMs = 100; // Max 10 telemetry pushes/sec per driver

        /// <summary>
        /// Notification service for pushing updates to clients.
        /// This is injected via DI and implemented by SignalRNotificationService.
        /// </summary>
        private readonly INotificationService _notificationService;

        // ============================================
        // STEP 2: CONSTRUCTOR (what happens when this is created)
        // ============================================

        /// <summary>
        /// Constructor - DI will inject the notification service.
        /// 
        /// BEGINNER NOTE:
        /// RaceStateService doesn't know it's SignalR - it just knows
        /// "something implements INotificationService". This is dependency inversion!
        /// </summary>
        public RaceStateService(INotificationService notificationService)
        {
            _notificationService = notificationService;
        }

        // ============================================
        // STEP 3: PUBLIC METHODS (the interface contract)
        // ============================================

        /// <summary>
        /// Applies a timing update to the race state.
        /// This is called MANY times per second from the message dispatcher.
        /// </summary>
        public async Task ApplyUpdateAsync(TimingUpdate update)
        {
            // Pattern matching - handles each update type differently
            // The compiler FORCES us to handle all 6 types (or add a default case)
            switch (update)
            {
                case PositionUpdate p:
                    await ApplyPositionAsync(p);
                    break;

                case CarDataUpdate c:
                    await ApplyCarDataAsync(c);
                    break;

                case TimingDataUpdate t:
                    await ApplyTimingDataAsync(t);
                    break;

                case PitUpdate pit:
                    await ApplyPitAsync(pit);
                    break;

                case SessionStatusUpdate s:
                    await ApplySessionStatusAsync(s);
                    break;

                case SafetyCarUpdate sc:
                    await ApplySafetyCarAsync(sc);
                    break;

                case SessionInfoUpdate si:
                    await ApplySessionInfoAsync(si);
                    break;

                default:
                    // Should never happen if we've handled all types above
                    throw new InvalidOperationException($"Unknown update type: {update.GetType().Name}");
            }
        }

        /// <summary>
        /// Returns the current race state snapshot.
        /// Called when a new SignalR client connects (so they get the full picture).
        /// </summary>
        public RaceState GetCurrentState()
        {
            return new RaceState
            {
                SessionType = _sessionType,
                Status = _sessionStatus,
                SafetyCarStatus = _safetyCarStatus,
                TotalLaps = _totalLaps,
                Drivers = _drivers.ToImmutableDictionary(), // Create immutable snapshot
                LastUpdated = DateTimeOffset.UtcNow
            };
        }

        // ============================================
        // STEP 4: PRIVATE HELPER METHODS (one per update type)
        // ============================================

        /// <summary>
        /// Handles position changes (e.g., "Driver 44 is now P2")
        /// </summary>
        private async Task ApplyPositionAsync(PositionUpdate update)
        {
            // GetOrAdd: If driver doesn't exist, create a new empty state
            var existing = _drivers.GetOrAdd(update.DriverNumber, _ => new DriverState
            {
                DriverNumber = update.DriverNumber,
                Abbreviation = string.Empty, // Will be filled by other updates
                TeamColour = string.Empty
            });

            // Only update if position actually changed (avoid spamming clients)
            if (existing.Position == update.Position)
                return; // No change, skip

            // Create a NEW state with updated position (records are immutable!)
            // The "with" keyword copies all properties except the ones we specify
            var updated = existing with
            {
                Position = update.Position,
                LastUpdated = update.Date
            };

            // Replace the old state with the new one
            _drivers[update.DriverNumber] = updated;

            // ✅ Push to SignalR clients
            await _notificationService.NotifyPositionUpdateAsync(
                update.DriverNumber,
                update.Position
            );
        }

        /// <summary>
        /// Handles car telemetry (speed, throttle, brake, gear, DRS)
        /// This gets called A LOT - multiple times per second per driver!
        /// Throttled to 10 pushes/sec per driver to limit SignalR bandwidth.
        /// </summary>
        private async Task ApplyCarDataAsync(CarDataUpdate update)
        {
            // If driver doesn't exist yet, skip (they'll be added by a position update first)
            if (!_drivers.TryGetValue(update.DriverNumber, out var existing))
                return;

            // Update all telemetry fields at once (always keep state accurate)
            var updated = existing with
            {
                Speed = update.Speed,
                Throttle = update.Throttle,
                Brake = update.Brake,
                Gear = update.Gear,
                DrsOpen = update.DrsOpen,
                LastUpdated = update.Date
            };

            _drivers[update.DriverNumber] = updated;

            // Throttle SignalR push: skip if within throttle window for this driver
            var now = Environment.TickCount64;
            if (_lastTelemetryPush.TryGetValue(update.DriverNumber, out var lastPush) &&
                now - lastPush < TelemetryThrottleMs)
                return;

            _lastTelemetryPush[update.DriverNumber] = now;

            // ✅ Push to SignalR (throttled to 10x/sec per driver)
            await _notificationService.NotifyCarDataUpdateAsync(
                update.DriverNumber,
                update.Speed,
                update.Throttle,
                update.Brake,
                update.Gear,
                update.DrsOpen
            );
        }

        /// <summary>
        /// Handles timing data (lap times, gaps, intervals)
        /// </summary>
        private async Task ApplyTimingDataAsync(TimingDataUpdate update)
        {
            if (!_drivers.TryGetValue(update.DriverNumber, out var existing))
                return;

            var updated = existing with
            {
                LastLapTime = update.LastLapTime,
                GapToLeader = update.GapToLeader,
                Interval = update.Interval,
                CurrentLap = update.CurrentLap,
                LastUpdated = update.Date
            };

            _drivers[update.DriverNumber] = updated;

            // ✅ Push to SignalR
            await _notificationService.NotifyTimingDataUpdateAsync(
                update.DriverNumber,
                update.LastLapTime,
                update.GapToLeader,
                update.Interval,
                update.CurrentLap
            );
        }

        /// <summary>
        /// Handles pit stops (entering pit, new tyres, pit count).
        /// Pit stop count increments automatically when driver exits pit lane.
        /// </summary>
        private async Task ApplyPitAsync(PitUpdate update)
        {
            if (!_drivers.TryGetValue(update.DriverNumber, out var existing))
                return;

            // Auto-increment stop count when driver transitions from in-pit to out-of-pit
            var stopCount = existing.InPit && !update.InPit
                ? existing.PitStopCount + 1
                : existing.PitStopCount;

            var updated = existing with
            {
                InPit = update.InPit,
                PitStopCount = stopCount,
                TyreCompound = update.NewCompound ?? existing.TyreCompound,
                TyreAge = update.NewCompound != null ? 0 : existing.TyreAge,
                LastUpdated = update.Date
            };

            _drivers[update.DriverNumber] = updated;

            // ✅ Push to SignalR
            await _notificationService.NotifyPitUpdateAsync(
                update.DriverNumber,
                update.InPit,
                stopCount,
                update.NewCompound
            );
        }

        /// <summary>
        /// Handles session status changes (race started, finished, red flagged)
        /// </summary>
        private async Task ApplySessionStatusAsync(SessionStatusUpdate update)
        {
            _sessionStatus = update.Status;
            _totalLaps = update.TotalLaps;

            // ✅ Push session status change to all clients
            await _notificationService.NotifySessionStatusAsync(
                update.Status,
                update.TotalLaps
            );
        }

        /// <summary>
        /// Handles safety car deployment (SC, VSC, or back to None)
        /// </summary>
        private async Task ApplySafetyCarAsync(SafetyCarUpdate update)
        {
            _safetyCarStatus = update.Status;

            // ✅ Push safety car status to all clients
            await _notificationService.NotifySafetyCarStatusAsync(update.Status);
        }

        /// <summary>
        /// Handles session info (updates the session type from OpenF1's SessionInfo message).
        /// </summary>
        private Task ApplySessionInfoAsync(SessionInfoUpdate update)
        {
            _sessionType = update.SessionType;
            return Task.CompletedTask;
        }
    }
}
