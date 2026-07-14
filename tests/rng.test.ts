// ===== rng.ts 单测：确定性、续跑一致性、分布边界 =====
import { createRng, deriveSeed } from '../src/engine/rng';

describe('createRng', () => {
  it('同种子产生完全相同的序列', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('不同种子产生不同序列', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('state() 续跑与原流完全一致', () => {
    const a = createRng(777);
    a.next();
    a.next();
    const mid = a.state();
    const rest = Array.from({ length: 20 }, () => a.next());

    const b = createRng(mid);
    const resumed = Array.from({ length: 20 }, () => b.next());
    expect(resumed).toEqual(rest);
  });

  it('next() 落在 [0, 1)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) 落在 [0, n) 且覆盖全域', () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it('range(min, max) 闭区间且覆盖两端', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(2, 4);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it('pick 空数组抛错', () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow();
  });

  it('shuffle 是排列（元素不增不减）且同种子确定', () => {
    const a = createRng(555);
    const b = createRng(555);
    const arrA = a.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const arrB = b.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(arrA).toEqual(arrB);
    expect([...arrA].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('deriveSeed', () => {
  it('确定性：同 (seed, salt) 同结果', () => {
    expect(deriveSeed(42, 3)).toBe(deriveSeed(42, 3));
  });

  it('不同 salt 派生不同种子（关卡间布局独立）', () => {
    const seeds = new Set<number>();
    for (let level = 1; level <= 50; level++) {
      seeds.add(deriveSeed(42, level));
    }
    expect(seeds.size).toBe(50);
  });

  it('结果是 uint32', () => {
    for (const s of [0, 1, 0xffffffff, 12345]) {
      const v = deriveSeed(s, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
