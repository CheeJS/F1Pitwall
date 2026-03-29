using F1Pitwall.Core.Models;
using System.Threading.Tasks;

namespace F1Pitwall.Core.Interfaces
{
    /// <summary>
    /// Interface for sending real-time notifications to connected clients.
    /// 
    /// BEGINNER EXPLANATION:
    /// This is an "abstraction" - it defines WHAT notifications can be sent,
    /// but NOT HOW they're sent. The Core layer doesn't know about SignalR.
    /// 
    /// WHY use an interface?
    /// - Core stays independent of SignalR (clean architecture)
    /// - Easy to swap implementations (SignalR → WebSockets → SSE)
    /// - Easy to test (create a fake notification service for tests)
    /// 
    /// ANALOGY:
    /// This is like saying "I need something that can send messages"
    /// without caring if it's email, SMS, or carrier pigeon.
    /// </summary>
    public interface INotificationService
    {
        /// <summary>
        /// Sends the complete race state to a specific client (or all clients).
        /// Called when a new browser connects.
        /// </summary>
        Task SendFullStateAsync(RaceState state, string? connectionId = null);

        /// <summary>
        /// Notifies all clients that a driver's position changed.
        /// Example: Driver 44 moved from P3 to P2
        /// </summary>
        Task NotifyPositionUpdateAsync(int driverNumber, int position);

        /// <summary>
        /// Notifies all clients of car telemetry data.
        /// Example: Driver 1 now at 312 km/h, throttle 100%, gear 8
        /// </summary>
        Task NotifyCarDataUpdateAsync(int driverNumber, int speed, int throttle, int brake, int gear, bool drsOpen);

        /// <summary>
        /// Notifies all clients of timing data changes.
        /// Example: Driver 44 lap time: 1:23.456
        /// </summary>
        Task NotifyTimingDataUpdateAsync(int driverNumber, string? lastLapTime, string? gapToLeader, string? interval, int currentLap);

        /// <summary>
        /// Notifies all clients of a pit stop event.
        /// Example: Driver 44 entered pit, new SOFT tyres
        /// </summary>
        Task NotifyPitUpdateAsync(int driverNumber, bool inPit, int pitStopCount, string? newCompound);

        /// <summary>
        /// Notifies all clients of session status change.
        /// Example: Race started, Race finished, Red flag
        /// </summary>
        Task NotifySessionStatusAsync(SessionStatus status, int totalLaps);

        /// <summary>
        /// Notifies all clients of safety car deployment.
        /// Example: Safety Car deployed, Virtual Safety Car
        /// </summary>
        Task NotifySafetyCarStatusAsync(string status);
    }
}
