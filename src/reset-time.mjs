export function remainingTimeText(value, now = Date.now()) {
  const time = value == null ? NaN : new Date(value).getTime();
  if (!Number.isFinite(time)) return '미확인';
  if (time <= now) return '갱신 대기';
  const minutes = Math.ceil((time - now) / 60000);
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
  return [days ? `${days}일` : '', hours ? `${hours}시간` : '', !days && rest ? `${rest}분` : ''].filter(Boolean).join(' ');
}
export function resetTimeText(value, now = Date.now()) {
  const time = value == null ? NaN : new Date(value).getTime();
  if (!Number.isFinite(time)) return '초기화 시각 미확인';
  const date = new Date(time).toLocaleString('ko-KR');
  if (time <= now) return `초기화 예정 ${date} · 예정 시각 지남, 갱신 대기`;
  const minutes = Math.ceil((time - now) / 60000);
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
  const remaining = [days ? `${days}일` : '', hours ? `${hours}시간` : '', rest ? `${rest}분` : ''].filter(Boolean).join(' ');
  return `초기화 ${date} · ${remaining} 남음`;
}
