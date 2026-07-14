// ===== 敌船 AI：贪心逼近 =====
// dr/dc 各取符号朝玩家走一步——切比雪夫距离每步严格 -1，永不振荡；
// 不避障、不避同伴（"引诱"机制的根基）。确定性纯函数，无 RNG。

import { colOf, idx, rowOf } from './geometry';

/**
 * 敌船本微步的意图目标格。
 * 前提：enemyPos !== playerPos（敌在玩家格的状态不存在——撞击即沉）。
 * 界内性免检：玩家在界内 ⇒ 朝玩家的符号步不可能出界。
 */
export function enemyIntent(enemyPos: number, playerPos: number, w: number): number {
  const dr = Math.sign(rowOf(playerPos, w) - rowOf(enemyPos, w));
  const dc = Math.sign(colOf(playerPos, w) - colOf(enemyPos, w));
  return idx(rowOf(enemyPos, w) + dr, colOf(enemyPos, w) + dc, w);
}
