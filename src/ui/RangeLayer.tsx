// ===== 射界层：方向性火力走廊 + 目标锁定框 + 移动提示 =====
// 每条射线渲染为一条"走廊"：箭羽沿射向外推、亮度随距离衰减；
// 命中格套取景框式锁定框；被挡格降为哑光端点。悬停预览为幽灵样式。
import type { CSSProperties } from 'react';
import { DIR_ANGLE, colOf, dirFromTo, rowOf } from '../engine/geometry';
import type { RayResult } from '../engine/rules';

interface Props {
  width: number;
  /** 玩家格（当前射线起点） */
  origin: number;
  currentRays: [RayResult, RayResult] | null;
  /** 悬停格移动后的预览射线及其起点 */
  previewRays: [RayResult, RayResult] | null;
  previewOrigin: number | null;
  moveTargets: number[];
  busy: boolean;
}

function pos(i: number, w: number): CSSProperties {
  return { '--r': rowOf(i, w), '--c': colOf(i, w) } as CSSProperties;
}

/** 双箭羽（默认朝北，容器按 --a 旋转） */
function Chevron() {
  return (
    <svg viewBox="0 0 100 100" className="lane-chevron">
      <path d="M26 58 L50 34 L74 58" />
      <path d="M26 82 L50 58 L74 82" className="lane-chevron-2" />
    </svg>
  );
}

/** 取景框式锁定框 + 中心点 */
function Reticle({ ghost }: { ghost?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={ghost ? 'reticle reticle-ghost' : 'reticle'}>
      <path d="M14 36 V14 H36" />
      <path d="M64 14 H86 V36" />
      <path d="M86 64 V86 H64" />
      <path d="M36 86 H14 V64" />
      <circle cx="50" cy="50" r="5" className="reticle-dot" />
    </svg>
  );
}

/** 单条射线的走廊格序列 */
function Lane({
  ray,
  origin,
  width,
  ghost,
}: {
  ray: RayResult;
  origin: number;
  width: number;
  ghost: boolean;
}) {
  if (ray.cells.length === 0) return null;
  const angle = DIR_ANGLE[dirFromTo(origin, ray.cells[0]!, width)];
  const base = ghost ? 'range-preview' : 'range-cell';
  return (
    <>
      {ray.cells.map((cell, k) => {
        const isLast = k === ray.cells.length - 1;
        if (isLast && ray.hitShipId !== undefined) {
          return (
            <div
              key={cell}
              className={`${base} range-hit${ghost ? ' range-preview-hit' : ''}`}
              style={pos(cell, width)}
            >
              <Reticle ghost={ghost} />
            </div>
          );
        }
        if (isLast && ray.blockedBy) {
          return <div key={cell} className={`${base} lane-blocked`} style={pos(cell, width)} />;
        }
        return (
          <div
            key={cell}
            className={base}
            style={{ ...pos(cell, width), '--a': angle, '--k': k } as CSSProperties}
          >
            <Chevron />
          </div>
        );
      })}
    </>
  );
}

export function RangeLayer({
  width,
  origin,
  currentRays,
  previewRays,
  previewOrigin,
  moveTargets,
  busy,
}: Props) {
  if (busy) return null;
  return (
    <div className="range-layer">
      {currentRays?.map((ray) => (
        <Lane key={ray.side} ray={ray} origin={origin} width={width} ghost={false} />
      ))}
      {previewRays !== null &&
        previewOrigin !== null &&
        previewRays.map((ray) => (
          <Lane key={`p-${ray.side}`} ray={ray} origin={previewOrigin} width={width} ghost />
        ))}
      {moveTargets.map((i) => (
        <div key={`m${i}`} className="move-hint" style={pos(i, width)} />
      ))}
    </div>
  );
}
