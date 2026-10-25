export function quotaColor(percent) {
  return !Number.isFinite(percent) ? '#e6ecf6' : percent >= 90 ? '#ff7078' : percent >= 60 ? '#ffb454' : '#76db9b';
}
