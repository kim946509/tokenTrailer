import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function runSmoke({ dashboard, widget, popup, openPopup, onNativeMessage, engine, root, helperPid, presence }) {
  const output = join(root, '.test-output'); await mkdir(output, { recursive: true });
  const errors = [];
  for (const win of [dashboard, widget, popup]) win.webContents.on('console-message', (_e, level, message) => { if (level === 3) errors.push(message); });
  for (let i = 0; i < 50; i++) {
    if (dashboard.isVisible() && !dashboard.webContents.isLoading() && await dashboard.webContents.executeJavaScript('!!document.querySelector(".chart")')) break;
    await pause(200);
  }
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelector(".metric").textContent.includes("72K")'), true);
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelector(".metric").title'), '72,000 tokens');
  assert.equal(dashboard.isVisible(), true, 'Initial dashboard must be visible');
  assert.equal(await dashboard.webContents.executeJavaScript('typeof window.require'), 'undefined');
  for (const win of [dashboard, popup]) {
    assert.deepEqual(await win.webContents.executeJavaScript('[...document.querySelectorAll(".window strong")].slice(0,2).map(e=>getComputedStyle(e).color)'), ['rgb(118, 219, 155)', 'rgb(255, 180, 84)']);
  }
  await writeFile(join(output, 'dashboard.png'), (await dashboard.capturePage()).toPNG());
  await dashboard.webContents.executeJavaScript('[...document.querySelectorAll(".bar-col")].find(b=>b.getAttribute("aria-label").includes("72,000")).click()'); await pause(200);
  assert.equal(await dashboard.webContents.executeJavaScript('!!document.querySelector(".bar-col.active")'), true);
  await dashboard.webContents.executeJavaScript('[...document.querySelectorAll(".link")].find(b=>b.textContent.includes("TokenTrailer")).click()'); await pause(200);
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelectorAll(".split .card:nth-child(2) tbody tr").length'), 2);
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelectorAll(".provider-total").length'), 3);
  await dashboard.webContents.executeJavaScript('document.querySelector(".ai-tabs [data-provider=codex]").click()'); await pause(200);
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelector(".metric").textContent.includes("24K")'), true);
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelectorAll(".split .card:nth-child(2) tbody tr").length'), 1);
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelector(".split .card:first-child tbody").textContent.includes("24K")'), true);
  await writeFile(join(output, 'ai-filter.png'), (await dashboard.capturePage()).toPNG());
  await dashboard.webContents.executeJavaScript('[...document.querySelectorAll(".link")].find(b=>b.textContent.startsWith("fixture-session")).click()'); await pause(200);
  assert.equal(await dashboard.webContents.executeJavaScript('!!document.querySelector("dialog[open] table")'), true);
  await writeFile(join(output, 'session.png'), (await dashboard.capturePage()).toPNG());
  await dashboard.webContents.executeJavaScript('document.querySelector("dialog button").click()');
  await dashboard.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent==="연결 및 설정").click()');
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelectorAll("input[type=text]").length'), 3);
  const first = engine.settings.connectionOrder[0];
  await dashboard.webContents.executeJavaScript('document.querySelector(".order-row button:last-child").click()');
  await writeFile(join(output, 'settings.png'), (await dashboard.capturePage()).toPNG());
  await dashboard.webContents.executeJavaScript('(()=>{const c=[...document.querySelectorAll("label")].find(l=>l.textContent.includes("미니 위젯 표시")).querySelector("input");c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await pause(600);
  assert.equal(await dashboard.webContents.executeJavaScript('!!document.querySelector(".settings")'), true, 'Autosave stays on settings');
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelector(".settings-save").textContent.includes("저장됨")'), true);
  assert.equal(engine.settings.widget, true);
  assert.equal(engine.settings.connectionOrder[1], first);
  await dashboard.webContents.executeJavaScript('(()=>{const r=document.querySelector("#widget-opacity");r.value="50";r.dispatchEvent(new Event("change",{bubbles:true}));})()'); await pause(400);
  assert.equal(engine.settings.widgetOpacity, 0.5);
  assert.equal(await widget.webContents.executeJavaScript('getComputedStyle(document.querySelector(".compact-widget")).backgroundColor'), 'rgba(17, 26, 39, 0.5)');
  assert.equal(widget.getOpacity(), 1, 'Text must not use whole-window transparency');
  assert.equal(widget.getSize()[0], 250);
  assert.ok(widget.getSize()[1] <= 155);
  assert.equal(await widget.webContents.executeJavaScript('document.documentElement.scrollHeight <= innerHeight'), true);
  const originalHome = engine.settings.sources.claude.home;
  await dashboard.webContents.executeJavaScript('(()=>{const p=document.querySelector(".source[data-provider=claude] input[type=text]");p.value="relative-invalid";p.dispatchEvent(new Event("change",{bubbles:true}));})()'); await pause(250);
  assert.equal(engine.settings.sources.claude.home, originalHome);
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelector(".settings-save").textContent.includes("저장 실패")'), true);
  await dashboard.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.source[data-provider=claude] input[type=text]');p.value=${JSON.stringify(originalHome)};p.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(300);
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelector(".settings-save").textContent.includes("저장됨")'), true);
  await dashboard.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent==="사용량").click()'); await pause(200);
  openPopup(); await pause(250);
  assert.equal(popup.isVisible(), true);
  assert.equal(await popup.webContents.executeJavaScript('document.querySelectorAll(".card").length'), 3);
  assert.equal(await popup.webContents.executeJavaScript('document.body.textContent.includes("초기화")'), true);
  await writeFile(join(output, 'quota-popup.png'), (await popup.capturePage()).toPNG());
  popup.close(); assert.equal(popup.isDestroyed(), false);
  widget.showInactive(); await pause(250);
  await writeFile(join(output, 'widget.png'), (await widget.capturePage()).toPNG());
  assert.equal(await widget.webContents.executeJavaScript('document.querySelectorAll(".compact-quota").length'), 3);
  assert.equal(await widget.webContents.executeJavaScript('document.querySelector(".compact-value").textContent.includes("%")'), true);
  widget.show(); widget.focus();
  widget.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', x: 100, y: 100, clickCount: 1 });
  widget.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', x: 100, y: 100, clickCount: 1 });
  await pause(300);
  assert.equal(popup.isVisible(), false, 'Widget right click must stay inline');
  assert.equal(await widget.webContents.executeJavaScript('document.querySelector(".compact-value").textContent.includes("시간")'), true);
  await writeFile(join(output, 'reset-times.png'), (await widget.capturePage()).toPNG());
  await widget.webContents.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown",{key:"F10",shiftKey:true}))');
  assert.equal(await widget.webContents.executeJavaScript('document.querySelector(".compact-value").textContent.includes("%")'), true);
  for (let i = 0; i < 30 && ['starting', 'helper-error'].includes(presence().state); i++) await pause(500);
  assert.equal(presence().state, 'attached');
  const originalCaption = presence().displayCaption;
  let infoHandle;
  for (const dismissal of ['escape', 'toggle', 'escape', 'toggle', 'outside']) {
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'src/native/rightclick-check.ps1'), '-HelperPid', String(presence().helperPid), '-WindowHandle', String(presence().windowHandle), ...process.env.TT_OS_MOUSE_TEST ? [] : ['-MessageOnly']], { windowsHide: true });
    for (let i = 0; i < 60 && !presence().resetMenuVisible; i++) await pause(150);
    assert.equal(presence().resetMenuVisible, true, 'Native context menu stays open: ' + JSON.stringify({native:presence(),leftPopup:popup.isVisible()}));
    assert.equal(presence().displayCaption, originalCaption);
    assert.equal(presence().resetMenuError, '');
    infoHandle ??= presence().resetMenuHandle; assert.equal(presence().resetMenuHandle, infoHandle, 'Reuse one info window');
    if (dismissal === 'toggle') {
      await promisify(execFile)('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'src/native/rightclick-check.ps1'),'-HelperPid',String(presence().helperPid),'-WindowHandle',String(presence().windowHandle),'-MessageOnly'],{windowsHide:true});
      for(let i=0;i<20&&presence().resetMenuVisible;i++)await pause(150);
      assert.equal(presence().resetMenuVisible,false);continue;
    }

    const actualDismiss = process.env.TT_OS_MOUSE_TEST || process.env.TT_OS_DISMISS_TEST;
    const escape = dismissal === 'escape' || !actualDismiss;
    if (!escape) { widget.setAlwaysOnTop(true); widget.show(); widget.focus(); await pause(300); assert.equal(presence().resetMenuVisible,true,'Focus alone must not dismiss the information window'); }
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'src/native/rightclick-check.ps1'), '-HelperPid', String(escape ? presence().helperPid : process.pid), '-WindowHandle', String(escape ? presence().resetMenuHandle : widget.getNativeWindowHandle().readBigUInt64LE()), ...(escape ? ['-Escape','-ScreenshotPath',join(output,'taskbar-reset-info.png')] : ['-Left']), ...(actualDismiss ? [] : ['-MessageOnly'])], {windowsHide:true});
    for (let i = 0; i < 20 && presence().resetMenuVisible; i++) await pause(150);
    assert.equal(presence().resetMenuVisible, false, 'Dismiss native context menu: ' + dismissal);
    assert.equal(popup.isVisible(), false);
  }
  onNativeMessage({ click: true }); await pause(150); assert.equal(popup.isVisible(), false);
  for (const minimized of [false, true]) {
    if (minimized) dashboard.minimize(); else dashboard.hide();
    await promisify(execFile)('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'src/native/rightclick-check.ps1'),'-HelperPid',String(presence().helperPid),'-WindowHandle',String(presence().windowHandle),'-MessageOnly','-DoubleClick'],{windowsHide:true});
    for(let i=0;i<30&&(!dashboard.isVisible()||dashboard.isMinimized());i++)await pause(100);
    assert.equal(dashboard.isVisible(),true,'Double click opens main app');
    assert.equal(dashboard.isMinimized(),false,'Double click restores minimized app');
    await pause(1100);assert.equal(popup.isVisible(),false,'Double click must cancel pending single-click popup');
  }
  await promisify(execFile)('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'src/native/rightclick-check.ps1'),'-HelperPid',String(presence().helperPid),'-WindowHandle',String(presence().windowHandle),'-MessageOnly','-Left'],{windowsHide:true});
  await pause(1100);
  assert.equal(popup.isVisible(),false,'Single click must do nothing');
  const saved = structuredClone(engine.settings);
  const withoutGemini = structuredClone(saved); withoutGemini.sources.gemini.enabled = false; withoutGemini.sources.gemini.quota = false;
  await engine.configure(withoutGemini); await pause(300);
  assert.equal(await dashboard.webContents.executeJavaScript('document.querySelectorAll(".quota-grid>.card").length'), 2);
  assert.equal(await dashboard.webContents.executeJavaScript('!!document.querySelector(".ai-tabs [data-provider=gemini]")'), false);
  assert.equal(await widget.webContents.executeJavaScript('document.querySelectorAll(".compact-quota").length'), 2);
  assert.equal(Object.keys(engine.store.events).length, 3, 'Disconnect must preserve history');
  for (const p of Object.keys(withoutGemini.sources)) { withoutGemini.sources[p].enabled = false; withoutGemini.sources[p].quota = false; }
  await engine.configure(withoutGemini); await pause(250);
  assert.equal(await dashboard.webContents.executeJavaScript('!!document.querySelector(".onboarding")'), true);
  await engine.configure(saved); await pause(200);
  assert.deepEqual(errors, []);
  dashboard.close(); await pause(100); assert.equal(dashboard.isVisible(), false); assert.equal(dashboard.isDestroyed(), false);
  dashboard.show(); widget.close(); await pause(200); assert.equal(widget.isVisible(), false);
  const report = { renderer: 'pass', initialWindowVisible: 'pass', filters: 'pass', aiFilteredProjectSessions: 'pass', connectionOrderSave: 'pass', allQuotaPopup: 'pass', projectSessionDrilldown: 'pass', settingsSave: 'pass', widget: 'pass', widgetOpacity: 'background-only-50%-pass', compactWidgetSize: '250x155-pass', closeKeepsResident: 'pass', nodeIsolation: 'pass',
    taskbarDoubleClick: 'hidden-and-minimized-open-pass', singleClickDisabled: 'pass', resetTimeRightClick: 'widget-inline-taskbar-menu-pass', resetMenuDismiss: process.env.TT_OS_MOUSE_TEST || process.env.TT_OS_DISMISS_TEST ? 'OS-escape-and-outside-click-pass' : 'native-close-message-pass', nativeHelperMessageRoundTrip: 'pass', actualNativeMouseInput: process.env.TT_OS_MOUSE_TEST ? 'pass' : 'not-run', disconnectedHidden: 'pass', taskbar: presence(), fixtureDataOnly: true, liveQuota: false };
  await writeFile(join(output, 'smoke-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
