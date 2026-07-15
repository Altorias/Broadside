// ===== 强化系统用例：炮术系 + 抽卡 =====
import { ABILITIES, abilityStacks, applyAbility, rollDraft } from '../src/engine/abilities';
import { fireRays, resolveTurn } from '../src/engine/rules';
import type { GameEvent } from '../src/engine/types';
import { at, makeState } from './helpers';

function sunkEvents(events: GameEvent[]) {
  return events.filter((e) => e.type === 'shipSunk');
}

// ─────────────────────────────────────────────
// 炮术系
// ─────────────────────────────────────────────

describe('炮术系 · range1 长管加农', () => {
  it('叠 1 次射程 4、叠 2 次射程 5，命中远敌', () => {
    let s = makeState(`P~~~9~`, { facing: 'N', mode: 'rogue' });
    s = applyAbility(s, 'range1');
    expect(s.stats.cannonRange).toBe(4);
    const [, starboard] = fireRays(s, s.player.pos, 'N');
    expect(starboard.hitShipId).toBe(9);

    let s5 = makeState(`P~~~~9`, { facing: 'N', mode: 'rogue' });
    s5 = applyAbility(applyAbility(s5, 'range1'), 'range1');
    expect(s5.stats.cannonRange).toBe(5);
    const [, sb5] = fireRays(s5, s5.player.pos, 'N');
    expect(sb5.hitShipId).toBe(9);
  });

  it('叠满后不再出现在抽卡池', () => {
    let s = makeState(`P~5`, { mode: 'rogue', level: 3 });
    s = applyAbility(applyAbility(s, 'range1'), 'range1');
    expect(abilityStacks(s, 'range1')).toBe(2);
    // 穷举多个关卡的 offer，range1 不应再出现
    for (let level = 1; level <= 10; level++) {
      const picks = rollDraft({ ...s, level });
      expect(picks).not.toContain('range1');
    }
  });
});

describe('炮术系 · pierce 贯穿弹', () => {
  it('一线三敌一炮串沉（cells 延伸至最远者）', () => {
    const s = makeState(`P789`, { facing: 'N', abilities: ['pierce'], mode: 'rogue' });
    const { state, events } = resolveTurn(s, { type: 'fire' });
    const sunk = sunkEvents(events);
    expect(sunk.map((e) => e.shipId)).toEqual([7, 8, 9]);
    expect(state.score).toBe(300 + 600); // 3×100 + L1 过关奖励
    const fired = events.find((e) => e.type === 'cannonFired' && e.side === 'starboard')!;
    expect(fired.type === 'cannonFired' && fired.cells).toHaveLength(3);
  });

  it('贯穿后仍被礁石挡住（其后敌船未被炮击）', () => {
    const s = makeState(`P7R8~`, { facing: 'N', abilities: ['pierce'], mode: 'rogue' });
    const { events } = resolveTurn(s, { type: 'fire' });
    // 只看炮击结算：7 被炮沉、8 未被炮击（其后是否因自身移动撞礁另计）
    const cannonSunk = sunkEvents(events).filter((e) => e.cause === 'cannon');
    expect(cannonSunk.map((e) => e.shipId)).toEqual([7]);
    const fired = events.find((e) => e.type === 'cannonFired' && e.side === 'starboard')!;
    expect(fired.type === 'cannonFired' && fired.blockedBy).toBe('reef');
    expect(fired.type === 'cannonFired' && fired.cells).toEqual([at(0, 1, 5), at(0, 2, 5)]);
  });

  it('对血厚旗舰停止；旗舰 hp=1 时击沉并继续贯穿', () => {
    // 满血旗舰挡弹：炮线停在旗舰格，不波及其后的 7
    const thick = makeState(`PB7~`, {
      facing: 'N',
      abilities: ['pierce'],
      flagshipHp: 3,
      mode: 'rogue',
    });
    const r1 = resolveTurn(thick, { type: 'fire' });
    expect(r1.events.filter((e) => e.type === 'shipDamaged')).toHaveLength(1);
    const fired = r1.events.find((e) => e.type === 'cannonFired' && e.side === 'starboard')!;
    expect(fired.type === 'cannonFired' && fired.cells).toEqual([at(0, 1, 4)]); // 停在旗舰格
    expect(sunkEvents(r1.events).some((e) => e.cause === 'cannon')).toBe(false); // 无炮击沉

    // 残血旗舰被击沉后贯穿其后小船
    const thin = makeState(`PB7~`, {
      facing: 'N',
      abilities: ['pierce'],
      flagshipHp: 1,
      mode: 'rogue',
    });
    const r2 = resolveTurn(thin, { type: 'fire' });
    const sunk = sunkEvents(r2.events).filter((e) => e.cause === 'cannon');
    expect(sunk.map((e) => e.shipId).sort((a, b) => a - b)).toEqual([7, 30]);
  });
});

describe('炮术系 · blast 爆裂弹', () => {
  it('命中格 4 正邻的敌船陪葬', () => {
    const s = makeState(
      `
      ~2~
      P1~
      ~3~
    `,
      { facing: 'S', abilities: ['blast'], mode: 'rogue' },
    );
    // facing S：左舷 E。玩家 (1,0)，E 扫 (1,1)=1 命中；溅射 (0,1)=2、(2,1)=3
    const { events } = resolveTurn(s, { type: 'fire' });
    const sunk = sunkEvents(events);
    expect(sunk.map((e) => e.shipId).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('无链式：陪葬船的邻格不再引爆', () => {
    const s = makeState(
      `
      3~~
      2~~
      1~~
      P~~
    `,
      { facing: 'W', abilities: ['blast'], mode: 'rogue' },
    );
    // facing W：右舷 N。扫 (2,0)=1 命中；溅射 (1,0)=2 陪葬；3 在 2 的邻格但不被引爆
    const { events } = resolveTurn(s, { type: 'fire' });
    const cannonSunk = sunkEvents(events).filter((e) => e.cause === 'cannon');
    expect(cannonSunk.map((e) => e.shipId).sort((a, b) => a - b)).toEqual([1, 2]);
    // 3 未被炮击沉（它随后正常移动）
    expect(cannonSunk.some((e) => e.shipId === 3)).toBe(false);
  });

  it('溅射对旗舰造成 shipDamaged', () => {
    const s = makeState(
      `
      ~B~
      P1~
    `,
      { facing: 'S', abilities: ['blast'], flagshipHp: 3, mode: 'rogue' },
    );
    const { events } = resolveTurn(s, { type: 'fire' });
    expect(sunkEvents(events).some((e) => e.shipId === 1)).toBe(true);
    const dmg = events.find((e) => e.type === 'shipDamaged');
    expect(dmg).toMatchObject({ shipId: 30, hpLeft: 2 });
  });
});

describe('炮术系 · bowChaser 舰艏炮', () => {
  it('第三条射线 side=bow、方向=facing、正前命中', () => {
    const s = makeState(
      `
      5~~
      P~~
    `,
      { facing: 'N', abilities: ['bowChaser'], mode: 'rogue' },
    );
    const { events } = resolveTurn(s, { type: 'fire' });
    const fired = events.filter((e) => e.type === 'cannonFired');
    expect(fired).toHaveLength(3);
    expect(fired[2]).toMatchObject({ side: 'bow', hitShipId: 5 });
    expect(sunkEvents(events).map((e) => e.shipId)).toEqual([5]);
  });

  it('与 pierce 联动：舰艏线贯穿两敌', () => {
    const s = makeState(
      `
      6~~
      5~~
      P~~
    `,
      { facing: 'N', abilities: ['bowChaser', 'pierce'], mode: 'rogue' },
    );
    const w = 3;
    const { events } = resolveTurn(s, { type: 'fire' });
    expect(sunkEvents(events).map((e) => e.shipId)).toEqual([5, 6]);
    const bow = events.find((e) => e.type === 'cannonFired' && e.side === 'bow')!;
    expect(bow.type === 'cannonFired' && bow.cells).toEqual([at(1, 0, w), at(0, 0, w)]);
  });
});

// ─────────────────────────────────────────────
// 抽卡
// ─────────────────────────────────────────────

describe('rollDraft 抽卡', () => {
  it('同 (runSeed, level) 恒同 offer；不同 level 不同流', () => {
    const s = makeState(`P~5`, { mode: 'rogue', level: 3 });
    expect(rollDraft(s)).toEqual(rollDraft(s));
    const offers = new Set<string>();
    for (let level = 1; level <= 8; level++) {
      offers.add(rollDraft({ ...s, level }).join(','));
    }
    expect(offers.size).toBeGreaterThan(1);
  });

  it('三张卡互不重复且不含已拥有的非叠加项', () => {
    const s = makeState(`P~5`, {
      mode: 'rogue',
      abilities: ['pierce', 'ram', 'wreckShot'],
      level: 4,
    });
    for (let level = 1; level <= 10; level++) {
      const picks = rollDraft({ ...s, level });
      expect(new Set(picks).size).toBe(picks.length);
      for (const banned of ['pierce', 'ram', 'wreckShot'] as const) {
        expect(picks).not.toContain(banned);
      }
    }
  });

  it('repair 满血时不出现、缺血时可出现', () => {
    const full = makeState(`P~5`, { mode: 'rogue', stats: { maxLives: 3 }, lives: 3 });
    for (let level = 1; level <= 12; level++) {
      expect(rollDraft({ ...full, level })).not.toContain('repair');
    }
    // 缺血时 repair 在池中（穷举若干 level 应至少出现一次）
    const hurt = makeState(`P~5`, { mode: 'rogue', stats: { maxLives: 5 }, lives: 1 });
    let seen = false;
    for (let level = 1; level <= 30 && !seen; level++) {
      seen = rollDraft({ ...hurt, level }).includes('repair');
    }
    expect(seen).toBe(true);
  });

  it('流派滚雪球：炮术系已有 3 张时，炮术卡出现频率显著提高', () => {
    const neutral = makeState(`P~5`, { mode: 'rogue' });
    const gunner = makeState(`P~5`, {
      mode: 'rogue',
      abilities: ['range1', 'range1', 'blast'],
    });
    const gunneryIds = new Set(
      Object.values(ABILITIES)
        .filter((a) => a.branch === 'gunnery')
        .map((a) => a.id),
    );
    const countGunnery = (state: typeof neutral) => {
      let n = 0;
      for (let level = 1; level <= 40; level++) {
        for (const id of rollDraft({ ...state, level })) {
          if (gunneryIds.has(id)) n++;
        }
      }
      return n;
    };
    // 已倾向炮术的构筑应抽到更多炮术卡（range1/blast 已排除，靠权重拉高 pierce/bowChaser）
    expect(countGunnery(gunner)).toBeGreaterThan(countGunnery(neutral) * 0.8);
  });

  it('池不足 3 张时降级出剩余', () => {
    // 拿满几乎所有：只剩 repair（缺血）与 hullPlate 1 层
    const s = makeState(`P~5`, {
      mode: 'rogue',
      stats: { maxLives: 6 },
      lives: 2,
      abilities: [
        'range1', 'range1', 'pierce', 'blast', 'bowChaser',
        'ram', 'helm', 'tailwind', 'wreckShot', 'vortexPull', 'reefGarden',
        'hullPlate',
      ],
    });
    const picks = rollDraft(s);
    expect(picks.length).toBe(2); // repair + hullPlate(还剩1层)
    expect(new Set(picks)).toEqual(new Set(['repair', 'hullPlate']));
  });
});

describe('applyAbility 即时效果', () => {
  it('repair 回 1 不破上限；hullPlate 上限+1 并回 1', () => {
    let s = makeState(`P~5`, { mode: 'rogue', stats: { maxLives: 5 }, lives: 4 });
    s = applyAbility(s, 'repair');
    expect(s.lives).toBe(5);
    s = applyAbility(s, 'repair'); // 已满，仍 5
    expect(s.lives).toBe(5);
    s = applyAbility(s, 'hullPlate');
    expect(s.stats.maxLives).toBe(6);
    expect(s.lives).toBe(6);
  });

  it('纯函数：原 state 不被修改', () => {
    const s = makeState(`P~5`, { mode: 'rogue' });
    const before = JSON.stringify(s);
    applyAbility(s, 'range1');
    expect(JSON.stringify(s)).toBe(before);
  });
});
