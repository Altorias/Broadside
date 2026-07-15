// ===== generator.ts 单测：500 组压测 + 复现性 + 降级保底 =====
import {
  floodFillPassable,
  generateBoard,
  levelConfigFor,
  newRogueRun,
  newRun,
  rogueLevelConfigFor,
  rollDraft,
  startLevel,
} from '../src/engine/generator';
import { chebyshev, neighbors8 } from '../src/engine/geometry';
import type { GameState, LevelConfig } from '../src/engine/types';
import { makeState } from './helpers';

/** 断言一个 GameState 满足全部公平性约束 */
function assertConstraints(state: GameState) {
  const { width: w, height: h, terrain, player, enemies, level } = state;
  const config = state.mode === 'rogue' ? rogueLevelConfigFor(level, state.abilities.includes('reefGarden')) : levelConfigFor(level);

  // 尺寸与地形合法
  expect(terrain).toHaveLength(w * h);

  // 敌数符合曲线（非保底关）
  expect(enemies).toHaveLength(config.enemies);
  // 障碍存在 ⇒ 未触发保底关（12×9 + 常规曲线不应落到保底）
  expect(terrain.some((t) => t !== 'water')).toBe(true);

  // 约束 1：出生点及界内邻格全水
  expect(terrain[player.pos]).toBe('water');
  for (const n of neighbors8(player.pos, w, h)) {
    expect(terrain[n]).toBe('water');
  }

  // 约束 3：连通率 ≥ 80%
  const region = floodFillPassable(terrain, player.pos, w, h);
  const totalPassable = terrain.filter((t) => t === 'water' || t === 'vortex').length;
  expect(region.size).toBeGreaterThanOrEqual(Math.ceil(totalPassable * config.connectivity));

  // 约束 2 + 4 + 敌间距
  for (const e of enemies) {
    expect(terrain[e.pos]).toBe('water');
    expect(region.has(e.pos)).toBe(true);
    expect(chebyshev(e.pos, player.pos, w)).toBeGreaterThanOrEqual(config.minSpawnDist);
    expect(e.hp).toBe(e.kind === 'flagship' ? config.flagshipHp : 1);
  }
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      expect(chebyshev(enemies[i]!.pos, enemies[j]!.pos, w)).toBeGreaterThanOrEqual(
        config.minEnemyGap,
      );
    }
  }

  // 快速海盗数量符合曲线
  const fast = enemies.filter((e) => e.kind === 'fastPirate').length;
  expect(fast).toBe(config.fastEnemies);

  // id 从 1 连续编号
  expect(enemies.map((e) => e.id)).toEqual(enemies.map((_, i) => i + 1));
}

describe('关卡生成压测', () => {
  it('500 组 (seed, level ∈ 1..15) 全约束通过', () => {
    for (let i = 0; i < 500; i++) {
      const seed = i * 7919 + 13;
      const level = (i % 15) + 1;
      const base = newRun(seed);
      const state = level === 1 ? base : startLevel(base, level);
      assertConstraints(state);
    }
  });

  it('同 (seed, level) 两次生成完全一致（复现性）', () => {
    for (const seed of [1, 42, 999999]) {
      const a = startLevel(newRun(seed), 5);
      const b = startLevel(newRun(seed), 5);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('不同 seed 产生不同布局（≥95%）', () => {
    const layouts = new Set<string>();
    const total = 100;
    for (let seed = 0; seed < total; seed++) {
      const s = newRun(seed * 31 + 7);
      layouts.add(JSON.stringify({ t: s.terrain, p: s.player.pos, e: s.enemies }));
    }
    expect(layouts.size).toBeGreaterThanOrEqual(total * 0.95);
  });

  it('对局随机流与生成重试次数解耦：同 seed 的 rngState 确定', () => {
    expect(newRun(123).rngState).toBe(newRun(123).rngState);
  });
});

describe('难度曲线', () => {
  it('敌数与快速海盗按公式增长', () => {
    expect(levelConfigFor(1)).toMatchObject({ enemies: 3, fastEnemies: 0 });
    expect(levelConfigFor(3)).toMatchObject({ enemies: 5, fastEnemies: 0 });
    expect(levelConfigFor(4)).toMatchObject({ enemies: 6, fastEnemies: 1 });
    expect(levelConfigFor(7)).toMatchObject({ enemies: 8, fastEnemies: 2 });
    expect(levelConfigFor(20)).toMatchObject({ enemies: 12, fastEnemies: 4 });
  });

  it('L6 起漩涡下限为 1', () => {
    expect(levelConfigFor(5).vortexes[0]).toBe(0);
    expect(levelConfigFor(6).vortexes[0]).toBe(1);
  });

  it('startLevel 继承命/分/门槛并重置 phase/turn', () => {
    const prev = { ...newRun(7), lives: 5, score: 3200, nextExtraLifeAt: 5000, phase: 'levelCleared' as const, turn: 33 };
    const next = startLevel(prev, 2);
    expect(next.lives).toBe(5);
    expect(next.score).toBe(3200);
    expect(next.nextExtraLifeAt).toBe(5000);
    expect(next.level).toBe(2);
    expect(next.phase).toBe('playing');
    expect(next.turn).toBe(0);
    expect(next.runSeed).toBe(prev.runSeed);
  });
});

describe('极端 config 降级与保底', () => {
  it('障碍拉满仍不抛错且返回合法棋盘（降级或保底）', () => {
    const config: LevelConfig = {
      ...levelConfigFor(10),
      islands: [40, 40],
      reefs: [30, 30],
      vortexes: [10, 10],
    };
    const board = generateBoard(config, 12345);
    expect(board.terrain).toHaveLength(config.width * config.height);
    expect(board.terrain[board.playerPos]).toBe('water');
    expect(board.enemies.length).toBeGreaterThan(0);
    for (const e of board.enemies) {
      expect(board.terrain[e.pos]).toBe('water');
      expect(e.pos).not.toBe(board.playerPos);
    }
  });

  it('必失败 config（障碍 > 总格数）触发确定性保底关', () => {
    const config: LevelConfig = {
      ...levelConfigFor(1),
      islands: [200, 200],
      reefs: [0, 0],
      vortexes: [0, 0],
    };
    const a = generateBoard(config, 1);
    const b = generateBoard(config, 999); // 保底关与种子无关
    expect(a).toEqual(b);
    expect(a.terrain.every((t) => t === 'water')).toBe(true);
    // 敌沿边缘、距玩家 ≥ minSpawnDist、两两不重叠
    const w = config.width;
    const positions = new Set(a.enemies.map((e) => e.pos));
    expect(positions.size).toBe(a.enemies.length);
    for (const e of a.enemies) {
      expect(chebyshev(e.pos, a.playerPos, w)).toBeGreaterThanOrEqual(config.minSpawnDist);
    }
  });
});

describe('floodFillPassable', () => {
  it('岛墙分隔连通块', () => {
    const s = makeState(`
      ~#~
      ~#~
      P#5
    `);
    const region = floodFillPassable(s.terrain, s.player.pos, 3, 3);
    expect(region.size).toBe(3); // 左列三格
    expect(region.has(s.enemies[0]!.pos)).toBe(false);
  });

  it('对角缝隙按 8 连通可穿行', () => {
    const s = makeState(`
      #~P
      ~#~
      5~~
    `);
    // (0,1) 与 (1,0) 斜角相通：整盘水格连成一块
    const region = floodFillPassable(s.terrain, s.player.pos, 3, 3);
    expect(region.has(s.enemies[0]!.pos)).toBe(true);
  });

  it('漩涡可通行、起点为障碍返回空集', () => {
    const s = makeState(`
      P~V~5
    `);
    const region = floodFillPassable(s.terrain, s.player.pos, 5, 1);
    expect(region.size).toBe(5);
    expect(floodFillPassable(s.terrain, -0, 5, 1).size).toBe(5);
    const islands = makeState(`#P`);
    expect(floodFillPassable(islands.terrain, 0, 2, 1).size).toBe(0);
  });
});

describe('肉鸽关卡配置与生成', () => {
  it('newRogueRun 初始化肉鸽状态：mode/船体/禁用奖命/漩涡下限', () => {
    const s = newRogueRun(123);
    expect(s.mode).toBe('rogue');
    expect(s.lives).toBe(3);
    expect(s.stats).toMatchObject({ cannonRange: 3, startLives: 3, extraLifeEvery: 0, maxLives: 5 });
    expect(s.nextExtraLifeAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(s.abilities).toEqual([]);
    expect(s.terrain.some((t) => t === 'vortex')).toBe(true);
  });

  it('rogueLevelConfigFor 数值表关键点：Boss 关旗舰 hp，reefGarden 礁石 +3', () => {
    expect(rogueLevelConfigFor(1)).toMatchObject({ enemies: 3, fastEnemies: 0, vortexes: [1, 2] });
    expect(rogueLevelConfigFor(5)).toMatchObject({ enemies: 3, fastEnemies: 0, flagshipHp: 3, reefs: [2, 3] });
    expect(rogueLevelConfigFor(10)).toMatchObject({ enemies: 4, fastEnemies: 1, flagshipHp: 4 });
    expect(rogueLevelConfigFor(15)).toMatchObject({ enemies: 5, fastEnemies: 2, flagshipHp: 5 });
    expect(rogueLevelConfigFor(11, true).reefs).toEqual([6, 8]);
  });

  it('Boss 关生成：id=1 为旗舰，hp 正确且不计入快速海盗', () => {
    for (const [level, hp] of [[5, 3], [10, 4], [15, 5]] as const) {
      const s = startLevel(newRogueRun(9001), level);
      const flag = s.enemies.find((e) => e.kind === 'flagship')!;
      expect(flag.id).toBe(1);
      expect(flag.hp).toBe(hp);
      expect(s.enemies.filter((e) => e.kind === 'fastPirate')).toHaveLength(rogueLevelConfigFor(level).fastEnemies);
    }
  });

  it('startLevel 按 mode 分派：关卡制 L6 可无漩涡以下限规则，肉鸽 L6 必有漩涡且继承能力', () => {
    const levels = startLevel(newRun(42), 5);
    expect(levels.mode).toBe('levels');
    expect(levels.abilities).toEqual([]);

    const rogueBase = { ...newRogueRun(42), abilities: ['reefGarden' as const], lives: 2, score: 777 };
    const rogue = startLevel(rogueBase, 6);
    expect(rogue.mode).toBe('rogue');
    expect(rogue.abilities).toEqual(['reefGarden']);
    expect(rogue.lives).toBe(2);
    expect(rogue.score).toBe(777);
    expect(rogue.terrain.some((t) => t === 'vortex')).toBe(true);
  });

  it('肉鸽 500 组生成压测（1..15，含 Boss 关）满足约束', () => {
    for (let i = 0; i < 500; i++) {
      const seed = i * 3571 + 91;
      const level = (i % 15) + 1;
      const state = startLevel(newRogueRun(seed), level);
      assertConstraints(state);
      if ([5, 10, 15].includes(level)) {
        expect(state.enemies.some((e) => e.kind === 'flagship')).toBe(true);
      }
    }
  });

  it('rollDraft 从 generator re-export 且同种子复现', () => {
    const s = { ...newRogueRun(2026), level: 4 };
    expect(rollDraft(s)).toEqual(rollDraft(s));
    expect(rollDraft(s).length).toBeGreaterThan(0);
    expect(rollDraft(s).length).toBeLessThanOrEqual(3);
  });
});
