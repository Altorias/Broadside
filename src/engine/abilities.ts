// ===== 强化注册表与三选一抽卡 =====
// 三系流派：炮术（直接火力）/ 航海（机动博弈）/ 潮汐（地形杀）+ 通用。
// 规则型强化由 rules.ts 通过 hasAbility 查询标志位；即时型（range1/repair/
// hullPlate）在 applyAbility 时立即施加到 stats/lives。
// rollDraft 是 (runSeed, level) 的纯函数——不存档、不耗对局 RNG，
// 刷新重开面板同一 offer，天然防 S/L 刷卡。

import { createRng, deriveSeed } from './rng';
import type { AbilityId, GameState } from './types';

export type AbilityBranch = 'gunnery' | 'sailing' | 'tide' | 'generic';

export interface AbilityDef {
  id: AbilityId;
  branch: AbilityBranch;
  name: string;
  desc: string;
  /** 可重复获得次数 */
  maxStacks: number;
  /** 抽取基础权重（传说级更低） */
  baseWeight: number;
  /** 出现在池中的额外前置（如 repair 需要缺血） */
  requires?: (s: GameState) => boolean;
  /** 即时型效果（选中时施加；s 为已克隆的可变副本） */
  apply?: (s: GameState) => void;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  // ── 炮术系 ──────────────────────────────────
  range1: {
    id: 'range1',
    branch: 'gunnery',
    name: '长管加农',
    desc: '舷炮射程 +1',
    maxStacks: 2,
    baseWeight: 10,
    apply: (s) => {
      s.stats = { ...s.stats, cannonRange: s.stats.cannonRange + 1 };
    },
  },
  pierce: {
    id: 'pierce',
    branch: 'gunnery',
    name: '贯穿弹',
    desc: '炮弹击沉目标后继续飞行，可一炮串沉整线敌船',
    maxStacks: 1,
    baseWeight: 10,
  },
  blast: {
    id: 'blast',
    branch: 'gunnery',
    name: '爆裂弹',
    desc: '命中格上下左右的敌船一并受创',
    maxStacks: 1,
    baseWeight: 10,
  },
  bowChaser: {
    id: 'bowChaser',
    branch: 'gunnery',
    name: '舰艏追击炮',
    desc: '齐射时额外向正前方发射（补舷侧盲区）',
    maxStacks: 1,
    baseWeight: 10,
  },
  // ── 航海系 ──────────────────────────────────
  ram: {
    id: 'ram',
    branch: 'sailing',
    name: '青铜冲角',
    desc: '可移入敌船格，将其沿航向推挤一格——推进障碍即沉',
    maxStacks: 1,
    baseWeight: 10,
  },
  helm: {
    id: 'helm',
    branch: 'sailing',
    name: '老练舵手',
    desc: '可花一回合原地转向，随心调整射界',
    maxStacks: 1,
    baseWeight: 10,
  },
  tailwind: {
    id: 'tailwind',
    branch: 'sailing',
    name: '抢风急射',
    desc: '传说：每次移动后自动齐射一轮',
    maxStacks: 1,
    baseWeight: 3,
  },
  // ── 潮汐系 ──────────────────────────────────
  wreckShot: {
    id: 'wreckShot',
    branch: 'tide',
    name: '造礁弹',
    desc: '被你炮沉的敌船留下残骸，主动造墙',
    maxStacks: 1,
    baseWeight: 10,
  },
  vortexPull: {
    id: 'vortexPull',
    branch: 'tide',
    name: '涡流罗盘',
    desc: '每回合把离漩涡最近的敌船向漩涡拉一格',
    maxStacks: 1,
    baseWeight: 10,
  },
  reefGarden: {
    id: 'reefGarden',
    branch: 'tide',
    name: '暗礁图志',
    desc: '此后关卡礁石更多，且你的炮弹飞越礁石（敌船照撞）',
    maxStacks: 1,
    baseWeight: 10,
  },
  // ── 通用 ────────────────────────────────────
  repair: {
    id: 'repair',
    branch: 'generic',
    name: '修补龙骨',
    desc: '船体 +1',
    maxStacks: 99,
    baseWeight: 10,
    requires: (s) => s.lives < s.stats.maxLives,
    apply: (s) => {
      s.lives = Math.min(s.lives + 1, s.stats.maxLives);
    },
  },
  hullPlate: {
    id: 'hullPlate',
    branch: 'generic',
    name: '橡木装甲',
    desc: '船体上限 +1，并回复 1 点',
    maxStacks: 2,
    baseWeight: 8,
    apply: (s) => {
      s.stats = { ...s.stats, maxLives: s.stats.maxLives + 1 };
      s.lives = Math.min(s.lives + 1, s.stats.maxLives);
    },
  },
};

export function hasAbility(s: GameState, id: AbilityId): boolean {
  return s.abilities.includes(id);
}

export function abilityStacks(s: GameState, id: AbilityId): number {
  return s.abilities.reduce((n, a) => (a === id ? n + 1 : n), 0);
}

/**
 * 关间三选一。纯函数：同 (runSeed, level) 恒同 offer。
 * 权重按已拥有的系加权（流派滚雪球）；池不足 3 张降级出剩余。
 */
export function rollDraft(s: GameState): AbilityId[] {
  const rng = createRng(deriveSeed(s.runSeed, 1000 + s.level));
  const pool = Object.values(ABILITIES).filter(
    (a) => abilityStacks(s, a.id) < a.maxStacks && (a.requires?.(s) ?? true),
  );
  const branchCount = (b: AbilityBranch) =>
    s.abilities.filter((id) => ABILITIES[id].branch === b).length;

  const picks: AbilityId[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    const weights = pool.map((a) => a.baseWeight * (1 + 0.6 * branchCount(a.branch)));
    const total = weights.reduce((x, y) => x + y, 0);
    let roll = rng.next() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      roll -= weights[idx]!;
      if (roll < 0) break;
    }
    picks.push(pool[idx]!.id);
    pool.splice(idx, 1);
  }
  return picks;
}

/** 选卡：追加抽取历史 + 施加即时效果。返回新 state（纯函数） */
export function applyAbility(state: GameState, id: AbilityId): GameState {
  const s: GameState = {
    ...state,
    abilities: [...state.abilities, id],
    stats: { ...state.stats },
  };
  ABILITIES[id].apply?.(s);
  return s;
}
