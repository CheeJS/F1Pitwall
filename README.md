# F1 PitWall

A real-time Formula 1 timing and telemetry dashboard. The backend streams live data from the OpenF1 WebSocket API, processes it through a clean-architecture .NET service, and pushes updates to a React frontend over SignalR. A race-replay mode lets you scrub through any historical session with a continuous multi-channel telemetry chart.

---

## Architecture

```
F1Pitwall.Core            Domain layer  (no external dependencies)
F1Pitwall.Infrastructure  OpenF1 WebSocket, REST client, SignalR notifications
F1PitWall.Api             ASP.NET Core host  (SignalR hub, REST controllers)
F1PitWall.Web             React + TypeScript frontend  (Vite)
```

### Data flow

```
OpenF1 WebSocket (live)
    --> OpenF1WebSocketService  (reconnect backoff: 1s / 2s / 5s / 10s / 30s)
    --> Channel<string>         (bounded 512, drop-oldest)
    --> MessageDispatcherService  (parses JSON, decompresses .z frames)
    --> RaceStateService        (merges into ConcurrentDictionary<int, DriverState>)
    --> SignalR TimingHub       (full state on connect, incremental updates)
    --> React frontend
```

The race-replay path fetches historical data directly from `api.openf1.org/v1` (or an optional CDN cache) without touching the backend.

---

## Project structure

```
F1PitWall/
  Controllers/
    MeetingsController.cs
    RaceStateController.cs
    SessionsController.cs
  Hubs/
    ITimingClient.cs
    TimingHub.cs
  Program.cs
  appsettings.json

F1Pitwall.Core/
  Interfaces/
    INotificationService.cs
    IOpenF1Client.cs
    IRaceStateService.cs
  Models/               (DriverState, RaceState, TimingUpdate, etc.)
  Services/
    RaceStateService.cs

F1Pitwall.Infrastructure/
  OpenF1/
    OpenF1WebSocketService.cs
    OpenF1MessageParser.cs
    OpenF1RestClient.cs
    MessageDispatcherService.cs
    OpenF1Options.cs
  SignalR/
    SignalRNotificationService.cs
    SignalRDtos.cs
  DependencyInjection.cs

F1PitWall.Web/          React + TypeScript (Vite)
  src/
    api/                openf1Direct.ts  (CDN-first fetch helpers)
    components/
      RaceReplay.tsx    Replay mode with telemetry charts
      TimingTower.tsx

scripts/
  cache-openf1.mjs     CDN pre-warming script (AWS S3 / CloudFront)
```

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| .NET SDK | 10.0 |
| Node.js | 20 LTS |
| npm | 10 |

---

## Getting started

### 1. Backend

```bash
cd F1PitWall
dotnet run --project F1PitWall
```

The API starts on `https://localhost:7xxx` (port shown in terminal). SignalR hub is at `/hubs/timing`.

#### Configuration (`F1PitWall/appsettings.json`)

```json
{
  "OpenF1": {
    "WebSocketUrl": "wss://api.openf1.org/v1/live",
    "RestBaseUrl": "https://api.openf1.org/v1",
    "MaxReconnectAttempts": 10
  }
}
```

Override in `appsettings.Development.json` or via environment variables (prefix `OpenF1__`).

### 2. Frontend

```bash
cd F1PitWall.Web
npm install
npm run dev
```

Opens on `http://localhost:5173`.

Optional environment variables (`.env.local`):

```
VITE_API_BASE=https://localhost:7xxx
VITE_OF1_CDN_BASE=https://your-cloudfront-domain.net
```

`VITE_OF1_CDN_BASE` enables CDN-first fetching for historical session data. Leave unset to use the live OpenF1 API directly.

### 3. Build for production

```bash
# Backend
dotnet publish F1PitWall -c Release -o publish/

# Frontend
cd F1PitWall.Web
npm run build
# Output: F1PitWall.Web/dist/
```

---

## Race replay

The replay mode fetches all session data from OpenF1 (drivers, laps, intervals, stints, pit stops, car telemetry, race control messages). Telemetry is loaded on demand per driver to stay within API rate limits.

- Select a year and session from the top bar.
- Use the driver chips to overlay up to five telemetry charts simultaneously.
- Each chart shows Speed, Throttle, Brake, RPM, and Gear as continuous SVG polylines across the full race duration, with lap ticks, stint-compound bands, pit windows, and flag events overlaid.
- Click anywhere on a chart to seek the playhead. Use the bottom transport bar to play/pause and change speed (1x, 4x, 8x, 16x, 32x).
- The left timing tower updates in real time as the playhead advances.

---

## CDN cache script

`scripts/cache-openf1.mjs` pre-fetches a full season of session data and uploads it to S3 so the frontend can omit round-trips to the live API.

```bash
cd scripts
npm install
node cache-openf1.mjs --year 2024
```

Requires `AWS_PROFILE` or standard AWS environment variables and an S3 bucket name set in the script.

---

## License

MIT
