using System.Threading.Tasks;

namespace F1PitWall.Api.Hubs
{
    /// <summary>
    /// Strongly-typed interface defining what the SERVER can call on CLIENTS.
    /// This is the "contract" between server and browser.
    /// 
    /// BEGINNER EXPLANATION:
    /// SignalR lets the server call JavaScript functions in the browser.
    /// This interface lists all the functions we can call.
    /// 
    /// In the browser (React), you'll write:
    ///   connection.on("ReceiveFullState", (state) => { ... });
    ///   connection.on("ReceiveDriverUpdate", (update) => { ... });
    /// 
    /// WHY use an interface?
    /// - Type safety: Typos cause compile errors instead of silent failures
    /// - IntelliSense: You get autocomplete when calling client methods
    /// - Documentation: The contract is explicit
    /// </summary>
    public interface ITimingClient
    {
        /// <summary>
        /// Sends the complete race state to a newly connected client.
        /// Called when a browser first connects (so it doesn't start blank).
        /// </summary>
        Task ReceiveFullState(object state);

        /// <summary>
        /// Sends a single driver position update.
        /// Example: Driver 44 moved from P3 to P2
        /// </summary>
        Task ReceiveDriverUpdate(object update);

        /// <summary>
        /// Sends car telemetry data (speed, throttle, brake, gear).
        /// This gets called A LOT (100x per second per driver).
        /// </summary>
        Task ReceiveCarData(object data);

        /// <summary>
        /// Sends session status change (race started, finished, red flagged).
        /// </summary>
        Task ReceiveSessionStatus(object status);

        /// <summary>
        /// Sends safety car status (SC deployed, VSC, back to green).
        /// </summary>
        Task ReceiveSafetyCarStatus(object status);
    }
}
