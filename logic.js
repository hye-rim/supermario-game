'use strict';
// 슈퍼마리오 풍 달리기 게임 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
// 좌표는 픽셀(한 칸 = 16), 위쪽이 y=0. 캐릭터와 적은 (x, y) 가 왼쪽 위 모서리다.
const LOGIC_SM = (() => {
  const LV = (typeof module !== 'undefined' && module.exports) ? require('./levels.js') : LEVELS_SM;
  const { T, ROWS, GROUND, STAGES } = LV;
  const VW = 240, VH = ROWS * T;                      // 화면에 보이는 크기 240 x 208
  const SOLID = new Set(['#', 'B', '?', 'M', 'U', 'S', 'P', 'p']);
  const GRAV = 1000, GRAV_HOLD = 560, GRAV_CUT = 1700, MAXFALL = 380;      // 점프 버튼을 누르고 있으면 더 높이 뜬다
  const JUMP_V = 280, WALK = 88, RUN = 135, ACC = 520, FRIC = 620, AIR_ACC = 360;
  const SIZE = { small: { w: 12, h: 14 }, big: { w: 12, h: 28 }, fire: { w: 12, h: 28 } };
  const START_LIVES = 3, DYING = 2, CLEAR_TIME = 3.2, INVULN = 2;
  const POINTS = { coin: 200, brick: 50, stomp: [100, 200, 400, 800, 1000], shell: 500, kill: 200, mushroom: 1000, flag: [100, 200, 400, 800, 2000, 4000, 5000], timePerSec: 50 };
  const EXTRA_LIFE_COINS = 100, EXTRA_LIFE_AT = 100000;
  const ENEMY = { goomba: { w: 12, h: 12, speed: 26 }, koopa: { w: 12, h: 16, speed: 24 } };
  const SHELL_SPEED = 200;

  const rng = (seed) => {                             // mulberry32 (시험용 고정 난수)
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };

  function newGame(rand = Math.random, stage = 1, opts = {}) {
    const st = { rand, score: 0, coins: 0, lives: opts.lives || START_LIVES, extra: 0, stage, time: 0, events: [], phase: 'play', tutorial: !!opts.tutorial, won: false, stats: { stomps: 0, bricks: 0, coinsTotal: 0 } };
    startStage(st, stage);
    return st;
  }
  function startStage(st, stage) {
    st.stage = stage;
    const lv = STAGES[stage - 1];
    st.level = lv; st.w = lv.w;
    st.tiles = lv.tiles.map((r) => r.slice());
    st.timeLeft = st.tutorial ? 9999 : lv.time;
    st.camX = 0;
    st.enemies = lv.spawns.map((s, i) => makeEnemy(s.type, s.x * T + 2, GROUND * T - ENEMY[s.type].h, i));
    st.items = []; st.fireballs = []; st.seq = 1000;
    st.m = makeMario(st, lv.start * T, 'small');
    st.stompChain = 0;
    st.phase = 'play';
    emit(st, { t: 'stage', stage });
  }
  function makeMario(st, x, size) {
    const sz = SIZE[size];
    return { x, y: GROUND * T - sz.h, w: sz.w, h: sz.h, vx: 0, vy: 0, size, face: 1, onGround: true, coyote: 0, invuln: 1, jumpHeld: false, running: false, fireCool: 0, moved: false, dead: false };
  }
  function makeEnemy(type, x, y, id) {
    const d = ENEMY[type];
    return { id, type, x, y, w: d.w, h: d.h, vx: -d.speed, vy: 0, state: 'walk', active: false, timer: 0, grace: 0 };
  }

  // ---------- 타일 ----------
  const tileAt = (st, tx, ty) => (ty < 0 || ty >= ROWS ? '.' : tx < 0 || tx >= st.w ? '.' : st.tiles[ty][tx]);
  function solid(st, tx, ty) {
    if (tx < 0 || tx >= st.w) return true;            // 왼쪽·오른쪽 끝은 벽
    if (ty < 0 || ty >= ROWS) return false;
    return SOLID.has(st.tiles[ty][tx]);
  }
  function moveX(st, e, dx) {
    if (!dx) return 0;
    e.x += dx;
    const t0 = Math.floor(e.y / T), t1 = Math.floor((e.y + e.h - 0.001) / T);
    const tx = dx > 0 ? Math.floor((e.x + e.w - 0.001) / T) : Math.floor(e.x / T);
    for (let ty = t0; ty <= t1; ty++) if (solid(st, tx, ty)) { e.x = dx > 0 ? tx * T - e.w : (tx + 1) * T; return dx > 0 ? 1 : -1; }
    return 0;
  }
  // 세로로 움직인다: 땅에 닿으면 {dir:1}, 머리를 부딪치면 {dir:-1, tx, ty}
  function moveY(st, e, dy) {
    if (!dy) return null;
    e.y += dy;
    const l = Math.floor(e.x / T), r = Math.floor((e.x + e.w - 0.001) / T);
    const ty = dy > 0 ? Math.floor((e.y + e.h - 0.001) / T) : Math.floor(e.y / T);
    let hit = null;
    for (let tx = l; tx <= r; tx++) if (solid(st, tx, ty)) { const c = Math.abs((tx + 0.5) * T - (e.x + e.w / 2)); if (!hit || c < hit.c) hit = { tx, c }; }
    if (!hit) return null;
    if (dy > 0) { e.y = ty * T - e.h; return { dir: 1 }; }
    e.y = (ty + 1) * T; return { dir: -1, tx: hit.tx, ty };
  }

  // ---------- 블록 ----------
  function hitBlock(st, tx, ty) {
    const m = st.m, ch = st.tiles[ty][tx];
    if (ch === '?') { st.tiles[ty][tx] = 'U'; addCoin(st, true); emit(st, { t: 'block', ch, tx, ty }); }
    else if (ch === 'M') {
      st.tiles[ty][tx] = 'U';
      st.items.push({ id: ++st.seq, type: m.size === 'small' ? 'mushroom' : 'flower', x: tx * T + 2, y: ty * T - 12, w: 12, h: 12, vx: 0, vy: 0, rise: ty * T - 16 - 0, emerge: 0, ty });
      emit(st, { t: 'block', ch, tx, ty }); emit(st, { t: 'powerup', tx, ty });
    } else if (ch === 'B') {
      if (m.size !== 'small') { st.tiles[ty][tx] = '.'; st.score += POINTS.brick; st.stats.bricks++; emit(st, { t: 'brick', tx, ty }); emit(st, { t: 'block', ch, tx, ty }); }
      else emit(st, { t: 'block', ch, tx, ty, bump: true });
    } else return;
    // 블록 위에 서 있던 적은 뒤집힌다
    for (const e of st.enemies) if (e.state !== 'dead' && e.active && Math.abs(e.y + e.h - ty * T) < 3 && e.x + e.w > tx * T && e.x < (tx + 1) * T) { e.state = 'dead'; e.vy = -150; e.vx = 0; e.timer = 2; st.score += POINTS.kill; emit(st, { t: 'kill', x: e.x, y: e.y, pts: POINTS.kill }); }
  }
  function addCoin(st, fromBlock) {
    st.coins++; st.stats.coinsTotal++; st.score += POINTS.coin;
    emit(st, { t: 'coin', block: !!fromBlock });
    if (st.coins >= EXTRA_LIFE_COINS) { st.coins -= EXTRA_LIFE_COINS; st.lives++; emit(st, { t: 'extra' }); }
  }
  function addScore(st, n) {
    st.score += n;
    const need = () => EXTRA_LIFE_AT * (st.extra + 1);
    while (st.score >= need()) { st.extra++; st.lives++; emit(st, { t: 'extra' }); }
  }

  // ---------- 마리오 ----------
  function setSize(st, size) {
    const m = st.m, old = m.h, sz = SIZE[size];
    m.size = size; m.w = sz.w; m.h = sz.h; m.y += old - sz.h;
    if (m.y < -40) m.y = -40;
  }
  function die(st, why) {
    const m = st.m;
    if (m.dead || st.phase !== 'play') return;
    m.dead = true; m.vy = -260; m.vx = 0; st.lives--;
    st.phase = 'dying'; st.dyingT = DYING;
    emit(st, { t: 'dead', why });
  }
  function hurt(st) {
    const m = st.m;
    if (m.invuln > 0 || m.dead) return;
    if (m.size === 'small') return die(st, 'enemy');
    setSize(st, 'small'); m.invuln = INVULN;
    emit(st, { t: 'shrink' });
  }

  function stepMario(st, h, input) {
    const m = st.m;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    m.running = !!input.run;
    const maxV = m.running ? RUN : WALK;
    if (dir) {
      m.face = dir;
      const acc = m.onGround ? ACC : AIR_ACC;
      // 반대쪽으로 달리다 방향을 바꾸면 더 빨리 멈춘다
      const a = (m.vx * dir < 0 ? acc + FRIC : acc) * h;
      m.vx += dir * a;
      if (Math.abs(m.vx) > maxV) m.vx = Math.sign(m.vx) * Math.max(maxV, Math.abs(m.vx) - FRIC * h);
      if (!m.moved) { m.moved = true; emit(st, { t: 'move' }); }
    } else {
      const f = (m.onGround ? FRIC : 60) * h;
      m.vx = Math.abs(m.vx) <= f ? 0 : m.vx - Math.sign(m.vx) * f;
    }
    // 점프
    m.coyote = m.onGround ? 0.08 : Math.max(0, m.coyote - h);
    m.jumpHeld = !!input.jumpHeld || !!input.jump;
    if (input.jump && (m.onGround || m.coyote > 0)) {
      m.vy = -(JUMP_V + Math.abs(m.vx) * 0.06); m.onGround = false; m.coyote = 0;
      emit(st, { t: 'jump', big: m.size !== 'small' });
    }
    const g = m.vy < 0 ? (m.jumpHeld ? GRAV_HOLD : GRAV_CUT) : GRAV;
    m.vy = Math.min(MAXFALL, m.vy + g * h);
    if (m.fireCool > 0) m.fireCool -= h;
    if (input.fire && m.size === 'fire' && m.fireCool <= 0 && st.fireballs.length < 2) {
      st.fireballs.push({ id: ++st.seq, x: m.x + (m.face > 0 ? m.w : -6), y: m.y + 10, w: 6, h: 6, vx: m.face * 190, vy: 40, life: 3 });
      m.fireCool = 0.2; emit(st, { t: 'fire' });
    }
    // 움직이기
    const hitX = moveX(st, m, m.vx * h);
    if (hitX) m.vx = 0;
    if (m.x < st.camX) { m.x = st.camX; if (m.vx < 0) m.vx = 0; }
    const wasGround = m.onGround;
    const hy = moveY(st, m, m.vy * h);
    m.onGround = false;
    if (hy) {
      if (hy.dir > 0) { m.onGround = true; m.vy = 0; if (!wasGround) { emit(st, { t: 'land' }); } st.stompChain = 0; }
      else { m.vy = 60; hitBlock(st, hy.tx, hy.ty); }
    }
    if (m.invuln > 0) m.invuln = Math.max(0, m.invuln - h);
    if (m.y > VH + 40) die(st, 'pit');
  }

  // ---------- 적 ----------
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  function stepEnemy(st, e, h) {
    if (e.state === 'dead') { e.vy = Math.min(MAXFALL, e.vy + GRAV * h); e.y += e.vy * h; e.timer -= h; return; }
    if (e.state === 'flat') { e.timer -= h; return; }
    if (e.grace > 0) e.grace -= h;
    const moving = e.state === 'walk' || e.state === 'shellMove';
    if (e.state === 'shell') e.vx = 0;
    e.vy = Math.min(MAXFALL, e.vy + GRAV * h);
    if (moving || e.state === 'shell') {
      const hit = moveX(st, e, e.vx * h);
      if (hit) { e.vx = -e.vx; if (e.type === 'koopa' && e.state === 'walk') e.face = Math.sign(e.vx); }
    }
    const hy = moveY(st, e, e.vy * h);
    if (hy && hy.dir > 0) e.vy = 0;
    if (e.y > VH + 60) { e.state = 'gone'; }
  }
  function killEnemy(st, e, pts, by) {
    e.state = 'dead'; e.vy = -150; e.vx = 0; e.timer = 2;
    addScore(st, pts); emit(st, { t: 'kill', x: e.x, y: e.y, pts, by });
  }
  function stepEnemies(st, h) {
    const m = st.m;
    for (const e of st.enemies) {
      if (!e.active) { if (e.x < st.camX + VW + 24) e.active = true; else continue; }
      stepEnemy(st, e, h);
    }
    // 움직이는 등껍질은 다른 적을 쓰러뜨린다
    for (const s of st.enemies) {
      if (s.state !== 'shellMove') continue;
      for (const e of st.enemies) if (e !== s && e.state !== 'dead' && e.state !== 'gone' && e.active && overlap(s, e)) killEnemy(st, e, POINTS.shell, 'shell');
    }
    // 마리오와 적
    if (m.dead) return;
    for (const e of st.enemies) {
      if (!e.active || e.state === 'dead' || e.state === 'flat' || e.state === 'gone') continue;
      if (!overlap(m, e)) continue;
      const stomp = m.vy > 0 && m.y + m.h - e.y <= 9 + m.vy * h;
      if (e.state === 'shell') {                                        // 가만히 있는 등껍질: 밟거나 닿으면 찬다
        e.state = 'shellMove'; e.vx = (m.x + m.w / 2 < e.x + e.w / 2 ? 1 : -1) * SHELL_SPEED; e.grace = 0.3;
        if (stomp) { m.vy = -190; addScore(st, POINTS.shell / 5); }
        emit(st, { t: 'kick' });
        continue;
      }
      if (stomp) {
        const pts = POINTS.stomp[Math.min(st.stompChain, POINTS.stomp.length - 1)];
        st.stompChain++; st.stats.stomps++; addScore(st, pts);
        m.vy = -(input_hold(st) ? 230 : 160);
        if (e.type === 'goomba') { e.state = 'flat'; e.timer = 0.4; e.vx = 0; }
        else if (e.state === 'shellMove') { e.state = 'shell'; e.vx = 0; }
        else { e.state = 'shell'; e.h = 12; e.y += 4; e.vx = 0; }
        emit(st, { t: 'stomp', x: e.x, y: e.y, pts, type: e.type });
      } else if (e.state === 'shellMove' && e.grace > 0) { /* 막 찬 등껍질은 안전 */ }
      else hurt(st);
    }
    st.enemies = st.enemies.filter((e) => e.state !== 'gone' && !(e.state === 'dead' && e.timer <= 0) && !(e.state === 'flat' && e.timer <= 0) && e.x > st.camX - 96);
  }
  const input_hold = (st) => !!st.m.jumpHeld;

  // ---------- 아이템·불꽃 ----------
  function stepItems(st, h) {
    const m = st.m;
    for (const it of st.items) {
      if (it.emerge < 1) { it.emerge = Math.min(1, it.emerge + h * 2.2); it.y = (it.ty * T - 12) - it.emerge * 14 + 0; if (it.emerge >= 1) { it.vx = it.type === 'mushroom' ? 44 : 0; } continue; }
      if (it.type === 'mushroom') {
        it.vy = Math.min(MAXFALL, it.vy + GRAV * h);
        if (moveX(st, it, it.vx * h)) it.vx = -it.vx;
        const hy = moveY(st, it, it.vy * h); if (hy && hy.dir > 0) it.vy = 0;
        if (it.y > VH + 40) it.gone = true;
      }
      if (!m.dead && overlap(m, it)) {
        it.gone = true; addScore(st, POINTS.mushroom);
        if (it.type === 'mushroom') { if (m.size === 'small') setSize(st, 'big'); }
        else if (m.size !== 'fire') setSize(st, 'fire');
        emit(st, { t: 'power', type: it.type });
      }
    }
    st.items = st.items.filter((it) => !it.gone);
    for (const f of st.fireballs) {
      f.life -= h; f.vy = Math.min(MAXFALL, f.vy + 700 * h);
      if (moveX(st, f, f.vx * h)) f.life = 0;
      const hy = moveY(st, f, f.vy * h);
      if (hy && hy.dir > 0) f.vy = -150;
      else if (hy) f.life = 0;
      for (const e of st.enemies) if (e.active && e.state !== 'dead' && e.state !== 'gone' && e.state !== 'flat' && overlap(f, e)) { killEnemy(st, e, POINTS.kill, 'fire'); f.life = 0; break; }
      if (f.y > VH + 20) f.life = 0;
    }
    st.fireballs = st.fireballs.filter((f) => f.life > 0 && f.x > st.camX - 20 && f.x < st.camX + VW + 20);
  }

  // ---------- 동전과 깃대 ----------
  function stepTilesTouch(st) {
    const m = st.m;
    const l = Math.floor(m.x / T), r = Math.floor((m.x + m.w - 0.001) / T), t = Math.floor(m.y / T), b = Math.floor((m.y + m.h - 0.001) / T);
    for (let ty = Math.max(0, t); ty <= Math.min(ROWS - 1, b); ty++) for (let tx = l; tx <= r; tx++) {
      const ch = tileAt(st, tx, ty);
      if (ch === 'C') { st.tiles[ty][tx] = '.'; addCoin(st, false); }
      else if ((ch === 'F' || ch === 'f') && st.phase === 'play') return reachFlag(st);
    }
  }
  function reachFlag(st) {
    const m = st.m;
    const frac = Math.max(0, Math.min(1, (GROUND * T - (m.y + m.h)) / (8 * T)));
    const pts = POINTS.flag[Math.round(frac * (POINTS.flag.length - 1))];
    const bonus = st.tutorial ? 0 : Math.floor(st.timeLeft) * POINTS.timePerSec;
    addScore(st, pts + bonus);
    st.timeLeft = st.tutorial ? st.timeLeft : 0;
    st.phase = 'clear'; st.clearT = CLEAR_TIME; st.flagPts = pts; st.bonus = bonus;
    st.m.vx = 0; st.m.vy = 0;
    emit(st, { t: 'flag', pts, bonus });
    if (st.stage >= STAGES.length) { st.won = true; emit(st, { t: 'win' }); }
    emit(st, { t: 'clear', stage: st.stage });
  }

  // ---------- 한 걸음 ----------
  function step(st, dt, input = {}) {
    const h = Math.min(dt, 0.033);
    st.events = [];
    if (st.phase === 'over') return;
    st.time += h;
    const m = st.m;
    if (st.phase === 'dying') {
      st.dyingT -= h;
      m.vy = Math.min(MAXFALL, m.vy + GRAV * h); m.y += m.vy * h;
      if (st.dyingT <= 0) {
        if (st.lives <= 0) { st.phase = 'over'; emit(st, { t: 'over' }); }
        else { startStage(st, st.stage); emit(st, { t: 'respawn' }); }
      }
      return;
    }
    if (st.phase === 'clear') {
      st.clearT -= h;
      m.vy = Math.min(MAXFALL, m.vy + GRAV * h); moveY(st, m, m.vy * h);
      if (st.clearT <= 0) {
        if (st.won) { st.phase = 'over'; emit(st, { t: 'over', won: true }); }
        else startStage(st, st.stage + 1);
      }
      return;
    }
    st.timeLeft -= h;
    if (st.timeLeft <= 0) { st.timeLeft = 0; return die(st, 'time'); }
    stepMario(st, h, input);
    if (st.phase !== 'play') return;
    st.camX = Math.max(st.camX, Math.min(st.w * T - VW, m.x - 96));
    stepEnemies(st, h);
    stepItems(st, h);
    if (st.phase === 'play') stepTilesTouch(st);
  }

  return {
    T, ROWS, GROUND, VW, VH, STAGES, SOLID, GRAV, GRAV_HOLD, GRAV_CUT, JUMP_V, WALK, RUN, SIZE, START_LIVES, DYING, CLEAR_TIME, INVULN, POINTS, ENEMY, SHELL_SPEED, EXTRA_LIFE_COINS, EXTRA_LIFE_AT,
    rng, newGame, startStage, step, tileAt, solid, hitBlock, hurt, die, setSize, addScore, makeEnemy, overlap,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_SM;
