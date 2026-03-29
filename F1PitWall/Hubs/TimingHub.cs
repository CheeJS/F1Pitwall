using F1Pitwall.Core.Interfaces;
using Microsoft.AspNetCore.SignalR;
using System.Threading.Tasks;

namespace F1PitWall.Api.Hubs
{
    /// <summary>
    /// SignalR Hub for real-time F1 timing updates.
    /// Browsers connect to this via WebSocket at "/hubs/timing".
    /// 
    /// BEGINNER EXPLANATION:
    /// Think of this as a "chat room" where:
    /// - Browsers connect and listen for updates
    /// - The server (RaceStateService) pushes updates when data changes
    /// - Multiple browsers can connect and all get the same updates
    /// 
    /// Hub<ITimingClient> means:
    /// - We can only call methods defined in ITimingClient
    /// - The compiler will catch typos in method names
    /// 
    /// WHY SignalR instead of regular HTTP polling?
    /// HTTP: Browser asks "any updates?" every 100ms (wasteful)
    /// SignalR: Server pushes updates instantly when they happen
    /// </summary>
    public class TimingHub : Hub<ITimingClient>
    {
        private readonly IRaceStateService _raceStateService;

        /// <summary>
        /// Constructor - DI will inject the RaceStateService
        /// </summary>
        public TimingHub(IRaceStateService raceStateService)
        {
            _raceStateService = raceStateService;
        }

        /// <summary>
        /// Called automatically when a new client connects.
        /// We send them the full current state so their UI isn't blank.
        /// 
        /// ANALOGY:
        /// Like joining a live sports broadcast - you see the current score
        /// immediately, not a blank screen until the next goal.
        /// </summary>
        public override async Task OnConnectedAsync()
        {
            // Get the current race state
            var currentState = _raceStateService.GetCurrentState();

            // Send it to ONLY this client (Caller = the browser that just connected)
            await Clients.Caller.ReceiveFullState(currentState);

            // Call the base method (required by SignalR)
            await base.OnConnectedAsync();
        }

        /// <summary>
        /// Called automatically when a client disconnects.
        /// We don't need to do anything special here, but we could log it.
        /// </summary>
        public override async Task OnDisconnectedAsync(System.Exception? exception)
        {
            // Could log disconnection here if needed
            await base.OnDisconnectedAsync(exception);
        }

        // Note: We don't have any "public" methods here because clients don't
        // need to CALL anything on the server (it's all one-way: server → client)
        // 
        // If we wanted two-way communication (e.g., "client votes for driver of the day"),
        // we'd add public methods here like:
        // public async Task VoteForDriver(int driverNumber) { ... }
    }
}
