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
    expect(loadBest()).toEqual({ bestScore: 3000, bestLevel: 5 });
    updateBest(1000, 8); // 分低关高
    expect(loadBest()).toEqual({ bestScore: 3000, bestLevel: 8 });
  });

  it('损坏 JSON 回退默认值', () => {
    localStorage.setItem('broadside:best', '{oops');
    expect(loadBest()).toEqual(DEFAULT_BEST);
  });

  it('旧存档缺字段时用默认值补齐（免版本号迁移）', () => {
    localStorage.setItem('broadside:best', '{"bestScore": 900}');
    expect(loadBest()).toEqual({ bestScore: 900, bestLevel: 0 });
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
});
