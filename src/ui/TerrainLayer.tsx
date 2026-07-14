// ===== 地形层：唯一的 pointer-events 层，格点击/悬停都从这里分发 =====
import type { Terrain } from '../engine/types';

interface Props {
  terrain: Terrain[];
  width: number;
  onCellClick: (i: number) => void;
  onCellHover: (i: number | null) => void;
}

function TerrainIcon({ t }: { t: Terrain }) {
  switch (t) {
    case 'island':
      return (
        <svg viewBox="0 0 100 100" className="terrain-svg">
          <polygon
            points="50,16 76,32 84,58 68,82 34,84 16,62 22,34"
            fill="var(--island)"
            stroke="var(--island-dark)"
            strokeWidth="4"
          />
          <polygon points="46,34 62,42 58,60 40,58" fill="var(--island-dark)" opacity="0.35" />
        </svg>
      );
    case 'reef':
      return (
        <svg viewBox="0 0 100 100" className="terrain-svg">
          <polygon points="30,78 42,42 54,78" fill="var(--reef)" />
          <polygon points="48,80 62,34 76,80" fill="var(--reef)" opacity="0.85" />
          <polygon points="18,82 27,58 36,82" fill="var(--reef)" opacity="0.7" />
        </svg>
      );
    case 'vortex':
      return (
        <svg viewBox="0 0 100 100" className="terrain-svg vortex-svg">
          <circle cx="50" cy="50" r="30" fill="none" stroke="var(--vortex)" strokeWidth="7" strokeDasharray="42 22" strokeLinecap="round" />
          <circle cx="50" cy="50" r="16" fill="none" stroke="var(--vortex)" strokeWidth="6" strokeDasharray="20 14" strokeLinecap="round" opacity="0.75" />
          <circle cx="50" cy="50" r="4" fill="var(--vortex)" />
        </svg>
      );
    default:
      return null;
  }
}

export function TerrainLayer({ terrain, width, onCellClick, onCellHover }: Props) {
  return (
    <div className="terrain-grid" onMouseLeave={() => onCellHover(null)}>
      {terrain.map((t, i) => (
        <div
          key={i}
          // 残骸由 WrecksLayer 动态渲染，这里按水面处理
          className={`cell t-${t === 'wreck' ? 'water' : t} ${(Math.floor(i / width) + i) % 2 === 0 ? 'cell-even' : ''}`}
          onClick={() => onCellClick(i)}
          onMouseEnter={() => onCellHover(i)}
        >
          <TerrainIcon t={t === 'wreck' ? 'water' : t} />
        </div>
      ))}
    </div>
  );
}
