'use strict';
/* ============================================================
   音效：全部用 Web Audio 实时合成，不依赖任何外部音频文件
   ============================================================ */

class SoundFX {

  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  /* 浏览器要求首次交互后才能播声音，所以延迟创建 */
  ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
    } catch (_) {
      return false;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
    return true;
  }

  resume() {
    if (!this.ensure()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.22, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  get t0() { return this.ctx.currentTime; }

  /* ---------- 基础发声单元 ---------- */

  /** 一个带包络的振荡器音 */
  tone({ freq = 440, dur = 0.12, type = 'square', vol = 1, slideTo = null, delay = 0 }) {
    if (!this.ensure() || this.muted) return;
    const ctx = this.ctx;
    const start = this.t0 + delay;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), start + dur);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /** 一段白噪声（爆炸、撞击） */
  noise({ dur = 0.22, vol = 1, cutoff = 1200, q = 1, delay = 0, sweepTo = null }) {
    if (!this.ensure() || this.muted) return;
    const ctx = this.ctx;
    const start = this.t0 + delay;

    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, start);
    filter.Q.value = q;
    if (sweepTo !== null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), start + dur);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    src.connect(filter).connect(gain).connect(this.master);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  /* ---------- 具体音效 ---------- */

  shoot() {
    this.tone({ freq: 620, slideTo: 180, dur: 0.09, type: 'square', vol: 0.28 });
    this.noise({ dur: 0.05, vol: 0.16, cutoff: 2600 });
  }

  brickHit() {
    this.noise({ dur: 0.07, vol: 0.3, cutoff: 3200, sweepTo: 900 });
  }

  steelHit() {
    this.tone({ freq: 1400, slideTo: 900, dur: 0.05, type: 'triangle', vol: 0.22 });
    this.noise({ dur: 0.05, vol: 0.14, cutoff: 5200 });
  }

  explodeSmall() {
    this.noise({ dur: 0.26, vol: 0.55, cutoff: 1500, sweepTo: 180 });
    this.tone({ freq: 180, slideTo: 50, dur: 0.22, type: 'sawtooth', vol: 0.16 });
  }

  explodeBig() {
    this.noise({ dur: 0.62, vol: 0.85, cutoff: 900, sweepTo: 90, q: 2 });
    this.tone({ freq: 120, slideTo: 32, dur: 0.55, type: 'sawtooth', vol: 0.26 });
  }

  powerup() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.11, type: 'square', vol: 0.24, delay: i * 0.055 }));
  }

  extraLife() {
    const notes = [784, 988, 1175, 1568, 2093];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.13, type: 'triangle', vol: 0.26, delay: i * 0.07 }));
  }

  levelStart() {
    const notes = [392, 523, 659, 523, 784];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.14, type: 'square', vol: 0.2, delay: i * 0.1 }));
  }

  levelClear() {
    const notes = [659, 784, 988, 1319];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.18, type: 'square', vol: 0.24, delay: i * 0.12 }));
  }

  gameOver() {
    const notes = [523, 440, 349, 262, 196];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.32, type: 'sawtooth', vol: 0.24, delay: i * 0.2 }));
    this.noise({ dur: 1.1, vol: 0.24, cutoff: 700, sweepTo: 80, delay: 0.9 });
  }
}
