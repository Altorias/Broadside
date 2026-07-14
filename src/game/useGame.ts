// ===== useGame：对局状态 + 事件分拍动画播放器 =====
// 双状态模型：game（逻辑态，resolveTurn 后立即提交并写存档）
//           visual（渲染真相源，按"拍"逐步追上 game）。
// 播放完 syncFrom(game) 强制对齐自愈；generationRef 代际计数保证取消安全。

import { useCallback, useEffect, useRef, useState } from 'react';
import { DIR_ANGLE, colOf, dirFromTo, rowOf } from '../engine/geometry';
import { startLevel } from '../engine/generator';
import { resolveTurn } from '../engine/rules';
import type { Action, GameEvent, GameState, ShipKind, SinkCause } from '../engine/types';
import { clearRun, saveRun, updateBest } from './storage';

// ── 动画时长常量（ms，全部乘 ANIM_SCALE）───────────
const reducedMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 测试模式与减弱动效偏好下动画归零 */
export const ANIM_SCALE = import.meta.env.MODE === 'test' || reducedMotion ? 0 : 1;

const DUR = {
  playerMove: 240,
  teleport: 420,
  volleyPerCell: 80,
  volleyTail: 320, // 命中特效余量
  volleyMiss: 120,
  enemyMove: 240,
  sink: 380,
  hit: 360,
  extraLife: 250,
} as const;

// ── 视觉状态类型 ──────────────────────────────────

export interface VisualShip {
  id: number; // 玩家 = 0
  kind: ShipKind | 'player';
  row: number;
  col: number;
  /** 累计角度（非 mod 360），每次转向加最短角差，防 NW→N 倒转 */
  angle: number;
  sinking?: SinkCause;
  /** 传送瞬移：本拍禁用位移过渡 */
  teleporting?: boolean;
}

export interface Effect {
  key: number;
  kind: 'cannonball' | 'impact' | 'splash' | 'scorePop';
  r: number;
  c: number;
  /** cannonball 终点 */
  r2?: number;
  c2?: number;
  /** 未缩放时长/延迟（ms） */
  dur?: number;
  delay?: number;
  text?: string;
}

export interface VisualState {
  ships: VisualShip[];
  wrecks: number[];
  effects: Effect[];
  hud: { score: number; lives: number; level: number };
  overlay: 'levelCleared' | 'gameOver' | null;
  shake: boolean;
}

// ── 拍（beat）──────────────────────────────────────

type Beat =
  | { kind: 'playerMove'; e: Extract<GameEvent, { type: 'playerMoved' }> }
  | { kind: 'teleport'; e: Extract<GameEvent, { type: 'playerTeleported' }> }
  | {
      kind: 'volley';
      rays: Extract<GameEvent, { type: 'cannonFired' }>[];
      sunk: Extract<GameEvent, { type: 'shipSunk' }>[];
    }
  | {
      kind: 'enemyStep';
      step: 1 | 2;
      moves: Extract<GameEvent, { type: 'enemyMoved' }>[];
      sunk: Extract<GameEvent, { type: 'shipSunk' }>[];
      wrecks: Extract<GameEvent, { type: 'wreckCreated' }>[];
    }
  | { kind: 'hit'; e: Extract<GameEvent, { type: 'playerHit' }> }
  | { kind: 'extraLife'; e: Extract<GameEvent, { type: 'extraLife' }> };

/** 按事件顺序契约切拍（levelCleared/gameOver 由收尾 sync 处理） */
export function groupBeats(events: GameEvent[]): Beat[] {
  const beats: Beat[] = [];
  const stepBeat = (step: 1 | 2): Extract<Beat, { kind: 'enemyStep' }> => {
    const last = beats[beats.length - 1];
    if (last && last.kind === 'enemyStep' && last.step === step) return last;
    const nb = { kind: 'enemyStep' as const, step, moves: [], sunk: [], wrecks: [] };
    beats.push(nb);
    return nb;
  };
  for (const e of events) {
    switch (e.type) {
      case 'playerMoved':
        beats.push({ kind: 'playerMove', e });
        break;
      case 'playerTeleported':
        beats.push({ kind: 'teleport', e });
        break;
      case 'cannonFired': {
        const last = beats[beats.length - 1];
        if (last && last.kind === 'volley') last.rays.push(e);
        else beats.push({ kind: 'volley', rays: [e], sunk: [] });
        break;
      }
      case 'shipSunk':
        if (e.cause === 'cannon') {
          const last = beats[beats.length - 1];
          if (last && last.kind === 'volley') last.sunk.push(e);
        } else {
          stepBeat(e.step!).sunk.push(e);
        }
        break;
      case 'enemyMoved':
        stepBeat(e.step).moves.push(e);
        break;
      case 'wreckCreated':
        stepBeat(e.step).wrecks.push(e);
        break;
      case 'playerHit':
        beats.push({ kind: 'hit', e });
        break;
      case 'extraLife':
        beats.push({ kind: 'extraLife', e });
        break;
      case 'levelCleared':
      case 'gameOver':
        break;
    }
  }
  return beats;
}

function beatDuration(beat: Beat): number {
  switch (beat.kind) {
    case 'playerMove':
      return DUR.playerMove;
    case 'teleport':
      return DUR.teleport;
    case 'volley': {
      const maxCells = Math.max(0, ...beat.rays.map((r) => r.cells.length));
      const hasHit = beat.rays.some((r) => r.hitShipId !== undefined);
      return maxCells * DUR.volleyPerCell + (hasHit ? DUR.volleyTail : DUR.volleyMiss);
    }
    case 'enemyStep':
      return DUR.enemyMove + (beat.sunk.length > 0 ? DUR.sink : 0);
    case 'hit':
      return DUR.hit;
    case 'extraLife':
      return DUR.extraLife;
  }
}

// ── 视觉构造 ──────────────────────────────────────

/** 最短角差旋转：防止 NW(315°) → N(0°) 倒转 315° */
function rotateTowards(current: number, targetDeg: number): number {
  const cur = ((current % 360) + 360) % 360;
  const delta = ((targetDeg - cur + 540) % 360) - 180;
  return current + delta;
}

/** 从逻辑态重建视觉（保留已有船的累计角度） */
function syncFrom(state: GameState, prevShips?: VisualShip[]): VisualState {
  const prev = new Map((prevShips ?? []).map((s) => [s.id, s]));
  const w = state.width;
  const mkShip = (id: number, kind: ShipKind | 'player', pos: number, targetDeg: number): VisualShip => {
    const p = prev.get(id);
    return {
      id,
      kind,
      row: rowOf(pos, w),
      col: colOf(pos, w),
      angle: p ? rotateTowards(p.angle, targetDeg) : targetDeg,
    };
  };
  return {
    ships: [
      mkShip(0, 'player', state.player.pos, DIR_ANGLE[state.player.facing]),
      ...state.enemies.map((e) => mkShip(e.id, e.kind, e.pos, DIR_ANGLE[e.facing])),
    ],
    wrecks: state.terrain.reduce<number[]>((acc, t, i) => (t === 'wreck' ? [...acc, i] : acc), []),
    effects: [],
    hud: { score: state.score, lives: state.lives, level: state.level },
    overlay:
      state.phase === 'levelCleared' ? 'levelCleared' : state.phase === 'gameOver' ? 'gameOver' : null,
    shake: false,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Hook ──────────────────────────────────────────

export function useGame(initial: GameState) {
  const [game, setGame] = useState(initial);
  const gameRef = useRef(initial);
  const [visual, setVisual] = useState<VisualState>(() => syncFrom(initial));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const effectKeyRef = useRef(1);

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };

  // 挂载即写存档（新局/续玩皆覆盖）；卸载时废弃在播动画
  useEffect(() => {
    saveRun(gameRef.current);
    const ref = generationRef;
    return () => {
      ref.current++;
    };
  }, []);

  /** 单拍视觉变换 */
  const applyBeat = useCallback((beat: Beat) => {
    const w = gameRef.current.width;
    const nk = () => effectKeyRef.current++;
    setVisual((v) => {
      // 通用清理：上一拍沉没的船移除、瞬移标记清除、震屏复位
      let ships = v.ships
        .filter((s) => !s.sinking)
        .map((s) => (s.teleporting ? { ...s, teleporting: false } : s));
      let effects = v.effects;
      let wrecks = v.wrecks;
      let hud = v.hud;
      let shake = false;

      switch (beat.kind) {
        case 'playerMove': {
          const { to, facing } = beat.e;
          ships = ships.map((s) =>
            s.id === 0
              ? {
                  ...s,
                  row: rowOf(to, w),
                  col: colOf(to, w),
                  angle: rotateTowards(s.angle, DIR_ANGLE[facing]),
                }
              : s,
          );
          break;
        }
        case 'teleport': {
          const { from, to } = beat.e;
          effects = [
            ...effects,
            { key: nk(), kind: 'splash', r: rowOf(from, w), c: colOf(from, w) },
            { key: nk(), kind: 'splash', r: rowOf(to, w), c: colOf(to, w), delay: 150 },
          ];
          ships = ships.map((s) =>
            s.id === 0 ? { ...s, row: rowOf(to, w), col: colOf(to, w), teleporting: true } : s,
          );
          break;
        }
        case 'volley': {
          const player = ships.find((s) => s.id === 0)!;
          const fx: Effect[] = [];
          for (const ray of beat.rays) {
            if (ray.cells.length === 0) continue;
            const last = ray.cells[ray.cells.length - 1]!;
            const flight = ray.cells.length * DUR.volleyPerCell;
            fx.push({
              key: nk(),
              kind: 'cannonball',
              r: player.row,
              c: player.col,
              r2: rowOf(last, w),
              c2: colOf(last, w),
              dur: flight,
            });
            if (ray.hitShipId !== undefined) {
              fx.push({ key: nk(), kind: 'impact', r: rowOf(last, w), c: colOf(last, w), delay: flight });
            }
          }
          for (const sk of beat.sunk) {
            ships = ships.map((s) => (s.id === sk.shipId ? { ...s, sinking: sk.cause } : s));
            fx.push({
              key: nk(),
              kind: 'scorePop',
              r: rowOf(sk.to, w),
              c: colOf(sk.to, w),
              text: `+${sk.points}`,
            });
          }
          hud = { ...hud, score: hud.score + beat.sunk.reduce((a, e) => a + e.points, 0) };
          effects = [...effects, ...fx];
          break;
        }
        case 'enemyStep': {
          const sunkMap = new Map(beat.sunk.map((e) => [e.shipId, e]));
          const fx: Effect[] = [];
          ships = ships.map((s) => {
            const mv = beat.moves.find((m) => m.shipId === s.id);
            if (mv) {
              return {
                ...s,
                row: rowOf(mv.to, w),
                col: colOf(mv.to, w),
                angle: rotateTowards(s.angle, DIR_ANGLE[mv.facing]),
              };
            }
            const sk = sunkMap.get(s.id);
            if (sk) {
              const angle =
                sk.from === sk.to
                  ? s.angle
                  : rotateTowards(s.angle, DIR_ANGLE[dirFromTo(sk.from, sk.to, w)]);
              return { ...s, row: rowOf(sk.to, w), col: colOf(sk.to, w), angle, sinking: sk.cause };
            }
            return s;
          });
          for (const sk of beat.sunk) {
            fx.push({
              key: nk(),
              kind: 'splash',
              r: rowOf(sk.to, w),
              c: colOf(sk.to, w),
              delay: DUR.enemyMove,
            });
            if (sk.points > 0) {
              fx.push({
                key: nk(),
                kind: 'scorePop',
                r: rowOf(sk.to, w),
                c: colOf(sk.to, w),
                text: `+${sk.points}`,
                delay: DUR.enemyMove,
              });
            }
          }
          wrecks = [...wrecks, ...beat.wrecks.map((e) => e.at)];
          hud = { ...hud, score: hud.score + beat.sunk.reduce((a, e) => a + e.points, 0) };
          effects = [...effects, ...fx];
          break;
        }
        case 'hit': {
          shake = true;
          hud = { ...hud, lives: beat.e.livesLeft };
          break;
        }
        case 'extraLife': {
          const player = ships.find((s) => s.id === 0)!;
          hud = { ...hud, lives: beat.e.lives };
          effects = [
            ...effects,
            { key: nk(), kind: 'scorePop', r: player.row, c: player.col, text: '+1 命！' },
          ];
          break;
        }
      }
      return { ...v, ships, effects, wrecks, hud, shake };
    });
  }, []);

  const playEvents = useCallback(
    async (events: GameEvent[]) => {
      const gen = ++generationRef.current;
      setBusyBoth(true);
      for (const beat of groupBeats(events)) {
        if (generationRef.current !== gen) return;
        applyBeat(beat);
        await sleep(beatDuration(beat) * ANIM_SCALE);
      }
      if (generationRef.current !== gen) return;
      setVisual((v) => syncFrom(gameRef.current, v.ships));
      setBusyBoth(false);
    },
    [applyBeat],
  );

  /** 玩家行动入口：动画期间与非 playing 状态忽略 */
  const act = useCallback(
    (action: Action) => {
      if (busyRef.current) return;
      const cur = gameRef.current;
      if (cur.phase !== 'playing') return;
      const { state: next, events } = resolveTurn(cur, action);
      if (events.length === 0) return; // 非法动作
      gameRef.current = next;
      setGame(next);
      if (next.phase === 'gameOver') {
        updateBest(next.score, next.level);
        clearRun();
      } else {
        if (next.phase === 'levelCleared') updateBest(next.score, next.level);
        saveRun(next);
      }
      void playEvents(events);
    },
    [playEvents],
  );

  /** 跳过在播动画，直接对齐最终态 */
  const skip = useCallback(() => {
    if (!busyRef.current) return;
    generationRef.current++;
    setVisual((v) => syncFrom(gameRef.current, v.ships));
    setBusyBoth(false);
  }, []);

  /** 过关后进入下一关 */
  const nextLevel = useCallback(() => {
    const cur = gameRef.current;
    if (cur.phase !== 'levelCleared') return;
    const next = startLevel(cur, cur.level + 1);
    generationRef.current++;
    gameRef.current = next;
    setGame(next);
    saveRun(next);
    setVisual(syncFrom(next)); // 新棋盘，不保留旧角度
    setBusyBoth(false);
  }, []);

  /** 特效播完自移除（浏览器 onAnimationEnd；jsdom 由下次 sync 清空兜底） */
  const removeEffect = useCallback((key: number) => {
    setVisual((v) => ({ ...v, effects: v.effects.filter((f) => f.key !== key) }));
  }, []);

  return { game, visual, busy, act, skip, nextLevel, removeEffect };
}
