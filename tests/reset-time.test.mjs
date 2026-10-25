import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetTimeText, remainingTimeText } from '../src/reset-time.mjs';
test('reset time shows absolute date and rounded-up remaining time without claiming a reset', () => {
  const now = Date.parse('2026-10-20T12:00:00+09:00');
  for (const value of [null, undefined, 'invalid']) assert.equal(resetTimeText(value, now), '초기화 시각 미확인');
  assert.match(resetTimeText(now + 1, now), /1분 남음/);
  assert.match(resetTimeText(new Date(now + 90000000).toISOString(), now), /1일 1시간 남음/);
  assert.match(resetTimeText(now + 3660000, now), /1시간 1분 남음/);
  assert.match(resetTimeText(now, now), /예정 시각 지남, 갱신 대기/);
  assert.match(resetTimeText(now - 1, now), /갱신 대기/);
  assert.equal(remainingTimeText(null, now), '미확인');
  assert.equal(remainingTimeText(now, now), '갱신 대기');
  assert.equal(remainingTimeText(now + 3660000, now), '1시간 1분');
  assert.equal(remainingTimeText(now + 90060000, now), '1일 1시간');
});
