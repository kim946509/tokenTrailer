import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotaColor } from '../src/quota-color.mjs';
import { taskbarPercentages } from '../src/presence.mjs';
import { defaultSettings } from '../src/engine.mjs';
test('quota text colors use raw thresholds; unknown is neutral', () => {
  for (const value of [0, 59.9]) assert.equal(quotaColor(value), '#76db9b');
  for (const value of [60, 89.9]) assert.equal(quotaColor(value), '#ffb454');
  for (const value of [90, 100]) assert.equal(quotaColor(value), '#ff7078');
  assert.equal(quotaColor(null), '#e6ecf6');
  const settings = defaultSettings(); settings.sources.claude.quota = true;
  assert.deepEqual(taskbarPercentages(settings, { claude: { windows: [{ modelId: 'seven_day', usedPercent: 90 }, { modelId: 'five_hour', usedPercent: 59.9 }] } }), [59.9, 90]);
});
