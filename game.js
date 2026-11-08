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
const pad = { left: false, right: false, run: false, jump: false };
const K = { left: ['ArrowLeft', 'a', 'A'], right: ['ArrowRight', 'd', 'D'] };
const JUMP = [' ', 'z', 'Z', 'ArrowUp', 'w', 'W'], RUN = ['x', 'X', 'Shift'];
const heldAny = (list) => list.some((k) => keys.has(k));
let fireReq = 0;
addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (state === 'play') pause(); else if (state === 'paused') resume(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  const mine = K.left.includes(e.key) || K.right.includes(e.key) || JUMP.includes(e.key) || RUN.includes(e.key);
  if (mine) e.preventDefault();
  if ((e.key === ' ' || e.key === 'Enter') && (state === 'title' || state === 'over') && !e.repeat) { startGame(state === 'over' && G && !G.won ? G.stage : 1); return; }
  if (JUMP.includes(e.key) && !e.repeat) jumpReq = 0.12;
  if (RUN.includes(e.key) && !e.repeat) fireReq = 0.12;
  keys.add(e.key);
});
addEventListener('keyup', (e) => { keys.delete(e.key); });
addEventListener('blur', () => { keys.clear(); pad.left = pad.right = pad.run = pad.jump = false; for (const b of document.querySelectorAll('#controls button')) b.classList.remove('on'); });

function bindHold(el, on, off) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} el.classList.add('on'); on(); });
  const up = () => { el.classList.remove('on'); off(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
}
bindHold($('leftBt'), () => { pad.left = true; }, () => { pad.left = false; });
bindHold($('rightBt'), () => { pad.right = true; }, () => { pad.right = false; });
bindHold($('runBt'), () => { pad.run = true; fireReq = 0.12; }, () => { pad.run = false; });
bindHold($('jumpBt'), () => { pad.jump = true; jumpReq = 0.12; }, () => { pad.jump = false; });
const readInput = () => ({
  left: heldAny(K.left) || pad.left, right: heldAny(K.right) || pad.right,
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
function announceStage() { showBanner(TUTORIAL ? '연습' : `${G.stage}코스 ${G.level.name}`, TUTORIAL ? '걷고 · 뛰고 · 블록을 치고 · 굼바를 밟아 보세요' : '깃대까지 달려요!', 1.8); }
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
    <p>${G.won ? '4개 코스를 모두 깼어요!' : `${G.stage}코스(${G.level.name})까지 갔어요`}<br>굼바 밟기 ${G.stats.stomps}번 · 동전 ${G.stats.coinsTotal}개 · 최고 점수 ${best.toLocaleString('ko-KR')}점</p>
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
  else if (e.t === 'power') { sfx.power(); tutorialSignal('power'); showBanner(e.type === 'flower' ? '불꽃 마리오!' : '커졌다!', '', 1, '#ffd23a'); }
  else if (e.t === 'shrink') sfx.shrink();
  else if (e.t === 'stomp') { sfx.stomp(); tutorialSignal('stomp'); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 0.8, text: String(e.pts), color: '#fff' }); }
  else if (e.t === 'kick') sfx.kick();
  else if (e.t === 'kill') { sfx.kill(); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 0.8, text: String(e.pts), color: '#ffd23a' }); }
  else if (e.t === 'fire') sfx.fire();
  else if (e.t === 'flag') { sfx.flag(); showBanner('골인!', `깃대 +${e.pts}${e.bonus ? ` · 시간 +${e.bonus}` : ''}`, 3, '#7dff7d'); }
  else if (e.t === 'clear') { setTimeout(() => sfx.clear(), 900); tutorialSignal('clear'); if (!G.won && !TUTORIAL && G.stage + 1 > unlocked) { unlocked = G.stage + 1; store.set('smStage', String(unlocked)); } }
  else if (e.t === 'stage' && G.time > 0.2) { announceStage(); }
  else if (e.t === 'dead') { sfx.dead(); showBanner(e.why === 'time' ? '시간 초과!' : '앗!', '', 1.6, '#ff6a6a'); }
  else if (e.t === 'respawn') announceStage();
  else if (e.t === 'extra') { sfx.extra(); showBanner('목숨 +1', '', 1.2, '#ff9bd0'); }
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
function drawBackground(th, camX) {
  const g = ctx.createLinearGradient(0, HUD, 0, HUD + VH);
  g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, HUD, VW, VH);
  // 멀리 있는 언덕·구름 (카메라의 1/3 만큼만 움직인다)
  const off = camX * 0.3;
  if (G.level.theme === 'grass' || G.level.theme === 'sky') {
    ctx.fillStyle = G.level.theme === 'grass' ? '#3ea040' : 'rgba(255,255,255,.55)';
    for (let i = -1; i < 6; i++) { const x = i * 120 - (off % 120) + 20; ctx.beginPath(); ctx.ellipse(x + 40, HUD + GROUND * T, 46, G.level.theme === 'grass' ? 30 : 14, 0, Math.PI, 0); ctx.fill(); }
    ctx.fillStyle = '#fff';
    for (let i = -1; i < 4; i++) { const x = i * 150 - ((off * 0.6) % 150) + 30, y = HUD + 24 + (i % 2) * 22; ctx.beginPath(); ctx.ellipse(x, y, 16, 7, 0, 0, Math.PI * 2); ctx.ellipse(x + 12, y + 2, 12, 6, 0, 0, Math.PI * 2); ctx.ellipse(x - 12, y + 2, 11, 5, 0, 0, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.fillStyle = th.hill;
    for (let i = -1; i < 8; i++) { const x = i * 70 - (off % 70); ctx.beginPath(); ctx.moveTo(x, HUD + 48); ctx.lineTo(x + 14, HUD + 70 + (i % 3) * 8); ctx.lineTo(x + 28, HUD + 48); ctx.fill(); }
    if (G.level.theme === 'castle') { ctx.fillStyle = 'rgba(255,90,20,.18)'; ctx.fillRect(0, HUD + VH - 24, VW, 24); }
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
  } else if (ch === '?' || ch === 'M') {
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
  // 깃발 (깃대 꼭대기 옆)
  const fx = G.level.flag * T - Math.round(G.camX);
  if (fx > -40 && fx < VW + 20) { ctx.fillStyle = '#2cd02c'; ctx.beginPath(); ctx.moveTo(fx + 7, HUD + 2 * T); ctx.lineTo(fx - 9, HUD + 2 * T + 6); ctx.lineTo(fx + 7, HUD + 2 * T + 12); ctx.fill(); }
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
function drawEnemies() {
  for (const e of G.enemies) {
    if (!e.active) continue;
    const x = Math.round(e.x - G.camX), y = HUD + Math.round(e.y);
    if (x < -20 || x > VW + 20) continue;
    ctx.save();
    if (e.state === 'dead') { ctx.translate(x + e.w / 2, y + e.h / 2); ctx.scale(1, -1); ctx.translate(-(x + e.w / 2), -(y + e.h / 2)); }
    if (e.type === 'goomba') drawGoomba(e, x, y); else drawKoopa(e, x, y);
    ctx.restore();
  }
}
function drawItems() {
  for (const it of G.items) {
    const x = Math.round(it.x - G.camX), y = HUD + Math.round(it.y);
    if (it.type === 'mushroom') { ctx.fillStyle = '#e83030'; ctx.beginPath(); ctx.ellipse(x + 6, y + 6, 6.5, 6, 0, Math.PI, 0); ctx.fill(); RC(x + 3, y + 3, 3, 3, '#fff'); RC(x + 8, y + 2, 2, 3, '#fff'); RC(x + 2, y + 6, 8, 5, '#f8e0b0'); RC(x + 4, y + 7, 1, 2, '#000'); RC(x + 7, y + 7, 1, 2, '#000'); }
    else { const f = Math.floor(clock * 6) % 2; ctx.fillStyle = f ? '#f08020' : '#e83030'; ctx.beginPath(); ctx.arc(x + 6, y + 5, 5, 0, Math.PI * 2); ctx.fill(); RC(x + 5, y + 8, 2, 4, '#2cb02c'); RC(x + 3, y + 3, 6, 4, '#ffd23a'); RC(x + 5, y + 4, 2, 2, '#fff'); }
  }
  for (const f of G.fireballs) { const x = Math.round(f.x - G.camX), y = HUD + Math.round(f.y); ctx.fillStyle = Math.floor(clock * 20) % 2 ? '#ffd23a' : '#f05010'; ctx.beginPath(); ctx.arc(x + 3, y + 3, 3.2, 0, Math.PI * 2); ctx.fill(); }
}
function drawMario() {
  const m = G.m;
  if (m.invuln > 0 && !m.dead && Math.floor(m.invuln * 14) % 2) return;
  const x = Math.round(m.x - G.camX), y = HUD + Math.round(m.y), f = m.face;
  const suit = m.size === 'fire' ? '#f8f8f8' : '#e83030', pants = m.size === 'fire' ? '#e83030' : '#2c5cd8';
  const big = m.size !== 'small', hh = m.h;
  const run = Math.abs(m.vx) > 5 && m.onGround, step = Math.floor(clock * (Math.abs(m.vx) > 100 ? 14 : 9)) % 2;
  const px = (ox, oy, w, h, c) => RC(x + (f > 0 ? ox : 12 - ox - w), y + oy, w, h, c);
  if (m.dead) { px(1, 4, 10, 8, suit); px(2, 0, 8, 5, '#f8c898'); px(1, -2, 10, 3, suit); return; }
  const top = big ? hh - 28 : 0;
  px(2, top, 9, 3, suit); px(1, top + 2, 5, 2, suit);                                  // 모자
  px(3, top + 4, 8, 5, '#f8c898'); px(8, top + 5, 2, 2, '#000'); px(4, top + 8, 7, 1, '#6a3a12'); // 얼굴과 콧수염
  const bodyY = top + 9, bodyH = big ? 12 : 3;
  px(1, bodyY, 10, bodyH, suit); px(2, bodyY + (big ? 5 : 0), 8, big ? 7 : 3, pants);
  px(m.onGround ? (step && run ? 0 : 1) : 0, hh - 3 + 0, 5, 3, '#6a3a12'); px(m.onGround ? (step && run ? 7 : 6) : 7, hh - 3, 5, 3, '#6a3a12');
  if (!m.onGround) px(10, bodyY + 1, 3, 3, suit);                                      // 점프할 때 팔을 든다
}
function drawFx() {
  for (const f of fxs) {
    const k = f.t / f.life;
    if (f.kind === 'text') { ctx.globalAlpha = 1 - k * k; ctx.fillStyle = f.color; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2.5; const x = f.x - G.camX, y = HUD + f.y - k * 18; ctx.strokeText(f.text, x, y); ctx.fillText(f.text, x, y); ctx.globalAlpha = 1; }
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
  const th = THEME[G.level.theme];
  ctx.save(); ctx.beginPath(); ctx.rect(0, HUD, VW, VH); ctx.clip();
  drawBackground(th, G.camX);
  drawTiles(th);
  drawItems(); drawEnemies(); drawMario(); drawFx();
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
