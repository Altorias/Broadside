// ===== 旗舰 Boss 结算用例 =====
import { resolveTurn } from '../src/engine/rules';
import type { GameEvent } from '../src/engine/types';
import { at, makeState } from './helpers';

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}
function sunkEvents(events: GameEvent[]) {
  return events.filter((e) => e.type === 'shipSunk');
}

describe('旗舰 Boss', () => {
  it('#B1 hp3 旗舰吃两炮：shipDamaged×2 不移除，第三炮 shipSunk +1000', () => {
    // 玩家朝 N，右舷打 E 方向命中旗舰
    const make = () => makeState(`PB~~`, { facing: 'N', flagshipHp: 3, mode: 'rogue', level: 5 });
    let s = make();
    let r = resolveTurn(s, { type: 'fire' });
    const dmg = r.events.filter((e) => e.type === 'shipDamaged');
    expect(dmg).toHaveLength(1);
    expect(dmg[0]).toMatchObject({ shipId: 30, hpLeft: 2 });
    expect(sunkEvents(r.events)).toHaveLength(0);
    expect(r.state.enemies).toHaveLength(1);
    expect(r.state.enemies[0]!.hp).toBe(2);

    // 连续三炮击沉（每次从新鲜态打，旗舰贪心逼近但 P 在 (0,0) 不动它也会靠近——用受损态续算）
    s = r.state;
    // 旗舰已逼近，重构地图保持相邻：直接再打两次当前态
    r = resolveTurn(s, { type: 'fire' });
    r = resolveTurn(r.state, { type: 'fire' });
    const sunk = sunkEvents(r.events).find((e) => e.shipId === 30);
    expect(sunk).toMatchObject({ cause: 'cannon', points: 1000, kind: 'flagship' });
    expect(r.state.enemies.find((e) => e.id === 30)).toBeUndefined();
  });

  it('#B2 旗舰碾碎礁石：terrainDestroyed → enemyMoved 同拍、地形变水', () => {
    const s = makeState(
      `
      B~~~
      R~~~
      P~~~
    `,
      { facing: 'E', flagshipHp: 3 }, // 打 N/S 不碰旗舰
    );
    const w = 4;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    const seq = types(events);
    expect(seq.indexOf('terrainDestroyed')).toBeGreaterThan(-1);
    expect(seq.indexOf('terrainDestroyed')).toBeLessThan(seq.indexOf('enemyMoved'));
    expect(state.terrain[at(1, 0, w)]).toBe('water');
    expect(state.enemies[0]!.pos).toBe(at(1, 0, w)); // 碾过后进格
  });

  it('#B3 旗舰被岛屿挡：站立不动、无 enemyMoved', () => {
    const s = makeState(
      `
      B~~~
      #~~~
      P~~~
    `,
      { facing: 'E', flagshipHp: 3 },
    );
    const w = 4;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(events.filter((e) => e.type === 'enemyMoved')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'terrainDestroyed')).toHaveLength(0);
    expect(state.enemies[0]!.pos).toBe(at(0, 0, w)); // 原地
  });

  it('#B4 旗舰撞玩家：扣命 + 传送 + 旗舰原地存活', () => {
    // facing E → 打 N/S，双向皆空，不误伤旗舰
    const s = makeState(`~BP~`, { facing: 'E', flagshipHp: 3, mode: 'rogue', level: 5 });
    const w = 4;
    const r = resolveTurn(s, { type: 'fire' });
    expect(r.state.lives).toBe(2);
    expect(r.events.filter((e) => e.type === 'playerHit')).toHaveLength(1);
    // 旗舰未沉、原地不动
    const flag = r.state.enemies.find((e) => e.id === 30)!;
    expect(flag.pos).toBe(at(0, 1, w));
    expect(sunkEvents(r.events)).toHaveLength(0);
    // 玩家被传送离开
    expect(r.events.filter((e) => e.type === 'playerTeleported')).toHaveLength(1);
    expect(r.state.player.pos).not.toBe(at(0, 2, w));
  });

  it('#B5 旗舰可停驻漩涡格（视作水面，不沉）', () => {
    // 玩家 facing N：左舷 W 出界、右舷 E 清水——炮线不碰旗舰所在列
    const s = makeState(
      `
      B~~~
      V~~~
      P~~~
    `,
      { facing: 'N', flagshipHp: 3 },
    );
    const w = 4;
    const { state } = resolveTurn(s, { type: 'fire' });
    expect(state.enemies[0]!.pos).toBe(at(1, 0, w)); // 停在漩涡上
    expect(state.enemies[0]!.hp).toBe(3); // 未沉
    expect(state.terrain[at(1, 0, w)]).toBe('vortex'); // 漩涡还在
  });

  it('#B6 step2 快速海盗撞静止旗舰：只沉快速海盗、无残骸', () => {
    // 旗舰 (0,2) 被岛 (0,3) 卡住站立；F (2,0) 两步路径：(1,1) → (0,2) 撞旗舰
    const s = makeState(
      `
      ~~B#P
      ~~~~~
      F~~~~
    `,
      { facing: 'N', flagshipHp: 5 }, // 左舷 W 被岛挡（保护旗舰）、右舷 E 出界
    );
    const w = 5;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    const fSunk = sunkEvents(events).find((e) => e.shipId === 10)!;
    expect(fSunk).toMatchObject({ cause: 'collision', step: 2, to: at(0, 2, w) });
    const flag = state.enemies.find((e) => e.id === 30)!;
    expect(flag.hp).toBe(5); // 旗舰无伤
    expect(flag.pos).toBe(at(0, 2, w)); // 原地
    expect(state.terrain.filter((t) => t === 'wreck')).toHaveLength(0); // 不留残骸
  });

  it('#B7 旗舰在场时三小船同格互撞语义不变', () => {
    const s = makeState(
      `
      ~234~
      ~~~~~
      B~P~~
    `,
      { facing: 'NE', flagshipHp: 5 }, // 打 NW/SE，避开上方三敌
    );
    const w = 5;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    // 三小船 2/3/4 贪心逼近玩家 (2,2)：2(0,1)→(1,2)、3(0,2)→(1,2)、4(0,3)→(1,2) 同格
    const sunk = sunkEvents(events).filter((e) => e.cause === 'collision');
    expect(sunk.length).toBeGreaterThanOrEqual(2); // 至少两船互撞
    expect(state.terrain[at(1, 2, w)]).toBe('wreck'); // 留 1 残骸
    expect(state.enemies.find((e) => e.id === 30)).toBeDefined(); // 旗舰不受影响
  });

  it('#B8 L15 击沉旗舰清场 → victory；L5 → levelCleared', () => {
    const final = makeState(`P~B~`, {
      facing: 'S',
      flagshipHp: 1,
      mode: 'rogue',
      level: 15,
    });
    // facing S：左舷 E、右舷 W。玩家 (0,0)，左舷 E 扫 (0,1)(0,2)=B 命中
    const r = resolveTurn(final, { type: 'fire' });
    expect(r.state.phase).toBe('victory');
    expect(types(r.events)).toContain('victory');
    expect(types(r.events)).not.toContain('levelCleared');

    const boss5 = makeState(`P~B~`, { facing: 'S', flagshipHp: 1, mode: 'rogue', level: 5 });
    const r5 = resolveTurn(boss5, { type: 'fire' });
    expect(r5.state.phase).toBe('levelCleared');
    expect(types(r5.events)).toContain('levelCleared');
  });

  it('#B9 无 ram 时移动指向旗舰格非法（不能撞旗舰）', () => {
    const s = makeState(`PB~~`, { facing: 'N', flagshipHp: 3, mode: 'rogue' });
    const { state, events } = resolveTurn(s, { type: 'move', dir: 'E' });
    expect(state).toBe(s);
    expect(events).toEqual([]);
  });
});
