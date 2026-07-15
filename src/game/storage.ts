// ===== localStorage 存储层 =====
// 所有读写集中在此文件。key 统一前缀 'broadside:'（与同域下的 sudoku 隔离）。
// 关卡制与肉鸽各用独立存档 key，互不覆盖；normalizeRun 规范化层
// 为旧版本存档补默认字段（免版本号迁移），残档解析失败返回 null。

import type { EnemyShip, GameMode, GameState, ShipKind } from '../engine/types';
import { DEFAULT_STATS } from '../engine/types';

const PREFIX = 'broadside:';
const KEY_BEST = `${PREFIX}best`;
const KEY_RUN = `${PREFIX}run`;
const KEY_ROGUE = `${PREFIX}rogueRun`;

const runKey = (mode: GameMode) => (mode === 'rogue' ? KEY_ROGUE : KEY_RUN);

// ── 最高纪录 ──────────────────────────────────

export interface BestRecord {
  /** 关卡制最高分 / 最高关 */
  bestScore: number;
  bestLevel: number;
  /** 肉鸽最深到达关 / 通关次数 */
  rogueBestLevel: number;
  rogueWins: number;
}

export const DEFAULT_BEST: BestRecord = {
  bestScore: 0,
  bestLevel: 0,
  rogueBestLevel: 0,
  rogueWins: 0,
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

export function loadBest(): BestRecord {
  return safeParse(localStorage.getItem(KEY_BEST), DEFAULT_BEST);
}

export function saveBest(record: BestRecord): void {
  localStorage.setItem(KEY_BEST, JSON.stringify(record));
}

/** 用对局结果冲击纪录，返回更新后的纪录 */
export function updateBest(
  score: number,
  level: number,
  mode: GameMode = 'levels',
  won = false,
): BestRecord {
  const best = loadBest();
  const next: BestRecord =
    mode === 'rogue'
      ? {
          ...best,
          rogueBestLevel: Math.max(best.rogueBestLevel, level),
          rogueWins: best.rogueWins + (won ? 1 : 0),
          bestScore: Math.max(best.bestScore, score),
        }
      : {
          ...best,
          bestScore: Math.max(best.bestScore, score),
          bestLevel: Math.max(best.bestLevel, level),
        };
  saveBest(next);
  return next;
}

// ── 对局存档（续玩）──────────────────────────────

const KNOWN_KINDS: readonly ShipKind[] = ['pirate', 'fastPirate', 'flagship'];

/**
 * 存档规范化：为旧版本档补默认字段、校验关键结构。
 * 对完整新档幂等（不改任何值）。不可救的残档返回 null。
 */
function normalizeRun(parsed: unknown): GameState | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Partial<GameState>;
  if (typeof p.width !== 'number' || typeof p.height !== 'number') return null;
  if (!Array.isArray(p.terrain) || !Array.isArray(p.enemies)) return null;
  if (!p.player || typeof p.player.pos !== 'number') return null;
  // 已结束的局不可续玩
  if (p.phase === 'gameOver' || p.phase === 'victory') return null;

  const stats = { ...DEFAULT_STATS, ...(p.stats ?? {}) };
  const nextExtra =
    typeof p.nextExtraLifeAt === 'number' && Number.isFinite(p.nextExtraLifeAt)
      ? p.nextExtraLifeAt
      : stats.extraLifeEvery > 0
        ? stats.extraLifeEvery
        : Number.MAX_SAFE_INTEGER;

  return {
    ...(p as GameState),
    stats,
    mode: p.mode === 'rogue' ? 'rogue' : 'levels',
    abilities: Array.isArray(p.abilities) ? p.abilities : [],
    enemies: (p.enemies as Partial<EnemyShip>[]).map((e) => ({
      ...(e as EnemyShip),
      hp: typeof e.hp === 'number' && e.hp > 0 ? e.hp : 1,
      ai: e.ai === 'cautious' ? 'cautious' : 'reckless',
      kind: KNOWN_KINDS.includes(e.kind as ShipKind) ? (e.kind as ShipKind) : 'pirate',
    })),
    nextExtraLifeAt: nextExtra,
  };
}

export function loadRun(mode: GameMode = 'levels'): GameState | null {
  const raw = localStorage.getItem(runKey(mode));
  if (!raw) return null;
  try {
    return normalizeRun(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveRun(state: GameState): void {
  localStorage.setItem(runKey(state.mode), JSON.stringify(state));
}

export function clearRun(mode: GameMode = 'levels'): void {
  localStorage.removeItem(runKey(mode));
}
