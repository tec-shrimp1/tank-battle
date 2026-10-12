'use strict';
/* ============================================================
   战场地图：瓦片、砖墙的局部破坏、碰撞查询
   ============================================================ */

/** 砖墙一格被拆成 2x2 四个象限，逐块摧毁 */
const QUAD = TILE / 2;

/** 基地护墙占用的格子（可被「铁锹」道具临时变成钢墙） */
const BASE_WALL_CELLS = (() => {
  const out = [];
  for (let c = BASE_COL - 1; c <= BASE_COL + 2; c++) out.push([c, BASE_ROW - 1]);
  for (let r = BASE_ROW; r < BASE_ROW + 2; r++) {
    out.push([BASE_COL - 1, r]);
    out.push([BASE_COL + 2, r]);
  }
  return out;
})();

class TileMap {

  constructor(layout) {
    this.cols = GRID;
    this.rows = GRID;
    this.tiles = new Uint8Array(GRID * GRID);
    this.mask  = new Uint8Array(GRID * GRID);   // 砖墙象限存活位
    this.baseAlive = true;
    this.load(layout);
  }

  /* ---------- 构建 ---------- */

  load(layout) {
    this.tiles.fill(T_EMPTY);
    this.mask.fill(0);

    for (let r = 0; r < this.rows; r++) {
      const row = layout[r] || '';
      for (let c = 0; c < this.cols; c++) {
        const ch = row[c] || '.';
        const t = TILE_CHARS[ch] !== undefined ? TILE_CHARS[ch] : T_EMPTY;
        this.setTile(c, r, t);
      }
    }
    this.buildBaseWalls(T_BRICK);
  }

  /** 基地四周的护墙 */
  buildBaseWalls(type) {
    for (const [c, r] of BASE_WALL_CELLS) this.setTile(c, r, type);
  }

  setTile(c, r, type) {
    if (!this.inBounds(c, r)) return;
    const i = r * this.cols + c;
    this.tiles[i] = type;
    this.mask[i] = type === T_BRICK ? 0b1111 : 0;
  }

  /* ---------- 查询 ---------- */

  inBounds(c, r) { return c >= 0 && c < this.cols && r >= 0 && r < this.rows; }

  tileAt(c, r) {
    if (!this.inBounds(c, r)) return T_STEEL;   // 越界当作钢墙
    return this.tiles[r * this.cols + c];
  }

  /** 坦克能否通行这一格 */
  blocksTank(c, r) {
    const t = this.tileAt(c, r);
    if (t === T_BRICK) return this.mask[r * this.cols + c] !== 0;
    return t === T_STEEL || t === T_WATER;
  }

  /** 矩形是否撞到实心地形 */
  rectHitsSolid(x, y, w, h) {
    if (x < 0 || y < 0 || x + w > FIELD || y + h > FIELD) return true;
    const c0 = Math.floor(x / TILE);
    const c1 = Math.floor((x + w - 0.001) / TILE);
    const r0 = Math.floor(y / TILE);
    const r1 = Math.floor((y + h - 0.001) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.blocksTank(c, r)) return true;
      }
    }
    return false;
  }

  /* ---------- 子弹命中：局部破坏 ---------- */

  /**
   * 子弹命中判定。返回 null 表示没被挡住，
   * 否则返回 'brick' 或 'steel' 表示被哪种墙挡下（用于音效/表现）。
   * power >= 3 时可击穿钢墙。
   */
  bulletHit(x, y, w, h, power) {
    if (x < 0 || y < 0 || x + w > FIELD || y + h > FIELD) return 'steel';

    const c0 = Math.floor(x / TILE);
    const c1 = Math.floor((x + w - 0.001) / TILE);
    const r0 = Math.floor(y / TILE);
    const r1 = Math.floor((y + h - 0.001) / TILE);

    let hitBrick = false;
    let hitSteel = false;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const t = this.tiles[i];
        if (t !== T_BRICK && t !== T_STEEL) continue;   // 水、树不挡子弹

        if (t === T_BRICK) {
          hitBrick = true;
          let m = this.mask[i];
          if (!m) continue;
          for (let q = 0; q < 4; q++) {
            const bit = 1 << q;
            if (!(m & bit)) continue;
            const qx = c * TILE + (q % 2) * QUAD;
            const qy = r * TILE + (q >> 1) * QUAD;
            if (x < qx + QUAD && x + w > qx && y < qy + QUAD && y + h > qy) {
              m &= ~bit;
            }
          }
          this.mask[i] = m;
          if (m === 0) this.tiles[i] = T_EMPTY;
        } else {
          hitSteel = true;
          if (power >= 3) {
            this.tiles[i] = T_EMPTY;
            this.mask[i] = 0;
          }
        }
      }
    }

    if (hitSteel) return 'steel';
    if (hitBrick) return 'brick';
    return null;
  }

  /** 找一块空地把道具丢下去 */
  randomEmptyCell(preferRows) {
    const pool = [];
    for (let r = 1; r < this.rows - 3; r++) {
      if (preferRows && !preferRows.includes(r)) continue;
      for (let c = 0; c < this.cols; c++) {
        if (!this.blocksTank(c, r)) pool.push({ c, r });
      }
    }
    const list = pool.length ? pool : [{ c: 6, r: 6 }];
    const p = list[(Math.random() * list.length) | 0];
    return { x: p.c * TILE, y: p.r * TILE };
  }
}
