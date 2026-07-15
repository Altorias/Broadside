// ===== 棋盘：五层组合 + 点击/悬停分发 =====
import { useMemo, useState, type CSSProperties } from 'react';
import { step } from '../engine/geometry';
import { fireRays, legalMoves } from '../engine/rules';
import type { Action, Dir8, GameState } from '../engine/types';
import type { VisualState } from '../game/useGame';
import { EffectsLayer, ShipsLayer, WrecksLayer } from './Layers';
import { RangeLayer } from './RangeLayer';
import { TerrainLayer } from './TerrainLayer';

interface Props {
  game: GameState;
  visual: VisualState;
  busy: boolean;
  onAct: (a: Action) => void;
  onSkip: () => void;
  onRemoveEffect: (key: number) => void;
}

export function Board({ game, visual, busy, onAct, onSkip, onRemoveEffect }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { width: w, height: h } = game;
  const playing = game.phase === 'playing';

  // 合法移动方向 → 目标格映射
  const legalTargets = useMemo(() => {
    if (!playing) return new Map<number, Dir8>();
    return new Map(legalMoves(game).map((d) => [step(game.player.pos, d, w, h), d]));
  }, [game, playing, w, h]);

  const currentRays = useMemo(
    () => (playing ? fireRays(game, game.player.pos, game.player.facing) : null),
    [game, playing],
  );

  const previewRays = useMemo(() => {
    if (busy || hovered === null) return null;
    const dir = legalTargets.get(hovered);
    if (!dir) return null;
    return fireRays(game, hovered, dir);
  }, [busy, hovered, legalTargets, game]);

  const onCellClick = (i: number) => {
    if (busy) {
      onSkip(); // 点击动画区 = 跳过
      return;
    }
    const dir = legalTargets.get(i);
    if (dir) onAct({ type: 'move', dir });
    else if (i === game.player.pos) onAct({ type: 'fire' });
  };

  return (
    <div
      className={`board ${visual.shake ? 'shake' : ''}`}
      style={{ '--cols': w, '--rows': h } as CSSProperties}
    >
      <TerrainLayer
        terrain={visual.terrain}
        width={w}
        onCellClick={onCellClick}
        onCellHover={setHovered}
      />
      <RangeLayer
        width={w}
        origin={game.player.pos}
        currentRays={currentRays}
        previewRays={previewRays}
        previewOrigin={previewRays ? hovered : null}
        moveTargets={[...legalTargets.keys()]}
        busy={busy}
      />
      <WrecksLayer wrecks={visual.wrecks} width={w} />
      <ShipsLayer ships={visual.ships} />
      <EffectsLayer effects={visual.effects} onDone={onRemoveEffect} />
    </div>
  );
}
