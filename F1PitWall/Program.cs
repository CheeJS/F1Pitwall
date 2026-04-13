using System.Threading.RateLimiting;
using F1PitWall.Api.Hubs;
using F1Pitwall.Core.Interfaces;
using F1Pitwall.Infrastructure;
using F1Pitwall.Infrastructure.SignalR;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// ============================================
// STEP 1: Add services to the container
// ============================================

// Add controllers with camelCase JSON (matches TypeScript frontend types)
builder.Services.AddControllers()
    .AddJsonOptions(o =>
        o.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase);

// Add SignalR (for real-time communication with browsers)
builder.Services.AddSignalR(options =>
{
    // Show detailed errors in development (helps debugging)
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();

    // Send a "ping" every 15 seconds to keep connection alive
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);

    // If client doesn't respond for 30 seconds, disconnect them
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(30);
})
// Serialize SignalR hub messages with camelCase — matches frontend TypeScript types
.AddJsonProtocol(options =>
{
    options.PayloadSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});

// Add CORS (Cross-Origin Resource Sharing)
// Origins are read from config so production URLs can be set via env var:
//   ALLOWED_ORIGINS=https://your-app.pages.dev
// Defaults to localhost dev servers when not set.
var allowedOrigins = (builder.Configuration["AllowedOrigins"] ?? string.Empty)
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
if (allowedOrigins.Length == 0)
    allowedOrigins = ["http://localhost:5173", "http://localhost:3000"];

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .WithMethods("GET", "POST", "OPTIONS")
              .AllowCredentials(); // Required for SignalR WebSocket connections
    });
});

// Rate limiting: 60 requests per minute per client IP for /api/* endpoints.
// SignalR traffic (/hubs/timing) is not rate-limited so live updates aren't throttled.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
    {
        var path = ctx.Request.Path.Value ?? string.Empty;
        if (!path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
        {
            return RateLimitPartition.GetNoLimiter("no-limit");
        }
        var key = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 60,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        });
    });
});

// Add F1 Infrastructure services (WebSocket, Channel, Parser, RaceStateService)
// This calls the extension method we created in DependencyInjection.cs
builder.Services.AddF1Infrastructure(builder.Configuration);

// Add SignalR Notification Service
// This is the "glue" that connects RaceStateService (Core) to SignalR (API)
// We register it here because it needs to know about TimingHub and ITimingClient
builder.Services.AddSingleton<INotificationService, SignalRNotificationService<TimingHub, ITimingClient>>();

// ============================================
// STEP 2: Build the app
// ============================================

var app = builder.Build();

// ============================================
// STEP 3: Configure the HTTP request pipeline
// ============================================

// Global exception handler — returns a safe JSON shape and avoids leaking
// stack traces to clients in production.
app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async ctx =>
    {
        var feat = ctx.Features.Get<IExceptionHandlerFeature>();
        var logger = ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("UnhandledException");
        if (feat?.Error is { } ex)
        {
            logger.LogError(ex, "Unhandled exception at {Path}", ctx.Request.Path);
        }
        ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsJsonAsync(new { error = "Internal server error" });
    });
});

// Apply CORS policy (must come BEFORE routing)
app.UseCors("AllowReactApp");

// Redirect HTTP → HTTPS in production. Dev uses HTTP for Vite's easy reload.
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

// Serve static files (for test.html)
app.UseStaticFiles();

// Enable default file serving (index.html, default.html, etc.)
app.UseDefaultFiles();

// Apply rate limiting (must be after routing is set up implicitly by the endpoint mapping below)
app.UseRateLimiter();

// Enable authorization (for future protected endpoints)
app.UseAuthorization();

// Map REST controllers (if we add any later)
app.MapControllers();

// Map SignalR hub endpoint
// Browsers will connect to: ws://localhost:5000/hubs/timing
app.MapHub<TimingHub>("/hubs/timing");

// ============================================
// STEP 4: Run the app
// ============================================

app.Run();
