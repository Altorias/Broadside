// ===== 潮汐系与通用强化 =====
import { applyAbility } from '../src/engine/abilities';
import { fireRays, resolveTurn } from '../src/engine/rules';
import type { GameEvent } from '../src/engine/types';
import { at, makeState } from './helpers';

function sunkEvents(events: GameEvent[]) {
  return events.filter((e) => e.type === 'shipSunk');
}

describe('潮汐系 · wreckShot 造礁弹', () => {
  it('炮沉留残骸（step=volley），且残骸挡下一回合炮线', () => {
    const s = makeState(`P1~2`, { facing: 'N', abilities: ['wreckShot'], mode: 'rogue' });
    const w = 4;
    const r = resolveTurn(s, { type: 'fire' });
    expect(sunkEvents(r.events).some((e) => e.shipId === 1)).toBe(true);
    expect(r.state.terrain[at(0, 1, w)]).toBe('wreck');
    expect(r.events.find((e) => e.type === 'wreckCreated')).toMatchObject({ at: at(0, 1, w), step: 'volley' });
    const [, ray] = fireRays(r.state, r.state.player.pos, 'N');
    expect(ray.blockedBy).toBe('wreck');
    expect(ray.hitShipId).toBeUndefined();
  });

  it('pierce + wreckShot 一炮多残骸', () => {
    const s = makeState(`P12~`, { facing: 'N', abilities: ['pierce', 'wreckShot'], mode: 'rogue' });
    const w = 4;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(sunkEvents(events).filter((e) => e.cause === 'cannon')).toHaveLength(2);
    expect(state.terrain[at(0, 1, w)]).toBe('wreck');
    expect(state.terrain[at(0, 2, w)]).toBe('wreck');
    expect(events.filter((e) => e.type === 'wreckCreated')).toHaveLength(2);
  });
});

describe('潮汐系 · vortexPull 涡流罗盘', () => {
  it('平局按敌 id，再按漩涡下标；吸入漩涡吞噬 +250', () => {
    // 敌方阶段后：1 从 0→1，2 从 4→5；二者距漩涡 2 同距，按 id 选 1，拉入漩涡吞噬
    const s = makeState(`1~V~2~~P`, { facing: 'E', abilities: ['vortexPull'], mode: 'rogue' });
    const { events } = resolveTurn(s, { type: 'fire' });
    const sunk = sunkEvents(events).find((e) => e.step === 'pull')!;
    expect(sunk).toMatchObject({ shipId: 1, cause: 'vortex', points: 250 });
  });

  it('拉入障碍=撞沉', () => {
    // 敌方阶段后：1 从 0→1；向 V(3) 拉一步会撞到 R(2)
    const obstacle = makeState(`1~RV~P`, { facing: 'E', abilities: ['vortexPull'], mode: 'rogue' });
    const ro = resolveTurn(obstacle, { type: 'fire' });
    expect(sunkEvents(ro.events).find((e) => e.step === 'pull')).toMatchObject({ shipId: 1, cause: 'obstacle' });
  });

  it('旗舰永不被选；拉动存活船不改变 facing', () => {
    const s = makeState(
      `
      BV1
      ~~P
    `,
      { facing: 'N', abilities: ['vortexPull'], mode: 'rogue', flagshipHp: 3 },
    );
    const before = s.enemies.find((e) => e.id === 1)!.facing;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(events.some((e) => e.type === 'enemyPulled' && e.shipId === 30)).toBe(false);
    const one = state.enemies.find((e) => e.id === 1);
    if (one) expect(one.facing).toBe(before);
  });

  it('step2 后再拉（事件序 enemyMoved step2 → enemyPulled/shipSunk pull）', () => {
    const s = makeState(`F~V~P`, { facing: 'E', abilities: ['vortexPull'], mode: 'rogue' });
    const { events } = resolveTurn(s, { type: 'fire' });
    const step2 = events.findIndex((e) => e.type === 'enemyMoved' && e.step === 2);
    const pull = events.findIndex((e) => e.type === 'enemyPulled' || (e.type === 'shipSunk' && e.step === 'pull'));
    if (pull !== -1) expect(pull).toBeGreaterThan(step2);
  });
});

describe('潮汐系 · reefGarden 暗礁图志', () => {
  it('炮线飞越礁石命中其后敌船；残骸仍挡弹', () => {
    const s = makeState(`P~R5`, { facing: 'N', abilities: ['reefGarden'], mode: 'rogue' });
    const [, ray] = fireRays(s, s.player.pos, 'N');
    expect(ray.hitShipId).toBe(5);
    expect(ray.blockedBy).toBeUndefined();

    const wreck = makeState(`P~W5`, { facing: 'N', abilities: ['reefGarden'], mode: 'rogue' });
    const [, wr] = fireRays(wreck, wreck.player.pos, 'N');
    expect(wr.blockedBy).toBe('wreck');
    expect(wr.hitShipId).toBeUndefined();
  });

  it('敌撞礁仍沉（reefGarden 只影响你的炮线）', () => {
    const s = makeState(
      `
      1~~
      R~~
      P~~
    `,
      { facing: 'N', abilities: ['reefGarden'], mode: 'rogue' },
    );
    const { events } = resolveTurn(s, { type: 'fire' });
    expect(sunkEvents(events).find((e) => e.shipId === 1)).toMatchObject({ cause: 'obstacle' });
  });
});

describe('通用强化', () => {
  it('repair 不破上限；hullPlate 可叠 2 次，上限+回复', () => {
    let s = makeState(`P~5`, { mode: 'rogue', stats: { maxLives: 5 }, lives: 4 });
    s = applyAbility(s, 'repair');
    expect(s.lives).toBe(5);
    s = applyAbility(s, 'repair');
    expect(s.lives).toBe(5);
    s = applyAbility(s, 'hullPlate');
    expect(s.stats.maxLives).toBe(6);
    expect(s.lives).toBe(6);
    s = applyAbility(s, 'hullPlate');
    expect(s.stats.maxLives).toBe(7);
    expect(s.lives).toBe(7);
  });
});
