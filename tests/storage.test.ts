// @vitest-environment jsdom
// ===== storage.ts 单测（需要 localStorage，跑 jsdom）=====
import { newRun } from '../src/engine/generator';
import {
  DEFAULT_BEST,
  clearRun,
  loadBest,
  loadRun,
  saveRun,
  updateBest,
} from '../src/game/storage';

beforeEach(() => {
  localStorage.clear();
});

describe('BestRecord', () => {
  it('空存储返回默认值', () => {
    expect(loadBest()).toEqual(DEFAULT_BEST);
  });

  it('updateBest 各维度取最大', () => {
    updateBest(3000, 5);
    expect(loadBest()).toMatchObject({ bestScore: 3000, bestLevel: 5 });
    updateBest(1000, 8); // 分低关高
    expect(loadBest()).toMatchObject({ bestScore: 3000, bestLevel: 8 });
  });

  it('肉鸽纪录独立维度：最深关与通关次数', () => {
    updateBest(2000, 7, 'rogue');
    expect(loadBest()).toMatchObject({ rogueBestLevel: 7, rogueWins: 0, bestLevel: 0 });
    updateBest(9000, 15, 'rogue', true);
    updateBest(8000, 15, 'rogue', true);
    expect(loadBest()).toMatchObject({ rogueBestLevel: 15, rogueWins: 2 });
  });

  it('损坏 JSON 回退默认值', () => {
    localStorage.setItem('broadside:best', '{oops');
    expect(loadBest()).toEqual(DEFAULT_BEST);
  });

  it('旧存档缺字段时用默认值补齐（免版本号迁移）', () => {
    localStorage.setItem('broadside:best', '{"bestScore": 900}');
    expect(loadBest()).toEqual({ ...DEFAULT_BEST, bestScore: 900 });
  });
});

describe('对局存档', () => {
  it('GameState 完整往返', () => {
    const state = newRun(42);
    saveRun(state);
    expect(loadRun()).toEqual(state);
  });

  it('gameOver 的局不可续玩', () => {
    const state = { ...newRun(42), phase: 'gameOver' as const };
    saveRun(state);
    expect(loadRun()).toBeNull();
  });

  it('levelCleared 的局可续玩（在过关面板继续）', () => {
    const state = { ...newRun(42), phase: 'levelCleared' as const };
    saveRun(state);
    expect(loadRun()).not.toBeNull();
  });

  it('损坏/缺失存档返回 null', () => {
    expect(loadRun()).toBeNull();
    localStorage.setItem('broadside:run', 'not json');
    expect(loadRun()).toBeNull();
    localStorage.setItem('broadside:run', '{"width": "x"}');
    expect(loadRun()).toBeNull();
  });

  it('clearRun 清除存档', () => {
    saveRun(newRun(1));
    clearRun();
    expect(loadRun()).toBeNull();
  });

  it('victory 的局不可续玩', () => {
    const state = { ...newRun(42), phase: 'victory' as const };
    localStorage.setItem('broadside:run', JSON.stringify(state));
    expect(loadRun()).toBeNull();
  });

  it('双 key 隔离：levels 与 rogue 存档互不覆盖', () => {
    const levels = newRun(1);
    const rogue = { ...newRun(2), mode: 'rogue' as const };
    saveRun(levels);
    saveRun(rogue);
    expect(loadRun('levels')!.runSeed).toBe(1);
    expect(loadRun('rogue')!.runSeed).toBe(2);
    clearRun('rogue');
    expect(loadRun('rogue')).toBeNull();
    expect(loadRun('levels')).not.toBeNull();
  });

  it('旧版本存档规范化：缺 mode/abilities/hp/maxLives 自动补默认', () => {
    // 旧档 = 新档的 JSON 克隆剥掉新字段（不可动共享对象）
    const state = JSON.parse(JSON.stringify(newRun(42))) as Record<string, unknown>;
    delete state.mode;
    delete state.abilities;
    const stats = state.stats as Record<string, unknown>;
    delete stats.maxLives;
    for (const e of state.enemies as Record<string, unknown>[]) delete e.hp;
    localStorage.setItem('broadside:run', JSON.stringify(state));

    const loaded = loadRun()!;
    expect(loaded.mode).toBe('levels');
    expect(loaded.abilities).toEqual([]);
    expect(loaded.stats.maxLives).toBe(99);
    for (const e of loaded.enemies) expect(e.hp).toBe(1);
  });

  it('nextExtraLifeAt 非数值残档兜底', () => {
    const state = JSON.parse(JSON.stringify(newRun(42))) as Record<string, unknown>;
    state.nextExtraLifeAt = null; // Infinity 经 JSON 变 null 的残档
    localStorage.setItem('broadside:run', JSON.stringify(state));
    const loaded = loadRun()!;
    expect(loaded.nextExtraLifeAt).toBe(5000);
  });

  it('规范化幂等：完整新档往返不变', () => {
    const state = newRun(7);
    saveRun(state);
    expect(loadRun()).toEqual(state);
  });
});
