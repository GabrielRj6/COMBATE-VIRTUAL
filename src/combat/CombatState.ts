import { MeleeMove } from './Skills';

export type AttackKind = 'none' | 'light' | 'heavy' | 'skill';

export interface CombatStateSnapshot {
  lockTargetId: string | null;
  attackKind: AttackKind;
  attackTimer: number;
  attackDuration: number;
  attackMoveId: MeleeMove['id'] | null;
  comboIndex: number;
  castSlot: number;
  castTimer: number;
  castDuration: number;
  cooldowns: [number, number, number, number];
  teleportCooldown: number;
  teleportTimer: number;
  stunTimer: number;
  isBlocking: boolean;
  respawnTimer: number;
}

/**
 * Estado de combate por jogador (sem dependência de Three.js).
 * Armazena timers de golpe, combo, carga de poderes, teleporte, bloqueio, stun e respawn.
 */
export class CombatState {
  public lockTargetId: string | null = null;

  public attackKind: AttackKind = 'none';
  public attackTimer = 0;
  public attackDuration = 0;
  public attackMove: MeleeMove | null = null;
  public hitDone = false;

  public comboIndex = 0;
  public comboWindow = 0;
  public buffered: 'light' | 'heavy' | null = null;
  public bufferTimer = 0;

  public aimYaw = 0;

  public castSlot = 0; // 1..4 ou 0 quando inativo
  public castTimer = 0;
  public castDuration = 0;

  public burstLeft = 0;
  public burstTimer = 0;

  public cooldowns: [number, number, number, number] = [0, 0, 0, 0];

  // Fase 3 — Teleporte e bônus de ataque pelas costas
  public teleportCooldown = 0;
  public teleportTimer = 0;
  public backAttackTimer = 0;
  public backAttackTargetId: string | null = null;
  public wallImpactCooldown = 0;

  public invulnTimer = 0;
  public stunTimer = 0;
  public stunImmune = 0;

  public isBlocking = false;
  public lastHitBy: string | null = null;
  public respawnTimer = 0;
  public hitFlash = 0;

  public get isBusy(): boolean {
    return this.attackTimer > 0 || this.castTimer > 0 || this.burstLeft > 0;
  }

  public attackProgress(): number {
    if (this.attackDuration <= 0 || this.attackTimer <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - this.attackTimer / this.attackDuration));
  }

  public castProgress(): number {
    if (this.castDuration <= 0 || this.castTimer <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - this.castTimer / this.castDuration));
  }

  public cancelActions(): void {
    this.attackKind = 'none';
    this.attackTimer = 0;
    this.attackDuration = 0;
    this.attackMove = null;
    this.hitDone = false;
    this.castSlot = 0;
    this.castTimer = 0;
    this.castDuration = 0;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.buffered = null;
    this.bufferTimer = 0;
    this.isBlocking = false;
  }

  public resetForRespawn(): void {
    this.cancelActions();
    this.comboIndex = 0;
    this.comboWindow = 0;
    this.stunTimer = 0;
    this.stunImmune = 0;
    this.invulnTimer = 1.8;
    this.respawnTimer = 0;
    this.hitFlash = 0;
    this.lastHitBy = null;
    this.teleportCooldown = 0;
    this.teleportTimer = 0;
    this.backAttackTimer = 0;
    this.backAttackTargetId = null;
    this.wallImpactCooldown = 0;
    this.cooldowns[0] = 0;
    this.cooldowns[1] = 0;
    this.cooldowns[2] = 0;
    this.cooldowns[3] = 0;
  }

  public toJSON(): CombatStateSnapshot {
    return {
      lockTargetId: this.lockTargetId,
      attackKind: this.attackKind,
      attackTimer: Number(this.attackTimer.toFixed(3)),
      attackDuration: Number(this.attackDuration.toFixed(3)),
      attackMoveId: this.attackMove ? this.attackMove.id : null,
      comboIndex: this.comboIndex,
      castSlot: this.castSlot,
      castTimer: Number(this.castTimer.toFixed(3)),
      castDuration: Number(this.castDuration.toFixed(3)),
      cooldowns: [
        Number(this.cooldowns[0].toFixed(2)),
        Number(this.cooldowns[1].toFixed(2)),
        Number(this.cooldowns[2].toFixed(2)),
        Number(this.cooldowns[3].toFixed(2)),
      ],
      teleportCooldown: Number(this.teleportCooldown.toFixed(2)),
      teleportTimer: Number(this.teleportTimer.toFixed(3)),
      stunTimer: Number(this.stunTimer.toFixed(3)),
      isBlocking: this.isBlocking,
      respawnTimer: Number(this.respawnTimer.toFixed(2)),
    };
  }
}
