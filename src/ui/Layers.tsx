// ===== 船层 + 残骸层 + 特效层 =====
import type { CSSProperties } from 'react';
import { colOf, rowOf } from '../engine/geometry';
import { ANIM_SCALE, type Effect, type VisualShip } from '../game/useGame';
import { ShipSprite, WreckSprite } from './ShipSprite';

// ── 船层 ──────────────────────────────────────────

export function ShipsLayer({ ships }: { ships: VisualShip[] }) {
  return (
    <div className="ships-layer">
      {ships.map((s) => (
        <div
          key={s.id === 0 ? 'player' : s.id}
          className={[
            'ship',
            s.kind === 'player' ? 'ship-player' : `ship-${s.kind}`,
            s.sinking ? 'sinking' : '',
            s.teleporting ? 'no-transition' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ '--r': s.row, '--c': s.col, '--rot': s.angle } as CSSProperties}
        >
          <ShipSprite kind={s.kind} />
        </div>
      ))}
    </div>
  );
}

// ── 残骸层 ────────────────────────────────────────

export function WrecksLayer({ wrecks, width }: { wrecks: number[]; width: number }) {
  return (
    <div className="wrecks-layer">
      {wrecks.map((i) => (
        <div
          key={i}
          className="wreck"
          style={{ '--r': rowOf(i, width), '--c': colOf(i, width) } as CSSProperties}
        >
          <WreckSprite />
        </div>
      ))}
    </div>
  );
}

// ── 特效层 ────────────────────────────────────────

interface EffectsProps {
  effects: Effect[];
  onDone: (key: number) => void;
}

const FX_BASE_DUR: Record<Effect['kind'], number> = {
  cannonball: 0, // 用 effect.dur
  impact: 300,
  splash: 450,
  scorePop: 700,
};

export function EffectsLayer({ effects, onDone }: EffectsProps) {
  return (
    <div className="effects-layer">
      {effects.map((f) => {
        const dur = (f.dur ?? FX_BASE_DUR[f.kind]) * ANIM_SCALE;
        const style = {
          '--r': f.r,
          '--c': f.c,
          '--r2': f.r2 ?? f.r,
          '--c2': f.c2 ?? f.c,
          animationDuration: `${dur}ms`,
          animationDelay: `${(f.delay ?? 0) * ANIM_SCALE}ms`,
        } as CSSProperties;
        return (
          <div
            key={f.key}
            className={`fx fx-${f.kind}`}
            style={style}
            onAnimationEnd={() => onDone(f.key)}
          >
            {f.kind === 'scorePop' ? f.text : null}
          </div>
        );
      })}
    </div>
  );
}
