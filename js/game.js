'use strict';
/* ============================================================
   主引擎：状态机、主循环、渲染、输入
   ============================================================ */

const STATE = {
  MENU:  'menu',
  READY: 'ready',
  PLAY:  'play',
  PAUSE: 'pause',
  CLEAR: 'clear',
  OVER:  'over',
};

/* 每关敌军总数 / 掉落道具的出场序号 */
const ENEMIES_PER_LEVEL = 20;
const BONUS_SLOTS = [3, 10, 17];

/* 1P / 2P 按键表：索引对应 UP RIGHT DOWN LEFT */
const P1_KEYS = { 0: 'arrowup', 1: 'arrowright', 2: 'arrowdown', 3: 'arrowleft', fire: ' ' };
const P2_KEYS = { 0: 'w',       1: 'd',          2: 's',         3: 'a',         fire: 'f' };

/* ============================================================
   游戏
   ============================================================ */

class Game {

  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx    = this.canvas.getContext('2d');
    this.overlay = document.getElementById('overlay');
    this.sound  = new SoundFX();

    this.hud = {
      level:   document.getElementById('hud-level'),
      score:   document.getElementById('hud-score'),
      lives:   document.getElementById('hud-lives'),
      enemies: document.getElementById('hud-enemies'),
    };

    this.time = 0;
    this.keys = new Set();
    this.lastDir = [null, null];
    this.state = STATE.MENU;
    this.numPlayers = 1;
    this.lastEnemySfx = -1;

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.bindKeyboard();
    this.bindTouch();

    // 菜单背景：先把第 1 关的地图铺好
    this.level = 1;
    this.score = 0;
    this.cycle = 1;
    this.victoryShown = false;
    this.playerLives = [3, 3];
    this.playerPower = [1, 1];
    this.loadLevel(1);
    this.showMenu();

    this.lastTs = 0;
    this.acc = 0;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /* ---------- 画布 ---------- */

  resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.dpr === dpr && this.canvas.width === FIELD * dpr) return;
    this.dpr = dpr;
    this.canvas.width  = FIELD * dpr;
    this.canvas.height = FIELD * dpr;
  }

  /* ---------- 输入 ---------- */

  bindKeyboard() {
    const norm = (k) => (k.length === 1 ? k.toLowerCase() : k.toLowerCase());

    window.addEventListener('keydown', (e) => {
      const k = norm(e.key);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      this.sound.resume();
      if (e.repeat) return;

      this.keys.add(k);
      this.trackDir(0, k);
      this.trackDir(1, k);

      if (k === 'p') this.togglePause();
      else if (k === 'm') this.sound.toggleMute();
      else if (this.state === STATE.MENU && (k === 'enter' || k === ' ')) this.startGame(1);
      else if (this.state === STATE.OVER && (k === 'enter' || k === ' ')) this.startGame(this.numPlayers);
    });

    window.addEventListener('keyup', (e) => {
      const k = norm(e.key);
      this.keys.delete(k);
      for (let i = 0; i < 2; i++) {
        const map = i === 0 ? P1_KEYS : P2_KEYS;
        for (let d = 0; d < 4; d++) {
          if (map[d] === k && this.lastDir[i] === d) this.lastDir[i] = null;
        }
      }
    });

    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 记住玩家最近按下的方向键，让转身更跟手 */
  trackDir(player, key) {
    const map = player === 0 ? P1_KEYS : P2_KEYS;
    for (let d = 0; d < 4; d++) {
      if (map[d] === key) { this.lastDir[player] = d; return; }
    }
  }

  bindTouch() {
    // 虚拟摇杆映射到 1P 的按键
    const dirKey = {
      up:    P1_KEYS[UP],
      right: P1_KEYS[RIGHT],
      down:  P1_KEYS[DOWN],
      left:  P1_KEYS[LEFT],
    };
    const dirNum = { up: UP, right: RIGHT, down: DOWN, left: LEFT };

    const hold = (el, key, dir) => {
      const on  = (e) => {
        e.preventDefault();
        this.sound.resume();
        this.keys.add(key);
        if (dir !== undefined) this.lastDir[0] = dir;
      };
      const off = (e) => { e.preventDefault(); this.keys.delete(key); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };

    document.querySelectorAll('#touch .dpad button').forEach((btn) => {
      const name = btn.dataset.dir;
      hold(btn, dirKey[name], dirNum[name]);
    });

    const fire = document.querySelector('#touch .fire');
    if (fire) hold(fire, P1_KEYS.fire);
  }

  readInput(i) {
    const map = i === 0 ? P1_KEYS : P2_KEYS;
    let dir = null;
    const ld = this.lastDir[i];
    if (ld !== null && this.keys.has(map[ld])) dir = ld;
    if (dir === null) {
      for (let d = 0; d < 4; d++) {
        if (this.keys.has(map[d])) { dir = d; break; }
      }
    }
    return { dir, fire: this.keys.has(map.fire) };
  }

  /* ---------- 主循环 ---------- */

  loop(ts) {
    requestAnimationFrame(this.loop);
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (dt > 0.25) dt = 0.25;          // 切标签页回来不要一次性快进

    this.time += dt;

    const STEP = 1 / 60;
    this.acc += dt;
    let guard = 0;
    while (this.acc >= STEP && guard++ < 5) {
      this.step(STEP);
      this.acc -= STEP;
    }
    this.render();
  }

  /* ---------- 单步模拟 ---------- */

  step(dt) {
    if (this.state === STATE.READY) {
      this.readyT -= dt;
      if (this.readyT <= 0) this.state = STATE.PLAY;
      return;
    }
    if (this.state === STATE.CLEAR) {
      this.clearT -= dt;
      for (const e of this.explosions) e.update(dt);
      this.explosions = this.explosions.filter(e => e.alive);
      if (this.clearT <= 0) this.nextLevel();
      return;
    }
    if (this.state !== STATE.PLAY) return;

    /* 计时器 */
    if (this.freezeT > 0) this.freezeT -= dt;
    if (this.shovelT > 0) {
      this.shovelT -= dt;
      if (this.shovelT <= 0) this.map.buildBaseWalls(T_BRICK);
    }

    /* 坦克 */
    for (const t of this.tanks) {
      if (!t.alive) continue;
      if (t.isPlayer) t.update(dt, this.readInput(t.playerIndex));
      else            t.update(dt, null);
    }

    /* 子弹 */
    for (const b of this.bullets) b.update(dt, this);
    this.bulletVsBullet();

    /* 道具 */
    for (const p of this.powerups) {
      p.update(dt);
      if (p.alive) this.checkPickup(p);
    }

    /* 爆炸 */
    for (const e of this.explosions) e.update(dt);

    /* 清理 */
    this.bullets    = this.bullets.filter(b => b.alive);
    this.tanks      = this.tanks.filter(t => t.alive);
    this.explosions = this.explosions.filter(e => e.alive);
    this.powerups   = this.powerups.filter(p => p.alive);

    /* 敌军出场 */
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 &&
        this.enemyQueue.length &&
        this.enemyOnField() < this.maxOnScreen) {
      this.spawnEnemy();
      this.spawnTimer = Math.max(0.35, 1.1 - this.level * 0.06);
    }

    /* 玩家复活 */
    for (let i = 0; i < this.numPlayers; i++) {
      if (this.respawnT[i] > 0) {
        this.respawnT[i] -= dt;
        if (this.respawnT[i] <= 0) this.spawnPlayer(i);
      }
    }

    /* 过关判定 */
    if (!this.enemyQueue.length && this.enemyOnField() === 0 && this.state === STATE.PLAY) {
      this.levelClear();
    }
  }

  /* ---------- 关卡 ---------- */

  buildWave() {
    const wave = [];
    for (let i = 0; i < ENEMIES_PER_LEVEL; i++) {
      wave.push(WAVE_PATTERN[i % WAVE_PATTERN.length]);
    }
    // 高周目时把前排换成更硬的家伙
    if (this.level >= 3) {
      for (let i = 0; i < wave.length; i += 4) wave[i] = 'armor';
    }
    return wave;
  }

  loadLevel(n) {
    this.level = n;
    this.map = new TileMap(LEVELS[(n - 1) % LEVELS.length]);

    this.tanks = [];
    this.bullets = [];
    this.explosions = [];
    this.powerups = [];

    this.baseAlive = true;
    this.freezeT = 0;
    this.shovelT = 0;
    this.respawnT = [0, 0];
    this.enemyQueue = this.buildWave();
    this.spawnedCount = 0;
    this.spawnTimer = 0.5;
    this.readyT = 0;
    this.maxOnScreen = Math.min(4 + Math.floor((n - 1) / 2) + (this.cycle - 1), 7);
  }

  startLevel(n) {
    this.loadLevel(n);
    for (let i = 0; i < this.numPlayers; i++) {
      if (this.playerLives[i] > 0) this.spawnPlayer(i);
    }
    this.state = STATE.READY;
    this.readyT = 1.7;
    this.sound.levelStart();
    this.hideOverlay();
    this.updateHUD();
  }

  nextLevel() {
    if (this.level >= LEVELS.length) {
      if (!this.victoryShown) { this.victoryShown = true; this.victory(); return; }
      this.cycle++;                    // 二周目之后：循环回第 1 关，难度继续累加
      this.startLevel(1);
      return;
    }
    this.startLevel(this.level + 1);
  }

  levelClear() {
    this.state = STATE.CLEAR;
    this.clearT = 2.3;
    this.sound.levelClear();
  }

  victory() {
    this.state = STATE.OVER;
    this.sound.levelClear();
    this.showOverlay({
      title: '全部通关',
      cls: 'win',
      sub: `你打通了全部 ${LEVELS.length} 关，总分 <b>${this.score}</b>。<br>二周目敌军更快、更多，敢不敢再来一轮？`,
      actions: [
        { label: '进入二周目', onClick: () => { this.cycle++; this.startGame(this.numPlayers, true); } },
        { label: '重新开始', ghost: true, onClick: () => this.startGame(this.numPlayers) },
      ],
    });
  }

  gameOver(reason) {
    if (this.state === STATE.OVER) return;
    this.state = STATE.OVER;
    this.sound.gameOver();
    this.showOverlay({
      title: '游戏结束',
      cls: 'lose',
      sub: `${reason}<br>存活到第 <b>${this.level}</b> 关，得分 <b>${this.score}</b>。`,
      actions: [{ label: '再来一局', onClick: () => this.startGame(this.numPlayers) }],
    });
  }

  /** ngPlus 为 true 时保留分数与周目数（用于「进入二周目」） */
  startGame(numPlayers, ngPlus) {
    this.sound.resume();
    this.numPlayers = numPlayers;
    if (!ngPlus) {
      this.cycle = 1;
      this.score = 0;
    }
    this.victoryShown = !!ngPlus;
    this.playerLives = [3, 3];
    this.playerPower = [1, 1];
    this.lastDir = [null, null];
    this.keys.clear();
    this.startLevel(1);
  }

  /* ---------- 生成 ---------- */

  spawnPlayer(i) {
    const s = PLAYER_SPAWNS[i];
    const p = this.playerPower[i];
    const t = new Tank(this, {
      x: s.c * TILE, y: s.r * TILE, dir: UP,
      isPlayer: true,
      speed: 140,
      hp: 1,
      bulletSpeed: p === 1 ? 320 : 470,
      maxBullets: p >= 3 ? 2 : 1,
      power: p,
      color: '#f0c24b',
      tread: '#8a6a1f',
      spawnT: 0.9,
      shield: 3.2,
    });
    t.playerIndex = i;
    this.tanks.push(t);
    return t;
  }

  spawnEnemy() {
    const occupied = (x, y) =>
      this.tanks.some(t => t.alive && rectsOverlap({ x, y, w: TILE, h: TILE }, t.rect));
    const free = ENEMY_SPAWNS.filter(s => !occupied(s.c * TILE, s.r * TILE));
    if (!free.length) return;

    const s = free[(Math.random() * free.length) | 0];
    const kind = this.enemyQueue.shift();
    const cfg = ENEMY_TYPES[kind];
    const bonus = BONUS_SLOTS.includes(this.spawnedCount);
    this.spawnedCount++;

    const speedMul = 1 + (this.cycle - 1) * 0.14;

    const t = new Tank(this, {
      x: s.c * TILE, y: s.r * TILE, dir: DOWN, kind,
      speed: cfg.speed * speedMul,
      hp: cfg.hp,
      bulletSpeed: cfg.bulletSpeed * speedMul,
      maxBullets: cfg.maxBullets,
      power: 1,
      score: cfg.score,
      color: cfg.color,
      tread: cfg.tread,
      spawnT: 1.2,
      bonus,
    });
    this.tanks.push(t);
    this.updateHUD();
  }

  enemyOnField() {
    let n = 0;
    for (const t of this.tanks) if (!t.isPlayer && t.alive) n++;
    return n;
  }

  spawnPowerUp() {
    const pos = this.map.randomEmptyCell();
    const type = POWERUP_KEYS[(Math.random() * POWERUP_KEYS.length) | 0];
    this.powerups.push(new PowerUp(pos.x, pos.y, type));
  }

  /* ---------- 事件 ---------- */

  onTankKilled(tank, killer) {
    if (tank.isPlayer) {
      const i = tank.playerIndex;
      this.playerLives[i] = Math.max(0, this.playerLives[i] - 1);
      this.playerPower[i] = 1;                    // 阵亡后火力回到 1 级
      if (this.playerLives[i] > 0) this.respawnT[i] = 1.4;
      this.updateHUD();
      // 只看参战玩家的命数（playerLives 里另一个槽位在单人模式下是闲置的）
      const anyLeft = this.playerLives.slice(0, this.numPlayers).some(l => l > 0);
      if (!anyLeft) this.gameOver('坦克全毁');
      return;
    }

    this.score += tank.scoreValue;
    if (killer && killer.isPlayer) this.score += Math.round(tank.scoreValue * 0.5);
    if (tank.bonus) this.spawnPowerUp();
    this.updateHUD();
  }

  destroyBase() {
    if (!this.baseAlive) return;
    this.baseAlive = false;
    const cx = BASE_RECT.x + BASE_RECT.w / 2;
    const cy = BASE_RECT.y + BASE_RECT.h / 2;
    this.explosions.push(new Explosion(cx, cy, true));
    this.explosions.push(new Explosion(cx - 24, cy + 14, true));
    this.explosions.push(new Explosion(cx + 24, cy - 6, true));
    this.sound.explodeBig();
    this.gameOver('基地被摧毁');
  }

  bulletVsBullet() {
    const bs = this.bullets;
    for (let i = 0; i < bs.length; i++) {
      if (!bs[i].alive) continue;
      for (let j = i + 1; j < bs.length; j++) {
        if (!bs[j].alive || bs[j].isPlayer === bs[i].isPlayer) continue;
        if (rectsOverlap(bs[i].rect, bs[j].rect)) {
          bs[i].alive = false;
          bs[j].alive = false;
          this.explosions.push(new Explosion((bs[i].x + bs[j].x) / 2, (bs[i].y + bs[j].y) / 2, false));
          this.sound.steelHit();
        }
      }
    }
  }

  checkPickup(pu) {
    const r = pu.rect;
    for (const t of this.tanks) {
      if (!t.isPlayer || !t.alive || t.spawning) continue;
      if (!rectsOverlap(r, t.rect)) continue;
      pu.alive = false;
      this.applyPowerUp(pu.type, t);
      return;
    }
  }

  applyPowerUp(type, player) {
    switch (type) {
      case 'star':
        this.playerPower[player.playerIndex] = clamp(this.playerPower[player.playerIndex] + 1, 1, 3);
        player.upgrade();
        this.sound.powerup();
        break;
      case 'helmet':
        player.shield = Math.max(player.shield, 10);
        this.sound.powerup();
        break;
      case 'clock':
        this.freezeT = 9;
        this.sound.powerup();
        break;
      case 'grenade':
        this.blowUpAllEnemies();
        this.sound.explodeBig();
        break;
      case 'life':
        this.playerLives[player.playerIndex]++;
        this.sound.extraLife();
        break;
      case 'shovel':
        this.map.buildBaseWalls(T_STEEL);
        this.shovelT = 16;
        this.sound.powerup();
        break;
    }
    this.updateHUD();
  }

  blowUpAllEnemies() {
    for (const t of this.tanks.slice()) {
      if (t.isPlayer || !t.alive) continue;
      t.alive = false;
      this.explosions.push(new Explosion(t.cx, t.cy, true));
      this.score += t.scoreValue;
    }
    this.updateHUD();
  }

  /** 敌军开火音效限流 */
  enemyShootSfx() {
    if (this.time - this.lastEnemySfx < 0.07) return;
    this.lastEnemySfx = this.time;
    this.sound.tone({ freq: 400, slideTo: 130, dur: 0.07, type: 'square', vol: 0.1 });
  }

  /* ---------- 覆盖层 ---------- */

  showOverlay({ title, sub, actions, cls }) {
    this.overlay.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'ov-title' + (cls ? ' ' + cls : '');
    h.textContent = title;
    this.overlay.appendChild(h);

    if (sub) {
      const p = document.createElement('p');
      p.className = 'ov-sub';
      p.innerHTML = sub;
      this.overlay.appendChild(p);
    }

    if (actions && actions.length) {
      const wrap = document.createElement('div');
      wrap.className = 'ov-actions';
      for (const a of actions) {
        const b = document.createElement('button');
        b.className = 'btn' + (a.ghost ? ' ghost' : '');
        b.textContent = a.label;
        b.addEventListener('click', () => { this.sound.resume(); a.onClick(); });
        wrap.appendChild(b);
      }
      this.overlay.appendChild(wrap);
    }
    this.overlay.classList.add('show');
  }

  hideOverlay() { this.overlay.classList.remove('show'); }

  showMenu() {
    this.state = STATE.MENU;
    this.showOverlay({
      title: '坦 克 大 战',
      sub: '保卫底部的基地，消灭全部 20 辆敌军坦克。<br>' +
           '方向键移动 · <kbd>空格</kbd> 开火 · <kbd>P</kbd> 暂停 · <kbd>M</kbd> 静音<br>' +
           '砖墙可以打穿，钢墙要满级火力才破得开。',
      actions: [
        { label: '单人开始', onClick: () => this.startGame(1) },
        { label: '双人同屏', ghost: true, onClick: () => this.startGame(2) },
      ],
    });
  }

  togglePause() {
    if (this.state === STATE.PLAY) {
      this.state = STATE.PAUSE;
      this.showOverlay({
        title: '已暂停',
        sub: '按 <kbd>P</kbd> 或点击下方按钮继续',
        actions: [{ label: '继续游戏', onClick: () => this.resume() }],
      });
    } else if (this.state === STATE.PAUSE) {
      this.resume();
    }
  }

  resume() {
    if (this.state !== STATE.PAUSE) return;
    this.hideOverlay();
    this.state = STATE.PLAY;
    this.lastTs = 0;
    this.acc = 0;
  }

  /* ---------- HUD ---------- */

  updateHUD() {
    this.hud.level.textContent = this.cycle > 1 ? `${this.level}·${this.cycle}` : String(this.level);
    this.setScore(this.score);

    const lives = this.playerLives.slice(0, this.numPlayers);
    this.hud.lives.textContent = lives.join(' / ');

    const remain = this.enemyQueue.length + this.enemyOnField();
    const box = this.hud.enemies;
    if (box.childElementCount !== remain) {
      box.innerHTML = '';
      for (let i = 0; i < remain; i++) box.appendChild(document.createElement('i'));
    }
  }

  setScore(v) {
    if (this.hud.score.textContent === String(v)) return;
    this.hud.score.textContent = String(v);
    this.hud.score.classList.add('bump');
    clearTimeout(this._scoreTimer);
    this._scoreTimer = setTimeout(() => this.hud.score.classList.remove('bump'), 220);
  }

  /* ============================================================
     渲染
     ============================================================ */

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, FIELD, FIELD);

    // 地面
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, FIELD, FIELD);

    ctx.strokeStyle = 'rgba(255,255,255,.032)';
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i++) {
      const p = i * TILE + 0.5;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, FIELD); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(FIELD, p); ctx.stroke();
    }

    const map = this.map;

    // 地形（树林除外）
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const t = map.tileAt(c, r);
        const x = c * TILE, y = r * TILE;
        if (t === T_BRICK) drawBrickTile(ctx, map.mask[r * GRID + c], x, y);
        else if (t === T_STEEL) drawSteelTile(ctx, x, y);
        else if (t === T_WATER) drawWaterTile(ctx, x, y, this.time);
      }
    }

    // 基地
    drawBase(ctx, this.baseAlive, this.time);

    // 道具
    for (const p of this.powerups) p.draw(ctx, this.time);

    // 坦克
    for (const t of this.tanks) t.draw(ctx, this.time);

    // 子弹
    for (const b of this.bullets) b.draw(ctx);

    // 爆炸
    for (const e of this.explosions) e.draw(ctx);

    // 树林盖在最上层
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (map.tileAt(c, r) === T_TREE) drawTreeTile(ctx, c * TILE, r * TILE, this.time);
      }
    }

    // 时间冻结的蓝色滤镜
    if (this.freezeT > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(40,70,140,${0.10 + Math.sin(this.time * 4) * 0.03})`;
      ctx.fillRect(0, 0, FIELD, FIELD);
      ctx.restore();
    }

    // 状态横幅
    if (this.state === STATE.READY) this.drawBanner(ctx, `第 ${this.level} 关`, '准备');
    if (this.state === STATE.CLEAR) this.drawBanner(ctx, '关卡完成', `得分 ${this.score}`);

    // 内描边
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, FIELD - 2, FIELD - 2);
  }

  drawBanner(ctx, title, sub) {
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,11,.62)';
    ctx.fillRect(0, FIELD / 2 - 68, FIELD, 136);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#f0c24b';
    ctx.font = 'bold 42px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(title, FIELD / 2, FIELD / 2 - 18);

    ctx.fillStyle = '#8994a8';
    ctx.font = '17px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(sub, FIELD / 2, FIELD / 2 + 32);

    ctx.restore();
  }
}

/* ============================================================
   地形绘制
   ============================================================ */

function drawBrickTile(ctx, mask, x, y) {
  if (!mask) return;
  ctx.save();
  ctx.beginPath();
  if (mask & 1) ctx.rect(x, y, QUAD, QUAD);
  if (mask & 2) ctx.rect(x + QUAD, y, QUAD, QUAD);
  if (mask & 4) ctx.rect(x, y + QUAD, QUAD, QUAD);
  if (mask & 8) ctx.rect(x + QUAD, y + QUAD, QUAD, QUAD);
  ctx.clip();

  ctx.fillStyle = '#4a2010';
  ctx.fillRect(x, y, TILE, TILE);

  const rows = 4, rh = TILE / rows;
  for (let i = 0; i < rows; i++) {
    const ry = y + i * rh;
    const off = (i % 2) ? -10 : 0;
    for (let bx = off; bx < TILE; bx += 20) {
      const px = x + bx + 1;
      const pw = Math.min(18, x + TILE - px - 1);
      if (pw <= 0) continue;
      ctx.fillStyle = '#b5532c';
      ctx.fillRect(px, ry + 1, pw, rh - 2);
      ctx.fillStyle = 'rgba(255,220,180,.16)';
      ctx.fillRect(px, ry + 1, pw, 2);
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(px, ry + rh - 3, pw, 2);
    }
  }
  ctx.restore();
}

function drawSteelTile(ctx, x, y) {
  ctx.fillStyle = '#4d5566';
  ctx.fillRect(x, y, TILE, TILE);
  for (let i = 0; i < 4; i++) {
    const px = x + (i % 2) * QUAD;
    const py = y + ((i >> 1) | 0) * QUAD;
    ctx.fillStyle = '#9aa5b8';
    ctx.fillRect(px + 1, py + 1, QUAD - 2, QUAD - 2);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(px + 1, py + 1, QUAD - 2, 2);
    ctx.fillRect(px + 1, py + 1, 2, QUAD - 2);
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.fillRect(px + 1, py + QUAD - 3, QUAD - 2, 2);
    ctx.fillRect(px + QUAD - 3, py + 1, 2, QUAD - 2);
    ctx.fillStyle = '#dfe6f0';
    ctx.fillRect(px + QUAD / 2 - 3, py + QUAD / 2 - 3, 6, 6);
  }
}

function drawWaterTile(ctx, x, y, time) {
  const g = ctx.createLinearGradient(x, y, x, y + TILE);
  g.addColorStop(0, '#1d4f80');
  g.addColorStop(1, '#102c4a');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, TILE, TILE);

  ctx.strokeStyle = 'rgba(150,205,255,.34)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 3; i++) {
    const yy = y + 9 + i * 11;
    ctx.beginPath();
    for (let px = 0; px <= TILE; px += 5) {
      const py = yy + Math.sin(px / TILE * Math.PI * 2 + time * 2.4 + i * 1.9) * 2.2;
      if (px === 0) ctx.moveTo(x, py); else ctx.lineTo(x + px, py);
    }
    ctx.stroke();
  }
}

function drawTreeTile(ctx, x, y, time) {
  ctx.save();
  ctx.fillStyle = '#1d5526';
  ctx.fillRect(x, y, TILE, TILE);
  for (let i = 0; i < 4; i++) {
    const px = x + (i % 2) * QUAD + QUAD / 2;
    const py = y + ((i >> 1) | 0) * QUAD + QUAD / 2;
    const sway = Math.sin(time * 1.6 + px * 0.05) * 1.4;
    ctx.fillStyle = '#2c7a35';
    ctx.beginPath(); ctx.arc(px + sway, py, QUAD * 0.64, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#43a94b';
    ctx.beginPath(); ctx.arc(px + sway - 2, py - 2.5, QUAD * 0.36, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawBase(ctx, alive, time) {
  const { x, y, w, h } = BASE_RECT;
  const cx = x + w / 2;
  const cy = y + h / 2;

  ctx.save();
  ctx.fillStyle = '#0d1017';
  ctx.fillRect(x, y, w, h);

  const gold = alive ? '#e8c04a' : '#5a5f6b';
  const dark = alive ? '#8a6f1c' : '#33373f';

  if (alive) {
    ctx.shadowColor = 'rgba(232,192,74,.45)';
    ctx.shadowBlur = 16 + Math.sin(time * 2) * 6;
  }

  // 底座
  ctx.fillStyle = dark;
  roundRect(ctx, cx - 30, cy + 16, 60, 12, 4);
  ctx.fill();

  // 翅膀
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 20);
  ctx.lineTo(cx + 27, cy - 4);
  ctx.lineTo(cx + 18, cy + 18);
  ctx.lineTo(cx + 6, cy + 10);
  ctx.lineTo(cx, cy + 22);
  ctx.lineTo(cx - 6, cy + 10);
  ctx.lineTo(cx - 18, cy + 18);
  ctx.lineTo(cx - 27, cy - 4);
  ctx.closePath();
  ctx.fill();

  // 头
  ctx.beginPath();
  ctx.arc(cx, cy - 16, 8, 0, Math.PI * 2);
  ctx.fill();

  // 眼
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0d1017';
  ctx.beginPath();
  ctx.arc(cx - 3, cy - 17, 1.6, 0, Math.PI * 2);
  ctx.arc(cx + 3, cy - 17, 1.6, 0, Math.PI * 2);
  ctx.fill();

  if (!alive) {
    // 残骸
    ctx.strokeStyle = 'rgba(200,90,50,.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy - 14); ctx.lineTo(cx + 20, cy + 16);
    ctx.moveTo(cx + 22, cy - 12); ctx.lineTo(cx - 18, cy + 14);
    ctx.stroke();
  }

  ctx.restore();
}

/* ============================================================
   启动
   ============================================================ */

window.addEventListener('load', () => {
  window.game = new Game();
});
