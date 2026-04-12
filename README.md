# F1 PitWall

A Formula 1 timing and telemetry dashboard with a race-replay engine and optional live-timing mode. The frontend fetches historical session data directly from the OpenF1 API and renders a fully scrubable replay with a timing tower, track map, and multi-driver telemetry charts. A .NET backend can be added for live SignalR updates during an active race weekend.

---

## Architecture

```
F1Pitwall.Core            Domain layer (no external dependencies)
F1Pitwall.Infrastructure  OpenF1 WebSocket, REST client, SignalR notifications
F1PitWall                 ASP.NET Core host (SignalR hub, REST controllers)
F1PitWall.Web             React + TypeScript frontend (Vite)
scripts/                  CDN pre-warming utility
```

### Replay data flow

```
OpenF1 REST API  (api.openf1.org/v1  or optional CDN cache)
    --> openf1Direct.ts     fetch helpers with CDN-first fallback
    --> useReplayEngine.ts  indexes all data into sorted arrays
    --> towerRows / driverMarkers / weatherIdx  (pure useMemo)
    --> ReplayDashboard     orchestrates all child panels
```

### Live data flow (requires backend)

```
OpenF1 WebSocket (live)
    --> OpenF1WebSocketService  (reconnect backoff: 1s / 2s / 5s / 10s / 30s)
    --> Channel<string>         (bounded 512, drop-oldest)
    --> MessageDispatcherService
    --> RaceStateService
    --> SignalR TimingHub
    --> React frontend (useRaceConnection.ts)
```

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
  Models/
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

F1PitWall.Web/                React + TypeScript (Vite)
  src/
    api/
      openf1Direct.ts         CDN-first fetch helpers and OpenF1 type definitions
      openf1Api.ts            Live API helpers (SignalR path)
    components/
      ReplayDashboard.tsx     Root replay layout; owns panel arrangement
      RaceReplay.tsx          Timing tower, transport bar, telemetry charts
      AnalysisPanel.tsx       Collapsible strategy strip + live events feed
      SessionBrowser.tsx      Year / meeting / session picker (auto-collapses on select)
      TrackMap.tsx            SVG track map with live driver markers
      SpeedTrace.tsx          Per-driver speed/throttle/brake/RPM/gear charts
      DataExplorer.tsx        Raw data table for debugging sessions
      PopupTower.tsx          Detachable timing-tower popup window
      PopupMap.tsx            Detachable track-map popup window
      PopupTelemetry.tsx      Detachable telemetry popup window
      StatusBar.tsx           Connection and session status strip
      Header.tsx              Top navigation bar
      TimingTower.tsx         Live timing tower (SignalR mode)
      ChartPrimitives.tsx     Shared SVG chart helpers (LineChart, SpeedTrace SVG)
      DriverPanel.tsx         Driver chip selector
    hooks/
      useReplayEngine.ts      Core replay state machine and index computation
      useReplayBroadcast.ts   BroadcastChannel sync for popup windows
      useHistoricalData.ts    Fetches and caches all OpenF1 endpoints for a session
      useRaceConnection.ts    SignalR connection management

scripts/
  cache-openf1.mjs           Pre-fetches a full season and uploads to S3
```

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| .NET SDK | 10.0 |
| Node.js | 20 LTS |
| npm | 10 |

The .NET backend is only required for live timing mode. Replay mode runs with the frontend alone.

---

## Getting started

### Frontend (replay mode, no backend required)

```bash
cd F1PitWall.Web
npm install
npm run dev
```

Opens on `http://localhost:5173`. Select a year and session from the top bar to load a replay.

Optional environment variables (`.env.local`, copy from `.env.local.example`):

```
VITE_API_BASE=https://localhost:7xxx
VITE_OF1_CDN_BASE=https://your-cloudfront-domain.net
```

`VITE_OF1_CDN_BASE` enables CDN-first fetching. Leave unset to hit the OpenF1 API directly.

### Backend (live timing mode)

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

### Build for production

```bash
# Backend
dotnet publish F1PitWall -c Release -o publish/

# Frontend
cd F1PitWall.Web
npm run build
# Output: F1PitWall.Web/dist/
```

---

## Replay features

- Browse sessions by year, meeting, and session type (Race, Qualifying, Sprint, etc.); sidebar auto-collapses on selection
- Scrub playhead to any point in the session; play at 1×, 4×, 8×, 16×, or 32× speed
- Timing tower updates in real time: position, gaps, intervals, tyre compound + age, pit stop count, lap times, and sector times (S1/S2/S3)
- Qualifying mode shows Q1/Q2/Q3 segment times with correct elimination grouping
- Track map shows driver positions interpolated from lap timing data with per-driver colour coding
- Telemetry charts overlay speed, throttle, brake, RPM, and gear for up to 2 drivers simultaneously with stint-compound bands and race control flag events; driver comparison via chip selector
- Weather display (air temp, track temp, humidity, wind, rain flag) interpolated live from the playhead position
- Race control messages overlaid on the track map, time-filtered to the current playhead
- **Strategy strip** (collapsible) — CSS Gantt chart of tyre stints per driver, fills lap-by-lap as the session progresses
- **Live events feed** (collapsible) — chronological log of pit stops and overtakes up to the current playhead, newest first with lap number and duration/position
- Popup windows for the timing tower, track map, and telemetry open in separate browser windows and stay in sync via BroadcastChannel

---

## CDN cache script

`scripts/cache-openf1.mjs` pre-fetches a full season of session data and uploads it to S3 so the frontend bypasses the live OpenF1 API.

```bash
cd scripts
npm install
node cache-openf1.mjs --year 2024
```

Requires `AWS_PROFILE` or standard AWS environment variables and an S3 bucket name configured in the script.

---

## License

MIT
