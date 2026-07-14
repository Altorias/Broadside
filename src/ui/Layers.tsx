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

/** 父元素生命周期时长（子元素各自的动画在 CSS 内定长） */
const FX_BASE_DUR: Record<Effect['kind'], number> = {
  cannonball: 0, // 用 effect.dur
  muzzle: 420,
  impact: 560,
  thud: 460,
  splash: 500,
  scorePop: 750,
};

/** 各特效的子结构：核心/冲击环/烟尘等独立动画 */
function EffectBody({ kind, text }: { kind: Effect['kind']; text?: string }) {
  switch (kind) {
    case 'cannonball':
      return <span className="ball" />;
    case 'muzzle':
      return (
        <>
          <span className="mz-flash" />
          <span className="mz-smoke" />
        </>
      );
    case 'impact':
      return (
        <>
          <span className="imp-core" />
          <span className="imp-ring" />
          <span className="imp-smoke is1" />
          <span className="imp-smoke is2" />
          <span className="imp-smoke is3" />
        </>
      );
    case 'thud':
      return (
        <>
          <span className="th-ring" />
          <span className="th-dust td1" />
          <span className="th-dust td2" />
          <span className="th-dust td3" />
        </>
      );
    case 'splash':
      return (
        <>
          <span className="sp-ring r1" />
          <span className="sp-ring r2" />
          <span className="sp-drop d1" />
          <span className="sp-drop d2" />
        </>
      );
    case 'scorePop':
      return <>{text}</>;
  }
}

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
          '--ang': f.ang ?? 0,
          // 子元素动画的统一起播延迟（CSS 内 calc(var(--fxd) + 各自偏移)）
          '--fxd': `${(f.delay ?? 0) * ANIM_SCALE}ms`,
          animationDuration: `${dur}ms`,
          animationDelay: `${(f.delay ?? 0) * ANIM_SCALE}ms`,
        } as CSSProperties;
        return (
          <div
            key={f.key}
            className={`fx fx-${f.kind}`}
            style={style}
            onAnimationEnd={(ev) => {
              // 只在父元素自身的生命周期动画结束时移除（子元素动画冒泡忽略）
              if (ev.target === ev.currentTarget) onDone(f.key);
            }}
          >
            <EffectBody kind={f.kind} text={f.text} />
          </div>
        );
      })}
    </div>
  );
}
