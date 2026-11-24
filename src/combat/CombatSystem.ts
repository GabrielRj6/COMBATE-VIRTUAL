import { EventBus } from '../core/EventBus';
import { PlayerCommand } from '../core/Input';
import { SeededRNG } from '../core/RNG';
import { FighterState } from '../entities/Fighter';
import { Player } from '../entities/Player';
import { groundHeightAt, WorldBoxCollider } from '../world/WorldGeometry';
import {
  BEAM_DEFAULT_LIFE,
  BeamFx,
  createBeamPool,
  createProjectilePool,
  PROJECTILE_DEFAULT_LIFE,
  ProjectileSlot,
  segmentAABBIntersectT,
  segmentPointDistSq,
} from './Projectile';
import {
  BACKSTAB_MULTIPLIER,
  BLOCK_KI_REDUCTION,
  BLOCK_MELEE_REDUCTION,
  BLOCK_STAMINA_PER_DAMAGE,
  CLASH_HITSTOP,
  CLASH_KNOCKBACK,
  CLASH_RANGE,
  COMBO_WINDOW,
  getSkillBySlot,
  GUARD_BREAK_STUN,
  HEAVY_MOVE,
  INPUT_BUFFER,
  LIGHT_COMBO,
  MELEE_MOVE_SCALE,
  MeleeMove,
  RESPAWN_TIME_BOT,
  RESPAWN_TIME_PLAYER,
  SkillDef,
  WALL_IMPACT_DAMAGE,
} from './Skills';
import { tryExecuteTeleport } from './Teleport';

export interface AimResult {
  dx: number;
  dy: number;
  dz: number;
  target: Player | null;
  dist: number;
}

const LOCK_MAX_DIST = 312;
const DEAD_GRAVITY = 36.0;

/**
 * Núcleo de combate 60Hz (sem Three.js, determinístico com SeededRNG e pools pré-alocados).
 * Inclui Fase 2 (combos, poderes, bloqueio, respawn) + Fase 3 (teleporte, backstab, clash e impacto em parede).
 */
export class CombatSystem {
  public readonly projectiles: ProjectileSlot[] = createProjectilePool();
  public readonly beams: BeamFx[] = createBeamPool();

  public hitStopRequest = 0;

  // Telemetria de combate para o jogador local
  public localComboHits = 0;
  public localComboTimer = 0;
  public localHitMarkerTimer = 0;
  public localHurtTimer = 0;
  public localBackstabTimer = 0;
  public localClashTimer = 0;

  private readonly players: Player[];
  private readonly colliders: WorldBoxCollider[];
  private readonly events: EventBus;
  private readonly rng: SeededRNG;
  private readonly localPlayerId: string;

  private projSeq = 0;
  private beamSeq = 0;
  private impactSeq = 0;

  // Buffer reutilizável de mira para evitar alocação no loop de 60Hz
  private readonly _aimOut: AimResult = {
    dx: 0,
    dy: 0,
    dz: -1,
    target: null,
    dist: 0,
  };

  constructor(
    players: Player[],
    colliders: WorldBoxCollider[],
    events: EventBus,
    rng: SeededRNG,
    localPlayerId: string,
  ) {
    this.players = players;
    this.colliders = colliders;
    this.events = events;
    this.rng = rng;
    this.localPlayerId = localPlayerId;
  }

  /**
   * Atualiza o combate de um jogador no tick atual (chamado logo após PlayerController.step).
   */
  public step(player: Player, cmd: PlayerCommand, dt: number): void {
    const c = player.combat;

    // 1. Morto: cai com gravidade, desliza e aguarda respawn
    if (player.fighter.state === FighterState.DEAD) {
      this.updateDead(player, dt);
      return;
    }

    // 2. Decrementa timers gerais
    if (c.invulnTimer > 0) c.invulnTimer = Math.max(0, c.invulnTimer - dt);
    if (c.hitFlash > 0) c.hitFlash = Math.max(0, c.hitFlash - dt);
    if (c.teleportCooldown > 0) c.teleportCooldown = Math.max(0, c.teleportCooldown - dt);
    if (c.teleportTimer > 0) c.teleportTimer = Math.max(0, c.teleportTimer - dt);
    if (c.wallImpactCooldown > 0) c.wallImpactCooldown = Math.max(0, c.wallImpactCooldown - dt);
    if (c.backAttackTimer > 0) {
      c.backAttackTimer -= dt;
      if (c.backAttackTimer <= 0) {
        c.backAttackTimer = 0;
        c.backAttackTargetId = null;
      }
    }
    if (c.stunImmune > 0 && c.stunTimer <= 0) {
      c.stunImmune = Math.max(0, c.stunImmune - dt);
    }

    for (let i = 0; i < 4; i++) {
      if (c.cooldowns[i] > 0) c.cooldowns[i] = Math.max(0, c.cooldowns[i] - dt);
    }

    if (c.bufferTimer > 0) {
      c.bufferTimer -= dt;
      if (c.bufferTimer <= 0) {
        c.bufferTimer = 0;
        c.buffered = null;
      }
    }

    if (c.comboWindow > 0) {
      c.comboWindow -= dt;
      if (c.comboWindow <= 0) {
        c.comboWindow = 0;
        c.comboIndex = 0;
      }
    }

    // 3. Lock-on (apenas jogador humano) e validação contínua do alvo
    if (!player.isBot && cmd.lockOnPressed) {
      this.toggleLockOn(player, cmd);
    }
    this.validateLockTarget(player);

    // 4. Atordoado / Knockback
    if (c.stunTimer > 0) {
      c.stunTimer -= dt;
      c.isBlocking = false;
      player.moveScale = 0;
      player.fighter.state =
        player.controlLock > 0 ? FighterState.KNOCKBACK : FighterState.STUNNED;

      if (c.stunTimer <= 0) {
        c.stunTimer = 0;
        c.stunImmune = 0.5;
        player.moveScale = 1;
      }
      return;
    }

    // 5. Teleporte (Q — Fase 3): cancela recuperações de ataque para encadear combos aéreos
    if (cmd.teleportPressed) {
      if (tryExecuteTeleport(player, cmd, this.players, this.colliders, this.events)) {
        if (player.id === this.localPlayerId) {
          this.events.emit('camera:shake', { intensity: 0.22, duration: 0.14 });
        }
        return;
      }
    }

    // 6. Esquiva (dash) cancela ações de ataque/carga em andamento
    if (player.dashTimer > 0 && c.isBusy) {
      c.cancelActions();
    }

    // 7. Bloqueio frontal com E
    c.isBlocking =
      cmd.defend && !c.isBusy && player.dashTimer <= 0 && player.fighter.stamina > 1;

    // 8. Buffer de ataques corpo a corpo
    if (cmd.lightAttack) {
      c.buffered = 'light';
      c.bufferTimer = INPUT_BUFFER;
    } else if (cmd.heavyAttack) {
      c.buffered = 'heavy';
      c.bufferTimer = INPUT_BUFFER;
    }

    // 9. Poderes de Ki (slots 1..4)
    if (cmd.skillSlot > 0 && !c.isBusy && !c.isBlocking && player.dashTimer <= 0) {
      this.tryStartSkill(player, cmd.skillSlot, cmd);
    }

    // 10. Inicia golpe corpo a corpo bufferizado se estiver livre
    if (!c.isBusy && c.buffered && !c.isBlocking && player.dashTimer <= 0) {
      const kind = c.buffered;
      c.buffered = null;
      c.bufferTimer = 0;
      this.startMelee(player, kind, cmd);
    }

    // 11. Atualiza ataque corpo a corpo e carga/rajada de poderes
    this.updateMelee(player, dt);
    this.updateCast(player, cmd, dt);

    // 12. Modificadores de movimento e estado final do Fighter
    if (c.teleportTimer > 0) {
      player.moveScale = 1.0;
      player.fighter.state = FighterState.TELEPORTING;
    } else if (c.castTimer > 0 || c.burstLeft > 0) {
      player.moveScale = 0.12;
      player.fighter.state = FighterState.ATTACKING;
    } else if (c.attackTimer > 0) {
      player.moveScale = MELEE_MOVE_SCALE;
      player.fighter.state = FighterState.ATTACKING;
    } else if (c.isBlocking) {
      player.moveScale = 0.5;
    } else {
      player.moveScale = 1.0;
    }
  }

  /** Aplica dano extra quando um guerreiro em knockback bate forte em um prédio (Fase 3). */
  public handleWallImpact(player: Player, x: number, y: number, z: number, speed: number): void {
    if (player.fighter.state === FighterState.DEAD) return;
    if (player.combat.wallImpactCooldown > 0) return;

    player.combat.wallImpactCooldown = 0.45;
    const bonusDmg = Math.round(WALL_IMPACT_DAMAGE * Math.min(1.8, speed / 30));
    player.fighter.hp = Math.max(0, player.fighter.hp - bonusDmg);
    player.combat.hitFlash = 0.18;

    const killer = player.combat.lastHitBy ? this.findPlayerById(player.combat.lastHitBy) : null;
    this.events.emit('combat:wallimpact', { playerId: player.id, x, y, z, speed });
    this.emitImpactEvent(x, y, z, 4.5, 4, 0, 0.2, 0);
    this.emitCameraShakeNearLocal(x, y, z, 0.55, 0.24);

    if (player.fighter.hp <= 0) {
      this.kill(player, killer, 0, 0.3, 0, 12);
    }
  }

  /** Atualiza timers de combo/feedback do HUD local. */
  public updateHudTimers(dt: number): void {
    if (this.localComboTimer > 0) {
      this.localComboTimer -= dt;
      if (this.localComboTimer <= 0) {
        this.localComboTimer = 0;
        this.localComboHits = 0;
      }
    }
    if (this.localHitMarkerTimer > 0) {
      this.localHitMarkerTimer = Math.max(0, this.localHitMarkerTimer - dt);
    }
    if (this.localHurtTimer > 0) {
      this.localHurtTimer = Math.max(0, this.localHurtTimer - dt);
    }
    if (this.localBackstabTimer > 0) {
      this.localBackstabTimer = Math.max(0, this.localBackstabTimer - dt);
    }
    if (this.localClashTimer > 0) {
      this.localClashTimer = Math.max(0, this.localClashTimer - dt);
    }
  }

  /**
   * Calcula direção de mira 3D normalizada (Seção 6).
   * Reutiliza `_aimOut` para evitar alocações por tick.
   */
  public computeAim(
    player: Player,
    cmd: PlayerCommand | null,
    maxDist: number,
    lead: number,
  ): AimResult {
    let baseDx: number;
    let baseDy: number;
    let baseDz: number;

    if (cmd) {
      baseDx = -Math.sin(cmd.cameraYaw);
      baseDy = -Math.sin(cmd.cameraPitch - 0.22);
      baseDz = -Math.cos(cmd.cameraYaw);
      const len = Math.hypot(baseDx, baseDy, baseDz) || 1;
      baseDx /= len;
      baseDy /= len;
      baseDz /= len;
    } else {
      baseDx = Math.sin(player.facingYaw);
      baseDy = 0;
      baseDz = Math.cos(player.facingYaw);
    }

    const originX = player.pos.x;
    const originY = player.pos.y + 1.0;
    const originZ = player.pos.z;

    let target: Player | null = null;
    let bestDist = maxDist;

    if (player.combat.lockTargetId) {
      const locked = this.findPlayerById(player.combat.lockTargetId);
      if (locked && locked.fighter.state !== FighterState.DEAD && !this.isFriendly(player, locked)) {
        const d = Math.hypot(
          locked.pos.x - originX,
          locked.pos.y + 1.0 - originY,
          locked.pos.z - originZ,
        );
        target = locked;
        bestDist = d;
      }
    }

    if (!target) {
      for (let i = 0; i < this.players.length; i++) {
        const cand = this.players[i];
        if (cand.id === player.id) continue;
        if (cand.fighter.state === FighterState.DEAD) continue;
        if (this.isFriendly(player, cand)) continue;

        const tx = cand.pos.x - originX;
        const ty = cand.pos.y + 1.0 - originY;
        const tz = cand.pos.z - originZ;
        const dist = Math.hypot(tx, ty, tz);
        if (dist > maxDist || dist < 0.001) continue;

        const dot = (tx * baseDx + ty * baseDy + tz * baseDz) / dist;
        if (dot > 0.9 && dist < bestDist) {
          bestDist = dist;
          target = cand;
        }
      }
    }

    if (target) {
      let tx = target.pos.x;
      let ty = target.pos.y + 1.0;
      let tz = target.pos.z;

      if (lead > 0) {
        const tLead = Math.min(1.5, bestDist / lead);
        tx += target.vel.x * tLead;
        ty += target.vel.y * tLead;
        tz += target.vel.z * tLead;
      }

      const dx = tx - originX;
      const dy = ty - originY;
      const dz = tz - originZ;
      const len = Math.hypot(dx, dy, dz) || 1;
      this._aimOut.dx = dx / len;
      this._aimOut.dy = dy / len;
      this._aimOut.dz = dz / len;
      this._aimOut.target = target;
      this._aimOut.dist = bestDist;
      return this._aimOut;
    }

    this._aimOut.dx = baseDx;
    this._aimOut.dy = baseDy;
    this._aimOut.dz = baseDz;
    this._aimOut.target = null;
    this._aimOut.dist = maxDist;
    return this._aimOut;
  }

  private toggleLockOn(player: Player, cmd: PlayerCommand): void {
    const c = player.combat;
    if (c.lockTargetId) {
      c.lockTargetId = null;
      this.events.emit('lock:change', { playerId: player.id, targetId: null });
      return;
    }

    const camFx = -Math.sin(cmd.cameraYaw);
    const camFz = -Math.cos(cmd.cameraYaw);

    let best: Player | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < this.players.length; i++) {
      const cand = this.players[i];
      if (cand.id === player.id) continue;
      if (cand.fighter.state === FighterState.DEAD) continue;
      if (this.isFriendly(player, cand)) continue;

      const dx = cand.pos.x - player.pos.x;
      const dy = cand.pos.y - player.pos.y;
      const dz = cand.pos.z - player.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > LOCK_MAX_DIST) continue;

      const hDist = Math.hypot(dx, dz) || 1;
      const dot = (dx * camFx + dz * camFz) / hDist;
      const score = dist * (1.45 - dot * 0.45);
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    if (best) {
      c.lockTargetId = best.id;
      this.events.emit('lock:change', { playerId: player.id, targetId: best.id });
    }
  }

  private validateLockTarget(player: Player): void {
    const targetId = player.combat.lockTargetId;
    if (!targetId) return;

    const target = this.findPlayerById(targetId);
    if (!target || target.fighter.state === FighterState.DEAD) {
      player.combat.lockTargetId = null;
      this.events.emit('lock:change', { playerId: player.id, targetId: null });
      return;
    }

    const dist = Math.hypot(
      target.pos.x - player.pos.x,
      target.pos.y - player.pos.y,
      target.pos.z - player.pos.z,
    );
    if (dist >= LOCK_MAX_DIST) {
      player.combat.lockTargetId = null;
      this.events.emit('lock:change', { playerId: player.id, targetId: null });
    }
  }

  // ============================================================================
  // CORPO A CORPO + CLASH (Seções 5.2 e 7)
  // ============================================================================

  private startMelee(player: Player, kind: 'light' | 'heavy', cmd: PlayerCommand): void {
    const c = player.combat;
    let move: MeleeMove;

    if (kind === 'light') {
      move = LIGHT_COMBO[c.comboIndex % LIGHT_COMBO.length];
      c.comboIndex = (c.comboIndex + 1) % LIGHT_COMBO.length;
    } else {
      move = HEAVY_MOVE;
      c.comboIndex = 0;
    }

    c.attackKind = kind;
    c.attackMove = move;
    c.attackDuration = move.total;
    c.attackTimer = move.total;
    c.hitDone = false;
    c.comboWindow = 0;

    const aim = this.computeAim(player, cmd, 9.0, 0);
    const aimYaw = Math.atan2(aim.dx, aim.dz);
    c.aimYaw = aimYaw;
    player.facingYaw = aimYaw;
    player.prevFacingYaw = aimYaw;

    let lungeSpeed = move.lunge * 0.28;
    if (aim.target && aim.dist < 14.0) {
      lungeSpeed = Math.max(0, Math.min(move.lunge, (aim.dist - 1.7) / 0.1));
    }

    const hLen = Math.hypot(aim.dx, aim.dz) || 1;
    player.vel.x = (aim.dx / hLen) * lungeSpeed;
    player.vel.z = (aim.dz / hLen) * lungeSpeed;

    const targetWellAbove = aim.target !== null && aim.target.pos.y - player.pos.y > 1.2;
    if (player.flyMode || !player.isGrounded || targetWellAbove) {
      player.vel.y = aim.dy * lungeSpeed;
    }

    this.events.emit('combat:attack', {
      playerId: player.id,
      kind,
      slot: 0,
    });
  }

  private updateMelee(player: Player, dt: number): void {
    const c = player.combat;
    if (c.attackTimer <= 0) return;

    const prevElapsed = c.attackDuration - c.attackTimer;
    c.attackTimer = Math.max(0, c.attackTimer - dt);
    const currElapsed = c.attackDuration - c.attackTimer;

    if (
      c.attackMove &&
      !c.hitDone &&
      currElapsed >= c.attackMove.hitAt &&
      prevElapsed <= c.attackMove.total
    ) {
      c.hitDone = true;
      this.doMeleeHit(player, c.attackMove);
    }

    if (c.attackTimer <= 0) {
      const wasLight = c.attackKind === 'light';
      c.attackKind = 'none';
      c.attackMove = null;
      c.attackDuration = 0;
      c.hitDone = false;
      if (wasLight) {
        c.comboWindow = COMBO_WINDOW;
      }
    }
  }

  private doMeleeHit(attacker: Player, move: MeleeMove): void {
    const ax = attacker.pos.x;
    const ay = attacker.pos.y + 1.0;
    const az = attacker.pos.z;

    const fwdX = Math.sin(attacker.combat.aimYaw);
    const fwdZ = Math.cos(attacker.combat.aimYaw);
    const maxRange = move.alcance + 0.9;

    let hitAny = false;
    let impactX = ax + fwdX * 1.5;
    let impactY = ay;
    let impactZ = az + fwdZ * 1.5;

    for (let i = 0; i < this.players.length; i++) {
      const target = this.players[i];
      if (target.id === attacker.id) continue;
      if (target.fighter.state === FighterState.DEAD) continue;
      if (this.isFriendly(attacker, target)) continue;

      const dx = target.pos.x - ax;
      const dy = target.pos.y + 1.0 - ay;
      const dz = target.pos.z - az;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > maxRange) continue;

      const hDist = Math.hypot(dx, dz);
      const dot = hDist > 0.001 ? (dx * fwdX + dz * fwdZ) / hDist : 1;
      if (dot < 0.25 && dist > 1.5) continue;

      // Verifica Troca de Golpes (Clash — Fase 3) quando ambos estão atacando de frente
      if (
        dist <= CLASH_RANGE &&
        target.combat.attackMove !== null &&
        target.combat.attackTimer > 0 &&
        !target.combat.hitDone
      ) {
        const tFwdX = Math.sin(target.combat.aimYaw);
        const tFwdZ = Math.cos(target.combat.aimYaw);
        const facingEachOther = fwdX * tFwdX + fwdZ * tFwdZ < -0.25;
        if (facingEachOther) {
          this.triggerMeleeClash(attacker, target);
          return;
        }
      }

      const len = dist || 1;
      const dirX = dx / len;
      const dirY = dy / len;
      const dirZ = dz / len;

      // Verifica bônus de ataque pelas costas após teleporte (+35% de dano)
      let dmg = move.dano;
      let isBackstab = false;
      if (attacker.combat.backAttackTimer > 0) {
        const tFaceX = Math.sin(target.facingYaw);
        const tFaceZ = Math.cos(target.facingYaw);
        const hitFromBehind = dirX * tFaceX + dirZ * tFaceZ > 0.35;
        if (
          hitFromBehind ||
          attacker.combat.backAttackTargetId === target.id
        ) {
          dmg *= BACKSTAB_MULTIPLIER;
          isBackstab = true;
          attacker.combat.backAttackTimer = 0;
          attacker.combat.backAttackTargetId = null;
        }
      }

      const isHeavy = move.id === 'H' || move.id === 'L4' || isBackstab;
      const connected = this.applyHit(
        attacker,
        target,
        dmg,
        dirX,
        dirY,
        dirZ,
        isBackstab ? move.knockback * 1.2 : move.knockback,
        move.launch,
        isBackstab ? Math.max(move.stun, 0.45) : move.stun,
        isBackstab ? Math.max(move.hitStop, 0.08) : move.hitStop,
        isBackstab ? Math.max(move.shake, 0.45) : move.shake,
        isHeavy ? 'heavy' : 'light',
        true,
        isBackstab,
      );

      if (connected) {
        hitAny = true;
        impactX = (ax + target.pos.x) * 0.5;
        impactY = (ay + target.pos.y + 1.0) * 0.5;
        impactZ = (az + target.pos.z) * 0.5;
      }
    }

    if (hitAny) {
      attacker.fighter.ki = Math.min(attacker.fighter.maxKi, attacker.fighter.ki + move.kiGanho);

      if (move.forca >= 3) {
        this.emitImpactEvent(
          impactX,
          impactY,
          impactZ,
          3 + move.forca * 0.5,
          move.forca,
          fwdX,
          0.15,
          fwdZ,
        );
      }
    }
  }

  private triggerMeleeClash(a: Player, b: Player): void {
    const midX = (a.pos.x + b.pos.x) * 0.5;
    const midY = (a.pos.y + b.pos.y) * 0.5 + 1.1;
    const midZ = (a.pos.z + b.pos.z) * 0.5;

    let dx = b.pos.x - a.pos.x;
    let dz = b.pos.z - a.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;

    a.combat.cancelActions();
    b.combat.cancelActions();

    // Empurra ambos para trás com onda de choque
    a.vel.x = -dx * CLASH_KNOCKBACK;
    a.vel.y = a.flyMode ? 1.5 : 4.5;
    a.vel.z = -dz * CLASH_KNOCKBACK;
    a.controlLock = 0.28;

    b.vel.x = dx * CLASH_KNOCKBACK;
    b.vel.y = b.flyMode ? 1.5 : 4.5;
    b.vel.z = dz * CLASH_KNOCKBACK;
    b.controlLock = 0.28;

    this.events.emit('combat:clash', {
      x: midX,
      y: midY,
      z: midZ,
      playerA: a.id,
      playerB: b.id,
    });

    this.emitImpactEvent(midX, midY, midZ, 5.5, 4, 0, 1, 0);

    if (a.id === this.localPlayerId || b.id === this.localPlayerId) {
      this.hitStopRequest = Math.max(this.hitStopRequest, CLASH_HITSTOP);
      this.localClashTimer = 0.85;
      this.events.emit('camera:shake', { intensity: 0.72, duration: 0.28 });
    } else {
      this.emitCameraShakeNearLocal(midX, midY, midZ, 0.5, 0.22);
    }
  }

  // ============================================================================
  // PODERES DE KI (Seção 8)
  // ============================================================================

  private tryStartSkill(player: Player, slot: number, cmd: PlayerCommand): void {
    const skill = getSkillBySlot(slot);
    if (!skill) return;

    const c = player.combat;
    const cdIndex = slot - 1;
    if (c.cooldowns[cdIndex] > 0) return;
    if (player.fighter.ki < skill.custoKi) return;

    player.fighter.ki = Math.max(0, player.fighter.ki - skill.custoKi);
    c.cooldowns[cdIndex] = skill.cooldown;
    c.attackKind = 'skill';
    c.castSlot = slot;
    c.castDuration = skill.tempoCarga;
    c.castTimer = skill.tempoCarga;
    c.comboIndex = 0;
    c.comboWindow = 0;

    const aim = this.computeAim(player, cmd, 160, skill.velocidade);
    c.aimYaw = Math.atan2(aim.dx, aim.dz);
    player.facingYaw = c.aimYaw;

    this.events.emit('skill:charge', {
      playerId: player.id,
      slot,
      duration: skill.tempoCarga,
    });
    this.events.emit('combat:attack', {
      playerId: player.id,
      kind: 'skill',
      slot,
    });
  }

  private updateCast(player: Player, cmd: PlayerCommand, dt: number): void {
    const c = player.combat;

    if (c.burstLeft > 0) {
      const skill = getSkillBySlot(c.castSlot);
      if (!skill) {
        c.burstLeft = 0;
        return;
      }

      const aim = this.computeAim(player, cmd, 160, skill.velocidade);
      c.aimYaw = Math.atan2(aim.dx, aim.dz);
      player.facingYaw = c.aimYaw;

      c.burstTimer -= dt;
      if (c.burstTimer <= 0) {
        const spreadX = this.rng.range(-0.035, 0.035);
        const spreadY = this.rng.range(-0.03, 0.03);
        const spreadZ = this.rng.range(-0.035, 0.035);
        let dx = aim.dx + spreadX;
        let dy = aim.dy + spreadY;
        let dz = aim.dz + spreadZ;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len;
        dy /= len;
        dz /= len;

        this.spawnProjectile(player, skill, dx, dy, dz);
        this.events.emit('skill:fire', { playerId: player.id, slot: skill.slot });

        c.burstLeft--;
        if (c.burstLeft > 0) {
          c.burstTimer = skill.intervalo ?? 0.085;
        } else {
          c.castSlot = 0;
          c.attackKind = 'skill';
          c.attackDuration = 0.2;
          c.attackTimer = 0.2;
        }
      }
      return;
    }

    if (c.castTimer <= 0) return;

    const skill = getSkillBySlot(c.castSlot);
    if (!skill) {
      c.castTimer = 0;
      c.castSlot = 0;
      return;
    }

    const aim = this.computeAim(player, cmd, 160, skill.velocidade);
    c.aimYaw = Math.atan2(aim.dx, aim.dz);
    player.facingYaw = c.aimYaw;
    player.vel.x *= 0.9;
    player.vel.y *= 0.9;
    player.vel.z *= 0.9;

    c.castTimer -= dt;
    if (c.castTimer <= 0) {
      c.castTimer = 0;
      this.fireSkill(player, skill, aim);
    }
  }

  private fireSkill(player: Player, skill: SkillDef, aim: AimResult): void {
    const c = player.combat;

    if (skill.kind === 'projectile') {
      this.spawnProjectile(player, skill, aim.dx, aim.dy, aim.dz);
      c.castSlot = 0;
      c.attackKind = 'skill';
      c.attackDuration = 0.18;
      c.attackTimer = 0.18;
      this.events.emit('skill:fire', { playerId: player.id, slot: skill.slot });
    } else if (skill.kind === 'ultimate') {
      this.spawnProjectile(player, skill, aim.dx, aim.dy, aim.dz);
      player.vel.x -= aim.dx * 12;
      player.vel.y -= aim.dy * 6;
      player.vel.z -= aim.dz * 12;
      this.emitCameraShakeNearLocal(player.pos.x, player.pos.y, player.pos.z, 0.85, 0.45);
      c.castSlot = 0;
      c.attackKind = 'skill';
      c.attackDuration = 0.8;
      c.attackTimer = 0.8;
      this.events.emit('skill:fire', { playerId: player.id, slot: skill.slot });
    } else if (skill.kind === 'burst') {
      c.burstLeft = skill.tiros ?? 7;
      const spreadX = this.rng.range(-0.035, 0.035);
      const spreadY = this.rng.range(-0.03, 0.03);
      const spreadZ = this.rng.range(-0.035, 0.035);
      let dx = aim.dx + spreadX;
      let dy = aim.dy + spreadY;
      let dz = aim.dz + spreadZ;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      this.spawnProjectile(player, skill, dx, dy, dz);
      this.events.emit('skill:fire', { playerId: player.id, slot: skill.slot });
      c.burstLeft--;
      c.burstTimer = skill.intervalo ?? 0.085;
    } else if (skill.kind === 'beam') {
      this.fireBeam(player, skill, aim);
      player.vel.x -= aim.dx * 8;
      player.vel.y -= aim.dy * 4;
      player.vel.z -= aim.dz * 8;
      c.castSlot = 0;
      c.attackKind = 'skill';
      c.attackDuration = 0.45;
      c.attackTimer = 0.45;
      this.events.emit('skill:fire', { playerId: player.id, slot: skill.slot });
    }
  }

  private spawnProjectile(
    owner: Player,
    skill: SkillDef,
    dx: number,
    dy: number,
    dz: number,
  ): void {
    let slot: ProjectileSlot | null = null;
    let oldest = this.projectiles[0];
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if (!p.active) {
        slot = p;
        break;
      }
      if (p.life < oldest.life) oldest = p;
    }
    if (!slot) slot = oldest;

    const offset = 1.2 + skill.raio * 0.55;
    slot.active = true;
    slot.id = `proj-${++this.projSeq}`;
    slot.ownerId = owner.id;
    slot.skill = skill;
    slot.x = owner.pos.x + dx * offset;
    slot.y = owner.pos.y + 1.15 + dy * offset;
    slot.z = owner.pos.z + dz * offset;
    slot.vx = dx * skill.velocidade;
    slot.vy = dy * skill.velocidade;
    slot.vz = dz * skill.velocidade;
    slot.life = PROJECTILE_DEFAULT_LIFE;
    slot.radius = skill.raio;
    slot.colorHex = skill.cor || owner.appearance.ki;
  }

  public updateProjectiles(dt: number): void {
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.life = 0;
        b.active = false;
      }
    }

    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if (!p.active || !p.skill) continue;

      const ax = p.x;
      const ay = p.y;
      const az = p.z;
      const bx = ax + p.vx * dt;
      const by = ay + p.vy * dt;
      const bz = az + p.vz * dt;

      const owner = this.findPlayerById(p.ownerId);
      let hit = false;
      let hitX = bx;
      let hitY = by;
      let hitZ = bz;
      let bestT = 1.01;

      const hitRad = p.radius + 0.7;
      const hitRadSq = hitRad * hitRad;
      for (let j = 0; j < this.players.length; j++) {
        const target = this.players[j];
        if (target.id === p.ownerId) continue;
        if (target.fighter.state === FighterState.DEAD) continue;
        if (owner && this.isFriendly(owner, target)) continue;

        const distSq = segmentPointDistSq(
          ax,
          ay,
          az,
          bx,
          by,
          bz,
          target.pos.x,
          target.pos.y + 1.0,
          target.pos.z,
        );
        if (distSq <= hitRadSq) {
          hit = true;
          hitX = target.pos.x;
          hitY = target.pos.y + 1.0;
          hitZ = target.pos.z;
          bestT = 0;
          break;
        }
      }

      if (!hit) {
        const expand = p.radius * 0.6;
        for (let k = 0; k < this.colliders.length; k++) {
          const t = segmentAABBIntersectT(ax, ay, az, bx, by, bz, this.colliders[k], expand);
          if (t >= 0 && t < bestT) {
            bestT = t;
            hit = true;
            hitX = ax + (bx - ax) * t;
            hitY = ay + (by - ay) * t;
            hitZ = az + (bz - az) * t;
          }
        }
      }

      const midX = (ax + bx) * 0.5;
      const midY = (ay + by) * 0.5;
      const midZ = (az + bz) * 0.5;
      const midGround = groundHeightAt(midX, midZ) + p.radius * 0.5;
      if (midY <= midGround && bestT > 0.5) {
        bestT = 0.5;
        hit = true;
        hitX = midX;
        hitY = midGround;
        hitZ = midZ;
      } else {
        const endGround = groundHeightAt(bx, bz) + p.radius * 0.5;
        if (by <= endGround && bestT >= 1.0) {
          bestT = 1.0;
          hit = true;
          hitX = bx;
          hitY = endGround;
          hitZ = bz;
        }
      }

      p.life -= dt;

      if (hit || p.life <= 0) {
        p.x = hitX;
        p.y = hitY;
        p.z = hitZ;
        this.explodeProjectile(p, owner);
      } else {
        p.x = bx;
        p.y = by;
        p.z = bz;
      }
    }
  }

  private explodeProjectile(p: ProjectileSlot, owner: Player | null): void {
    const skill = p.skill;
    p.active = false;
    p.skill = null;
    if (!skill) return;

    const ex = p.x;
    const ey = p.y;
    const ez = p.z;
    const maxR = skill.raioExplosao + 0.7;

    for (let i = 0; i < this.players.length; i++) {
      const target = this.players[i];
      if (target.id === p.ownerId) continue;
      if (target.fighter.state === FighterState.DEAD) continue;
      if (owner && this.isFriendly(owner, target)) continue;

      const dx = target.pos.x - ex;
      const dy = target.pos.y + 1.0 - ey;
      const dz = target.pos.z - ez;
      const d = Math.hypot(dx, dy, dz);
      if (d > maxR) continue;

      const falloff = Math.max(0.35, 1 - (d / maxR) * 0.65);
      const len = d || 1;
      const dirX = d > 0.01 ? dx / len : 0;
      const dirY = d > 0.01 ? dy / len : 1;
      const dirZ = d > 0.01 ? dz / len : 0;

      const launch = skill.knockback > 30 ? 8 : 2;
      const stun = skill.kind === 'ultimate' ? 0.95 : skill.knockback > 15 ? 0.42 : 0.24;
      const hitStop = skill.kind === 'ultimate' ? 0.12 : 0.04;
      const shake = skill.kind === 'ultimate' ? 0.95 : 0.32;

      this.applyHit(
        owner,
        target,
        skill.dano * falloff,
        dirX,
        dirY,
        dirZ,
        skill.knockback * falloff,
        launch,
        stun,
        hitStop,
        shake,
        'skill',
        false,
        false,
      );
    }

    const power = Math.min(1, skill.forcaDestruicao / 10);
    this.events.emit('projectile:explode', {
      x: ex,
      y: ey,
      z: ez,
      radius: skill.raioExplosao,
      colorHex: p.colorHex,
      power,
    });

    const vLen = Math.hypot(p.vx, p.vy, p.vz) || 1;
    this.emitImpactEvent(
      ex,
      ey,
      ez,
      skill.raioExplosao,
      skill.forcaDestruicao,
      p.vx / vLen,
      p.vy / vLen,
      p.vz / vLen,
    );

    const baseShake = skill.kind === 'ultimate' ? 1.0 : 0.2 + power * 0.55;
    this.emitCameraShakeNearLocal(ex, ey, ez, baseShake, 0.22 + power * 0.3);
  }

  private fireBeam(owner: Player, skill: SkillDef, aim: AimResult): void {
    const startX = owner.pos.x + aim.dx * 1.1;
    const startY = owner.pos.y + 1.0 + aim.dy * 1.1;
    const startZ = owner.pos.z + aim.dz * 1.1;
    const range = skill.alcance ?? 150;
    const width = skill.largura ?? 1.6;

    const rawEndX = startX + aim.dx * range;
    const rawEndY = startY + aim.dy * range;
    const rawEndZ = startZ + aim.dz * range;

    let bestT = 1.0;

    for (let i = 0; i < this.colliders.length; i++) {
      const t = segmentAABBIntersectT(
        startX,
        startY,
        startZ,
        rawEndX,
        rawEndY,
        rawEndZ,
        this.colliders[i],
        0.2,
      );
      if (t >= 0 && t < bestT) {
        bestT = t;
      }
    }

    const samples = 80;
    for (let s = 1; s <= samples; s++) {
      const frac = (s / samples) * bestT;
      const sx = startX + (rawEndX - startX) * frac;
      const sy = startY + (rawEndY - startY) * frac;
      const sz = startZ + (rawEndZ - startZ) * frac;
      if (sy <= groundHeightAt(sx, sz) + 0.3) {
        bestT = frac;
        break;
      }
    }

    const endX = startX + (rawEndX - startX) * bestT;
    const endY = startY + (rawEndY - startY) * bestT;
    const endZ = startZ + (rawEndZ - startZ) * bestT;

    const hitRad = width + 0.7;
    const hitRadSq = hitRad * hitRad;
    for (let i = 0; i < this.players.length; i++) {
      const target = this.players[i];
      if (target.id === owner.id) continue;
      if (target.fighter.state === FighterState.DEAD) continue;
      if (this.isFriendly(owner, target)) continue;

      const distSq = segmentPointDistSq(
        startX,
        startY,
        startZ,
        endX,
        endY,
        endZ,
        target.pos.x,
        target.pos.y + 1.0,
        target.pos.z,
      );
      if (distSq <= hitRadSq) {
        this.applyHit(
          owner,
          target,
          skill.dano,
          aim.dx,
          aim.dy,
          aim.dz,
          skill.knockback,
          4,
          0.8,
          0.09,
          0.65,
          'skill',
          false,
          false,
        );
      }
    }

    let beamSlot = this.beams[0];
    for (let i = 0; i < this.beams.length; i++) {
      if (!this.beams[i].active) {
        beamSlot = this.beams[i];
        break;
      }
      if (this.beams[i].life < beamSlot.life) beamSlot = this.beams[i];
    }

    const colorHex = skill.cor || owner.appearance.ki;
    beamSlot.active = true;
    beamSlot.id = `beam-${++this.beamSeq}`;
    beamSlot.ownerId = owner.id;
    beamSlot.startX = startX;
    beamSlot.startY = startY;
    beamSlot.startZ = startZ;
    beamSlot.endX = endX;
    beamSlot.endY = endY;
    beamSlot.endZ = endZ;
    beamSlot.width = width;
    beamSlot.colorHex = colorHex;
    beamSlot.life = BEAM_DEFAULT_LIFE;
    beamSlot.maxLife = BEAM_DEFAULT_LIFE;

    const power = Math.min(1, skill.forcaDestruicao / 10);
    this.events.emit('projectile:explode', {
      x: endX,
      y: endY,
      z: endZ,
      radius: skill.raioExplosao,
      colorHex,
      power,
    });
    this.emitImpactEvent(
      endX,
      endY,
      endZ,
      skill.raioExplosao,
      skill.forcaDestruicao,
      aim.dx,
      aim.dy,
      aim.dz,
    );
    this.emitCameraShakeNearLocal(endX, endY, endZ, 0.55, 0.32);
  }

  // ============================================================================
  // DANO, BLOQUEIO, MORTE E RESPAWN
  // ============================================================================

  public applyHit(
    attacker: Player | null,
    target: Player,
    rawDamage: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    knockback: number,
    launch: number,
    stun: number,
    hitStop: number,
    shake: number,
    hitKind: 'light' | 'heavy' | 'skill',
    isMelee: boolean,
    backstab = false,
  ): boolean {
    if (target.fighter.state === FighterState.DEAD) return false;

    const tc = target.combat;

    if (tc.invulnTimer > 0 || target.dashTimer > 0) {
      this.events.emit('combat:dodge', {
        playerId: target.id,
        x: target.pos.x,
        y: target.pos.y + 1.0,
        z: target.pos.z,
      });
      return false;
    }

    const powerMult = attacker ? attacker.fighter.powerLevel : 1.0;
    let finalDamage = Math.max(1, Math.round(rawDamage * powerMult));
    let finalKb = knockback;
    let finalLaunch = launch;
    let finalStun = stun;
    let resolvedKind: 'light' | 'heavy' | 'skill' | 'blocked' = hitKind;

    if (tc.isBlocking) {
      const faceX = Math.sin(target.facingYaw);
      const faceZ = Math.cos(target.facingYaw);
      const frontalDot = -(dirX * faceX + dirZ * faceZ);

      if (frontalDot > -0.1) {
        const staminaCost = finalDamage * BLOCK_STAMINA_PER_DAMAGE;
        if (target.fighter.stamina >= staminaCost) {
          target.fighter.tryConsumeStamina(staminaCost);
          finalDamage = Math.max(
            1,
            Math.round(finalDamage * (isMelee ? BLOCK_MELEE_REDUCTION : BLOCK_KI_REDUCTION)),
          );
          finalKb *= 0.35;
          finalLaunch = 0;
          finalStun = 0.08;
          resolvedKind = 'blocked';
        } else {
          target.fighter.stamina = 0;
          tc.isBlocking = false;
          finalStun = GUARD_BREAK_STUN;
          this.events.emit('combat:guardbreak', { playerId: target.id });
        }
      }
    }

    target.fighter.hp = Math.max(0, target.fighter.hp - finalDamage);
    if (attacker) tc.lastHitBy = attacker.id;
    tc.hitFlash = 0.16;

    const power = Math.min(1, finalDamage / 220);
    this.events.emit('combat:hit', {
      attackerId: attacker ? attacker.id : '',
      targetId: target.id,
      x: target.pos.x,
      y: target.pos.y + 1.0,
      z: target.pos.z,
      damage: finalDamage,
      kind: resolvedKind,
      power,
      backstab: backstab && resolvedKind !== 'blocked',
    });

    const localInvolved =
      target.id === this.localPlayerId || (attacker !== null && attacker.id === this.localPlayerId);

    if (attacker && attacker.id === this.localPlayerId) {
      this.localComboHits++;
      this.localComboTimer = 2.4;
      this.localHitMarkerTimer = 0.22;
      if (backstab && resolvedKind !== 'blocked') {
        this.localBackstabTimer = 0.95;
      }
    }
    if (target.id === this.localPlayerId) {
      this.localHurtTimer = Math.min(0.45, 0.18 + power * 0.3);
    }

    if (localInvolved) {
      const scaledHitStop = resolvedKind === 'blocked' ? hitStop * 0.45 : hitStop;
      if (scaledHitStop > this.hitStopRequest) {
        this.hitStopRequest = scaledHitStop;
      }
      const scaledShake = resolvedKind === 'blocked' ? shake * 0.4 : shake;
      this.events.emit('camera:shake', {
        intensity: scaledShake,
        duration: 0.12 + scaledShake * 0.24,
      });
    }

    if (target.fighter.hp <= 0) {
      this.kill(target, attacker, dirX, dirY, dirZ, finalKb);
      return true;
    }

    const shouldStun =
      finalStun >= 0.5 || tc.stunImmune <= 0 || tc.stunTimer > 0 || resolvedKind === 'blocked';

    if (shouldStun && finalStun > 0) {
      if (resolvedKind !== 'blocked') {
        tc.cancelActions();
      }
      tc.stunTimer = Math.max(tc.stunTimer, finalStun);
      target.controlLock = Math.max(target.controlLock, finalStun);
    }

    if (finalKb > 0) {
      target.vel.x = dirX * finalKb;
      target.vel.y = dirY * finalKb * 0.45 + finalLaunch;
      target.vel.z = dirZ * finalKb;
      if (finalLaunch > 1.5 && !target.flyMode) {
        target.isGrounded = false;
      }
    }

    return true;
  }

  private kill(
    target: Player,
    killer: Player | null,
    dirX: number,
    dirY: number,
    dirZ: number,
    kb: number,
  ): void {
    const tc = target.combat;
    tc.cancelActions();
    tc.stunTimer = 0;
    tc.respawnTimer = target.isBot ? RESPAWN_TIME_BOT : RESPAWN_TIME_PLAYER;

    target.fighter.state = FighterState.DEAD;
    target.flyMode = false;
    target.isBoosting = false;
    target.isCharging = false;
    target.controlLock = 0;
    target.moveScale = 0;
    target.deaths++;

    const killerId = killer ? killer.id : tc.lastHitBy;
    if (killer && killer.id !== target.id) {
      killer.kills++;
    }

    const push = Math.max(14, kb * 0.7);
    target.vel.x = dirX * push;
    target.vel.y = Math.max(6, dirY * push * 0.4 + 6);
    target.vel.z = dirZ * push;
    target.isGrounded = false;

    this.events.emit('fighter:death', {
      playerId: target.id,
      killerId,
    });

    this.emitCameraShakeNearLocal(target.pos.x, target.pos.y, target.pos.z, 0.85, 0.42);
  }

  private updateDead(player: Player, dt: number): void {
    player.capturePreviousState();

    player.vel.y = Math.max(-60, player.vel.y - DEAD_GRAVITY * dt);
    const drag = Math.exp(-3.0 * dt);
    player.vel.x *= drag;
    player.vel.z *= drag;

    player.pos.x += player.vel.x * dt;
    player.pos.y += player.vel.y * dt;
    player.pos.z += player.vel.z * dt;

    const gY = groundHeightAt(player.pos.x, player.pos.z);
    if (player.pos.y <= gY) {
      player.pos.y = gY;
      player.vel.y = 0;
      player.isGrounded = true;
    }

    player.combat.respawnTimer -= dt;
    if (player.combat.respawnTimer <= 0) {
      this.respawn(player);
    }
  }

  public respawn(player: Player): void {
    player.fighter.hp = player.fighter.maxHp;
    player.fighter.ki = player.fighter.maxKi;
    player.fighter.stamina = player.fighter.maxStamina;
    player.combat.resetForRespawn();

    const gY = groundHeightAt(player.spawn.x, player.spawn.z);
    const spawnY = Math.max(gY, player.spawn.y);
    player.pos.x = player.spawn.x;
    player.pos.y = spawnY;
    player.pos.z = player.spawn.z;
    player.prevPos.x = player.spawn.x;
    player.prevPos.y = spawnY;
    player.prevPos.z = player.spawn.z;

    player.vel.x = 0;
    player.vel.y = 0;
    player.vel.z = 0;
    player.controlLock = 0;
    player.moveScale = 1;
    player.isBoosting = false;
    player.isCharging = false;

    const startsFlying = spawnY > gY + 1.5;
    player.flyMode = startsFlying;
    player.isGrounded = !startsFlying;
    player.fighter.state = startsFlying ? FighterState.FLYING : FighterState.GROUNDED;

    this.events.emit('fighter:respawn', { playerId: player.id });
  }

  public countActiveProjectiles(): number {
    let count = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      if (this.projectiles[i].active) count++;
    }
    return count;
  }

  public findPlayerById(id: string): Player | null {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === id) return this.players[i];
    }
    return null;
  }

  private isFriendly(a: Player, b: Player): boolean {
    return a.isBot && b.isBot;
  }

  private emitImpactEvent(
    x: number,
    y: number,
    z: number,
    radius: number,
    force: number,
    dirX: number,
    dirY: number,
    dirZ: number,
  ): void {
    this.events.emit('impact:event', {
      id: `imp-${++this.impactSeq}`,
      x,
      y,
      z,
      radius,
      force,
      dirX,
      dirY,
      dirZ,
      seed: this.rng.int(1, 0x7fffffff),
    });
  }

  private emitCameraShakeNearLocal(
    x: number,
    y: number,
    z: number,
    intensity: number,
    duration: number,
  ): void {
    const local = this.findPlayerById(this.localPlayerId);
    if (!local) return;
    const dist = Math.hypot(local.pos.x - x, local.pos.y - y, local.pos.z - z);
    if (dist >= 70) return;
    const atten = 1 - dist / 70;
    this.events.emit('camera:shake', {
      intensity: intensity * atten,
      duration,
    });
  }
}
