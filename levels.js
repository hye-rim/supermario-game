'use strict';
// 슈퍼마리오 풍 코스 4개. 글자 지도가 아니라 '땅 구간 + 설치물 목록'으로 만들어 판마다 규칙(구멍 폭 등)을 시험할 수 있다.
// 한 칸 = 16픽셀, 세로 13칸(0~12). 땅은 11~12 줄. 위쪽이 0.
//   . 빈 곳  # 땅(딱딱함)  B 벽돌  ? 동전 블록  M 버섯·꽃 블록  * 별 블록  1 1UP 버섯 블록  $ 동전 여러 개 블록  U 쓴 블록  S 단단한 블록
//   P/p 파이프(윗부분/몸통)  C 동전  F 깃대  f 깃대 꼭대기  E 보너스 방 출구 파이프 입구(걸어 들어감)
//   식물(piranhas)·들어갈 수 있는 파이프(warps: 들어가는 파이프 x, 나오는 파이프 x)는 파이프 왼쪽 칸 x 로 적는다
const LEVELS_SM = (() => {
  const T = 16, ROWS = 13, GROUND = 11;

  function make(spec) {
    const w = spec.w;
    const tiles = Array.from({ length: ROWS }, () => new Array(w).fill('.'));
    for (const [a, b] of spec.ground) for (let x = a; x <= b; x++) { tiles[GROUND][x] = '#'; tiles[GROUND + 1][x] = '#'; }
    if (spec.ceiling) for (let x = 0; x < w; x++) for (let y = 0; y < spec.ceiling; y++) tiles[y][x] = '#';
    for (const p of spec.pipes || []) for (let k = 0; k < 2; k++) for (let h = 1; h <= p.h; h++) tiles[GROUND - h][p.x + k] = h === p.h ? 'P' : 'p';
    for (const [x, y, ch] of spec.blocks || []) tiles[y][x] = ch;
    for (const [x0, x1, y, ch] of spec.rows || []) for (let x = x0; x <= x1; x++) tiles[y][x] = ch;
    for (const s of spec.stairs || []) for (let i = 0; i < s.n; i++) for (let h = 1; h <= i + 1; h++) tiles[GROUND - h][s.dir > 0 ? s.x + i : s.x - i] = 'S';
    for (const [x, y] of spec.coins || []) if (tiles[y][x] === '.') tiles[y][x] = 'C';
    // 깃대
    const fx = spec.flag;
    for (let y = 2; y < GROUND; y++) tiles[y][fx] = 'F';
    tiles[1][fx] = 'f';
    tiles[GROUND - 1][fx] = 'S';                                            // 깃대 아래 받침
    for (let y = 2; y < GROUND - 1; y++) tiles[y][fx] = 'F';
    const plants = (spec.piranhas || []).map((px) => { const p = spec.pipes.find((q) => q.x === px); return { x: px, topY: (GROUND - p.h) * T }; });
    const topOf = (px) => (GROUND - spec.pipes.find((q) => q.x === px).h) * T;
    const warps = (spec.warps || []).map(([x, ex]) => ({ x, topY: topOf(x), exitX: ex, exitTopY: topOf(ex) }));
    return { name: spec.name, theme: spec.theme, w, tiles, spawns: spec.enemies.map((e) => ({ ...e })), plants, warps, time: spec.time, flag: fx, ground: spec.ground, start: spec.start || 2 };
  }
  const g = (x) => ({ type: 'goomba', x });
  const k = (x) => ({ type: 'koopa', x });
  const run = (x0, x1, y) => { const a = []; for (let x = x0; x <= x1; x++) a.push([x, y]); return a; };

  const STAGES = [
    make({
      name: '초원', theme: 'grass', w: 120, time: 400, flag: 112,
      ground: [[0, 38], [42, 68], [72, 92], [96, 119]],
      pipes: [{ x: 24, h: 2 }, { x: 50, h: 3 }, { x: 62, h: 2 }, { x: 80, h: 2 }], warps: [[24, 50]],
      blocks: [[8, 7, '?'], [9, 7, 'B'], [10, 7, 'M'], [11, 7, 'B'], [12, 7, '?'], [19, 7, '$'], [31, 7, 'B'], [32, 7, '?'], [33, 7, 'B'], [57, 7, 'B'], [58, 7, '?'], [59, 7, 'B'], [86, 7, 'M'], [87, 7, 'B']],
      rows: [[35, 37, 4, 'B']],
      coins: [...run(14, 17, 9), ...run(40, 41, 8), ...run(70, 71, 8), ...run(94, 95, 8), [10, 4], [11, 4], [36, 3]],
      stairs: [{ x: 98, n: 5, dir: 1 }],
      enemies: [g(14), g(31), g(34), g(46), g(57), g(58), k(73), g(76), g(78), k(88)],
    }),
    make({
      name: '동굴', theme: 'cave', w: 130, time: 400, flag: 122, ceiling: 3,
      ground: [[0, 24], [28, 52], [56, 80], [85, 105], [109, 129]],
      pipes: [{ x: 15, h: 2 }, { x: 40, h: 3 }, { x: 66, h: 2 }, { x: 95, h: 3 }], piranhas: [40, 95], warps: [[40, 66]],
      blocks: [[12, 7, 'M'], [13, 7, 'B'], [14, 7, '?'], [30, 7, '?'], [31, 7, '1'], [32, 7, 'B'], [33, 7, '?'], [60, 7, 'B'], [61, 7, 'M'], [62, 7, 'B'], [88, 7, '?'], [89, 7, 'B'], [90, 7, '?']],
      rows: [[44, 48, 4, 'B'], [70, 75, 5, 'B']],
      coins: [...run(18, 22, 9), ...run(26, 27, 8), ...run(53, 55, 8), ...run(45, 47, 3), ...run(71, 74, 4), ...run(81, 84, 8), ...run(106, 108, 8)],
      stairs: [{ x: 110, n: 5, dir: 1 }],
      enemies: [g(10), g(23), k(36), g(47), g(50), g(58), k(64), g(73), g(76), k(78), g(90), g(101), g(103), k(105), g(115)],
    }),
    make({
      name: '하늘 구름', theme: 'sky', w: 140, time: 350, flag: 132,
      ground: [[0, 14], [18, 26], [30, 36], [40, 50], [54, 60], [64, 76], [80, 86], [90, 104], [108, 114], [118, 139]],
      blocks: [[5, 7, 'M'], [6, 7, 'B'], [7, 7, '?'], [21, 7, '?'], [45, 7, 'B'], [46, 7, '?'], [47, 7, 'B'], [69, 7, 'M'], [70, 7, '*'], [95, 7, '?'], [96, 7, 'B'], [97, 7, '?']],
      rows: [[32, 34, 6, 'B'], [56, 58, 6, 'B'], [82, 85, 6, 'B']],
      coins: [...run(15, 17, 8), ...run(27, 29, 8), ...run(37, 39, 8), ...run(51, 53, 8), ...run(61, 63, 8), ...run(77, 79, 8), ...run(87, 89, 8), ...run(105, 107, 8), ...run(115, 117, 8), ...run(32, 34, 3)],
      stairs: [{ x: 120, n: 5, dir: 1 }],
      enemies: [g(8), k(22), g(34), g(44), k(48), g(58), k(70), g(74), g(84), g(94), k(98), g(102), g(124)],
    }),
    make({
      name: '성', theme: 'castle', w: 150, time: 300, flag: 143, ceiling: 2,
      ground: [[0, 20], [24, 40], [44, 60], [65, 82], [86, 100], [104, 125], [130, 149]],
      pipes: [{ x: 14, h: 2 }, { x: 52, h: 3 }, { x: 92, h: 3 }], piranhas: [92], warps: [[14, 52]],
      blocks: [[8, 7, 'M'], [9, 7, 'B'], [10, 7, '?'], [28, 7, 'B'], [29, 7, '?'], [30, 7, 'B'], [48, 7, 'M'], [49, 7, '*'], [70, 7, 'B'], [71, 7, '?'], [72, 7, 'B'], [108, 7, '?'], [109, 7, 'B'], [110, 7, 'M']],
      rows: [[34, 38, 5, 'S'], [74, 79, 4, 'B'], [112, 118, 5, 'S']],
      coins: [...run(21, 23, 8), ...run(41, 43, 8), ...run(61, 64, 8), ...run(83, 85, 8), ...run(101, 103, 8), ...run(126, 129, 8), ...run(75, 78, 3)],
      stairs: [{ x: 132, n: 5, dir: 1 }],
      enemies: [g(10), g(20), k(26), g(32), g(38), k(46), g(59), g(68), k(74), g(78), g(88), k(99), g(106), g(112), k(116), g(122), g(136)],
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
