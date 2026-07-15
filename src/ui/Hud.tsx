// ===== HUD：关卡 / 得分 / 剩余敌舰 / 命（肉鸽下显示船体 x/max）=====
import type { GameState } from '../engine/types';
import type { VisualState } from '../game/useGame';

interface Props {
  visual: VisualState;
  game: GameState;
  onExit: () => void;
}

export function Hud({ visual, game, onExit }: Props) {
  const { hud } = visual;
  const enemiesLeft = visual.ships.filter((s) => s.id !== 0 && !s.sinking).length;
  const isRogue = game.mode === 'rogue';
  const flagship = game.enemies.find((e) => e.kind === 'flagship');
  return (
    <div className="hud">
      <button className="btn btn-ghost hud-exit" onClick={onExit}>
        ← 菜单
      </button>
      <div className="hud-stat">
        <span className="hud-label">{isRogue ? '层' : '关卡'}</span>
        <span className="hud-value">{isRogue ? `${hud.level}/15` : hud.level}</span>
      </div>
      <div className="hud-stat">
        <span className="hud-label">得分</span>
        <span className="hud-value">{hud.score}</span>
      </div>
      <div className="hud-stat">
        <span className="hud-label">敌舰</span>
        <span className="hud-value">{enemiesLeft}</span>
      </div>
      {flagship && (
        <div className="hud-stat">
          <span className="hud-label">旗舰</span>
          <span className="hud-value flagship-hp">
            {''.padEnd(flagship.hp, '♥')}
          </span>
        </div>
      )}
      <div className="hud-stat hud-lives" aria-label={`剩余 ${hud.lives} 命`}>
        <span className="hud-label">{isRogue ? '船体' : '命'}</span>
        <span className="hud-value">
          {isRogue ? `${hud.lives}/${game.stats.maxLives}` : hud.lives}
        </span>
      </div>
      {isRogue && game.abilities.length > 0 && (
        <div className="hud-stat hud-abilities" title={game.abilities.join(' · ')}>
          <span className="hud-label">强化</span>
          <span className="hud-value">{game.abilities.length}</span>
        </div>
      )}
    </div>
  );
}
