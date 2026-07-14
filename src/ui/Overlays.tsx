// ===== 过关 / 游戏结束浮层 =====
import { levelClearBonus } from '../engine/score';
import { loadBest } from '../game/storage';

interface ClearedProps {
  level: number;
  score: number;
  onNext: () => void;
}

export function LevelClearedOverlay({ level, score, onNext }: ClearedProps) {
  return (
    <div className="overlay">
      <div className="card overlay-card">
        <h2>第 {level} 关肃清！</h2>
        <p className="overlay-sub">
          过关奖励 <b>+{levelClearBonus(level)}</b> · 当前得分 <b>{score}</b>
        </p>
        <button className="btn btn-primary" onClick={onNext} autoFocus>
          启航下一关 ⛵
        </button>
        <p className="overlay-hint">回车 / 空格 继续</p>
      </div>
    </div>
  );
}

interface OverProps {
  level: number;
  score: number;
  onNewRun: () => void;
  onExit: () => void;
}

export function GameOverOverlay({ level, score, onNewRun, onExit }: OverProps) {
  const best = loadBest();
  const isRecord = score >= best.bestScore && score > 0;
  return (
    <div className="overlay">
      <div className="card overlay-card">
        <h2>孤帆沉没…</h2>
        <p className="overlay-sub">
          止步第 <b>{level}</b> 关 · 总分 <b>{score}</b>
          {isRecord ? ' 🏅 新纪录！' : ''}
        </p>
        <p className="overlay-best">
          最高纪录：{Math.max(best.bestScore, score)} 分 · 第 {Math.max(best.bestLevel, level)} 关
        </p>
        <div className="overlay-actions">
          <button className="btn btn-primary" onClick={onNewRun} autoFocus>
            再来一局
          </button>
          <button className="btn" onClick={onExit}>
            返回菜单
          </button>
        </div>
      </div>
    </div>
  );
}
