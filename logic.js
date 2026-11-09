'use strict';
// 슈퍼마리오 풍 달리기 게임 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
// 좌표는 픽셀(한 칸 = 16), 위쪽이 y=0. 캐릭터와 적은 (x, y) 가 왼쪽 위 모서리다.
// 움직임 값은 원작 슈퍼마리오의 알려진 값(프레임당 픽셀 x 60)을 바탕으로 했다.
const LOGIC_SM = (() => {
  const LV = (typeof module !== 'undefined' && module.exports) ? require('./levels.js') : LEVELS_SM;
  const { T, ROWS, GROUND, STAGES, ROOM } = LV;
  const VW = 240, VH = ROWS * T;                      // 화면에 보이는 크기 240 x 208
  const SOLID = new Set(['#', 'B', '?', 'M', '*', '1', '$', 'U', 'S', 'P', 'p', 'N', 'Y', 'g']);   // H(숨은 블록)·A(도끼)는 지나갈 수 있다
  // --- 달리기·점프 (원작: 걷기 1.56px/f, 달리기 2.56px/f, 가속 0.037/0.056, 브레이크 0.05, 미끄러짐 0.10) ---
  const WALK = 93.75, RUN = 153.75, ACC_WALK = 133, ACC_RUN = 200, DECEL = 183, SKID = 366;
  const JUMP_SLOW = 240, JUMP_FAST = 300, G_HOLD_SLOW = 400, G_HOLD_FAST = 510, G_FALL = 1575, MAXFALL = 240;   // 점프 버튼을 누르고 있으면 올라가는 동안 중력이 약하다
  const SIZE = { small: { w: 12, h: 14 }, big: { w: 12, h: 28 }, fire: { w: 12, h: 28 } };
  const START_LIVES = 3, DYING = 2, INVULN = 2, STAR_TIME = 10;
  const CROUCH_H = 16, WARP_TIME = 0.7;                 // 앉은 키 · 파이프로 들어가고 나오는 데 걸리는 시간
  const TIME_RATE = 2.5, HURRY_AT = 100, COUNT_RATE = 100;   // 제한 시간은 '게임 단위': 실제 0.4초에 1 줄어든다 (원작처럼). 남은 시간은 1 당 50점
  const STOMP_CHAIN = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];      // 그 다음은 1UP
  const SHELL_CHAIN = [500, 800, 1000, 2000, 4000, 5000, 8000];
  const POINTS = { coin: 200, brick: 50, stomp: STOMP_CHAIN, shell: SHELL_CHAIN, kick: 400, kill: 200, mushroom: 1000, star: 1000, plant: 200, flag: [100, 400, 800, 2000, 5000], timePerUnit: 50 };
  const EXTRA_LIFE_COINS = 100, EXTRA_LIFE_AT = 100000;
  const ENEMY = {
    goomba: { w: 12, h: 12, speed: 30 }, koopa: { w: 12, h: 16, speed: 30 },
    redkoopa: { w: 12, h: 16, speed: 30, ledge: true },                       // 낭떠러지 끝에서 돌아선다
    buzzy: { w: 12, h: 12, speed: 30, fireproof: true },                      // 불꽃이 안 통한다
    bullet: { w: 14, h: 12, speed: 70, fly: true, fireproof: true },          // 대포알: 날아간다
    podoboo: { w: 12, h: 12, speed: 0, fly: true, fireproof: true, immortal: true, nostomp: true },   // 용암 불꽃: 무엇으로도 못 잡는다
  };
  const BOSS = { w: 24, h: 28, hp: 5, speed: 28, points: 5000 };
  const CANNON_EVERY = 3.2, BAR_STEP = 7, SPRING_HOLD = 430, SPRING_TAP = 290;
  const FIREWORK_DIGITS = { 1: 1, 3: 3, 6: 6 }, FIREWORK_PTS = 500, FIREWORK_GAP = 0.55;
  const SHELL_SPEED = 200, SHELL_REVIVE = 5;
  const COIN_BLOCK_MAX = 10, COIN_BLOCK_TIME = 4;
  const PLANT = { w: 12, h: 16, down: 2, rise: 0.5, up: 1.5, sink: 0.5, near: 28 };   // 식물: 쉬고 · 올라오고 · 머물고 · 내려간다. 마리오가 파이프 옆 28픽셀 안이면 안 나온다
  const FLAG = { slide: 110, hang: 0.4, walk: 70, castle: 4, wait: 0.8 };

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
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
    st.hurried = false;
    st.camX = 0;
    st.enemies = lv.spawns.map((s, i) => makeEnemy(s.type, s.x * T + 2, s.type === 'podoboo' ? VH + 10 : GROUND * T - ENEMY[s.type].h, i));
    st.cannons = lv.cannons.map((c, i) => ({ x: c.x, y: c.y, t: 1.5 + i * 0.8 }));
    st.bars = lv.bars.map((b) => ({ ...b }));
    st.lifts = lv.lifts.map((l) => ({ x: l.x, y: l.y, w: l.w, h: 6, x0: l.x, y0: l.y, axis: l.axis, range: l.range, speed: l.speed, p: 0, dx: 0, dy: 0 }));
    st.hazards = [];
    st.boss = lv.boss ? { x: lv.boss.x * T, y: GROUND * T - BOSS.h, w: BOSS.w, h: BOSS.h, vx: -BOSS.speed, vy: 0, hp: BOSS.hp, face: -1, min: lv.boss.min * T, max: lv.boss.max * T, dirT: 1, jumpT: 2, fireT: 2.5, flash: 0, state: 'alive', active: false } : null;
    st.plants = lv.plants.map((p, i) => ({ id: 500 + i, x: p.x * T + 10, w: PLANT.w, h: PLANT.h, topY: p.topY, pipeX: p.x * T + T, state: 'down', timer: i * 0.7, extent: 0, y: p.topY, dead: false }));
    st.items = []; st.fireballs = []; st.coinBlocks = {}; st.seq = 1000;
    st.m = makeMario(st, lv.start * T, 'small');
    st.stompChain = 0; st.starChain = 0; st.flagY = 2 * T; st.clearPhase = '';
    st.inRoom = false; st.surface = null; st.warp = null;
    st.phase = 'play';
    emit(st, { t: 'stage', stage });
  }
  function makeMario(st, x, size) {
    const sz = SIZE[size];
    return { prevBottom: 0, ride: null, x, y: GROUND * T - sz.h, w: sz.w, h: sz.h, vx: 0, vy: 0, size, face: 1, onGround: true, coyote: 0, invuln: 1, star: 0, jumpHeld: false, running: false, fireCool: 0, moved: false, dead: false, hidden: false, skid: false, crouch: false };
  }
  function makeEnemy(type, x, y, id) {
    const d = ENEMY[type];
    return { id, type, x, y, w: d.w, h: d.h, vx: -d.speed, vy: 0, state: 'walk', active: false, timer: 0, grace: 0, chain: 0 };
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
  function spawnItem(st, type, tx, ty) {
    st.items.push({ id: ++st.seq, type, x: tx * T + 2, y: ty * T - 12, w: 12, h: 12, vx: 0, vy: 0, emerge: 0, ty });
    emit(st, { t: 'powerup', tx, ty, type });
  }
  function hitBlock(st, tx, ty) {
    const m = st.m, ch = st.tiles[ty][tx];
    if (ch === '?') { st.tiles[ty][tx] = 'U'; addCoin(st, true); emit(st, { t: 'block', ch, tx, ty }); }
    else if (ch === 'M') { st.tiles[ty][tx] = 'U'; spawnItem(st, m.size === 'small' ? 'mushroom' : 'flower', tx, ty); emit(st, { t: 'block', ch, tx, ty }); }
    else if (ch === '*') { st.tiles[ty][tx] = 'U'; spawnItem(st, 'star', tx, ty); emit(st, { t: 'block', ch, tx, ty }); }
    else if (ch === '1') { st.tiles[ty][tx] = 'U'; spawnItem(st, '1up', tx, ty); emit(st, { t: 'block', ch, tx, ty }); }
    else if (ch === 'H') { st.tiles[ty][tx] = 'U'; spawnItem(st, '1up', tx, ty); emit(st, { t: 'block', ch, tx, ty }); }
    else if (ch === '$') {                                              // 정해진 시간 안에 칠 때마다 동전, 열 개가 되거나 시간이 지나면 쓴 블록
      const key = tx + ',' + ty;
      const cb = st.coinBlocks[key] || (st.coinBlocks[key] = { n: 0, t: COIN_BLOCK_TIME });
      cb.n++; addCoin(st, true);
      emit(st, { t: 'block', ch, tx, ty });
      if (cb.n >= COIN_BLOCK_MAX) { st.tiles[ty][tx] = 'U'; delete st.coinBlocks[key]; }
    } else if (ch === 'B') {
      if (m.size !== 'small') { st.tiles[ty][tx] = '.'; st.score += POINTS.brick; st.stats.bricks++; emit(st, { t: 'brick', tx, ty }); emit(st, { t: 'block', ch, tx, ty }); }
      else emit(st, { t: 'block', ch, tx, ty, bump: true });
    } else return;
    // 블록 위에 서 있던 적은 뒤집힌다
    for (const e of st.enemies) if (e.state !== 'dead' && e.state !== 'gone' && e.active && Math.abs(e.y + e.h - ty * T) < 3 && e.x + e.w > tx * T && e.x < (tx + 1) * T) killEnemy(st, e, POINTS.kill, 'block');
  }
  function addCoin(st, fromBlock) {
    st.coins++; st.stats.coinsTotal++; st.score += POINTS.coin;
    emit(st, { t: 'coin', block: !!fromBlock });
    if (st.coins >= EXTRA_LIFE_COINS) { st.coins -= EXTRA_LIFE_COINS; oneUp(st); }
  }
  function oneUp(st) { st.lives++; emit(st, { t: 'extra' }); }
  function addScore(st, n) {
    st.score += n;
    const need = () => EXTRA_LIFE_AT * (st.extra + 1);
    while (st.score >= need()) { st.extra++; oneUp(st); }
  }

  // ---------- 마리오 ----------
  function overlapsSolid(st, x, y, w, h) {
    for (let ty = Math.floor(y / T); ty <= Math.floor((y + h - 0.001) / T); ty++) for (let tx = Math.floor(x / T); tx <= Math.floor((x + w - 0.001) / T); tx++) if (solid(st, tx, ty)) return true;
    return false;
  }
  const canStand = (st) => { const m = st.m, H = SIZE[m.size].h; return !overlapsSolid(st, m.x, m.y + m.h - H, m.w, H); };
  function setCrouch(st, on) {
    const m = st.m, nh = on ? CROUCH_H : SIZE[m.size].h;
    m.y += m.h - nh; m.h = nh; m.crouch = on;
  }
  function setSize(st, size) {
    const m = st.m;
    if (m.crouch) { m.y += m.h - SIZE[m.size].h; m.h = SIZE[m.size].h; m.crouch = false; }
    const old = m.h, sz = SIZE[size];
    m.size = size; m.w = sz.w; m.h = sz.h; m.y += old - sz.h;
    if (m.y < -40) m.y = -40;
  }
  function die(st, why) {
    const m = st.m;
    if (m.dead || st.phase !== 'play') return;
    m.dead = true; m.vy = -260; m.vx = 0; m.star = 0; st.lives--;
    st.phase = 'dying'; st.dyingT = DYING;
    emit(st, { t: 'dead', why });
  }
  function hurt(st) {
    const m = st.m;
    if (m.invuln > 0 || m.star > 0 || m.dead) return;
    if (m.size === 'small') return die(st, 'enemy');
    if (st.tutorial) { m.invuln = INVULN; return; }                        // 연습에서는 커진 채로 있게(앉기·파이프 단계를 해 볼 수 있게)
    setSize(st, 'small'); m.invuln = INVULN;
    emit(st, { t: 'shrink' });
  }

  function stepMario(st, h, input) {
    const m = st.m;
    m.prevBottom = m.y + m.h;
    // 앉기: 커진 마리오가 땅에서 ↓ 를 누르면 앉는다. 앉은 채로는 걷지 못하고 달리던 힘으로 미끄러진다. 놓을 때 머리 위가 막혀 있으면 계속 앉아 있는다
    if (m.size !== 'small') {
      if (input.down && !m.crouch && m.onGround) { setCrouch(st, true); emit(st, { t: 'crouch' }); }
      else if (!input.down && m.crouch && canStand(st)) setCrouch(st, false);
    }
    const dir = m.crouch && m.onGround ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);
    m.running = !!input.run;
    const maxV = m.running ? RUN : WALK, acc = m.running ? ACC_RUN : ACC_WALK;
    m.skid = false;
    if (dir) {
      if (m.vx * dir < 0 && m.onGround) { m.skid = true; m.vx += dir * SKID * h; if (m.vx * dir > 0) m.vx = 0; }      // 반대쪽으로 달리다 방향을 바꾸면 미끄러진다
      else if (m.vx * dir < 0) { m.vx += dir * acc * h; m.face = dir; }                  // 공중에서 반대쪽으로 조종하면 속도가 줄어든다
      else {
        m.face = dir;
        if (Math.abs(m.vx) < maxV) m.vx = clamp(m.vx + dir * acc * h, -maxV, maxV);
        else m.vx = Math.sign(m.vx) * Math.max(maxV, Math.abs(m.vx) - DECEL * h);          // 달리기를 놓으면 걷기 속도까지 줄어든다
      }
      if (!m.moved) { m.moved = true; emit(st, { t: 'move' }); }
    } else if (m.onGround) {
      const f = DECEL * h;
      m.vx = Math.abs(m.vx) <= f ? 0 : m.vx - Math.sign(m.vx) * f;
    }
    // 점프: 빨리 달릴수록 더 높이 뜬다
    m.coyote = m.onGround ? 0.08 : Math.max(0, m.coyote - h);
    m.jumpHeld = !!input.jumpHeld || !!input.jump;
    if (input.jump && (m.onGround || m.coyote > 0)) {
      const k = clamp((Math.abs(m.vx) - 90) / 60, 0, 1);
      m.vy = -(JUMP_SLOW + (JUMP_FAST - JUMP_SLOW) * k); m.jumpG = G_HOLD_SLOW + (G_HOLD_FAST - G_HOLD_SLOW) * k;
      m.onGround = false; m.coyote = 0;
      emit(st, { t: 'jump', big: m.size !== 'small' });
    }
    const g = m.vy < 0 ? (m.jumpHeld ? (m.jumpG || G_HOLD_SLOW) : G_FALL) : G_FALL;
    m.vy = Math.min(MAXFALL, m.vy + g * h);
    if (m.fireCool > 0) m.fireCool -= h;
    if (input.fire && m.size === 'fire' && !m.crouch && m.fireCool <= 0 && st.fireballs.length < 2) {
      st.fireballs.push({ id: ++st.seq, x: m.x + (m.face > 0 ? m.w : -6), y: m.y + 10, w: 6, h: 6, vx: m.face * 190, vy: 40, life: 3 });
      m.fireCool = 0.2; emit(st, { t: 'fire' });
    }
    // 움직이기
    const hitX = moveX(st, m, m.vx * h);
    if (hitX) m.vx = 0;
    if (m.x < st.camX) { m.x = st.camX; if (m.vx < 0) m.vx = 0; }
    const wasGround = m.onGround;
    let hidden = false;                                                   // 숨은 블록: 아래에서 머리로 치면 나타난다
    if (m.vy < 0) {
      const ny = m.y + m.vy * h, ty = Math.floor(ny / T);
      for (let tx = Math.floor(m.x / T); tx <= Math.floor((m.x + m.w - 0.001) / T); tx++) if (tileAt(st, tx, ty) === 'H' && m.y >= (ty + 1) * T - 0.5) { m.y = (ty + 1) * T; m.vy = 60; hitBlock(st, tx, ty); hidden = true; break; }
    }
    const hy = hidden ? null : moveY(st, m, m.vy * h);
    m.onGround = false;
    if (hy) {
      const sx = Math.floor((m.x + m.w / 2) / T), sy = Math.floor((m.y + m.h + 0.5) / T);
      if (hy.dir > 0 && tileAt(st, sx, sy) === 'Y') {                       // 스프링: 밟으면 높이 튀어 오른다 (점프를 누르고 있으면 더 높이)
        m.vy = -(m.jumpHeld ? SPRING_HOLD : SPRING_TAP); m.jumpG = G_HOLD_FAST; st.stompChain = 0; st.starChain = 0;
        emit(st, { t: 'spring', tx: sx, ty: sy });
      } else if (hy.dir > 0) { m.onGround = true; m.vy = 0; if (!wasGround) emit(st, { t: 'land' }); st.stompChain = 0; st.starChain = 0; }
      else { m.vy = 60; hitBlock(st, hy.tx, hy.ty); }
    }
    if (m.invuln > 0) m.invuln = Math.max(0, m.invuln - h);
    if (m.star > 0) { m.star = Math.max(0, m.star - h); if (m.star === 0) emit(st, { t: 'starEnd' }); }
    if (m.y > VH + 40) die(st, 'pit');
  }

  // ---------- 적 ----------
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  function chainPoints(st, list, idx) {                // 연속 점수. 끝까지 가면 1UP
    if (idx >= list.length) { oneUp(st); return 0; }
    return list[idx];
  }
  function killEnemy(st, e, pts, by) {
    if (ENEMY[e.type].immortal) return;
    e.state = 'dead'; e.vy = -150; e.vx = 0; e.timer = 2;
    addScore(st, pts); emit(st, { t: 'kill', x: e.x, y: e.y, pts, by });
  }
  function stepEnemy(st, e, h) {
    if (e.state === 'dead') { e.vy = Math.min(MAXFALL + 100, e.vy + 1000 * h); e.y += e.vy * h; e.timer -= h; return; }
    if (e.state === 'flat') { e.timer -= h; return; }
    if (e.grace > 0) e.grace -= h;
    const d = ENEMY[e.type];
    if (e.type === 'bullet') { e.x += e.vx * h; return; }
    if (e.type === 'podoboo') {                                            // 구멍 아래에서 기다리다가 가끔 튀어 오른다
      e.timer += h;
      if (!e.pup) { e.y = VH + 10; if (e.timer >= 2.2 + (e.id % 3) * 0.6) { e.pup = true; e.vy = -400; e.timer = 0; } }
      else { e.vy += 700 * h; e.y += e.vy * h; if (e.vy > 0 && e.y >= VH + 10) { e.pup = false; e.y = VH + 10; e.timer = 0; } }
      return;
    }
    if (e.state === 'shell') {                          // 가만히 있는 등껍질은 시간이 지나면 다시 걷는다
      e.vx = 0; e.timer += h; e.wiggle = e.timer > SHELL_REVIVE - 1;
      if (e.timer >= SHELL_REVIVE) { e.state = 'walk'; e.h = d.h; e.y -= d.h - 12; e.vx = -d.speed; e.timer = 0; e.wiggle = false; e.chain = 0; }
    }
    e.vy = Math.min(MAXFALL + 100, e.vy + 1000 * h);
    const hit = moveX(st, e, e.vx * h);
    if (hit) e.vx = -e.vx;
    const hy = moveY(st, e, e.vy * h);
    if (hy && hy.dir > 0) {
      e.vy = 0;
      if (d.ledge && e.state === 'walk') {                                 // 빨간 거북: 발 앞이 낭떠러지면 돌아선다
        const fx = Math.floor((e.vx > 0 ? e.x + e.w + 1 : e.x - 1) / T), fy = Math.floor((e.y + e.h + 2) / T);
        if (!solid(st, fx, fy)) { e.vx = -e.vx; e.x += e.vx > 0 ? 1 : -1; }
      }
    }
    if (e.y > VH + 60) e.state = 'gone';
  }
  function stepEnemies(st, h) {
    const m = st.m;
    for (const e of st.enemies) {
      if (!e.active) { if (e.x < st.camX + VW + 24) e.active = true; else continue; }
      stepEnemy(st, e, h);
    }
    // 움직이는 등껍질은 다른 적을 쓰러뜨린다 (연속으로 쓰러뜨릴수록 점수가 커지고 끝에는 1UP)
    for (const s of st.enemies) {
      if (s.state !== 'shellMove') continue;
      for (const e of st.enemies) if (e !== s && e.state !== 'dead' && e.state !== 'gone' && e.active && overlap(s, e)) { killEnemy(st, e, chainPoints(st, SHELL_CHAIN, s.chain), 'shell'); s.chain++; }
    }
    // 마리오와 적
    if (m.dead) return;
    for (const e of st.enemies) {
      if (!e.active || e.state === 'dead' || e.state === 'flat' || e.state === 'gone') continue;
      if (!overlap(m, e)) continue;
      const d = ENEMY[e.type];
      if (m.star > 0) { if (d.immortal) continue; killEnemy(st, e, chainPoints(st, STOMP_CHAIN, st.starChain), 'star'); st.starChain++; continue; }          // 별 마리오는 닿기만 해도 쓰러뜨린다
      const stomp = !d.nostomp && m.vy > 0 && m.y + m.h - e.y <= 9 + m.vy * h;
      if (e.state === 'shell') {                                        // 가만히 있는 등껍질: 밟거나 닿으면 찬다
        e.state = 'shellMove'; e.timer = 0; e.chain = 0; e.vx = (m.x + m.w / 2 < e.x + e.w / 2 ? 1 : -1) * SHELL_SPEED; e.grace = 0.3;
        addScore(st, POINTS.kick);
        if (stomp) m.vy = -190;
        emit(st, { t: 'kick', pts: POINTS.kick });
        continue;
      }
      if (stomp) {
        const pts = chainPoints(st, STOMP_CHAIN, st.stompChain);
        st.stompChain++; st.stats.stomps++; addScore(st, pts);
        m.vy = -(m.jumpHeld ? 230 : 160);
        if (e.type === 'goomba') { e.state = 'flat'; e.timer = 0.4; e.vx = 0; }
        else if (e.type === 'bullet') { e.state = 'dead'; e.vx = 0; e.vy = 0; e.timer = 2; }
        else if (e.state === 'shellMove') { e.state = 'shell'; e.vx = 0; e.timer = 0; }
        else { e.state = 'shell'; e.y += e.h - 12; e.h = 12; e.vx = 0; e.timer = 0; }
        emit(st, { t: 'stomp', x: e.x, y: e.y, pts, type: e.type });
      } else if (e.state === 'shellMove' && e.grace > 0) { /* 막 찬 등껍질은 안전 */ }
      else hurt(st);
    }
    st.enemies = st.enemies.filter((e) => e.state !== 'gone' && !(e.state === 'dead' && e.timer <= 0) && !(e.state === 'flat' && e.timer <= 0) && e.x > st.camX - 96 && !(e.type === 'bullet' && e.x > st.camX + VW + 140));
  }

  // ---------- 파이프 속 식물 ----------
  function stepPlants(st, h) {
    const m = st.m;
    for (const p of st.plants) {
      const near = Math.abs((m.x + m.w / 2) - p.pipeX) < PLANT.near;
      if (p.state === 'down') { if (!near) p.timer += h; if (p.timer >= PLANT.down) { p.state = 'rise'; p.timer = 0; } p.extent = 0; }
      else if (p.state === 'rise') { p.timer += h; p.extent = Math.min(1, p.timer / PLANT.rise); if (p.timer >= PLANT.rise) { p.state = 'up'; p.timer = 0; p.extent = 1; } }
      else if (p.state === 'up') { p.timer += h; p.extent = 1; if (p.timer >= PLANT.up) { p.state = 'sink'; p.timer = 0; } }
      else { p.timer += h; p.extent = Math.max(0, 1 - p.timer / PLANT.sink); if (p.timer >= PLANT.sink) { p.state = 'down'; p.timer = 0; p.extent = 0; } }
      p.y = p.topY - p.extent * PLANT.h;
      if (!m.dead && p.extent > 0.15 && overlap(m, { x: p.x, y: p.y, w: p.w, h: p.topY - p.y })) {
        if (m.star > 0) { p.dead = true; addScore(st, POINTS.plant); emit(st, { t: 'kill', x: p.x, y: p.y, pts: POINTS.plant, by: 'star' }); }
        else hurt(st);
      }
    }
    st.plants = st.plants.filter((p) => !p.dead);
  }

  // ---------- 대포·불꽃 막대·움직이는 발판 ----------
  function stepCannons(st, h) {
    const m = st.m;
    for (const c of st.cannons) {
      c.t -= h;
      if (c.t > 0) continue;
      c.t = CANNON_EVERY;
      if (c.x < st.camX - 8 || c.x > st.camX + VW || Math.abs(c.x - m.x) < 3 * T) continue;            // 화면 밖이거나 마리오가 바로 옆이면 쏘지 않는다
      if (st.enemies.filter((e) => e.type === 'bullet' && e.state === 'walk').length >= 3) continue;
      const dir = m.x < c.x ? -1 : 1;
      const e = makeEnemy('bullet', dir < 0 ? c.x - 10 : c.x + T - 4, c.y + 2, ++st.seq);
      e.vx = dir * ENEMY.bullet.speed; e.active = true;
      st.enemies.push(e); emit(st, { t: 'cannon', x: c.x, y: c.y });
    }
  }
  const barSegments = (b) => { const a = []; for (let i = 1; i <= b.len; i++) a.push({ x: b.cx + Math.cos(b.ang) * i * BAR_STEP - 3, y: b.cy + Math.sin(b.ang) * i * BAR_STEP - 3, w: 6, h: 6 }); return a; };
  function stepBars(st, h) {
    const m = st.m;
    for (const b of st.bars) {
      b.ang += b.spd * h;
      if (m.dead || b.cx < st.camX - 80 || b.cx > st.camX + VW + 80) continue;
      for (const sg of barSegments(b)) if (overlap(m, sg)) { hurt(st); break; }
    }
  }
  function stepLifts(st, h) {                                           // 움직이는 발판은 위에서만 설 수 있다. 타고 있으면 같이 움직인다
    const m = st.m;
    for (const l of st.lifts) {
      l.p += l.speed * h;
      const cyc = l.p % (2 * l.range), off = cyc < l.range ? cyc : 2 * l.range - cyc;
      const ox = l.x, oy = l.y;
      if (l.axis === 'x') l.x = l.x0 + off; else l.y = l.y0 - off;
      l.dx = l.x - ox; l.dy = l.y - oy;
      if (m.ride === l && !m.dead) { moveX(st, m, l.dx); m.y += l.dy; }
    }
  }
  function liftLand(st) {
    const m = st.m;
    m.ride = null;
    if (m.dead) return;
    for (const l of st.lifts) {
      if (m.vy >= 0 && m.x + m.w > l.x && m.x < l.x + l.w && m.prevBottom <= l.y + 2 && m.y + m.h >= l.y && m.y + m.h <= l.y + 12) {
        const wasGround = m.onGround;
        m.y = l.y - m.h; m.vy = 0; m.onGround = true; m.ride = l; st.stompChain = 0; st.starChain = 0;
        if (!wasGround) emit(st, { t: 'land' });
        return;
      }
    }
  }

  // ---------- 쿠파 대마왕 ----------
  function stepBoss(st, h) {
    const b = st.boss, m = st.m;
    if (!b) return;
    if (b.state !== 'alive') { b.vy = Math.min(MAXFALL + 200, b.vy + 900 * h); b.y += b.vy * h; return; }      // 쓰러졌거나 다리가 무너지면 떨어진다
    if (!b.active) { if (b.x < st.camX + VW + 8) b.active = true; else return; }
    if (b.flash > 0) b.flash -= h;
    b.dirT -= h;
    if (b.dirT <= 0) { b.vx = (st.rand() < 0.5 ? -1 : 1) * BOSS.speed; b.dirT = 1 + st.rand() * 1.5; }
    b.face = m.x + m.w / 2 < b.x + b.w / 2 ? -1 : 1;
    b.x += b.vx * h;
    if (b.x < b.min) { b.x = b.min; b.vx = Math.abs(b.vx); }
    if (b.x > b.max) { b.x = b.max; b.vx = -Math.abs(b.vx); }
    const floor = GROUND * T - b.h;
    b.vy += 1000 * h; b.y += b.vy * h;
    if (b.y >= floor) { b.y = floor; b.vy = 0; }
    b.jumpT -= h;
    if (b.jumpT <= 0 && b.y >= floor) { b.vy = -230; b.jumpT = 2.2 + st.rand() * 1.8; }                 // 가끔 뛰어서 그 밑으로 지나갈 수 있다
    b.fireT -= h;
    if (b.fireT <= 0) {                                                                                   // 불을 내뿜는다: 세 가지 높이 중 하나
      b.fireT = 2.2 + st.rand() * 1.2;
      const ys = [GROUND * T - 18, GROUND * T - 34, GROUND * T - 50];
      st.hazards.push({ x: b.face < 0 ? b.x - 14 : b.x + b.w, y: ys[Math.floor(st.rand() * 3)], w: 16, h: 8, vx: b.face * 85 });
      emit(st, { t: 'bossFire' });
    }
    if (!m.dead && m.star <= 0 && overlap(m, b)) hurt(st);
  }
  function stepHazards(st, h) {
    const m = st.m;
    for (const f of st.hazards) { f.x += f.vx * h; if (!m.dead && overlap(m, f)) hurt(st); }
    st.hazards = st.hazards.filter((f) => f.x > st.camX - 40 && f.x < st.camX + VW + 40);
  }

  // ---------- 아이템·불꽃 ----------
  function stepItems(st, h) {
    const m = st.m;
    for (const it of st.items) {
      if (it.emerge < 1) { it.emerge = Math.min(1, it.emerge + h * 2.2); it.y = (it.ty * T - 12) - it.emerge * 14; if (it.emerge >= 1) { it.vx = it.type === 'flower' ? 0 : (it.type === 'star' ? 60 : 44); if (it.type === 'star') it.vy = -150; } continue; }
      if (it.type !== 'flower') {
        it.vy = Math.min(MAXFALL, it.vy + (it.type === 'star' ? 700 : 1000) * h);
        if (moveX(st, it, it.vx * h)) it.vx = -it.vx;
        const hy = moveY(st, it, it.vy * h);
        if (hy && hy.dir > 0) it.vy = it.type === 'star' ? -190 : 0;
        if (it.y > VH + 40) it.gone = true;
      }
      if (!m.dead && overlap(m, it)) {
        it.gone = true;
        if (it.type === '1up') { oneUp(st); emit(st, { t: 'power', type: '1up' }); continue; }
        if (it.type === 'star') { addScore(st, POINTS.star); m.star = STAR_TIME; st.starChain = 0; emit(st, { t: 'power', type: 'star' }); continue; }
        addScore(st, POINTS.mushroom);
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
      for (const e of st.enemies) if (e.active && e.state !== 'dead' && e.state !== 'gone' && e.state !== 'flat' && overlap(f, e)) { if (!ENEMY[e.type].fireproof) killEnemy(st, e, POINTS.kill, 'fire'); f.life = 0; break; }
      const b = st.boss;
      if (b && b.state === 'alive' && f.life > 0 && overlap(f, b)) {                  // 쿠파는 불꽃 다섯 번에 쓰러진다
        f.life = 0; b.hp--; b.flash = 0.2; emit(st, { t: 'bossHit', hp: b.hp });
        if (b.hp <= 0) { b.state = 'dead'; b.vy = -200; addScore(st, BOSS.points); emit(st, { t: 'bossDead', x: b.x, y: b.y, pts: BOSS.points }); }
      }
      for (const p of st.plants) if (f.life > 0 && p.extent > 0.15 && overlap(f, { x: p.x, y: p.y, w: p.w, h: p.topY - p.y })) { p.dead = true; f.life = 0; addScore(st, POINTS.plant); emit(st, { t: 'kill', x: p.x, y: p.y, pts: POINTS.plant, by: 'fire' }); }
      if (f.y > VH + 20) f.life = 0;
    }
    st.fireballs = st.fireballs.filter((f) => f.life > 0 && f.x > st.camX - 20 && f.x < st.camX + VW + 20);
    st.plants = st.plants.filter((p) => !p.dead);
  }

  // ---------- 동전과 깃대 ----------
  function stepTilesTouch(st) {
    const m = st.m;
    const l = Math.floor(m.x / T), r = Math.floor((m.x + m.w - 0.001) / T), t = Math.floor(m.y / T), b = Math.floor((m.y + m.h - 0.001) / T);
    for (let ty = Math.max(0, t); ty <= Math.min(ROWS - 1, b); ty++) for (let tx = l; tx <= r; tx++) {
      const ch = tileAt(st, tx, ty);
      if (ch === 'C') { st.tiles[ty][tx] = '.'; addCoin(st, false); }
      else if ((ch === 'F' || ch === 'f') && st.phase === 'play') return reachFlag(st);
      else if (ch === 'A' && st.phase === 'play') return reachAxe(st);
    }
  }
  // 깃대를 잡았다: 미끄러져 내려가고 → 성 쪽으로 걸어가고 → 남은 시간이 점수로 바뀌고 → 다음 코스
  function reachFlag(st) {
    const m = st.m;
    const frac = clamp((GROUND * T - (m.y + m.h)) / (8 * T), 0, 1);
    const pts = POINTS.flag[Math.round(frac * (POINTS.flag.length - 1))];
    addScore(st, pts);
    st.phase = 'clear'; st.clearPhase = 'slide'; st.clearT = 0; st.flagPts = pts; st.bonus = st.tutorial ? 0 : Math.floor(st.timeLeft) * POINTS.timePerUnit;
    m.vx = 0; m.vy = 0; m.star = 0; m.x = st.level.flag * T + 7 - m.w; m.face = 1;
    st.countAcc = 0; st.fw = st.tutorial ? 0 : (FIREWORK_DIGITS[Math.floor(st.timeLeft) % 10] || 0); st.fwDone = 0;       // 남은 시간 끝자리가 1·3·6 이면 불꽃놀이
    emit(st, { t: 'flag', pts, bonus: st.bonus });
    if (st.stage >= STAGES.length) st.won = true;
  }
  // 도끼를 건드렸다: 다리가 끝에서부터 무너지고 쿠파가 용암으로 떨어진다 → 남은 시간 정산 → 끝
  function reachAxe(st) {
    const m = st.m;
    st.phase = 'clear'; st.clearPhase = 'bridge'; st.clearT = 0; st.bridgeDone = 0; st.fw = 0; st.fwDone = 0;
    st.bonus = st.tutorial ? 0 : Math.floor(st.timeLeft) * POINTS.timePerUnit;
    m.vx = 0; m.vy = 0; m.star = 0; st.won = true; st.countAcc = 0;
    st.hazards = [];
    emit(st, { t: 'axe', bonus: st.bonus });
  }
  function afterCount(st) { st.clearPhase = st.fw > 0 ? 'fireworks' : 'wait'; st.clearT = 0; }
  function stepClear(st, h) {
    const m = st.m, fx = st.level.flag * T, floor = (GROUND - 1) * T;
    st.clearT += h;
    if (st.clearPhase === 'slide') {
      m.y = Math.min(floor - m.h, m.y + FLAG.slide * h);
      st.flagY = Math.max(st.flagY, Math.min(m.y + m.h, floor - 10));
      if (m.y + m.h >= floor) { st.clearPhase = 'hang'; st.clearT = 0; m.onGround = true; }
    } else if (st.clearPhase === 'hang') {
      if (st.clearT >= FLAG.hang) { st.clearPhase = 'walk'; st.clearT = 0; m.x = fx + 10; m.face = 1; m.vy = 0; }
    } else if (st.clearPhase === 'walk') {
      m.vy = Math.min(MAXFALL, m.vy + G_FALL * h);
      moveX(st, m, FLAG.walk * h); moveY(st, m, m.vy * h);
      if (m.x >= fx + FLAG.castle * T) { m.hidden = true; st.clearPhase = 'count'; st.clearT = 0; if (st.tutorial) st.timeLeft = 0; }
    } else if (st.clearPhase === 'count') {
      if (st.timeLeft > 0) {
        const dec = Math.min(st.timeLeft, COUNT_RATE * h);
        st.timeLeft -= dec; st.countAcc += dec;
        const whole = Math.floor(st.countAcc);
        if (whole > 0) { st.countAcc -= whole; addScore(st, whole * POINTS.timePerUnit); emit(st, { t: 'tick' }); }
        if (st.timeLeft <= 0) { st.timeLeft = 0; afterCount(st); }
      } else afterCount(st);
    } else if (st.clearPhase === 'bridge') {
      const br = st.level.bridge, n = br[1] - br[0] + 1;
      while (st.bridgeDone < n && st.bridgeDone < st.clearT / 0.08) { st.tiles[GROUND][br[1] - st.bridgeDone] = '.'; st.bridgeDone++; emit(st, { t: 'crumble' }); }
      const b = st.boss;
      if (b && b.state === 'alive' && st.tiles[GROUND][Math.floor((b.x + b.w / 2) / T)] !== 'g') { b.state = 'fall'; b.vy = 0; emit(st, { t: 'bossFall' }); }
      stepBoss(st, h);
      if (st.bridgeDone >= n && st.clearT > n * 0.08 + 0.8) { st.clearPhase = 'count'; st.clearT = 0; if (st.tutorial) st.timeLeft = 0; }
    } else if (st.clearPhase === 'fireworks') {
      const lv = st.level, k = st.fwDone;
      if (k < st.fw && st.clearT >= (k + 1) * FIREWORK_GAP - 0.3) {
        addScore(st, FIREWORK_PTS); st.fwDone++;
        emit(st, { t: 'firework', x: (lv.flag + 3) * T + 24 + ((k % 3) - 1) * 22, y: 34 + ((k * 37) % 32), pts: FIREWORK_PTS });
      }
      if (st.fwDone >= st.fw && st.clearT >= st.fw * FIREWORK_GAP + 0.4) { st.clearPhase = 'wait'; st.clearT = 0; }
    } else if (st.clearPhase === 'wait') {
      if (st.clearT >= FLAG.wait) {
        emit(st, { t: 'clear', stage: st.stage });
        if (st.won) { st.phase = 'over'; emit(st, { t: 'win' }); emit(st, { t: 'over', won: true }); }
        else startStage(st, st.stage + 1);
      }
    }
  }

  // ---------- 파이프와 지하 보너스 방 ----------
  function warpAt(st) {
    const m = st.m;
    if (st.inRoom) return null;
    const cx = m.x + m.w / 2;
    for (const w of st.level.warps) if (cx >= w.x * T + 2 && cx <= (w.x + 2) * T - 2 && Math.abs(m.y + m.h - w.topY) < 1.5) return w;
    return null;
  }
  function startWarp(st, kind, w) {
    const m = st.m;
    st.phase = 'warp';
    if (kind === 'in') {
      if (m.crouch) { m.y += m.h - SIZE[m.size].h; m.h = SIZE[m.size].h; m.crouch = false; }
      m.x = w.x * T + (2 * T - m.w) / 2; m.y = w.topY - m.h; m.vx = 0; m.vy = 0;
      st.warp = { kind, t: 0, w, startY: m.y };
    } else st.warp = { kind, t: 0, w, startY: w.exitTopY };
    emit(st, { t: 'warp', kind });
  }
  function enterRoom(st, w) {
    const m = st.m;
    st.surface = { tiles: st.tiles, w: st.w, enemies: st.enemies, plants: st.plants, items: st.items, fireballs: st.fireballs, camX: st.camX, warp: w };
    st.tiles = ROOM.tiles.map((r) => r.slice()); st.w = ROOM.w;
    st.enemies = []; st.plants = []; st.items = []; st.fireballs = []; st.camX = 0; st.inRoom = true;
    m.x = 2 * T; m.y = GROUND * T - m.h; m.vx = 0; m.vy = 0; m.onGround = true; m.crouch = false; m.invuln = Math.max(m.invuln, 0.3);
    emit(st, { t: 'room' });
  }
  function leaveRoom(st) {
    const m = st.m, sf = st.surface, w = sf.warp;
    st.tiles = sf.tiles; st.w = sf.w; st.enemies = sf.enemies; st.plants = sf.plants; st.items = sf.items; st.fireballs = sf.fireballs; st.camX = sf.camX;
    st.inRoom = false; st.surface = null;
    m.x = w.exitX * T + (2 * T - m.w) / 2; m.y = w.exitTopY; m.vx = 0; m.vy = 0; m.onGround = true;
    st.camX = Math.max(st.camX, Math.min(st.w * T - VW, m.x - 96));
    startWarp(st, 'out', w);
  }
  function stepWarp(st, h) {
    const m = st.m, wp = st.warp;
    st.timeLeft -= TIME_RATE * h;
    if (st.timeLeft <= 0) { st.timeLeft = 0; st.phase = 'play'; return die(st, 'time'); }
    wp.t += h;
    const k = Math.min(1, wp.t / WARP_TIME);
    if (wp.kind === 'in') {
      m.y = wp.startY + k * m.h;                                         // 파이프 속으로 가라앉는다
      if (k >= 1) { enterRoom(st, wp.w); st.phase = 'play'; st.warp = null; }
    } else {
      m.y = wp.startY - k * m.h;                                         // 파이프에서 올라온다
      if (k >= 1) { m.y = wp.w.exitTopY - m.h; st.phase = 'play'; st.warp = null; m.invuln = Math.max(m.invuln, 0.5); }
    }
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
      m.vy = Math.min(MAXFALL + 100, m.vy + 1000 * h); m.y += m.vy * h;
      if (st.dyingT <= 0) {
        if (st.lives <= 0) { st.phase = 'over'; emit(st, { t: 'over' }); }
        else { startStage(st, st.stage); emit(st, { t: 'respawn' }); }
      }
      return;
    }
    if (st.phase === 'clear') { stepClear(st, h); return; }
    if (st.phase === 'warp') { stepWarp(st, h); return; }
    for (const cb of Object.keys(st.coinBlocks)) {                       // 동전 여러 개 블록은 시간이 지나면 쓴 블록
      st.coinBlocks[cb].t -= h;
      if (st.coinBlocks[cb].t <= 0) { const [x, y] = cb.split(',').map(Number); if (st.tiles[y][x] === '$') st.tiles[y][x] = 'U'; delete st.coinBlocks[cb]; }
    }
    st.timeLeft -= TIME_RATE * h;
    if (!st.hurried && !st.tutorial && st.timeLeft <= HURRY_AT) { st.hurried = true; emit(st, { t: 'hurry' }); }
    if (st.timeLeft <= 0) { st.timeLeft = 0; return die(st, 'time'); }
    const out = !st.inRoom;
    if (out) stepLifts(st, h);
    stepMario(st, h, input);
    if (out) liftLand(st);
    if (st.phase !== 'play') return;
    if (input.down && m.onGround && !m.dead) { const w = warpAt(st); if (w) { startWarp(st, 'in', w); return; } }     // 파이프 위에서 ↓
    if (st.inRoom && input.right && m.onGround && tileAt(st, Math.floor((m.x + m.w) / T), Math.floor((m.y + m.h - 1) / T)) === 'E') { leaveRoom(st); return; }
    st.camX = Math.max(st.camX, Math.min(st.w * T - VW, m.x - 96));
    if (out) { stepCannons(st, h); stepBars(st, h); stepBoss(st, h); stepHazards(st, h); }
    stepEnemies(st, h);
    stepPlants(st, h);
    stepItems(st, h);
    if (st.phase === 'play') stepTilesTouch(st);
  }

  return {
    T, ROWS, GROUND, VW, VH, STAGES, SOLID, WALK, RUN, ACC_WALK, ACC_RUN, DECEL, SKID, JUMP_SLOW, JUMP_FAST, G_HOLD_SLOW, G_HOLD_FAST, G_FALL, MAXFALL, SIZE, START_LIVES, DYING, INVULN, STAR_TIME,
    TIME_RATE, HURRY_AT, COUNT_RATE, POINTS, STOMP_CHAIN, SHELL_CHAIN, ENEMY, SHELL_SPEED, SHELL_REVIVE, COIN_BLOCK_MAX, COIN_BLOCK_TIME, PLANT, FLAG, EXTRA_LIFE_COINS, EXTRA_LIFE_AT,
    CROUCH_H, WARP_TIME, ROOM, BOSS, CANNON_EVERY, SPRING_HOLD, SPRING_TAP, FIREWORK_PTS, barSegments,
    rng, newGame, startStage, step, tileAt, solid, hitBlock, hurt, die, setSize, addScore, makeEnemy, overlap, setCrouch, canStand, warpAt,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_SM;
