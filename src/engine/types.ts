// ===== 核心类型契约 =====
// GameState 必须整体可 JSON 序列化（存档 = JSON.stringify(state)），
// 因此禁用 TypedArray / Set / Map 字段；占位查询等派生数据在函数内部临时构建。
//
// ── 事件顺序契约（UI 按此顺序分拍播放动画）──────────────────
// [playerMoved | cannonFired(port), cannonFired(starboard), shipSunk*]
// → playerTeleported?                          # 玩家驶入漩涡
// → step1: enemyMoved* → shipSunk* → wreckCreated* → playerHit? → playerTeleported?
// → step2: 同上（仅快速海盗）
// → extraLife* → (levelCleared | gameOver)?
// ────────────────────────────────────────────────────────────

/** 地形。wreck（残骸）在对局中由敌船互撞动态产生 */
export type Terrain = 'water' | 'island' | 'reef' | 'vortex' | 'wreck';

/** 8 朝向，顺时针环序（geometry.DIRS 的元素与此一致） */
export type Dir8 = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** 敌船种类。肉鸽阶段在此扩展 */
export type ShipKind = 'pirate' | 'fastPirate';

/** 舷侧：port=左舷，starboard=右舷 */
export type Side = 'port' | 'starboard';

export type Phase = 'playing' | 'levelCleared' | 'gameOver';

/** 敌船。facing 纯装饰（渲染旋转用），不参与规则 */
export interface EnemyShip {
  id: number;
  kind: ShipKind;
  pos: number;
  facing: Dir8;
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
  /** 初始命数 */
  startLives: number;
  /** 每多少分奖 1 命 */
  extraLifeEvery: number;
}

export const DEFAULT_STATS: PlayerStats = {
  cannonRange: 3,
  startLives: 3,
  extraLifeEvery: 5000,
};

/** 肉鸽扩展点 2：关卡参数化。generator 只读此对象 */
export interface LevelConfig {
  width: number;
  height: number;
  /** 障碍数量区间 [min, max] */
  islands: [number, number];
  reefs: [number, number];
  vortexes: [number, number];
  /** 敌船总数（含快速海盗） */
  enemies: number;
  /** 其中快速海盗数量 */
  fastEnemies: number;
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
  /** 长 width*height 的地形数组；残骸对局中动态写入 */
  terrain: Terrain[];
  player: PlayerShip;
  /** 沉没即移除；id 由 generator 分配（1..n，玩家不占 id） */
  enemies: EnemyShip[];
  lives: number;
  score: number;
  level: number;
  /** 下一次奖命的分数门槛（5000, 10000, ...） */
  nextExtraLifeAt: number;
  stats: PlayerStats;
  /** 整局种子；levelSeed = deriveSeed(runSeed, level) */
  runSeed: number;
  /** 对局内 RNG 状态（漩涡传送/重生落点）；resolveTurn 推进并写回 */
  rngState: number;
  phase: Phase;
  turn: number;
}

export type Action = { type: 'move'; dir: Dir8 } | { type: 'fire' };

/** 沉没原因（决定分值与动画） */
export type SinkCause = 'cannon' | 'obstacle' | 'vortex' | 'collision' | 'rammedPlayer';

export type GameEvent =
  | { type: 'playerMoved'; from: number; to: number; facing: Dir8 }
  /** 漩涡传送与损命重生共用 */
  | { type: 'playerTeleported'; from: number; to: number }
  | { type: 'cannonFired'; side: Side; cells: number[]; hitShipId?: number; blockedBy?: Terrain }
  | { type: 'enemyMoved'; shipId: number; from: number; to: number; facing: Dir8; step: 1 | 2 }
  /** 炮击沉没时 from === to；撞击类沉没 from→to 为"末路移动"，动画不依赖配对的 enemyMoved */
  | {
      type: 'shipSunk';
      shipId: number;
      kind: ShipKind;
      from: number;
      to: number;
      cause: SinkCause;
      points: number;
      step?: 1 | 2;
    }
  | { type: 'wreckCreated'; at: number; step: 1 | 2 }
  | { type: 'playerHit'; at: number; livesLeft: number }
  | { type: 'extraLife'; lives: number }
  | { type: 'levelCleared'; level: number; bonus: number }
  | { type: 'gameOver'; score: number };

export interface TurnResult {
  state: GameState;
  events: GameEvent[];
}
