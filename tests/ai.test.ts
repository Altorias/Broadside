// ===== ai.ts 单测：贪心逼近的确定性与收敛性 =====
import { enemyIntent } from '../src/engine/ai';
import { chebyshev, idx } from '../src/engine/geometry';

const w = 12;

describe('enemyIntent', () => {
  it('双轴偏差：对角逼近', () => {
    // 敌 (2,2)、玩家 (5,6) → 意图 (3,3)
    expect(enemyIntent(idx(2, 2, w), idx(5, 6, w), w)).toBe(idx(3, 3, w));
  });

  it('单轴偏差：直线逼近', () => {
    // 同行
    expect(enemyIntent(idx(4, 2, w), idx(4, 9, w), w)).toBe(idx(4, 3, w));
    // 同列
    expect(enemyIntent(idx(7, 5, w), idx(1, 5, w), w)).toBe(idx(6, 5, w));
  });

  it('相邻时意图 = 玩家格（撞击）', () => {
    expect(enemyIntent(idx(3, 3, w), idx(4, 4, w), w)).toBe(idx(4, 4, w));
  });

  it('边界不越界：玩家在界内 ⇒ 符号步必在界内', () => {
    const h = 9;
    const player = idx(4, 6, w);
    // 敌船在四角，朝玩家走必不出界
    for (const corner of [idx(0, 0, w), idx(0, 11, w), idx(8, 0, w), idx(8, 11, w)]) {
      const intent = enemyIntent(corner, player, w);
      const r = Math.floor(intent / w);
      const c = intent % w;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(h);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(w);
    }
  });

  it('切比雪夫距离每步严格 -1（永不振荡）', () => {
    const player = idx(4, 6, w);
    // 从所有非玩家格出发走到底，距离单调递减
    for (let start = 0; start < 12 * 9; start++) {
      if (start === player) continue;
      let pos = start;
      let guard = 0;
      while (pos !== player) {
        const next = enemyIntent(pos, player, w);
        expect(chebyshev(next, player, w)).toBe(chebyshev(pos, player, w) - 1);
        pos = next;
        if (++guard > 20) throw new Error('AI 不收敛');
      }
    }
  });
});
