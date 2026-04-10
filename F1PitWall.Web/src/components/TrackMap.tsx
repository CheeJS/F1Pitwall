import { useMemo } from 'react';

function needsDarkText(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

export interface DriverMarker {
  driverNumber: number;
  abbreviation: string;
  teamColour: string;
  x: number;
  y: number;
  position: number;
}

export interface CircuitEnrichment {
  corners: Array<{ number: number; letter?: string; x: number; y: number }>;
}

interface Props {
  markers: DriverMarker[];
  highlighted: number | null;
  onSelectDriver: (n: number | null) => void;
  trackPoints?: { x: number; y: number }[];
  circuitInfo?: CircuitEnrichment;
}

const FALLBACK_TRACK: { x: number; y: number }[] = (() => {
  const pts: { x: number; y: number }[] = [];
  const cx = 400, cy = 300;
  for (let i = 0; i <= 100; i++) {
    const t = (i / 100) * Math.PI * 2;
    pts.push({
      x: cx + Math.cos(t) * 260 + Math.cos(t * 3) * 40,
      y: cy + Math.sin(t) * 180 + Math.sin(t * 2) * 30,
    });
  }
  return pts;
})();

function buildPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  const [first, ...rest] = pts;
  return `M${first.x},${first.y} ` + rest.map(p => `L${p.x},${p.y}`).join(' ') + ' Z';
}

/** Returns a function that converts raw GPS coords → SVG { nx, ny } using track bounds */
function computeNorm(track: { x: number; y: number }[]) {
  const xs = track.map(p => p.x);
  const ys = track.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 40;
  const scaleX = (800 - pad * 2) / (maxX - minX || 1);
  const scaleY = (600 - pad * 2) / (maxY - minY || 1);
  const scale = Math.min(scaleX, scaleY);
  const offX = pad + ((800 - pad * 2) - (maxX - minX) * scale) / 2;
  const offY = pad + ((600 - pad * 2) - (maxY - minY) * scale) / 2;
  return {
    toSvg: (x: number, y: number) => ({
      nx: offX + (x - minX) * scale,
      ny: offY + (maxY - y) * scale,  // flip Y: GPS increases upward, SVG downward
    }),
  };
}

export function TrackMap({ markers, highlighted, onSelectDriver, trackPoints, circuitInfo }: Props) {
  const hasCircuit = trackPoints && trackPoints.length > 10;
  const track = hasCircuit ? trackPoints! : FALLBACK_TRACK;

  const norm = useMemo(() => computeNorm(track), [track]);

  // Track path points need { x, y } for buildPath
  const normalisedTrack = useMemo(
    () => track.map(p => { const { nx: x, ny: y } = norm.toSvg(p.x, p.y); return { x, y }; }),
    [track, norm],
  );

  // Centroid of the track in SVG space — used to push corner labels outward
  const centroid = useMemo(() => {
    if (!normalisedTrack.length) return { x: 400, y: 300 };
    return {
      x: normalisedTrack.reduce((s, p) => s + p.x, 0) / normalisedTrack.length,
      y: normalisedTrack.reduce((s, p) => s + p.y, 0) / normalisedTrack.length,
    };
  }, [normalisedTrack]);

  // Markers: use track bounds when we have a real circuit; otherwise use markers' own bounds
  const normForMarkers = useMemo(
    () => (hasCircuit ? norm : computeNorm(markers.length ? markers : FALLBACK_TRACK)),
    [hasCircuit, norm, markers],
  );
  const normMarkers = useMemo(
    () => markers.map(m => ({ ...m, ...normForMarkers.toSvg(m.x, m.y) })),
    [markers, normForMarkers],
  );

  // Corner labels: projected outward from the track centroid so they sit outside the track edge
  const normCorners = useMemo(() => {
    const OFFSET = 22; // px in SVG space — enough to clear the 18px track stroke
    return (circuitInfo?.corners ?? []).map(c => {
      const { nx, ny } = norm.toSvg(c.x, c.y);
      const dx = nx - centroid.x;
      const dy = ny - centroid.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      return {
        ...c,
        trackX: nx, trackY: ny,           // point on the track
        labelX: nx + ux * OFFSET,         // offset label
        labelY: ny + uy * OFFSET,
      };
    });
  }, [circuitInfo, norm, centroid]);

  const trackPath = useMemo(() => buildPath(normalisedTrack), [normalisedTrack]);

  return (
    <div className="track-map-wrap">
      <svg
        className="track-map-svg"
        viewBox="0 0 800 600"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Track map"
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Track layers ─────────────────────────────────── */}
        <path d={trackPath} fill="none" stroke="var(--track-outer)"   strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
        <path d={trackPath} fill="none" stroke="var(--track-surface)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
        <path d={trackPath} fill="none" stroke="var(--track-line)"    strokeWidth="0.75" strokeDasharray="8 8" strokeLinecap="round" opacity="0.4" />

        {/* ── Corner numbers — offset outward from track centre ── */}
        {normCorners.map(c => (
          <g key={`c-${c.number}`}>
            {/* Connector: track surface → label */}
            <line
              x1={c.trackX} y1={c.trackY}
              x2={c.labelX} y2={c.labelY}
              stroke="var(--text-muted)"
              strokeWidth={0.8}
              opacity={0.35}
            />
            {/* Label circle */}
            <g transform={`translate(${c.labelX},${c.labelY})`}>
              <circle r={7.5} fill="var(--bg)" opacity={0.82} />
              <circle r={7.5} fill="none" stroke="var(--text-muted)" strokeWidth={0.75} opacity={0.4} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={c.number >= 10 ? 5.5 : 6.5}
                fontWeight="700"
                fontFamily="var(--mono)"
                fill="var(--text-secondary)"
                opacity={0.9}
              >
                {c.number}{c.letter ?? ''}
              </text>
            </g>
          </g>
        ))}

        {/* ── Driver markers ────────────────────────────────── */}
        {normMarkers.map(m => {
          const isHL = highlighted === m.driverNumber;
          const colour = `#${m.teamColour}`;
          const textFill = needsDarkText(m.teamColour) ? '#0a0005' : '#ffffff';
          return (
            <g
              key={m.driverNumber}
              className={`track-marker${isHL ? ' highlighted' : ''}`}
              style={{
                transform: `translate(${m.nx}px, ${m.ny}px)`,
                transition: 'transform 240ms linear',
                cursor: 'pointer',
              }}
              onClick={() => onSelectDriver(isHL ? null : m.driverNumber)}
              filter={isHL ? 'url(#glow)' : undefined}
            >
              {isHL && (
                <circle r={19} fill="none" stroke={colour} strokeWidth="1.5" opacity="0.4" />
              )}
              <circle r={13} fill={colour} opacity={isHL ? 1 : 0.88} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={7}
                fontWeight="800"
                fontFamily="var(--font)"
                fill={textFill}
                letterSpacing="0.01em"
              >
                {m.abbreviation}
              </text>
              {isHL && (
                <text
                  y={-22}
                  textAnchor="middle"
                  fontSize="8"
                  fontWeight="600"
                  fontFamily="var(--font)"
                  fill={colour}
                  stroke="var(--bg)"
                  strokeWidth="3"
                  paintOrder="stroke"
                >
                  P{m.position}
                </text>
              )}
            </g>
          );
        })}

        {normMarkers.length === 0 && (
          <text x="400" y="300" textAnchor="middle" fill="var(--text-muted)" fontSize="13" fontFamily="var(--font)">
            No position data
          </text>
        )}
      </svg>
    </div>
  );
}
