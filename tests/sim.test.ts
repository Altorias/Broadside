// ===== sim.test：随机 bot 全程不变量 + 启发式 bot 平衡统计 =====
import { newRun, startLevel } from '../src/engine/generator';
import { chebyshev, step } from '../src/engine/geometry';
import { createRng } from '../src/engine/rng';
import { fireRays, legalMoves, resolveTurn } from '../src/engine/rules';
import type { Action, GameEvent, GameState } from '../src/engine/types';

/** 每回合都必须成立的不变量 */
function assertInvariants(prev: GameState, next: GameState, events: GameEvent[]) {
  const { width: w, height: h } = next;
  const seen = new Set<number>();
  for (const e of next.enemies) {
    expect(e.pos).toBeGreaterThanOrEqual(0);
    expect(e.pos).toBeLessThan(w * h);
    expect(seen.has(e.pos)).toBe(false); // 两两不同格
    seen.add(e.pos);
    expect(e.pos).not.toBe(next.player.pos);
    expect(next.terrain[e.pos]).toBe('water'); // 敌船恒在水面
  }
  expect(next.terrain[next.player.pos]).toBe('water');
  expect(next.lives).toBeGreaterThanOrEqual(0);
  expect(next.score).toBeGreaterThanOrEqual(prev.score); // 分数单调
  expect(next.enemies.length).toBeLessThanOrEqual(prev.enemies.length); // 单关内敌不增
  for (const e of events) {
    if (e.type === 'enemyMoved') {
      expect(chebyshev(e.from, e.to, w)).toBe(1); // 王步
    }
    if (e.type === 'shipSunk') {
      // 沉没者在上一状态中存在
      expect(prev.enemies.some((s) => s.id === e.shipId)).toBe(true);
    }
  }
  // phase 单向：playing → cleared/over
  if (prev.phase !== 'playing') {
    expect(next).toBe(prev); // 已结束的局直通
  }
}

describe('随机 bot 模拟', () => {
  it('30 种子 × ≤400 回合：全程不变量成立、无异常', () => {
    for (let si = 0; si < 30; si++) {
      const seed = si * 104729 + 7;
      let state = newRun(seed);
      const bot = createRng((seed ^ 0xbadc0de) >>> 0); // bot 决策流与对局流分离
      for (let t = 0; t < 400; t++) {
        if (state.phase === 'levelCleared') {
          if (state.level >= 10) break;
          state = startLevel(state, state.level + 1);
          continue;
        }
        if (state.phase === 'gameOver') break;
        const moves = legalMoves(state);
        const actions: Action[] = [
          ...moves.map((d) => ({ type: 'move' as const, dir: d })),
          { type: 'fire' as const },
        ];
        const action = actions[bot.int(actions.length)]!;
        const prev = state;
        const { state: next, events } = resolveTurn(state, action);
        assertInvariants(prev, next, events);
        state = next;
      }
    }
  });
});

// ── 启发式 bot：粗测平衡曲线 ──────────────────────

/** 能打就打；否则移动到"离最近敌最远 + 移动后可命中加分"的格 */
function smartAction(state: GameState): Action {
  const rays = fireRays(state, state.player.pos, state.player.facing);
  if (rays.some((r) => r.hitShipId !== undefined)) return { type: 'fire' };
  let best: Action = { type: 'fire' };
  let bestScore = -Infinity;
  for (const d of legalMoves(state)) {
    const to = step(state.player.pos, d, state.width, state.height);
    if (state.terrain[to] === 'vortex') continue; // 不主动跳漩涡
    const minDist = Math.min(
      ...state.enemies.map((e) => chebyshev(to, e.pos, state.width)),
      99,
    );
    const [p, s] = fireRays(state, to, d);
    const hitBonus =
      (p.hitShipId !== undefined ? 1 : 0) + (s.hitShipId !== undefined ? 1 : 0);
    const score = minDist + hitBonus * 2;
    if (score > bestScore) {
      bestScore = score;
      best = { type: 'move', dir: d };
    }
  }
  return best;
}

describe('平衡统计（启发式 bot）', () => {
  it('存活关卡中位数落在健康区间（防奖命通胀不死局）', () => {
    const levels: number[] = [];
    for (let si = 0; si < 30; si++) {
      let state = newRun(si * 65537 + 3);
      let guard = 0;
      while (guard++ < 1500) {
        if (state.phase === 'gameOver') break;
        if (state.phase === 'levelCleared') {
          if (state.level >= 20) break; // 通杀 20 关视为"不死"
          state = startLevel(state, state.level + 1);
          continue;
        }
        state = resolveTurn(state, smartAction(state)).state;
      }
      levels.push(state.level);
    }
    levels.sort((a, b) => a - b);
    const median = levels[Math.floor(levels.length / 2)]!;
    const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
    // eslint-disable-next-line no-console
    console.log(
      `[平衡] 启发式 bot 30 局：中位 ${median} 关，均值 ${mean.toFixed(1)}，分布 ${levels.join(',')}`,
    );
    expect(median).toBeGreaterThanOrEqual(1);
    expect(median).toBeLessThanOrEqual(12); // >12 说明奖命通胀，需调 extraLifeEvery
  });
});
