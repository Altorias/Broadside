// ===== 回合结算核心 =====
// resolveTurn 是纯函数：输入 (state, action)，输出新 state + 事件列表；
// 事件顺序即 UI 动画播放顺序（契约见 types.ts 顶部注释）。
// 敌船采用微步制：step1 全体同时动一步并结算冲突，step2 仅存活的快速海盗
// 重新瞄准再动一步——每格进入都接受完整结算，无"跳格"特判。

import { enemyIntent, intentFor } from './ai';
import { hasAbility } from './abilities';
import { DIRS, chebyshev, dirFromTo, portOf, starboardOf, step } from './geometry';
import { createRng, type Rng } from './rng';
import { levelClearBonus, sinkPoints } from './score';
import { ROGUE_FINAL_LEVEL } from './types';
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
/** 炮弹被地形挡下判定（reefGarden 强化豁免礁石） */
function blocksShot(state: GameState, t: Terrain): boolean {
  if (t === 'reef' && hasAbility(state, 'reefGarden')) return false;
  return t === 'island' || t === 'reef' || t === 'wreck';
}

// ===== 查询函数（UI 预览与结算共用同一实现）=====

/** 玩家当前的合法移动方向（目标为水/漩涡且无敌船占据；ram 则可撞非旗舰） */
export function legalMoves(state: GameState): Dir8[] {
  const ram = hasAbility(state, 'ram');
  const out: Dir8[] = [];
  for (const d of DIRS) {
    const to = step(state.player.pos, d, state.width, state.height);
    if (to === -1) continue;
    const t = state.terrain[to]!;
    const enemy = state.enemies.find((e) => e.pos === to);
    if (enemy) {
      if (ram && enemy.kind !== 'flagship' && t !== 'vortex') out.push(d);
    } else if (t === 'water' || t === 'vortex') {
      out.push(d);
    }
  }
  return out;
}

/** 玩家当前的合法转向方向（需 helm；不含当前朝向） */
export function legalTurns(state: GameState): Dir8[] {
  if (!hasAbility(state, 'helm')) return [];
  return DIRS.filter((d) => d !== state.player.facing);
}

export interface RayResult {
  side: Side;
  /** 炮弹依次飞过的格（含命中/受挡格），动画路径 */
  cells: number[];
  /** 第一个被命中的船（UI 锁定框兼容字段 = hits[0]） */
  hitShipId?: number;
  blockedBy?: Terrain;
  /** 全部被命中的船 id（pierce 强化可多个），与 hitCells 一一对应 */
  hits: number[];
  hitCells: number[];
}

/** 单舷射线：逐格扫描，命中第一个实体即停；水/漩涡飞越。
 *  pierce 强化：命中"本发会击沉"（射前 hp=1）的船后继续飞行 */
function scanRay(state: GameState, origin: number, dir: Dir8, side: Side): RayResult {
  const pierce = hasAbility(state, 'pierce');
  const occupied = new Map(state.enemies.map((e) => [e.pos, e]));
  const cells: number[] = [];
  const hits: number[] = [];
  const hitCells: number[] = [];
  let blockedBy: Terrain | undefined;
  let cur = origin;
  for (let k = 0; k < state.stats.cannonRange; k++) {
    cur = step(cur, dir, state.width, state.height);
    if (cur === -1) break;
    cells.push(cur);
    const ship = occupied.get(cur);
    if (ship) {
      hits.push(ship.id);
      hitCells.push(cur);
      if (pierce && ship.hp === 1) continue; // 将沉：贯穿续飞
      break; // 未沉（血厚）或无贯穿：停在这艘船
    }
    const t = state.terrain[cur]!;
    if (blocksShot(state, t)) {
      blockedBy = t;
      break;
    }
  }
  return { side, cells, hitShipId: hits[0], blockedBy, hits, hitCells };
}

/** 齐射射线组：恒有左右舷两条；bowChaser 强化追加舰艏第三条 */
export type VolleyRays = [RayResult, RayResult, ...RayResult[]];

/** 以 (pos, facing) 齐射的射线组。悬停预览与真开炮共用 */
export function fireRays(state: GameState, pos: number, facing: Dir8): VolleyRays {
  const rays: VolleyRays = [
    scanRay(state, pos, portOf(facing), 'port'),
    scanRay(state, pos, starboardOf(facing), 'starboard'),
  ];
  if (hasAbility(state, 'bowChaser')) rays.push(scanRay(state, pos, facing, 'bow'));
  return rays;
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

  // 转向（helm 强化）：无 helm 或转同向 → 非法
  if (action.type === 'turn') {
    if (!hasAbility(state, 'helm') || action.dir === state.player.facing) {
      return { state, events: [] };
    }
  }

  // 移动合法性预检：非法动作返回原 state + 空事件（防御式忽略）
  if (action.type === 'move') {
    const to = step(state.player.pos, action.dir, state.width, state.height);
    if (to === -1) return { state, events: [] };
    const t = state.terrain[to]!;
    const blocked = t !== 'water' && t !== 'vortex';
    const enemy = state.enemies.find((e) => e.pos === to);
    if (enemy) {
      // ram 可撞普通敌船（非旗舰）；漩涡格上的敌不可撞（推挤落点语义复杂，从简）
      if (!hasAbility(state, 'ram') || enemy.kind === 'flagship' || t === 'vortex') {
        return { state, events: [] };
      }
    } else if (blocked) {
      return { state, events: [] };
    }
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
  if (action.type === 'turn') {
    s.player = { ...s.player, facing: action.dir };
    events.push({ type: 'playerTurned', facing: action.dir });
  } else if (action.type === 'move') {
    const from = s.player.pos;
    const to = step(from, action.dir, s.width, s.height); // 预检已保证合法
    const rammed = s.enemies.find((e) => e.pos === to);
    s.player = { pos: to, facing: action.dir };
    events.push({ type: 'playerMoved', from, to, facing: action.dir });
    if (rammed) resolveRam(s, rammed, action.dir, ctx, events);
    if (s.terrain[to] === 'vortex') {
      const dest = findSafeCell(s, rng);
      events.push({ type: 'playerTeleported', from: to, to: dest });
      s.player.pos = dest;
    }
    // tailwind：移动结算后从新位置新朝向自动齐射一轮
    if (hasAbility(s, 'tailwind')) fireVolley(s, ctx, events);
  } else {
    // 开炮恒合法（放空炮 = 战术等待）
    fireVolley(s, ctx, events);
  }

  // ── 阶段 2：敌船微步（旗舰子阶段先决）────────────
  enemyPhase(s, 1, events, rng, ctx);
  enemyPhase(s, 2, events, rng, ctx);
  resolveVortexPull(s, events, ctx);

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
    if (s.mode === 'rogue' && s.level >= ROGUE_FINAL_LEVEL) {
      s.phase = 'victory';
      events.push({ type: 'victory', score: s.score });
    } else {
      s.phase = 'levelCleared';
      events.push({ type: 'levelCleared', level: s.level, bonus });
    }
  }
  s.rngState = rng.state();
  return { state: s, events };
}

function checkExtraLife(s: GameState, events: GameEvent[]): void {
  if (s.stats.extraLifeEvery <= 0) return; // 肉鸽禁用奖命（防 while 死循环）
  while (s.score >= s.nextExtraLifeAt) {
    s.lives++;
    s.nextExtraLifeAt += s.stats.extraLifeEvery;
    events.push({ type: 'extraLife', lives: s.lives });
  }
}

/**
 * 齐射单一出口：cannon 系事件（cannonFired / shipDamaged / shipSunk(cannon) /
 * wreckCreated('volley')）必须连续成块——groupBeats 依赖此归拍。
 * 结算顺序确定性：射线序（port→starboard→bow）→ 射线内受害者序 →
 * blast 溅射按 N/E/S/W 序；每次伤害前检查船仍存活。
 */
function fireVolley(s: GameState, ctx: TurnCtx, events: GameEvent[]): void {
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
  const blast = hasAbility(s, 'blast');
  for (const r of rays) {
    for (let i = 0; i < r.hits.length; i++) {
      const pos = r.hitCells[i]!;
      applyCannonDamage(s, r.hits[i]!, ctx, events);
      if (!blast) continue;
      // 爆裂弹：命中格 4 正邻格溅射（仅主命中触发，无链式）
      for (const d of ['N', 'E', 'S', 'W'] as const) {
        const n = step(pos, d, s.width, s.height);
        if (n === -1) continue;
        const neighbor = s.enemies.find((e) => e.pos === n);
        if (neighbor) applyCannonDamage(s, neighbor.id, ctx, events);
      }
    }
  }
}

/** 单发炮击伤害管线：hp-1 → 未沉发 shipDamaged；归零发 shipSunk 并移除 */
function applyCannonDamage(
  s: GameState,
  shipId: number,
  ctx: TurnCtx,
  events: GameEvent[],
): void {
  const ship = s.enemies.find((e) => e.id === shipId);
  if (!ship) return; // 已在本轮先前伤害中沉没（pierce/blast 多点伤害时可达）
  ship.hp--;
  if (ship.hp > 0) {
    events.push({ type: 'shipDamaged', shipId: ship.id, at: ship.pos, hpLeft: ship.hp });
    return;
  }
  const points = sinkPoints('cannon', ship.kind);
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
  const wreckAt = ship.pos;
  s.enemies = s.enemies.filter((e) => e.id !== ship.id);
  if (hasAbility(s, 'wreckShot') && s.terrain[wreckAt] === 'water') {
    s.terrain[wreckAt] = 'wreck';
    events.push({ type: 'wreckCreated', at: wreckAt, step: 'volley' });
  }
}

/** vortexPull：敌方微步后把最近的非旗舰敌向最近漩涡吸 1 格（确定性 tie-break） */
function resolveVortexPull(s: GameState, events: GameEvent[], ctx: TurnCtx): void {
  if (!hasAbility(s, 'vortexPull')) return;
  const vortexes = s.terrain
    .map((t, i) => (t === 'vortex' ? i : -1))
    .filter((i) => i !== -1);
  const candidates = s.enemies.filter((e) => e.kind !== 'flagship');
  if (vortexes.length === 0 || candidates.length === 0) return;

  let best: { ship: EnemyShip; vortex: number; dist: number } | null = null;
  for (const ship of candidates) {
    for (const vortex of vortexes) {
      const dist = chebyshev(ship.pos, vortex, s.width);
      if (
        best === null ||
        dist < best.dist ||
        (dist === best.dist && (ship.id < best.ship.id || (ship.id === best.ship.id && vortex < best.vortex)))
      ) {
        best = { ship, vortex, dist };
      }
    }
  }
  if (!best || best.dist === 0) return;
  const to = enemyIntent(best.ship.pos, best.vortex, s.width);
  if (to === s.player.pos || s.enemies.some((e) => e.id !== best!.ship.id && e.pos === to)) return;

  const from = best.ship.pos;
  const terrain = s.terrain[to]!;
  const sink = (cause: SinkCause) => {
    const points = sinkPoints(cause, best!.ship.kind);
    ctx.scoreGain += points;
    events.push({
      type: 'shipSunk',
      shipId: best!.ship.id,
      kind: best!.ship.kind,
      from,
      to,
      cause,
      points,
      step: 'pull',
    });
    s.enemies = s.enemies.filter((e) => e.id !== best!.ship.id);
  };
  if (terrain === 'vortex') sink('vortex');
  else if (terrain === 'island' || terrain === 'reef' || terrain === 'wreck') sink('obstacle');
  else {
    best.ship.pos = to;
    events.push({ type: 'enemyPulled', shipId: best.ship.id, from, to, vortexAt: best.vortex });
  }
}

/**
 * 冲角推挤：玩家移入 rammed 所在格，将其沿玩家航向推 1 格。
 * 落点 C = step(被撞船原位, dir)：出界=搁浅沉/障碍=撞沉/漩涡=吞噬/
 * 另一敌=双沉留残骸/空水=换位存活。玩家最终占据被撞船原位（调用方赋值）。
 */
function resolveRam(
  s: GameState,
  rammed: EnemyShip,
  dir: Dir8,
  ctx: TurnCtx,
  events: GameEvent[],
): void {
  const from = rammed.pos;
  const c = step(from, dir, s.width, s.height);

  const sink = (cause: SinkCause, to: number, wreckAt?: number) => {
    const points = sinkPoints(cause, rammed.kind);
    ctx.scoreGain += points;
    s.enemies = s.enemies.filter((e) => e.id !== rammed.id);
    events.push({
      type: 'shipSunk',
      shipId: rammed.id,
      kind: rammed.kind,
      from,
      to,
      cause,
      points,
      step: 'ram',
    });
    if (wreckAt !== undefined) {
      s.terrain[wreckAt] = 'wreck';
      events.push({ type: 'wreckCreated', at: wreckAt, step: 'ram' });
    }
  };

  if (c === -1) {
    sink('grounded', from); // 推出边界搁浅（to 保持 from，防 -1 渲染）
    return;
  }
  const t = s.terrain[c]!;
  const other = s.enemies.find((e) => e.pos === c && e.id !== rammed.id);
  if (other) {
    // 推入另一艘船：双沉，残骸留 C
    const op = sinkPoints('collision', other.kind);
    ctx.scoreGain += op;
    events.push({
      type: 'shipSunk',
      shipId: other.id,
      kind: other.kind,
      from: c,
      to: c,
      cause: 'collision',
      points: op,
      step: 'ram',
    });
    s.enemies = s.enemies.filter((e) => e.id !== other.id);
    sink('collision', c, c);
  } else if (t === 'island' || t === 'reef' || t === 'wreck') {
    sink('obstacle', c);
  } else if (t === 'vortex') {
    sink('vortex', c);
  } else {
    // 空水：被推船存活换位
    rammed.pos = c;
    events.push({ type: 'enemyPushed', shipId: rammed.id, from, to: c });
  }
}

/**
 * 单个敌方微步：旗舰子阶段先决 → 小船同时移动结算 → 统一处理撞击玩家。
 * step1 全体小船 + 旗舰各动一步；step2 仅存活快速海盗（旗舰不动，是"静止巨物"）。
 */
function enemyPhase(
  s: GameState,
  stepNo: 1 | 2,
  events: GameEvent[],
  rng: Rng,
  ctx: TurnCtx,
): void {
  const flag = resolveFlagship(s, stepNo, events);
  const moverIds = s.enemies
    .filter((e) => e.kind !== 'flagship' && (stepNo === 1 || e.kind === 'fastPirate'))
    .map((e) => e.id);
  const shipsRammed = resolveEnemyStep(s, moverIds, stepNo, events, ctx, flag.pos);

  // 撞击玩家统一结算：每回合封顶扣 1 命；lives 归零则原地留着播死亡动画
  if ((flag.rammed || shipsRammed) && !ctx.lifeLost) {
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

/**
 * 旗舰子阶段：每回合只在 step1 动一步。碾碎礁石/残骸（terrain→water）；
 * 被岛屿挡住则站立；漩涡视作水面；撞玩家 = 原地冲撞且自身不沉。
 * 返回旗舰最终格（供小船结算判"撞旗舰"）与是否冲撞玩家。
 * 注：旗舰目标格若有小船，纯贪心下该小船同微步必腾空/沉没（与"对穿不可能"
 * 同款推理），瞬时重叠在微步内自行消解，不实现碾压分支。
 */
function resolveFlagship(
  s: GameState,
  stepNo: 1 | 2,
  events: GameEvent[],
): { pos: number | null; rammed: boolean } {
  const flag = s.enemies.find((e) => e.kind === 'flagship');
  if (!flag) return { pos: null, rammed: false };
  if (stepNo === 2) return { pos: flag.pos, rammed: false };

  const target = enemyIntent(flag.pos, s.player.pos, s.width);
  if (target === s.player.pos) return { pos: flag.pos, rammed: true };
  const terrain = s.terrain[target]!;
  if (terrain === 'island') return { pos: flag.pos, rammed: false }; // 山挡不动
  if (terrain === 'reef' || terrain === 'wreck') {
    s.terrain[target] = 'water';
    events.push({ type: 'terrainDestroyed', at: target, step: stepNo });
  }
  const from = flag.pos;
  flag.pos = target;
  flag.facing = dirFromTo(from, target, s.width);
  events.push({ type: 'enemyMoved', shipId: flag.id, from, to: target, facing: flag.facing, step: stepNo });
  return { pos: target, rammed: false };
}

/**
 * 小船同时移动 + 冲突结算。返回是否有船撞进玩家格（扣命由 enemyPhase 统一处理）。
 * 两条引理保证正确性与确定性（tests/rules.test.ts 固化）：
 * 1. 小船 AI 每微步必动（贪心步恒存在）⇒ mover 原格必腾空，无阻塞链，免迭代；
 * 2. 对穿是对称判定、同格冲突是按目标格分组的集合运算 ⇒ 结算与遍历序无关，
 *    无需 RNG 决胜；事件排列用 shipId 升序固定。
 * 旗舰不在 mover 集合内：目标 = 旗舰最终格 → 全组只沉自己（collision），
 * 旗舰无伤、不留残骸——该分支优先级在 stationary 检测之前。
 */
function resolveEnemyStep(
  s: GameState,
  moverIds: number[],
  stepNo: 1 | 2,
  events: GameEvent[],
  ctx: TurnCtx,
  flagshipPos: number | null,
): boolean {
  const movers = s.enemies.filter((e) => moverIds.includes(e.id));
  if (movers.length === 0) return false;

  const intent = new Map<number, number>();
  for (const m of movers) intent.set(m.id, intentFor(m, s.player.pos, s.terrain, s.width, s.height));

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
    // 静止敌船：不在本微步 mover 集合中的存活小船（仅 step2 会出现——普通海盗已停）
    const stationary = s.enemies.find(
      (e) =>
        e.pos === target && e.kind !== 'flagship' && !moverIdSet.has(e.id) && !sunk.has(e.id),
    );
    if (target === s.player.pos) {
      for (const m of group) sunk.set(m.id, { cause: 'rammedPlayer', to: target });
      rammedPlayer = true;
    } else if (flagshipPos !== null && target === flagshipPos) {
      // 撞旗舰：只沉自己，旗舰无伤，不留残骸（优先于 stationary 检测）
      for (const m of group) sunk.set(m.id, { cause: 'collision', to: target });
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
    const points = sinkPoints(info.cause, m.kind);
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

  return rammedPlayer;
}
