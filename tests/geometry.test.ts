// ===== geometry.ts 单测：方向环、舷侧、索引换算、越界 =====
import type { Dir8 } from '../src/engine/types';
import {
  DIRS,
  DIR_VEC,
  DIR_ANGLE,
  portOf,
  starboardOf,
  idx,
  rowOf,
  colOf,
  inBounds,
  step,
  chebyshev,
  dirFromTo,
  neighbors8,
} from '../src/engine/geometry';

describe('方向环与舷侧', () => {
  it('全 8 向的左右舷映射（垂直关系）', () => {
    const expected: Record<Dir8, [Dir8, Dir8]> = {
      // facing: [port(左舷), starboard(右舷)]
      N: ['W', 'E'],
      NE: ['NW', 'SE'],
      E: ['N', 'S'],
      SE: ['NE', 'SW'],
      S: ['E', 'W'],
      SW: ['SE', 'NW'],
      W: ['S', 'N'],
      NW: ['SW', 'NE'],
    };
    for (const d of DIRS) {
      expect(portOf(d)).toBe(expected[d][0]);
      expect(starboardOf(d)).toBe(expected[d][1]);
    }
  });

  it('左右舷恒相差 180°', () => {
    for (const d of DIRS) {
      const diff = (DIR_ANGLE[starboardOf(d)] - DIR_ANGLE[portOf(d)] + 360) % 360;
      expect(diff).toBe(180);
    }
  });

  it('DIR_VEC 是单位王步向量', () => {
    for (const d of DIRS) {
      const [dr, dc] = DIR_VEC[d];
      expect(Math.max(Math.abs(dr), Math.abs(dc))).toBe(1);
    }
  });
});

describe('索引换算', () => {
  const w = 12;
  it('idx/rowOf/colOf 往返一致', () => {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < w; c++) {
        const i = idx(r, c, w);
        expect(rowOf(i, w)).toBe(r);
        expect(colOf(i, w)).toBe(c);
      }
    }
  });

  it('inBounds 边界判定', () => {
    expect(inBounds(0, 0, 12, 9)).toBe(true);
    expect(inBounds(8, 11, 12, 9)).toBe(true);
    expect(inBounds(-1, 0, 12, 9)).toBe(false);
    expect(inBounds(0, -1, 12, 9)).toBe(false);
    expect(inBounds(9, 0, 12, 9)).toBe(false);
    expect(inBounds(0, 12, 12, 9)).toBe(false);
  });
});

describe('step', () => {
  const w = 12;
  const h = 9;
  it('界内移动正确', () => {
    const center = idx(4, 6, w);
    expect(step(center, 'N', w, h)).toBe(idx(3, 6, w));
    expect(step(center, 'SE', w, h)).toBe(idx(5, 7, w));
    expect(step(center, 'W', w, h)).toBe(idx(4, 5, w));
  });

  it('出界返回 -1（四角全测）', () => {
    expect(step(idx(0, 0, w), 'N', w, h)).toBe(-1);
    expect(step(idx(0, 0, w), 'W', w, h)).toBe(-1);
    expect(step(idx(0, 0, w), 'NW', w, h)).toBe(-1);
    expect(step(idx(8, 11, w), 'S', w, h)).toBe(-1);
    expect(step(idx(8, 11, w), 'E', w, h)).toBe(-1);
    expect(step(idx(8, 11, w), 'SE', w, h)).toBe(-1);
    expect(step(idx(0, 11, w), 'NE', w, h)).toBe(-1);
    expect(step(idx(8, 0, w), 'SW', w, h)).toBe(-1);
  });
});

describe('chebyshev / dirFromTo / neighbors8', () => {
  const w = 12;
  const h = 9;
  it('切比雪夫距离', () => {
    expect(chebyshev(idx(0, 0, w), idx(3, 4, w), w)).toBe(4);
    expect(chebyshev(idx(2, 2, w), idx(2, 2, w), w)).toBe(0);
    expect(chebyshev(idx(5, 5, w), idx(6, 6, w), w)).toBe(1);
  });

  it('dirFromTo 全 8 向', () => {
    const c = idx(4, 6, w);
    expect(dirFromTo(c, idx(3, 6, w), w)).toBe('N');
    expect(dirFromTo(c, idx(3, 7, w), w)).toBe('NE');
    expect(dirFromTo(c, idx(4, 7, w), w)).toBe('E');
    expect(dirFromTo(c, idx(5, 7, w), w)).toBe('SE');
    expect(dirFromTo(c, idx(5, 6, w), w)).toBe('S');
    expect(dirFromTo(c, idx(5, 5, w), w)).toBe('SW');
    expect(dirFromTo(c, idx(4, 5, w), w)).toBe('W');
    expect(dirFromTo(c, idx(3, 5, w), w)).toBe('NW');
    // 远距离也按符号取向
    expect(dirFromTo(idx(0, 0, w), idx(8, 2, w), w)).toBe('SE');
  });

  it('dirFromTo 自身抛错', () => {
    expect(() => dirFromTo(5, 5, w)).toThrow();
  });

  it('neighbors8 中心 8 个、角 3 个、边 5 个', () => {
    expect(neighbors8(idx(4, 6, w), w, h)).toHaveLength(8);
    expect(neighbors8(idx(0, 0, w), w, h)).toHaveLength(3);
    expect(neighbors8(idx(0, 5, w), w, h)).toHaveLength(5);
  });
});
