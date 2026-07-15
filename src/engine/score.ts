// ===== 分值表与过关奖励 =====
// 放在 engine/ 层：rules.ts 结算时需要分值，引擎不得依赖 game/ 胶水层。
// 所有平衡调参集中在此文件。

import type { ShipKind, SinkCause } from './types';

/** 各沉没原因的分值。引诱类（撞障碍/漩涡/搁浅）高于炮击，鼓励地形杀 */
export const SCORE: Record<SinkCause, number> = {
  cannon: 100,
  obstacle: 250,
  vortex: 250,
  collision: 200,
  rammedPlayer: 0,
  grounded: 250,
};

/** 旗舰击沉固定高分（无视沉没原因——它只会被炮击沉） */
const FLAGSHIP_POINTS = 1000;

export function sinkPoints(cause: SinkCause, kind?: ShipKind): number {
  if (kind === 'flagship') return FLAGSHIP_POINTS;
  return SCORE[cause];
}

/** 过关奖励：随关卡缓增 */
export function levelClearBonus(level: number): number {
  return 500 + 100 * level;
}
