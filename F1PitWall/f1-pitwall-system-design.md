# F1//PITWALL — Full System Design

## Overview

A live F1 timing dashboard that connects to OpenF1's WebSocket stream, reconciles multi-type race state updates, and pushes diffs to connected React clients over SignalR. Built on ASP.NET Core 8.

**The core engineering problem:** OpenF1 streams heterogeneous JSON messages (positions, car telemetry, timing, pit events, safety car) over a single WebSocket connection. These messages arrive out of order, at different rates, and the connection drops on session transitions. The system must reconstruct coherent per-driver state from this stream reliably, and survive reconnects without corrupting the UI state for connected clients.

---

## Architecture Overview

```
OpenF1 WS ──► OpenF1WebSocketService (BackgroundService)
                    │
                    │  writes to
                    ▼
              Channel<RawMessage>   (bounded, 512 capacity)
                    │
                    │  reads from
                    ▼
            MessageDispatcherService (BackgroundService)
                    │
                    │  dispatches typed updates to
                    ▼
            RaceStateService  (Singleton)
                    │
                    │  pushes diffs via IHubContext
                    ▼
            TimingHub  (SignalR)
                    │
                    │  WebSocket / SSE fallback
                    ▼
            React frontend  (@microsoft/signalr)
```

---

## Project Structure

```
F1Pitwall/
├── F1Pitwall.Api/
│   ├── Program.cs
│   ├── Hubs/
│   │   └── TimingHub.cs
│   └── appsettings.json
│
├── F1Pitwall.Core/
│   ├── Models/
│   │   ├── DriverState.cs
│   │   ├── RaceState.cs
│   │   ├── TimingUpdate.cs        ← discriminated union of update types
│   │   └── ConnectionState.cs
│   ├── Interfaces/
│   │   ├── IRaceStateService.cs
│   │   └── IOpenF1Client.cs
│   └── Services/
│       └── RaceStateService.cs
│
├── F1Pitwall.Infrastructure/
│   ├── OpenF1/
│   │   ├── OpenF1WebSocketService.cs   ← BackgroundService
│   │   ├── MessageDispatcherService.cs ← BackgroundService
│   │   ├── OpenF1MessageParser.cs
│   │   └── OpenF1Options.cs
│   └── DependencyInjection.cs
│
└── F1Pitwall.Web/              ← Vite + React
    ├── src/
    │   ├── hooks/useTimingHub.ts
    │   ├── components/TimingTower.tsx
    │   └── store/raceStore.ts
    └── package.json
```

---

## Domain Models (`F1Pitwall.Core`)

### DriverState

```csharp
// F1Pitwall.Core/Models/DriverState.cs
public record DriverState
{
    public int DriverNumber { get; init; }
    public string Abbreviation { get; init; } = string.Empty;
    public string TeamColour { get; init; } = string.Empty;

    // Timing
    public int Position { get; init; }
    public string? LastLapTime { get; init; }
    public string? GapToLeader { get; init; }
    public string? Interval { get; init; }
    public int CurrentLap { get; init; }

    // Car telemetry
    public int Speed { get; init; }           // km/h
    public int Throttle { get; init; }        // 0-100
    public int Brake { get; init; }           // 0-100
    public int Gear { get; init; }
    public bool DrsOpen { get; init; }

    // Tyre
    public string? TyreCompound { get; init; }
    public int TyreAge { get; init; }         // laps on current set

    // Pit
    public int PitStopCount { get; init; }
    public bool InPit { get; init; }

    public DateTimeOffset LastUpdated { get; init; }
}
```

### RaceState

```csharp
// F1Pitwall.Core/Models/RaceState.cs
public record RaceState
{
    public SessionType SessionType { get; init; }
    public SessionStatus Status { get; init; }   // Inactive, Started, Finished, Aborted
    public string? SafetyCarStatus { get; init; } // None, SC, VSC, Red
    public int TotalLaps { get; init; }
    public IReadOnlyDictionary<int, DriverState> Drivers { get; init; }
        = ImmutableDictionary<int, DriverState>.Empty;
    public DateTimeOffset LastUpdated { get; init; }
}

public enum SessionType { Practice, Qualifying, Sprint, Race }
public enum SessionStatus { Inactive, Started, Aborted, Finished }
```

### TimingUpdate — Discriminated Union

Each message from OpenF1 maps to a typed update. The dispatcher creates these; the state service consumes them. Using a discriminated union means the compiler enforces exhaustive handling.

```csharp
// F1Pitwall.Core/Models/TimingUpdate.cs
[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(PositionUpdate), "position")]
[JsonDerivedType(typeof(CarDataUpdate), "cardata")]
[JsonDerivedType(typeof(TimingDataUpdate), "timing")]
[JsonDerivedType(typeof(PitUpdate), "pit")]
[JsonDerivedType(typeof(SessionStatusUpdate), "session")]
[JsonDerivedType(typeof(SafetyCarUpdate), "safetycar")]
public abstract record TimingUpdate
{
    public DateTimeOffset Date { get; init; }
}

public record PositionUpdate(int DriverNumber, int Position) : TimingUpdate;

public record CarDataUpdate(
    int DriverNumber,
    int Speed,
    int Throttle,
    int Brake,
    int Gear,
    bool DrsOpen
) : TimingUpdate;

public record TimingDataUpdate(
    int DriverNumber,
    string? LastLapTime,
    string? GapToLeader,
    string? Interval,
    int CurrentLap
) : TimingUpdate;

public record PitUpdate(
    int DriverNumber,
    bool InPit,
    int PitStopCount,
    string? NewCompound
) : TimingUpdate;

public record SessionStatusUpdate(SessionStatus Status, int TotalLaps) : TimingUpdate;
public record SafetyCarUpdate(string Status) : TimingUpdate;
```

---

## Connection State Machine

The WebSocket service maintains an explicit state machine. This is the most important design decision in the infrastructure layer — without it, reconnect logic becomes a mess of boolean flags.

```
                    ┌─────────────────────────────────┐
                    │                                 │
              ┌─────▼──────┐                         │
   start ────►│Disconnected│                         │
              └─────┬──────┘                         │
                    │ ConnectAsync()                  │
              ┌─────▼──────┐                         │
              │ Connecting  │                         │
              └──┬──────┬──┘                         │
         success │      │ failure                    │
          ┌──────▼─┐  ┌─▼────────────┐              │
          │Connected│  │ Reconnecting  │◄─────────────┘
          └──┬──────┘  └──────┬───────┘  socket drops /
             │ socket          │          parse error
             │ drops           │ backoff elapsed
             └────────────────►┘
```

```csharp
// F1Pitwall.Core/Models/ConnectionState.cs
public enum ConnectionState
{
    Disconnected,
    Connecting,
    Connected,
    Reconnecting
}
```

---

## OpenF1WebSocketService (`F1Pitwall.Infrastructure`)

This is the most complex class in the system. It owns the WebSocket lifecycle, implements the reconnection state machine, and feeds raw messages into the channel.

```csharp
// F1Pitwall.Infrastructure/OpenF1/OpenF1WebSocketService.cs
public class OpenF1WebSocketService : BackgroundService
{
    private readonly Channel<string> _rawMessageChannel;
    private readonly OpenF1Options _options;
    private readonly ILogger<OpenF1WebSocketService> _logger;

    // Reconnection config
    private static readonly TimeSpan[] BackoffDelays =
    [
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(10),
        TimeSpan.FromSeconds(30)
    ];

    private ConnectionState _state = ConnectionState.Disconnected;
    private int _reconnectAttempts = 0;

    public OpenF1WebSocketService(
        Channel<string> rawMessageChannel,
        IOptions<OpenF1Options> options,
        ILogger<OpenF1WebSocketService> logger)
    {
        _rawMessageChannel = rawMessageChannel;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ConnectAndReceiveAsync(stoppingToken);
                // Clean exit — only happens on graceful shutdown
                break;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _state = ConnectionState.Reconnecting;
                _logger.LogWarning(ex, "WebSocket disconnected. Attempt {Attempt}", _reconnectAttempts);
                await ApplyBackoffAsync(stoppingToken);
            }
        }
    }

    private async Task ConnectAndReceiveAsync(CancellationToken ct)
    {
        using var ws = new ClientWebSocket();
        _state = ConnectionState.Connecting;

        await ws.ConnectAsync(new Uri(_options.WebSocketUrl), ct);
        _state = ConnectionState.Connected;
        _reconnectAttempts = 0;
        _logger.LogInformation("Connected to OpenF1 WebSocket");

        var buffer = new byte[64 * 1024]; // 64KB — OpenF1 messages are small
        var messageBuilder = new StringBuilder();

        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var result = await ws.ReceiveAsync(buffer, ct);

            if (result.MessageType == WebSocketMessageType.Close)
            {
                _logger.LogInformation("OpenF1 sent close frame");
                break;
            }

            messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

            if (result.EndOfMessage)
            {
                var raw = messageBuilder.ToString();
                messageBuilder.Clear();

                // Non-blocking write — if channel is full, drop oldest
                // (stale telemetry is worthless)
                if (!_rawMessageChannel.Writer.TryWrite(raw))
                    _logger.LogDebug("Channel full — dropping message");
            }
        }
    }

    private async Task ApplyBackoffAsync(CancellationToken ct)
    {
        var delay = BackoffDelays[Math.Min(_reconnectAttempts, BackoffDelays.Length - 1)];
        _reconnectAttempts++;
        _logger.LogInformation("Reconnecting in {Delay}s", delay.TotalSeconds);
        await Task.Delay(delay, ct);
    }
}
```

### Why `Channel<string>` not `Channel<TimingUpdate>`?

The WebSocket service doesn't parse — it just buffers raw strings. Parsing happens in the dispatcher. This separation means:
- The WebSocket receive loop is never blocked by parse errors
- You can unit test parsing independently from the socket
- If parsing throws, it doesn't kill the socket connection

---

## Channel Configuration (DI Setup)

```csharp
// F1Pitwall.Infrastructure/DependencyInjection.cs
public static class InfrastructureServiceExtensions
{
    public static IServiceCollection AddF1Infrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Bounded channel — if dispatcher falls behind, drop old messages
        // 512 is enough for ~8 minutes of backlog at 1msg/s
        services.AddSingleton(_ =>
            Channel.CreateBounded<string>(new BoundedChannelOptions(512)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = true   // only the WS service writes
            }));

        services.Configure<OpenF1Options>(configuration.GetSection("OpenF1"));

        services.AddHostedService<OpenF1WebSocketService>();
        services.AddHostedService<MessageDispatcherService>();

        return services;
    }
}
```

---

## MessageDispatcherService (`F1Pitwall.Infrastructure`)

Reads raw strings from the channel, parses them into typed `TimingUpdate` records, and passes them to `IRaceStateService`. Runs as a `BackgroundService` on the consumer side of the channel.

```csharp
// F1Pitwall.Infrastructure/OpenF1/MessageDispatcherService.cs
public class MessageDispatcherService : BackgroundService
{
    private readonly Channel<string> _rawMessageChannel;
    private readonly IRaceStateService _raceStateService;
    private readonly OpenF1MessageParser _parser;
    private readonly ILogger<MessageDispatcherService> _logger;

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

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // ReadAllAsync respects cancellation and drains on shutdown
        await foreach (var raw in _rawMessageChannel.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                var updates = _parser.Parse(raw);

                foreach (var update in updates)
                    await _raceStateService.ApplyUpdateAsync(update);
            }
            catch (JsonException ex)
            {
                // Log and continue — a bad message shouldn't stop the service
                _logger.LogWarning(ex, "Failed to parse message: {Raw}", raw[..Math.Min(100, raw.Length)]);
            }
        }
    }
}
```

---

## OpenF1MessageParser (`F1Pitwall.Infrastructure`)

OpenF1 WebSocket sends messages in batches — a single frame can contain multiple updates for different data types. The parser splits and maps them.

OpenF1 message shape (simplified):
```json
[
  "TimingData",
  {
    "Lines": {
      "1": { "Position": 1, "GapToLeader": "+0.000" },
      "44": { "Position": 2, "GapToLeader": "+3.241" }
    }
  },
  "2024-03-15T14:23:01.123Z"
]
```

```csharp
// F1Pitwall.Infrastructure/OpenF1/OpenF1MessageParser.cs
public class OpenF1MessageParser
{
    public IEnumerable<TimingUpdate> Parse(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;

        // OpenF1 sends either a single message array or an array of arrays
        // Detect by checking if first element is a string (type) or array
        if (root.ValueKind == JsonValueKind.Array &&
            root[0].ValueKind == JsonValueKind.String)
        {
            return ParseSingleMessage(root);
        }

        return root.EnumerateArray().SelectMany(ParseSingleMessage);
    }

    private IEnumerable<TimingUpdate> ParseSingleMessage(JsonElement msg)
    {
        var messageType = msg[0].GetString();
        var data = msg[1];
        var timestamp = msg.GetArrayLength() > 2
            ? DateTimeOffset.Parse(msg[2].GetString()!)
            : DateTimeOffset.UtcNow;

        return messageType switch
        {
            "Position.z" => ParsePositions(data, timestamp),
            "CarData.z" => ParseCarData(data, timestamp),
            "TimingData" => ParseTimingData(data, timestamp),
            "PitLaneTimeCollection" => ParsePitData(data, timestamp),
            "SessionStatus" => ParseSessionStatus(data, timestamp),
            "TrackStatus" => ParseTrackStatus(data, timestamp),
            _ => Enumerable.Empty<TimingUpdate>()
        };
    }

    private IEnumerable<TimingUpdate> ParsePositions(JsonElement data, DateTimeOffset ts)
    {
        // "Position.z" is base64-encoded zlib — decompress first
        var compressed = Convert.FromBase64String(data.GetString()!);
        var json = DecompressZlib(compressed);
        using var doc = JsonDocument.Parse(json);

        foreach (var entry in doc.RootElement.EnumerateArray())
        {
            var driverNum = entry.GetProperty("Entries")
                .EnumerateArray()
                .Select(e => new PositionUpdate(
                    DriverNumber: int.Parse(e.GetProperty("RacingNumber").GetString()!),
                    Position: e.GetProperty("Position").GetInt32()
                ) { Date = ts });

            foreach (var u in driverNum) yield return u;
        }
    }

    private static string DecompressZlib(byte[] data)
    {
        // OpenF1 uses raw deflate (zlib without header for some endpoints)
        using var input = new MemoryStream(data);
        using var deflate = new DeflateStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        deflate.CopyTo(output);
        return Encoding.UTF8.GetString(output.ToArray());
    }

    // ... ParseCarData, ParseTimingData, etc. follow same pattern
}
```

---

## RaceStateService (`F1Pitwall.Core`)

The heart of the system. Singleton. Accepts typed updates, applies them as partial patches to `DriverState` records, detects meaningful changes, and notifies SignalR clients.

Because `DriverState` is a C# record, "applying a patch" means constructing a new record with `with` expressions rather than mutating fields. This keeps the state immutable and makes diffing trivial.

```csharp
// F1Pitwall.Core/Services/RaceStateService.cs
public class RaceStateService : IRaceStateService
{
    private readonly IHubContext<TimingHub, ITimingClient> _hubContext;
    private readonly ILogger<RaceStateService> _logger;

    // ConcurrentDictionary because SignalR reads state from hub connection callbacks
    // which run on thread pool threads
    private readonly ConcurrentDictionary<int, DriverState> _drivers = new();
    private SessionStatus _sessionStatus = SessionStatus.Inactive;
    private string _safetyCarStatus = "None";

    public RaceStateService(
        IHubContext<TimingHub, ITimingClient> hubContext,
        ILogger<RaceStateService> logger)
    {
        _hubContext = hubContext;
        _logger = logger;
    }

    public async Task ApplyUpdateAsync(TimingUpdate update)
    {
        // Pattern match on the discriminated union
        // Compiler will warn if a new update type is added but not handled here
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
        }
    }

    private async Task ApplyPositionAsync(PositionUpdate update)
    {
        var existing = _drivers.GetOrAdd(update.DriverNumber, _ => new DriverState
        {
            DriverNumber = update.DriverNumber
        });

        // Only push update if position actually changed
        if (existing.Position == update.Position) return;

        var updated = existing with
        {
            Position = update.Position,
            LastUpdated = update.Date
        };

        _drivers[update.DriverNumber] = updated;

        await _hubContext.Clients.All.ReceiveDriverUpdate(new DriverUpdateDto(
            DriverNumber: update.DriverNumber,
            Position: update.Position,
            UpdateType: "position"
        ));
    }

    private async Task ApplyCarDataAsync(CarDataUpdate update)
    {
        if (!_drivers.TryGetValue(update.DriverNumber, out var existing)) return;

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

        // Car data updates are high frequency — batch or throttle before pushing
        // For MVP: push every update. Optimise later with a 100ms debounce.
        await _hubContext.Clients.All.ReceiveCarData(new CarDataDto(
            DriverNumber: update.DriverNumber,
            Speed: update.Speed,
            Throttle: update.Throttle,
            Brake: update.Brake,
            Gear: update.Gear,
            DrsOpen: update.DrsOpen
        ));
    }

    // Full state snapshot — sent to new clients on connect
    public RaceState GetCurrentState() => new()
    {
        Status = _sessionStatus,
        SafetyCarStatus = _safetyCarStatus,
        Drivers = _drivers.ToImmutableDictionary(),
        LastUpdated = DateTimeOffset.UtcNow
    };

    // ... ApplyTimingDataAsync, ApplyPitAsync, etc.
}
```

---

## TimingHub (`F1Pitwall.Api`)

Strongly typed SignalR hub. The `ITimingClient` interface defines exactly what the server can call on clients — prevents typos in method names and makes the contract explicit.

```csharp
// F1Pitwall.Api/Hubs/ITimingClient.cs
public interface ITimingClient
{
    Task ReceiveFullState(RaceStateDto state);
    Task ReceiveDriverUpdate(DriverUpdateDto update);
    Task ReceiveCarData(CarDataDto data);
    Task ReceiveSessionStatus(SessionStatusDto status);
    Task ReceiveSafetyCarStatus(SafetyCarDto status);
}
```

```csharp
// F1Pitwall.Api/Hubs/TimingHub.cs
public class TimingHub : Hub<ITimingClient>
{
    private readonly IRaceStateService _raceStateService;

    public TimingHub(IRaceStateService raceStateService)
    {
        _raceStateService = raceStateService;
    }

    // Called when a new client connects
    // Send full current state so the UI doesn't start blank
    public override async Task OnConnectedAsync()
    {
        var state = _raceStateService.GetCurrentState();
        await Clients.Caller.ReceiveFullState(state.ToDto());
        await base.OnConnectedAsync();
    }
}
```

```csharp
// F1Pitwall.Api/Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(30);
});

builder.Services.AddSingleton<IRaceStateService, RaceStateService>();
builder.Services.AddF1Infrastructure(builder.Configuration);

builder.Services.AddCors(o => o.AddPolicy("F1Web", p =>
    p.WithOrigins("http://localhost:5173")  // Vite dev server
     .AllowAnyHeader()
     .AllowAnyMethod()
     .AllowCredentials()));  // Required for SignalR

var app = builder.Build();

app.UseCors("F1Web");
app.MapHub<TimingHub>("/hubs/timing");

app.Run();
```

---

## React Frontend (`F1Pitwall.Web`)

### SignalR Hook

```typescript
// src/hooks/useTimingHub.ts
import * as signalR from '@microsoft/signalr';
import { useEffect, useRef } from 'react';
import { useRaceStore } from '../store/raceStore';

export function useTimingHub() {
  const connectionRef = useRef<signalR.HubConnection | null>(null);
  const { applyFullState, applyDriverUpdate, applyCarData } = useRaceStore();

  useEffect(() => {
    const connection = new signalR.HubConnectionBuilder()
      .withUrl('http://localhost:5000/hubs/timing')
      .withAutomaticReconnect({
        // Match the server-side backoff
        nextRetryDelayInMilliseconds: (ctx) => {
          const delays = [1000, 2000, 5000, 10000, 30000];
          return delays[Math.min(ctx.previousRetryCount, delays.length - 1)];
        }
      })
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connection.on('ReceiveFullState', applyFullState);
    connection.on('ReceiveDriverUpdate', applyDriverUpdate);
    connection.on('ReceiveCarData', applyCarData);

    connection.onreconnecting(() => console.info('Reconnecting...'));
    connection.onreconnected(() => console.info('Reconnected'));

    connection.start().catch(console.error);
    connectionRef.current = connection;

    return () => { connection.stop(); };
  }, []);

  return connectionRef;
}
```

### State Store (Zustand)

```typescript
// src/store/raceStore.ts
import { create } from 'zustand';

interface RaceStore {
  drivers: Record<number, DriverState>;
  sessionStatus: string;
  safetyCarStatus: string;
  applyFullState: (state: RaceStateDto) => void;
  applyDriverUpdate: (update: DriverUpdateDto) => void;
  applyCarData: (data: CarDataDto) => void;
}

export const useRaceStore = create<RaceStore>((set) => ({
  drivers: {},
  sessionStatus: 'Inactive',
  safetyCarStatus: 'None',

  applyFullState: (state) => set({
    drivers: state.drivers.reduce((acc, d) => ({ ...acc, [d.driverNumber]: d }), {}),
    sessionStatus: state.status,
    safetyCarStatus: state.safetyCarStatus,
  }),

  applyDriverUpdate: (update) => set((state) => ({
    drivers: {
      ...state.drivers,
      [update.driverNumber]: {
        ...state.drivers[update.driverNumber],
        position: update.position,
      }
    }
  })),

  applyCarData: (data) => set((state) => ({
    drivers: {
      ...state.drivers,
      [data.driverNumber]: {
        ...state.drivers[data.driverNumber],
        speed: data.speed,
        throttle: data.throttle,
        brake: data.brake,
        gear: data.gear,
        drsOpen: data.drsOpen,
      }
    }
  })),
}));
```

---

## Configuration

```json
// appsettings.json
{
  "OpenF1": {
    "WebSocketUrl": "wss://api.openf1.org/v1/live",
    "RestBaseUrl": "https://api.openf1.org/v1",
    "MaxReconnectAttempts": 10
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "F1Pitwall.Infrastructure.OpenF1.OpenF1WebSocketService": "Debug"
    }
  }
}
```

```csharp
// F1Pitwall.Infrastructure/OpenF1/OpenF1Options.cs
public class OpenF1Options
{
    public string WebSocketUrl { get; set; } = string.Empty;
    public string RestBaseUrl { get; set; } = string.Empty;
    public int MaxReconnectAttempts { get; set; } = 10;
}
```

---

## Historical Session Fallback (REST)

Outside of race weekends, the WebSocket has no data. Add a REST client that loads historical session data into the same `RaceStateService` pipeline so the demo works anytime.

```csharp
// F1Pitwall.Infrastructure/OpenF1/OpenF1RestClient.cs
public class OpenF1RestClient : IOpenF1Client
{
    private readonly HttpClient _http;

    public OpenF1RestClient(HttpClient http)
    {
        _http = http;
    }

    public async Task<IEnumerable<DriverState>> GetDriversForSessionAsync(
        int sessionKey,
        CancellationToken ct = default)
    {
        var response = await _http.GetFromJsonAsync<List<OpenF1DriverDto>>(
            $"/v1/drivers?session_key={sessionKey}", ct);

        return response?.Select(d => new DriverState
        {
            DriverNumber = d.DriverNumber,
            Abbreviation = d.NameAcronym,
            TeamColour = d.TeamColour ?? "#FFFFFF"
        }) ?? Enumerable.Empty<DriverState>();
    }
}
```

Register via `IHttpClientFactory` with Polly retry:

```csharp
services.AddHttpClient<OpenF1RestClient>(client =>
{
    client.BaseAddress = new Uri(options.RestBaseUrl);
    client.DefaultRequestHeaders.Add("Accept", "application/json");
})
.AddTransientHttpErrorPolicy(p =>
    p.WaitAndRetryAsync(3, attempt => TimeSpan.FromSeconds(Math.Pow(2, attempt))));
```

---

## Key Engineering Decisions (Interview Talking Points)

**1. Why `Channel<T>` instead of a queue or event?**
`Channel<T>` is backpressure-aware. The WebSocket receive loop should never block waiting for the state service to catch up — using `DropOldest` on a bounded channel means we automatically shed stale telemetry under load rather than accumulating unbounded memory.

**2. Why a discriminated union for `TimingUpdate`?**
OpenF1 sends many message types. Using a sealed hierarchy with `switch` pattern matching means adding a new message type forces you to handle it everywhere — the compiler enforces exhaustive handling. No forgotten cases that silently do nothing.

**3. Why immutable records for `DriverState`?**
`RaceStateService` is a singleton accessed from multiple thread-pool threads (SignalR connection handlers, the dispatcher). Immutable state means reads are always safe without locks. `with` expressions make applying partial updates readable.

**4. Why strongly-typed SignalR hub (`Hub<ITimingClient>`)?**
The `ITimingClient` interface is the contract between server and all connected browser clients. A typo in a method name causes a silent client-side failure with a generic hub — with a typed hub, the compiler catches it at build time.

**5. What happens on reconnect?**
`OnConnectedAsync` sends a full state snapshot to the newly connected client before any incremental updates arrive. This prevents a blank UI during the reconnect window. The exponential backoff on both the WebSocket service and the SignalR JS client ensures reconnect attempts don't flood the server.

**6. Why separate `BackgroundService` for dispatching instead of parsing on the WS thread?**
Parsing can throw. A `JsonException` on the WebSocket receive loop would crash the connection. Isolating parsing in the dispatcher means a bad message just logs a warning and the socket stays open.

---

## Deployment

**Option A — Railway (fastest):**
Railway supports .NET out of the box. Push to GitHub, connect repo, set environment variables for `OpenF1__WebSocketUrl`. Frontend deploys as a static Vite build via a second Railway service or Vercel.

**Option B — Azure (most CV-relevant for .NET roles):**
- Backend: Azure App Service (Free F1 tier works for demos)
- SignalR: Azure SignalR Service (swap `AddSignalR()` for `AddAzureSignalR()` — one line change)
- Frontend: Azure Static Web Apps (free, auto-deploys from GitHub Actions)

Azure SignalR Service is worth adding even for a demo project — it demonstrates you know the production scaling pattern (.NET backends don't manage WebSocket connections directly; they offload to the Azure service).

---

## Two-Week Build Plan

| Days | Deliverable |
|------|-------------|
| 1–2 | Project scaffold, DI wiring, OpenF1 WebSocket connects and logs raw messages |
| 3–4 | Message parser, all update types mapped to typed records |
| 5–6 | RaceStateService, state reconciliation, unit tests for merge logic |
| 7–8 | SignalR hub, full state on connect, incremental diffs on update |
| 9–10 | React frontend, Zustand store, timing tower UI |
| 11–12 | Historical REST fallback, demo data for non-race weekends |
| 13–14 | Deploy to Railway/Azure, README with architecture diagram, polish |
