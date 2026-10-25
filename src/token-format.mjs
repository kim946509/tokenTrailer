const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export function formatTokens(value) {
  return Number.isFinite(value) ? compact.format(value) : '—';
}
