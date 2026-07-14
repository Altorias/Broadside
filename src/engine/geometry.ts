// ===== 棋盘几何：8 方向环、舷侧、一维索引 =====
// 所有函数接收 w（必要时 h）参数，引擎不持有全局尺寸——LevelConfig 可变。

import type { Dir8 } from './types';

/** 8 朝向顺时针环。舷侧 = 环上偏移：左舷 +6（-90°），右舷 +2（+90°） */
export const DIRS: readonly Dir8[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** 方向 → [dr, dc]（行向下增长） */
export const DIR_VEC: Record<Dir8, readonly [number, number]> = {
  N: [-1, 0],
  NE: [-1, 1],
  E: [0, 1],
  SE: [1, 1],
  S: [1, 0],
  SW: [1, -1],
  W: [0, -1],
  NW: [-1, -1],
};

/** 方向 → 渲染角度（度，N=0 顺时针） */
export const DIR_ANGLE: Record<Dir8, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

const DIR_INDEX: Record<Dir8, number> = { N: 0, NE: 1, E: 2, SE: 3, S: 4, SW: 5, W: 6, NW: 7 };

/** 左舷方向（面 N 时为 W） */
export function portOf(d: Dir8): Dir8 {
  return DIRS[(DIR_INDEX[d] + 6) % 8]!;
}

/** 右舷方向（面 N 时为 E） */
export function starboardOf(d: Dir8): Dir8 {
  return DIRS[(DIR_INDEX[d] + 2) % 8]!;
}

// ===== 一维索引 =====

export function idx(row: number, col: number, w: number): number {
  return row * w + col;
}

export function rowOf(i: number, w: number): number {
  return Math.floor(i / w);
}

export function colOf(i: number, w: number): number {
  return i % w;
}

export function inBounds(row: number, col: number, w: number, h: number): boolean {
  return row >= 0 && row < h && col >= 0 && col < w;
}

/** 从 i 沿 dir 走一格；出界返回 -1 */
export function step(i: number, dir: Dir8, w: number, h: number): number {
  const [dr, dc] = DIR_VEC[dir];
  const r = rowOf(i, w) + dr;
  const c = colOf(i, w) + dc;
  return inBounds(r, c, w, h) ? idx(r, c, w) : -1;
}

/** 切比雪夫距离（王步距离） */
export function chebyshev(a: number, b: number, w: number): number {
  return Math.max(Math.abs(rowOf(a, w) - rowOf(b, w)), Math.abs(colOf(a, w) - colOf(b, w)));
}

/** 从 from 指向 to 的 8 向方向（按 dr/dc 符号；from === to 时抛错） */
export function dirFromTo(from: number, to: number, w: number): Dir8 {
  const dr = Math.sign(rowOf(to, w) - rowOf(from, w));
  const dc = Math.sign(colOf(to, w) - colOf(from, w));
  for (const d of DIRS) {
    if (DIR_VEC[d][0] === dr && DIR_VEC[d][1] === dc) return d;
  }
  throw new Error(`dirFromTo: from === to (${from})`);
}

/** i 的 8 邻格（界内） */
export function neighbors8(i: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (const d of DIRS) {
    const n = step(i, d, w, h);
    if (n !== -1) out.push(n);
  }
  return out;
}
