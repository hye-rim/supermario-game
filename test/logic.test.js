'use strict';

// 슈퍼마리오 풍 게임 규칙 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const { T, GROUND } = L;
const run = (st, secs, input = {}) => { for (let i = 0; i < Math.round(secs / 0.01); i++) L.step(st, 0.01, input); };
const evs = (st, t) => st.events.filter((e) => e.t === t);
// 평평한 땅 한 줄뿐인 시험용 세상 (pits: [[시작 칸, 끝 칸]] 구멍)
function world(opts = {}) {
  const st = L.newGame(L.rng(1));
  const w = opts.w || 60;
  st.w = w; st.tiles = Array.from({ length: L.ROWS }, () => new Array(w).fill('.'));
  for (let x = 0; x < w; x++) { if ((opts.pits || []).some(([a, b]) => x >= a && x <= b)) continue; st.tiles[GROUND][x] = '#'; st.tiles[GROUND + 1][x] = '#'; }
  st.enemies = []; st.items = []; st.fireballs = []; st.camX = 0; st.timeLeft = 999;
  st.m = { ...st.m, x: (opts.x || 5) * T, y: GROUND * T - L.SIZE.small.h, vx: 0, vy: 0, invuln: 0, onGround: true };
  return st;
}
const put = (st, tx, ty, ch) => { st.tiles[ty][tx] = ch; };
const setBig = (st) => { L.setSize(st, 'big'); };
const goomba = (st, x, y = GROUND * T - 12, vx = 0) => { const e = L.makeEnemy('goomba', x, y, 99); e.active = true; e.vx = vx; st.enemies.push(e); return e; };
const koopa = (st, x, vx = 0) => { const e = L.makeEnemy('koopa', x, GROUND * T - 16, 98); e.active = true; e.vx = vx; st.enemies.push(e); return e; };

test('every stage is a valid course: right size, ground, start, flag, and no impossible pits', () => {
  assert.strictEqual(L.STAGES.length, 4);
  for (const s of L.STAGES) {
    assert.strictEqual(s.tiles.length, L.ROWS);
    assert.ok(s.tiles.every((r) => r.length === s.w), `${s.name}: all rows same width`);
    assert.ok(s.time >= 200, `${s.name} has time`);
    // 땅 구간: 처음 몇 칸은 땅, 구멍 폭은 4칸 이하, 구간은 3칸 이상
    assert.ok(s.ground[0][0] === 0 && s.ground[0][1] >= 8, 'a safe start');
    for (let i = 0; i < s.ground.length; i++) {
      const [a, b] = s.ground[i];
      assert.ok(b - a + 1 >= 3, `${s.name}: ground piece ${a}-${b} is wide enough to land on`);
      if (i > 0) assert.ok(a - s.ground[i - 1][1] - 1 <= 4, `${s.name}: pit before ${a} is at most 4 wide`);
    }
    assert.ok(s.ground[s.ground.length - 1][1] === s.w - 1, 'ground runs to the end');
    // 깃대
    assert.ok(s.flag > 20 && s.flag < s.w - 2);
    assert.strictEqual(s.tiles[1][s.flag], 'f');
    for (let y = 2; y <= 9; y++) assert.strictEqual(s.tiles[y][s.flag], 'F');
    assert.ok(s.ground.some(([a, b]) => s.flag >= a && s.flag <= b), 'the flag stands on ground');
    // 적은 땅 위에서 시작
    assert.ok(s.spawns.length >= 8);
    for (const sp of s.spawns) assert.ok(s.ground.some(([a, b]) => sp.x >= a && sp.x <= b), `${s.name}: enemy at ${sp.x} stands on ground`);
    // 파이프를 넘어 내려앉는 자리(파이프 오른쪽 2~5칸)에는 적을 두지 않는다 (착지하자마자 부딪히는 불공정한 자리)
    for (let x = 0; x < s.w - 1; x++) for (let y = 0; y < L.ROWS; y++) {
      if (s.tiles[y][x] === 'P' && s.tiles[y][x + 1] === 'P' && (x === 0 || s.tiles[y][x - 1] !== 'P')) {
        for (const sp of s.spawns) assert.ok(!(sp.x >= x + 2 && sp.x <= x + 5), `${s.name}: no enemy right behind the pipe at ${x} (enemy at ${sp.x})`);
      }
    }
    // 버섯 블록이 처음에 있다
    const early = [];
    for (let y = 0; y < L.ROWS; y++) for (let x = 0; x < 20; x++) if (s.tiles[y][x] === 'M') early.push([x, y]);
    assert.ok(early.length >= 1, `${s.name}: a mushroom block near the start`);
    // 파이프는 3칸 이하, 블록은 닿을 수 있는 높이
    let maxPipe = 0;
    for (let x = 0; x < s.w; x++) { let h = 0; for (let y = GROUND - 1; y >= 0 && /[Pp]/.test(s.tiles[y][x]); y--) h++; maxPipe = Math.max(maxPipe, h); }
    assert.ok(maxPipe <= 3, `${s.name}: pipes are at most 3 high`);
    for (let y = 0; y < L.ROWS; y++) for (let x = 0; x < s.w; x++) if (/[?MB]/.test(s.tiles[y][x]) && !s.ceiling) assert.ok(y >= 3 && y <= 9, `${s.name}: block at ${x},${y} in reach`);
  }
});

test('mario stands on the ground and a pit is deadly', () => {
  const st = world();
  run(st, 0.3);
  assert.ok(st.m.onGround);
  assert.strictEqual(st.m.y, GROUND * T - st.m.h);
  const p = world({ pits: [[10, 14]], x: 11 });
  const why = [];
  for (let i = 0; i < 200; i++) { L.step(p, 0.01, {}); for (const e of evs(p, 'dead')) why.push(e.why); }
  assert.strictEqual(p.phase, 'dying');
  assert.deepStrictEqual(why, ['pit']);
  assert.strictEqual(p.lives, L.START_LIVES - 1);
});

test('walking and running reach their top speeds and friction stops him', () => {
  const st = world();
  run(st, 2, { right: true });
  assert.ok(Math.abs(st.m.vx - L.WALK) < 1, `walk speed ${st.m.vx}`);
  run(st, 2, { right: true, run: true });
  assert.ok(Math.abs(st.m.vx - L.RUN) < 1, `run speed ${st.m.vx}`);
  run(st, 1.5);
  assert.strictEqual(st.m.vx, 0, 'stopped by friction');
  assert.strictEqual(st.m.face, 1);
  run(st, 0.2, { left: true });
  assert.strictEqual(st.m.face, -1);
});

test('walls block him and the left edge of the screen stops him', () => {
  const st = world(); put(st, 9, GROUND - 1, 'p'); put(st, 9, GROUND - 2, 'P');
  st.m.x = 6 * T;
  run(st, 3, { right: true });
  assert.ok(st.m.x + st.m.w <= 9 * T + 0.001, 'cannot go through the pipe');
  assert.strictEqual(st.m.vx, 0);
  st.m.x = 20 * T; st.camX = 20 * T - 50;
  run(st, 5, { left: true });
  assert.ok(st.m.x >= st.camX - 0.001, 'cannot walk off the left of the screen');
});

test('a held jump goes about four tiles high, a tap much lower, and no jumping in the air', () => {
  const hold = world();
  L.step(hold, 0.01, { jump: true, jumpHeld: true });
  let top = hold.m.y;
  for (let i = 0; i < 100; i++) { L.step(hold, 0.01, { jumpHeld: true }); top = Math.min(top, hold.m.y); }
  const full = GROUND * T - hold.m.h - top;
  assert.ok(full > 3.4 * T && full < 5 * T, `held jump ${full}px`);
  const tap = world();
  L.step(tap, 0.01, { jump: true, jumpHeld: true });
  let topT = tap.m.y;
  for (let i = 0; i < 100; i++) { L.step(tap, 0.01, {}); topT = Math.min(topT, tap.m.y); }
  const low = GROUND * T - tap.m.h - topT;
  assert.ok(low < full * 0.6, `a tap (${low}px) is much lower than a held jump (${full}px)`);
  assert.ok(low > 0.8 * T, 'but still a hop');
  const air = world();
  L.step(air, 0.01, { jump: true, jumpHeld: true }); run(air, 0.1, { jumpHeld: true });
  const vy = air.m.vy;
  L.step(air, 0.01, { jump: true, jumpHeld: true });
  assert.ok(air.m.vy >= vy - 1, 'a second press in the air does nothing');
});

test('a jump announces itself once per jump and landing is announced', () => {
  const st = world();
  const e = [];
  L.step(st, 0.01, { jump: true, jumpHeld: true }); e.push(...st.events.map((x) => x.t));
  for (let i = 0; i < 120; i++) { L.step(st, 0.01, {}); e.push(...st.events.map((x) => x.t)); }
  assert.strictEqual(e.filter((x) => x === 'jump').length, 1);
  assert.strictEqual(e.filter((x) => x === 'land').length, 1);
});

test('a walking jump clears a four tile pit and a running jump clears a six tile pit', () => {
  for (const [w, speedInput] of [[4, {}], [6, { run: true }]]) {
    const st = world({ pits: [[20, 20 + w - 1]], x: 10 });
    run(st, 3, { right: true, ...speedInput });          // 구멍 앞까지 달려 간다 (구멍에 닿기 전에 뛴다)
    // 구멍 바로 앞에서 뛴다
    const st2 = world({ pits: [[20, 20 + w - 1]], x: 17 });
    st2.m.x = 20 * T - st2.m.w - 1; st2.m.vx = speedInput.run ? L.RUN : L.WALK;
    L.step(st2, 0.01, { right: true, jump: true, jumpHeld: true, ...speedInput });
    for (let i = 0; i < 200; i++) L.step(st2, 0.01, { right: true, jumpHeld: i < 50, ...speedInput });
    assert.strictEqual(st2.phase, 'play', `crossed a ${w} tile pit`);
    assert.ok(st2.m.x > (20 + w) * T, 'ended up on the far side');
    assert.ok(st.m.x > 0);
  }
});

test('a question block gives a coin once and turns into a used block', () => {
  const st = world(); put(st, 8, 7, '?');
  st.m.x = 8 * T + 2; st.m.y = 8 * T + 6; st.m.vy = -120;
  run(st, 0.1, { jumpHeld: true });
  assert.strictEqual(st.tiles[7][8], 'U');
  assert.strictEqual(st.coins, 1);
  assert.strictEqual(st.score, L.POINTS.coin);
  assert.ok(st.stats.coinsTotal === 1);
  st.m.y = 8 * T + 6; st.m.vy = -120; run(st, 0.1, { jumpHeld: true });
  assert.strictEqual(st.coins, 1, 'a used block gives nothing');
});

test('a mushroom block gives a mushroom to small mario and a flower to big mario', () => {
  const small = world(); put(small, 8, 7, 'M');
  small.m.x = 8 * T + 2; small.m.y = 8 * T + 6; small.m.vy = -120; run(small, 0.1, { jumpHeld: true });
  assert.strictEqual(small.items.length, 1);
  assert.strictEqual(small.items[0].type, 'mushroom');
  const big = world(); setBig(big); put(big, 8, 7, 'M');
  big.m.x = 8 * T + 2; big.m.y = 8 * T + 6; big.m.vy = -120; run(big, 0.1, { jumpHeld: true });
  assert.strictEqual(big.items[0].type, 'flower');
});

test('the mushroom comes out, walks right, and eating it makes mario big; a flower makes him fire', () => {
  const st = world(); put(st, 8, 7, 'M');
  st.m.x = 8 * T + 2; st.m.y = 8 * T + 6; st.m.vy = -120; run(st, 0.1, { jumpHeld: true });
  const it = st.items[0];
  run(st, 1);
  assert.ok(it.vx > 0 || st.items.length === 0, 'it walks');
  const x0 = it.x; run(st, 0.5);
  assert.ok(it.x > x0 || it.gone, 'moving right');
  // 가까이 가서 먹는다
  st.m.x = it.x - 4; st.m.y = it.y - st.m.h + 12; st.m.vy = 0;
  const s0 = st.score;
  L.step(st, 0.01, {});
  assert.strictEqual(st.m.size, 'big');
  assert.strictEqual(st.m.h, L.SIZE.big.h);
  assert.strictEqual(st.score - s0 >= L.POINTS.mushroom, true);
  assert.strictEqual(st.items.length, 0);
  assert.strictEqual(evs(st, 'power').length, 1);
  // 꽃
  const f = world(); setBig(f);
  f.items.push({ id: 5, type: 'flower', x: f.m.x, y: f.m.y + 10, w: 12, h: 12, vx: 0, vy: 0, emerge: 1, ty: 7 });
  L.step(f, 0.01, {});
  assert.strictEqual(f.m.size, 'fire');
});

test('growing keeps his feet on the ground and shrinking does too', () => {
  const st = world();
  const feet = st.m.y + st.m.h;
  L.setSize(st, 'big');
  assert.strictEqual(st.m.y + st.m.h, feet);
  L.setSize(st, 'small');
  assert.strictEqual(st.m.y + st.m.h, feet);
});

test('a brick only bounces under small mario but breaks under big mario for points', () => {
  const small = world(); put(small, 8, 7, 'B');
  small.m.x = 8 * T + 2; small.m.y = 8 * T + 6; small.m.vy = -120; run(small, 0.1, { jumpHeld: true });
  assert.strictEqual(small.tiles[7][8], 'B');
  const big = world(); setBig(big); put(big, 8, 7, 'B');
  big.m.x = 8 * T + 2; big.m.y = 8 * T + 2; big.m.vy = -120;
  run(big, 0.1, { jumpHeld: true });
  assert.strictEqual(big.tiles[7][8], '.');
  assert.strictEqual(big.score, L.POINTS.brick);
  assert.strictEqual(big.stats.bricks, 1);
});

test('stomping a goomba kills it, bounces mario, and chained stomps score more', () => {
  const st = world(); const g1 = goomba(st, 100);
  st.m.x = 98; st.m.y = g1.y - st.m.h + 2; st.m.vy = 120; st.m.onGround = false;
  L.step(st, 0.02, {});
  assert.strictEqual(g1.state, 'flat');
  assert.ok(st.m.vy < 0, 'bounced');
  assert.strictEqual(st.score, L.POINTS.stomp[0]);
  assert.strictEqual(st.stats.stomps, 1);
  run(st, 0.5);
  assert.ok(!st.enemies.includes(g1), 'the flat goomba disappears');
});

test('the stomp chain grows with each stomp in the air and resets on landing', () => {
  const st = world();
  const g0 = goomba(st, 100);
  st.m.x = 98; st.m.y = g0.y - st.m.h + 2; st.m.vy = 120; st.m.onGround = false;
  L.step(st, 0.02, {});
  assert.strictEqual(st.stompChain, 1);
  const g = goomba(st, st.m.x, st.m.y + st.m.h - 2);                  // 뜬 채로 바로 아래 또 한 마리
  st.m.vy = 120; L.step(st, 0.02, {});
  assert.strictEqual(st.stompChain, 2);
  assert.strictEqual(st.score, L.POINTS.stomp[0] + L.POINTS.stomp[1]);
  run(st, 1.5);
  assert.strictEqual(st.stompChain, 0, 'landing resets it');
  assert.ok(g);
});

test('touching a goomba from the side kills small mario, shrinks big mario, and invulnerability protects', () => {
  const a = world(); goomba(a, a.m.x + 6, GROUND * T - 12, 0);
  L.step(a, 0.01, {});
  assert.strictEqual(a.phase, 'dying');
  assert.strictEqual(a.lives, L.START_LIVES - 1);
  const b = world(); setBig(b); goomba(b, b.m.x + 6, GROUND * T - 12, 0);
  L.step(b, 0.01, {});
  assert.strictEqual(b.phase, 'play');
  assert.strictEqual(b.m.size, 'small');
  assert.ok(b.m.invuln > 0);
  assert.strictEqual(evs(b, 'shrink').length, 1);
  const c = world(); c.m.invuln = 1; goomba(c, c.m.x + 6, GROUND * T - 12, 0);
  L.step(c, 0.01, {});
  assert.strictEqual(c.phase, 'play');
});

test('goombas walk, turn around at walls and fall into pits', () => {
  const st = world({ pits: [[30, 34]] }); put(st, 20, GROUND - 1, 'S');
  const g = goomba(st, 25 * T, GROUND * T - 12, -L.ENEMY.goomba.speed);
  st.m.x = 2 * T;
  run(st, 3);
  assert.ok(g.x > 21 * T - 0.1 || g.vx > 0, 'turned back at the block');
  const f = goomba(st, 31 * T, GROUND * T - 12, 0);
  run(st, 3);
  assert.ok(!st.enemies.includes(f) || f.y > L.VH, 'fell in the pit');
});

test('enemies only wake up when the screen gets near them', () => {
  const st = world({ w: 80 });
  const e = L.makeEnemy('goomba', 60 * T, GROUND * T - 12, 1);
  st.enemies.push(e);
  run(st, 0.3);
  assert.strictEqual(e.active, false);
  st.camX = 60 * T - L.VW + 30; run(st, 0.05);
  assert.strictEqual(e.active, true);
});

test('a koopa turns into a shell when stomped, a touch kicks it, and a moving shell knocks out other enemies', () => {
  const st = world(); const k = koopa(st, 100);
  st.m.x = 98; st.m.y = k.y - st.m.h + 2; st.m.vy = 120; st.m.onGround = false;
  L.step(st, 0.02, {});
  assert.strictEqual(k.state, 'shell');
  st.m.x = 2 * T; st.m.y = GROUND * T - st.m.h; st.m.vy = 0; st.m.onGround = true;   // 다시 올라타지 않게 멀리 간다
  run(st, 0.3);
  assert.strictEqual(k.state, 'shell');
  assert.strictEqual(k.vx, 0);
  // 옆에서 닿으면 찬다
  st.m.x = k.x - st.m.w + 2; st.m.y = GROUND * T - st.m.h; st.m.vy = 0; st.m.onGround = true;
  L.step(st, 0.02, {});
  assert.strictEqual(k.state, 'shellMove');
  assert.ok(k.vx > 0, 'kicked away from mario');
  assert.strictEqual(st.phase, 'play', 'a fresh kick is safe');
  const g = goomba(st, k.x + 40, GROUND * T - 12, 0);
  st.m.x = 2 * T;
  run(st, 1);
  assert.strictEqual(g.state === 'dead' || !st.enemies.includes(g), true, 'knocked out');
  assert.ok(st.score >= L.POINTS.shell);
});

test('stomping a moving shell stops it, and a moving shell hurts mario from the side after the kick grace', () => {
  const st = world(); const k = koopa(st, 100); k.state = 'shellMove'; k.h = 12; k.y += 4; k.vx = L.SHELL_SPEED; k.grace = 0;
  st.m.x = 98; st.m.y = k.y - st.m.h + 2; st.m.vy = 120; st.m.onGround = false;
  L.step(st, 0.02, {});
  assert.strictEqual(k.state, 'shell');
  const b = world(); const k2 = koopa(b, b.m.x + 6); k2.state = 'shellMove'; k2.h = 12; k2.y += 4; k2.vx = -L.SHELL_SPEED; k2.grace = 0;
  L.step(b, 0.01, {});
  assert.strictEqual(b.phase, 'dying');
});

test('fire mario throws at most two fireballs that bounce, kill enemies and vanish on walls', () => {
  const st = world(); L.setSize(st, 'fire'); st.m.face = 1;
  L.step(st, 0.01, { fire: true });
  assert.strictEqual(st.fireballs.length, 1);
  run(st, 0.25);
  L.step(st, 0.01, { fire: true });
  L.step(st, 0.01, { fire: true });
  assert.ok(st.fireballs.length <= 2);
  run(st, 0.25);
  L.step(st, 0.01, { fire: true });
  assert.ok(st.fireballs.length <= 2, 'never more than two at a time');
  const k = world(); L.setSize(k, 'fire'); const g = goomba(k, k.m.x + 60);
  L.step(k, 0.01, { fire: true }); run(k, 0.6);
  assert.ok(g.state === 'dead' || !k.enemies.includes(g), 'the goomba is knocked out');
  assert.ok(k.score >= L.POINTS.kill);
  const w = world(); L.setSize(w, 'fire'); put(w, w.m.x / T + 4, GROUND - 1, 'S');
  L.step(w, 0.01, { fire: true }); run(w, 1);
  assert.strictEqual(w.fireballs.length, 0, 'gone against the wall');
  const sm = world(); L.step(sm, 0.01, { fire: true });
  assert.strictEqual(sm.fireballs.length, 0, 'small mario cannot throw fire');
});

test('coins are collected by touching them and one hundred give a life', () => {
  const st = world(); put(st, 6, GROUND - 1, 'C');
  st.m.x = 5 * T + 6; run(st, 0.4, { right: true });
  assert.strictEqual(st.tiles[GROUND - 1][6], '.');
  assert.strictEqual(st.coins, 1);
  assert.strictEqual(st.score, L.POINTS.coin);
  const f = world(); f.coins = 99; put(f, 6, GROUND - 1, 'C');
  f.m.x = 5 * T + 6; run(f, 0.4, { right: true });
  assert.strictEqual(f.coins, 0);
  assert.strictEqual(f.lives, L.START_LIVES + 1);
});

test('bumping a block from below flips an enemy standing on it', () => {
  const st = world(); put(st, 8, 7, 'B'); setBig(st);
  const e = goomba(st, 8 * T + 2, 7 * T - 12, 0);
  st.m.x = 8 * T + 2; st.m.y = 8 * T + 2; st.m.vy = -120; run(st, 0.1, { jumpHeld: true });
  assert.strictEqual(e.state, 'dead');
  assert.ok(st.score >= L.POINTS.kill);
});

test('touching the flag clears the stage with points for height and time, then the next stage starts', () => {
  const st = L.newGame(L.rng(1));
  st.m.x = st.level.flag * T - 4; st.m.y = (GROUND - 6) * T; st.m.vy = 0; st.timeLeft = 100.4;
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'clear');
  assert.ok(st.flagPts >= 100);
  assert.strictEqual(st.bonus, 100 * L.POINTS.timePerSec, 'one hundred whole seconds were left');
  assert.ok(st.score >= st.flagPts + 100 * 50, 'time bonus counted');
  const high = L.newGame(L.rng(1)); high.m.x = high.level.flag * T - 4; high.m.y = 2 * T; L.step(high, 0.01, {});
  const low = L.newGame(L.rng(1)); low.m.x = low.level.flag * T - 4; low.m.y = (GROUND - 3) * T; L.step(low, 0.01, {});
  assert.ok(high.flagPts > low.flagPts, 'grabbing it higher is worth more');
  run(st, L.CLEAR_TIME + 0.2);
  assert.strictEqual(st.stage, 2);
  assert.strictEqual(st.phase, 'play');
  assert.strictEqual(st.m.size, 'small');
  assert.ok(st.score > 0, 'score carries over');
});

test('clearing the last stage wins the game', () => {
  const st = L.newGame(L.rng(1), 4);
  st.m.x = st.level.flag * T - 4; st.m.y = (GROUND - 4) * T; L.step(st, 0.01, {});
  assert.ok(st.won);
  assert.ok(evs(st, 'win').length === 1);
  run(st, L.CLEAR_TIME + 0.2);
  assert.strictEqual(st.phase, 'over');
});

test('running out of time kills, dying restarts the stage as small mario, and no lives left ends the game', () => {
  const st = L.newGame(L.rng(1)); st.timeLeft = 0.05;
  const why = [];
  for (let i = 0; i < 10; i++) { L.step(st, 0.01, {}); for (const e of evs(st, 'dead')) why.push(e.why); }
  assert.deepStrictEqual(why, ['time']);
  assert.strictEqual(st.phase, 'dying');
  st.score = 777;
  run(st, L.DYING + 0.2);
  assert.strictEqual(st.phase, 'play');
  assert.strictEqual(st.stage, 1);
  assert.strictEqual(st.m.x, st.level.start * T);
  assert.strictEqual(st.score, 777);
  assert.ok(st.timeLeft > 100);
  const last = L.newGame(L.rng(1)); last.lives = 1; L.die(last, 'enemy');
  run(last, L.DYING + 0.2);
  assert.strictEqual(last.phase, 'over');
  const score = last.score; run(last, 1, { right: true });
  assert.strictEqual(last.score, score);
});

test('big mario that dies restarts small', () => {
  const st = L.newGame(L.rng(1)); L.setSize(st, 'fire');
  L.die(st, 'pit'); run(st, L.DYING + 0.2);
  assert.strictEqual(st.m.size, 'small');
});

test('an extra life comes at the score threshold', () => {
  const st = L.newGame(L.rng(1));
  L.addScore(st, L.EXTRA_LIFE_AT - 1);
  assert.strictEqual(st.lives, L.START_LIVES);
  L.addScore(st, 1);
  assert.strictEqual(st.lives, L.START_LIVES + 1);
});

test('the practice mode gives more lives and no time limit', () => {
  const st = L.newGame(L.rng(1), 1, { tutorial: true, lives: 9 });
  assert.strictEqual(st.lives, 9);
  assert.ok(st.timeLeft > 5000);
});

test('random play never breaks the rules on any stage (fuzz)', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const r = L.rng(seed), st = L.newGame(L.rng(seed * 9), 1 + (seed % 4));
    let right = true, jump = false;
    for (let i = 0; i < 4000 && st.phase !== 'over'; i++) {
      if (i % 20 === 0) { right = r() < 0.8; }
      jump = r() < 0.06;
      L.step(st, 0.02, { right, left: !right && r() < 0.3, run: r() < 0.5, jump, jumpHeld: r() < 0.5, fire: r() < 0.05 });
      const m = st.m;
      assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.vx) && Number.isFinite(m.vy));
      assert.ok(m.x >= -1 && m.x <= st.w * T + 1);
      assert.ok(st.lives >= 0 && st.score >= 0 && st.coins >= 0 && st.coins < 100);
      assert.ok(st.fireballs.length <= 2);
      for (const e of st.enemies) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
    }
  }
});
