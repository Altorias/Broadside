// ===== 核心类型契约 =====
// GameState 必须整体可 JSON 序列化（存档 = JSON.stringify(state)），
// 因此禁用 TypedArray / Set / Map / Infinity 字段；派生数据在函数内部临时构建。
//
// ── 事件顺序契约（UI 按此顺序分拍播放动画）──────────────────
// [playerMoved → enemyPushed? → shipSunk('ram')* → wreckCreated('ram')? → playerTeleported?
//  | playerTurned
//  | cannonFired(port,starboard[,bow]) → (shipDamaged|shipSunk(cannon))* → wreckCreated('volley')*]
// → tailwind?: cannonFired×N → (shipDamaged|shipSunk)* → wreckCreated('volley')*   # 仅 move 后
// → step1: terrainDestroyed? → enemyMoved(旗舰)? → enemyMoved* → shipSunk* → wreckCreated*
//          → playerHit? → playerTeleported?
// → step2: 同上（仅快速海盗；旗舰不动）
// → enemyPulled? → shipSunk('pull')?
// → extraLife*（仅 levels 模式）→ (levelCleared | victory | gameOver)?
//
// 注意：cannon 系事件（cannonFired / shipDamaged / shipSunk(cannon) /
// wreckCreated('volley')）必须连续成块，由 rules.fireVolley 单一出口保证——
// groupBeats 对脱离 volley 拍的 cannon 沉没会静默丢弃。
// ────────────────────────────────────────────────────────────

/** 地形。wreck（残骸）在对局中动态产生；旗舰可碾碎 reef/wreck（→water） */
export type Terrain = 'water' | 'island' | 'reef' | 'vortex' | 'wreck';

/** 8 朝向，顺时针环序（geometry.DIRS 的元素与此一致） */
export type Dir8 = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** 敌船种类。flagship 为肉鸽 Boss（多 hp、碾障碍、撞玩家不沉） */
export type ShipKind = 'pirate' | 'fastPirate' | 'flagship';

/** 敌船 AI 行为。reckless = 贪心不避障（原作黑船）；cautious = 绕开障碍（原作红船） */
export type ShipAI = 'reckless' | 'cautious';

/** 舷侧：port=左舷，starboard=右舷；bow=舰艏（bowChaser 强化的第三射线） */
export type Side = 'port' | 'starboard' | 'bow';

export type Phase = 'playing' | 'levelCleared' | 'gameOver' | 'victory';

export type GameMode = 'levels' | 'rogue';

/** 肉鸽通关关数（清完此关 → victory） */
export const ROGUE_FINAL_LEVEL = 15;

/** 强化 id（注册表与元数据见 engine/abilities.ts） */
export type AbilityId =
  | 'range1'
  | 'pierce'
  | 'blast'
  | 'bowChaser' // 炮术系
  | 'ram'
  | 'helm'
  | 'tailwind' // 航海系
  | 'wreckShot'
  | 'vortexPull'
  | 'reefGarden' // 潮汐系
  | 'repair'
  | 'hullPlate'; // 通用

/** 敌船。facing 纯装饰（渲染旋转用）；hp 普通船恒 1，旗舰 3~5 */
export interface EnemyShip {
  id: number;
  kind: ShipKind;
  pos: number;
  facing: Dir8;
  hp: number;
  /** AI 行为：reckless = 贪心不避障（原作黑船），cautious = 绕开障碍（原作红船） */
  ai: ShipAI;
}

/** 玩家船。facing 参与规则（决定舷侧射界） */
export interface PlayerShip {
  pos: number;
  facing: Dir8;
}

/** 肉鸽扩展点 1：玩家能力参数化。rules.ts 只读此对象，不写死数值 */
export interface PlayerStats {
  /** 舷炮射程（格） */
  cannonRange: number;
  /** 初始命数（肉鸽语义 = 船体结构） */
  startLives: number;
  /** 每多少分奖 1 命；<= 0 表示禁用（肉鸽模式） */
  extraLifeEvery: number;
  /** 命数上限（levels 模式事实不受限，取大数） */
  maxLives: number;
}

export const DEFAULT_STATS: PlayerStats = Object.freeze({
  cannonRange: 3,
  startLives: 3,
  extraLifeEvery: 5000,
  maxLives: 99,
});

/** 肉鸽扩展点 2：关卡参数化。generator 只读此对象 */
export interface LevelConfig {
  width: number;
  height: number;
  /** 障碍数量区间 [min, max] */
  islands: [number, number];
  reefs: [number, number];
  vortexes: [number, number];
  /** 敌船总数（含旗舰） */
  enemies: number;
  /** 其中快速海盗数量 */
  fastEnemies: number;
  /** cautious AI 占比（原作红船比例；flagship 不受此影响，逻辑独立） */
  cautiousRatio: number;
  /** 有值 ⇒ 敌船槽 id=1 为旗舰，hp 取此值（Boss 关） */
  flagshipHp?: number;
  /** 敌船距玩家最小切比雪夫距离 */
  minSpawnDist: number;
  /** 敌船之间最小切比雪夫距离（防开局白送互撞） */
  minEnemyGap: number;
  /** 玩家连通块须占全图可通行格的比例 */
  connectivity: number;
}

export interface GameState {
  width: number;
  height: number;
  /** 长 width*height 的地形数组；残骸动态写入；旗舰可碾 reef/wreck→water */
  terrain: Terrain[];
  player: PlayerShip;
  /** 沉没即移除；id 由 generator 分配（1..n，旗舰恒为 1） */
  enemies: EnemyShip[];
  /** levels=命数；rogue=船体结构（上限 stats.maxLives） */
  lives: number;
  score: number;
  level: number;
  /** 下一次奖命的分数门槛；肉鸽设 MAX_SAFE_INTEGER（Infinity 不可 JSON 化） */
  nextExtraLifeAt: number;
  stats: PlayerStats;
  mode: GameMode;
  /** 已获强化（含即时型，兼作抽取历史与构筑展示） */
  abilities: AbilityId[];
  /** 整局种子；levelSeed = deriveSeed(runSeed, level) */
  runSeed: number;
  /** 对局内 RNG 状态（漩涡传送/重生落点）；resolveTurn 推进并写回 */
  rngState: number;
  phase: Phase;
  turn: number;
}

export type Action =
  | { type: 'move'; dir: Dir8 }
  | { type: 'fire' }
  /** 原地转向（需 helm 强化），耗一回合 */
  | { type: 'turn'; dir: Dir8 };

/** 沉没原因（决定分值与动画）。grounded = 被冲角推出边界搁浅 */
export type SinkCause =
  | 'cannon'
  | 'obstacle'
  | 'vortex'
  | 'collision'
  | 'rammedPlayer'
  | 'grounded';

/** shipSunk/wreckCreated 的来源阶段标记（数字 = 敌方微步） */
export type StepTag = 1 | 2 | 'ram' | 'pull' | 'volley';

export type GameEvent =
  | { type: 'playerMoved'; from: number; to: number; facing: Dir8 }
  /** 漩涡传送与损命重生共用 */
  | { type: 'playerTeleported'; from: number; to: number }
  /** helm 强化：原地转向 */
  | { type: 'playerTurned'; facing: Dir8 }
  | { type: 'cannonFired'; side: Side; cells: number[]; hitShipId?: number; blockedBy?: Terrain }
  /** 炮击未击沉（旗舰血厚）：闪白提示 */
  | { type: 'shipDamaged'; shipId: number; at: number; hpLeft: number }
  | { type: 'enemyMoved'; shipId: number; from: number; to: number; facing: Dir8; step: 1 | 2 }
  /** ram 冲角推挤（存活换位）；不改 facing */
  | { type: 'enemyPushed'; shipId: number; from: number; to: number }
  /** vortexPull 吸拽（存活拉动）；不改 facing */
  | { type: 'enemyPulled'; shipId: number; from: number; to: number; vortexAt: number }
  /** 炮击沉没时 from === to 且不带 step；撞击类沉没 from→to 为"末路移动" */
  | {
      type: 'shipSunk';
      shipId: number;
      kind: ShipKind;
      from: number;
      to: number;
      cause: SinkCause;
      points: number;
      step?: StepTag;
    }
  | { type: 'wreckCreated'; at: number; step: StepTag }
  /** 旗舰碾碎礁石/残骸（terrain→water），随后 enemyMoved 进格 */
  | { type: 'terrainDestroyed'; at: number; step: 1 | 2 }
  | { type: 'playerHit'; at: number; livesLeft: number }
  | { type: 'extraLife'; lives: number }
  | { type: 'levelCleared'; level: number; bonus: number }
  /** 肉鸽通关（清完 L15） */
  | { type: 'victory'; score: number }
  | { type: 'gameOver'; score: number };

export interface TurnResult {
  state: GameState;
  events: GameEvent[];
}
