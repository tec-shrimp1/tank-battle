'use strict';
/* ============================================================
   常量与关卡数据
   ============================================================ */

/* ---------- 尺寸 ---------- */
const GRID  = 14;               // 战场 14 x 14 格
const TILE  = 40;               // 每格边长（逻辑像素）
const FIELD = GRID * TILE;      // 战场边长 560

/* ---------- 瓦片类型 ---------- */
const T_EMPTY = 0;
const T_BRICK = 1;   // 砖墙：可逐块打穿
const T_STEEL = 2;   // 钢墙：仅满级火力可破
const T_WATER = 3;   // 河流：挡坦克，不挡子弹
const T_TREE  = 4;   // 树林：可通行，遮挡视线

const TILE_CHARS = {
  '.': T_EMPTY,
  'B': T_BRICK,
  'S': T_STEEL,
  'W': T_WATER,
  'T': T_TREE,
};

/* ---------- 方向 ---------- */
const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
const DIR_VEC = [
  { x:  0, y: -1 },
  { x:  1, y:  0 },
  { x:  0, y:  1 },
  { x: -1, y:  0 },
];

/* ---------- 战场固定要素 ---------- */
const BASE_COL  = 6;                              // 基地占 2x2 格
const BASE_ROW  = 12;
const BASE_RECT = {
  x: BASE_COL * TILE,
  y: BASE_ROW * TILE,
  w: TILE * 2,
  h: TILE * 2,
};

const PLAYER_SPAWNS = [{ c: 4, r: 13 }, { c: 9, r: 13 }];
const ENEMY_SPAWNS  = [{ c: 0, r: 0 }, { c: 7, r: 0 }, { c: 13, r: 0 }];

/* ---------- 敌军配置 ---------- */
const ENEMY_TYPES = {
  normal: { speed:  74, hp: 1, bulletSpeed: 230, maxBullets: 1, score: 100, color: '#b8c0cc', tread: '#6b7482' },
  fast:   { speed: 152, hp: 1, bulletSpeed: 230, maxBullets: 1, score: 200, color: '#5ad1e6', tread: '#2a7c8c' },
  power:  { speed:  84, hp: 1, bulletSpeed: 400, maxBullets: 2, score: 300, color: '#e8683f', tread: '#8c3a1e' },
  armor:  { speed:  78, hp: 4, bulletSpeed: 250, maxBullets: 1, score: 400, color: '#7bc86c', tread: '#3d6b34' },
};

/* 每关出场的敌军序列（顺序即出场顺序） */
const WAVE_PATTERN = [
  'normal', 'normal', 'fast',   'normal', 'power',
  'normal', 'fast',   'armor',  'normal', 'fast',
  'power',  'normal', 'armor',  'fast',   'normal',
  'power',  'armor',  'normal', 'fast',   'armor',
];

const LEVELS = [

  /* ===== 第 1 关 · 初次交锋 ===== */
  [
    '..............',
    '.BB.BB..BB.BB.',
    '.BB.BB..BB.BB.',
    '..............',
    '..BB......BB..',
    '..BB.SS.SS.BB.',
    '..............',
    '.BB..BBBB..BB.',
    '.BB..BBBB..BB.',
    '..............',
    '...B..TT..B...',
    '...B......B...',
    '..............',
    '..............',
  ],

  /* ===== 第 2 关 · 钢铁走廊 ===== */
  [
    '..............',
    '..SS......SS..',
    '..SS......SS..',
    '..BB.BBBB.BB..',
    '..BB.BBBB.BB..',
    '..............',
    '.TT..BBBB..TT.',
    '.TT..BBBB..TT.',
    '..............',
    '..BB......BB..',
    '..BB..BB..BB..',
    '......BB......',
    '..............',
    '..............',
  ],

  /* ===== 第 3 关 · 河道迷阵 ===== */
  [
    '..............',
    '.BB..BBBB..BB.',
    '.BB..BBBB..BB.',
    '..............',
    'WWWW......WWWW',
    '..BB.WWWW.BB..',
    '..BB.WWWW.BB..',
    '..............',
    '.B.BB.SS.BB.B.',
    '.B.BB.SS.BB.B.',
    '..............',
    '.BB........BB.',
    '..............',
    '..............',
  ],

  /* ===== 第 4 关 · 密林要塞 ===== */
  [
    '..............',
    '.TT.TT..TT.TT.',
    '.TT.TT..TT.TT.',
    '..............',
    '.SS.BB..BB.SS.',
    '.SS.BB..BB.SS.',
    '..............',
    '.TTTT....TTTT.',
    '.TTTT....TTTT.',
    '..............',
    '..BB..BB..BB..',
    '..BB......BB..',
    '..............',
    '..............',
  ],

  /* ===== 第 5 关 · 最终关隘 ===== */
  [
    '..............',
    '.SS.BBBBBB.SS.',
    '.SS.BBBBBB.SS.',
    '..............',
    'BB.BB....BB.BB',
    'BB.BB....BB.BB',
    '..............',
    '..SS.SSSS.SS..',
    '..SS.SSSS.SS..',
    '..............',
    '.BB..B..B..BB.',
    '.BB..B..B..BB.',
    '..............',
    '..............',
  ],

];
