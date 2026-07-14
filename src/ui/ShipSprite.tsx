// ===== 船只 SVG（扁平风，中性姿态朝北，朝向由容器 rotate）=====
import type { ShipKind } from '../engine/types';

export function ShipSprite({ kind }: { kind: ShipKind | 'player' }) {
  if (kind === 'player') {
    return (
      <svg viewBox="0 0 100 100" className="ship-svg">
        <polygon points="50,6 74,34 69,90 31,90 26,34" fill="var(--ship-player)" />
        <polygon
          points="50,6 74,34 69,90 31,90 26,34"
          fill="var(--ship-player-deck)"
          transform="translate(14,14) scale(0.72)"
        />
        <polygon points="50,14 70,52 30,52" fill="#ffffff" stroke="var(--ship-player)" strokeWidth="2" />
        <polygon points="50,50 63,74 37,74" fill="#eef6ff" stroke="var(--ship-player)" strokeWidth="1.5" />
        <circle cx="26" cy="52" r="4" fill="var(--ship-player-deck)" />
        <circle cx="74" cy="52" r="4" fill="var(--ship-player-deck)" />
      </svg>
    );
  }
  if (kind === 'fastPirate') {
    return (
      <svg viewBox="0 0 100 100" className="ship-svg">
        <g transform="translate(10,0) scale(0.8,1)">
          <polygon points="50,4 72,32 67,92 33,92 28,32" fill="var(--ship-fast)" />
          <polygon
            points="50,4 72,32 67,92 33,92 28,32"
            fill="var(--ship-fast-deck)"
            transform="translate(14,14) scale(0.72)"
          />
        </g>
        <polygon points="50,10 64,38 36,38" fill="var(--sail-fast)" />
        <polygon points="50,42 66,72 34,72" fill="var(--sail-fast)" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" className="ship-svg">
      <polygon points="50,6 74,34 69,90 31,90 26,34" fill="var(--ship-pirate)" />
      <polygon
        points="50,6 74,34 69,90 31,90 26,34"
        fill="var(--ship-pirate-deck)"
        transform="translate(14,14) scale(0.72)"
      />
      <polygon points="50,14 70,54 30,54" fill="var(--sail-pirate)" />
      <polygon points="50,52 62,76 38,76" fill="var(--sail-pirate-2)" />
    </svg>
  );
}

/** 残骸：断裂船体两段 */
export function WreckSprite() {
  return (
    <svg viewBox="0 0 100 100" className="wreck-svg">
      <polygon points="30,30 58,22 52,48 24,52" fill="var(--wreck)" opacity="0.85" />
      <polygon points="46,58 76,50 70,80 42,78" fill="var(--wreck)" opacity="0.7" />
      <line x1="38" y1="26" x2="34" y2="50" stroke="var(--wreck-line)" strokeWidth="3" />
    </svg>
  );
}
