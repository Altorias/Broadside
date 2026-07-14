// ===== 射界层：常显当前射界 + 悬停移动预览 + 可移动提示 =====
import type { CSSProperties } from 'react';
import { colOf, rowOf } from '../engine/geometry';
import type { RayResult } from '../engine/rules';

interface Props {
  width: number;
  /** 当前朝向的两舷射线（常显） */
  currentRays: [RayResult, RayResult] | null;
  /** 悬停格移动后的预览射线 */
  previewRays: [RayResult, RayResult] | null;
  /** 可移动目标格 */
  moveTargets: number[];
  busy: boolean;
}

function cellStyle(i: number, w: number): CSSProperties {
  return { '--r': rowOf(i, w), '--c': colOf(i, w) } as CSSProperties;
}

export function RangeLayer({ width, currentRays, previewRays, moveTargets, busy }: Props) {
  if (busy) return null;
  const cells: { i: number; cls: string }[] = [];
  if (currentRays) {
    for (const ray of currentRays) {
      ray.cells.forEach((cell, k) => {
        const isHit = ray.hitShipId !== undefined && k === ray.cells.length - 1;
        cells.push({ i: cell, cls: isHit ? 'range-cell range-hit' : 'range-cell' });
      });
    }
  }
  if (previewRays) {
    for (const ray of previewRays) {
      ray.cells.forEach((cell, k) => {
        const isHit = ray.hitShipId !== undefined && k === ray.cells.length - 1;
        cells.push({ i: cell, cls: isHit ? 'range-preview range-preview-hit' : 'range-preview' });
      });
    }
  }
  return (
    <div className="range-layer">
      {cells.map(({ i, cls }, k) => (
        <div key={`r${k}`} className={cls} style={cellStyle(i, width)} />
      ))}
      {moveTargets.map((i) => (
        <div key={`m${i}`} className="move-hint" style={cellStyle(i, width)} />
      ))}
    </div>
  );
}
