// ===== sim.test：随机 bot 全程不变量 + 启发式 bot 平衡统计 =====
import { applyAbility, rollDraft } from '../src/engine/abilities';
import { newRogueRun, newRun, startLevel } from '../src/engine/generator';
import { chebyshev, step } from '../src/engine/geometry';
import { createRng } from '../src/engine/rng';
import { fireRays, legalMoves, resolveTurn } from '../src/engine/rules';
import type { Action, GameEvent, GameState } from '../src/engine/types';

/** 每回合都必须成立的不变量（关卡制） */
function assertInvariants(prev: GameState, next: GameState, events: GameEvent[]) {
  const { width: w, height: h } = next;
  const seen = new Set<number>();
  for (const e of next.enemies) {
    expect(e.pos).toBeGreaterThanOrEqual(0);
    expect(e.pos).toBeLessThan(w * h);
    expect(seen.has(e.pos)).toBe(false);
    seen.add(e.pos);
    expect(e.pos).not.toBe(next.player.pos);
    expect(next.terrain[e.pos]).toBe('water');
  }
  expect(next.terrain[next.player.pos]).toBe('water');
  expect(next.lives).toBeGreaterThanOrEqual(0);
  expect(next.score).toBeGreaterThanOrEqual(prev.score);
  expect(next.enemies.length).toBeLessThanOrEqual(prev.enemies.length);
  for (const e of events) {
    if (e.type === 'enemyMoved') expect(chebyshev(e.from, e.to, w)).toBe(1);
    if (e.type === 'shipSunk') expect(prev.enemies.some((s) => s.id === e.shipId)).toBe(true);
  }
  if (prev.phase !== 'playing') expect(next).toBe(prev);
}

/** 肉鸽模式不变量：旗舰允许停在 vortex 格 */
function assertRogueInvariants(prev: GameState, next: GameState, events: GameEvent[]) {
  const { width: w, height: h } = next;
  const seen = new Set<number>();
  for (const e of next.enemies) {
    expect(e.pos).toBeGreaterThanOrEqual(0);
    expect(e.pos).toBeLessThan(w * h);
    expect(seen.has(e.pos)).toBe(false);
    seen.add(e.pos);
    expect(e.pos).not.toBe(next.player.pos);
    if (e.kind !== 'flagship') expect(next.terrain[e.pos] === 'water').toBe(true);
  }
  if (next.player.pos >= 0 && next.player.pos < w * h) {
    expect(next.terrain[next.player.pos]).toBe('water');
  }
  expect(next.lives).toBeGreaterThanOrEqual(0);
  expect(next.score).toBeGreaterThanOrEqual(prev.score);
  expect(next.enemies.length).toBeLessThanOrEqual(prev.enemies.length);
  for (const e of events) {
    if (e.type === 'enemyMoved') expect(chebyshev(e.from, e.to, w)).toBe(1);
    if (e.type === 'shipSunk') expect(prev.enemies.some((s) => s.id === e.shipId)).toBe(true);
  }
  if (prev.phase !== 'playing') expect(next).toBe(prev);
}

describe('随机 bot 模拟', () => {
  it('30 种子 × ≤400 回合：全程不变量成立、无异常', () => {
    for (let si = 0; si < 30; si++) {
      const seed = si * 104729 + 7;
      let state = newRun(seed);
      const bot = createRng((seed ^ 0xbadc0de) >>> 0);
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

  it('rogue 30 种子 × ≤600 回合：全程不变量成立（含 Boss 关）', () => {
    for (let si = 0; si < 30; si++) {
      const seed = si * 100003 + 13;
      let state = newRogueRun(seed);
      const bot = createRng((seed ^ 0xbadc0de) >>> 0);
      for (let t = 0; t < 600; t++) {
        if (state.phase === 'levelCleared') {
          if (state.level >= 15) break;
          state = startLevel(state, state.level + 1);
          continue;
        }
        if (state.phase === 'gameOver' || state.phase === 'victory') break;
        const moves = legalMoves(state);
        const actions: Action[] = [
          ...moves.map((d) => ({ type: 'move' as const, dir: d })),
          { type: 'fire' as const },
        ];
        const action = actions[bot.int(actions.length)]!;
        const prev = state;
        const { state: next, events } = resolveTurn(state, action);
        assertRogueInvariants(prev, next, events);
        state = next;
      }
    }
  });

  it('extraLifeEvery=0 不挂死（死循环回归）', () => {
    const state = { ...newRogueRun(1), score: 9999999, nextExtraLifeAt: 0 };
    const { events } = resolveTurn(state, { type: 'fire' });
    expect(events.some((e) => e.type === 'extraLife')).toBe(false);
  });
});

// ── 启发式 bot：粗测平衡曲线 ──────────────────────

function smartAction(state: GameState): Action {
  const rays = fireRays(state, state.player.pos, state.player.facing);
  if (rays.some((r) => r.hitShipId !== undefined)) return { type: 'fire' };
  let best: Action = { type: 'fire' };
  let bestScore = -Infinity;
  for (const d of legalMoves(state)) {
    const to = step(state.player.pos, d, state.width, state.height);
    if (state.terrain[to] === 'vortex') continue;
    const minDist = Math.min(
      ...state.enemies.map((e) => chebyshev(to, e.pos, state.width)),
      99,
    );
    const [p, s, ...rest] = fireRays(state, to, d);
    const hitBonus = (p.hitShipId !== undefined ? 1 : 0) + (s.hitShipId !== undefined ? 1 : 0) + (rest.some((r) => r.hitShipId !== undefined) ? 1 : 0);
    const score = minDist + hitBonus * 2;
    if (score > bestScore) {
      bestScore = score;
      best = { type: 'move', dir: d };
    }
  }
  return best;
}

describe('平衡统计（启发式 bot）', () => {
  it('关卡制存活关卡中位数落在健康区间', () => {
    const levels: number[] = [];
    for (let si = 0; si < 30; si++) {
      let state = newRun(si * 65537 + 3);
      let guard = 0;
      while (guard++ < 1500) {
        if (state.phase === 'gameOver') break;
        if (state.phase === 'levelCleared') {
          if (state.level >= 20) break;
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
    console.log(`[平衡] 关卡制 bot 30 局：中位 ${median} 关，均值 ${mean.toFixed(1)}，分布 ${levels.join(',')}`);
    expect(median).toBeGreaterThanOrEqual(1);
    expect(median).toBeLessThanOrEqual(12);
  });

  it('肉鸽随机选卡 bot 止步分布统计', () => {

    const stops: number[] = [];
    let wins = 0;
    for (let si = 0; si < 30; si++) {
      let state = newRogueRun(si * 65537 + 7);
      let guard = 0;
      while (guard++ < 1500) {
        if (state.phase === 'gameOver') { stops.push(state.level); break; }
        if (state.phase === 'victory') { stops.push(15); wins++; break; }
        if (state.phase === 'levelCleared') {
          if (state.level >= 15) { stops.push(15); break; }
          const offer = rollDraft(state);
          const nextState = applyAbility(state, offer[0]!);
          state = startLevel(nextState, state.level + 1);
          continue;
        }
        state = resolveTurn(state, smartAction(state)).state;
      }
    }
    stops.sort((a, b) => a - b);
    const median = stops[Math.floor(stops.length / 2)]!;
    const mean = stops.reduce((a, b) => a + b, 0) / stops.length;
    const winsCount = stops.filter((s) => s === 15).length;
    console.log(`[平衡] 肉鸽 bot（随机选卡）30 局：中位 ${median} 关，均值 ${mean.toFixed(1)}，胜 ${winsCount}，分布 ${stops.join(',')}`);
    // 宽断言：不会全员暴毙也不会轻松通杀
    expect(stops.some((s) => s >= 5)).toBe(true);
    expect(wins).toBeLessThanOrEqual(10);
  });
});
