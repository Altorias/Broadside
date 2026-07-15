// ===== 敌船 AI：贪心逼近 + 绕障 =====
// reckless（原作黑船）：dr/dc 各取符号朝玩家走一步——不避障、不避同伴。
// cautious（原作红船）：同样贪心方向，但目标格若为障碍/漩涡，则尝试
//   绕行（正交分量为先，对角次之）；所有 8 邻格都是障碍时才硬闯。
//   旗舰（flagship）逻辑独立于 AI 标签：碾礁石/残骸在 rules.ts 子阶段处理。

import type { EnemyShip, Terrain } from './types';
import { colOf, idx, neighbors8, rowOf } from './geometry';

/**
 * 贪心一步（不避障）：切比雪夫距离每步严格 -1，永不振荡。
 * 前提：enemyPos !== playerPos（敌在玩家格的状态不存在——撞击即沉）。
 * 界内性免检：玩家在界内 ⇒ 朝玩家的符号步不可能出界。
 */
export function enemyIntent(enemyPos: number, playerPos: number, w: number): number {
  const er = rowOf(enemyPos, w);
  const ec = colOf(enemyPos, w);
  const dr = Math.sign(rowOf(playerPos, w) - er);
  const dc = Math.sign(colOf(playerPos, w) - ec);
  return idx(er + dr, ec + dc, w);
}

/**
 * 贪心但绕开障碍/漩涡（原作红船）。
 * 优先朝玩家的方向走，如果目标格不可走（岛/礁/残骸/漩涡），
 * 则尝试正交分量方向（取 dr 或 dc 其中一个），再试对角，再试剩余的 8 邻格。
 * 全部不可走时才硬闯（退化到纯贪心）。
 * 对"其他敌船占据的格"不做避让——这是冲突结算的范畴，AI 不负责。
 */
export function cautiousIntent(
  ship: EnemyShip,
  playerPos: number,
  terrain: Terrain[],
  w: number,
  h: number,
): number {
  const er = rowOf(ship.pos, w);
  const ec = colOf(ship.pos, w);
  const dr = Math.sign(rowOf(playerPos, w) - er);
  const dc = Math.sign(colOf(playerPos, w) - ec);

  // 不可走判定（漩涡只在 cautious AI 不可走；reckless 直冲）
  const blocked = (i: number) => {
    if (i === -1) return true;
    const t = terrain[i];
    return t === 'island' || t === 'reef' || t === 'wreck' || t === 'vortex';
  };

  // 优先：纯贪心步
  const primary = idx(er + dr, ec + dc, w);
  if (!blocked(primary)) return primary;

  // Plan B：正交分量（相对"安全"的方向）
  const ortho: number[] = [];
  for (const pair of [[dr, 0], [0, dc]] as const) {
    const dRow = pair[0];
    const dCol = pair[1];

    if (dRow === 0 && dCol === 0) continue;
    if (dRow === dr && dCol === dc) continue; // 已试过 primary
    if (dRow === 0 && dCol === 0) continue;
    const i = idx(er + dRow, ec + dCol, w);
    if (!blocked(i)) ortho.push(i);
  }
  if (ortho.length > 0) {
    // 选离玩家更近的
    return ortho.reduce((best, i) => {
      const bd = Math.abs(rowOf(best, w) - rowOf(playerPos, w)) + Math.abs(colOf(best, w) - colOf(playerPos, w));
      const id = Math.abs(rowOf(i, w) - rowOf(playerPos, w)) + Math.abs(colOf(i, w) - colOf(playerPos, w));
      return id < bd ? i : best;
    });
  }

  // primary 已是 dr+dc 双轴步，正交分量即 Plan C。
  // 剩余 8 邻格中选一个不 blocked 且离玩家最近的
  const rest = neighbors8(ship.pos, w, h).filter((n) => !blocked(n));
  if (rest.length > 0) {
    return rest.reduce((best, i) => {
      const bd = Math.abs(rowOf(best, w) - rowOf(playerPos, w)) + Math.abs(colOf(best, w) - colOf(playerPos, w));
      const id = Math.abs(rowOf(i, w) - rowOf(playerPos, w)) + Math.abs(colOf(i, w) - colOf(playerPos, w));
      return id < bd ? i : best;
    });
  }

  // 绝路：硬闯
  return primary;
}

/** 根据 AI 标签选择意图函数 */
export function intentFor(
  ship: EnemyShip,
  playerPos: number,
  terrain: Terrain[],
  w: number,
  h: number,
): number {
  if (ship.ai === 'cautious' && ship.kind !== 'flagship') {
    return cautiousIntent(ship, playerPos, terrain, w, h);
  }
  return enemyIntent(ship.pos, playerPos, w);
}
