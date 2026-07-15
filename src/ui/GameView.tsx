// ===== 对局视图：棋盘 + HUD + 浮层 + 键盘 + 抽卡 =====
import { useEffect } from 'react';
import { legalTurns } from '../engine/rules';
import type { Dir8, GameState } from '../engine/types';
import { useGame } from '../game/useGame';
import { Board } from './Board';
import { DraftOverlay } from './DraftOverlay';
import { Hud } from './Hud';
import { GameOverOverlay, LevelClearedOverlay, VictoryOverlay } from './Overlays';

interface Props {
  initial: GameState;
  onExit: () => void;
  onNewRun: () => void;
}

const KEY_DIRS: Record<string, Dir8> = {
  arrowup: 'N', w: 'N',
  arrowdown: 'S', s: 'S',
  arrowleft: 'W', a: 'W',
  arrowright: 'E', d: 'E',
  q: 'NW', e: 'NE', z: 'SW', c: 'SE',
};

export function GameView({ initial, onExit, onNewRun }: Props) {
  const { game, visual, draftOffer, busy, act, skip, nextLevel, pickAbility, removeEffect } = useGame(initial);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const key = ev.key.toLowerCase();

      // 抽卡面板快捷键
      if (draftOffer && (key === '1' || key === '2' || key === '3')) {
        ev.preventDefault();
        const idx = Number(key) - 1;
        if (draftOffer[idx]) pickAbility(draftOffer[idx]);
        return;
      }

      // 浮层快捷键
      if (game.phase === 'levelCleared') {
        // 肉鸽抽卡面板期间屏蔽空格过关
        if (draftOffer) return;
        if (key === ' ' || key === 'enter') { ev.preventDefault(); nextLevel(); return; }
      }
      if ((game.phase === 'gameOver' || game.phase === 'victory') && key === 'enter') {
        ev.preventDefault(); onNewRun(); return;
      }
      if (game.phase !== 'playing') return;

      // 转向：Shift + 方向（helm 强化）
      if (ev.shiftKey) {
        const turnDir = KEY_DIRS[key];
        if (turnDir && legalTurns(game).includes(turnDir)) {
          ev.preventDefault();
          if (busy) skip();
          act({ type: 'turn', dir: turnDir });
          return;
        }
      }

      const dir = KEY_DIRS[key];
      const isFire = key === ' ' || key === 'f';
      if (!dir && !isFire) return;
      ev.preventDefault();
      if (busy) skip();
      if (isFire) act({ type: 'fire' });
      else if (dir) act({ type: 'move', dir });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game.phase, game, draftOffer, busy, act, skip, nextLevel, pickAbility, onNewRun]);

  return (
    <div className="game-view">
      <Hud visual={visual} game={game} onExit={onExit} />
      <Board
        game={game}
        visual={visual}
        busy={busy}
        onAct={act}
        onSkip={skip}
        onRemoveEffect={removeEffect}
      />
      <p className="controls-hint">
        点击相邻格移动 · 点击自己的船开炮 ｜ WASD/方向键移动 · Q/E/Z/C 斜向 · 空格/F 开炮 · Shift+方向转向
      </p>
      {visual.overlay === 'levelCleared' && !draftOffer && (
        <LevelClearedOverlay level={game.level} score={game.score} onNext={nextLevel} />
      )}
      {draftOffer && (
        <DraftOverlay offer={draftOffer} onPick={(id) => pickAbility(id)} level={game.level} score={game.score} />
      )}
      {visual.overlay === 'victory' && (
        <VictoryOverlay level={game.level} score={game.score} onNewRun={onNewRun} onExit={onExit} />
      )}
      {visual.overlay === 'gameOver' && (
        <GameOverOverlay level={game.level} score={game.score} onNewRun={onNewRun} onExit={onExit} />
      )}
    </div>
  );
}
