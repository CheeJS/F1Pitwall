using F1Pitwall.Core.Interfaces;
using F1Pitwall.Core.Services;
using F1Pitwall.Infrastructure.OpenF1;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Threading.Channels;

namespace F1Pitwall.Infrastructure
{
    /// <summary>
    /// Extension methods for registering Infrastructure services in the DI container.
    /// 
    /// BEGINNER EXPLANATION:
    /// This is like a "wiring diagram" for your app.
    /// Instead of doing:
    ///   var parser = new OpenF1MessageParser();
    ///   var service = new MessageDispatcherService(channel, raceService, parser, logger);
    /// 
    /// You tell the DI container "when someone asks for X, create Y".
    /// Then ASP.NET Core automatically creates and injects dependencies.
    /// 
    /// WHY use Dependency Injection?
    /// - You don't have to manually "new" everything
    /// - Easy to swap implementations (memory → database)
    /// - Makes testing easier (inject fake services)
    /// </summary>
    public static class InfrastructureServiceExtensions
    {
        /// <summary>
        /// Registers all Infrastructure services (OpenF1 connection, channel, parser).
        /// Call this from Program.cs like: builder.Services.AddF1Infrastructure(builder.Configuration);
        /// </summary>
        public static IServiceCollection AddF1Infrastructure(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            // In-memory cache for OpenF1 REST responses (avoids slow repeated fetches)
            services.AddMemoryCache();

            // ============================================
            // STEP 1: Register the Channel (the "conveyor belt")
            // ============================================

            /// <summary>
            /// Creates a bounded channel with 512 capacity.
            /// 
            /// BOUNDED vs UNBOUNDED:
            /// - Bounded: Has a size limit (512 messages)
            /// - Unbounded: No limit (could use infinite memory!)
            /// 
            /// DROPONDEST:
            /// When the channel is full, drop the OLDEST message.
            /// Why? Because old telemetry is worthless.
            /// If we're 512 messages behind, we don't care about speed from 5 seconds ago.
            /// 
            /// SINGLEREADER/SINGLEWRITER:
            /// Optimizations - only one thread writes (WebSocket), one reads (Dispatcher)
            /// </summary>
            services.AddSingleton(_ =>
                Channel.CreateBounded<string>(new BoundedChannelOptions(512)
                {
                    FullMode = BoundedChannelFullMode.DropOldest,
                    SingleReader = true,   // Only MessageDispatcher reads
                    SingleWriter = true    // Only OpenF1WebSocketService writes
                }));

            // ============================================
            // STEP 2: Register configuration options
            // ============================================

            /// <summary>
            /// Binds the "OpenF1" section from appsettings.json to OpenF1Options class.
            /// 
            /// In appsettings.json:
            /// {
            ///   "OpenF1": {
            ///     "WebSocketUrl": "wss://api.openf1.org/v1/live",
            ///     "RestBaseUrl": "https://api.openf1.org/v1"
            ///   }
            /// }
            /// 
            /// Now any service that takes IOptions<OpenF1Options> will get these values.
            /// </summary>
            services.Configure<OpenF1Options>(options =>
            {
                configuration.GetSection("OpenF1").Bind(options);
            });

            // ============================================
            // STEP 3: Register the parser
            // ============================================

            /// <summary>
            /// Registers OpenF1MessageParser as a singleton.
            /// 
            /// SINGLETON: Only one instance is created for the entire app lifetime.
            /// The parser has no state, so we can reuse the same instance.
            /// </summary>
            services.AddSingleton<OpenF1MessageParser>();

            // ============================================
            // STEP 4: Register the background services
            // ============================================

            /// <summary>
            /// Registers the two background services.
            /// They start automatically when the app starts.
            /// </summary>
            services.AddHostedService<OpenF1WebSocketService>();
            services.AddHostedService<MessageDispatcherService>();

            // ============================================
            // STEP 5: Register RaceStateService
            // ============================================

            /// <summary>
            /// Registers RaceStateService as a singleton.
            /// 
            /// SINGLETON because:
            /// - There's only ONE race state (all clients see the same state)
            /// - It must persist for the entire app lifetime
            /// 
            /// Registered as both the interface and the implementation:
            /// - If someone asks for IRaceStateService, give them RaceStateService
            /// </summary>
            services.AddSingleton<IRaceStateService, RaceStateService>();

            // ============================================
            // STEP 6: Register OpenF1 REST client
            // ============================================

            var restBaseUrl = configuration.GetSection("OpenF1")["RestBaseUrl"]
                ?? "https://api.openf1.org/v1";

            services.AddHttpClient("OpenF1", client =>
            {
                client.BaseAddress = new Uri(restBaseUrl.TrimEnd('/') + "/");
                client.DefaultRequestHeaders.Add("Accept", "application/json");
            });

            services.AddSingleton<IOpenF1Client, OpenF1RestClient>();

            // ============================================
            // STEP 7: Register SignalR Notification Service
            // ============================================

            /// <summary>
            /// Registers SignalRNotificationService as the implementation of INotificationService.
            /// This is registered in INFRASTRUCTURE (not API) because it's a technical detail.
            /// 
            /// NOTE: The generic type parameters will be provided when this is called
            /// from Program.cs, where we know about TimingHub and ITimingClient.
            /// </summary>
            // This will be registered in Program.cs because it needs TimingHub reference

            return services;
        }
    }
}
