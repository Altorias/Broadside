// ===== App：视图路由（菜单 / 对局）=====
import { useState } from 'react';
import { newRun } from '../engine/generator';
import type { GameState } from '../engine/types';
import { clearRun, loadBest, loadRun } from '../game/storage';
import { GameView } from './GameView';

type View = 'menu' | 'game';

function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

export function App({ initialSeed }: { initialSeed?: number } = {}) {
  const [view, setView] = useState<View>('menu');
  const [initial, setInitial] = useState<GameState | null>(null);
  const [gameNo, setGameNo] = useState(0); // 每次开局递增，用作 GameView remount key
  const [resume, setResume] = useState<GameState | null>(() => loadRun());
  const [best, setBest] = useState(() => loadBest());

  const launch = (state: GameState) => {
    setInitial(state);
    setGameNo((n) => n + 1);
    setView('game');
  };
  const startNew = () => launch(newRun(initialSeed ?? randomSeed()));
  const continueRun = () => {
    if (resume) launch(resume);
  };
  const abandonRun = () => {
    clearRun();
    setResume(null);
  };
  const exitToMenu = () => {
    setResume(loadRun());
    setBest(loadBest());
    setView('menu');
  };

  if (view === 'game' && initial) {
    return <GameView key={gameNo} initial={initial} onExit={exitToMenu} onNewRun={startNew} />;
  }

  return (
    <div className="menu">
      <header className="menu-head">
        <h1>怒海孤帆</h1>
        <p className="menu-tagline">Broadside · 回合制海战</p>
      </header>

      {resume && (
        <div className="card menu-card resume-card">
          <p>
            有一局航行到 <b>第 {resume.level} 关</b>（{resume.score} 分 · 剩 {resume.lives} 命）
          </p>
          <div className="menu-actions">
            <button className="btn btn-primary" onClick={continueRun}>
              继续上局
            </button>
            <button className="btn btn-ghost" onClick={abandonRun}>
              放弃
            </button>
          </div>
        </div>
      )}

      <div className="card menu-card">
        <button className="btn btn-primary btn-big" onClick={startNew}>
          ⚔️ 新的征程
        </button>
        <button className="btn btn-big" disabled title="第二阶段开发中">
          🎲 肉鸽模式 · 敬请期待
        </button>
        {best.bestScore > 0 && (
          <p className="menu-best">
            🏅 最高纪录：{best.bestScore} 分 · 第 {best.bestLevel} 关
          </p>
        )}
      </div>

      <div className="card menu-card menu-rules">
        <h3>玩法</h3>
        <ul>
          <li>每回合二选一：<b>移动一格</b>（8 向）或<b>舷侧齐射</b>（左右两侧各 3 格）</li>
          <li>海盗船每回合逼近你一步，<b>撞上你就损失 1 条命</b></li>
          <li>炮打不完就<b>借刀杀人</b>：引它们撞岛、撞礁、互撞、坠入漩涡（分更高！）</li>
          <li>你驶入漩涡会被随机传送——绝境逃生用</li>
          <li>清光所有海盗船即过关，关卡无限、难度渐增</li>
        </ul>
      </div>
    </div>
  );
}
