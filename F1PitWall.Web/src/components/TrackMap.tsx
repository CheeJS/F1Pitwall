import { useMemo } from 'react';

export interface DriverMarker {
  driverNumber: number;
  abbreviation: string;
  teamColour: string;
  x: number;
  y: number;
  position: number;
}

interface Props {
  markers: DriverMarker[];
  highlighted: number | null;
  onSelectDriver: (n: number | null) => void;
  // Raw location data to build the track outline, already normalised to SVG space
  trackPoints?: { x: number; y: number }[];
}

// Default Silverstone-like fallback track when no data available
const FALLBACK_TRACK: { x: number; y: number }[] = (() => {
  const pts: { x: number; y: number }[] = [];
  // Rough oval shape
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

export function TrackMap({ markers, highlighted, onSelectDriver, trackPoints }: Props) {
  const track = trackPoints && trackPoints.length > 10 ? trackPoints : FALLBACK_TRACK;

  // Normalise track to 0-800 × 0-600 viewBox
  const normalisedTrack = useMemo(() => {
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
    // Flip y: GPS has y increasing upward; SVG has y increasing downward
    return track.map(p => ({
      x: offX + (p.x - minX) * scale,
      y: offY + (maxY - p.y) * scale,
    }));
  }, [track]);

  // Normalise marker positions against the same track bounds
  const normMarkers = useMemo(() => {
    if (!markers.length) return [];
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
    // Flip y consistently with the track normalisation above
    return markers.map(m => ({
      ...m,
      nx: offX + (m.x - minX) * scale,
      ny: offY + (maxY - m.y) * scale,
    }));
  }, [markers, track]);

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

        {/* Track outline — outer */}
        <path
          d={trackPath}
          fill="none"
          stroke="var(--track-outer)"
          strokeWidth="18"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Track surface */}
        <path
          d={trackPath}
          fill="none"
          stroke="var(--track-surface)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Centre line */}
        <path
          d={trackPath}
          fill="none"
          stroke="var(--track-line)"
          strokeWidth="0.75"
          strokeDasharray="8 8"
          strokeLinecap="round"
          opacity="0.4"
        />

        {/* Sector marks — equally spaced on path */}
        {[0.33, 0.66].map((frac, i) => {
          const idx = Math.floor(normalisedTrack.length * frac);
          const pt = normalisedTrack[idx];
          if (!pt) return null;
          return (
            <circle
              key={i}
              cx={pt.x}
              cy={pt.y}
              r={5}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth="1.5"
              opacity="0.5"
            />
          );
        })}

        {/* Driver markers */}
        {normMarkers.map(m => {
          const isHL = highlighted === m.driverNumber;
          const colour = `#${m.teamColour}`;
          return (
            <g
              key={m.driverNumber}
              className={`track-marker${isHL ? ' highlighted' : ''}`}
              transform={`translate(${m.nx},${m.ny})`}
              onClick={() => onSelectDriver(isHL ? null : m.driverNumber)}
              style={{ cursor: 'pointer' }}
              filter={isHL ? 'url(#glow)' : undefined}
            >
              {/* Halo ring for highlighted driver */}
              {isHL && (
                <circle r={14} fill="none" stroke={colour} strokeWidth="1.5" opacity="0.6" />
              )}
              <circle r={9} fill={colour} opacity={isHL ? 1 : 0.85} />
              {/* Position number */}
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={m.position < 10 ? 7 : 6}
                fontWeight="700"
                fontFamily="var(--mono)"
                fill="#000"
              >
                {m.position}
              </text>
              {/* Abbreviation label above — only for highlighted */}
              {isHL && (
                <text
                  y={-18}
                  textAnchor="middle"
                  fontSize="8"
                  fontWeight="600"
                  fontFamily="var(--font)"
                  fill={colour}
                  stroke="var(--bg)"
                  strokeWidth="3"
                  paintOrder="stroke"
                >
                  {m.abbreviation}
                </text>
              )}
            </g>
          );
        })}

        {/* Empty state */}
        {normMarkers.length === 0 && (
          <text x="400" y="300" textAnchor="middle" fill="var(--text-muted)" fontSize="13" fontFamily="var(--font)">
            No position data
          </text>
        )}
      </svg>
    </div>
  );
}
