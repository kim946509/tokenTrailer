import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTokens } from '../src/token-format.mjs';
test('compact tokens keep zero, unknown and unit rollover distinct', () => {
  for (const [value, expected] of [[0, '0'], [999, '999'], [1000, '1K'], [12345, '12.3K'], [999999, '1M'], [1234567, '1.2M'], [1e9, '1B'], [1e12, '1T'], [null, '—']]) assert.equal(formatTokens(value), expected);
});
