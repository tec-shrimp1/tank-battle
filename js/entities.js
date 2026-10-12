'use strict';
/* ============================================================
   实体：坦克 / 子弹 / 爆炸 / 道具
   ============================================================ */

/* ---------- 通用工具 ---------- */

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rand  = (a, b) => a + Math.random() * (b - a);

/* ============================================================
   坦克
   ============================================================ */

class Tank {

  constructor(world, opts) {
    this.world = world;
    this.map   = world.map;

    this.x = opts.x;
    this.y = opts.y;
    this.w = TILE;
    this.h = TILE;

    this.dir     = opts.dir !== undefined ? opts.dir : UP;
    this.isPlayer = !!opts.isPlayer;
    this.kind     = opts.kind || 'normal';

    this.moveSpeed    = opts.speed       || 100;
    this.bulletSpeed  = opts.bulletSpeed || 240;
    this.maxBullets   = opts.maxBullets  || 1;
    this.power        = opts.power       || 1;   // >=3 可击穿钢墙
    this.hp           = opts.hp          || 1;
    this.maxHp        = this.hp;
    this.scoreValue   = opts.score       || 0;
    this.color        = opts.color       || '#b8c0cc';
    this.treadColor   = opts.tread       || '#6b7482';

    this.alive     = true;
    this.spawnT    = opts.spawnT !== undefined ? opts.spawnT : 0;  // 出生动画
    this.shield    = opts.shield || 0;      // 护盾剩余秒数
    this.fireCd    = 0;
    this.frozen    = 0;
    this.moving    = false;
    this.stuck     = false;
    this.stuckTimer = 0;
    this.thinkTimer = 0;
    this.aiDir     = opts.dir !== undefined ? opts.dir : DOWN;
    this.bonus     = !!opts.bonus;          // 闪光坦克，击毁掉道具
    this.tread     = 0;
    this.flashT    = 0;
  }

  get rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  get cx()   { return this.x + this.w / 2; }
  get cy()   { return this.y + this.h / 2; }
  get spawning() { return this.spawnT > 0; }
  /** 无敌：出生保护 / 护盾 / 出生动画期间 */
  get invulnerable() { return this.spawning || this.shield > 0; }

  /* ---------- 逐帧 ---------- */

  /** input: { dir: number|null, fire: boolean } */
  update(dt, input) {
    this.flashT += dt;
    if (this.shield > 0) this.shield -= dt;
    if (this.fireCd > 0) this.fireCd -= dt;

    if (this.spawning) {
      this.spawnT -= dt;
      return;
    }

    if (this.isPlayer) {
      if (input.dir !== null && input.dir !== undefined) {
        this.move(dt, input.dir);
      } else {
        this.moving = false;
      }
      if (input.fire) this.fire();
    } else {
      if (this.world.freezeT > 0) {     // 「时间冻结」道具生效中
        this.moving = false;
        return;
      }
      this.updateAI(dt);
    }
  }

  /* ---------- 移动 ---------- */

  move(dt, dir) {
    this.dir = dir;
    this.moving = true;

    const horizontal = (dir === LEFT || dir === RIGHT);

    // 自动吸附到格线，便于穿过 1 格宽的走廊
    if (horizontal) this.alignAxis('y', dt);
    else            this.alignAxis('x', dt);

    const v = DIR_VEC[dir];
    const step = this.moveSpeed * dt;
    const ox = this.x, oy = this.y;

    this.x += v.x * step;
    this.y += v.y * step;

    if (this.blocked()) {
      this.x = ox;
      this.y = oy;
      this.stuck = true;
      this.stuckTimer += dt;
    } else {
      this.stuck = false;
      this.tread += step;
    }
  }

  alignAxis(axis, dt) {
    const cur = this[axis];
    const nearest = Math.round(cur / TILE) * TILE;
    const diff = nearest - cur;
    if (Math.abs(diff) < 0.5) { this[axis] = nearest; return; }

    const stepMag = Math.min(Math.abs(diff), this.moveSpeed * dt);
    // 先朝最近的格线靠，走不通就反向（两条格线总有一条是可达的）
    for (const sign of [Math.sign(diff), -Math.sign(diff)]) {
      this[axis] = cur + sign * stepMag;
      if (!this.blocked()) return;
      this[axis] = cur;
    }
  }

  blocked() {
    if (this.map.rectHitsSolid(this.x, this.y, this.w, this.h)) return true;

    for (const t of this.world.tanks) {
      if (t === this || !t.alive || t.spawning) continue;
      if (rectsOverlap(this.rect, t.rect)) return true;
    }
    if (this.world.baseAlive && rectsOverlap(this.rect, BASE_RECT)) return true;
    return false;
  }

  /* ---------- 敌方 AI ---------- */

  updateAI(dt) {
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0 || this.stuckTimer > 0.2) {
      this.thinkTimer = rand(0.4, 1.6);
      this.stuckTimer = 0;
      this.aiDir = this.chooseDir();
    }

    this.move(dt, this.aiDir);

    // 开火：与玩家或基地同排/同列时更容易开火
    if (this.canFire()) {
      const aligned = this.alignedWithTarget();
      const p = aligned ? 0.22 : 0.035;
      if (Math.random() < p) this.fire();
    }
  }

  chooseDir() {
    const roll = Math.random();
    let tx, ty;

    if (roll < 0.46) {                      // 冲基地
      tx = BASE_RECT.x + TILE;
      ty = BASE_RECT.y + TILE;
    } else if (roll < 0.72) {               // 追玩家
      const players = this.world.tanks.filter(t => t.isPlayer && t.alive && !t.spawning);
      if (players.length) {
        const p = players[(Math.random() * players.length) | 0];
        tx = p.cx; ty = p.cy;
      } else {
        tx = rand(0, FIELD); ty = rand(0, FIELD);
      }
    } else {                                // 随机游走
      tx = rand(0, FIELD); ty = rand(0, FIELD);
    }

    const dx = tx - this.cx;
    const dy = ty - this.cy;
    const options = [];

    if (Math.abs(dx) > 4) options.push(dx > 0 ? RIGHT : LEFT);
    if (Math.abs(dy) > 4) options.push(dy > 0 ? DOWN : UP);
    if (!options.length) options.push((Math.random() * 4) | 0);

    // 保留一点惯性，避免原地抽搐
    if (options.includes(this.aiDir) && Math.random() < 0.45) return this.aiDir;
    return options[(Math.random() * options.length) | 0];
  }

  alignedWithTarget() {
    const tol = TILE * 0.6;
    const targets = [BASE_RECT];
    for (const t of this.world.tanks) {
      if (t.isPlayer && t.alive && !t.spawning) targets.push(t.rect);
    }
    for (const t of targets) {
      const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
      if (Math.abs(tcx - this.cx) < tol || Math.abs(tcy - this.cy) < tol) return true;
    }
    return false;
  }

  /* ---------- 开火 ---------- */

  bulletsInFlight() {
    let n = 0;
    for (const b of this.world.bullets) if (b.owner === this && b.alive) n++;
    return n;
  }

  canFire() {
    return this.fireCd <= 0 && this.bulletsInFlight() < this.maxBullets;
  }

  fire() {
    if (!this.canFire()) return false;

    const v = DIR_VEC[this.dir];
    const bx = this.cx + v.x * (TILE / 2 - 2);
    const by = this.cy + v.y * (TILE / 2 - 2);

    this.world.bullets.push(new Bullet(this, bx, by, this.dir, this.bulletSpeed, this.power));
    this.fireCd = this.isPlayer ? 0.16 : 0.42;

    if (this.isPlayer) this.world.sound.shoot();
    else               this.world.enemyShootSfx();
    return true;
  }

  /* ---------- 受击 ---------- */

  hitByBullet(bullet) {
    if (!this.alive || this.invulnerable) return 'blocked';

    this.hp -= 1;
    if (this.hp > 0) {
      this.world.sound.steelHit();
      return 'damaged';
    }

    this.alive = false;
    this.world.explosions.push(new Explosion(this.cx, this.cy, true));
    this.world.sound.explodeBig();
    return 'killed';
  }

  /** 道具：升级火力（1 普通 → 2 高速 → 3 可击穿钢墙 + 双弹） */
  upgrade() {
    this.power = clamp(this.power + 1, 1, 3);
    this.bulletSpeed = this.power === 1 ? 320 : 470;
    this.maxBullets  = this.power >= 3 ? 2 : 1;
  }

  /* ---------- 绘制 ---------- */

  draw(ctx, time) {
    if (!this.alive) return;
    ctx.save();
    ctx.translate(this.cx, this.cy);

    // 出生动画：旋转的星芒
    if (this.spawning) {
      const k = 1 - this.spawnT / 1.2;
      ctx.rotate(time * 12);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.5 * Math.abs(Math.sin(time * 18))})`;
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(i * Math.PI / 3) * (10 + k * 12), Math.sin(i * Math.PI / 3) * (10 + k * 12));
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    ctx.rotate(this.dir * Math.PI / 2);

    const flashing = this.bonus && Math.sin(this.flashT * 12) > 0;
    const body  = flashing ? '#ffffff' : this.color;
    const tread = flashing ? '#c9c9c9' : this.treadColor;
    const H = TILE / 2;   // 20

    // --- 履带 ---
    ctx.fillStyle = tread;
    roundRect(ctx, -H,      -H + 2, 9, TILE - 4, 3); ctx.fill();
    roundRect(ctx,  H - 9,  -H + 2, 9, TILE - 4, 3); ctx.fill();

    // 履带纹路
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    const off = (this.tread % 8 + 8) % 8;
    for (let y = -H + 4 - off; y < H - 4; y += 8) {
      if (y < -H) continue;
      ctx.fillRect(-H + 1, y, 7, 2.5);
      ctx.fillRect(H - 8,  y, 7, 2.5);
    }

    // --- 车体 ---
    ctx.fillStyle = body;
    roundRect(ctx, -H + 8, -H + 4, TILE - 16, TILE - 7, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.38)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // 车体高光 / 阴影
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    roundRect(ctx, -H + 9, -H + 5, TILE - 18, 6, 3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.20)';
    ctx.fillRect(-H + 9, H - 6, TILE - 18, 4);

    // --- 炮塔 ---
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 2, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // --- 炮管（不超出车身包围盒，免得贴边时探出战场）---
    ctx.fillStyle = body;
    roundRect(ctx, -3.2, -H + 1, 6.4, 19, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.stroke();

    // --- 生命值指示（装甲车）---
    if (this.maxHp > 1) {
      for (let i = 0; i < this.maxHp; i++) {
        ctx.fillStyle = i < this.hp ? '#ffe27a' : 'rgba(0,0,0,.35)';
        ctx.fillRect(-9 + i * 6, H - 5.5, 4, 3);
      }
    }

    // --- 玩家火力等级 ---
    if (this.isPlayer && this.power > 1) {
      ctx.fillStyle = '#3a2b06';
      for (let i = 1; i < this.power; i++) {
        ctx.fillRect(-4 + (i - 1) * 8, -4, 6, 3);
      }
    }

    ctx.restore();

    // --- 护盾 ---
    if (this.shield > 0) {
      const a = Math.min(1, this.shield / 1.2);
      ctx.save();
      ctx.translate(this.cx, this.cy);
      ctx.rotate(time * 5);
      ctx.strokeStyle = `rgba(120,220,255,${0.35 + a * 0.45})`;
      ctx.lineWidth = 2.4;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, TILE * 0.62, i * Math.PI / 2, i * Math.PI / 2 + Math.PI / 3);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/* ============================================================
   子弹
   ============================================================ */

class Bullet {

  constructor(owner, x, y, dir, speed, power) {
    this.owner   = owner;
    this.isPlayer = owner.isPlayer;
    this.x = x;
    this.y = y;
    this.dir = dir;
    this.speed = speed;
    this.power = power || 1;
    this.alive = true;
    this.dead  = false;   // 引信：本帧销毁
  }

  get rect() {
    const vertical = (this.dir === UP || this.dir === DOWN);
    const w = vertical ? 7 : 15;
    const h = vertical ? 15 : 7;
    return { x: this.x - w / 2, y: this.y - h / 2, w, h };
  }

  update(dt, world) {
    if (!this.alive) return;

    const v = DIR_VEC[this.dir];
    const step = this.speed * dt;
    const sub = Math.max(1, Math.ceil(step / 6));   // 分步推进，避免高速穿墙

    for (let i = 0; i < sub; i++) {
      this.x += v.x * step / sub;
      this.y += v.y * step / sub;

      const r = this.rect;

      // 出界
      if (r.x < 0 || r.y < 0 || r.x + r.w > FIELD || r.y + r.h > FIELD) {
        this.explode(world, 'wall');
        return;
      }

      // 地形
      const hit = world.map.bulletHit(r.x, r.y, r.w, r.h, this.power);
      if (hit) {
        this.explode(world, hit);
        return;
      }

      // 基地
      if (world.baseAlive && rectsOverlap(r, BASE_RECT)) {
        this.alive = false;
        world.destroyBase();
        return;
      }

      // 坦克
      for (const t of world.tanks) {
        if (!t.alive || t === this.owner || t.spawning) continue;
        if (t.isPlayer === this.isPlayer) continue;   // 不打自己人
        if (!rectsOverlap(r, t.rect)) continue;

        const result = t.hitByBullet(this);
        this.alive = false;
        if (result === 'killed')       world.onTankKilled(t, this.owner);
        else if (result === 'blocked') {
          world.explosions.push(new Explosion(this.x, this.y, false));
          world.sound.steelHit();
        }
        return;
      }
    }
  }

  explode(world, cause) {
    this.alive = false;
    world.explosions.push(new Explosion(this.x, this.y, false));
    if (cause === 'brick') world.sound.brickHit();
    else if (cause === 'wall') world.sound.steelHit();
  }

  draw(ctx) {
    if (!this.alive) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.dir * Math.PI / 2);

    ctx.fillStyle = 'rgba(255,240,180,.22)';
    ctx.fillRect(-3.5, 2, 7, 12);

    ctx.fillStyle = this.isPlayer ? '#fff3c4' : '#ffd0a8';
    roundRect(ctx, -3.5, -8.5, 7, 17, 3.5);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    roundRect(ctx, -1.8, -8, 3.6, 7, 1.8);
    ctx.fill();

    ctx.restore();
  }
}

/* ============================================================
   爆炸
   ============================================================ */

class Explosion {

  constructor(x, y, big) {
    this.x = x;
    this.y = y;
    this.big = big;
    this.t = 0;
    this.dur = big ? 0.55 : 0.3;
    this.r = big ? TILE * 0.95 : TILE * 0.5;
    this.alive = true;
    this.sparks = Array.from({ length: big ? 9 : 5 }, () => ({
      a: Math.random() * Math.PI * 2,
      d: rand(0.3, 1),
      s: rand(2, 5),
    }));
  }

  update(dt) {
    this.t += dt;
    if (this.t >= this.dur) this.alive = false;
  }

  draw(ctx) {
    const k = this.t / this.dur;            // 0 → 1
    const fade = Math.pow(1 - k, 1.5);      // 收尾干脆一点，不留一层灰雾
    const R = this.r * (0.35 + k * 0.85);

    ctx.save();
    ctx.translate(this.x, this.y);

    // 火球：外圈保持同色相淡出，避免中段出现发黑的浑浊感
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0,    `rgba(255,255,225,${fade})`);
    g.addColorStop(0.3,  `rgba(255,205,95,${fade * 0.96})`);
    g.addColorStop(0.62, `rgba(245,120,50,${fade * 0.78})`);
    g.addColorStop(1,    'rgba(245,120,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    // 冲击环
    ctx.strokeStyle = `rgba(255,225,165,${fade * 0.55})`;
    ctx.lineWidth = 1 + 2 * fade;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.15, 0, Math.PI * 2);
    ctx.stroke();

    // 火星
    ctx.fillStyle = `rgba(255,235,190,${fade})`;
    for (const s of this.sparks) {
      const d = R * (0.6 + s.d * 0.9);
      ctx.beginPath();
      ctx.arc(Math.cos(s.a) * d, Math.sin(s.a) * d, s.s * fade, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

/* ============================================================
   道具
   ============================================================ */

const POWERUPS = {
  star:    { color: '#f0c24b', label: '火力升级' },
  helmet:  { color: '#5ad1e6', label: '护盾' },
  clock:   { color: '#b58cff', label: '时间冻结' },
  grenade: { color: '#e8683f', label: '全屏轰炸' },
  life:    { color: '#6fe38a', label: '额外生命' },
  shovel:  { color: '#c9d4e6', label: '钢铁护墙' },
};

const POWERUP_KEYS = Object.keys(POWERUPS);

class PowerUp {

  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.size = TILE - 4;
    this.type = type;
    this.life = 18;          // 秒
    this.alive = true;
    this.birth = 0;
  }

  get rect() {
    const s = this.size;
    return { x: this.x + (TILE - s) / 2, y: this.y + (TILE - s) / 2, w: s, h: s };
  }

  update(dt) {
    this.life -= dt;
    this.birth += dt;
    if (this.life <= 0) this.alive = false;
  }

  draw(ctx, time) {
    if (!this.alive) return;
    // 最后 4 秒闪烁提示即将消失
    if (this.life < 4 && Math.sin(time * 18) < 0) return;

    const r = this.rect;
    const meta = POWERUPS[this.type];
    const pulse = 1 + Math.sin(this.birth * 5) * 0.05;

    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.scale(pulse, pulse);

    ctx.shadowColor = meta.color;
    ctx.shadowBlur = 14;

    ctx.fillStyle = '#10141c';
    roundRect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, 6);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2;
    roundRect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, 6);
    ctx.stroke();

    ctx.fillStyle = meta.color;
    drawPowerIcon(ctx, this.type, r.w * 0.5);

    ctx.restore();
  }
}

/** 在原点绘制道具图标，s 为半尺寸 */
function drawPowerIcon(ctx, type, s) {
  ctx.save();
  switch (type) {
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 ? s * 0.42 : s * 0.92;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'helmet': {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.82, Math.PI, 0);
      ctx.lineTo(s * 0.82, s * 0.55);
      ctx.lineTo(-s * 0.82, s * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#10141c';
      ctx.fillRect(-s * 0.28, -s * 0.15, s * 0.56, s * 0.2);
      break;
    }
    case 'clock': {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.82, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#10141c';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, -s * 0.55);
      ctx.moveTo(0, 0); ctx.lineTo(s * 0.42, s * 0.15);
      ctx.stroke();
      break;
    }
    case 'grenade': {
      ctx.beginPath();
      ctx.arc(0, s * 0.12, s * 0.68, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-s * 0.2, -s * 0.85, s * 0.4, s * 0.3);
      ctx.strokeStyle = '#10141c';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(s * 0.45, -s * 0.5, s * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'life': {
      // 小坦克
      ctx.fillRect(-s * 0.8, -s * 0.45, s * 0.28, s * 0.95);
      ctx.fillRect(s * 0.52, -s * 0.45, s * 0.28, s * 0.95);
      ctx.fillRect(-s * 0.5, -s * 0.55, s, s * 0.95);
      ctx.fillRect(-s * 0.16, -s * 0.95, s * 0.32, s * 0.5);
      break;
    }
    case 'shovel': {
      ctx.fillRect(-s * 0.52, -s * 0.92, s * 1.04, s * 0.26);   // T 形握把
      ctx.fillRect(-s * 0.15, -s * 0.72, s * 0.3, s * 0.82);    // 铲柄
      ctx.beginPath();                                          // 铲头
      ctx.moveTo(-s * 0.58, s * 0.04);
      ctx.lineTo(s * 0.58, s * 0.04);
      ctx.lineTo(s * 0.4, s * 0.92);
      ctx.lineTo(-s * 0.4, s * 0.92);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
