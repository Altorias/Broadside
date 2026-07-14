// ===== rules.ts 边界用例 =====
// 用 ASCII 地图构造局面，覆盖计划清单的 25 类情形。

import { enemyIntent } from '../src/engine/ai';
import { idx, neighbors8 } from '../src/engine/geometry';
import { fireRays, legalMoves, resolveTurn } from '../src/engine/rules';
import type { GameEvent, GameState } from '../src/engine/types';
import { at, deepFreeze, makeState } from './helpers';

/** 事件类型序列（简化断言） */
function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function sunkEvents(events: GameEvent[]) {
  return events.filter((e) => e.type === 'shipSunk');
}

// ─────────────────────────────────────────────
// 玩家移动
// ─────────────────────────────────────────────

describe('玩家移动', () => {
  it('#1 合法移动：pos/facing 更新，事件为 playerMoved（+远敌 enemyMoved）', () => {
    const s = makeState(`
      ~~~~~~
      ~P~~~~
      ~~~~~5
    `);
    const w = 6;
    const { state, events } = resolveTurn(s, { type: 'move', dir: 'N' });
    expect(state.player.pos).toBe(at(0, 1, w));
    expect(state.player.facing).toBe('N');
    expect(types(events)).toEqual(['playerMoved', 'enemyMoved']);
    expect(state.turn).toBe(1);
  });

  it('#2a 非法移动（岛/礁/残骸/敌船格）返回原 state 同引用 + 空事件', () => {
    const s = makeState(`
      #R~
      WP1
      ~V~
    `);
    for (const dir of ['NW', 'N', 'W', 'E'] as const) {
      const { state, events } = resolveTurn(s, { type: 'move', dir });
      expect(state).toBe(s);
      expect(events).toEqual([]);
    }
    // legalMoves 与之互补：非法方向不在列表中
    const legal = legalMoves(s);
    expect(legal).not.toContain('N');
    expect(legal).not.toContain('NW');
    expect(legal).not.toContain('W');
    expect(legal).not.toContain('E');
    expect(legal).toContain('S'); // 漩涡合法
    expect(legal).toContain('NE');
  });

  it('#2b 出界移动返回原 state + 空事件', () => {
    const s = makeState(`P~5`);
    for (const dir of ['N', 'W', 'NW', 'S', 'SW', 'NE'] as const) {
      const { state, events } = resolveTurn(s, { type: 'move', dir });
      expect(state).toBe(s);
      expect(events).toEqual([]);
    }
  });

  it('#26 phase 非 playing 时直通', () => {
    const s = makeState(`P~5`);
    s.phase = 'levelCleared';
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(state).toBe(s);
    expect(events).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// 舷侧齐射（fireRays 查询 + resolveTurn 全流程）
// ─────────────────────────────────────────────

describe('舷侧齐射', () => {
  it('#3 两舷各中一敌：事件顺序 fired×2 → sunk×2，+200', () => {
    const s = makeState(
      `
      ~~~~~~~
      2~P~~3~
      ~~~~~~9
    `,
      { facing: 'N' },
    );
    const w = 7;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(types(events)).toEqual([
      'cannonFired',
      'cannonFired',
      'shipSunk',
      'shipSunk',
      'enemyMoved',
    ]);
    const [port, starboard] = events as Extract<GameEvent, { type: 'cannonFired' }>[];
    expect(port!.side).toBe('port');
    expect(port!.hitShipId).toBe(2);
    expect(port!.cells).toEqual([at(1, 1, w), at(1, 0, w)]);
    expect(starboard!.side).toBe('starboard');
    expect(starboard!.hitShipId).toBe(3);
    expect(state.score).toBe(200);
    expect(state.enemies.map((e) => e.id)).toEqual([9]);
    // 9 移入 3 刚沉的格：炮沉格立即可通行
    expect(state.enemies[0]!.pos).toBe(at(1, 5, w));
  });

  it('#4 岛与残骸挡弹', () => {
    const s = makeState(
      `
      ~~~~~~
      4#P~W5
      ~~~~~~
    `,
      { facing: 'N' },
    );
    const w = 6;
    const [port, starboard] = fireRays(s, s.player.pos, 'N');
    expect(port.blockedBy).toBe('island');
    expect(port.hitShipId).toBeUndefined();
    expect(port.cells).toEqual([at(1, 1, w)]);
    expect(starboard.blockedBy).toBe('wreck');
    expect(starboard.cells).toEqual([at(1, 3, w), at(1, 4, w)]);
  });

  it('#5 炮弹飞越漩涡命中其后敌船', () => {
    const s = makeState(
      `
      ~~~~~
      ~P~V6
    `,
      { facing: 'N' },
    );
    const w = 5;
    const [, starboard] = fireRays(s, s.player.pos, 'N');
    expect(starboard.hitShipId).toBe(6);
    expect(starboard.cells).toEqual([at(1, 2, w), at(1, 3, w), at(1, 4, w)]);
  });

  it('#6 同舷一线两敌只中第一个', () => {
    const s = makeState(`P78~`, { facing: 'N' });
    const [, starboard] = fireRays(s, s.player.pos, 'N');
    expect(starboard.hitShipId).toBe(7);
    expect(starboard.cells).toEqual([at(0, 1, 4)]);
  });

  it('#7 射程参数化：range 3 不中、range 4 命中（肉鸽扩展点生效）', () => {
    const short = makeState(`P~~~9~`, { facing: 'N' });
    const [, s3] = fireRays(short, short.player.pos, 'N');
    expect(s3.hitShipId).toBeUndefined();
    expect(s3.cells).toHaveLength(3);

    const long = makeState(`P~~~9~`, { facing: 'N', stats: { cannonRange: 4 } });
    const [, s4] = fireRays(long, long.player.pos, 'N');
    expect(s4.hitShipId).toBe(9);
  });

  it('#8 斜向朝向：NE → 左舷 NW + 右舷 SE', () => {
    const s = makeState(
      `
      ~~~~~
      ~~~~~
      ~~P~~
      ~~~~~
      ~~~~~
    `,
      { facing: 'NE' },
    );
    const w = 5;
    const [port, starboard] = fireRays(s, s.player.pos, 'NE');
    expect(port.side).toBe('port');
    expect(port.cells).toEqual([at(1, 1, w), at(0, 0, w)]); // NW 方向出界即止
    expect(starboard.cells).toEqual([at(3, 3, w), at(4, 4, w)]);
  });

  it('#27 空炮合法：无目标仍发两条 cannonFired（战术等待）', () => {
    const s = makeState(
      `
      ~~~~
      ~P~~
      ~~~9
    `,
      { facing: 'E' }, // 打 N/S，全空
    );
    const { events } = resolveTurn(s, { type: 'fire' });
    expect(types(events)).toEqual(['cannonFired', 'cannonFired', 'enemyMoved']);
    expect(sunkEvents(events)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// 敌船移动与冲突
// ─────────────────────────────────────────────

describe('敌船移动与冲突', () => {
  it('#9 贪心逼近 + facing 更新', () => {
    const s = makeState(
      `
      1~~~~
      ~~~~~
      ~~~P~
    `,
      { facing: 'E' },
    );
    const w = 5;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    const moved = events.find((e) => e.type === 'enemyMoved')!;
    expect(moved).toMatchObject({ shipId: 1, from: at(0, 0, w), to: at(1, 1, w), facing: 'SE', step: 1 });
    expect(state.enemies[0]!.pos).toBe(at(1, 1, w));
    expect(state.enemies[0]!.facing).toBe('SE');
  });

  it('#10 两敌目标同格：双沉 +400、恰 1 残骸、事件序 moved→sunk→wreck', () => {
    const s = makeState(
      `
      ~2~3~
      ~~~~~
      ~~P~9
    `,
      { facing: 'E' }, // 打 N/S：N 扫 (1,2)(0,2) 均空
    );
    const w = 5;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    const sunk = sunkEvents(events);
    expect(sunk).toHaveLength(2);
    expect(sunk.map((e) => e.shipId)).toEqual([2, 3]);
    for (const e of sunk) {
      expect(e.cause).toBe('collision');
      expect(e.to).toBe(at(1, 2, w));
      expect(e.points).toBe(200);
    }
    expect(state.score).toBe(400);
    expect(state.terrain[at(1, 2, w)]).toBe('wreck');
    expect(events.filter((e) => e.type === 'wreckCreated')).toHaveLength(1);
    // 事件顺序：9 的移动在前，随后 sunk×2、wreck
    const seq = types(events);
    expect(seq.indexOf('enemyMoved')).toBeLessThan(seq.indexOf('shipSunk'));
    expect(seq.indexOf('shipSunk')).toBeLessThan(seq.indexOf('wreckCreated'));
  });

  it('#11 三敌同格：三沉 +600、仍只 1 残骸', () => {
    const s = makeState(
      `
      ~253~
      ~~~~~
      ~~P~9
    `,
      { facing: 'NE' }, // 打 NW/SE：NW 扫 (1,1)(0,0) 空，SE 出界
    );
    const w = 5;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(sunkEvents(events)).toHaveLength(3);
    expect(state.score).toBe(600);
    expect(events.filter((e) => e.type === 'wreckCreated')).toHaveLength(1);
    expect(state.terrain[at(1, 2, w)]).toBe('wreck');
  });

  it('#12 纯贪心 AI 下对穿在数学上不可能（穷举固化；规则分支为未来 AI 兜底）', () => {
    // 任取玩家位置与相邻两敌，断言 intent 不互指
    const w = 5;
    const h = 5;
    for (let p = 0; p < w * h; p++) {
      for (let a = 0; a < w * h; a++) {
        if (a === p) continue;
        for (const b of neighbors8(a, w, h)) {
          if (b === p || b === a) continue;
          const ia = enemyIntent(a, p, w);
          const ib = enemyIntent(b, p, w);
          expect(ia === b && ib === a).toBe(false);
        }
      }
    }
  });

  it('#13 沉没者原格同微步被占：1 撞岛沉，2 进 1 原位成功', () => {
    const s = makeState(
      `
      2~~
      1~~
      #~~
      P~~
    `,
      { facing: 'N' }, // 打 W/E：W 出界，E 空
    );
    const w = 3;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    const sunk = sunkEvents(events);
    expect(sunk).toHaveLength(1);
    expect(sunk[0]).toMatchObject({ shipId: 1, cause: 'obstacle', to: at(2, 0, w) });
    const moved = events.find((e) => e.type === 'enemyMoved')!;
    expect(moved).toMatchObject({ shipId: 2, to: at(1, 0, w) });
    expect(state.enemies.map((e) => e.id)).toEqual([2]);
    // 岛不变成残骸
    expect(state.terrain[at(2, 0, w)]).toBe('island');
  });

  it('#14 敌撞礁石/旧残骸：+250、地形不变、不新增残骸', () => {
    for (const [ch, terrain] of [
      ['R', 'reef'],
      ['W', 'wreck'],
    ] as const) {
      const s = makeState(
        `
        5~~
        ${ch}~~
        P~~
      `,
        { facing: 'N' },
      );
      const w = 3;
      const { state, events } = resolveTurn(s, { type: 'fire' });
      const sunk = sunkEvents(events);
      expect(sunk).toHaveLength(1);
      expect(sunk[0]).toMatchObject({ shipId: 5, cause: 'obstacle', points: 250 });
      expect(state.terrain[at(1, 0, w)]).toBe(terrain);
      expect(events.filter((e) => e.type === 'wreckCreated')).toHaveLength(0);
      expect(state.score).toBe(250 + 600); // +250 与过关奖励（600 = 500+100×L1）
      expect(state.phase).toBe('levelCleared');
    }
  });

  it('#15 敌入漩涡：被吞噬 +250、漩涡常驻', () => {
    const s = makeState(
      `
      6~~
      V~~
      P~~
    `,
      { facing: 'N' },
    );
    const w = 3;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(sunkEvents(events)[0]).toMatchObject({ shipId: 6, cause: 'vortex', points: 250 });
    expect(state.terrain[at(1, 0, w)]).toBe('vortex');
  });

  it('#16 A 进 B 原位而 B 同步离开：恒成功（引理 1）', () => {
    const s = makeState(
      `
      1~~~~
      ~2~~~
      ~~~~~
      ~~~P~
    `,
      { facing: 'E' },
    );
    const w = 5;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(sunkEvents(events)).toHaveLength(0);
    const moves = events.filter((e) => e.type === 'enemyMoved');
    expect(moves).toHaveLength(2);
    expect(moves[0]).toMatchObject({ shipId: 1, to: at(1, 1, w) }); // 进 2 的原位
    expect(moves[1]).toMatchObject({ shipId: 2, to: at(2, 2, w) });
    expect(state.enemies).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────
// 撞击玩家与损命
// ─────────────────────────────────────────────

describe('撞击玩家', () => {
  it('#17 敌撞玩家：扣 1 命、撞击敌 0 分沉、传送到安全格', () => {
    const s = makeState(
      `
      ~~~~~
      ~1P~~
      ~~~~~
      ~~~~~
      ~~~~9
    `,
      { facing: 'E' }, // 打 N/S，不打中 1
    );
    const w = 5;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(state.lives).toBe(2);
    const sunk = sunkEvents(events);
    expect(sunk.find((e) => e.shipId === 1)).toMatchObject({ cause: 'rammedPlayer', points: 0 });
    const hit = events.find((e) => e.type === 'playerHit')!;
    expect(hit).toMatchObject({ at: at(1, 2, w), livesLeft: 2 });
    const tp = events.find((e) => e.type === 'playerTeleported')!;
    expect(tp.type === 'playerTeleported' && tp.to).not.toBe(at(1, 2, w));
    expect(state.player.pos).not.toBe(at(1, 2, w));
    // 落点是空水格，且距幸存敌（9 已动到 (3,3)）cheb≥2
    expect(state.terrain[state.player.pos]).toBe('water');
    const enemy9 = state.enemies.find((e) => e.id === 9)!;
    const cheb = Math.max(
      Math.abs(Math.floor(state.player.pos / w) - Math.floor(enemy9.pos / w)),
      Math.abs((state.player.pos % w) - (enemy9.pos % w)),
    );
    expect(cheb).toBeGreaterThanOrEqual(2);
    expect(state.score).toBe(0);
  });

  it('#18 两敌同回合撞玩家：只扣 1 命、两敌皆沉', () => {
    const s = makeState(
      `
      ~~~~~
      ~1P3~
      ~~~~~
    `,
      { facing: 'W' }, // 打 S/N，全空
    );
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(state.lives).toBe(2);
    expect(events.filter((e) => e.type === 'playerHit')).toHaveLength(1);
    const sunk = sunkEvents(events);
    expect(sunk).toHaveLength(2);
    for (const e of sunk) expect(e.cause).toBe('rammedPlayer');
    expect(state.phase).toBe('levelCleared'); // 敌清空仍算过关
  });

  it('#22 lives=1 被撞：gameOver 优先于 levelCleared、不传送', () => {
    const s = makeState(`~1P~`, { facing: 'W', lives: 1 });
    const w = 4;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    expect(state.lives).toBe(0);
    expect(state.phase).toBe('gameOver');
    const seq = types(events);
    expect(seq).toContain('gameOver');
    expect(seq).not.toContain('levelCleared');
    expect(seq).not.toContain('playerTeleported');
    expect(state.player.pos).toBe(at(0, 2, w)); // 原地播死亡动画
  });
});

// ─────────────────────────────────────────────
// 快速海盗（微步制）
// ─────────────────────────────────────────────

describe('快速海盗', () => {
  it('#19 第一步撞礁即沉，无第二步事件', () => {
    const s = makeState(`FR~~P`, { facing: 'N' });
    const { state, events } = resolveTurn(s, { type: 'fire' });
    const sunk = sunkEvents(events);
    expect(sunk).toHaveLength(1);
    expect(sunk[0]).toMatchObject({ shipId: 10, cause: 'obstacle', step: 1 });
    expect(events.filter((e) => 'step' in e && e.step === 2)).toHaveLength(0);
    expect(state.enemies).toHaveLength(0);
  });

  it('#20 step2 动撞静：快速海盗撞已停的普通海盗，双沉+残骸', () => {
    const s = makeState(
      `
      ~~2~P
      ~~~~~
      ~F~~~
    `,
      { facing: 'N' }, // 打 W/E：E 扫 (0,4) 右侧出界…玩家在 (0,4)，W 扫 (0,3)(0,2)=2 命中！改朝向
    );
    // 重设朝向：facing E → 打 N/S，N 出界，S 扫 (1,4)(2,4) 空
    s.player.facing = 'E';
    const w = 5;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    // step1: 2 → (0,3)，F(10) → (1,2)
    const step1Moves = events.filter((e) => e.type === 'enemyMoved' && e.step === 1);
    expect(step1Moves).toHaveLength(2);
    // step2: F 瞄准 (0,3)（2 的新位）→ 动撞静双沉
    const sunk = sunkEvents(events);
    expect(sunk).toHaveLength(2);
    expect(sunk.map((e) => e.shipId).sort((a, b) => a - b)).toEqual([2, 10]);
    for (const e of sunk) {
      expect(e.cause).toBe('collision');
      expect(e.step).toBe(2);
    }
    expect(state.terrain[at(0, 3, w)]).toBe('wreck');
    expect(state.score).toBe(400 + 600); // 200×2 + 过关奖励
    expect(state.enemies).toHaveLength(0);
  });

  it('#21 cheb=2 起步：step1+step2 两连跳撞到玩家', () => {
    const s = makeState(`F~P~~`, { facing: 'E' }); // 打 N/S，单行图上双双出界
    const w = 5;
    const { state, events } = resolveTurn(s, { type: 'fire' });
    const moves = events.filter((e) => e.type === 'enemyMoved');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ shipId: 10, to: at(0, 1, w), step: 1 });
    const sunk = sunkEvents(events);
    expect(sunk[0]).toMatchObject({ shipId: 10, cause: 'rammedPlayer', step: 2 });
    expect(state.lives).toBe(2);
    expect(events.filter((e) => e.type === 'playerHit')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────
// 计分 / 奖命 / 过关
// ─────────────────────────────────────────────

describe('计分与过关', () => {
  it('#23 炮沉最后一敌：levelCleared + bonus 跨门槛触发 extraLife', () => {
    const s = makeState(`~P~4~`, { facing: 'N', score: 4800 });
    const { state, events } = resolveTurn(s, { type: 'fire' });
    // 4800 + 100(炮击) = 4900 未过门槛；+600(L1 奖励) = 5500 ≥ 5000
    expect(state.score).toBe(5500);
    expect(state.lives).toBe(4);
    expect(state.nextExtraLifeAt).toBe(10000);
    expect(state.phase).toBe('levelCleared');
    const seq = types(events);
    expect(seq.indexOf('extraLife')).toBeGreaterThan(-1);
    expect(seq.indexOf('extraLife')).toBeLessThan(seq.indexOf('levelCleared'));
    const cleared = events.find((e) => e.type === 'levelCleared')!;
    expect(cleared).toMatchObject({ level: 1, bonus: 600 });
  });
});

// ─────────────────────────────────────────────
// 漩涡传送与复现性
// ─────────────────────────────────────────────

describe('漩涡传送与纯函数性', () => {
  it('#24 玩家入漩涡：落点合法、rngState 推进、同态同 action 完全复现', () => {
    const s = makeState(
      `
      ~~~~~
      ~PV~~
      ~~~~9
    `,
    );
    const w = 5;
    const r1 = resolveTurn(s, { type: 'move', dir: 'E' });
    const r2 = resolveTurn(s, { type: 'move', dir: 'E' });
    // 复现性：同输入两次调用结果一致
    expect(JSON.stringify(r1.state)).toBe(JSON.stringify(r2.state));
    expect(r1.events).toEqual(r2.events);

    const seq = types(r1.events);
    expect(seq[0]).toBe('playerMoved');
    expect(seq[1]).toBe('playerTeleported');
    const dest = r1.state.player.pos;
    expect(dest).not.toBe(at(1, 2, w)); // 不留在漩涡
    expect(r1.state.terrain[dest]).toBe('water');
    // 传送发生在敌船移动前，落点距 9 的原位 (2,4) cheb≥2
    const tp = r1.events.find((e) => e.type === 'playerTeleported')!;
    expect(tp.type === 'playerTeleported' && tp.from).toBe(at(1, 2, w));
    expect(r1.state.rngState).not.toBe(s.rngState);
  });

  it('#25 纯函数性：deepFreeze 原 state 不抛错、内容不变', () => {
    const s = makeState(
      `
      ~2~3~
      ~~~~~
      ~~P~9
    `,
      { facing: 'E' },
    );
    const before = JSON.stringify(s);
    deepFreeze(s);
    expect(() => resolveTurn(s, { type: 'fire' })).not.toThrow();
    expect(JSON.stringify(s)).toBe(before);
  });

  it('#28 idx 工具与地图坐标一致（防 helpers 回归）', () => {
    const s = makeState(`
      ~5~
      ~P~
    `);
    expect(s.enemies[0]!.pos).toBe(idx(0, 1, 3));
    expect(s.player.pos).toBe(idx(1, 1, 3));
  });
});
