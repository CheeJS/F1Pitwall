using F1PitWall.Api.Hubs;
using F1Pitwall.Core.Interfaces;
using F1Pitwall.Infrastructure;
using F1Pitwall.Infrastructure.SignalR;

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
// This allows a React app on http://localhost:5173 to connect to this API
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        policy.WithOrigins("http://localhost:5173", "http://localhost:3000") // Vite and CRA dev servers
              .AllowAnyHeader()
              .WithMethods("GET", "POST", "OPTIONS") // GET for REST+WS, POST for SignalR negotiate
              .AllowCredentials(); // Required for SignalR WebSocket connections
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

// Apply CORS policy (must come BEFORE routing)
app.UseCors("AllowReactApp");

// Redirect HTTP → HTTPS (commented out for development)
// app.UseHttpsRedirection();

// Serve static files (for test.html)
app.UseStaticFiles();

// Enable default file serving (index.html, default.html, etc.)
app.UseDefaultFiles();

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
