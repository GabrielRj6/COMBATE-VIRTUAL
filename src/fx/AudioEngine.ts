import { EventBus } from '../core/EventBus';

/**
 * Motor de áudio 100% procedural via Web Audio API.
 * Sintetiza movimento (vento, boost, pulo, dash) e combate (whoosh, impactos, bloqueio, poderes e explosões).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // Nós contínuos (vento de voo + ressonância de ki)
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private chargeGain: GainNode | null = null;
  private chargeOsc: OscillatorNode | null = null;

  public muted = false;
  private initialized = false;
  private unsubscribers: Array<() => void> = [];

  constructor(events: EventBus, localPlayerId: string) {
    this.unsubscribers.push(
      // Fase 1 — Movimento
      events.on('flight:toggle', ({ playerId, flying }) => {
        if (playerId !== localPlayerId) return;
        this.playFlightToggle(flying);
      }),
      events.on('boost:start', ({ playerId }) => {
        if (playerId !== localPlayerId) return;
        this.playBoostIgnition();
      }),
      events.on('player:jump', ({ playerId, airJump }) => {
        if (playerId !== localPlayerId) return;
        this.playJump(airJump);
      }),
      events.on('player:land', ({ playerId, impactSpeed }) => {
        if (playerId !== localPlayerId) return;
        this.playLand(impactSpeed);
      }),
      events.on('player:dash', ({ playerId }) => {
        if (playerId !== localPlayerId) return;
        this.playDash();
      }),

      // Fase 2 — Combate
      events.on('combat:attack', ({ playerId, kind }) => {
        if (playerId !== localPlayerId) return;
        if (kind === 'light' || kind === 'heavy') {
          this.playSwingWhoosh(kind);
        }
      }),
      events.on('combat:hit', ({ kind, power, backstab }) => {
        if (kind === 'blocked') {
          this.playBlockedHit(power);
        } else {
          this.playCombatHit(kind, power);
          if (backstab) this.playBackstabChime();
        }
      }),
      events.on('combat:guardbreak', () => {
        this.playGuardBreak();
      }),
      events.on('combat:dodge', () => {
        this.playDodgeWhoosh();
      }),
      events.on('teleport:trigger', ({ behindTarget }) => {
        this.playTeleportSnap(behindTarget);
      }),
      events.on('combat:clash', () => {
        this.playClashShockwave();
      }),
      events.on('combat:wallimpact', ({ speed }) => {
        this.playWallImpact(speed);
      }),
      events.on('skill:charge', ({ duration }) => {
        this.playSkillCharge(duration);
      }),
      events.on('skill:fire', ({ slot }) => {
        this.playSkillFire(slot);
      }),
      events.on('projectile:explode', ({ power }) => {
        this.playExplosion(power);
      }),
      events.on('fighter:death', () => {
        this.playKnockout();
      }),
    );
  }

  /** Deve ser chamado no primeiro gesto do usuário (clique ou tecla) para destravar Web Audio. */
  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.32;
    master.connect(ctx.destination);
    this.masterGain = master;

    // Buffer de ruído branco compartilhado para vento, golpes e explosões
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = noiseBuffer;

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 340;
    windFilter.Q.value = 1.4;

    const windGain = ctx.createGain();
    windGain.gain.value = 0;

    noiseSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    noiseSource.start();

    this.windFilter = windFilter;
    this.windGain = windGain;

    // Oscilador harmônico para carregar Ki
    const chargeOsc = ctx.createOscillator();
    chargeOsc.type = 'sawtooth';
    chargeOsc.frequency.value = 98;

    const chargeFilter = ctx.createBiquadFilter();
    chargeFilter.type = 'lowpass';
    chargeFilter.frequency.value = 420;

    const chargeGain = ctx.createGain();
    chargeGain.gain.value = 0;

    chargeOsc.connect(chargeFilter);
    chargeFilter.connect(chargeGain);
    chargeGain.connect(master);
    chargeOsc.start();

    this.chargeOsc = chargeOsc;
    this.chargeGain = chargeGain;

    this.initialized = true;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.32, this.ctx.currentTime, 0.05);
    }
  }

  public updateContinuous(
    speedMs: number,
    flyMode: boolean,
    isBoosting: boolean,
    isCharging: boolean,
  ): void {
    if (
      !this.initialized ||
      !this.ctx ||
      !this.windGain ||
      !this.windFilter ||
      !this.chargeGain ||
      !this.chargeOsc
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    const speedFactor = Math.min(1, Math.max(0, (speedMs - 14) / 80));
    const targetWindGain = flyMode ? speedFactor * (isBoosting ? 0.36 : 0.16) : speedFactor * 0.06;
    const targetWindFreq = 260 + speedFactor * (isBoosting ? 1350 : 620);

    this.windGain.gain.setTargetAtTime(targetWindGain, now, 0.08);
    this.windFilter.frequency.setTargetAtTime(targetWindFreq, now, 0.08);

    const targetChargeGain = isCharging ? 0.15 : 0;
    this.chargeGain.gain.setTargetAtTime(targetChargeGain, now, 0.09);
    if (isCharging) {
      this.chargeOsc.frequency.setTargetAtTime(118 + Math.sin(now * 16) * 8, now, 0.05);
    }
  }

  // ============================================================================
  // SONS DE MOVIMENTO (Fase 1)
  // ============================================================================

  private playFlightToggle(flying: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(flying ? 180 : 320, now);
    osc.frequency.exponentialRampToValueAtTime(flying ? 480 : 120, now + 0.16);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  private playBoostIgnition(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.32);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  private playJump(airJump: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(airJump ? 240 : 150, now);
    osc.frequency.exponentialRampToValueAtTime(airJump ? 620 : 340, now + 0.12);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  private playLand(impactSpeed: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const intensity = Math.min(1, impactSpeed / 35);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.14);
    gain.gain.setValueAtTime(0.26 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  private playDash(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.13);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  // ============================================================================
  // SONS DE COMBATE (Fase 2)
  // ============================================================================

  private playSwingWhoosh(kind: 'light' | 'heavy'): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = kind === 'heavy' ? 0.24 : 0.12;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.2;
    filter.frequency.setValueAtTime(kind === 'heavy' ? 520 : 1200, now);
    filter.frequency.exponentialRampToValueAtTime(kind === 'heavy' ? 160 : 340, now + dur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(kind === 'heavy' ? 0.28 : 0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  private playCombatHit(kind: 'light' | 'heavy' | 'skill', power: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const p = Math.max(0.25, Math.min(1, power));

    // Punch grave de impacto
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = kind === 'heavy' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(kind === 'heavy' ? 155 : 190, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.12 + p * 0.1);
    oscGain.gain.setValueAtTime(0.32 + p * 0.24, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15 + p * 0.12);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.28);

    // Estalo de ruído curto
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(kind === 'skill' ? 1600 : 950, now);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.24 + p * 0.2, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09 + p * 0.08);
    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.2);
  }

  private playBlockedHit(power: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Som metálico de defesa
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'square';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(640, now);
    osc1.frequency.exponentialRampToValueAtTime(280, now + 0.14);
    osc2.frequency.setValueAtTime(1180, now);
    osc2.frequency.exponentialRampToValueAtTime(520, now + 0.12);

    gain.gain.setValueAtTime(0.18 + power * 0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.18);
    osc2.stop(now + 0.18);
  }

  private playGuardBreak(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.34);
    gain.gain.setValueAtTime(0.38, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  private playDodgeWhoosh(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.09);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  private playSkillCharge(duration: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = Math.max(0.1, Math.min(1.8, duration));
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(680 + dur * 180, now + dur);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.linearRampToValueAtTime(0.22, now + dur * 0.85);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.04);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.06);
  }

  private playSkillFire(slot: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    if (slot === 2) {
      // Rajada rápida aguda
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(760, now);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.08);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.1);
      return;
    }

    if (slot === 3) {
      // Raio carregado
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.42);
      gain.gain.setValueAtTime(0.34, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.48);
      return;
    }

    if (slot === 4) {
      // Ultimate massivo
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.65);
      gain.gain.setValueAtTime(0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.72);
      return;
    }

    // Slot 1 — Pulso de Ki
    osc.type = 'sine';
    osc.frequency.setValueAtTime(540, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.14);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  private playExplosion(power: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const p = Math.max(0.2, Math.min(1, power));
    const dur = 0.25 + p * 0.55;

    // Sub-bass
    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + dur);
    oGain.gain.setValueAtTime(0.28 + p * 0.3, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(oGain);
    oGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);

    // Ruído grave filtrado
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420 + p * 900, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + dur);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.22 + p * 0.28, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    src.start(now);
    src.stop(now + dur + 0.04);
  }

  private playKnockout(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.52);
    gain.gain.setValueAtTime(0.42, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.56);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.58);
  }

  // ============================================================================
  // SONS FASE 3 (Teleporte, Clash, Impacto em Parede, Crítico pelas Costas)
  // ============================================================================

  private playTeleportSnap(behindTarget: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Estalo agudo-grave estilo teleporte instantâneo de anime
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(behindTarget ? 1480 : 1120, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.085);
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);

    // Pop de chegada 55ms depois
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(220, now + 0.05);
    osc2.frequency.exponentialRampToValueAtTime(behindTarget ? 780 : 540, now + 0.12);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.24, now + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc2.connect(gain2);
    gain2.connect(this.masterGain);
    osc2.start(now + 0.045);
    osc2.stop(now + 0.15);
  }

  private playClashShockwave(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    // Ressonância metálica dupla + onda de choque
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(840, now);
    osc1.frequency.exponentialRampToValueAtTime(180, now + 0.28);
    osc2.frequency.setValueAtTime(1260, now);
    osc2.frequency.exponentialRampToValueAtTime(340, now + 0.26);
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.32);
    osc2.stop(now + 0.32);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(160, now + 0.28);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.32, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.3);
  }

  private playWallImpact(speed: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const intensity = Math.min(1, Math.max(0.4, speed / 45));

    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.24);
    oGain.gain.setValueAtTime(0.42 * intensity, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(oGain);
    oGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.28);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.22);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.34 * intensity, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.26);
  }

  private playBackstabChime(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1560, now + 0.08);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public dispose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
