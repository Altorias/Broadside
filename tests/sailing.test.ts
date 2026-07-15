// ===== 航海系强化：turn / ram / tailwind =====
import { legalMoves, legalTurns, resolveTurn } from '../src/engine/rules';
import type { GameEvent } from '../src/engine/types';
import { at, makeState } from './helpers';

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}
function sunkEvents(events: GameEvent[]) {
  return events.filter((e) => e.type === 'shipSunk');
}

describe('航海系 · helm 原地转向', () => {
  it('有 helm 时 turn 合法：只改 facing，耗一回合，敌方照常行动', () => {
    const s = makeState(
      `
      1~~~
      ~~P~
    `,
      { facing: 'N', abilities: ['helm'], mode: 'rogue' },
    );
    const { state, events } = resolveTurn(s, { type: 'turn', dir: 'E' });
    expect(state.player.pos).toBe(s.player.pos);
    expect(state.player.facing).toBe('E');
    expect(state.turn).toBe(1);
    expect(types(events)[0]).toBe('playerTurned');
    expect(events.some((e) => e.type === 'enemyMoved')).toBe(true);
  });

  it('无 helm 或转同向非法：返回原 state + 空事件', () => {
    const noHelm = makeState(`1P~`, { facing: 'N' });
    expect(resolveTurn(noHelm, { type: 'turn', dir: 'E' })).toEqual({ state: noHelm, events: [] });

    const same = makeState(`1P~`, { facing: 'N', abilities: ['helm'], mode: 'rogue' });
    expect(resolveTurn(same, { type: 'turn', dir: 'N' })).toEqual({ state: same, events: [] });
  });

  it('legalTurns 仅在有 helm 时返回除当前朝向外的 7 向', () => {
    const noHelm = makeState(`P~1`, { facing: 'N' });
    expect(legalTurns(noHelm)).toEqual([]);
    const helm = makeState(`P~1`, { facing: 'N', abilities: ['helm'], mode: 'rogue' });
    expect(legalTurns(helm)).toHaveLength(7);
    expect(legalTurns(helm)).not.toContain('N');
    expect(legalTurns(helm)).toContain('E');
  });
});

describe('航海系 · ram 冲角', () => {
  it('无 ram 时移动进敌格非法；有 ram 时 legalMoves 包含敌格方向', () => {
    const base = makeState(`P1~`, { facing: 'N' });
    expect(legalMoves(base)).not.toContain('E');
    expect(resolveTurn(base, { type: 'move', dir: 'E' })).toEqual({ state: base, events: [] });

    const ram = makeState(`P1~`, { facing: 'N', abilities: ['ram'], mode: 'rogue' });
    expect(legalMoves(ram)).toContain('E');
  });

  it('推入空水：先 playerMoved，再 enemyPushed；敌方阶段后仍保持合法状态', () => {
    const s = makeState(`P1~~~`, { abilities: ['ram'], mode: 'rogue' });
    const w = 5;
    const { state, events } = resolveTurn(s, { type: 'move', dir: 'E' });
    // 只看 ram 事件本身：from 1 → to 2；之后敌方阶段会继续行动，所以不把终态位置写死
    const pushed = events.find((e) => e.type === 'enemyPushed')!;
    expect(pushed).toMatchObject({ shipId: 1, from: at(0, 1, w), to: at(0, 2, w) });
    expect(types(events).indexOf('playerMoved')).toBeLessThan(types(events).indexOf('enemyPushed'));
    expect(state.enemies.every((e) => e.pos !== state.player.pos)).toBe(true);
  });

  it('推入岛/礁/残骸/漩涡/边界：按对应 cause 沉没', () => {
    const cases = [
      ['P1#~', 'obstacle'],
      ['P1R~', 'obstacle'],
      ['P1W~', 'obstacle'],
      ['P1V~', 'vortex'],
      ['~P1', 'grounded'],
    ] as const;
    for (const [map, cause] of cases) {
      const s = makeState(map, { abilities: ['ram'], mode: 'rogue' });
      const { events } = resolveTurn(s, { type: 'move', dir: 'E' });
      const sunk = sunkEvents(events).find((e) => e.shipId === 1)!;
      expect(sunk.cause).toBe(cause);
      expect(sunk.step).toBe('ram');
      expect(sunk.points).toBe(cause === 'vortex' ? 250 : 250);
    }
  });

  it('推入另一小船：双沉并在被撞格留下残骸', () => {
    const s = makeState(`P12~`, { abilities: ['ram'], mode: 'rogue' });
    const w = 4;
    const { state, events } = resolveTurn(s, { type: 'move', dir: 'E' });
    const sunk = sunkEvents(events).filter((e) => e.step === 'ram');
    expect(sunk.map((e) => e.shipId).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(state.terrain[at(0, 2, w)]).toBe('wreck');
    expect(events.find((e) => e.type === 'wreckCreated')).toMatchObject({ at: at(0, 2, w), step: 'ram' });
  });

  it('推旗舰非法：legalMoves 不含、resolveTurn 原样返回', () => {
    const s = makeState(`PB~~`, { abilities: ['ram'], mode: 'rogue', flagshipHp: 3 });
    expect(legalMoves(s)).not.toContain('E');
    const r = resolveTurn(s, { type: 'move', dir: 'E' });
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });
});

describe('航海系 · tailwind 抢风急射', () => {
  it('移动后自动齐射：playerMoved 后出现 cannonFired', () => {
    const s = makeState(
      `
      ~5~
      P~~
      ~~~
    `,
      { abilities: ['tailwind'], mode: 'rogue' },
    );
    const { events } = resolveTurn(s, { type: 'move', dir: 'N' });
    const seq = types(events);
    expect(seq[0]).toBe('playerMoved');
    expect(seq.indexOf('cannonFired')).toBeGreaterThan(0);
    expect(sunkEvents(events).some((e) => e.shipId === 5 && e.cause === 'cannon')).toBe(true);
  });

  it('开炮动作本身不额外触发 tailwind（只有一轮齐射）', () => {
    const s = makeState(`P~~5`, { facing: 'N', abilities: ['tailwind'], mode: 'rogue' });
    const { events } = resolveTurn(s, { type: 'fire' });
    expect(events.filter((e) => e.type === 'cannonFired')).toHaveLength(2);
  });

  it('入漩涡传送后，从落点新朝向自动齐射（事件顺序：move → teleport → cannonFired）', () => {
    const s = makeState(
      `
      ~~~~~
      ~PV~~
      ~~~~9
    `,
      { abilities: ['tailwind'], mode: 'rogue' },
    );
    const { events } = resolveTurn(s, { type: 'move', dir: 'E' });
    const seq = types(events);
    expect(seq.indexOf('playerMoved')).toBe(0);
    expect(seq.indexOf('playerTeleported')).toBeGreaterThan(seq.indexOf('playerMoved'));
    expect(seq.indexOf('cannonFired')).toBeGreaterThan(seq.indexOf('playerTeleported'));
  });

  it('与 bowChaser/pierce 联动：移动后舰艏炮可贯穿', () => {
    const s = makeState(
      `
      67~~
      P~~~
    `,
      { abilities: ['tailwind', 'bowChaser', 'pierce'], mode: 'rogue' },
    );
    // 从 (1,0) 向 N 移动到 (0,0)，新 facing N，bow 方向出界；这个布局不命中。
    // 改为从左下向 E 移动后 bow 朝 E，命中 6/7。
    const s2 = makeState(`P~67`, { abilities: ['tailwind', 'bowChaser', 'pierce'], mode: 'rogue' });
    const { events } = resolveTurn(s2, { type: 'move', dir: 'E' });
    const cannon = sunkEvents(events).filter((e) => e.cause === 'cannon');
    expect(cannon.map((e) => e.shipId).sort((a, b) => a - b)).toEqual([6, 7]);
  });
});
