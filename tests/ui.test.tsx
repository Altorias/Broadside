// @vitest-environment jsdom
// ===== UI 集成测试：菜单 → 开局 → 交互 → 存档 =====
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { step } from '../src/engine/geometry';
import { legalMoves } from '../src/engine/rules';
import type { GameState } from '../src/engine/types';
import { App } from '../src/ui/App';

beforeEach(() => {
  localStorage.clear();
  cleanup();
});

function loadSave(): GameState {
  return JSON.parse(localStorage.getItem('broadside:run')!) as GameState;
}

async function startGame() {
  render(<App initialSeed={4242} />);
  fireEvent.click(screen.getByText('⚔️ 新的征程'));
  await waitFor(() => expect(document.querySelector('.board')).toBeTruthy());
}

describe('App 集成', () => {
  it('菜单渲染标题与玩法说明', () => {
    render(<App />);
    expect(screen.getByText('怒海孤帆')).toBeTruthy();
    expect(screen.getByText('玩法')).toBeTruthy();
    // 肉鸽入口占位且禁用
    const rogue = screen.getByText(/肉鸽模式/) as HTMLButtonElement;
    expect(rogue.disabled).toBe(true);
  });

  it('新对局：棋盘 + 4 艘船（玩家 + L1 三敌）+ 射界常显 + 存档写入', async () => {
    await startGame();
    expect(document.querySelectorAll('.ship')).toHaveLength(4);
    expect(document.querySelectorAll('.ship-player')).toHaveLength(1);
    expect(document.querySelectorAll('.range-cell').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.move-hint').length).toBeGreaterThan(0);
    const save = loadSave();
    expect(save.level).toBe(1);
    expect(save.turn).toBe(0);
  });

  it('点击相邻格移动：回合推进、位置更新、敌船逼近', async () => {
    await startGame();
    const before = loadSave();
    const dir = legalMoves(before)[0]!;
    const target = step(before.player.pos, dir, before.width, before.height);
    fireEvent.click(document.querySelectorAll('.cell')[target]!);
    await waitFor(() => {
      const after = loadSave();
      expect(after.turn).toBe(1);
      expect(after.player.pos).toBe(target);
    });
  });

  it('点击自己的船开炮：回合推进、位置不变', async () => {
    await startGame();
    const before = loadSave();
    fireEvent.click(document.querySelectorAll('.cell')[before.player.pos]!);
    await waitFor(() => {
      const after = loadSave();
      expect(after.turn).toBe(1);
      expect(after.player.pos).toBe(before.player.pos);
    });
  });

  it('键盘：空格开炮、WASD 移动', async () => {
    await startGame();
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(loadSave().turn).toBe(1));
    const mid = loadSave();
    const dir = legalMoves(mid)[0]!;
    const keyByDir: Record<string, string> = {
      N: 'w', S: 's', W: 'a', E: 'd', NW: 'q', NE: 'e', SW: 'z', SE: 'c',
    };
    fireEvent.keyDown(window, { key: keyByDir[dir]! });
    await waitFor(() => expect(loadSave().turn).toBe(2));
  });

  it('退出到菜单显示续玩卡片，继续后回到对局', async () => {
    await startGame();
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(loadSave().turn).toBe(1));
    fireEvent.click(screen.getByText('← 菜单'));
    expect(await screen.findByText('继续上局')).toBeTruthy();
    fireEvent.click(screen.getByText('继续上局'));
    await waitFor(() => expect(document.querySelector('.board')).toBeTruthy());
    expect(loadSave().turn).toBe(1); // 从存档续玩
  });

  it('放弃存档后续玩卡片消失', async () => {
    await startGame();
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(loadSave().turn).toBe(1));
    fireEvent.click(screen.getByText('← 菜单'));
    fireEvent.click(await screen.findByText('放弃'));
    await waitFor(() => expect(screen.queryByText('继续上局')).toBeNull());
    expect(localStorage.getItem('broadside:run')).toBeNull();
  });
});
