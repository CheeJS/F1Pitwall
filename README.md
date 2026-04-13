# F1 PitWall

Real-time Formula 1 race dashboard. Live telemetry, session replay, historical results, and championship standings — modelled on the F1 broadcast timing screen.

**Live demo:** https://f1pitwall.pages.dev

---

## Features

**Live mode** — connects automatically when a race weekend is active
- Real-time timing tower with sector times, gaps, tyre compounds, and pit status
- Driver telemetry: throttle, brake, speed, gear, DRS
- Track map with live driver positions
- Race control messages and safety car status
- Championship standings (drivers and constructors)

**Replay mode** — scrub through any historical session
- Time-controlled playback at 1x to 32x speed
- Timing tower rebuilt from historical data and updated as the playhead moves
- Driver positions animated along the circuit layout
- Tyre stint strategy strip, team radio clips, pit stop log, overtake log
- Popup windows for tower, map, and telemetry that stay in sync via BroadcastChannel

**History browser**
- Browse all sessions by year
- Final classification with lap counts and best lap times

---

## Architecture

```
OpenF1 WebSocket (live)
        |
        v
  ASP.NET Core backend  <--  SignalR  -->  React frontend
  Fly.io                                   Cloudflare Pages
        |
        v
  OpenF1 REST API  <----------------------  React frontend
```

**Frontend** — React 18, TypeScript, Vite. D3 for charts. SignalR for live race state. MQTT (lazy-loaded) for raw telemetry. Deployed to Cloudflare Pages; auto-deploys on every push to `main`.

**Backend** — ASP.NET Core (.NET 10). Maintains live race state from OpenF1's WebSocket and broadcasts updates to all connected clients via SignalR. Auto-stops on Fly.io between race weekends.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Real-time | SignalR, MQTT over WebSocket |
| Charts | D3.js |
| Backend | ASP.NET Core (.NET 10), C# |
| Frontend hosting | Cloudflare Pages |
| Backend hosting | Fly.io (auto-stop/start) |
| Data source | OpenF1 API |
| CI/CD | GitHub Actions |

---

## Local development

### Prerequisites

- Node.js 20+
- .NET 10 SDK

### Backend

```bash
cd F1PitWall
dotnet run
# Starts on http://localhost:5000
```

For live MQTT data, add OpenF1 credentials to `F1PitWall/appsettings.Development.json`:

```json
{
  "OpenF1": {
    "Username": "your@email.com",
    "Password": "yourpassword"
  }
}
```

### Frontend

```bash
cd F1PitWall.Web
npm install
npm run dev
# Starts on http://localhost:5173
```

To test live mode against a historical session without credentials, create `F1PitWall.Web/.env.local`:

```
VITE_LIVE_TEST_SESSION_KEY=9158
VITE_LIVE_TEST_SPEED=8
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend URL (e.g. `https://f1pitwall-api.fly.dev`) |
| `VITE_OF1_CDN_BASE` | Optional S3/CloudFront URL for cached OpenF1 data |
| `VITE_LIVE_TEST_SESSION_KEY` | Session key to use for local live-mode testing |
| `VITE_LIVE_TEST_SPEED` | Playback speed multiplier for test mode (default: 1) |

---

## Deployment

### Backend (Fly.io)

```bash
flyctl deploy --remote-only
```

Required secrets:

```bash
flyctl secrets set ALLOWED_ORIGINS=https://your-site.pages.dev
flyctl secrets set OpenF1__Username=your@email.com
flyctl secrets set OpenF1__Password=yourpassword
```

The `deploy-backend` GitHub Actions workflow redeploys automatically on every push to `main` that touches backend files.

### Frontend (Cloudflare Pages)

Connected to this repository via GitHub. Build settings:

| Setting | Value |
|---------|-------|
| Root directory | `F1PitWall.Web` |
| Build command | `npm ci && npm run build` |
| Output directory | `dist` |
| `VITE_API_URL` | `https://f1pitwall-api.fly.dev` |

---

## Data

All race data is sourced from [OpenF1](https://openf1.org), a free and open Formula 1 data API providing live and historical telemetry, timing, position, and radio data.

Championship standings are derived from `session_result` points when the dedicated championship endpoint is not yet populated for the current season.

---

## License

MIT
