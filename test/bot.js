'use strict';
// 코스 완주 봇 (앞을 미리 돌려 보는 방식).
// 매 프레임 「그냥 달리기」를 약 70프레임 미리 돌려 보고, 괜찮으면 그대로 달린다.
// 다치거나 죽거나 막혀 설 것 같으면 「크게 뛰기 / 낮게 뛰기 / 공중에서 방향 바꾸기(물속은 헤엄 박자)」를 각각 미리 돌려 보고
// 다치지 않고 가장 멀리 가는 것을 고른다. 사람이 길을 읽고 고르는 것과 같다. 코스에 건널 길이 있는지 확인하는 데 쓴다.
const L = require('../logic.js');

// 상태 복사: 객체·배열·Set·Map 은 깊게, 함수(난수)와 코스 설계도(level)는 그대로 쓴다
function clone(v, memo = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (memo.has(v)) return memo.get(v);
  let o;
  if (Array.isArray(v)) { o = []; memo.set(v, o); for (let i = 0; i < v.length; i++) o[i] = clone(v[i], memo); return o; }
  if (v instanceof Set) { o = new Set(); memo.set(v, o); v.forEach((x) => o.add(clone(x, memo))); return o; }
  if (v instanceof Map) { o = new Map(); memo.set(v, o); v.forEach((x, k) => o.set(k, clone(x, memo))); return o; }
  o = {}; memo.set(v, o);
  for (const k of Object.keys(v)) o[k] = k === 'level' ? v[k] : clone(v[k], memo);
  return o;
}

const DT = 1 / 60;
const H = 45;                                               // 미리 돌려 보는 프레임 수
const PLANS = [
  { name: 'run', steer: 1, jump: false, hold: 0 },
  { name: 'big', steer: 1, jump: true, hold: 40 },
  { name: 'mid', steer: 1, jump: true, hold: 16 },
  { name: 'hop', steer: 1, jump: true, hold: 6 },
  { name: 'big+8', steer: 1, jump: true, hold: 40, delay: 8 },
  { name: 'hop+8', steer: 1, jump: true, hold: 6, delay: 8 },
  { name: 'big+16', steer: 1, jump: true, hold: 40, delay: 16 },
  { name: 'hop+16', steer: 1, jump: true, hold: 6, delay: 16 },
  { name: 'big+26', steer: 1, jump: true, hold: 40, delay: 26 },
  { name: 'big-n', steer: 0, jump: true, hold: 40 },
  { name: 'hop-n', steer: 0, jump: true, hold: 8 },
  { name: 'wait', steer: 0, jump: false, hold: 0 },
  { name: 'back', steer: -1, jump: false, hold: 0 },
  { name: 'back-big', steer: -1, jump: true, hold: 40 },
];
const SWIMS = [0, 6, 10, 15, 22, 34].map((k) => ({ name: 'swim' + k, steer: 1, swim: k }));

function inputAt(plan, i, airborne, off = 0) {
  const swim = plan.swim !== undefined;
  return {
    right: plan.steer > 0, left: plan.steer < 0, run: true, fire: i % 10 === 0,
    jump: swim ? (plan.swim > 0 && (i + off) % plan.swim === 0) : (plan.jump && i === (plan.delay || 0)),
    jumpHeld: swim ? false : (plan.jump && i >= (plan.delay || 0) && i < (plan.delay || 0) + plan.hold),
  };
}

// 계획 하나를 미리 돌려 점수를 낸다: 죽으면 크게 깎이고, 다치면 깎이고, 깃대·도끼에 닿으면 크게 오른다. 나머지는 멀리 갈수록 좋다
function rollout(st, plan, frames, airborne, off = 0) {
  const c = clone(st); c.rand = L.rng(7);
  const size0 = c.m.size, lives0 = c.lives; let hurt = false;
  for (let i = 0; i < frames; i++) {
    L.step(c, DT, inputAt(plan, i, airborne, off));
    for (const e of c.events) { if (e.t === 'flag' || e.t === 'axe') return { score: 1e6 - i, x: c.m.x }; if (e.t === 'shrink') hurt = true; }
    if (c.m.dead || c.lives < lives0 || c.phase === 'dying' || c.phase === 'over') return { score: -1e6 + i, x: c.m.x };
    if (c.stage !== st.stage) return { score: 1e6, x: c.m.x };
  }
  // 계획이 끝난 뒤 가만히 30프레임 더 두고 구멍에 떨어지는지 본다(공중에서 구멍 위로 날아가 끝나는 계획을 걸러 낸다)
  for (let i = 0; i < 30; i++) {
    L.step(c, DT, {});
    if (c.events.some((e) => e.t === 'dead' && e.why === 'pit') || c.phase === 'dying') return { score: -5e5 + c.m.x, x: c.m.x };
    if (c.m.onGround && i > 4) break;
  }
  const rank = { small: 0, big: 1, fire: 2 };
  if (rank[c.m.size] < rank[size0]) hurt = true;
  return { score: c.m.x - (hurt ? 5000 : 0) + (c.m.onGround ? 3 : 0), x: c.m.x };
}

// stage 코스를 완주해 본다. 결과: { cleared, deaths, frames, sec, x }
function play(stage, seed = 1, opts = {}) {
  const st = L.newGame(L.rng(seed), stage, { lives: opts.lives || 99 });
  if (opts.mutate) opts.mutate(st);                          // 시험용: 코스를 일부러 바꿔 본다
  const maxF = Math.round(60 * (opts.maxSec || 200));
  let deaths = 0, f = 0, cleared = false, cur = null, stallX = 0, stallF = 0, last = null;
  const deathLog = [];
  while (f < maxF && !cleared) {
    f++;
    if (st.phase !== 'play') { L.step(st, DT, {}); }
    else {
      const m = st.m, water = !!st.level.water && !st.inRoom, air = !m.onGround;
      const plans = water ? SWIMS : (cur ? [cur, ...PLANS] : PLANS);        // 정해 둔 늦은 점프가 있으면 그것을 먼저 본다(프레임마다 마음이 바뀌어 타이밍을 놓치지 않게)
      // 기본 계획(그냥 달리기)이 괜찮으면 그대로 간다. 괜찮지 않거나 공중이면 모든 계획을 비교한다
      const base = rollout(st, plans[0], H, air, f);
      let pick = plans[0];
      let ok = base.score > st.m.x + 60 && base.score < 1e5 || base.score >= 1e5;
      if (ok && !air) { const far = rollout(st, plans[0], H * 2, air, f); ok = far.score > st.m.x + 120 || far.score >= 1e5; }      // 더 멀리 봐도 괜찮아야 그냥 달린다
      if (!ok || (air && !water)) {
        let best = base.score, bp = plans[0];
        for (let k = 1; k < plans.length; k++) { const r = rollout(st, plans[k], H, air, f); if (r.score > best + 3) { best = r.score; bp = plans[k]; } }
        pick = bp;
      }
      cur = pick.delay > 0 && pick.jump ? { ...pick, delay: pick.delay - 1 } : null;
      last = pick;
      if (opts.trace) opts.trace(f, st, pick);
      // 막혀서 오래 서 있으면 뒤로 물러났다 다시 뛴다(가끔 계획이 모두 비슷해 갇힐 때)
      if (Math.abs(m.x - stallX) < 2) stallF++; else { stallX = m.x; stallF = 0; }
      const deadBefore = st.lives;
      const inp = inputAt(pick, 0, air, f);
      if (stallF > 90 && !air) { inp.left = true; inp.right = false; if (stallF > 120) stallF = 0; }
      L.step(st, DT, inp);
      for (const e of st.events) {
        if (e.t === 'flag' || e.t === 'axe') cleared = true;
        if (e.t === 'dead') { deaths++; deathLog.push({ x: Math.round(m.x), why: e.why, plan: pick.name, f }); }
      }
      continue;
    }
    for (const e of st.events) {
      if (e.t === 'flag' || e.t === 'axe') cleared = true;
      if (e.t === 'dead') deaths++;
    }
    if (st.phase === 'over') break;
  }
  return { cleared, deaths, frames: f, sec: Math.round(f / 60), x: Math.round(st.m.x), size: st.m.size, deathLog };
}

module.exports = { play, clone, rollout, PLANS };
