// ===== App：视图路由（菜单 / 对局）=====
import { useState } from 'react';
import { newRogueRun, newRun } from '../engine/generator';
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
  const [gameNo, setGameNo] = useState(0);
  const [best, setBest] = useState(() => loadBest());
  const [levelsResume, setLevelsResume] = useState<GameState | null>(() => loadRun('levels'));
  const [rogueResume, setRogueResume] = useState<GameState | null>(() => loadRun('rogue'));

  const launch = (state: GameState) => {
    setInitial(state);
    setGameNo((n) => n + 1);
    setView('game');
  };
  const startLevelsRun = () => launch(newRun(initialSeed ?? randomSeed()));
  const startRogueRun = () => launch(newRogueRun(initialSeed ?? randomSeed()));
  const continueRun = (state: GameState) => launch(state);
  const abandonRun = (mode: 'levels' | 'rogue') => {
    clearRun(mode);
    if (mode === 'levels') setLevelsResume(null);
    else setRogueResume(null);
  };
  const exitToMenu = () => {
    setLevelsResume(loadRun('levels'));
    setRogueResume(loadRun('rogue'));
    setBest(loadBest());
    setView('menu');
  };

  if (view === 'game' && initial) {
    return <GameView key={gameNo} initial={initial} onExit={exitToMenu} onNewRun={startLevelsRun} />;
  }

  return (
    <div className="menu">
      <header className="menu-head">
        <h1>怒海孤帆</h1>
        <p className="menu-tagline">Broadside · 回合制海战</p>
      </header>

      {rogueResume && (
        <div className="card menu-card resume-card">
          <p>肉鸽航行到 <b>第 {rogueResume.level}/15 层</b>（{rogueResume.score} 分 · 船体 {rogueResume.lives}/{rogueResume.stats.maxLives} · {rogueResume.abilities.length} 强化）</p>
          <div className="menu-actions">
            <button className="btn btn-primary" onClick={() => continueRun(rogueResume)}>继续</button>
            <button className="btn btn-ghost" onClick={() => abandonRun('rogue')}>放弃</button>
          </div>
        </div>
      )}
      {levelsResume && (
        <div className="card menu-card resume-card">
          <p>关卡制航行到 <b>第 {levelsResume.level} 关</b>（{levelsResume.score} 分 · 剩 {levelsResume.lives} 命）</p>
          <div className="menu-actions">
            <button className="btn btn-primary" onClick={() => continueRun(levelsResume)}>继续</button>
            <button className="btn btn-ghost" onClick={() => abandonRun('levels')}>放弃</button>
          </div>
        </div>
      )}

      <div className="card menu-card">
        <button className="btn btn-primary btn-big" onClick={startLevelsRun}>
          ⚔️ 新的征程 · 关卡制
        </button>
        <button className="btn btn-big" onClick={startRogueRun}>
          🎲 肉鸽模式
        </button>
        {best.bestScore > 0 && (
          <p className="menu-best">
            🏅 关卡制：{best.bestScore} 分 · 第 {best.bestLevel} 关
            {best.rogueBestLevel > 0 && <> ｜ 肉鸽：最远 {best.rogueBestLevel} 层 · {best.rogueWins} 胜</>}
          </p>
        )}
      </div>

      <div className="card menu-card menu-rules">
        <h3>玩法</h3>
        <ul>
          <li>每回合二选一：<b>移动一格</b>（8 向）或<b>舷侧齐射</b>（左右两侧各 3 格）</li>
          <li>海盗船每回合逼近你一步，<b>撞上你就损失 1 条命</b></li>
          <li>炮打不完就<b>借刀杀人</b>：引它们撞岛、撞礁、互撞、坠入漩涡（分更高！）</li>
          <li>关卡制无限关；<b>肉鸽模式</b> 15 层爬塔，关间三选一强化，永久死亡</li>
        </ul>
      </div>
    </div>
  );
}
