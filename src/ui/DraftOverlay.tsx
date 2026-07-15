// ===== 关间三选一抽卡面板 =====
import { ABILITIES } from '../engine/abilities';
import type { AbilityId } from '../engine/types';

const BRANCH_COLOR: Record<string, string> = {
  gunnery: 'var(--flame)',
  sailing: 'var(--accent)',
  tide: 'var(--vortex)',
  generic: 'var(--text-soft)',
};

interface Props {
  offer: AbilityId[];
  onPick: (id: AbilityId) => void;
  level: number;
  score: number;
}

export function DraftOverlay({ offer, onPick, level, score }: Props) {
  return (
    <div className="overlay">
      <div className="card overlay-card draft-card">
        <h2>第 {level} 关肃清 · 选择强化</h2>
        <p className="overlay-sub">得分 {score}</p>
        <div className="draft-grid">
          {offer.map((id, i) => {
            const def = ABILITIES[id];
            return (
              <button
                key={id}
                className="draft-card-btn"
                style={{ '--accent': BRANCH_COLOR[def.branch] } as React.CSSProperties}
                onClick={() => onPick(id)}
              >
                <span className="draft-badge">{['①','②','③'][i]}</span>
                <strong className="draft-name">{def.name}</strong>
                <small className="draft-desc">{def.desc}</small>
                <span
                  className="draft-branch"
                  style={{ background: BRANCH_COLOR[def.branch], color: '#fff' }}
                >
                  {{ gunnery: '炮术', sailing: '航海', tide: '潮汐', generic: '通用' }[def.branch]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="overlay-hint">按 1 2 3 选择</p>
      </div>
    </div>
  );
}
