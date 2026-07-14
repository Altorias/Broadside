// ===== 测试辅助：ASCII 地图 → GameState =====
// 字符表：~ 或 . 水 | # 岛 | R 礁 | V 漩涡 | W 残骸
//         P 玩家（朝向由 opts.facing 指定，默认 N）
//         1-9 普通海盗（id = 数字）| F/G/H 快速海盗（id = 10/11/12）

import type {
  Dir8,
  EnemyShip,
  GameState,
  PlayerStats,
  Terrain,
} from '../src/engine/types';
import { DEFAULT_STATS } from '../src/engine/types';

const TERRAIN_CHAR: Record<string, Terrain> = {
  '~': 'water',
  '.': 'water',
  '#': 'island',
  R: 'reef',
  V: 'vortex',
  W: 'wreck',
};

export interface MakeOptions {
  facing?: Dir8;
  lives?: number;
  score?: number;
  level?: number;
  stats?: Partial<PlayerStats>;
  rngState?: number;
  nextExtraLifeAt?: number;
}

export function makeState(map: string, opts: MakeOptions = {}): GameState {
  const lines = map
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const h = lines.length;
  const w = lines[0]!.length;
  const terrain: Terrain[] = new Array<Terrain>(w * h).fill('water');
  let player = -1;
  const enemies: EnemyShip[] = [];

  for (let r = 0; r < h; r++) {
    const line = lines[r]!;
    if (line.length !== w) throw new Error(`行 ${r} 宽度 ${line.length} ≠ ${w}`);
    for (let c = 0; c < w; c++) {
      const ch = line[c]!;
      const i = r * w + c;
      const t = TERRAIN_CHAR[ch];
      if (t) {
        terrain[i] = t;
      } else if (ch === 'P') {
        player = i;
      } else if (ch >= '1' && ch <= '9') {
        enemies.push({ id: Number(ch), kind: 'pirate', pos: i, facing: 'S' });
      } else if (ch >= 'F' && ch <= 'H') {
        enemies.push({ id: 10 + ch.charCodeAt(0) - 70, kind: 'fastPirate', pos: i, facing: 'S' });
      } else {
        throw new Error(`未知字符 '${ch}'`);
      }
    }
  }
  if (player === -1) throw new Error('地图缺少玩家 P');
  enemies.sort((a, b) => a.id - b.id);

  const stats: PlayerStats = { ...DEFAULT_STATS, ...opts.stats };
  return {
    width: w,
    height: h,
    terrain,
    player: { pos: player, facing: opts.facing ?? 'N' },
    enemies,
    lives: opts.lives ?? stats.startLives,
    score: opts.score ?? 0,
    level: opts.level ?? 1,
    nextExtraLifeAt: opts.nextExtraLifeAt ?? stats.extraLifeEvery,
    stats,
    runSeed: 42,
    rngState: opts.rngState ?? 123456789,
    phase: 'playing',
    turn: 0,
  };
}

/** 行列 → 一维索引（与地图行序一致） */
export function at(r: number, c: number, w: number): number {
  return r * w + c;
}

/** 递归冻结，用于纯函数性断言（严格模式下写冻结对象抛 TypeError） */
export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}
