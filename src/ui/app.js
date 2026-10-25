import { quotaColor } from '../quota-color.mjs';
import { formatTokens as fmt } from '../token-format.mjs';
import { resetTimeText, remainingTimeText } from '../reset-time.mjs';
const api = window.trailer;
const root = document.querySelector('#app');
const widget = new URLSearchParams(location.search).has('widget');
const popup = new URLSearchParams(location.search).has('quota');
const filter = { period: 'today', provider: 'connected', bucket: null, project: null };
let page = 'dashboard', state, editing = false, loading = false, queued = false;
let showResetTimes = false;
function toggleResetTimes() { showResetTimes = !showResetTimes; render(); }
if (widget) {
  document.documentElement.classList.add('widget-document');
  document.addEventListener('contextmenu', event => { event.preventDefault(); toggleResetTimes(); });
  document.addEventListener('keydown', event => { if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); toggleResetTimes(); } });
  setInterval(() => { if (state && showResetTimes && !document.hidden) render(); }, 60000);
}
const names = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };
const labels = { success: '정상', partial: '일부 미확인', 'not-connected': '연결 안 됨', 'not-found': '기록 위치 없음', empty: '기록 없음', 'read-failed': '읽기 실패', 'authentication-required': '원래 CLI에서 로그인 필요', unsupported: '지원되지 않는 형식·계정', 'invalid-response': '응답 형식 미확인', 'access-denied': '접근 거부', 'rate-limited': '서버 요청 제한', 'request-failed': '조회 실패', timeout: '시간 초과', cancelled: '조회 취소' };
const exact = n => Number(n).toLocaleString('ko-KR');
function tokenTitle(element, value) { element.title = `${exact(value)} tokens`; return element; }
function tokenNumber(value) { return value == null ? '—' : tokenTitle(el('span', fmt(value)), value); }
const date = n => n ? new Date(n).toLocaleString('ko-KR') : '미확인';
const windowLabel = w => ({ five_hour: '5시간 한도', seven_day: '7일 한도', seven_day_opus: 'Opus · 7일', seven_day_sonnet: 'Sonnet · 7일' }[w.modelId] ??
  (w.durationSeconds ? `${w.durationSeconds % 86400 === 0 ? w.durationSeconds / 86400 + '일' : w.durationSeconds / 3600 + '시간'} 한도` : { primary_window: '기본 한도', secondary_window: '추가 한도' }[w.modelId] ?? w.modelId));
function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function add(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function button(text, action, cls) { const b = el('button', text, cls); b.type = 'button'; b.onclick = action; return b; }
function toast(message) { document.querySelector('.toast')?.remove(); const t = el('div', message, 'toast'); t.setAttribute('role', 'status'); document.body.append(t); setTimeout(() => t.remove(), 5500); }
async function action(fn) { try { return await fn(); } catch { toast('작업에 실패했습니다. 설정·파일 상태를 확인하고 다시 시도하세요.'); } }
function quotaCard(p, compact = false) {
  const q = state.quotas[p], source = state.settings.sources[p];
  const card = el('section', null, 'card');
  add(card, add(el('div', null, 'quota-title'), el('strong', names[p]), el('small', q?.planLabel ?? '계정 미확인')));
  add(card, el('div', source.quota ? labels[q?.state] ?? '조회 대기' : '한도 연결 안 됨', 'status'));
  if (p === 'gemini') add(card, el('small', '실계정 검증 전 · CLI 한도만 대상', 'warn'));
  for (const w of q?.windows ?? []) {
    const line = el('div', null, 'window');
    const usage = el('strong', `${w.usedPercent.toFixed(1)}% 사용`); usage.style.color = quotaColor(w.usedPercent);
    add(line, add(el('div', null, 'row'), el('small', windowLabel(w)), usage));
    const fill = el('div', null, 'fill'); fill.style.width = `${Math.min(100, Math.max(0, w.usedPercent))}%`;
    const remaining = remainingTimeText(w.resetsAt);
    add(line, add(el('div', null, 'track'), fill), el('small', compact ? (/미확인|갱신 대기/.test(remaining) ? '초기화 ' + remaining : remaining + ' 후 초기화') : resetTimeText(w.resetsAt))); add(card, line);
  }
  if (q?.stale) add(card, el('div', '이전 성공값 · 최신 조회 실패', 'warn'));
  if (q?.retryAt > Date.now()) add(card, el('div', `${date(q.retryAt)} 이후 재시도`, 'warn'));
  if (!compact) add(card, el('div', `갱신 ${date(q?.fetchedAt)} · 로컬 토큰과 별도 한도 창`, 'status'));
  return card;
}
function table(headers, rows) {
  const t = el('table'), head = el('tr'), body = el('tbody'); headers.forEach(h => head.append(el('th', h)));
  t.append(add(el('thead'), head), body);
  for (const row of rows) { const tr = el('tr'); row.forEach((value, i) => { const td = el('td', null, i === row.length - 1 ? 'number' : ''); td.append(value instanceof Node ? value : document.createTextNode(String(value))); tr.append(td); }); body.append(tr); }
  return t;
}
function compactQuota(p) {
  const q = state.quotas[p], card = el('section', null, 'compact-quota');
  card.dataset.provider = p;
  const mark = el('span', {claude:'✳',codex:'CX',gemini:'✦'}[p], 'provider-mark');
  mark.title = names[p] + ' · 끌어서 이동'; mark.dataset.provider = p;
  const rows = el('div', null, 'compact-rows'); add(card, mark, rows);
  card.title = names[p] + ' · ' + (q?.stale ? '이전 성공값 · 최신 조회 실패' : labels[q?.state] ?? '조회 대기');
  for (const w of q?.windows ?? []) {
    const text = showResetTimes ? remainingTimeText(w.resetsAt) : `${w.usedPercent.toFixed(0)}%`;
    const value = el('strong', text, 'compact-value');
    value.style.color = showResetTimes ? '#e6ecf6' : quotaColor(w.usedPercent);
    value.title = resetTimeText(w.resetsAt); value.setAttribute('aria-label', `${names[p]} ${windowLabel(w)} ${text} · ${resetTimeText(w.resetsAt)}`);
    const fill = el('div', null, 'fill'); fill.style.width = `${Math.min(100, Math.max(0, w.usedPercent))}%`;
    const label = el('small', windowLabel(w).replace(' 한도', '').replace('7일', '주간')); label.title = windowLabel(w);
    add(rows, add(el('div', null, 'compact-window'), label, add(el('div', null, 'track'), fill), value));
  }
  if (!q?.windows?.length) add(rows, add(el('div', null, 'compact-window unavailable'), el('small', state.settings.sources[p].quota ? labels[q?.state] ?? '조회 대기' : '한도 미연결'), el('strong', '—')));
  if (q?.stale) mark.classList.add('stale');
  return card;
}
function render() {
  root.replaceChildren();
  const shell = el('div', null, widget || popup ? 'widget' : 'shell'); root.append(shell);
  if (widget) {
    shell.classList.add('compact-widget');
    shell.style.backgroundColor = 'rgba(17, 26, 39, ' + state.settings.widgetOpacity + ')';
    shell.title = '우클릭 / Shift+F10: 사용률·남은 시간 전환 · 더블클릭: 상세 열기 · 아이콘: 끌어서 이동';
    shell.tabIndex = 0; shell.setAttribute('aria-label', shell.title);
    shell.ondblclick = () => api.open();
    for (const p of state.connectedProviders) add(shell, compactQuota(p));
    if (!state.connectedProviders.length) add(shell, button('AI 연결하기 ↗', () => api.open(), 'empty-connect'));
    return;
  }
  if (popup) {
    add(shell, add(el('div', null, 'top'), el('h1', 'TokenTrailer'), button('상세', () => api.open())));
    for (const p of state.connectedProviders) add(shell, quotaCard(p, true));
    if (!state.connectedProviders.length) add(shell, el('p', '연결된 AI가 없습니다. 상세 화면에서 연결하세요.'));
    add(shell, button('새로고침', () => action(() => api.refresh())), el('div', state.busy ? '수집 중 · 이전 스냅샷' : '토큰 수와 계정 한도는 별개입니다.', 'status'));
    return;
  }
  const title = add(el('div'), el('div', 'YOUR AI USAGE, IN VIEW', 'brand'), el('h1', 'TokenTrailer'), el('p', '언제, 어떤 작업에서 토큰을 사용했는지 확인하세요.', 'muted'));
  const navigation = add(el('div', null, 'actions'), button('사용량', () => { page = 'dashboard'; editing = false; render(); window.scrollTo(0, 0); }, page === 'dashboard' ? 'active' : ''),
    button('연결 및 설정', () => { page = 'settings'; editing = true; render(); window.scrollTo(0, 0); }, page === 'settings' ? 'active' : ''), button('앱 종료', () => api.quit()));
  add(shell, add(el('header', null, 'top'), title, navigation));
  if (state.error) add(shell, el('div', state.error, 'notice'));
  if (page === 'settings') { renderSettings(shell); return; }
  if (!state.connectedProviders.length) {
    add(shell, add(el('section', null, 'card onboarding'), el('h2', '사용하는 AI를 연결하세요'), el('p', '설정에서 AI를 연결하면 한도와 프로젝트별 사용량이 여기에 표시됩니다.', 'muted'), button('AI 연결하기', () => { page = 'settings'; editing = true; render(); window.scrollTo(0, 0); }, 'active')));
    return;
  }
  add(shell, add(el('div', null, 'grid quota-grid'), ...state.connectedProviders.map(p => quotaCard(p))));
  const filters = el('div', null, 'filters');
  for (const [key, label] of [['today', '오늘'], ['week', '이번 주'], ['month', '이번 달']]) add(filters, button(label, () => { filter.period = key; filter.bucket = null; filter.project = null; reload(); }, filter.period === key ? 'active' : ''));
  add(filters, button(state.busy ? '수집 중…' : '새로고침', () => action(() => api.refresh()), 'push')); add(shell, filters);
  const aiTabs = el('div', null, 'ai-tabs'); aiTabs.setAttribute('role', 'group'); aiTabs.setAttribute('aria-label', 'AI 사용량 필터');
  for (const [id, label] of [['connected', '전체'], ...state.connectedProviders.map(p => [p, names[p]])]) {
    const tab = button(label, () => { filter.provider = id; reload(); }, filter.provider === id ? 'active' : '');
    tab.dataset.provider = id; tab.setAttribute('aria-pressed', String(filter.provider === id)); aiTabs.append(tab);
  }
  add(shell, aiTabs);
  const a = state.analysis, metric = el('section', null, 'card');
  add(metric, el('small', `${a.selected ? '선택 구간' : '선택 기간'} · 로컬에서 발견한 기록 기준`), add(tokenTitle(el('div', fmt(a.total), 'metric'), a.total), el('small', 'tokens')),
    el('div', `${date(a.selected?.start ?? a.range.start)} — ${date(a.selected?.end ?? a.range.end)} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`, 'muted'));
  if (a.unknownTime) add(metric, tokenTitle(el('p', `시각 미확인 ${fmt(a.unknownTimeTokens)} tokens (${a.unknownTime}건)은 기간 합계에서 제외됩니다.`, 'warn'), a.unknownTimeTokens));
  if (state.busy) add(metric, el('p', '기록 수집 중입니다. 아래 값은 직전 완료된 스냅샷입니다.', 'warn'));
  const breakdown = add(el('div', null, 'provider-totals'), el('small', 'AI별 로컬 토큰 · 비율은 현재 표시된 토큰 합계 기준 (요금제 한도와 별개)'));
  for (const p of state.connectedProviders) {
    const total = a.providerTotals[p];
    if (!['all', 'connected', p].includes(filter.provider) || filter.provider === 'connected' && !state.connectedProviders.includes(p)) continue;
    const choice = button(total == null ? `${names[p]} · 기간 기록 없음` : `${names[p]} · ${fmt(total)} tokens · ${a.total ? (total / a.total * 100).toFixed(1) + '%' : '—'}`, () => { filter.provider = p; reload(); }, 'provider-total');
    add(breakdown, total == null ? choice : tokenTitle(choice, total));
  }
  add(metric, breakdown);
  const chart = el('div', null, 'chart'), max = Math.max(1, ...a.buckets.map(b => b.total));
  for (const b of a.buckets) {
    const label = filter.period === 'today' ? new Date(b.start).getHours() + '시' : new Date(b.start).getDate() + '일';
    const bar = button('', () => { filter.bucket = filter.bucket === b.start ? null : b.start; filter.project = null; reload(); }, `bar-col${filter.bucket === b.start ? ' active' : ''}`);
    bar.setAttribute('aria-label', `${date(b.start)}부터 ${date(b.end)}까지 ${exact(b.total)} 토큰 선택`); bar.title = bar.getAttribute('aria-label');
    const fill = el('span', null, 'bar'); fill.style.height = `${Math.max(1, b.total / max * 145)}px`; add(bar, fill, el('span', label)); chart.append(bar);
  }
  add(metric, chart, el('small', '막대를 선택하면 해당 시간의 프로젝트와 세션을 볼 수 있습니다. 빈 구간은 수집 기록이 없는 구간입니다.'));
  if (a.selected) add(metric, button('구간 선택 해제', () => { filter.bucket = null; filter.project = null; reload(); }));
  const list = el('details'); add(list, el('summary', '정확한 구간별 수치 보기'), table(['시작', '종료', '토큰'], a.buckets.map(b => [button(date(b.start), () => { filter.bucket = b.start; filter.project = null; reload(); }, 'link'), date(b.end), exact(b.total)]))); add(metric, list);
  add(shell, metric);
  const projects = add(el('section', null, 'card'), el('h2', '프로젝트별 사용량'));
  const columns = state.connectedProviders.filter(p => ['connected', p].includes(filter.provider));
  add(projects, a.projects.length ? table(['작업 공간', ...columns.map(p => names[p]), '합계 토큰'], a.projects.map(p => [button(p.key, () => { filter.project = filter.project === p.key ? null : p.key; reload(); }, 'link'), ...columns.map(id => tokenTitle(button(fmt(p.providers[id] ?? 0), () => { filter.provider = id; filter.project = p.key; reload(); }, 'link'), p.providers[id] ?? 0)), tokenNumber(p.total)])) : el('div', '이 기간의 수집 기록이 없습니다.', 'empty'));
  const sessions = add(el('section', null, 'card'), el('h2', filter.project ? `선택 프로젝트의 세션` : '세션별 사용량'));
  if (filter.project) add(sessions, el('small', filter.project), button('프로젝트 선택 해제', () => { filter.project = null; reload(); }));
  add(sessions, a.sessions.length ? table(['세션 / 도구', '토큰'], a.sessions.map(s => [add(el('div'), button(s.session, () => showSession(s.key), 'link'), el('div', `${s.client} · ${s.models.join(', ') || '모델 미확인'}`, 'status')), tokenNumber(s.total)])) : el('div', '표시할 세션이 없습니다.', 'empty'));
  add(shell, add(el('div', null, 'split'), projects, sessions));
  const statuses = add(el('details'), el('summary', '수집 범위와 데이터 상태'));
  for (const p of state.connectedProviders) { const s = state.status[p]; add(statuses, el('p', `${names[p]}: ${labels[s?.state] ?? '대기'} · 파일 ${s?.files ?? 0}개 · 마지막 성공 ${date(s?.lastSuccess)} · 손상 ${s?.malformed ?? 0}, 불완전 ${s?.incomplete ?? 0}, 미지원 ${s?.unsupported ?? 0}, 보류 ${s?.deferred ?? 0}`, 'status')); }
  const presenceLabels = { attached: '직접 표시 중', disabled: '사용 안 함', 'waiting-shell': 'Windows 작업표시줄 대기', 'no-space': '표시할 빈 공간 부족', 'taskbar-hidden': '작업표시줄 숨김', 'layout-unavailable': '버튼 배치 확인 불가', 'helper-error': '표시 도우미 오류', 'helper-stopped': '표시 도우미 중단' };
  add(statuses, el('p', `작업표시줄: ${presenceLabels[state.presence?.state] ?? state.presence?.state ?? '준비 중'}`, 'status'));
  add(shell, statuses, el('footer', '이 PC에서 발견한 기록입니다. 계정 전체 사용량이나 실제 기기별 사용량을 의미하지 않습니다. 창을 닫아도 트레이에서 계속 실행됩니다.'));
}
async function showSession(key) {
  await action(async () => {
    const data = await api.session(key), dialog = el('dialog');
    add(dialog, el('h2', data.session), tokenTitle(el('p', `확보된 전체 ${fmt(data.total)} tokens · 원시 대화는 저장하지 않습니다.`, 'muted'), data.total),
      table(['시각', '모델', '입력', '출력', '캐시 읽기', '캐시 쓰기', '추론', '총 토큰'], data.events.map(e => [date(e.timestamp), e.model ?? '미확인', tokenNumber(e.input), tokenNumber(e.output), tokenNumber(e.cacheRead), tokenNumber(e.cacheWrite), tokenNumber(e.reasoning), tokenNumber(e.total)])),
      el('p', 'Codex의 캐시는 입력에, 추론은 출력에 포함됩니다. Gemini 캐시는 입력에 포함되고 추론은 별도입니다. Claude 캐시 읽기·쓰기는 입력에 별도로 더합니다.', 'muted'), button('닫기', () => { dialog.close(); dialog.remove(); }));
    document.body.append(dialog); dialog.showModal(); dialog.addEventListener('close', () => dialog.remove());
  });
}
function renderSettings(shell) {
  const next = structuredClone(state.settings), form = el('form', null, 'settings');
  const saveStatus = el('span', '선택하면 바로 저장됩니다.', 'status'); saveStatus.setAttribute('role', 'status');
  const retry = button('다시 시도', () => saveSettings()); retry.hidden = true;
  let saveQueue = Promise.resolve(), revision = 0;
  function saveSettings() {
    const current = ++revision, snapshot = structuredClone(next);
    saveStatus.textContent = '저장 중…'; retry.hidden = true;
    saveQueue = saveQueue.then(() => api.save(snapshot)).then(() => {
      if (current === revision) saveStatus.textContent = '저장됨 · 바로 적용되었습니다.';
    }).catch(() => {
      if (current === revision) { saveStatus.textContent = '저장 실패 · 변경사항이 적용되지 않았습니다. 경로와 파일 상태를 확인하세요.'; retry.hidden = false; }
    });
  }
  add(form, add(el('div', null, 'settings-save'), saveStatus, retry));
  form.onchange = () => saveSettings();
  form.onsubmit = event => { event.preventDefault(); if (document.activeElement?.matches('input[type=text]')) document.activeElement.blur(); };
  const connections = add(el('section', null, 'card settings-section'), el('h2', 'AI 연결'), el('p', '사용하는 AI만 연결하세요. 연결을 해제해도 저장된 사용량 기록은 유지됩니다.', 'muted'));
  const sourceGrid = el('div', null, 'source-grid'); connections.append(sourceGrid); form.append(connections);
  function check(label, value, fn) { const input = el('input'); input.type = 'checkbox'; input.checked = value; input.onchange = () => fn(input.checked); return add(el('label', null, 'check'), input, el('span', label)); }
  for (const p of Object.keys(names)) {
    const source = next.sources[p], block = add(el('div', null, 'source'), el('h3', names[p])); block.dataset.provider = p;
    const input = el('input'); input.type = 'text'; input.value = source.home; input.setAttribute('aria-label', `${names[p]} 홈 경로`); input.onchange = () => source.home = input.value.trim();
    add(block, check('토큰 사용량 연결', source.enabled, v => source.enabled = v), check('계정 한도 연결', source.quota, v => source.quota = v), el('p', '이 PC의 기록과 기존 CLI 로그인 정보를 사용합니다.', 'status'));
    const interval = el('select'); interval.setAttribute('aria-label', `${names[p]} 한도 새로고침 주기`);
    for (const s of [5, 15, 30, 60, 300]) { const o = el('option', s < 60 ? `${s}초` : `${s / 60}분`); o.value = s; interval.append(o); } interval.value = source.interval; interval.onchange = () => source.interval = Number(interval.value);
    add(block, add(el('label', null, 'setting-field'), el('span', '한도 새로고침 주기'), interval));
    const advanced = add(el('details', null, 'source-advanced'), el('summary', '고급 · 기록 위치'), el('small', '기본 위치를 변경한 경우에만 수정하세요.'), input);
    add(block, advanced); if (p === 'gemini') add(block, el('p', 'Gemini CLI만 지원 대상 · 실계정 검증 전', 'status warn')); sourceGrid.append(block);
  }
  add(connections, el('p', '대화 원문은 저장하지 않습니다. 계정 한도는 제공자에게 직접 조회하며 원본 기록·인증 파일은 수정하지 않습니다.', 'status'));
  const desktop = add(el('section', null, 'card settings-section'), el('h2', '위젯과 작업표시줄'));
  const displayOptions = el('div', null, 'setting-options');
  for (const [key, label] of [['taskbar', '작업표시줄에 사용률 표시'], ['widget', '미니 위젯 표시'], ['alwaysOnTop', '위젯을 항상 맨 위에 표시']]) add(displayOptions, check(label, next[key], v => next[key] = v));
  const opacity = el('input'); opacity.type = 'range'; opacity.min = '30'; opacity.max = '100'; opacity.step = '1'; opacity.value = Math.round(next.widgetOpacity * 100); opacity.id = 'widget-opacity';
  const opacityValue = el('output', opacity.value + '%'); opacityValue.htmlFor = opacity.id;
  opacity.oninput = () => { opacityValue.textContent = opacity.value + '%'; };
  opacity.onchange = () => { next.widgetOpacity = Number(opacity.value) / 100; opacityValue.textContent = opacity.value + '%'; };
  const opacityField = add(el('label', null, 'opacity-field'), el('span', '위젯 배경 불투명도'), opacity, opacityValue);
  add(desktop, displayOptions, opacityField, el('p', '30%는 더 투명하게, 100%는 불투명하게 표시합니다. 글자와 막대는 선명하게 유지됩니다. 아이콘을 끌어 이동하고, 우클릭하면 초기화까지 남은 시간으로 전환합니다.', 'status'), el('h3', 'AI 표시 순서'), el('small', '연결된 AI 중 위의 2개가 작업표시줄에 표시됩니다. 끌어서 이동하거나 화살표로 순서를 바꾸세요.'));
  const order = el('div', null, 'connection-order'); let dragged;
  function move(id, target) {
    const from = next.connectionOrder.indexOf(id), to = next.connectionOrder.indexOf(target);
    next.connectionOrder.splice(from, 1); next.connectionOrder.splice(to, 0, id); drawOrder();
    saveSettings();
    order.querySelector(`[data-provider="${id}"] button:not(:disabled)`)?.focus();
  }
  function drawOrder() {
    order.replaceChildren();
    next.connectionOrder.forEach((p, i) => {
      const row = el('div', null, 'order-row'); row.dataset.provider = p; row.draggable = true;
      row.ondragstart = e => { dragged = p; e.dataTransfer.setData('text/plain', p); };
      row.ondragend = () => dragged = null;
      row.ondragover = e => e.preventDefault();
      row.ondrop = e => { e.preventDefault(); if (dragged && dragged !== p) move(dragged, p); dragged = null; };
      const up = button('↑', () => move(p, next.connectionOrder[i - 1]), 'order-arrow'), down = button('↓', () => move(p, next.connectionOrder[i + 1]), 'order-arrow');
      up.disabled = i === 0; down.disabled = i === next.connectionOrder.length - 1;
      up.setAttribute('aria-label', `${names[p]} 위로`); down.setAttribute('aria-label', `${names[p]} 아래로`); up.title = up.getAttribute('aria-label'); down.title = down.getAttribute('aria-label');
      add(row, el('span', `${i + 1}. ${names[p]}`), up, down); order.append(row);
    });
  }
  drawOrder(); add(desktop, order); form.append(desktop);
  const startup = add(el('section', null, 'card settings-section'), el('h2', '앱 시작'));
  for (const [key, label] of [['autoStart', 'Windows 로그인 시 자동 시작'], ['hiddenStart', '시작할 때 상세 창 숨기기']]) add(startup, check(label, next[key], v => next[key] = v));
  add(startup, el('p', '상세 창을 닫아도 트레이에서 계속 실행됩니다.', 'status')); form.append(startup);
  add(shell, form);
  const history = add(el('section', null, 'card'), el('h2', '이력 관리'), el('p', '삭제 시 원본 기록은 유지됩니다. 삭제한 이벤트의 제외 식별자는 남겨 자동 재수입을 막습니다. 이후 새로운 이벤트는 수집합니다.', 'muted'));
  const target = el('select'); target.setAttribute('aria-label', '이력 대상'); for (const [value, label] of [['all', '전체 도구'], ...Object.entries(names)]) { const o = el('option', label); o.value = value; target.append(o); }
  add(history, add(el('div', null, 'actions'), target, button('앱 이력 삭제', () => action(async () => { const r = await api.history('delete', target.value); if (r) toast('앱 이력을 삭제했습니다.'); })), button('과거 기록 재수입', () => action(async () => { await api.history('reimport', target.value); toast('재수입 요청을 처리했습니다.'); })))); add(shell, history);
}
async function reload() {
  if (loading) { queued = true; return; }
  loading = true;
  try {
    state = await api.snapshot(filter);
    if (filter.provider !== 'connected' && !state.connectedProviders.includes(filter.provider)) {
      filter.provider = 'connected'; filter.project = null;
      state = await api.snapshot(filter);
    }
    if (!editing || !root.children.length) render();
  }
  catch { toast('데이터를 불러오지 못했습니다.'); }
  finally { loading = false; if (queued) { queued = false; reload(); } }
}
api.changed(() => reload());
await reload();
