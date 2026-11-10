'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 슈퍼마리오 풍 게임: 화면·입력·소리. 규칙은 logic.js (LOGIC_SM), 코스는 levels.js. 여기서는 st.events 를 보고 소리·효과를 만든다.
const L = LOGIC_SM;
const { T, ROWS, GROUND, VW, VH } = L;
const HUD = 20, CH = HUD + VH;                                 // 캔버스 논리 크기 240 x 228
const TUTORIAL = /[?&]tutorial=1/.test(location.search);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const controls = $('controls');
  const ctrlH = getComputedStyle(controls).display === 'none' ? 0 : controls.offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / VW, (innerHeight - 16 - ctrlH) / CH);
  const cssW = Math.max(150, Math.floor(VW * scale)), cssH = Math.floor(cssW * CH / VW);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / VW, 0, 0, canvas.height / CH, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('smMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.04, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.045) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  jump: (big) => tone(big ? 300 : 380, 0.18, 'square', 0.04, 360),
  coin: () => melody([988, 1319], 55, 'square', 0.04),
  bump: () => tone(160, 0.07, 'triangle', 0.06),
  brick: () => { tone(220, 0.14, 'sawtooth', 0.05, -120); },
  powerup: () => melody([392, 523, 659], 70, 'triangle', 0.05),
  power: () => melody([523, 659, 784, 1047, 784, 1047, 1319], 55, 'square', 0.045),
  shrink: () => melody([784, 523, 392], 70, 'square', 0.05),
  stomp: () => tone(220, 0.1, 'square', 0.05, -90),
  kick: () => tone(300, 0.08, 'square', 0.05, 200),
  kill: () => tone(500, 0.12, 'square', 0.04, -300),
  fire: () => tone(700, 0.08, 'sawtooth', 0.03, -400),
  flag: () => melody([392, 523, 659, 784, 1047, 1319], 80, 'square', 0.05),
  clear: () => melody([784, 1047, 1319, 1568, 1319, 1568, 2093], 110, 'triangle', 0.06),
  dead: () => melody([523, 392, 330, 262, 196], 130, 'square', 0.05),
  extra: () => melody([659, 784, 1047, 1319], 80, 'sine', 0.07),
  over: () => melody([392, 330, 262, 196], 220, 'sawtooth', 0.06),
  tick: () => tone(300, 0.05, 'square', 0.03),
  hurry: () => melody([880, 660, 880, 660, 880], 90, 'square', 0.05),
  crouch: () => tone(200, 0.06, 'triangle', 0.04, -60),
  pipe: () => tone(260, 0.5, 'square', 0.04, -180),
  count: () => tone(1100, 0.03, 'square', 0.025),
  star: () => melody([784, 988, 1175, 988, 784], 60, 'square', 0.04),
  cannon: () => tone(120, 0.16, 'sawtooth', 0.06, -60),
  spring: () => tone(260, 0.3, 'triangle', 0.06, 700),
  bossFire: () => tone(220, 0.35, 'sawtooth', 0.05, -120),
  bossHit: () => tone(180, 0.15, 'square', 0.06, -80),
  firework: () => melody([1200, 800, 1600], 50, 'triangle', 0.05),
  crumble: () => tone(150, 0.08, 'sawtooth', 0.05, -80),
  hammer: () => tone(340, 0.09, 'square', 0.03, -120),
  egg: () => tone(520, 0.1, 'triangle', 0.03, -200),
  cheep: () => tone(600, 0.14, 'sine', 0.04, 400),
  up1: () => melody([659, 784, 1319, 1047, 1175, 1568], 80, 'square', 0.05),
};

// ---------- 상태 ----------
let G = null;
let state = 'title';                           // title · play · paused · over
let best = Number(store.get('smBest')) || 0;
let unlocked = Math.max(1, Math.min(L.STAGES.length, Number(store.get('smStage')) || 1));
let fxs = [], bumps = [];
let banner = { text: '', sub: '', t: 0, color: '#fff' };
let clock = 0, lastTick = 0;
let jumpReq = 0;

/* @test-hooks:start */
window.__sm = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt), start: (n) => startGame(n) };
/* @test-hooks:end */

// ---------- 입력 ----------
const keys = new Set();
const pad = { left: false, right: false, down: false, run: false, jump: false };
const K = { left: ['ArrowLeft', 'a', 'A'], right: ['ArrowRight', 'd', 'D'], down: ['ArrowDown', 's', 'S'] };
const JUMP = [' ', 'z', 'Z', 'ArrowUp', 'w', 'W'], RUN = ['x', 'X', 'Shift'];
const heldAny = (list) => list.some((k) => keys.has(k));
let fireReq = 0;
addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (state === 'play') pause(); else if (state === 'paused') resume(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  const mine = K.left.includes(e.key) || K.right.includes(e.key) || K.down.includes(e.key) || JUMP.includes(e.key) || RUN.includes(e.key);
  if (mine) e.preventDefault();
  if ((e.key === ' ' || e.key === 'Enter') && (state === 'title' || state === 'over') && !e.repeat) { startGame(state === 'over' && G && !G.won ? G.stage : 1); return; }
  if (JUMP.includes(e.key) && !e.repeat) jumpReq = 0.12;
  if (RUN.includes(e.key) && !e.repeat) fireReq = 0.12;
  keys.add(e.key);
});
addEventListener('keyup', (e) => { keys.delete(e.key); });
addEventListener('blur', () => { keys.clear(); pad.left = pad.right = pad.down = pad.run = pad.jump = false; for (const b of document.querySelectorAll('#controls button')) b.classList.remove('on'); });

function bindHold(el, on, off) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} el.classList.add('on'); on(); });
  const up = () => { el.classList.remove('on'); off(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
}
bindHold($('leftBt'), () => { pad.left = true; }, () => { pad.left = false; });
bindHold($('rightBt'), () => { pad.right = true; }, () => { pad.right = false; });
bindHold($('downBt'), () => { pad.down = true; }, () => { pad.down = false; });
bindHold($('runBt'), () => { pad.run = true; fireReq = 0.12; }, () => { pad.run = false; });
bindHold($('jumpBt'), () => { pad.jump = true; jumpReq = 0.12; }, () => { pad.jump = false; });
const readInput = () => ({
  left: heldAny(K.left) || pad.left, right: heldAny(K.right) || pad.right, down: heldAny(K.down) || pad.down,
  run: heldAny(RUN) || pad.run, jump: jumpReq > 0, jumpHeld: heldAny(JUMP) || pad.jump, fire: fireReq > 0,
});

// ---------- 흐름 ----------
function startGame(stage = 1) {
  G = L.newGame(Math.random, Math.max(1, Math.min(unlocked, stage)), TUTORIAL ? { tutorial: true, lives: 9 } : {});
  fxs = []; bumps = []; banner.t = 0; jumpReq = 0; fireReq = 0; lastTick = 0;
  state = 'play';
  $('overlay').classList.add('hidden');
  announceStage();
  sfx.powerup();
}
function announceStage() { showBanner(TUTORIAL ? '연습' : `${G.stage}코스 ${G.level.name}`, TUTORIAL ? '걷고 · 뛰고 · 블록을 치고 · 굼바를 밟아 보세요' : G.level.boss ? '쿠파를 지나 도끼까지! 불꽃 다섯 번이면 쓰러져요' : '깃대까지 달려요!', 1.8); }
function pause() {
  if (state !== 'play') return;
  state = 'paused';
  showOverlay('<h2>일시정지</h2><button data-act="resume">계속하기</button>');
}
function resume() { if (state === 'paused') { state = 'play'; hideOverlay(); } }
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function showBanner(text, sub = '', t = 1.4, color = '#fff') { banner = { text, sub, t, color }; }
function gameOver() {
  state = 'over';
  const record = !TUTORIAL && G.score > best;
  if (record) { best = G.score; store.set('smBest', String(best)); }
  showOverlay(`
    <h2>${G.won ? '🎉 모두 클리어!' : '게임 끝!'}</h2>
    <div class="big">${G.score.toLocaleString('ko-KR')}</div>
    ${record ? '<p><b>🎉 최고 기록!</b></p>' : ''}
    <p>${G.won ? L.STAGES.length + '개 코스를 모두 깼어요!' : `${G.stage}코스(${G.level.name})까지 갔어요`}<br>굼바 밟기 ${G.stats.stomps}번 · 동전 ${G.stats.coinsTotal}개 · 최고 점수 ${best.toLocaleString('ko-KR')}점</p>
    <button data-act="again">${G.won ? '처음부터 다시' : `${G.stage}코스부터 다시`}</button>
    <button data-act="title" class="sub">처음 화면</button>`);
}
function showTitle() {
  state = 'title';
  const stages = L.STAGES.map((s, i) => `<button data-stage="${i + 1}"${i + 1 > unlocked ? ' disabled' : ''}>${i + 1} ${s.name}</button>`).join('');
  $('stages').innerHTML = stages;
  showOverlay($('overlay').innerHTML);
}
$('overlay').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  b.blur();
  if (b.id === 'startBtn') startGame(1);
  else if (b.dataset.stage) startGame(Number(b.dataset.stage));
  else if (b.dataset.act === 'again') startGame(G && !G.won ? G.stage : 1);
  else if (b.dataset.act === 'resume') resume();
  else if (b.dataset.act === 'title') location.reload();
});

// ---------- 갱신 ----------
function update(dt) {
  clock += dt;
  if (banner.t > 0) banner.t -= dt;
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
  for (const b of bumps) b.t += dt;
  bumps = bumps.filter((b) => b.t < 0.2);
  if (state !== 'play' || !G) return;
  const inp = readInput();
  L.step(G, dt, inp);
  if (jumpReq > 0) jumpReq = Math.max(0, jumpReq - dt);
  if (fireReq > 0) fireReq = Math.max(0, fireReq - dt);
  for (const e of G.events) handle(e);
  const sec = Math.ceil(G.timeLeft);
  if (G.phase === 'play' && G.timeLeft < 30 && !G.tutorial && sec !== lastTick) { lastTick = sec; if (G.timeLeft < 10) sfx.tick(); }
}
function handle(e) {
  if (e.t === 'move') tutorialSignal('move');
  else if (e.t === 'jump') { sfx.jump(e.big); jumpReq = 0; tutorialSignal('jump'); }
  else if (e.t === 'coin') { sfx.coin(); if (e.block) tutorialSignal('block'); }
  else if (e.t === 'block') { bumps.push({ tx: e.tx, ty: e.ty, t: 0 }); if (e.ch !== '?') sfx.bump(); tutorialSignal('block'); }
  else if (e.t === 'brick') { sfx.brick(); for (let i = 0; i < 4; i++) fxs.push({ kind: 'brick', x: e.tx * T + 8, y: e.ty * T + 8, vx: (i % 2 ? 1 : -1) * (30 + i * 10), vy: -120 - (i > 1 ? 40 : 0), t: 0, life: 0.9 }); }
  else if (e.t === 'powerup') sfx.powerup();
  else if (e.t === 'power') {
    if (e.type === '1up') { sfx.up1(); showBanner('1UP!', '', 1, '#7dff7d'); }
    else if (e.type === 'star') { sfx.star(); showBanner('별 마리오!', '10초 동안 무적', 1.2, '#ffd23a'); }
    else { sfx.power(); showBanner(e.type === 'flower' ? '불꽃 마리오!' : '커졌다!', '', 1, '#ffd23a'); }
    tutorialSignal('power');
  }
  else if (e.t === 'hurry') { sfx.hurry(); showBanner('서둘러!', '시간이 얼마 안 남았어요', 1.6, '#ff6a6a'); }
  else if (e.t === 'tick') sfx.count();
  else if (e.t === 'crouch') { sfx.crouch(); tutorialSignal('crouch'); }
  else if (e.t === 'warp') { sfx.pipe(); if (e.kind === 'in') tutorialSignal('warp'); }
  else if (e.t === 'room') showBanner('보너스 방!', '동전을 모아 오른쪽 파이프로 나가요', 2.2, '#ffd23a');
  else if (e.t === 'cannon') sfx.cannon();
  else if (e.t === 'hammer') sfx.hammer();
  else if (e.t === 'egg') sfx.egg();
  else if (e.t === 'cheep') sfx.cheep();
  else if (e.t === 'spring') { sfx.spring(); bumps.push({ tx: e.tx, ty: e.ty, t: 0 }); }
  else if (e.t === 'bossFire') sfx.bossFire();
  else if (e.t === 'bossHit') sfx.bossHit();
  else if (e.t === 'bossDead') { sfx.clear(); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 1.2, text: String(e.pts), color: '#ffd23a' }); showBanner('쿠파를 쓰러뜨렸다!', '도끼를 찾아요', 1.8, '#ffd23a'); }
  else if (e.t === 'bossFall') sfx.kill();
  else if (e.t === 'crumble') sfx.crumble();
  else if (e.t === 'axe') { sfx.flag(); showBanner('다리가 무너진다!', e.bonus ? `시간 +${e.bonus}` : '', 3, '#7dff7d'); }
  else if (e.t === 'firework') { sfx.firework(); fxs.push({ kind: 'firework', x: e.x, y: e.y, t: 0, life: 0.7, color: ['#ffd23a', '#ff6a8a', '#7dff7d', '#6ac8ff'][Math.floor(clock * 7) % 4] }); }
  else if (e.t === 'starEnd') sfx.shrink();
  else if (e.t === 'shrink') sfx.shrink();
  else if (e.t === 'stomp') { sfx.stomp(); tutorialSignal('stomp'); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 0.8, text: String(e.pts), color: '#fff' }); }
  else if (e.t === 'kick') sfx.kick();
  else if (e.t === 'kill') { sfx.kill(); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 0.8, text: String(e.pts), color: '#ffd23a' }); }
  else if (e.t === 'fire') sfx.fire();
  else if (e.t === 'flag') { sfx.flag(); showBanner('골인!', `깃대 +${e.pts}${e.bonus ? ` · 시간 +${e.bonus}` : ''}`, 3, '#7dff7d'); }
  else if (e.t === 'clear') { sfx.clear(); tutorialSignal('clear'); if (!G.won && !TUTORIAL && G.stage + 1 > unlocked) { unlocked = G.stage + 1; store.set('smStage', String(unlocked)); } }
  else if (e.t === 'stage' && G.time > 0.2) { announceStage(); }
  else if (e.t === 'dead') { sfx.dead(); showBanner(e.why === 'time' ? '시간 초과!' : '앗!', '', 1.6, '#ff6a6a'); }
  else if (e.t === 'respawn') announceStage();
  else if (e.t === 'extra') { sfx.up1(); showBanner('1UP!', '목숨 +1', 1.2, '#7dff7d'); }
  else if (e.t === 'over') { sfx.over(); setTimeout(gameOver, e.won ? 200 : 500); }
}

// ---------- 그리기 ----------
const RC = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
const THEME = {
  grass: { sky: ['#5c94fc', '#9cd0fc'], ground: '#c84c0c', top: '#58b848', brick: '#c84c0c', hill: '#58b848' },
  cave: { sky: ['#101028', '#1a1a3a'], ground: '#4a4a6a', top: '#6a6a9a', brick: '#6a5a8a', hill: '#24243e' },
  sky: { sky: ['#2c7cfc', '#bce4fc'], ground: '#f0f0f8', top: '#ffffff', brick: '#e0b05a', hill: '#ffffff' },
  castle: { sky: ['#1a0a0a', '#3a1010'], ground: '#5a5a62', top: '#7a7a82', brick: '#8a5a4a', hill: '#2a1414' },
};
function drawBackground(th, camX, themeName) {
  const g = ctx.createLinearGradient(0, HUD, 0, HUD + VH);
  g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, HUD, VW, VH);
  // 멀리 있는 언덕·구름 (카메라의 1/3 만큼만 움직인다)
  const off = camX * 0.3;
  if (themeName === 'grass' || themeName === 'sky') {
    ctx.fillStyle = themeName === 'grass' ? '#3ea040' : 'rgba(255,255,255,.55)';
    for (let i = -1; i < 6; i++) { const x = i * 120 - (off % 120) + 20; ctx.beginPath(); ctx.ellipse(x + 40, HUD + GROUND * T, 46, themeName === 'grass' ? 30 : 14, 0, Math.PI, 0); ctx.fill(); }
    ctx.fillStyle = '#fff';
    for (let i = -1; i < 4; i++) { const x = i * 150 - ((off * 0.6) % 150) + 30, y = HUD + 24 + (i % 2) * 22; ctx.beginPath(); ctx.ellipse(x, y, 16, 7, 0, 0, Math.PI * 2); ctx.ellipse(x + 12, y + 2, 12, 6, 0, 0, Math.PI * 2); ctx.ellipse(x - 12, y + 2, 11, 5, 0, 0, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.fillStyle = th.hill;
    for (let i = -1; i < 8; i++) { const x = i * 70 - (off % 70); ctx.beginPath(); ctx.moveTo(x, HUD + 48); ctx.lineTo(x + 14, HUD + 70 + (i % 3) * 8); ctx.lineTo(x + 28, HUD + 48); ctx.fill(); }
    if (themeName === 'castle') { ctx.fillStyle = 'rgba(255,90,20,.18)'; ctx.fillRect(0, HUD + VH - 24, VW, 24); }
  }
  if (themeName === 'castle') {                                                         // 구멍 아래는 용암
    ctx.fillStyle = '#e04010'; ctx.fillRect(0, HUD + VH - 14, VW, 14); ctx.fillStyle = '#ffa030';
    for (let i = 0; i < 20; i++) ctx.fillRect(((i * 17 - Math.floor(clock * 14)) % VW + VW) % VW, HUD + VH - 14 + (i % 3) * 3, 8, 2);
  }
}
function drawTile(ch, x, y, th, tx, ty) {
  if (ch === '#') {
    const top = ty === GROUND;
    RC(x, y, T, T, th.ground);
    if (top) { RC(x, y, T, 4, th.top); RC(x, y + 4, T, 1, 'rgba(0,0,0,.25)'); }
    RC(x + 1, y + 6, 14, 1, 'rgba(0,0,0,.18)'); RC(x + 7, y + 7, 1, 8, 'rgba(0,0,0,.18)');
  } else if (ch === 'B') {
    RC(x, y, T, T, th.brick); RC(x, y, T, 1, 'rgba(255,255,255,.35)');
    RC(x, y + 5, T, 1, '#000'); RC(x, y + 10, T, 1, '#000'); RC(x + 7, y, 1, 5, '#000'); RC(x + 3, y + 5, 1, 5, '#000'); RC(x + 11, y + 5, 1, 5, '#000'); RC(x + 7, y + 10, 1, 6, '#000');
  } else if (ch === '?' || ch === 'M' || ch === '*' || ch === '1' || ch === '$') {
    const pulse = Math.floor(clock * 4) % 4 === 0;
    RC(x, y, T, T, pulse ? '#fcd84c' : '#f0a020'); RC(x, y, T, 1, '#fff2a0'); RC(x, y + 15, T, 1, '#8a4a00'); RC(x, y, 1, T, '#fff2a0'); RC(x + 15, y, 1, T, '#8a4a00');
    ctx.fillStyle = '#7a3a00'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', x + 8, y + 9);
  } else if (ch === 'U') { RC(x, y, T, T, '#8a6a4a'); RC(x, y, T, 1, '#b08a60'); RC(x + 2, y + 2, 2, 2, '#4a3220'); RC(x + 12, y + 2, 2, 2, '#4a3220'); RC(x + 2, y + 12, 2, 2, '#4a3220'); RC(x + 12, y + 12, 2, 2, '#4a3220'); }
  else if (ch === 'S') { RC(x, y, T, T, '#a08060'); RC(x, y, T, 2, '#e0c8a0'); RC(x, y, 2, T, '#e0c8a0'); RC(x + 14, y, 2, T, '#604830'); RC(x, y + 14, T, 2, '#604830'); }
  else if (ch === 'P' || ch === 'p') {
    const left = G.tiles[ty][tx + 1] === ch && G.tiles[ty][tx - 1] !== ch;
    const pipeTop = ch === 'P';
    RC(x + (pipeTop ? 0 : 1), y, pipeTop ? T : 14, T, '#2cb02c');
    RC(x + (pipeTop ? 1 : 2), y, 3, T, '#8aff8a'); RC(x + (pipeTop ? 12 : 11), y, 3, T, '#1a7a1a');
    if (pipeTop) { RC(x, y, T, 1, '#000'); RC(x, y + T - 1, T, 1, '#1a7a1a'); }
    void left;
  } else if (ch === 'C') {
    const w = Math.abs(Math.cos(clock * 6 + tx)) * 5 + 1;
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.ellipse(x + 8, y + 8, w, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a86a00'; ctx.lineWidth = 1; ctx.stroke();
  } else if (ch === 'E') {
    const lip = G.tiles[ty][tx - 1] !== 'E';
    RC(x, y, T, T, '#2cb02c'); RC(x, y + 1, T, 3, '#8aff8a'); RC(x, y + 12, T, 3, '#1a7a1a');
    if (lip) { RC(x, y, 3, T, '#1a7a1a'); RC(x + 3, y, 1, T, '#000'); }
    if (ty === 9 || G.tiles[ty - 1][tx] !== 'E') RC(x, y, T, 1, '#000'); if (G.tiles[ty + 1][tx] !== 'E') RC(x, y + T - 1, T, 1, '#000');
  } else if (ch === 'N') {                                                              // 대포
    RC(x, y, T, T, '#3a3a44'); RC(x, y, T, 2, '#6a6a78'); RC(x + 1, y + 2, 14, 1, '#1a1a22');
    ctx.fillStyle = '#0a0a10'; ctx.beginPath(); ctx.arc(x + 8, y + 8, 4, 0, Math.PI * 2); ctx.fill(); RC(x, y + 13, T, 3, '#24242c');
  } else if (ch === 'Y') {                                                              // 스프링
    const sq = bumps.find((q) => q.tx === tx && q.ty === ty) ? 3 : 0;
    RC(x + 2, y + 1 + sq, 12, 3, '#d8d8e0'); RC(x + 2, y + 13, 12, 3, '#d8d8e0');
    ctx.strokeStyle = '#38a0f0'; ctx.lineWidth = 2; ctx.beginPath(); for (let k = 0; k < 4; k++) { ctx.moveTo(x + 4, y + 4 + sq + k * (2 - sq / 4)); ctx.lineTo(x + 12, y + 6 + sq + k * (2 - sq / 4)); } ctx.stroke();
  } else if (ch === 'g') {                                                              // 다리
    RC(x, y, T, 5, '#c89050'); RC(x, y, T, 1, '#f0d0a0'); RC(x, y + 5, T, 1, '#5a3a18'); RC(x + 7, y, 1, 5, '#5a3a18');
  } else if (ch === 'A') {                                                              // 도끼
    RC(x + 7, y + 1, 2, 14, '#8a5a2a'); ctx.fillStyle = Math.floor(clock * 4) % 2 ? '#f0f0f8' : '#a8b0c0'; ctx.beginPath(); ctx.moveTo(x + 8, y + 1); ctx.lineTo(x + 2, y + 4); ctx.lineTo(x + 2, y + 9); ctx.lineTo(x + 8, y + 7); ctx.fill();
  } else if (ch === 'F') { RC(x + 7, y, 2, T, '#e8e8e8'); RC(x + 7, y, 1, T, '#fff'); }
  else if (ch === 'f') { RC(x + 7, y + 6, 2, 10, '#e8e8e8'); ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(x + 8, y + 5, 4, 0, Math.PI * 2); ctx.fill(); }
}
function drawTiles(th) {
  const c0 = Math.max(0, Math.floor(G.camX / T)), c1 = Math.min(G.w - 1, Math.floor((G.camX + VW) / T) + 1);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = c0; tx <= c1; tx++) {
    const ch = G.tiles[ty][tx];
    if (ch === '.') continue;
    let dy = 0;
    const b = bumps.find((q) => q.tx === tx && q.ty === ty);
    if (b) dy = -Math.sin((b.t / 0.2) * Math.PI) * 5;
    drawTile(ch, tx * T - Math.round(G.camX), HUD + ty * T + dy, th, tx, ty);
  }
  // 깃발 (깃대 꼭대기 옆에서, 마리오가 잡으면 같이 내려온다)와 성
  const fx = G.level.flag * T - Math.round(G.camX);
  if (!G.inRoom && G.level.flag !== undefined && fx > -60 && fx < VW + 20) {
    const fy = G.flagY === undefined ? 2 * T : G.flagY - 12;
    ctx.fillStyle = '#2cd02c'; ctx.beginPath(); ctx.moveTo(fx + 7, HUD + fy); ctx.lineTo(fx - 9, HUD + fy + 6); ctx.lineTo(fx + 7, HUD + fy + 12); ctx.fill();
    const cx = (G.level.flag + 3) * T - Math.round(G.camX), cy = HUD + GROUND * T;
    RC(cx, cy - 3 * T, 3 * T, 3 * T, '#b0603a'); RC(cx - 4, cy - 3 * T - 5, 3 * T + 8, 6, '#8a4a2a');
    for (let k = 0; k < 4; k++) RC(cx - 4 + k * 14, cy - 3 * T - 11, 8, 6, '#8a4a2a');
    RC(cx + 16, cy - 20, 16, 20, '#201008'); ctx.fillStyle = '#201008'; ctx.beginPath(); ctx.arc(cx + 24, cy - 20, 8, Math.PI, 0); ctx.fill();
  }
}
function drawGoomba(e, x, y) {
  if (e.state === 'flat') { RC(x, y + 8, 12, 4, '#a0603a'); return; }
  const step = Math.floor(clock * 6 + e.id) % 2;
  ctx.fillStyle = '#a0603a'; ctx.beginPath(); ctx.ellipse(x + 6, y + 5, 6.5, 5.5, 0, Math.PI, 0); ctx.fill(); RC(x + 1, y + 5, 10, 4, '#a0603a');
  RC(x + 2, y + 4, 3, 3, '#fff'); RC(x + 7, y + 4, 3, 3, '#fff'); RC(x + 3, y + 5, 1, 2, '#000'); RC(x + 8, y + 5, 1, 2, '#000'); RC(x + 2, y + 3, 4, 1, '#000'); RC(x + 6, y + 3, 4, 1, '#000');
  RC(x + 3, y + 9, 6, 2, '#f0d8a8');
  RC(x + (step ? 0 : 1), y + 10, 4, 2, '#3a2010'); RC(x + (step ? 8 : 7), y + 10, 4, 2, '#3a2010');
}
function drawKoopa(e, x, y) {
  const dir = e.vx >= 0 ? 1 : -1;
  if (e.state === 'shell' || e.state === 'shellMove') {
    ctx.fillStyle = '#2cb02c'; ctx.beginPath(); ctx.ellipse(x + 6, y + 8, 6.5, 7, 0, Math.PI, 0); ctx.fill(); RC(x, y + 8, 12, 4, '#f0e8a0'); RC(x + 3, y + 3, 6, 3, '#58d858');
    if (e.state === 'shellMove') RC(x + 2 + Math.floor(clock * 20) % 3, y + 9, 3, 2, '#c8c070');
    return;
  }
  const step = Math.floor(clock * 6 + e.id) % 2;
  RC(x + 2, y + 6, 8, 8, '#2cb02c'); RC(x + 3, y + 5, 6, 3, '#58d858'); RC(x + 2, y + 10, 8, 3, '#f0e8a0');
  RC(x + (dir > 0 ? 7 : 1), y, 4, 6, '#f0d870'); RC(x + (dir > 0 ? 9 : 2), y + 1, 1, 2, '#000');
  RC(x + (step ? 2 : 4), y + 13, 3, 3, '#f0a020'); RC(x + (step ? 7 : 5), y + 13, 3, 3, '#f0a020');
}
function drawBuzzy(e, x, y) {
  const dir = e.vx >= 0 ? 1 : -1, step = Math.floor(clock * 6 + e.id) % 2;
  ctx.fillStyle = '#28307a'; ctx.beginPath(); ctx.ellipse(x + 6, y + 8, 6.5, 7, 0, Math.PI, 0); ctx.fill(); RC(x, y + 8, 12, 3, '#5a5aa0'); RC(x + 3, y + 3, 5, 3, '#6a74d8');
  if (e.state === 'shell' || e.state === 'shellMove') { if (e.state === 'shellMove') RC(x + 2 + Math.floor(clock * 20) % 3, y + 9, 3, 2, '#8a8ac8'); return; }
  RC(x + (dir > 0 ? 8 : 0), y + 6, 4, 4, '#f0e8d0'); RC(x + (dir > 0 ? 10 : 1), y + 7, 1, 2, '#000');
  RC(x + (step ? 1 : 3), y + 10, 3, 2, '#f0e8d0'); RC(x + (step ? 8 : 6), y + 10, 3, 2, '#f0e8d0');
}
function drawSpiny(e, x, y) {
  if (e.egg) { ctx.fillStyle = '#f0f0e0'; ctx.beginPath(); ctx.arc(x + 6, y + 6, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e83030'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x + 3 + k * 3, y + 4 + (k % 2) * 3, 1.4, 0, Math.PI * 2); ctx.fill(); } return; }
  const dir = e.vx >= 0 ? 1 : -1, step = Math.floor(clock * 6 + e.id) % 2;
  ctx.fillStyle = '#e83030'; ctx.beginPath(); ctx.ellipse(x + 6, y + 8, 6.5, 6.5, 0, Math.PI, 0); ctx.fill(); RC(x, y + 8, 12, 3, '#f0e0a0');
  ctx.fillStyle = '#fff'; for (const k of [0, 3, 6, 9]) { ctx.beginPath(); ctx.moveTo(x + k, y + 5); ctx.lineTo(x + k + 1.5, y); ctx.lineTo(x + k + 3, y + 5); ctx.fill(); }
  RC(x + (dir > 0 ? 8 : 0), y + 6, 4, 4, '#f0d070'); RC(x + (dir > 0 ? 10 : 1), y + 7, 1, 2, '#000');
  RC(x + (step ? 1 : 3), y + 10, 3, 2, '#f0d070'); RC(x + (step ? 8 : 6), y + 10, 3, 2, '#f0d070');
}
function drawHammerBro(e, x, y) {
  const f = e.face || -1, px = (ox, oy, w, h, c) => RC(x + (f > 0 ? ox : e.w - ox - w), y + oy, w, h, c);
  px(2, 0, 10, 4, '#2c9c2c'); px(1, 3, 12, 2, '#1c6c1c');                                  // 헬멧
  px(5, 5, 7, 6, '#f0c878'); px(9, 7, 2, 2, '#000');                                         // 얼굴
  px(2, 10, 9, 8, '#f0f0f0'); px(3, 12, 7, 5, '#2c9c2c');                                    // 등딱지·몸
  const st = Math.floor(clock * 4 + e.id) % 2;
  px(st ? 2 : 4, 18, 4, 6, '#f0c878'); px(st ? 8 : 6, 18, 4, 6, '#f0c878');
  px(-1, 7, 3, 3, '#f0c878');                                                               // 망치 든 팔
  if ((e.hamT || 0) < 0.5) { px(-2, 1, 4, 3, '#a8a8b0'); px(0, 3, 2, 5, '#8a5a2a'); }
}
function drawHammers() {
  for (const hm of G.hammers) {
    const x = Math.round(hm.x - G.camX) + 4, y = HUD + Math.round(hm.y) + 4;
    ctx.save(); ctx.translate(x, y); ctx.rotate(hm.spin * 14 * (hm.vx >= 0 ? 1 : -1));
    RC(-1, -4, 2, 8, '#8a5a2a'); RC(-4, -5, 8, 4, '#a8a8b8'); ctx.restore();
  }
}
function drawLakitu(e, x, y) {
  const f = G.m.x < e.x ? -1 : 1;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x + 8, y + 15, 9, 5, 0, 0, Math.PI * 2); ctx.ellipse(x + 3, y + 13, 5, 4, 0, 0, Math.PI * 2); ctx.ellipse(x + 13, y + 13, 5, 4, 0, 0, Math.PI * 2); ctx.fill();   // 구름
  RC(x + 4, y + 3, 8, 9, '#2c9c2c');                                                          // 등딱지
  RC(x + (f > 0 ? 7 : 4), y + 1, 6, 6, '#f0d870'); RC(x + (f > 0 ? 10 : 5), y + 3, 2, 2, '#000'); RC(x + (f > 0 ? 6 : 3), y - 1, 8, 3, '#e8e8f0');   // 얼굴과 고글
}
function drawCheep(e, x, y) {
  const dir = e.vx >= 0 ? 1 : -1, px = (ox, oy, w, h, c) => RC(x + (dir > 0 ? ox : 12 - ox - w), y + oy, w, h, c);
  px(0, 3, 10, 7, '#e83030'); px(2, 1, 6, 3, '#e83030'); px(8, 4, 3, 5, '#f08060'); px(7, 4, 2, 2, '#fff'); px(8, 5, 1, 1, '#000'); px(10, 3, 2, 6, '#f0a090');
  const fl = Math.floor(clock * 12 + e.id) % 2; px(-2 + fl, 4, 3, 4, '#f0a090');
}
function drawBullet(e, x, y) {
  const dir = e.vx >= 0 ? 1 : -1, px = (ox, oy, w, h, c) => RC(x + (dir > 0 ? ox : 14 - ox - w), y + oy, w, h, c);
  px(0, 1, 9, 10, '#181820'); px(7, 0, 5, 12, '#181820'); px(10, 2, 4, 8, '#181820'); px(9, 3, 3, 3, '#fff'); px(11, 4, 1, 2, '#000'); px(2, 2, 3, 1, '#3a3a48');
  px(-1 + Math.floor(clock * 12) % 2, 4, 2, 4, '#e8a030');
}
function drawPodoboo(e, x, y) {
  ctx.fillStyle = Math.floor(clock * 14) % 2 ? '#ff5010' : '#ffb020'; ctx.beginPath(); ctx.arc(x + 6, y + 6, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffe070'; ctx.beginPath(); ctx.arc(x + 6, y + 7, 3.2, 0, Math.PI * 2); ctx.fill(); RC(x + 3, y + 3, 2, 2, '#fff'); RC(x + 7, y + 3, 2, 2, '#fff'); RC(x + 4, y + 4, 1, 1, '#000'); RC(x + 8, y + 4, 1, 1, '#000');
  if (e.vy < 0) { ctx.fillStyle = 'rgba(255,120,20,.7)'; RC(x + 4, y + 12, 4, 6, 'rgba(255,120,20,.6)'); }
}
function drawBars() {
  for (const b of G.bars) {
    const px = b.cx - G.camX;
    if (px < -60 || px > VW + 60) continue;
    for (const sg of L.barSegments(b)) { const x = Math.round(sg.x - G.camX), y = HUD + Math.round(sg.y); ctx.fillStyle = Math.floor(clock * 16) % 2 ? '#ffd23a' : '#ff6020'; ctx.beginPath(); ctx.arc(x + 3, y + 3, 3.4, 0, Math.PI * 2); ctx.fill(); RC(x + 2, y + 2, 2, 2, '#fff'); }
  }
}
function drawLifts() {
  for (const l of G.lifts) {
    const x = Math.round(l.x - G.camX), y = HUD + Math.round(l.y);
    if (x < -l.w || x > VW) continue;
    RC(x, y, l.w, 6, '#e0a040'); RC(x, y, l.w, 1, '#ffe0a0'); RC(x, y + 5, l.w, 1, '#7a4a10');
    for (let k = 4; k < l.w - 2; k += 12) RC(x + k, y + 2, 4, 2, '#7a4a10');
  }
}
function drawBoss() {
  const b = G.boss;
  if (!b || !b.active && b.state === 'alive') return;
  const x = Math.round(b.x - G.camX), y = HUD + Math.round(b.y), f = b.face;
  if (x < -40 || x > VW + 40 || y > HUD + VH + 40) return;
  ctx.save();
  if (b.state !== 'alive') { ctx.translate(x + 12, y + 14); ctx.rotate(clock * 5); ctx.translate(-(x + 12), -(y + 14)); }
  const px = (ox, oy, w, h, c) => RC(x + (f > 0 ? ox : b.w - ox - w), y + oy, w, h, c);
  const hurt = b.flash > 0 && Math.floor(clock * 30) % 2;
  const shell = hurt ? '#ffffff' : '#2a8a2a', skin = hurt ? '#ffe0e0' : '#e0b030';
  px(0, 6, 4, 14, '#e0a020'); px(2, 8, 14, 16, shell); px(4, 10, 4, 4, '#58d858'); px(10, 10, 4, 4, '#58d858'); px(4, 16, 4, 4, '#58d858'); px(10, 16, 4, 4, '#58d858');     // 등딱지
  px(12, 2, 12, 12, skin); px(20, 6, 4, 8, '#f0d070'); px(14, 4, 4, 4, '#fff'); px(16, 5, 2, 2, '#000'); px(11, 0, 3, 5, '#d83020'); px(18, 0, 3, 4, '#d83020');                  // 머리
  px(20, 11, 4, 3, '#fff');                                                                                                                                                       // 이빨
  const st = Math.floor(clock * 4) % 2;
  px(4 + (st ? 0 : 2), 22, 6, 6, skin); px(14 - (st ? 0 : 2), 22, 6, 6, skin); px(14, 14, 6, 6, skin);
  ctx.restore();
}
function drawHazards() {
  for (const f of G.hazards) {
    const x = Math.round(f.x - G.camX), y = HUD + Math.round(f.y), dir = f.vx >= 0 ? 1 : -1;
    ctx.fillStyle = '#ff5010'; ctx.beginPath(); ctx.ellipse(x + 8, y + 4, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.ellipse(x + 8 + dir * 2, y + 4, 5, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  }
}
function drawEnemies() {
  for (const e of G.enemies) {
    if (!e.active) continue;
    const x = Math.round(e.x - G.camX), y = HUD + Math.round(e.y);
    if (x < -20 || x > VW + 20) continue;
    ctx.save();
    if (e.state === 'dead') { ctx.translate(x + e.w / 2, y + e.h / 2); ctx.scale(1, -1); ctx.translate(-(x + e.w / 2), -(y + e.h / 2)); }
    if (e.type === 'goomba') drawGoomba(e, x, y);
    else if (e.type === 'bullet') drawBullet(e, x, y);
    else if (e.type === 'podoboo') drawPodoboo(e, x, y);
    else if (e.type === 'buzzy') drawBuzzy(e, x, y);
    else if (e.type === 'spiny') drawSpiny(e, x, y);
    else if (e.type === 'hammerbro') drawHammerBro(e, x, y);
    else if (e.type === 'lakitu') drawLakitu(e, x, y);
    else if (e.type === 'cheep') drawCheep(e, x, y);
    else drawKoopa(e, x, y);
    ctx.restore();
  }
}
function drawPlants() {
  for (const p of G.plants) {
    const x = Math.round(p.x - G.camX), y = HUD + Math.round(p.y);
    if (x < -20 || x > VW + 20 || p.extent <= 0) continue;
    const open = Math.floor(clock * 5) % 2;
    RC(x + 4, y + 8, 4, 12, '#2cb02c');                                                  // 줄기
    ctx.fillStyle = '#e83030'; ctx.beginPath(); ctx.arc(x + 6, y + 5, 6, 0, Math.PI * 2); ctx.fill();   // 머리
    RC(x + 3, y + 2, 2, 2, '#fff'); RC(x + 8, y + 3, 2, 2, '#fff'); RC(x + 5, y + 7, 2, 2, '#fff');
    RC(x, y + 4 + (open ? 0 : 2), 12, open ? 3 : 1, '#fff8f0');                         // 벌어진 입
    RC(x - 2, y + 8, 5, 3, '#2cb02c'); RC(x + 9, y + 8, 5, 3, '#2cb02c');                // 잎
  }
}
function drawItems() {
  for (const it of G.items) {
    const x = Math.round(it.x - G.camX), y = HUD + Math.round(it.y);
    if (it.type === 'mushroom') { ctx.fillStyle = '#e83030'; ctx.beginPath(); ctx.ellipse(x + 6, y + 6, 6.5, 6, 0, Math.PI, 0); ctx.fill(); RC(x + 3, y + 3, 3, 3, '#fff'); RC(x + 8, y + 2, 2, 3, '#fff'); RC(x + 2, y + 6, 8, 5, '#f8e0b0'); RC(x + 4, y + 7, 1, 2, '#000'); RC(x + 7, y + 7, 1, 2, '#000'); }
    else if (it.type === '1up') { ctx.fillStyle = '#28b848'; ctx.beginPath(); ctx.ellipse(x + 6, y + 6, 6.5, 6, 0, Math.PI, 0); ctx.fill(); RC(x + 3, y + 3, 3, 3, '#fff'); RC(x + 8, y + 2, 2, 3, '#fff'); RC(x + 2, y + 6, 8, 5, '#f8e0b0'); RC(x + 4, y + 7, 1, 2, '#000'); RC(x + 7, y + 7, 1, 2, '#000'); }
    else if (it.type === 'star') { const cols = ['#ffd23a', '#f08020', '#fff2a0', '#ffd23a']; ctx.fillStyle = cols[Math.floor(clock * 12) % 4]; ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 3 : 6.5; ctx.lineTo(x + 6 + Math.cos(a) * r, y + 6 + Math.sin(a) * r); } ctx.closePath(); ctx.fill(); RC(x + 4, y + 5, 1, 2, '#000'); RC(x + 7, y + 5, 1, 2, '#000'); }
    else { const f = Math.floor(clock * 6) % 2; ctx.fillStyle = f ? '#f08020' : '#e83030'; ctx.beginPath(); ctx.arc(x + 6, y + 5, 5, 0, Math.PI * 2); ctx.fill(); RC(x + 5, y + 8, 2, 4, '#2cb02c'); RC(x + 3, y + 3, 6, 4, '#ffd23a'); RC(x + 5, y + 4, 2, 2, '#fff'); }
  }
  for (const f of G.fireballs) { const x = Math.round(f.x - G.camX), y = HUD + Math.round(f.y); ctx.fillStyle = Math.floor(clock * 20) % 2 ? '#ffd23a' : '#f05010'; ctx.beginPath(); ctx.arc(x + 3, y + 3, 3.2, 0, Math.PI * 2); ctx.fill(); }
}
function drawMario() {
  const m = G.m;
  if (m.invuln > 0 && !m.dead && Math.floor(m.invuln * 14) % 2) return;
  if (m.hidden) return;
  const x = Math.round(m.x - G.camX), y = HUD + Math.round(m.y), f = m.face;
  let suit = m.size === 'fire' ? '#f8f8f8' : '#e83030', pants = m.size === 'fire' ? '#e83030' : '#2c5cd8';
  if (m.star > 0) { const pal = [['#e83030', '#2c5cd8'], ['#f8f8f8', '#e83030'], ['#f0c020', '#2c9c2c'], ['#40c040', '#e83030']]; [suit, pants] = pal[Math.floor(clock * (m.star < 2 ? 8 : 16)) % 4]; }
  const big = m.size !== 'small', hh = m.h;
  const run = Math.abs(m.vx) > 5 && m.onGround, step = Math.floor(clock * (Math.abs(m.vx) > 100 ? 14 : 9)) % 2;
  const px = (ox, oy, w, h, c) => RC(x + (f > 0 ? ox : 12 - ox - w), y + oy, w, h, c);
  if (m.crouch) {                                                                       // 앉은 모습: 머리와 몸이 납작하게
    px(2, 0, 9, 3, suit); px(1, 2, 5, 2, suit);
    px(3, 3, 8, 5, '#f8c898'); px(8, 4, 2, 2, '#000'); px(4, 7, 7, 1, '#6a3a12');
    px(0, 8, 12, 5, suit); px(1, 10, 10, 3, pants);
    px(0, 13, 5, 3, '#6a3a12'); px(7, 13, 5, 3, '#6a3a12');
    return;
  }
  if (m.dead) { px(1, 4, 10, 8, suit); px(2, 0, 8, 5, '#f8c898'); px(1, -2, 10, 3, suit); return; }
  const top = big ? hh - 28 : 0;
  px(2, top, 9, 3, suit); px(1, top + 2, 5, 2, suit);                                  // 모자
  px(3, top + 4, 8, 5, '#f8c898'); px(8, top + 5, 2, 2, '#000'); px(4, top + 8, 7, 1, '#6a3a12'); // 얼굴과 콧수염
  const bodyY = top + 9, bodyH = big ? 12 : 3;
  px(1, bodyY, 10, bodyH, suit); px(2, bodyY + (big ? 5 : 0), 8, big ? 7 : 3, pants);
  px(m.onGround ? (step && run ? 0 : 1) : 0, hh - 3 + 0, 5, 3, '#6a3a12'); px(m.onGround ? (step && run ? 7 : 6) : 7, hh - 3, 5, 3, '#6a3a12');
  if (!m.onGround) px(10, bodyY + 1, 3, 3, suit);                                      // 점프할 때 팔을 든다
  if (m.skid) px(-1, hh - 5, 3, 2, 'rgba(255,255,255,.7)');                            // 미끄러지며 먼지
}
function drawFx() {
  for (const f of fxs) {
    const k = f.t / f.life;
    if (f.kind === 'text') { ctx.globalAlpha = 1 - k * k; ctx.fillStyle = f.color; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2.5; const x = f.x - G.camX, y = HUD + f.y - k * 18; ctx.strokeText(f.text, x, y); ctx.fillText(f.text, x, y); ctx.globalAlpha = 1; }
    else if (f.kind === 'firework') {
      const x = f.x - G.camX, y = HUD + f.y, r = 4 + k * 16;
      ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color;
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; ctx.fillRect(x + Math.cos(a) * r - 1, y + Math.sin(a) * r - 1, 3, 3); }
      ctx.globalAlpha = 1;
    }
    else if (f.kind === 'brick') { const x = f.x - G.camX + f.vx * f.t, y = HUD + f.y + f.vy * f.t + 500 * f.t * f.t; ctx.globalAlpha = 1 - k; RC(x - 3, y - 3, 6, 6, '#c84c0c'); ctx.globalAlpha = 1; }
  }
}
function drawHud() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, HUD);
  ctx.font = 'bold 9px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = '#fff'; ctx.fillText(`${G ? String(G.score).padStart(6, '0') : '000000'}`, 4, HUD / 2);
  if (G) {
    ctx.fillStyle = '#ffd23a'; ctx.fillText(`◉×${String(G.coins).padStart(2, '0')}`, 52, HUD / 2);
    ctx.fillStyle = '#fff'; ctx.fillText(`${G.stage}코스`, 94, HUD / 2);
    ctx.fillStyle = G.timeLeft < 30 && !G.tutorial ? '#ff6a6a' : '#fff'; ctx.fillText(G.tutorial ? '연습' : `⏱${Math.ceil(G.timeLeft)}`, 126, HUD / 2);
    ctx.fillStyle = '#ff6a8a'; ctx.fillText(`♥×${G.lives}`, 164, HUD / 2);
  }
}
function draw() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, CH);
  if (!G) { ctx.fillStyle = '#5c94fc'; ctx.fillRect(0, HUD, VW, VH); drawHud(); return; }
  const th = THEME[G.inRoom ? 'cave' : G.level.theme];
  ctx.save(); ctx.beginPath(); ctx.rect(0, HUD, VW, VH); ctx.clip();
  drawBackground(th, G.camX, G.inRoom ? 'cave' : G.level.theme);
  drawPlants(); drawItems(); drawLifts();
  if (G.phase === 'warp') drawMario();                                                 // 파이프에 들어가고 나올 때는 파이프가 마리오를 가린다
  drawTiles(th);
  drawEnemies(); drawBoss(); drawBars(); drawHazards(); drawHammers(); if (G.phase !== 'warp') drawMario(); drawFx();
  ctx.restore();
  drawHud();
  if (banner.t > 0) {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, HUD + 58, VW, banner.sub ? 42 : 26);
    ctx.fillStyle = banner.color; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, VW / 2, HUD + 71);
    if (banner.sub) { ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, VW / 2, HUD + 89); }
  }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() { muted = !muted; store.set('smMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
showTitle();
requestAnimationFrame(frame);
