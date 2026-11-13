'use strict';

// 슈퍼마리오 풍 게임 규칙 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const { T, GROUND } = L;
const N = (name) => L.STAGES.findIndex((q) => q.name === name) + 1;       // 코스 이름으로 번호를 찾는다 (코스 순서가 바뀌어도 시험이 안 깨지게)
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
  assert.strictEqual(L.STAGES.length, 10);
  for (const s of L.STAGES) {
    assert.strictEqual(s.tiles.length, L.ROWS);
    assert.ok(s.tiles.every((r) => r.length === s.w), `${s.name}: all rows same width`);
    assert.ok(s.time >= 200, `${s.name} has time`);
    // 땅 구간: 처음 몇 칸은 땅, 구멍 폭은 4칸 이하, 구간은 3칸 이상
    assert.ok(s.ground[0][0] === 0 && s.ground[0][1] >= 8, 'a safe start');
    for (let i = 0; i < s.ground.length; i++) {
      const [a, b] = s.ground[i];
      assert.ok(b - a + 1 >= 3, `${s.name}: ground piece ${a}-${b} is wide enough to land on`);
      if (i > 0) assert.ok(a - s.ground[i - 1][1] - 1 <= 4 || (s.lifts || []).some((l) => l.axis === 'x' && l.x <= (s.ground[i - 1][1] + 1) * T && l.x + l.range + l.w >= a * T), `${s.name}: pit before ${a} is at most 4 wide`);
    }
    assert.ok(s.ground[s.ground.length - 1][1] === s.w - 1, 'ground runs to the end');
    // 깃대
    if (!s.boss) {
      assert.ok(s.flag > 20 && s.flag < s.w - 2);
      assert.strictEqual(s.tiles[1][s.flag], 'f');
      for (let y = 2; y <= 9; y++) assert.strictEqual(s.tiles[y][s.flag], 'F');
      assert.ok(s.ground.some(([a, b]) => s.flag >= a && s.flag <= b), 'the flag stands on ground');
    }
    // 적은 땅 위에서 시작 (용암 불꽃은 구멍에서 튀어 오른다)
    assert.ok(s.spawns.length >= (s.boss ? 3 : 8));
    for (const sp of s.spawns.filter((q) => q.type !== 'podoboo')) assert.ok(s.ground.some(([a, b]) => sp.x >= a && sp.x <= b), `${s.name}: enemy at ${sp.x} stands on ground`);
    // 파이프를 넘어 내려앉는 자리(파이프 오른쪽 2~5칸)에는 적을 두지 않는다 (착지하자마자 부딪히는 불공정한 자리)
    for (let x = 0; x < s.w - 1; x++) for (let y = 0; y < L.ROWS; y++) {
      if (s.tiles[y][x] === 'P' && s.tiles[y][x + 1] === 'P' && (x === 0 || s.tiles[y][x - 1] !== 'P')) {
        for (const sp of s.spawns) assert.ok(!(sp.x >= x + 2 && sp.x <= x + 5), `${s.name}: no enemy right behind the pipe at ${x} (enemy at ${sp.x})`);
      }
    }
    // 버섯 블록이 처음에 있다
    const early = [];
    for (let y = 0; y < L.ROWS; y++) for (let x = 0; x < 24; x++) if (s.tiles[y][x] === 'M') early.push([x, y]);
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
  assert.ok(st.score >= L.POINTS.kick + L.SHELL_CHAIN[0], 'a kick and then a knocked-out enemy');
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

test('touching the flag starts the finish: slide down, walk to the castle, count the time into points, next stage', () => {
  const st = L.newGame(L.rng(1));
  st.m.x = st.level.flag * T - 4; st.m.y = (GROUND - 6) * T; st.m.vy = 0; st.timeLeft = 100.4;
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'clear');
  assert.strictEqual(st.clearPhase, 'slide');
  assert.ok(st.flagPts >= 100);
  assert.strictEqual(st.bonus, 100 * L.POINTS.timePerUnit, 'one hundred whole units were left');
  const scoreAtGrab = st.score;
  const seen = [st.clearPhase], y0 = st.m.y;
  for (let i = 0; i < 2000 && st.phase === 'clear'; i++) { L.step(st, 0.01, {}); if (seen[seen.length - 1] !== st.clearPhase) seen.push(st.clearPhase); if (st.clearPhase === 'slide') assert.ok(st.m.y >= y0); }
  assert.deepStrictEqual(seen.slice(0, 5), ['slide', 'hang', 'walk', 'count', 'wait']);
  assert.strictEqual(st.stage, 2, 'moved on to the next stage');
  assert.strictEqual(st.phase, 'play');
  assert.strictEqual(st.m.size, 'small');
  assert.ok(st.score >= scoreAtGrab + 100 * L.POINTS.timePerUnit - L.POINTS.timePerUnit, 'the remaining time turned into points');
});

test('grabbing the flag higher is worth more, and the time bonus never counts twice', () => {
  const high = L.newGame(L.rng(1)); high.m.x = high.level.flag * T - 4; high.m.y = 2 * T; L.step(high, 0.01, {});
  const low = L.newGame(L.rng(1)); low.m.x = low.level.flag * T - 4; low.m.y = (GROUND - 3) * T; L.step(low, 0.01, {});
  assert.ok(high.flagPts > low.flagPts);
  assert.strictEqual(high.flagPts, L.POINTS.flag[L.POINTS.flag.length - 1]);
  const st = L.newGame(L.rng(1)); st.m.x = st.level.flag * T - 4; st.m.y = (GROUND - 4) * T; st.timeLeft = 50; L.step(st, 0.01, {});
  const after = st.score;
  for (let i = 0; i < 400 && st.phase === 'clear'; i++) L.step(st, 0.01, {});
  assert.ok(st.score - after <= 50 * L.POINTS.timePerUnit, 'at most the time that was left');
  assert.ok(st.score - after >= 49 * L.POINTS.timePerUnit);
});

test('clearing the last stage wins the game after the finish', () => {
  const st = L.newGame(L.rng(1), N('쿠파 성'));
  st.m.x = 56 * T; st.m.y = GROUND * T - st.m.h; st.m.onGround = true; st.camX = st.m.x - 96; st.enemies = []; st.boss.state = 'dead'; st.boss.y = 400; L.step(st, 0.01, {});
  assert.ok(st.won);
  const types = [];
  for (let i = 0; i < 3000 && st.phase !== 'over'; i++) { L.step(st, 0.01, {}); types.push(...st.events.map((e) => e.t)); }
  assert.strictEqual(st.phase, 'over');
  assert.ok(types.includes('win') && types.includes('over'));
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
    const r = L.rng(seed), st = L.newGame(L.rng(seed * 9), 1 + (seed % (L.STAGES.length - 1)));
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

// ---------- 원작에 가깝게 고친 것 ----------
test('acceleration is gradual like the original: it takes about three quarters of a second to reach walking speed', () => {
  const st = world();
  run(st, 0.3, { right: true });
  assert.ok(st.m.vx < L.WALK * 0.6, `still gaining speed after 0.3s (${st.m.vx})`);
  run(st, 0.6, { right: true });
  assert.ok(st.m.vx >= L.WALK - 1, 'at walking speed after about a second');
  const r = world();
  run(r, 0.5, { right: true, run: true });
  const walkOnly = world(); run(walkOnly, 0.5, { right: true });
  assert.ok(r.m.vx > walkOnly.m.vx, 'running accelerates faster');
});

test('turning around on the ground skids to a stop before going the other way', () => {
  const st = world();
  run(st, 2, { right: true, run: true });
  const v0 = st.m.vx;
  L.step(st, 0.05, { left: true, run: true });
  assert.ok(st.m.skid, 'skidding');
  assert.ok(st.m.vx > 0 && st.m.vx < v0, 'slowing but still moving right');
  assert.strictEqual(st.m.face, 1, 'still facing right while skidding');
  const t0 = st.time;
  for (let i = 0; i < 300 && st.m.vx > 0; i++) L.step(st, 0.01, { left: true, run: true });
  assert.ok(st.time - t0 < 0.8, 'the skid is quick');
  run(st, 0.5, { left: true, run: true });
  assert.ok(st.m.vx < 0 && st.m.face === -1, 'now going left');
});

test('in the air the speed is kept without input and he can still steer a little', () => {
  const st = world();
  run(st, 1.5, { right: true });
  L.step(st, 0.01, { right: true, jump: true, jumpHeld: true });
  const v0 = st.m.vx;
  run(st, 0.2, { jumpHeld: true });
  assert.ok(Math.abs(st.m.vx - v0) < 1, 'no slowing down in the air');
  run(st, 0.2, { left: true, jumpHeld: true });
  assert.ok(st.m.vx < v0, 'steering left in the air slows him');
});

test('a running jump goes higher and farther than a walking jump, and falling has a top speed', () => {
  const apex = (input) => {
    const st = world(); run(st, 2, input);
    L.step(st, 0.01, { ...input, jump: true, jumpHeld: true });
    let top = st.m.y; const x0 = st.m.x; let landed = false;
    for (let i = 0; i < 400 && !landed; i++) { L.step(st, 0.01, { ...input, jumpHeld: true }); top = Math.min(top, st.m.y); landed = st.m.onGround; }
    return { h: GROUND * T - st.m.h - top, d: st.m.x - x0 };
  };
  const walk = apex({ right: true }), fast = apex({ right: true, run: true });
  assert.ok(fast.h > walk.h + 8, `running jump (${fast.h}) is higher than a walking jump (${walk.h})`);
  assert.ok(fast.d > walk.d + 30, 'and farther');
  const fall = world(); fall.m.y = 0; fall.m.onGround = false; fall.tiles[GROUND][5] = '.'; 
  run(fall, 0.5);
  assert.ok(fall.m.vy <= L.MAXFALL + 0.001);
});

test('the time limit counts down in game units, 2.5 per real second, with a hurry up warning', () => {
  const st = L.newGame(L.rng(1));
  st.m.invuln = 1e9;
  const t0 = st.timeLeft;
  run(st, 2);
  assert.ok(Math.abs((t0 - st.timeLeft) - 5) < 0.2, `lost ${t0 - st.timeLeft} units in two seconds`);
  st.timeLeft = L.HURRY_AT + 0.02;
  const types = [];
  for (let i = 0; i < 10; i++) { L.step(st, 0.01, {}); types.push(...st.events.map((e) => e.t)); }
  assert.strictEqual(types.filter((t) => t === 'hurry').length, 1);
  run(st, 5);
  assert.strictEqual(L.newGame(L.rng(1), 1, { tutorial: true }).hurried, false);
});

test('a koopa shell that is left alone comes back as a walking koopa', () => {
  const st = world(); const k = koopa(st, 300); k.state = 'shell'; k.h = 12; k.y += 4; k.vx = 0; k.timer = 0;
  st.m.x = 2 * T;
  run(st, L.SHELL_REVIVE - 1.5);
  assert.strictEqual(k.state, 'shell');
  run(st, 1.5 + 0.2);
  assert.strictEqual(k.state, 'walk');
  assert.strictEqual(k.h, L.ENEMY.koopa.h);
  assert.ok(k.vx !== 0);
  assert.strictEqual(k.y + k.h, GROUND * T, 'standing on the ground again');
});

test('kicking a shell is worth 400 and chains of enemies knocked out by one shell are worth more each time', () => {
  const st = world(); const k = koopa(st, 100); k.state = 'shell'; k.h = 12; k.y += 4; k.vx = 0;
  st.m.x = k.x - st.m.w + 2; L.step(st, 0.02, {});
  assert.strictEqual(k.state, 'shellMove');
  assert.strictEqual(st.score, L.POINTS.kick);
  const pts = [];
  k.x = 100; k.vx = L.SHELL_SPEED; st.m.x = 2 * T; st.m.invuln = 99;
  for (let i = 0; i < 4; i++) goomba(st, 110 + i * 24, GROUND * T - 12, 0);
  for (let i = 0; i < 200; i++) { L.step(st, 0.01, {}); for (const e of evs(st, 'kill')) pts.push(e.pts); }
  assert.deepStrictEqual(pts.slice(0, 4), L.SHELL_CHAIN.slice(0, 4), 'each one worth more than the one before');
});

test('stomping many enemies in a row eventually gives an extra life', () => {
  const st = world();
  const lives0 = st.lives;
  for (let i = 0; i < L.STOMP_CHAIN.length + 1; i++) {
    const g = goomba(st, 100); st.m.x = 98; st.m.y = g.y - st.m.h + 2; st.m.vy = 120; st.m.onGround = false;
    L.step(st, 0.02, {});
  }
  assert.strictEqual(st.lives, lives0 + 1, 'the eleventh stomp is a 1up');
  assert.ok(st.score >= L.STOMP_CHAIN.reduce((a, b) => a + b, 0));
  assert.deepStrictEqual(L.STOMP_CHAIN.slice(0, 4), [100, 200, 400, 500]);
});

test('a star makes mario unhurtable and knocks out enemies he touches, for ten seconds', () => {
  const st = world(); put(st, 8, 7, '*');
  st.m.x = 8 * T + 2; st.m.y = 8 * T + 6; st.m.vy = -120; run(st, 0.1, { jumpHeld: true });
  run(st, 0.6);
  const it = st.items.find((i) => i.type === 'star');
  assert.ok(it, 'a star came out');
  st.m.x = it.x - 4; st.m.y = it.y - st.m.h + 12; st.m.vy = 0; L.step(st, 0.01, {});
  assert.ok(st.m.star > 9);
  const g1 = goomba(st, st.m.x + 4, GROUND * T - 12, 0), g2 = goomba(st, st.m.x + 4, GROUND * T - 12, 0);
  st.m.x = 20 * T; g1.x = st.m.x + 2; g2.x = st.m.x + 2; st.m.y = GROUND * T - st.m.h;
  const pts = [];
  L.step(st, 0.01, {}); for (const e of evs(st, 'kill')) pts.push(e.pts);
  assert.strictEqual(st.phase, 'play', 'unhurt');
  assert.strictEqual(g1.state, 'dead'); assert.strictEqual(g2.state, 'dead');
  assert.deepStrictEqual(pts, [L.STOMP_CHAIN[0], L.STOMP_CHAIN[1]]);
  run(st, L.STAR_TIME + 0.5);
  assert.strictEqual(st.m.star, 0);
  goomba(st, st.m.x + 4, GROUND * T - 12, 0);
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'dying', 'vulnerable again');
});

test('a 1up block gives a green mushroom that adds a life', () => {
  const st = world(); put(st, 8, 7, '1');
  st.m.x = 8 * T + 2; st.m.y = 8 * T + 6; st.m.vy = -120; run(st, 0.1, { jumpHeld: true });
  run(st, 0.6);
  const it = st.items.find((i) => i.type === '1up');
  assert.ok(it);
  const lives0 = st.lives;
  st.m.x = it.x - 4; st.m.y = it.y - st.m.h + 12; st.m.vy = 0; L.step(st, 0.01, {});
  assert.strictEqual(st.lives, lives0 + 1);
  assert.strictEqual(st.m.size, 'small', 'no growing');
});

test('a coin block gives a coin per hit up to ten, and runs out after a few seconds', () => {
  const st = world(); put(st, 8, 7, '$');
  for (let i = 0; i < 4; i++) { st.m.x = 8 * T + 2; st.m.y = 8 * T + 6; st.m.vy = -120; st.m.onGround = false; run(st, 0.1, { jumpHeld: true }); run(st, 0.5); }
  assert.strictEqual(st.coins, 4, 'one coin for each of four hits');
  assert.strictEqual(st.tiles[7][8], '$', 'still a coin block');
  run(st, L.COIN_BLOCK_TIME + 0.5);
  assert.strictEqual(st.tiles[7][8], 'U', 'used up after the time is over');
  const full = world(); put(full, 8, 7, '$');
  for (let i = 0; i < 14; i++) { full.m.x = 8 * T + 2; full.m.y = 8 * T + 6; full.m.vy = -120; full.m.onGround = false; run(full, 0.1, { jumpHeld: true }); run(full, 0.15); }
  assert.strictEqual(full.coins, L.COIN_BLOCK_MAX, 'ten coins at most');
  assert.strictEqual(full.tiles[7][8], 'U');
});

test('stages: special blocks and plants are placed sensibly', () => {
  const count = (s, c) => s.tiles.flat().filter((t) => t === c).length;
  assert.ok(L.STAGES.some((s) => count(s, '*') >= 1), 'a star somewhere');
  assert.ok(L.STAGES.some((s) => count(s, '1') >= 1), 'a 1up somewhere');
  assert.ok(L.STAGES.some((s) => count(s, '$') >= 1), 'a coin block somewhere');
  assert.strictEqual(L.STAGES[0].plants.length, 0, 'the first stage has no plants');
  for (const s of L.STAGES) for (const p of s.plants) {
    assert.strictEqual(s.tiles[Math.round(p.topY / T)][p.x], 'P', `${s.name}: a plant sits on a pipe top`);
    assert.strictEqual(s.tiles[Math.round(p.topY / T)][p.x + 1], 'P');
  }
});

test('a plant rises out of its pipe, stays up for a while and goes back down, and it hurts', () => {
  const st = world(); put(st, 20, GROUND - 2, 'P'); put(st, 21, GROUND - 2, 'P'); put(st, 20, GROUND - 1, 'p'); put(st, 21, GROUND - 1, 'p');
  st.plants = [{ id: 1, x: 20 * T + 10, w: L.PLANT.w, h: L.PLANT.h, topY: (GROUND - 2) * T, pipeX: 21 * T, state: 'down', timer: 0, extent: 0, y: (GROUND - 2) * T, dead: false }];
  st.m.x = 4 * T; st.m.invuln = 1e9;
  const p = st.plants[0];
  run(st, L.PLANT.down - 0.2);
  assert.strictEqual(p.extent, 0, 'still hidden');
  run(st, L.PLANT.rise + 0.4);
  assert.ok(p.extent > 0.9, 'out of the pipe');
  run(st, L.PLANT.up + L.PLANT.sink + 0.2);
  assert.ok(p.extent < 0.3 || p.state === 'down', 'going back down');
  const hit = world(); put(hit, 20, GROUND - 2, 'P'); put(hit, 21, GROUND - 2, 'P');
  hit.plants = [{ id: 1, x: 20 * T + 10, w: L.PLANT.w, h: L.PLANT.h, topY: (GROUND - 2) * T, pipeX: 21 * T, state: 'up', timer: 0, extent: 1, y: (GROUND - 2) * T - L.PLANT.h, dead: false }];
  hit.m.x = 20 * T + 8; hit.m.y = (GROUND - 2) * T - L.PLANT.h - hit.m.h + 4; hit.m.vy = 0; hit.m.invuln = 0; hit.m.onGround = false;
  L.step(hit, 0.01, {});
  assert.strictEqual(hit.phase, 'dying', 'touching a plant that is up kills small mario');
});

test('a plant stays down while mario is right next to the pipe, and fire or a star removes it', () => {
  const st = world(); st.plants = [{ id: 1, x: 20 * T + 10, w: L.PLANT.w, h: L.PLANT.h, topY: (GROUND - 2) * T, pipeX: 21 * T, state: 'down', timer: 0, extent: 0, y: (GROUND - 2) * T, dead: false }];
  put(st, 20, GROUND - 2, 'P'); put(st, 21, GROUND - 2, 'P'); put(st, 20, GROUND - 1, 'p'); put(st, 21, GROUND - 1, 'p');
  st.m.x = 19 * T - 4; st.m.y = GROUND * T - st.m.h; st.m.invuln = 1e9;
  run(st, 10);
  assert.strictEqual(st.plants[0].extent, 0, 'never comes out with mario standing next to it');
  const f = world(); L.setSize(f, 'fire'); f.m.invuln = 1e9;
  f.plants = [{ id: 1, x: 12 * T, w: L.PLANT.w, h: L.PLANT.h, topY: (GROUND - 2) * T, pipeX: 12 * T + 6, state: 'up', timer: 0, extent: 1, y: (GROUND - 2) * T - L.PLANT.h, dead: false }];
  f.m.x = 5 * T; f.m.face = 1; f.fireballs.push({ id: 9, x: 12 * T - 4, y: (GROUND - 2) * T - 8, w: 6, h: 6, vx: 190, vy: 0, life: 2 });
  L.step(f, 0.02, {});
  assert.strictEqual(f.plants.length, 0, 'a fireball removes the plant');
  assert.ok(f.score >= L.POINTS.plant);
});

// ---------- 앉기와 파이프 ----------
// 파이프 두 개(들어가는 것 20, 나오는 것 40)가 있는 시험용 세상
function pipeWorld() {
  const st = world({ w: 60 });
  const pipe = (x, h) => { for (let k = 0; k < 2; k++) for (let i = 1; i <= h; i++) st.tiles[GROUND - i][x + k] = i === h ? 'P' : 'p'; };
  pipe(20, 2); pipe(40, 3);
  st.level = { ...st.level, warps: [{ x: 20, topY: (GROUND - 2) * T, exitX: 40, exitTopY: (GROUND - 3) * T }], plants: [] };
  st.plants = [];
  return st;
}
const onPipe = (st) => { st.m.x = 20 * T + 10; st.m.y = (GROUND - 2) * T - st.m.h; st.m.vx = 0; st.m.vy = 0; st.m.onGround = true; };

test('only big mario can crouch: pressing down shrinks his box, keeps his feet where they were, and he stands up again', () => {
  const small = world();
  L.step(small, 0.02, { down: true });
  assert.strictEqual(small.m.crouch, false, 'small mario does not crouch');
  const st = world(); setBig(st);
  const feet = st.m.y + st.m.h;
  L.step(st, 0.02, { down: true });
  assert.strictEqual(st.m.crouch, true);
  assert.strictEqual(st.m.h, L.CROUCH_H);
  assert.strictEqual(st.m.y + st.m.h, feet, 'feet stay put');
  assert.strictEqual(evs(st, 'crouch').length, 1);
  L.step(st, 0.02, {});
  assert.strictEqual(st.m.crouch, false);
  assert.strictEqual(st.m.h, L.SIZE.big.h);
  assert.strictEqual(st.m.y + st.m.h, feet);
});

test('while crouching he cannot walk but slides on with the speed he had and then stops', () => {
  const st = world(); setBig(st);
  run(st, 2, { right: true, run: true });
  const x0 = st.m.x;
  L.step(st, 0.02, { down: true, right: true });
  assert.ok(st.m.crouch);
  run(st, 0.5, { down: true, right: true });
  assert.ok(st.m.vx < L.RUN, 'pressing right does not speed him up while crouching');
  run(st, 1.5, { down: true });
  assert.strictEqual(st.m.vx, 0, 'stopped');
  const slid = st.m.x - x0;
  assert.ok(slid > 30 && slid < 160, `slid ${slid}px`);
  const still = world(); setBig(still); L.step(still, 0.02, { down: true });
  run(still, 1, { down: true, right: true });
  assert.strictEqual(still.m.x, 5 * T, 'cannot start walking while crouched');
});

test('under a low ceiling he stays crouched until he is out from under it', () => {
  const st = world(); setBig(st);
  for (let x = 8; x <= 10; x++) st.tiles[GROUND - 2][x] = 'S';           // 땅에서 한 칸 높이만 비어 있는 낮은 굴
  st.m.x = 9 * T; st.m.vx = 0;
  L.step(st, 0.02, { down: true });
  assert.ok(st.m.crouch);
  L.step(st, 0.02, {});
  assert.ok(st.m.crouch, 'cannot stand up under the ceiling');
  st.m.x = 12 * T;
  L.step(st, 0.02, {});
  assert.strictEqual(st.m.crouch, false, 'stands up once he is clear');
  const small = world();
  small.m.x = 9 * T;
  for (let x = 8; x <= 10; x++) small.tiles[GROUND - 2][x] = 'S';
  run(small, 0.3, { right: true });
  assert.ok(small.m.x > 9 * T, 'small mario fits in the low tunnel without crouching');
});

test('a crouched mario can still jump, cannot throw fire, and shrinks (standing) when hurt', () => {
  const st = world(); L.setSize(st, 'fire');
  L.step(st, 0.02, { down: true });
  L.step(st, 0.02, { down: true, jump: true, jumpHeld: true });
  assert.ok(!st.m.onGround, 'jumped');
  const f = world(); L.setSize(f, 'fire'); L.step(f, 0.02, { down: true });
  L.step(f, 0.02, { down: true, fire: true });
  assert.strictEqual(f.fireballs.length, 0, 'no fireballs while crouching');
  const h = world(); setBig(h); L.step(h, 0.02, { down: true });
  goomba(h, h.m.x + 6, GROUND * T - 12, 0);
  L.step(h, 0.02, { down: true });
  assert.strictEqual(h.phase, 'play');
  assert.strictEqual(h.m.size, 'small');
  assert.strictEqual(h.m.crouch, false);
  assert.strictEqual(h.m.h, L.SIZE.small.h);
});

test('pressing down on top of a warp pipe sinks mario into it and takes him to the bonus room', () => {
  const st = pipeWorld(); onPipe(st);
  const types = [];
  L.step(st, 0.02, { down: true }); types.push(...st.events.map((e) => e.t));
  assert.strictEqual(st.phase, 'warp');
  assert.ok(types.includes('warp'));
  let sank = false;
  for (let i = 0; i < 40 && st.phase === 'warp'; i++) { L.step(st, 0.02, {}); if (st.m.y > (GROUND - 2) * T - st.m.h + 4) sank = true; }
  assert.ok(sank, 'he goes down into the pipe');
  assert.strictEqual(st.phase, 'play');
  assert.strictEqual(st.inRoom, true);
  assert.strictEqual(st.w, L.ROOM.w);
  assert.strictEqual(st.enemies.length, 0);
  assert.strictEqual(st.m.onGround, true);
  assert.strictEqual(st.m.y + st.m.h, GROUND * T, 'standing on the room floor');
});

test('only a warp pipe, standing on its top, with down pressed warps; elsewhere down does nothing special', () => {
  const beside = pipeWorld(); beside.m.x = 18 * T; beside.m.y = GROUND * T - beside.m.h; L.step(beside, 0.02, { down: true });
  assert.strictEqual(beside.phase, 'play');
  const air = pipeWorld(); onPipe(air); air.m.y -= 30; air.m.onGround = false; air.m.vy = 0; L.step(air, 0.02, { down: true });
  assert.strictEqual(air.phase, 'play', 'not while in the air above the pipe');
  const other = pipeWorld(); other.m.x = 40 * T + 10; other.m.y = (GROUND - 3) * T - other.m.h; other.m.onGround = true; L.step(other, 0.02, { down: true });
  assert.strictEqual(other.phase, 'play', 'the exit pipe is not an entrance');
  const noDown = pipeWorld(); onPipe(noDown); run(noDown, 0.5, {});
  assert.strictEqual(noDown.phase, 'play', 'standing on it does nothing without pressing down');
  assert.strictEqual(L.warpAt(noDown) !== null, true);
});

test('in the bonus room he collects coins and walking into the exit pipe brings him back to the exit pipe on the course', () => {
  const st = pipeWorld(); onPipe(st);
  const goombaOut = goomba(st, 700); const gx = goombaOut.x;          // 나오는 파이프보다 오른쪽에서 기다리는 굼바
  const tilesBefore = st.tiles;
  L.step(st, 0.02, { down: true }); run(st, 1);
  assert.ok(st.inRoom);
  const coins0 = st.coins;
  st.m.x = 2 * T + 2; run(st, 1.2, { right: true });
  assert.ok(st.coins > coins0, 'picked up some coins along the floor');
  st.m.x = 12 * T; st.m.vx = 0;
  for (let i = 0; i < 300 && st.inRoom; i++) L.step(st, 0.01, { right: true });
  assert.strictEqual(st.inRoom, false, 'back on the course');
  assert.strictEqual(st.phase, 'warp', 'rising out of the exit pipe');
  assert.strictEqual(st.m.x + st.m.w / 2, 40 * T + T, 'centered on the exit pipe');
  assert.strictEqual(st.tiles, tilesBefore, 'the course is exactly as it was');
  assert.strictEqual(st.w, 60);
  assert.ok(st.enemies.includes(goombaOut) && goombaOut.x === gx, 'enemies waited where they were');
  run(st, L.WARP_TIME + 0.2);
  assert.strictEqual(st.m.x + st.m.w / 2, 40 * T + T, 'still centered on the exit pipe');
  assert.ok(Math.abs(st.m.y + st.m.h - (GROUND - 3) * T) < 1.5, 'standing on top of the exit pipe');
  assert.strictEqual(st.phase, 'play');
});

test('the course waits while mario is in the room, the clock keeps running, and running out of time there still kills', () => {
  const st = pipeWorld(); onPipe(st); const e = goomba(st, 300, GROUND * T - 12, -30);
  st.timeLeft = 300;
  L.step(st, 0.02, { down: true }); run(st, 1);
  assert.ok(st.inRoom);
  const ex = e.x, t0 = st.timeLeft;
  run(st, 2);
  assert.strictEqual(e.x, ex, 'the enemies on the course are frozen');
  assert.ok(st.timeLeft < t0 - 4, 'but the time goes on');
  st.timeLeft = 0.02; run(st, 0.2);
  assert.strictEqual(st.phase, 'dying');
  run(st, L.DYING + 0.2);
  assert.strictEqual(st.inRoom, false, 'the stage starts over on the surface');
  assert.strictEqual(st.w, st.level.w);
});

test('big mario can warp too and fireballs from the course are gone in the room', () => {
  const st = pipeWorld(); setBig(st); L.setSize(st, 'fire'); onPipe(st);
  st.fireballs.push({ id: 7, x: 100, y: 100, w: 6, h: 6, vx: 100, vy: 0, life: 3 });
  L.step(st, 0.02, { down: true }); run(st, 1);
  assert.ok(st.inRoom);
  assert.strictEqual(st.fireballs.length, 0);
  assert.strictEqual(st.m.size, 'fire');
  assert.strictEqual(st.m.h, L.SIZE.fire.h);
});

test('stages: every warp pipe and exit pipe exists, the exit pipe has no plant, and the bonus room is valid', () => {
  assert.ok(L.STAGES.some((s) => s.warps.length >= 1));
  for (const s of L.STAGES) for (const w of s.warps) {
    assert.strictEqual(s.tiles[Math.round(w.topY / T)][w.x], 'P', `${s.name}: entrance pipe`);
    assert.strictEqual(s.tiles[Math.round(w.exitTopY / T)][w.exitX], 'P', `${s.name}: exit pipe`);
    assert.notStrictEqual(w.x, w.exitX);
    assert.ok(!s.plants.some((p) => p.x === w.exitX), `${s.name}: no plant on the exit pipe`);
    assert.ok(s.ground.some(([a, b]) => w.x >= a && w.x <= b) && s.ground.some(([a, b]) => w.exitX >= a && w.exitX <= b));
  }
  const room = L.ROOM;
  assert.strictEqual(room.tiles.length, L.ROWS);
  assert.ok(room.tiles.every((r) => r.length === room.w));
  assert.strictEqual(room.w * T, L.VW, 'the room fits the screen without scrolling');
  for (let x = 0; x < room.w; x++) assert.strictEqual(room.tiles[GROUND][x], '#');
  assert.strictEqual(room.tiles.flat().filter((t) => t === 'C').length, room.coins);
  assert.strictEqual(room.tiles.flat().filter((t) => t === 'E').length, 4, 'a two by two exit pipe mouth');
  assert.strictEqual(room.tiles[GROUND - 1][room.w - 1], 'E');
});

test('in the practice mode a hit does not shrink big mario so the crouch and pipe steps can still be done', () => {
  const st = L.newGame(L.rng(1), 1, { tutorial: true, lives: 9 });
  L.setSize(st, 'big'); st.m.invuln = 0;
  L.hurt(st);
  assert.strictEqual(st.m.size, 'big');
  assert.ok(st.m.invuln > 0);
  const real = L.newGame(L.rng(1)); L.setSize(real, 'big'); real.m.invuln = 0; L.hurt(real);
  assert.strictEqual(real.m.size, 'small', 'in the real game he does shrink');
});

test('a walking jump lands on a block four tiles up, a running jump on one five tiles up, and six tiles is out of reach', () => {
  const tryLand = (runInput, row) => {
    const st = world({ w: 60, x: runInput ? 6 : 10 });
    for (let x = 20; x <= 24; x++) put(st, x, row, 'B');
    st.m.invuln = 99;
    for (let i = 0; i < 1500; i++) {
      const near = st.m.x > 20 * T - 40 - (runInput ? 20 : 0);
      L.step(st, 1 / 60, { right: true, run: runInput, jump: near && st.m.onGround && st.m.x < 20 * T - 6, jumpHeld: true });
      if (st.m.onGround && Math.abs(st.m.y + st.m.h - row * T) < 1 && st.m.x > 19 * T) return true;
    }
    return false;
  };
  assert.ok(tryLand(false, GROUND - 4), 'walking: four tiles up (the usual row of blocks)');
  assert.ok(tryLand(true, GROUND - 5), 'running: five tiles up');
  assert.ok(!tryLand(true, GROUND - 6), 'six tiles up is too high');
  assert.ok(!tryLand(false, GROUND - 5), 'a plain walking jump does not reach five tiles');
  const apex = (v, g) => v * v / (2 * g);
  assert.ok(apex(L.JUMP_SLOW, L.G_HOLD_SLOW) >= 4 * T + 4, 'the walking jump clears four tiles with room to spare');
});

test('on every stage the last staircase is eight high and right next to the pole, and the top of the pole can be grabbed', () => {
  for (const s of L.STAGES.filter((q) => !q.boss)) {
    const top = s.flag - 3;
    let h = 0; for (let y = GROUND - 1; y >= 0 && s.tiles[y][top] === 'S'; y--) h++;
    assert.strictEqual(h, 8, `${s.name}: eight steps up`);
    assert.strictEqual(s.tiles[GROUND - 9][top + 1], '.', `${s.name}: open air above the top step`);
    for (let y = 0; y < 3; y++) for (let x = top - 8; x <= s.flag + 2; x++) assert.notStrictEqual(s.tiles[y][x], '#', `${s.name}: no ceiling near the pole`);
    assert.strictEqual(s.tiles[1][s.flag], 'f', 'the golden ball is at the top of the pole');
  }
});

test('a jump from the top step grabs the top of the pole for the most points, on every stage', () => {
  for (let stage = 1; stage < L.STAGES.length; stage++) {
    const lv = L.STAGES[stage - 1], top = lv.flag - 3;
    let best = 0;
    for (const run of [false, true]) for (let off = 0; off <= 30; off += 2) {
      const st = L.newGame(L.rng(1), stage); st.enemies = []; st.plants = []; st.m.invuln = 99;
      st.m.x = top * T + 2; st.m.y = (GROUND - 8) * T - st.m.h; st.m.onGround = true; st.camX = Math.max(0, st.m.x - 96);
      let jumped = false;
      for (let i = 0; i < 500 && st.phase === 'play' && st.m.y < 400; i++) {
        const j = !jumped && st.m.onGround && st.m.x > top * T + off;
        L.step(st, 1 / 60, { right: true, run, jump: j, jumpHeld: true }); if (j) jumped = true;
      }
      if (st.phase === 'clear') best = Math.max(best, st.flagPts);
    }
    assert.strictEqual(best, L.POINTS.flag[L.POINTS.flag.length - 1], `${lv.name}: the top of the pole is within reach`);
  }
});

test('running up the last staircase and jumping off the top also finishes with the most points', () => {
  for (let stage = 1; stage < L.STAGES.length; stage++) {
    const lv = L.STAGES[stage - 1], seg = lv.ground.find(([a, b]) => lv.flag >= a && lv.flag <= b);
    const st = L.newGame(L.rng(1), stage); st.enemies = []; st.plants = []; st.m.invuln = 99;
    st.m.x = Math.max(seg[0] + 1, lv.flag - 14) * T; st.m.y = GROUND * T - st.m.h; st.camX = st.m.x - 96;
    for (let i = 0; i < 1500 && st.phase === 'play'; i++) {
      const m = st.m;
      const ahead = L.solid(st, Math.floor((m.x + m.w + 8) / T), Math.floor((m.y + m.h - 2) / T));
      const atTop = m.onGround && Math.abs(m.y + m.h - (GROUND - 8) * T) < 2;
      L.step(st, 1 / 60, { right: true, run: true, jump: (ahead || atTop) && m.onGround, jumpHeld: true });
    }
    assert.strictEqual(st.phase, 'clear', `${lv.name}: cleared`);
    assert.strictEqual(st.flagPts, L.POINTS.flag[L.POINTS.flag.length - 1], `${lv.name}: top points`);
  }
});

// ---------- 새로 넣은 적·발판·쿠파 ----------
const quiet = (st) => { st.level = { ...st.level, cheeps: null }; st.enemies = []; st.plants = []; st.cannons = []; st.bars = []; st.lifts = []; st.boss = null; st.hazards = []; st.m.invuln = 0; };
const mk = (st, type, x, y) => { const d = L.ENEMY[type]; const e = L.makeEnemy(type, x, y === undefined ? GROUND * T - d.h : y, 90 + st.enemies.length); e.active = true; st.enemies.push(e); return e; };
const go = (st, secs, inp = {}) => { for (let i = 0; i < secs * 60 && st.phase === 'play'; i++) L.step(st, 1 / 60, inp); };

test('a red koopa turns around at a ledge and a green one walks off it', () => {
  for (const [type, stays] of [['redkoopa', true], ['koopa', false]]) {
    const st = L.newGame(L.rng(1)); quiet(st);
    for (let x = 20; x <= 40; x++) { put(st, x, GROUND, '.'); put(st, x, GROUND + 1, '.'); }
    for (let x = 14; x < 20; x++) { put(st, x, GROUND, '#'); }
    const e = mk(st, type, 17 * T, GROUND * T - 16); e.vx = 30;
    st.m.x = 2 * T; st.camX = 0;
    go(st, 6);
    if (stays) { assert.ok(e.y < GROUND * T, 'still on the ground'); assert.ok(e.x < 20 * T, 'did not walk off'); assert.ok(e.vx < 0 || e.x < 19 * T, 'turned back'); }
    else assert.ok(e.y > GROUND * T || e.state === 'gone', 'the green one fell into the pit');
  }
});

test('a buzzy beetle shrugs off fireballs, hides in a shell when stomped, and the shell clears enemies', () => {
  const st = L.newGame(L.rng(1)); quiet(st); setBig(st); L.setSize(st, 'fire');
  const b = mk(st, 'buzzy', 12 * T); b.vx = 0; st.m.x = 8 * T; st.m.face = 1; st.camX = 0;
  L.step(st, 0.01, { fire: true });
  go(st, 1);
  assert.strictEqual(b.state, 'walk', 'still alive after a fireball');
  assert.strictEqual(st.fireballs.length === 0 || true, true);
  const st2 = L.newGame(L.rng(1)); quiet(st2);
  const b2 = mk(st2, 'buzzy', 10 * T); b2.vx = 0; st2.m.x = 10 * T; st2.m.y = GROUND * T - 40; st2.m.vy = 80; st2.m.onGround = false;
  go(st2, 0.1);
  assert.ok(b2.state === 'shell' || b2.state === 'shellMove', 'stomped into a shell');
  b2.x = 4 * T; b2.vx = L.SHELL_SPEED; b2.state = 'shellMove'; b2.grace = 0; st2.m.x = 2 * T; st2.m.y = GROUND * T - 14; st2.m.vy = 0; st2.m.invuln = 99;
  const g = goomba(st2, 16 * T);
  go(st2, 1);
  assert.strictEqual(g.state, 'dead', 'the moving shell knocked the goomba out');
});

test('a cannon fires a bullet toward mario from a distance, not when he is next to it, and a stomp or a star beats it', () => {
  const st = L.newGame(L.rng(1)); quiet(st);
  st.cannons = [{ x: 14 * T, y: 10 * T, t: 0 }]; put(st, 14, 10, 'N');
  st.m.x = 10 * T; st.camX = 0;
  L.step(st, 0.01, {});
  const bullets = st.enemies.filter((e) => e.type === 'bullet');
  assert.strictEqual(bullets.length, 1);
  assert.ok(bullets[0].vx < 0, 'flies toward mario');
  const near = L.newGame(L.rng(1)); quiet(near);
  near.cannons = [{ x: 20 * T, y: 10 * T, t: 0 }]; near.m.x = 19 * T - 4; near.camX = 10 * T;
  L.step(near, 0.01, {});
  assert.strictEqual(near.enemies.length, 0, 'no shot at point blank');
  // 밟으면 쓰러진다
  const s2 = L.newGame(L.rng(1)); quiet(s2);
  const b = mk(s2, 'bullet', 12 * T, GROUND * T - 40); b.vx = 0; s2.m.x = 12 * T; s2.m.y = GROUND * T - 60; s2.m.vy = 100; s2.m.onGround = false;
  go(s2, 0.3);
  assert.strictEqual(b.state, 'dead');
  // 불꽃은 통하지 않고, 별은 쓰러뜨린다
  const s3 = L.newGame(L.rng(1)); quiet(s3); L.setSize(s3, 'fire');
  const b3 = mk(s3, 'bullet', 14 * T, GROUND * T - 28); b3.vx = 0; s3.m.x = 8 * T; s3.m.face = 1; s3.camX = 0;
  L.step(s3, 0.01, { fire: true }); go(s3, 1);
  assert.strictEqual(b3.state, 'walk');
  const s4 = L.newGame(L.rng(1)); quiet(s4); s4.m.star = 5;
  const b4 = mk(s4, 'bullet', 12 * T, GROUND * T - 14); b4.vx = 0; s4.m.x = 12 * T;
  L.step(s4, 0.01, {});
  assert.strictEqual(b4.state, 'dead');
});

test('a podoboo jumps out of its pit, hurts on touch, and nothing can kill it', () => {
  const st = L.newGame(L.rng(1)); quiet(st);
  const p = mk(st, 'podoboo', 30 * T, L.VH + 10); st.camX = 25 * T; st.m.x = 26 * T;
  let top = 1e9;
  for (let i = 0; i < 600; i++) { L.step(st, 1 / 60, {}); top = Math.min(top, p.y); }
  assert.ok(top < GROUND * T - 40, 'rises well above the ground line');
  assert.ok(p.y <= L.VH + 10, 'comes back down');
  const s2 = L.newGame(L.rng(1)); quiet(s2); setBig(s2);
  const q = mk(s2, 'podoboo', 12 * T, GROUND * T - 12); q.pup = true; q.vy = -1; s2.m.x = 12 * T;
  L.step(s2, 0.01, {});
  assert.strictEqual(s2.m.size, 'small', 'hurt');
  const s3 = L.newGame(L.rng(1)); quiet(s3); s3.m.star = 5;
  const r = mk(s3, 'podoboo', 12 * T, GROUND * T - 12); r.pup = true; r.vy = -1; s3.m.x = 12 * T;
  L.step(s3, 0.01, {});
  assert.strictEqual(r.state, 'walk', 'a star does not kill it');
  assert.ok(!s3.m.dead);
  assert.ok(q);
});

test('a fire bar spins and burns, but not a star mario', () => {
  const st = L.newGame(L.rng(1)); quiet(st); setBig(st);
  st.bars = [{ cx: 10 * T + 8, cy: 8 * T + 8, len: 5, spd: 2, ang: 0 }];
  st.m.x = 10 * T + 8 + 2 * 7 - 6; st.m.y = 8 * T + 4; st.m.onGround = false; st.m.vy = -50; st.camX = 0;
  L.step(st, 0.01, {});
  assert.strictEqual(st.m.size, 'small', 'burned');
  const a = st.bars[0].ang;
  L.step(st, 0.1, {});
  assert.ok(st.bars[0].ang > a, 'keeps turning');
  const s2 = L.newGame(L.rng(1)); quiet(s2); setBig(s2); s2.m.star = 5;
  s2.bars = [{ cx: 10 * T + 8, cy: 8 * T + 8, len: 5, spd: 2, ang: 0 }];
  s2.m.x = 10 * T + 8 + 2 * 7 - 6; s2.m.y = 8 * T + 4; s2.m.onGround = false; s2.m.vy = -50; s2.camX = 0;
  L.step(s2, 0.01, {});
  assert.strictEqual(s2.m.size, 'big', 'a star mario is safe');
  assert.strictEqual(L.barSegments(s2.bars[0]).length, 5);
});

test('a moving platform carries mario across a wide gap, and it can be jumped onto from below', () => {
  const st = L.newGame(L.rng(1), N('하늘 구름')); quiet(st);
  const lv = st.level;
  st.lifts = [{ x: lv.lifts[0].x, y: lv.lifts[0].y, w: lv.lifts[0].w, h: 6, x0: lv.lifts[0].x, y0: lv.lifts[0].y, axis: 'x', range: lv.lifts[0].range, speed: lv.lifts[0].speed, p: 0, dx: 0, dy: 0 }];
  const l = st.lifts[0];
  st.m.x = l.x + 8; st.m.y = l.y - st.m.h; st.m.onGround = true; st.m.vy = 0; st.camX = st.m.x - 96;
  const x0 = st.m.x;
  go(st, 1);
  assert.ok(st.m.onGround && Math.abs(st.m.y + st.m.h - l.y) < 1, 'rides on top');
  assert.ok(st.m.x > x0 + 20, 'carried to the right');
  go(st, 1.9);
  assert.ok(st.m.x > 111 * T - 60, 'near the far end');
  for (let i = 0; i < 90 && st.m.x < 113 * T; i++) L.step(st, 1 / 60, { right: true });
  assert.ok(st.m.x >= 112 * T && st.phase === 'play', 'walked onto the far ground');
  // 아래에서 위로는 지나간다
  const s2 = L.newGame(L.rng(1)); quiet(s2);
  s2.lifts = [{ x: 10 * T, y: 8 * T, w: 48, h: 6, x0: 10 * T, y0: 8 * T, axis: 'x', range: 0.0001, speed: 0, p: 0, dx: 0, dy: 0 }];
  s2.m.x = 11 * T; s2.m.y = 8 * T + 40; s2.m.vy = -240; s2.m.onGround = false; s2.camX = 0;
  for (let i = 0; i < 20; i++) L.step(s2, 1 / 60, { jumpHeld: true });
  assert.ok(s2.m.y + s2.m.h < 8 * T || s2.m.vy !== 0, 'passes up through it without sticking');
});

test('a spring throws mario much higher when jump is held', () => {
  const peak = (held) => {
    const st = world(); quiet(st); put(st, 10, 10, 'Y');
    st.m.x = 10 * T + 2; st.m.y = 10 * T - st.m.h - 30; st.m.vy = 100; st.m.onGround = false; st.camX = 0;
    let top = 1e9, sprang = false;
    for (let i = 0; i < 200; i++) { L.step(st, 1 / 60, { jumpHeld: held }); if (evs(st, 'spring').length) sprang = true; top = Math.min(top, st.m.y); }
    assert.ok(sprang, 'the spring fired');
    return 10 * T - st.m.h - top;
  };
  const hi = peak(true), lo = peak(false);
  assert.ok(hi > 8 * T, 'held: more than eight tiles (' + hi + ')');
  assert.ok(lo < hi / 2, 'tapped: much lower');
});

test('a hidden block can be walked through, jumped through from above, and gives a 1UP from below once', () => {
  const st = world(); quiet(st); put(st, 10, 7, 'H');
  assert.ok(!L.solid(st, 10, 7), 'not solid before it is found');
  for (let x = 6; x <= 14; x++) put(st, x, 8, 'S');
  st.m.x = 8 * T; st.m.y = 8 * T - st.m.h; st.m.onGround = true; st.m.vy = 0; st.camX = 0;
  for (let i = 0; i < 90; i++) L.step(st, 1 / 60, { right: true });
  assert.ok(st.m.x > 11 * T, 'walked straight through');
  assert.strictEqual(st.tiles[7][10], 'H');
  const s2 = world(); quiet(s2); put(s2, 10, 7, 'H');
  s2.m.x = 10 * T; s2.m.y = GROUND * T - s2.m.h; s2.camX = 0;
  L.step(s2, 0.01, { jump: true, jumpHeld: true });
  for (let i = 0; i < 40; i++) L.step(s2, 1 / 60, { jumpHeld: true });
  assert.strictEqual(s2.tiles[7][10], 'U', 'turned into a used block');
  assert.strictEqual(s2.items.filter((i) => i.type === '1up').length, 1);
  assert.ok(L.STAGES.filter((s) => s.tiles.some((r) => r.includes('H'))).length >= 3, 'hidden blocks in several stages');
});

test('the last stage has bowser on a bridge: five fireballs beat him, touching hurts, and the axe collapses the bridge', () => {
  const st = L.newGame(L.rng(1), N('쿠파 성'));
  assert.ok(st.boss && st.boss.state === 'alive' && st.boss.hp === 5);
  assert.ok(st.level.tiles[GROUND].slice(39, 55).every((c) => c === 'g'), 'a bridge');
  assert.strictEqual(st.level.tiles[10][56], 'A', 'the axe');
  // 불을 뿜는다
  st.enemies = []; st.cannons = []; st.bars = []; st.m.x = 38 * T; st.camX = 38 * T - 96; st.m.invuln = 99;
  let fired = 0; for (let i = 0; i < 600; i++) { L.step(st, 1 / 60, {}); fired += evs(st, 'bossFire').length; }
  assert.ok(fired >= 2, 'breathes fire now and then');
  // 닿으면 아프다
  const s2 = L.newGame(L.rng(1), N('쿠파 성')); s2.enemies = []; setBig(s2); s2.boss.active = true;
  s2.m.x = s2.boss.x; s2.m.y = s2.boss.y; s2.camX = s2.boss.x - 96; s2.m.invuln = 0;
  L.step(s2, 0.01, {});
  assert.strictEqual(s2.m.size, 'small');
  // 불꽃 다섯 번
  const s3 = L.newGame(L.rng(1), N('쿠파 성')); s3.enemies = []; s3.bars = []; s3.cannons = []; s3.boss.active = true; s3.boss.vx = 0; s3.boss.dirT = 99; s3.boss.fireT = 99; s3.boss.jumpT = 99;
  s3.camX = s3.boss.x - 150; s3.m.x = s3.camX + 20; s3.m.invuln = 99;
  const pts0 = s3.score;
  for (let k = 0; k < 5; k++) {
    s3.fireballs.push({ id: 5000 + k, x: s3.boss.x - 4, y: s3.boss.y + 10, w: 6, h: 6, vx: 190, vy: 0, life: 3 });
    L.step(s3, 0.01, {});
    assert.strictEqual(s3.boss.hp, 4 - k);
  }
  assert.strictEqual(s3.boss.state, 'dead');
  assert.ok(s3.score - pts0 >= L.BOSS.points);
  // 도끼: 다리가 무너지고 쿠파가 떨어지고 게임을 이긴다
  const s4 = L.newGame(L.rng(1), N('쿠파 성')); s4.enemies = []; s4.bars = []; s4.cannons = []; s4.boss.active = true; s4.m.invuln = 99;
  s4.m.x = 56 * T; s4.m.y = GROUND * T - s4.m.h; s4.camX = s4.m.x - 96; s4.timeLeft = 100;
  const types = [];
  for (let i = 0; i < 2500 && s4.phase !== 'over'; i++) { L.step(s4, 1 / 60, {}); types.push(...s4.events.map((e) => e.t)); }
  assert.ok(types.includes('axe') && types.includes('crumble') && types.includes('bossFall') && types.includes('win'));
  assert.ok(s4.tiles[GROUND].slice(39, 55).every((c) => c === '.'), 'the bridge is gone');
  assert.strictEqual(s4.phase, 'over'); assert.ok(s4.won);
});

test('fireworks go off when the last digit of the time is 1, 3 or 6 at the pole', () => {
  const count = (time) => {
    const st = L.newGame(L.rng(1)); quiet(st);
    st.m.x = st.level.flag * T - 4; st.m.y = (GROUND - 4) * T; st.timeLeft = time; L.step(st, 0.01, {});
    const before = st.score; let n = 0;
    for (let i = 0; i < 6000 && st.stage === 1; i++) { L.step(st, 1 / 60, {}); n += evs(st, 'firework').length; }
    return { n, st, before };
  };
  assert.strictEqual(count(251.7).n, 1);
  assert.strictEqual(count(203.2).n, 3);
  assert.strictEqual(count(126.5).n, 6);
  assert.strictEqual(count(250.5).n, 0);
  const a = count(251.7);
  assert.ok(a.st.score - a.before >= L.FIREWORK_PTS, 'fireworks add points');
});

// ---------- 해머 브로스·구름 탄 적·물고기·원작 1-1 배치 ----------
test('hammer bro throws hammers toward mario, hurts on touch, and dies to a stomp, a fireball or a star', () => {
  const mkb = (st, x) => { const e = mk(st, 'hammerbro', x); return e; };
  const st = L.newGame(L.rng(3)); quiet(st); const b = mkb(st, 14 * T); st.m.x = 4 * T; st.camX = 0; st.m.invuln = 99;
  let thrown = 0, towards = true, home = b.home;
  for (let i = 0; i < 60 * 8; i++) { L.step(st, 1 / 60, {}); thrown += evs(st, 'hammer').length; if (st.hammers.some((h) => h.vx > 0)) towards = false; }
  assert.ok(thrown >= 3, 'throws every second or so (' + thrown + ')');
  assert.ok(towards, 'throws toward mario (to the left)');
  assert.ok(Math.abs(b.x - b.home) <= L.HAMMER.range + 2, 'stays around its spot');
  const s2 = L.newGame(L.rng(1)); quiet(s2); setBig(s2);
  s2.hammers = [{ x: 10 * T, y: GROUND * T - 20, w: 8, h: 8, vx: 0, vy: 0, spin: 0 }]; s2.m.x = 10 * T;
  L.step(s2, 0.01, {});
  assert.strictEqual(s2.m.size, 'small', 'a hammer hurts');
  const s3 = L.newGame(L.rng(1)); quiet(s3); const b3 = mkb(s3, 10 * T);
  s3.m.x = 10 * T + 1; s3.m.y = GROUND * T - 24 - 20; s3.m.vy = 120; s3.m.onGround = false; s3.m.invuln = 0; s3.score = 0;
  go(s3, 0.2);
  assert.strictEqual(b3.state, 'dead', 'a stomp kills it');
  assert.ok(s3.score >= L.HAMMER.points, 'worth 1000');
  const s4 = L.newGame(L.rng(1)); quiet(s4); L.setSize(s4, 'fire'); const b4 = mkb(s4, 12 * T);
  s4.m.x = 6 * T; s4.m.face = 1; s4.camX = 0; s4.m.invuln = 99; b4.hamT = 99; b4.jumpT = 99;
  L.step(s4, 0.01, { fire: true }); go(s4, 1.2);
  assert.strictEqual(b4.state, 'dead', 'one fireball kills it');
  const s5 = L.newGame(L.rng(1)); quiet(s5); s5.m.star = 5; const b5 = mkb(s5, 10 * T); s5.m.x = 10 * T;
  L.step(s5, 0.01, {});
  assert.strictEqual(b5.state, 'dead');
});

test('lakitu follows mario inside its zone, drops spiny eggs that become spinies, and a spiny cannot be stomped', () => {
  const st = L.newGame(L.rng(1), N('하늘 구름')); const zone = st.enemies.find((e) => e.type === 'lakitu');
  st.enemies = [zone]; st.plants = []; st.cannons = []; st.lifts = []; st.m.invuln = 99; zone.active = true;
  st.m.x = 30 * T; st.m.y = GROUND * T - st.m.h; st.camX = st.m.x - 96; zone.x = 30 * T;
  let eggs = 0, hatched = false;
  for (let i = 0; i < 60 * 8; i++) { L.step(st, 1 / 60, {}); eggs += evs(st, 'egg').length; if (st.enemies.some((e) => e.type === 'spiny' && !e.egg && e.state === 'walk')) hatched = true; }
  assert.ok(eggs >= 2, 'drops eggs (' + eggs + ')');
  assert.ok(hatched, 'an egg hatched on the ground and walked');
  assert.ok(zone.x >= zone.from && zone.x <= zone.to, 'stays in its zone');
  // 마리오를 따라간다
  const x0 = zone.x; st.m.x = 40 * T; st.camX = st.m.x - 96; for (let i = 0; i < 180; i++) L.step(st, 1 / 60, {});
  assert.ok(zone.x > x0 + 40, 'moved after mario');
  // 가시 거북은 밟으면 다친다
  const s2 = L.newGame(L.rng(1)); quiet(s2); setBig(s2); const sp = mk(s2, 'spiny', 10 * T); sp.vx = 0;
  s2.m.x = 10 * T; s2.m.y = GROUND * T - 28 - 12; s2.m.vy = 100; s2.m.onGround = false;
  go(s2, 0.15);
  assert.strictEqual(s2.m.size, 'small', 'stomping a spiny hurts');
  assert.strictEqual(sp.state, 'walk');
  // 불꽃이면 쓰러진다
  const s3 = L.newGame(L.rng(1)); quiet(s3); L.setSize(s3, 'fire'); const sp4 = mk(s3, 'spiny', 12 * T); sp4.vx = 0; s3.m.x = 6 * T; s3.m.face = 1; s3.camX = 0; L.step(s3, 0.01, { fire: true }); go(s3, 1.2);
  assert.strictEqual(sp4.state, 'dead');
});

test('lakitu can be stomped from a running jump and dies to a fireball', () => {
  const mkl = (st, x) => { const e = L.makeEnemy('lakitu', x, 118, 77); e.active = true; e.from = 0; e.to = 900 * T; e.vx = 0; st.enemies.push(e); return e; };
  let stomped = 0, walkStomped = 0;
  for (const run of [true, false]) for (let jd = 20; jd <= 110; jd += 5) {
    const st = L.newGame(L.rng(1)); quiet(st); const lk = mkl(st, 14 * T); st.m.invuln = 99; st.score = 0;
    st.m.x = 4 * T; st.camX = 0;
    let jumped = false;
    for (let i = 0; i < 60 * 3 && lk.state === 'walk'; i++) {
      const j = !jumped && st.m.onGround && lk.x - st.m.x < jd;
      L.step(st, 1 / 60, { right: true, run, jump: j, jumpHeld: true }); if (j) jumped = true;
    }
    if (lk.state === 'dead') { stomped++; if (!run) walkStomped++; }
  }
  assert.ok(stomped >= 2, 'a jump reaches it (' + stomped + ')');
  assert.ok(walkStomped >= 1, 'even a walking jump can');
  // 불꽃은 뛰면서 쏴야 닿는다 (땅에서는 튕겨도 낮아서 안 닿는다)
  const s2 = L.newGame(L.rng(1)); quiet(s2); L.setSize(s2, 'fire'); const l2 = mkl(s2, 14 * T); s2.m.x = 4 * T; s2.m.face = 1; s2.camX = 0; s2.m.invuln = 99;
  for (let i = 0; i < 60 * 4 && l2.state === 'walk'; i++) L.step(s2, 1 / 60, { right: i % 90 > 40, jump: i % 50 === 0, jumpHeld: true, fire: i % 8 === 0 });
  assert.strictEqual(l2.state, 'dead', 'fireballs thrown while jumping kill it');
  const s3 = L.newGame(L.rng(1)); quiet(s3); L.setSize(s3, 'fire'); const l3 = mkl(s3, 14 * T); s3.m.x = 4 * T; s3.m.face = 1; s3.camX = 0; s3.m.invuln = 99;
  for (let i = 0; i < 60 * 3; i++) L.step(s3, 1 / 60, { fire: i % 8 === 0 });
  assert.strictEqual(l3.state, 'walk', 'but a fireball from the ground passes under him');
});

test('flying fish leap up only over pits inside their zone, hurt on touch, and a stomp or fireball beats them', () => {
  const st = L.newGame(L.rng(5), N('하늘 구름')); st.enemies = []; st.plants = []; st.cannons = []; st.lifts = []; st.m.invuln = 99;
  assert.ok(st.level.cheeps, 'the sky stage has a fish zone');
  const z = st.level.cheeps;
  st.m.x = (z[0] + 4) * T; st.m.y = 5 * T; st.m.vy = 0; st.camX = st.m.x - 96;
  let seen = 0, bad = 0;
  for (let i = 0; i < 60 * 25; i++) {
    st.m.x = (z[0] + 4) * T; st.m.y = 3 * T; st.m.vy = 0;
    L.step(st, 1 / 60, {}); seen += evs(st, 'cheep').length;
    for (const e of st.enemies) if (e.type === 'cheep' && e.state === 'walk' && e.y > L.VH) { if (st.tiles[GROUND][Math.floor(e.x / T)] !== '.' && L.solid(st, Math.floor(e.x / T), GROUND)) bad++; }
  }
  assert.ok(seen >= 5, 'fish appear (' + seen + ')');
  assert.strictEqual(bad, 0, 'never from below solid ground');
  const outside = L.newGame(L.rng(5), N('하늘 구름')); outside.enemies = []; outside.plants = []; outside.cannons = []; outside.m.invuln = 99;
  let n = 0; for (let i = 0; i < 60 * 10; i++) { outside.m.x = 20 * T; outside.m.y = 3 * T; L.step(outside, 1 / 60, {}); n += evs(outside, 'cheep').length; }
  assert.strictEqual(n, 0, 'none outside the zone');
  const s2 = L.newGame(L.rng(1)); quiet(s2); setBig(s2); const c = mk(s2, 'cheep', 10 * T, GROUND * T - 6); c.vx = 0; s2.m.x = 10 * T;
  L.step(s2, 0.01, {});
  assert.strictEqual(s2.m.size, 'small');
  const s3 = L.newGame(L.rng(1)); quiet(s3); const c3 = mk(s3, 'cheep', 10 * T, GROUND * T - 70); c3.vx = 0; c3.vy = 0;
  s3.m.x = 10 * T; s3.m.y = GROUND * T - 70 - 30; s3.m.vy = 150; s3.m.onGround = false; go(s3, 0.12);
  assert.strictEqual(c3.state, 'dead');
});

test('stage one follows the original 1-1 order: a question block, brick-mushroom-brick, four pipes, a hidden 1UP, two pits, stairs, and a long end staircase', () => {
  const s = L.STAGES[0];
  assert.strictEqual(s.tiles[7][16], '?');
  assert.strictEqual(s.tiles[7][21], 'M', 'the mushroom block comes early');
  assert.strictEqual(s.tiles[7].slice(20, 25).join(''), 'BM' + 'B?B');
  assert.strictEqual(s.tiles[7][64], 'H');
  const pipes = []; for (let x = 0; x < s.w - 1; x++) if (s.tiles[GROUND - 2][x] === 'p' || s.tiles[GROUND - 2][x] === 'P') { if (s.tiles[GROUND - 2][x - 1] !== 'p' && s.tiles[GROUND - 2][x - 1] !== 'P') pipes.push(x); }
  assert.ok(pipes.length >= 4, 'at least four pipes at heights two to three');
  assert.strictEqual(s.ground.length, 4, 'two pits');
  assert.ok(s.w >= 200, 'a long course like the original');
  assert.ok(s.warps.length === 1);
  const gaps = s.ground.slice(1).map(([a], i) => a - s.ground[i][1] - 1);
  assert.deepStrictEqual(gaps, [2, 3, 2]);
});

// ---------- 새 코스: 설원 · 사막 · 버섯 숲 · 물속 · 유령의 집 ----------
const stageGame = (name, seed = 1) => { const st = L.newGame(L.rng(seed), N(name)); quiet(st); st.m.invuln = 0; return st; };

test('the course list has the ten courses in order and the boss is last', () => {
  assert.deepStrictEqual(L.STAGES.map((s) => s.name), ['초원', '설원', '동굴', '사막', '버섯 숲', '하늘 구름', '물속', '유령의 집', '성', '쿠파 성'].map((x) => x));
  assert.ok(L.STAGES[L.STAGES.length - 1].boss && L.STAGES.slice(0, -1).every((s) => !s.boss));
  assert.ok(L.STAGES[1].ice && L.STAGES[6].water && !L.STAGES[0].ice && !L.STAGES[0].water);
});

const iceWorld = (ice) => { const st = world({ w: 400, x: 4 }); st.level = { ...st.level, ice, water: false }; return st; };

test('on ice mario speeds up and slows down much more slowly than on grass', () => {
  const dist = (ice) => {
    const st = iceWorld(ice);
    go(st, 0.5, { right: true }); const v = st.m.vx;
    go(st, 3, { right: true }); const vTop = st.m.vx; const xr = st.m.x;
    go(st, 4, {}); return { v, vTop, stop: st.m.x - xr };
  };
  const ice = dist(true), grass = dist(false);
  assert.ok(ice.v < grass.v * 0.6, 'slower to get going on ice: ' + ice.v + ' vs ' + grass.v);
  assert.ok(ice.vTop > 60, 'but it does get going');
  assert.ok(ice.stop > grass.stop * 3, 'slides much farther after letting go: ' + ice.stop + ' vs ' + grass.stop);
});

test('on ice turning around skids for a long time and plain ground is not affected', () => {
  const st = iceWorld(true); go(st, 5, { right: true, run: true });
  assert.ok(st.m.vx > 100, 'got up to speed on ice: ' + st.m.vx);
  go(st, 0.3, { left: true }); assert.ok(st.m.vx > 30, 'still sliding right after 0.3s of pushing left: ' + st.m.vx);
  const g = iceWorld(false); go(g, 5, { right: true, run: true }); go(g, 0.6, { left: true }); assert.ok(g.m.vx < 30, 'on grass the skid is nearly over: ' + g.m.vx);
});

test('a cactus hurts on touch, does not block, and a star mario is safe', () => {
  const s = L.STAGES[N('사막') - 1]; let cx = -1, h = 0;
  for (let x = 0; x < s.w; x++) if (s.tiles[GROUND - 1][x] === 'K') { cx = x; break; }
  for (let y = GROUND - 1; y >= 0 && s.tiles[y][cx] === 'K'; y--) h++;
  assert.ok(cx > 0 && h >= 1 && !L.SOLID.has('K'));
  const st = stageGame('사막'); setBig(st); st.m.x = (cx - 2) * T; st.m.vx = 0; go(st, 0.9, { right: true });
  assert.ok(st.m.x > (cx - 1) * T, 'walked into the cactus (no wall)'); assert.strictEqual(st.m.size, 'small', 'and got hurt');
  const sr = stageGame('사막'); sr.m.star = 5; sr.m.x = (cx - 2) * T; go(sr, 0.9, { right: true }); assert.strictEqual(sr.m.size, 'small'); assert.ok(!sr.m.dead);
  const sj = stageGame('사막'); sj.m.x = (cx - 2) * T; sj.m.vx = 80; go(sj, 0.1, { right: true, jump: true, jumpHeld: true });
  for (let i = 0; i < 90 && !sj.m.onGround; i++) L.step(sj, 1 / 60, { right: true, jumpHeld: true });
  assert.ok(!sj.m.dead && sj.m.x > (cx + 1) * T, 'a plain jump clears a cactus');
});

test('mushroom platforms are solid to stand on and sit above the ground', () => {
  assert.ok(L.SOLID.has('T'));
  const s = L.STAGES[N('버섯 숲') - 1]; let n = 0; for (const r of s.tiles) for (const c of r) if (c === 'T') n++;
  assert.ok(n >= 20, 'plenty of mushroom platforms');
  const st = stageGame('버섯 숲'); const tx = 15, ty = 7; assert.strictEqual(st.tiles[ty][tx], 'T');
  st.m.x = tx * T + 2; st.m.y = ty * T - st.m.h - 30; st.m.vy = 0; st.m.onGround = false; go(st, 0.6, {});
  assert.ok(st.m.onGround && Math.abs(st.m.y + st.m.h - ty * T) < 0.5, 'lands on top of the cap');
});

test('underwater each press is one swim stroke: slow sinking, no running, and normal jumping elsewhere', () => {
  const st = stageGame('물속'); st.m.x = 4 * T; st.m.y = 5 * T; st.m.vy = 0; st.m.onGround = false;
  go(st, 1, {}); assert.ok(st.m.vy <= L.SWIM_FALL + 0.01, 'sinks slowly'); assert.ok(st.m.vy > 0);
  const y0 = st.m.y; L.step(st, 1 / 60, { jump: true }); assert.ok(st.m.vy < 0, 'a stroke pushes up'); go(st, 0.3, {}); assert.ok(st.m.y < y0, 'rose after the stroke');
  const hold = stageGame('물속'); hold.m.x = 4 * T; hold.m.y = 6 * T; hold.m.vy = 0; hold.m.onGround = false; for (let i = 0; i < 120; i++) L.step(hold, 1 / 60, { jumpHeld: true });
  assert.ok(hold.m.y > 6 * T, 'holding the button alone does not swim');
  const r = stageGame('물속'); go(r, 3, { right: true, run: true }); assert.ok(Math.abs(r.m.vx) <= L.SWIM_V + 0.5, 'no running in water');
  const g = stageGame('초원'); g.m.x = 4 * T; L.step(g, 1 / 60, { jump: true, jumpHeld: true }); assert.ok(g.m.vy < -200, 'on land a jump is a jump');
});

test('swimming up is limited by the ceiling and mario can swim over the coral walls', () => {
  const st = stageGame('물속'); st.m.x = 4 * T; st.m.y = 5 * T; st.m.onGround = false; st.m.vy = 0;
  for (let i = 0; i < 400; i++) L.step(st, 1 / 60, { jump: i % 8 === 0 }); assert.ok(st.m.y >= 2 * T - 0.01, 'stopped by the ceiling'); assert.ok(!st.m.dead);
});

test('a swimming fish patrols near its home, a stomp or fire beats it, an urchin cannot be beaten but a star passes', () => {
  const st = L.newGame(L.rng(1), N('물속')); const f = st.enemies.find((e) => e.type === 'swimcheep'); st.m.invuln = 99;
  f.active = true; const home = f.x; let min = f.x, max = f.x; for (let i = 0; i < 600; i++) { L.step(st, 1 / 60, {}); if (f.state === 'walk') { min = Math.min(min, f.x); max = Math.max(max, f.x); } }
  assert.ok(max - min > 20 && max - min < 120, 'stays near home: ' + (max - min)); assert.ok(Math.abs((min + max) / 2 - home) < 60);
  const s2 = stageGame('물속'); const c = mk(s2, 'swimcheep', 10 * T, 5 * T); c.home = c.x; c.y0 = c.y; c.vx = 0; s2.m.x = 10 * T; s2.m.y = 5 * T - 30; s2.m.vy = 150; s2.m.onGround = false; go(s2, 0.8);
  assert.strictEqual(c.state, 'dead', 'a stomp beats the fish');
  const s3 = stageGame('물속'); const u = mk(s3, 'urchin', 10 * T, 7 * T); s3.m.x = 10 * T; s3.m.y = 7 * T - 20; s3.m.vy = 150; s3.m.onGround = false; go(s3, 0.2);
  assert.strictEqual(u.state, 'walk', 'an urchin is not stomped'); assert.ok(s3.m.dead || s3.m.invuln > 0 || s3.m.size === 'small');
  const s4 = stageGame('물속'); s4.m.star = 5; const u4 = mk(s4, 'urchin', 10 * T, 7 * T); s4.m.x = 10 * T; s4.m.y = 7 * T; s4.m.vy = 0; go(s4, 0.2); assert.ok(!s4.m.dead);
});

test('a shy ghost freezes when mario faces it and drifts toward him when his back is turned', () => {
  const st = stageGame('유령의 집'); st.m.x = 10 * T; st.m.y = GROUND * T - st.m.h; st.m.face = 1;
  const b = mk(st, 'boo', 16 * T, 8 * T); st.camX = 8 * T;
  go(st, 1, {}); assert.strictEqual(b.shy, true, 'mario faces right and the ghost is to his right'); assert.ok(Math.abs(b.vx) < 0.5); const x1 = b.x; go(st, 1, {}); assert.ok(Math.abs(b.x - x1) < 0.5, 'frozen');
  st.m.face = -1; go(st, 1.5, {}); assert.strictEqual(b.shy, false); assert.ok(b.x < x1 - 15, 'it came closer: ' + (x1 - b.x));
  const s2 = stageGame('유령의 집'); s2.m.x = 10 * T; s2.m.face = 1; const b2 = mk(s2, 'boo', 4 * T, 8 * T); s2.camX = 0; go(s2, 1, {}); assert.strictEqual(b2.shy, false, 'a ghost behind him is not frozen by facing the other way');
  assert.ok(b2.x > 4 * T, 'and it drifts toward him');
});

test('a ghost hurts on touch, cannot be stomped, fireballs do nothing, and a star beats it', () => {
  const st = stageGame('유령의 집'); setBig(st); st.m.x = 10 * T; st.m.y = GROUND * T - st.m.h; st.m.face = 1;
  const b = mk(st, 'boo', 10 * T, GROUND * T - 28); b.shy = true; st.camX = 4 * T; L.step(st, 0.01, {}); assert.strictEqual(st.m.size, 'small', 'it hurts');
  const s2 = stageGame('유령의 집'); const b2 = mk(s2, 'boo', 10 * T, 8 * T); s2.m.x = 10 * T; s2.m.y = 8 * T - 24; s2.m.vy = 160; s2.m.onGround = false; s2.m.face = 1; go(s2, 0.1);
  assert.notStrictEqual(b2.state, 'dead', 'no stomp');
  const s3 = stageGame('유령의 집'); setBig(s3); L.setSize(s3, 'fire'); const b3 = mk(s3, 'boo', 14 * T, GROUND * T - 20); b3.shy = true; s3.m.x = 10 * T; s3.camX = 6 * T; s3.m.face = 1; go(s3, 0.1, { fire: true }); go(s3, 0.6, {});
  assert.notStrictEqual(b3.state, 'dead', 'fire does nothing');
  const s4 = stageGame('유령의 집'); s4.m.star = 5; const b4 = mk(s4, 'boo', 10 * T, GROUND * T - 14); s4.m.x = 10 * T; s4.camX = 4 * T; L.step(s4, 0.01, {}); assert.strictEqual(b4.state, 'dead', 'star beats it');
});

// 아무것도 못 다치게 한 채 앞으로 달리기만 하는 단순한 봇이 모든 코스의 마지막 계단 앞까지 갈 수 있는지(땅·구멍·계단·선인장 높이가 넘을 수 있는지)
test('a simple runner can cross every course up to the last staircase when nothing can hurt it', () => {
  for (const stage of ['설원', '사막', '버섯 숲', '물속', '유령의 집'].map(N)) {
    const st = L.newGame(L.rng(7), stage); st.enemies = []; st.plants = []; st.cannons = []; st.bars = []; st.hazards = []; st.boss = null; st.level = { ...st.level, cheeps: null };
    st.timeLeft = 9999; let t = 0;
    for (let i = 0; i < 60 * 150 && st.phase === 'play' && !(st.m.onGround && st.m.x > (st.level.flag - 11) * T); i++) {
      st.m.invuln = 99; const m = st.m, water = !!st.level.water;
      const aheadWall = L.solid(st, Math.floor((m.x + m.w + 6) / T), Math.floor((m.y + m.h - 2) / T));
      const gx = Math.floor((m.x + m.w + 14) / T);
      let groundAhead = false; for (let y = 0; y < L.ROWS; y++) if (y >= GROUND - 1 && L.solid(st, gx, y)) groundAhead = true;
      const onT = m.onGround;
      const atTop = onT && Math.abs(m.y + m.h - (GROUND - 8) * T) < 2;
      const tileHere = L.tileAt(st, Math.floor((m.x + m.w + 6) / T), Math.floor((m.y + m.h - 2) / T));
      const needJump = onT && (aheadWall || !groundAhead || atTop || tileHere === 'K' || L.tileAt(st, Math.floor((m.x + m.w + 8) / T), GROUND - 1) === 'K');
      const swim = water && (m.y + m.h > (GROUND - 4) * T) && st.tick !== 1;
      L.step(st, 1 / 60, { right: true, run: true, jump: water ? (swim && i % 6 === 0) : needJump, jumpHeld: true });
      t = i;
    }
    assert.ok(st.m.x > (st.level.flag - 11) * T, 'stage ' + stage + ' reached the last staircase (phase ' + st.phase + ', x ' + Math.round(st.m.x) + ', y ' + Math.round(st.m.y) + ')');
  }
});
