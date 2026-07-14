// ===== HUD：关卡 / 得分 / 剩余敌舰 / 命 =====
import type { VisualState } from '../game/useGame';

interface Props {
  visual: VisualState;
  onExit: () => void;
}

export function Hud({ visual, onExit }: Props) {
  const { hud } = visual;
  const enemiesLeft = visual.ships.filter((s) => s.id !== 0 && !s.sinking).length;
  return (
    <div className="hud">
      <button className="btn btn-ghost hud-exit" onClick={onExit}>
        ← 菜单
      </button>
      <div className="hud-stat">
        <span className="hud-label">关卡</span>
        <span className="hud-value">{hud.level}</span>
      </div>
      <div className="hud-stat">
        <span className="hud-label">得分</span>
        <span className="hud-value">{hud.score}</span>
      </div>
      <div className="hud-stat">
        <span className="hud-label">敌舰</span>
        <span className="hud-value">{enemiesLeft}</span>
      </div>
      <div className="hud-stat hud-lives" aria-label={`剩余 ${hud.lives} 命`}>
        <span className="hud-label">命</span>
        <span className="hud-value">
          {Array.from({ length: Math.min(hud.lives, 6) }, (_, i) => (
            <svg key={i} viewBox="0 0 100 100" className="life-icon">
              <polygon points="50,8 76,36 70,92 30,92 24,36" fill="var(--ship-player)" />
              <polygon points="50,18 68,54 32,54" fill="#fff" />
            </svg>
          ))}
          {hud.lives > 6 ? `×${hud.lives}` : ''}
        </span>
      </div>
    </div>
  );
}
