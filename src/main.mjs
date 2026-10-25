import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog, screen, powerMonitor } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { Engine, providers, validateSettings } from './engine.mjs';
import { saveJSON } from './store.mjs';
import { taskbarResetItems, taskbarText, taskbarPercentages } from './presence.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const smoke = process.argv.includes('--smoke');
// The target Windows GPU failed Chromium readback; these static charts use software rendering.
app.disableHardwareAcceleration();
if (smoke) app.setPath('userData', join(root, '.test-output', 'smoke-profile'));
app.setName('TokenTrailer');
app.setAppUserModelId('local.tokentrailer.desktop');
const lock = app.requestSingleInstanceLock();
if (!lock) { app.quit(); } else {
  let engine, dashboard, widget, popup, tray, helper, quitting = false, presence = { state: 'starting' }, nativeWrite = Promise.resolve(), mutation = Promise.resolve();
  const serialize = fn => { const job = mutation.then(fn); mutation = job.catch(() => {}); return job; };
  const open = () => { if (dashboard) { if (dashboard.isMinimized()) dashboard.restore(); dashboard.show(); dashboard.focus(); } };
  app.on('second-instance', open);
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; engine?.stop(); helper?.kill(); });
  app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try {
    engine = await new Engine(app.getPath('userData')).init();
    if (smoke) {
      const now = new Date(); now.setHours(Math.max(0, now.getHours() - 1), 15, 0, 0);
      engine.store.events = Object.fromEntries(providers.map((provider, i) => [`fixture-${i}`, {
        key: `fixture-${i}`, provider, session: `fixture-session-${i}`, project: i === 2 ? '미확인' : 'C:\\demo\\TokenTrailer',
        client: provider === 'codex' ? 'Codex Desktop' : provider, timestamp: now.toISOString(), model: 'fixture-model',
        total: (i + 1) * 12000, input: (i + 1) * 10000, output: (i + 1) * 2000, cacheRead: 1000, cacheWrite: 0, reasoning: 0,
      }]));
      engine.settings.sources.codex.enabled = true;
      for (const p of providers) {
        engine.settings.sources[p].quota = true;
        engine.quotas[p] = { state: 'success', planLabel: '테스트 데이터', windows: [{ modelId: 'five_hour', usedPercent: 36, resetsAt: Date.now() + 3600000 }, { modelId: 'seven_day', usedPercent: 64, resetsAt: Date.now() + 86400000 }], fetchedAt: Date.now() };
      }
    }
    function window(isWidget, isPopup = false) {
      const mini = isWidget && !isPopup;
      const win = new BrowserWindow({ width: mini ? 250 : isWidget ? 360 : 1240, height: mini ? 62 : isWidget ? 300 : 900,
        minWidth: mini ? 250 : isWidget ? 280 : 760, minHeight: mini ? 30 : isWidget ? 120 : 560,
        transparent: mini, resizable: !mini, frame: !isWidget || isPopup, show: false, title: 'TokenTrailer',
        backgroundColor: mini ? '#00000000' : '#0c111b', skipTaskbar: isWidget, autoHideMenuBar: true,
        webPreferences: { preload: join(root, 'src', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', e => e.preventDefault());
      win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); if (isWidget && !isPopup) serialize(async () => { const next = structuredClone(engine.settings); next.widget = false; await engine.configure(next); }).catch(() => {}); } });
      if (!isWidget && (!engine.settings.hiddenStart || smoke)) win.once('ready-to-show', () => win.show());
      win.loadFile(join(root, 'src', 'ui', 'index.html'), isPopup ? { query: { quota: '1' } } : isWidget ? { query: { widget: '1' } } : {});
      return win;
    }
    dashboard = window(false); widget = window(true); popup = window(true, true);
    popup.setAlwaysOnTop(true);
    popup.on('blur', () => popup.hide());
    function openPopup(resetTimes = false) {
      if (popup.isVisible() && !resetTimes) { popup.hide(); return; }
      const cursor = screen.getCursorScreenPoint();
      const work = (resetTimes ? screen.getDisplayNearestPoint(cursor) : screen.getPrimaryDisplay()).workArea;
      const width = Math.min(380, work.width), height = Math.min(650, work.height);
      popup.setBounds({ x: resetTimes ? Math.max(work.x, Math.min(cursor.x, work.x + work.width - width)) : work.x + work.width - width,
        y: resetTimes ? Math.max(work.y, Math.min(cursor.y, work.y + work.height - height)) : work.y + work.height - height, width, height });
      popup.webContents.send('changed');
      popup.show(); popup.focus();
    }
    function onNativeMessage(value) {
      if (value.doubleClick) { popup.hide(); open(); }
      else if (value.rightClick) popup.hide();
      else if (value.click) return;
      else { presence = value; notify(); }
    }
    let boundsTimer;
    widget.on('moved', () => {
      clearTimeout(boundsTimer);
      boundsTimer = setTimeout(() => serialize(async () => { const next = structuredClone(engine.settings); next.widgetBounds = widget.getBounds(); await engine.configure(next); }).catch(() => {}), 500);
    });
    function widgetHeight() {
      return Math.max(32, 2 + engine.view().connectedProviders.reduce((n, p) => n + 11 + Math.max(1, engine.quotas[p]?.windows?.length ?? 1) * 20, 0));
    }
    function resizeWidget() {
      const work = screen.getDisplayMatching(widget.getBounds()).workArea;
      const height = Math.min(widgetHeight(), work.height);
      if (widget.getSize()[1] !== height) widget.setSize(250, height);
    }
    function restoreWidget() {
      const b = engine.settings.widgetBounds, work = screen.getDisplayMatching(b ?? { x: 0, y: 0, width: 360, height: 610 }).workArea;
      const width = 250, height = Math.min(widgetHeight(), work.height);
      widget.setBounds({ x: Math.max(work.x, Math.min(b?.x ?? work.x + work.width - width - 20, work.x + work.width - width)),
        y: Math.max(work.y, Math.min(b?.y ?? work.y + 20, work.y + work.height - height)), width, height });
    }
    function applySurfaces() {
      restoreWidget();
      widget.setAlwaysOnTop(engine.settings.alwaysOnTop);
      if (engine.settings.widget) widget.showInactive(); else widget.hide();
      updateNative();
    }
    const icon = nativeImage.createFromPath(join(root, 'src', 'ui', 'tray.png'));
    tray = new Tray(icon); tray.setToolTip('TokenTrailer · 오늘 로컬 토큰'); tray.on('double-click', open);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '사용량 열기', click: open }, { label: '새로고침', click: () => { engine.scan(); engine.refreshQuotas(true); } },
      { label: '위젯 표시 / 숨김', click: () => serialize(async () => { const next = structuredClone(engine.settings); next.widget = !next.widget; await engine.configure(next); applySurfaces(); }).catch(() => {}) },
      { type: 'separator' }, { label: 'TokenTrailer 종료', click: () => app.quit() },
    ]));
    const trusted = event => { if (![dashboard.webContents.id, widget.webContents.id, popup.webContents.id].includes(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted caller'); };
    ipcMain.handle('snapshot', (event, filter = {}) => {
      trusted(event);
      if (!filter || !['today', 'week', 'month', undefined].includes(filter.period) || !['all', 'connected', ...providers, undefined].includes(filter.provider) ||
          filter.project != null && typeof filter.project !== 'string' || filter.bucket != null && !Number.isFinite(filter.bucket)) throw new Error('Invalid filter');
      return { ...engine.view({ period: filter.period, provider: filter.provider, project: filter.project, bucket: filter.bucket }), presence };
    });
    ipcMain.handle('save-settings', (event, next) => { trusted(event); validateSettings(next); return serialize(async () => {
      const previous = engine.settings;
      const args = app.isPackaged ? [] : [root];
      if (next.autoStart !== previous.autoStart && !smoke) {
        app.setLoginItemSettings({ openAtLogin: next.autoStart, path: process.execPath, args });
        if (app.getLoginItemSettings({ path: process.execPath, args }).openAtLogin !== next.autoStart) throw new Error('자동 시작 등록 실패');
      }
      try { await engine.configure(next); } catch (error) { if (!smoke && next.autoStart !== previous.autoStart) app.setLoginItemSettings({ openAtLogin: previous.autoStart, path: process.execPath, args }); throw error; }
      applySurfaces(); if (!smoke && JSON.stringify(next.sources) !== JSON.stringify(previous.sources)) { engine.scan(); engine.refreshQuotas(true); } return true;
    }); });
    ipcMain.handle('refresh', event => { trusted(event); if (smoke) return true; engine.scan(); engine.refreshQuotas(true); return true; });
    ipcMain.handle('session', (event, key) => {
      trusted(event); if (typeof key !== 'string' || key.length > 500) throw new Error('Invalid session');
      const events = Object.values(engine.store.events).filter(e => `${e.provider}:${e.session}` === key).sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
      return { session: events[0]?.session ?? '미확인', total: events.reduce((n, e) => n + e.total, 0), events };
    });
    ipcMain.handle('history', async (event, action, provider) => {
      trusted(event); if (!['delete', 'reimport'].includes(action) || !['all', ...providers].includes(provider)) throw new Error('Invalid request');
      const choice = await dialog.showMessageBox(dashboard, { type: 'question', buttons: ['취소', '진행'], defaultId: 0, cancelId: 0,
        message: action === 'delete' ? '선택한 앱 이력을 삭제할까요?' : '선택한 과거 기록을 다시 수집할까요?', detail: '원본 기록은 변경하지 않습니다. 삭제 시 제외 식별자를 유지하여 자동 재수입을 막습니다.' });
      if (choice.response !== 1) return false;
      await serialize(() => engine.historyAction(action, provider)); return true;
    });
    ipcMain.handle('open-dashboard', event => { trusted(event); open(); });
    ipcMain.handle('quit', event => { trusted(event); app.quit(); });
    function notify() { for (const win of [dashboard, widget, popup]) if (!win.isDestroyed()) win.webContents.send('changed'); }
    function updateNative() {
      const value = engine.view(), caption = taskbarText(value.settings, value.quotas);
      nativeWrite = nativeWrite.then(() => saveJSON(join(app.getPath('userData'), 'taskbar-state.json'), { caption,
        compactCaption: taskbarText(value.settings, value.quotas, true), resetMenuItems: taskbarResetItems(value.settings, value.quotas), percentages: taskbarPercentages(value.settings, value.quotas), enabled: value.settings.taskbar })).catch(() => { presence = { state: 'state-write-failed' }; });
      tray.setToolTip(`TokenTrailer · ${caption.replaceAll('\n', ' / ')}`.slice(0, 127));
    }
    engine.on('change', () => { resizeWidget(); notify(); updateNative(); });
    restoreWidget(); applySurfaces();
    screen.on('display-metrics-changed', restoreWidget); screen.on('display-removed', restoreWidget);
    powerMonitor.on('resume', () => { if (!smoke) { engine.scan(); engine.refreshQuotas(); } restoreWidget(); });
    await nativeWrite;
    if (process.platform === 'win32') {
      helper = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'src', 'native', 'taskbar.ps1'), '-StateFile', join(app.getPath('userData'), 'taskbar-state.json'), '-OwnerPid', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let buffer = '';
      helper.stdout.on('data', chunk => { buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop(); for (const line of lines) { try { onNativeMessage(JSON.parse(line)); } catch {} } });
      helper.stderr.on('data', () => { presence = { state: 'helper-error' }; notify(); });
      helper.on('error', () => { presence = { state: 'helper-unavailable' }; notify(); });
      helper.on('exit', () => { presence = { state: 'helper-stopped' }; notify(); });
    }
    if (smoke) {
      const { runSmoke } = await import('./smoke.mjs');
      await runSmoke({ dashboard, widget, popup, openPopup, onNativeMessage, engine, root, helperPid: helper?.pid, presence: () => presence });
      app.quit();
    } else engine.start();
  } catch (error) {
    if (smoke) { console.error(error); app.exit(1); }
    else { dialog.showErrorBox('TokenTrailer 시작 실패', '앱 데이터 또는 실행 환경을 확인하세요. 기존 파일은 보존됩니다.'); app.quit(); }
  }
  });
}
