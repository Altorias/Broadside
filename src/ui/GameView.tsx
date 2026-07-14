// ===== 对局视图：棋盘 + HUD + 浮层 + 键盘 =====
import { useEffect } from 'react';
import type { Dir8, GameState } from '../engine/types';
import { useGame } from '../game/useGame';
import { Board } from './Board';
import { Hud } from './Hud';
import { GameOverOverlay, LevelClearedOverlay } from './Overlays';

interface Props {
  initial: GameState;
  onExit: () => void;
  onNewRun: () => void;
}

const KEY_DIRS: Record<string, Dir8> = {
  arrowup: 'N',
  w: 'N',
  arrowdown: 'S',
  s: 'S',
  arrowleft: 'W',
  a: 'W',
  arrowright: 'E',
  d: 'E',
  q: 'NW',
  e: 'NE',
  z: 'SW',
  c: 'SE',
};

export function GameView({ initial, onExit, onNewRun }: Props) {
  const { game, visual, busy, act, skip, nextLevel, removeEffect } = useGame(initial);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const key = ev.key.toLowerCase();
      // 浮层快捷键
      if (game.phase === 'levelCleared' && (key === ' ' || key === 'enter')) {
        ev.preventDefault();
        nextLevel();
        return;
      }
      if (game.phase === 'gameOver' && key === 'enter') {
        ev.preventDefault();
        onNewRun();
        return;
      }
      if (game.phase !== 'playing') return;
      const dir = KEY_DIRS[key];
      const isFire = key === ' ' || key === 'f';
      if (!dir && !isFire) return;
      ev.preventDefault();
      if (busy) skip(); // 键盘连打 = 快进动画后立即行动
      if (isFire) act({ type: 'fire' });
      else if (dir) act({ type: 'move', dir });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game.phase, busy, act, skip, nextLevel, onNewRun]);

  return (
    <div className="game-view">
      <Hud visual={visual} onExit={onExit} />
      <Board
        game={game}
        visual={visual}
        busy={busy}
        onAct={act}
        onSkip={skip}
        onRemoveEffect={removeEffect}
      />
      <p className="controls-hint">
        点击相邻格移动 · 点击自己的船开炮 ｜ WASD/方向键移动 · Q/E/Z/C 斜向 · 空格/F 开炮
      </p>
      {visual.overlay === 'levelCleared' && (
        <LevelClearedOverlay level={game.level} score={game.score} onNext={nextLevel} />
      )}
      {visual.overlay === 'gameOver' && (
        <GameOverOverlay level={game.level} score={game.score} onNewRun={onNewRun} onExit={onExit} />
      )}
    </div>
  );
}
