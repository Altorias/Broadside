// ===== 种子随机（mulberry32）=====
// 内部状态是单个 uint32，"种子"与"续跑状态"同构：
// createRng(seedOrState) 一个入口既可开新流、也可从 GameState.rngState 续跑。

export interface Rng {
  /** [0, 1) 均匀浮点 */
  next(): number;
  /** [0, n) 均匀整数 */
  int(n: number): number;
  /** [min, max] 闭区间均匀整数 */
  range(min: number, max: number): number;
  /** 均匀抽取数组一项（空数组抛错） */
  pick<T>(arr: readonly T[]): T;
  /** Fisher–Yates 原地洗牌，返回同一数组 */
  shuffle<T>(arr: T[]): T[];
  /** 当前内部状态（uint32），存入 GameState.rngState 可精确续跑 */
  state(): number;
}

export function createRng(seedOrState: number): Rng {
  let a = seedOrState >>> 0;

  function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => {
      if (arr.length === 0) throw new Error('rng.pick: 空数组');
      return arr[Math.floor(next() * arr.length)]!;
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = arr[i]!;
        arr[i] = arr[j]!;
        arr[j] = tmp;
      }
      return arr;
    },
    state: () => a >>> 0,
  };
}

/** 从 (seed, salt) 确定性派生新种子（splitmix 风格雪崩混合） */
export function deriveSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
