'use strict';
// 슈퍼마리오 풍 코스 4개. 글자 지도가 아니라 '땅 구간 + 설치물 목록'으로 만들어 판마다 규칙(구멍 폭 등)을 시험할 수 있다.
// 한 칸 = 16픽셀, 세로 13칸(0~12). 땅은 11~12 줄. 위쪽이 0.
//   . 빈 곳  # 땅(딱딱함)  B 벽돌  ? 동전 블록  M 버섯·꽃 블록  * 별 블록  1 1UP 버섯 블록  $ 동전 여러 개 블록  U 쓴 블록  S 단단한 블록
//   P/p 파이프(윗부분/몸통)  C 동전  F 깃대  f 깃대 꼭대기  E 보너스 방 출구 파이프 입구(걸어 들어감)
//   H 숨은 블록(아래에서 치면 나타나 1UP)  N 대포  Y 스프링  g 다리(쿠파 성)  A 도끼
//   식물(piranhas)·들어갈 수 있는 파이프(warps: 들어가는 파이프 x, 나오는 파이프 x)는 파이프 왼쪽 칸 x 로 적는다
const LEVELS_SM = (() => {
  const T = 16, ROWS = 13, GROUND = 11;

  function make(spec) {
    const w = spec.w;
    const tiles = Array.from({ length: ROWS }, () => new Array(w).fill('.'));
    for (const [a, b] of spec.ground) for (let x = a; x <= b; x++) { tiles[GROUND][x] = '#'; tiles[GROUND + 1][x] = '#'; }
    if (spec.ceiling) for (let x = 0; x < (spec.ceilingEnd || w); x++) for (let y = 0; y < spec.ceiling; y++) tiles[y][x] = '#';        // 깃대 근처는 하늘이 열려 있다
    for (const p of spec.pipes || []) for (let k = 0; k < 2; k++) for (let h = 1; h <= p.h; h++) tiles[GROUND - h][p.x + k] = h === p.h ? 'P' : 'p';
    for (const [x, y, ch] of spec.blocks || []) tiles[y][x] = ch;
    for (const [x0, x1, y, ch] of spec.rows || []) for (let x = x0; x <= x1; x++) tiles[y][x] = ch;
    for (const s of spec.stairs || []) for (let i = 0; i < s.n; i++) for (let h = 1; h <= i + 1; h++) tiles[GROUND - h][s.dir > 0 ? s.x + i : s.x - i] = 'S';
    for (const [x, y] of spec.coins || []) if (tiles[y][x] === '.') tiles[y][x] = 'C';
    for (const [x, y] of spec.cannons || []) tiles[y][x] = 'N';
    for (const [x, y] of spec.springs || []) tiles[y][x] = 'Y';
    for (const b of spec.bars || []) tiles[b.y][b.x] = 'S';                 // 불꽃 막대가 도는 중심 블록
    if (spec.bridge) for (let x = spec.bridge[0]; x <= spec.bridge[1]; x++) { tiles[GROUND][x] = 'g'; tiles[GROUND + 1][x] = '.'; }
    if (spec.axe) tiles[spec.axe[1]][spec.axe[0]] = 'A';
    // 깃대 (쿠파 성에는 없다)
    const fx = spec.flag;
    if (fx !== undefined) {
      for (let y = 2; y < GROUND; y++) tiles[y][fx] = 'F';
      tiles[1][fx] = 'f';
      tiles[GROUND - 1][fx] = 'S';                                            // 깃대 아래 받침
      for (let y = 2; y < GROUND - 1; y++) tiles[y][fx] = 'F';
    }
    const plants = (spec.piranhas || []).map((px) => { const p = spec.pipes.find((q) => q.x === px); return { x: px, topY: (GROUND - p.h) * T }; });
    const topOf = (px) => (GROUND - spec.pipes.find((q) => q.x === px).h) * T;
    const warps = (spec.warps || []).map(([x, ex]) => ({ x, topY: topOf(x), exitX: ex, exitTopY: topOf(ex) }));
    return {
      name: spec.name, theme: spec.theme, w, tiles, spawns: spec.enemies.map((e) => ({ ...e })), plants, warps, time: spec.time, flag: fx, ground: spec.ground, start: spec.start || 2,
      cannons: (spec.cannons || []).map(([x, y]) => ({ x: x * T, y: y * T })),
      bars: (spec.bars || []).map((b) => ({ cx: b.x * T + T / 2, cy: b.y * T + T / 2, len: b.len, spd: b.spd, ang: b.ang || 0 })),
      lifts: (spec.lifts || []).map((l) => ({ ...l })),
      boss: spec.boss || null, bridge: spec.bridge || null, cheeps: spec.cheeps || null,
    };
  }
  const g = (x) => ({ type: 'goomba', x });
  const k = (x) => ({ type: 'koopa', x });
  const rk = (x) => ({ type: 'redkoopa', x });                // 빨간 거북: 낭떠러지 끝에서 돌아선다
  const bz = (x) => ({ type: 'buzzy', x });                   // 딱정벌레: 불꽃이 안 통한다
  const hb = (x) => ({ type: 'hammerbro', x });               // 해머 브로스: 제자리에서 오가며 망치를 던진다
  const lk = (x, from, to) => ({ type: 'lakitu', x, from, to });   // 구름 탄 적: from~to 칸 사이에서 마리오를 따라다니며 가시 알을 떨군다
  const pd = (x) => ({ type: 'podoboo', x });                 // 용암 불꽃: 구멍에서 튀어 오른다
  const run = (x0, x1, y) => { const a = []; for (let x = x0; x <= x1; x++) a.push([x, y]); return a; };

  const STAGES = [
    make({                                                                  // 원작 1-1 을 기억에 의존해 본뜬 배치(블록·파이프·구멍·계단의 위치와 순서). 정확한 복제는 아니다
      name: '초원', theme: 'grass', w: 212, time: 400, flag: 198,
      ground: [[0, 68], [71, 85], [89, 152], [155, 211]],
      pipes: [{ x: 28, h: 2 }, { x: 38, h: 3 }, { x: 46, h: 3 }, { x: 57, h: 3 }, { x: 163, h: 2 }], warps: [[28, 46]],
      blocks: [[16, 7, '?'], [20, 7, 'B'], [21, 7, 'M'], [22, 7, 'B'], [23, 7, '?'], [24, 7, 'B'], [22, 3, '?'], [64, 7, 'H'],
        [77, 7, 'B'], [78, 7, 'M'], [79, 7, 'B'], [94, 7, '$'], [100, 7, '?'], [101, 7, '?'], [106, 7, '?'], [109, 7, '?'], [109, 3, 'M'], [112, 7, '?'],
        [118, 7, 'B'], [129, 3, 'B'], [130, 3, '?'], [131, 3, '?'], [132, 3, 'B']],
      rows: [[80, 87, 3, 'B'], [91, 93, 3, 'B'], [121, 123, 3, 'B']],
      coins: [...run(60, 62, 9), ...run(72, 74, 9), ...run(96, 98, 8), ...run(138, 139, 8), ...run(168, 170, 8), ...run(176, 178, 8)],
      stairs: [{ x: 134, n: 4, dir: 1 }, { x: 143, n: 4, dir: -1 }, { x: 148, n: 4, dir: 1 }, { x: 158, n: 4, dir: -1 }, { x: 188, n: 8, dir: 1 }],
      enemies: [g(22), g(35), g(44), g(53), g(55), g(80), g(82), g(95), g(97), k(107), g(109), g(111), g(124), g(126), rk(138), g(145), g(170), g(172), g(176)],
    }),
    make({
      name: '동굴', theme: 'cave', w: 130, time: 400, flag: 122, ceiling: 3,
      ground: [[0, 24], [28, 52], [56, 80], [85, 105], [109, 129]],
      pipes: [{ x: 15, h: 2 }, { x: 40, h: 3 }, { x: 66, h: 2 }, { x: 95, h: 3 }], piranhas: [40, 95], warps: [[40, 66]],
      blocks: [[12, 7, 'M'], [13, 7, 'B'], [14, 7, '?'], [30, 7, '?'], [31, 7, '1'], [32, 7, '$'], [33, 7, '?'], [60, 7, 'B'], [61, 7, 'M'], [62, 7, 'B'], [88, 7, '?'], [89, 7, 'B'], [90, 7, '?'], [100, 7, 'H']],
      cannons: [[77, 10], [99, 10]],
      rows: [[44, 48, 4, 'B'], [70, 75, 5, 'B']],
      coins: [...run(18, 22, 9), ...run(26, 27, 8), ...run(53, 55, 8), ...run(45, 47, 3), ...run(71, 74, 4), ...run(81, 84, 8), ...run(106, 108, 8)],
      stairs: [{ x: 112, n: 8, dir: 1 }], ceilingEnd: 108,
      enemies: [g(10), g(23), k(36), bz(47), g(50), g(58), rk(64), g(73), g(75), k(77), g(90), bz(101), g(103), k(105), g(115)],
    }),
    make({
      name: '하늘 구름', theme: 'sky', w: 140, time: 350, flag: 132,
      ground: [[0, 14], [18, 26], [30, 36], [40, 50], [54, 60], [64, 76], [80, 86], [90, 100], [112, 114], [118, 139]],
      lifts: [{ x: 101 * T, y: 10 * T, w: 3 * T, axis: 'x', range: 8 * T, speed: 40 }], springs: [[73, 10]], cannons: [[60, 10]],
      blocks: [[5, 7, 'M'], [6, 7, 'B'], [7, 7, '?'], [21, 7, '?'], [45, 7, 'B'], [46, 7, '?'], [47, 7, 'B'], [69, 7, 'M'], [70, 7, '*'], [95, 7, '?'], [96, 7, '$'], [97, 7, '?']],
      rows: [[32, 34, 6, 'B'], [56, 58, 6, 'B'], [82, 85, 6, 'B']],
      coins: [...run(15, 17, 8), ...run(27, 29, 8), ...run(37, 39, 8), ...run(51, 53, 8), ...run(61, 63, 8), ...run(77, 79, 8), ...run(87, 89, 8), ...run(105, 107, 8), ...run(115, 117, 8), ...run(32, 34, 3), ...run(70, 76, 1), ...run(71, 75, 2)],
      stairs: [{ x: 122, n: 8, dir: 1 }],
      enemies: [g(8), rk(22), g(44), rk(48), bz(66), g(84), hb(95), g(124), lk(26, 16, 84)], cheeps: [101, 116],
    }),
    make({
      name: '성', theme: 'castle', w: 150, time: 300, flag: 143, ceiling: 2,
      ground: [[0, 20], [24, 40], [44, 60], [65, 82], [86, 100], [104, 125], [130, 149]],
      pipes: [{ x: 14, h: 2 }, { x: 52, h: 3 }, { x: 92, h: 3 }], piranhas: [92], warps: [[14, 52]],
      blocks: [[8, 7, 'M'], [9, 7, 'B'], [10, 7, '?'], [28, 7, '$'], [29, 7, '?'], [30, 7, 'B'], [48, 7, 'M'], [49, 7, '*'], [70, 7, 'B'], [71, 7, '?'], [72, 7, 'B'], [96, 7, 'H'], [108, 7, '?'], [109, 7, 'B'], [110, 7, 'M']],
      bars: [{ x: 36, y: 8, len: 5, spd: 2.2 }, { x: 77, y: 8, len: 5, spd: -2.2 }, { x: 118, y: 8, len: 5, spd: 2.2 }], cannons: [[60, 10]],
      rows: [[34, 38, 5, 'S'], [74, 79, 4, 'B'], [112, 118, 5, 'S']],
      coins: [...run(21, 23, 8), ...run(41, 43, 8), ...run(61, 64, 8), ...run(83, 85, 8), ...run(101, 103, 8), ...run(126, 129, 8), ...run(75, 78, 3)],
      stairs: [{ x: 133, n: 8, dir: 1 }], ceilingEnd: 129,
      enemies: [g(10), g(20), rk(26), g(32), bz(38), k(46), g(58), g(70), rk(74), g(78), g(88), bz(99), g(106), hb(115), g(122), g(136), pd(42), pd(62), pd(127)],
    }),
    make({                                                                  // 마지막: 쿠파 대마왕이 다리 위에서 기다린다. 도끼를 건드리면 다리가 무너진다
      name: '쿠파 성', theme: 'castle', w: 80, time: 300, ceiling: 3,
      ground: [[0, 79]], bridge: [39, 54], axe: [56, 10],
      blocks: [[10, 7, 'M'], [11, 7, 'B'], [12, 7, '?'], [27, 7, 'M'], [28, 7, 'B'], [29, 7, 'M']],
      bars: [{ x: 18, y: 8, len: 5, spd: 2.2 }, { x: 33, y: 8, len: 5, spd: -2.2 }], cannons: [[22, 10]],
      boss: { x: 47, min: 42, max: 52 },
      coins: [...run(2, 6, 8), ...run(44, 50, 5)],
      enemies: [g(8), g(15), bz(25), g(36)],
    }),
  ];
  // 지하 보너스 방: 파이프로 들어가면 나오는 동전 방. 오른쪽 끝의 가로 파이프(E)로 걸어 들어가면 코스로 돌아간다
  const ROOM = (() => {
    const w = 15, tiles = Array.from({ length: ROWS }, () => new Array(w).fill('.'));
    for (let x = 0; x < w; x++) { tiles[GROUND][x] = '#'; tiles[GROUND + 1][x] = '#'; for (let y = 0; y < 3; y++) tiles[y][x] = '#'; }
    for (let x = 2; x <= 10; x++) { tiles[10][x] = 'C'; tiles[8][x] = 'C'; }          // 바닥 줄은 걸으며, 위 줄은 뛰며 모은다
    for (let x = 3; x <= 9; x++) tiles[6][x] = 'C';
    tiles[GROUND - 2][13] = tiles[GROUND - 2][14] = 'E'; tiles[GROUND - 1][13] = tiles[GROUND - 1][14] = 'E';
    return { w, tiles, theme: 'cave', coins: 9 + 9 + 7 };
  })();
  return { T, ROWS, GROUND, STAGES, ROOM };
})();
if (typeof module !== 'undefined') module.exports = LEVELS_SM;
