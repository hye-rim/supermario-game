'use strict';

// 모든 코스를 봇이 실제로 완주할 수 있는지 시험한다 (봇은 test/bot.js: 앞을 미리 돌려 보며 달리고 뛰는 방식)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');
const bot = require('./bot.js');

test('the bot clears every stage with at most one death on several seeds', () => {
  const fails = [];
  for (const seed of [1, 2, 3]) {
    for (let s = 1; s <= L.STAGES.length; s++) {
      const r = bot.play(s, seed, { maxSec: 200 });
      if (!r.cleared || r.deaths > 1) fails.push(`stage ${s} (${L.STAGES[s - 1].name}) seed ${seed}: cleared=${r.cleared} deaths=${r.deaths} x=${r.x} ${JSON.stringify(r.deathLog.slice(0, 2))}`);
    }
  }
  assert.deepStrictEqual(fails, []);
});

test('the bot is not a pushover: it cannot cross a pit that is far too wide', () => {
  const r = bot.play(1, 1, {
    maxSec: 40, lives: 4,
    mutate: (st) => { for (let x = 20; x < 50; x++) for (let y = 0; y < st.tiles.length; y++) st.tiles[y][x] = '.'; },     // 30칸 구멍(위의 블록도 모두 치움)
  });
  assert.ok(r.deaths >= 1 && r.deathLog[0].why === 'pit', 'the first attempt has to fall into the pit (the course is rebuilt after a death)');
});

test('the bot is not a pushover: it cannot pass a wall that is far too high', () => {
  const r = bot.play(1, 1, {
    maxSec: 40, lives: 4,
    mutate: (st) => { for (let y = 0; y < L.GROUND; y++) st.tiles[y][24] = '#'; },                                          // 하늘 끝까지 막는 벽
  });
  assert.strictEqual(r.cleared, false);
});
