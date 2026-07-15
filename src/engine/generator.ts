// ===== 关卡生成 =====
// 随机撒障碍 + 放敌船，四条公平性约束（重掷式），每 20 次失败降一档障碍，
// 100 次全败落到确定性保底关。布局流与对局流分离：
// levelSeed = deriveSeed(runSeed, level) 生成布局；
// rngState  = deriveSeed(levelSeed, RUN_SALT) 供对局内随机（传送落点），
// 与重试次数无关 —— 同种子完全可复现。

import { rollDraft } from './abilities';
import { chebyshev, dirFromTo, neighbors8 } from './geometry';
import { createRng, deriveSeed } from './rng';
import { DEFAULT_STATS } from './types';
import type { EnemyShip, GameState, LevelConfig, PlayerStats, Terrain } from './types';

// ── 难度曲线常量（平衡调参集中处）──────────────────
const BOARD_W = 12;
const BOARD_H = 9;
const MAX_ENEMIES = 12;
const MAX_FAST = 4;
/** 对局内随机流的派生盐 */
const RUN_SALT = 0x9e37;

export function levelConfigFor(level: number): LevelConfig {
  // cautiousRatio 按原作：L1–5 只有黑船（0%），L6–10 混入 30%，L11+ 混入 60%
  let cautiousRatio = 0;
  if (level >= 11) cautiousRatio = 0.6;
  else if (level >= 6) cautiousRatio = 0.3;
  return {
    width: BOARD_W,
    height: BOARD_H,
    islands: [3, 6],
    reefs: [2, 4],
    // N≥6 保证至少 1 个漩涡（逃生道具）
    vortexes: [level >= 6 ? 1 : 0, 2],
    enemies: Math.min(3 + Math.floor(0.8 * level), MAX_ENEMIES),
    fastEnemies: level < 4 ? 0 : Math.min(1 + Math.floor((level - 4) / 3), MAX_FAST),
    cautiousRatio,
    minSpawnDist: 4,
    minEnemyGap: 2,
    connectivity: 0.8,
  };
}

/** 肉鸽 15 关配置：Boss 关低障碍、漩涡下限恒 1；reefGarden 使礁石两端 +3 */
export function rogueLevelConfigFor(level: number, reefGarden = false): LevelConfig {
  // cautiousRatio（原作红船比例）：L6–10 混入 ≈33%，L11–15 混入 ≈60%
  const cautiousRatio = level >= 11 ? 0.6 : level >= 6 ? 0.33 : 0;
  const table: Record<number, { enemies: number; fastEnemies: number; flagshipHp?: number; islands: [number, number]; reefs: [number, number] }> = {
    1: { enemies: 3, fastEnemies: 0, islands: [3, 5], reefs: [2, 4] },
    2: { enemies: 4, fastEnemies: 0, islands: [3, 5], reefs: [2, 4] },
    3: { enemies: 4, fastEnemies: 1, islands: [3, 6], reefs: [2, 4] },
    4: { enemies: 5, fastEnemies: 1, islands: [3, 6], reefs: [2, 4] },
    5: { enemies: 3, fastEnemies: 0, flagshipHp: 3, islands: [3, 5], reefs: [2, 3] },
    6: { enemies: 6, fastEnemies: 1, islands: [3, 6], reefs: [2, 4] },
    7: { enemies: 6, fastEnemies: 2, islands: [3, 6], reefs: [2, 4] },
    8: { enemies: 7, fastEnemies: 2, islands: [4, 6], reefs: [2, 4] },
    9: { enemies: 8, fastEnemies: 2, islands: [4, 6], reefs: [2, 4] },
    10: { enemies: 4, fastEnemies: 1, flagshipHp: 4, islands: [3, 5], reefs: [2, 3] },
    11: { enemies: 8, fastEnemies: 3, islands: [4, 7], reefs: [3, 5] },
    12: { enemies: 9, fastEnemies: 3, islands: [4, 7], reefs: [3, 5] },
    13: { enemies: 10, fastEnemies: 3, islands: [4, 7], reefs: [3, 5] },
    14: { enemies: 11, fastEnemies: 4, islands: [4, 7], reefs: [3, 5] },
    15: { enemies: 5, fastEnemies: 2, flagshipHp: 5, islands: [3, 5], reefs: [2, 3] },
  };
  const row = table[Math.min(Math.max(level, 1), 15)]!;
  const reefs: [number, number] = reefGarden ? [row.reefs[0] + 3, row.reefs[1] + 3] : row.reefs;
  return {
    width: BOARD_W,
    height: BOARD_H,
    vortexes: [1, 2],
    minSpawnDist: 4,
    minEnemyGap: 2,
    connectivity: 0.8,
    cautiousRatio,
    ...row,
    reefs,
  };
}

/** 从 from 出发的可通行（水/漩涡）8 连通块 */
export function floodFillPassable(
  terrain: Terrain[],
  from: number,
  w: number,
  h: number,
): Set<number> {
  const passable = (i: number) => terrain[i] === 'water' || terrain[i] === 'vortex';
  const seen = new Set<number>();
  if (!passable(from)) return seen;
  seen.add(from);
  const stack = [from];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const n of neighbors8(cur, w, h)) {
      if (!seen.has(n) && passable(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

export interface BoardParts {
  terrain: Terrain[];
  playerPos: number;
  enemies: EnemyShip[];
}

/**
 * 生成一张满足公平性约束的棋盘。
 * 约束：1) 出生点界内邻格全水  2) 敌距玩家 cheb≥minSpawnDist
 *       3) 玩家连通块 ≥ 可通行格×connectivity  4) 敌 ∈ 玩家连通块
 *       附) 敌间 cheb≥minEnemyGap（防开局白送互撞）
 */
export function generateBoard(config: LevelConfig, levelSeed: number): BoardParts {
  const { width: w, height: h } = config;
  const cells = w * h;
  const rng = createRng(levelSeed);

  for (let attempt = 0; attempt < 100; attempt++) {
    const relax = Math.floor(attempt / 20);
    const nIslands = Math.max(0, rng.range(config.islands[0], config.islands[1]) - relax);
    const nReefs = Math.max(0, rng.range(config.reefs[0], config.reefs[1]) - relax);
    const nVortexes = Math.max(0, rng.range(config.vortexes[0], config.vortexes[1]) - relax);

    // 撒障碍：洗牌全格序列，依序取前 n 个（k 守卫防极端 config 越界）
    const terrain: Terrain[] = new Array<Terrain>(cells).fill('water');
    const order = rng.shuffle(Array.from({ length: cells }, (_, i) => i));
    let k = 0;
    for (let i = 0; i < nIslands && k < cells; i++) terrain[order[k++]!] = 'island';
    for (let i = 0; i < nReefs && k < cells; i++) terrain[order[k++]!] = 'reef';
    for (let i = 0; i < nVortexes && k < cells; i++) terrain[order[k++]!] = 'vortex';

    // 约束 1：出生点为水且界内邻格全水（漩涡此处视为障碍，保守）
    const spawnCandidates: number[] = [];
    for (let i = 0; i < cells; i++) {
      if (terrain[i] !== 'water') continue;
      if (neighbors8(i, w, h).every((n) => terrain[n] === 'water')) spawnCandidates.push(i);
    }
    if (spawnCandidates.length === 0) continue;
    const playerPos = rng.pick(spawnCandidates);

    // 约束 3：连通率
    const region = floodFillPassable(terrain, playerPos, w, h);
    let totalPassable = 0;
    for (let i = 0; i < cells; i++) {
      if (terrain[i] === 'water' || terrain[i] === 'vortex') totalPassable++;
    }
    if (region.size < Math.ceil(totalPassable * config.connectivity)) continue;

    // 约束 2 + 4 + 敌间距
    const gap = relax >= 3 ? 1 : config.minEnemyGap;
    let pool = [...region].filter(
      (i) => terrain[i] === 'water' && chebyshev(i, playerPos, w) >= config.minSpawnDist,
    );
    const positions: number[] = [];
    for (let e = 0; e < config.enemies && pool.length > 0; e++) {
      const pos = rng.pick(pool);
      positions.push(pos);
      pool = pool.filter((i) => chebyshev(i, pos, w) >= gap);
    }
    if (positions.length < config.enemies) continue;

    // 快速海盗分配到随机位置；Boss 关第 1 艘固定为旗舰（id=1）
    const flagshipPos = config.flagshipHp !== undefined ? positions[0] : undefined;
    const fastPool = config.flagshipHp !== undefined ? positions.slice(1) : [...positions];
    const fastSet = new Set(rng.shuffle(fastPool).slice(0, config.fastEnemies));
    const enemies: EnemyShip[] = positions.map((pos, i) => {
      const isFlagship = flagshipPos === pos;
      const kind = isFlagship ? 'flagship' : fastSet.has(pos) ? 'fastPirate' : 'pirate';
      // AI 赋值：旗舰恒 reckless（靠旗舰子阶段驱动），cautious 只给非旗舰
      const ai = !isFlagship && rng.next() < config.cautiousRatio ? 'cautious' as const : 'reckless' as const;
      return {
        id: i + 1,
        kind,
        pos,
        facing: dirFromTo(pos, playerPos, w),
        hp: isFlagship ? config.flagshipHp! : 1,
        ai,
      };
    });
    return { terrain, playerPos, enemies };
  }

  return fallbackBoard(config);
}

/** 确定性保底关：全水、玩家居中、敌沿边缘均布（理论上仅极端 config 触发） */
function fallbackBoard(config: LevelConfig): BoardParts {
  const { width: w, height: h } = config;
  const terrain: Terrain[] = new Array<Terrain>(w * h).fill('water');
  const playerPos = Math.floor(h / 2) * w + Math.floor(w / 2);

  // 边缘格顺时针序
  const border: number[] = [];
  for (let c = 0; c < w; c++) border.push(c);
  for (let r = 1; r < h - 1; r++) border.push(r * w + (w - 1));
  for (let c = w - 1; c >= 0; c--) border.push((h - 1) * w + c);
  for (let r = h - 2; r >= 1; r--) border.push(r * w);

  const eligible = border.filter((i) => chebyshev(i, playerPos, w) >= config.minSpawnDist);
  const n = Math.min(config.enemies, 8, eligible.length);
  const stride = eligible.length / Math.max(1, n);
  const enemies: EnemyShip[] = [];
  for (let i = 0; i < n; i++) {
    const pos = eligible[Math.floor(i * stride)]!;
    const isFlagship = config.flagshipHp !== undefined && i === 0;
    enemies.push({
      id: i + 1,
      kind: isFlagship ? 'flagship' : 'pirate',
      pos,
      facing: dirFromTo(pos, playerPos, w),
      hp: isFlagship ? config.flagshipHp! : 1,
      ai: 'reckless' as const,
    });
  }
  return { terrain, playerPos, enemies };
}

// ===== 对局构造 =====

/** 开新对局（第 1 关，关卡制） */
export function newRun(runSeed: number, stats: PlayerStats = DEFAULT_STATS): GameState {
  const config = levelConfigFor(1);
  const levelSeed = deriveSeed(runSeed, 1);
  const board = generateBoard(config, levelSeed);
  return {
    width: config.width,
    height: config.height,
    terrain: board.terrain,
    player: { pos: board.playerPos, facing: 'N' },
    enemies: board.enemies,
    lives: stats.startLives,
    score: 0,
    level: 1,
    nextExtraLifeAt: stats.extraLifeEvery,
    stats: { ...stats }, // 克隆：防调用方（或默认值）被引用共享后误改
    mode: 'levels',
    abilities: [],
    runSeed,
    rngState: deriveSeed(levelSeed, RUN_SALT),
    phase: 'playing',
    turn: 0,
  };
}

/** 开新肉鸽 run（15 关，禁用奖命，船体上限 5） */
export function newRogueRun(runSeed: number): GameState {
  const stats: PlayerStats = { cannonRange: 3, startLives: 3, extraLifeEvery: 0, maxLives: 5 };
  const config = rogueLevelConfigFor(1);
  const levelSeed = deriveSeed(runSeed, 1);
  const board = generateBoard(config, levelSeed);
  return {
    width: config.width,
    height: config.height,
    terrain: board.terrain,
    player: { pos: board.playerPos, facing: 'N' },
    enemies: board.enemies,
    lives: stats.startLives,
    score: 0,
    level: 1,
    nextExtraLifeAt: Number.MAX_SAFE_INTEGER,
    stats,
    mode: 'rogue',
    abilities: [],
    runSeed,
    rngState: deriveSeed(levelSeed, RUN_SALT),
    phase: 'playing',
    turn: 0,
  };
}

/** 进入指定关卡：继承命/分/门槛/能力，按 mode 分派生成配置 */
export function startLevel(prev: GameState, level: number): GameState {
  const config = prev.mode === 'rogue' ? rogueLevelConfigFor(level, prev.abilities.includes('reefGarden')) : levelConfigFor(level);
  const levelSeed = deriveSeed(prev.runSeed, level);
  const board = generateBoard(config, levelSeed);
  return {
    width: config.width,
    height: config.height,
    terrain: board.terrain,
    player: { pos: board.playerPos, facing: 'N' },
    enemies: board.enemies,
    lives: prev.lives,
    score: prev.score,
    level,
    nextExtraLifeAt: prev.nextExtraLifeAt,
    stats: { ...prev.stats },
    mode: prev.mode,
    abilities: [...prev.abilities],
    runSeed: prev.runSeed,
    rngState: deriveSeed(levelSeed, RUN_SALT),
    phase: 'playing',
    turn: 0,
  };
}

export { rollDraft };
