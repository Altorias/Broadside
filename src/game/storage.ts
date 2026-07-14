// ===== localStorage 存储层 =====
// 所有读写集中在此文件。key 统一前缀 'broadside:'（与同域下的 sudoku 隔离）。
// BestRecord 用 "默认值展开 + 存档覆盖" 实现免版本号迁移；
// 对局存档（GameState 整体 JSON）残档无意义，解析失败返回 null。

import type { GameState } from '../engine/types';

const PREFIX = 'broadside:';
const KEY_BEST = `${PREFIX}best`;
const KEY_RUN = `${PREFIX}run`;

// ── 最高纪录 ──────────────────────────────────

export interface BestRecord {
  bestScore: number;
  bestLevel: number;
}

export const DEFAULT_BEST: BestRecord = { bestScore: 0, bestLevel: 0 };

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
export function updateBest(score: number, level: number): BestRecord {
  const best = loadBest();
  const next: BestRecord = {
    bestScore: Math.max(best.bestScore, score),
    bestLevel: Math.max(best.bestLevel, level),
  };
  saveBest(next);
  return next;
}

// ── 对局存档（续玩）──────────────────────────────

export function loadRun(): GameState | null {
  const raw = localStorage.getItem(KEY_RUN);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameState;
    // 最小结构校验 + 已结束的局不可续玩
    if (typeof parsed.width !== 'number' || !Array.isArray(parsed.terrain)) return null;
    if (!parsed.player || typeof parsed.player.pos !== 'number') return null;
    if (parsed.phase === 'gameOver') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRun(state: GameState): void {
  localStorage.setItem(KEY_RUN, JSON.stringify(state));
}

export function clearRun(): void {
  localStorage.removeItem(KEY_RUN);
}
