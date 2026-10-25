import { remainingTimeText } from './reset-time.mjs';
export function connectedProviders(settings) {
  return settings.connectionOrder.filter(p => settings.sources[p].enabled || settings.sources[p].quota);
}
function orderedWindows(settings, quotas, p) {
  const priority = ['five_hour', 'seven_day', 'primary_window', 'secondary_window'];
  return settings.sources[p].quota ? [...(quotas[p]?.windows ?? [])].sort((a, b) => (priority.includes(a.modelId) ? priority.indexOf(a.modelId) : 4) - (priority.includes(b.modelId) ? priority.indexOf(b.modelId) : 4)) : [];
}
export function taskbarPercentages(settings, quotas) {
  return connectedProviders(settings).slice(0, 2).flatMap(p => orderedWindows(settings, quotas, p).slice(0, 2).map(w => w.usedPercent));
}
export function taskbarText(settings, quotas, compact = false, resetTimes = false) {
  const names = compact ? { claude: 'CL', codex: 'CX', gemini: 'GM' } : { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
  const lines = connectedProviders(settings).slice(0, 2).map(p => {
    const q = quotas[p];
    const windows = orderedWindows(settings, quotas, p);
    const labels = windows.slice(0, 2).map(w => {
      const label = { five_hour: '5h', seven_day: '7d' }[w.modelId] ??
        (w.durationSeconds ? (w.durationSeconds % 86400 === 0 ? `${w.durationSeconds / 86400}d` : `${w.durationSeconds / 3600}h`) : w.modelId);
      return `${label} ${resetTimes ? remainingTimeText(w.resetsAt) : w.usedPercent.toFixed(0) + '%'}`;
    });
    return `${names[p]} ${labels.join(' · ') || '--'}${windows.length > 2 ? ` +${windows.length - 2}` : ''}${q?.stale ? ' *' : ''}`;
  });
  return lines.join('\n') || 'TokenTrailer\n연결 필요';
}

export function taskbarResetItems(settings, quotas, now = Date.now()) {
  const names = {claude:'Claude', codex:'Codex', gemini:'Gemini'};
  const items = [];
  for (const p of connectedProviders(settings)) {
    if (items.length) items.push({type:'separator'});
    items.push({label:names[p] + (quotas[p]?.stale ? ' · 이전 값' : ''), enabled:false});
    const windows = orderedWindows(settings, quotas, p);
    for (const w of windows) {
      const label = {five_hour:'5시간',seven_day:'주간',seven_day_opus:'Opus 주간',seven_day_sonnet:'Sonnet 주간'}[w.modelId] ?? (w.durationSeconds ? (w.durationSeconds % 86400 === 0 ? w.durationSeconds / 86400 + '일' : w.durationSeconds / 3600 + '시간') : w.modelId);
      const remaining = remainingTimeText(w.resetsAt, now);
      items.push({label:label + '   ' + (/미확인|갱신 대기/.test(remaining) ? remaining : remaining + ' 후 초기화')});
    }
    if (!windows.length) items.push({label:settings.sources[p].quota ? '초기화 정보 미확인' : '한도 미연결', enabled:false});
  }
  return items.length ? items : [{label:'연결된 AI가 없습니다', enabled:false}];
}
