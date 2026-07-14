// ===== 回合结算核心 =====
// resolveTurn 是纯函数：输入 (state, action)，输出新 state + 事件列表；
// 事件顺序即 UI 动画播放顺序（契约见 types.ts 顶部注释）。
// 敌船采用微步制：step1 全体同时动一步并结算冲突，step2 仅存活的快速海盗
// 重新瞄准再动一步——每格进入都接受完整结算，无"跳格"特判。

import { enemyIntent } from './ai';
import { DIRS, chebyshev, dirFromTo, portOf, starboardOf, step } from './geometry';
import { createRng, type Rng } from './rng';
import { levelClearBonus, sinkPoints } from './score';
import type {
  Action,
  Dir8,
  EnemyShip,
  GameEvent,
  GameState,
  Side,
  SinkCause,
  Terrain,
  TurnResult,
} from './types';

/** 炮弹会被挡下的地形 */
const BLOCKS_SHOT: readonly Terrain[] = ['island', 'reef', 'wreck'];

// ===== 查询函数（UI 预览与结算共用同一实现）=====

/** 玩家当前的合法移动方向（目标为水/漩涡且无敌船占据） */
export function legalMoves(state: GameState): Dir8[] {
  const occupied = new Set(state.enemies.map((e) => e.pos));
  const out: Dir8[] = [];
  for (const d of DIRS) {
    const to = step(state.player.pos, d, state.width, state.height);
    if (to === -1) continue;
    const t = state.terrain[to]!;
    if ((t === 'water' || t === 'vortex') && !occupied.has(to)) out.push(d);
  }
  return out;
}

export interface RayResult {
  side: Side;
  /** 炮弹依次飞过的格（含命中/受挡格），动画路径 */
  cells: number[];
  hitShipId?: number;
  blockedBy?: Terrain;
}

/** 单舷射线：逐格扫描，命中第一个实体即停；水/漩涡飞越 */
function scanRay(state: GameState, origin: number, dir: Dir8, side: Side): RayResult {
  const occupied = new Map(state.enemies.map((e) => [e.pos, e.id]));
  const cells: number[] = [];
  let cur = origin;
  for (let k = 0; k < state.stats.cannonRange; k++) {
    cur = step(cur, dir, state.width, state.height);
    if (cur === -1) break;
    cells.push(cur);
    const hit = occupied.get(cur);
    if (hit !== undefined) return { side, cells, hitShipId: hit };
    const t = state.terrain[cur]!;
    if (BLOCKS_SHOT.includes(t)) return { side, cells, blockedBy: t };
  }
  return { side, cells };
}

/** 以 (pos, facing) 齐射的左右舷两条射线。悬停预览与真开炮共用 */
export function fireRays(state: GameState, pos: number, facing: Dir8): [RayResult, RayResult] {
  return [
    scanRay(state, pos, portOf(facing), 'port'),
    scanRay(state, pos, starboardOf(facing), 'starboard'),
  ];
}

/**
 * 安全落点（漩涡传送与损命重生共用）：
 * tier1 = 空水格且距所有敌 cheb≥2（保证 1 回合反应期）
 * → tier2 = 任意空水格 → 保底原地。只挑 water（排除漩涡防连锁传送）。
 */
export function findSafeCell(state: GameState, rng: Rng): number {
  const occupied = new Set(state.enemies.map((e) => e.pos));
  const tier1: number[] = [];
  const tier2: number[] = [];
  for (let i = 0; i < state.terrain.length; i++) {
    if (state.terrain[i] !== 'water') continue;
    if (occupied.has(i) || i === state.player.pos) continue;
    tier2.push(i);
    if (state.enemies.every((e) => chebyshev(i, e.pos, state.width) >= 2)) tier1.push(i);
  }
  const pool = tier1.length > 0 ? tier1 : tier2;
  return pool.length > 0 ? pool[rng.int(pool.length)]! : state.player.pos;
}

// ===== 回合结算 =====

/** 跨微步共享的回合上下文 */
interface TurnCtx {
  scoreGain: number;
  /** 每回合至多扣 1 命 */
  lifeLost: boolean;
}

export function resolveTurn(state: GameState, action: Action): TurnResult {
  if (state.phase !== 'playing') return { state, events: [] };

  // 移动合法性预检：非法动作返回原 state + 空事件（防御式忽略）
  if (action.type === 'move') {
    const to = step(state.player.pos, action.dir, state.width, state.height);
    if (to === -1) return { state, events: [] };
    const t = state.terrain[to]!;
    if (t !== 'water' && t !== 'vortex') return { state, events: [] };
    if (state.enemies.some((e) => e.pos === to)) return { state, events: [] };
  }

  // 克隆（108 格规模，整体浅拷贝 + 可变部分逐层复制即可）
  const s: GameState = {
    ...state,
    terrain: state.terrain.slice(),
    player: { ...state.player },
    enemies: state.enemies.map((e) => ({ ...e })),
  };
  const events: GameEvent[] = [];
  const rng = createRng(s.rngState);
  const ctx: TurnCtx = { scoreGain: 0, lifeLost: false };
  s.turn++;

  // ── 阶段 1：玩家行动 ──────────────────────────────
  if (action.type === 'move') {
    const from = s.player.pos;
    const to = step(from, action.dir, s.width, s.height); // 预检已保证合法
    s.player = { pos: to, facing: action.dir };
    events.push({ type: 'playerMoved', from, to, facing: action.dir });
    if (s.terrain[to] === 'vortex') {
      const dest = findSafeCell(s, rng);
      events.push({ type: 'playerTeleported', from: to, to: dest });
      s.player.pos = dest;
    }
  } else {
    // 开炮恒合法（放空炮 = 战术等待）
    const rays = fireRays(s, s.player.pos, s.player.facing);
    for (const r of rays) {
      events.push({
        type: 'cannonFired',
        side: r.side,
        cells: r.cells,
        hitShipId: r.hitShipId,
        blockedBy: r.blockedBy,
      });
    }
    for (const r of rays) {
      if (r.hitShipId === undefined) continue;
      const ship = s.enemies.find((e) => e.id === r.hitShipId)!;
      s.enemies = s.enemies.filter((e) => e.id !== r.hitShipId);
      const points = sinkPoints('cannon');
      ctx.scoreGain += points;
      events.push({
        type: 'shipSunk',
        shipId: ship.id,
        kind: ship.kind,
        from: ship.pos,
        to: ship.pos,
        cause: 'cannon',
        points,
      });
    }
  }

  // ── 阶段 2：敌船微步 ──────────────────────────────
  resolveEnemyStep(s, s.enemies.map((e) => e.id), 1, events, rng, ctx);
  resolveEnemyStep(
    s,
    s.enemies.filter((e) => e.kind === 'fastPirate').map((e) => e.id),
    2,
    events,
    rng,
    ctx,
  );

  // ── 阶段 3：计分 / 奖命 / 胜负 ────────────────────
  s.score += ctx.scoreGain;
  checkExtraLife(s, events);
  if (s.lives <= 0) {
    // 归零优先于过关："最后一敌撞死你"判负，即使它也沉了
    s.phase = 'gameOver';
    events.push({ type: 'gameOver', score: s.score });
  } else if (s.enemies.length === 0) {
    const bonus = levelClearBonus(s.level);
    s.score += bonus;
    checkExtraLife(s, events);
    s.phase = 'levelCleared';
    events.push({ type: 'levelCleared', level: s.level, bonus });
  }
  s.rngState = rng.state();
  return { state: s, events };
}

function checkExtraLife(s: GameState, events: GameEvent[]): void {
  while (s.score >= s.nextExtraLifeAt) {
    s.lives++;
    s.nextExtraLifeAt += s.stats.extraLifeEvery;
    events.push({ type: 'extraLife', lives: s.lives });
  }
}

/**
 * 单个微步的敌船同时移动 + 冲突结算。
 * 两条引理保证正确性与确定性（tests/rules.test.ts 固化）：
 * 1. AI 每微步必动（贪心步恒存在）⇒ mover 原格必腾空，无阻塞链，免迭代；
 * 2. 对穿是对称判定、同格冲突是按目标格分组的集合运算 ⇒ 结算与遍历序无关，
 *    无需 RNG 决胜；事件排列用 shipId 升序固定。
 */
function resolveEnemyStep(
  s: GameState,
  moverIds: number[],
  stepNo: 1 | 2,
  events: GameEvent[],
  rng: Rng,
  ctx: TurnCtx,
): void {
  const movers = s.enemies.filter((e) => moverIds.includes(e.id));
  if (movers.length === 0) return;

  const intent = new Map<number, number>();
  for (const m of movers) intent.set(m.id, enemyIntent(m.pos, s.player.pos, s.width));

  const sunk = new Map<number, { cause: SinkCause; to: number }>();
  const wrecks: number[] = [];
  let rammedPlayer = false;

  // (a) 对穿检测：A↔B 互换位 → 双沉，不留残骸（沉于格间通道）。
  // 注：对同一玩家的纯贪心 AI 在数学上不会产生对穿（sign 向量无法互指，
  // 见测试"对穿不可能"），此分支为未来 AI 变体（逃跑/绕行）预留的规则兜底。
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      const a = movers[i]!;
      const b = movers[j]!;
      if (sunk.has(a.id) || sunk.has(b.id)) continue;
      if (intent.get(a.id) === b.pos && intent.get(b.id) === a.pos) {
        sunk.set(a.id, { cause: 'collision', to: intent.get(a.id)! });
        sunk.set(b.id, { cause: 'collision', to: intent.get(b.id)! });
      }
    }
  }

  // (b) 幸存 mover 按目标格分组结算
  const groups = new Map<number, EnemyShip[]>();
  for (const m of movers) {
    if (sunk.has(m.id)) continue;
    const t = intent.get(m.id)!;
    const g = groups.get(t);
    if (g) g.push(m);
    else groups.set(t, [m]);
  }

  const moverIdSet = new Set(moverIds);
  const moved = new Map<number, number>();
  for (const [target, group] of groups) {
    const terrain = s.terrain[target]!;
    // 静止敌船：不在本微步 mover 集合中的存活敌船（仅 step2 会出现——普通海盗已停）
    const stationary = s.enemies.find(
      (e) => e.pos === target && !moverIdSet.has(e.id) && !sunk.has(e.id),
    );
    if (target === s.player.pos) {
      for (const m of group) sunk.set(m.id, { cause: 'rammedPlayer', to: target });
      rammedPlayer = true;
    } else if (terrain === 'island' || terrain === 'reef' || terrain === 'wreck') {
      for (const m of group) sunk.set(m.id, { cause: 'obstacle', to: target });
    } else if (terrain === 'vortex') {
      for (const m of group) sunk.set(m.id, { cause: 'vortex', to: target });
    } else if (stationary) {
      // 动撞静：全组 + 被撞者双沉，残骸留在被撞者格
      for (const m of group) sunk.set(m.id, { cause: 'collision', to: target });
      sunk.set(stationary.id, { cause: 'collision', to: stationary.pos });
      wrecks.push(target);
    } else if (group.length >= 2) {
      for (const m of group) sunk.set(m.id, { cause: 'collision', to: target });
      wrecks.push(target);
    } else {
      moved.set(group[0]!.id, target);
    }
  }

  // (c) 提交移动（shipId 升序发事件）
  for (const id of [...moved.keys()].sort((a, b) => a - b)) {
    const m = s.enemies.find((e) => e.id === id)!;
    const from = m.pos;
    const to = moved.get(id)!;
    m.pos = to;
    m.facing = dirFromTo(from, to, s.width);
    events.push({ type: 'enemyMoved', shipId: id, from, to, facing: m.facing, step: stepNo });
  }

  // (d) 沉没（shipId 升序）
  for (const id of [...sunk.keys()].sort((a, b) => a - b)) {
    const m = s.enemies.find((e) => e.id === id)!;
    const info = sunk.get(id)!;
    const points = sinkPoints(info.cause);
    ctx.scoreGain += points;
    events.push({
      type: 'shipSunk',
      shipId: id,
      kind: m.kind,
      from: m.pos,
      to: info.to,
      cause: info.cause,
      points,
      step: stepNo,
    });
  }
  s.enemies = s.enemies.filter((e) => !sunk.has(e.id));

  // (e) 残骸落地（按构造，该格此刻必无幸存船/玩家）
  for (const at of wrecks) {
    s.terrain[at] = 'wreck';
    events.push({ type: 'wreckCreated', at, step: stepNo });
  }

  // (f) 撞玩家：每回合封顶扣 1 命；lives 归零则原地留着播死亡动画
  if (rammedPlayer && !ctx.lifeLost) {
    ctx.lifeLost = true;
    s.lives--;
    events.push({ type: 'playerHit', at: s.player.pos, livesLeft: s.lives });
    if (s.lives > 0) {
      const from = s.player.pos;
      const dest = findSafeCell(s, rng);
      events.push({ type: 'playerTeleported', from, to: dest });
      s.player.pos = dest;
    }
  }
}
