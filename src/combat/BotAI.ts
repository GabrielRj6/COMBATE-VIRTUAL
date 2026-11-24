import { PlayerCommand } from '../core/Input';
import { SeededRNG } from '../core/RNG';
import { FighterState } from '../entities/Fighter';
import { Player } from '../entities/Player';
import { groundHeightAt } from '../world/WorldGeometry';
import { ProjectileSlot } from './Projectile';
import { SKILLS } from './Skills';

export type BotProfile = 'brawler' | 'skirmisher';

/**
 * IA de combate para bots (Sora = brawler, Ryuji = skirmisher).
 * Produz PlayerCommand exatamente como um jogador humano, usando apenas SeededRNG.
 */
export class BotBrain {
  public readonly profile: BotProfile;
  public readonly reaction: number;
  public readonly aggression: number;

  private flyToggleCooldown = 0;
  private dodgeCooldown = 0;
  private blockTimer = 0;
  private skillCooldown = 1.8;
  private meleeCooldown = 0.4;
  private strafeDir = 1;
  private strafeTimer = 1.6;

  // Comando reutilizado a cada tick (zero alocação)
  private readonly cmd: PlayerCommand = {
    tick: 0,
    moveForward: 0,
    moveRight: 0,
    moveUp: 0,
    cameraYaw: 0,
    cameraPitch: 0.22,
    boost: false,
    charge: false,
    defend: false,
    jumpPressed: false,
    flyTogglePressed: false,
    dashPressed: false,
    lockOnPressed: false,
    teleportPressed: false,
    lightAttack: false,
    heavyAttack: false,
    skillSlot: 0,
  };

  constructor(profile: BotProfile, reaction: number, aggression: number) {
    this.profile = profile;
    this.reaction = reaction;
    this.aggression = aggression;
  }

  public think(
    bot: Player,
    players: Player[],
    projectiles: ProjectileSlot[],
    rng: SeededRNG,
    dt: number,
    tick: number,
  ): PlayerCommand {
    const cmd = this.cmd;
    cmd.tick = tick;
    cmd.moveForward = 0;
    cmd.moveRight = 0;
    cmd.moveUp = 0;
    cmd.boost = false;
    cmd.charge = false;
    cmd.defend = false;
    cmd.jumpPressed = false;
    cmd.flyTogglePressed = false;
    cmd.dashPressed = false;
    cmd.lockOnPressed = false;
    cmd.teleportPressed = false;
    cmd.lightAttack = false;
    cmd.heavyAttack = false;
    cmd.skillSlot = 0;

    if (bot.fighter.state === FighterState.DEAD) {
      return cmd;
    }

    if (this.flyToggleCooldown > 0) this.flyToggleCooldown -= dt;
    if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;
    if (this.blockTimer > 0) this.blockTimer -= dt;
    if (this.skillCooldown > 0) this.skillCooldown -= dt;
    if (this.meleeCooldown > 0) this.meleeCooldown -= dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeDir = rng.next() < 0.5 ? -1 : 1;
      this.strafeTimer = rng.range(1.1, 2.4);
    }

    // Alvo: jogador humano vivo mais próximo (sem fogo amigo entre bots)
    const target = this.findNearestHumanTarget(bot, players);
    if (!target) {
      // Sem alvo: pousa e recarrega Ki
      if (bot.flyMode && this.flyToggleCooldown <= 0) {
        cmd.flyTogglePressed = true;
        this.flyToggleCooldown = 0.9;
      }
      cmd.charge = bot.fighter.ki < bot.fighter.maxKi * 0.98;
      return cmd;
    }

    const dx = target.pos.x - bot.pos.x;
    const dy = target.pos.y - bot.pos.y;
    const dz = target.pos.z - bot.pos.z;
    const hDist = Math.hypot(dx, dz) || 0.001;
    const dist = Math.hypot(dx, dy, dz) || 0.001;

    // Câmera virtual do bot aponta diretamente para o alvo
    cmd.cameraYaw = Math.atan2(-dx, -dz);
    const rawPitch = 0.22 - Math.atan2(dy, hDist);
    cmd.cameraPitch = Math.max(-0.9, Math.min(1.0, rawPitch));

    // Controle de voo (cooldown 0.9s)
    const targetGround = groundHeightAt(target.pos.x, target.pos.z);
    const botGround = groundHeightAt(bot.pos.x, bot.pos.z);
    const wantsFlight =
      this.profile === 'skirmisher'
        ? true
        : target.flyMode || target.pos.y - targetGround > 4.0;

    if (wantsFlight !== bot.flyMode && this.flyToggleCooldown <= 0) {
      cmd.flyTogglePressed = true;
      this.flyToggleCooldown = 0.9;
    }

    // Ajuste de altitude durante o voo
    if (bot.flyMode) {
      const desiredY =
        this.profile === 'skirmisher'
          ? Math.max(target.pos.y + 2.0, botGround + 9.0)
          : target.pos.y;
      const altErr = desiredY - bot.pos.y;
      if (altErr > 1.2) cmd.moveUp = Math.min(1, altErr * 0.25);
      else if (altErr < -1.2) cmd.moveUp = Math.max(-1, altErr * 0.25);
    }

    // 1. Defesa reativa contra projéteis inimigos (< 26m, dot > 0.9)
    if (this.dodgeCooldown <= 0 && bot.fighter.stamina >= bot.fighter.dashStaminaCost) {
      if (this.hasIncomingProjectile(bot, projectiles)) {
        if (rng.next() < this.reaction * 0.18) {
          cmd.moveRight = this.strafeDir;
          cmd.dashPressed = true;
          this.dodgeCooldown = 1.3;
          return cmd;
        }
      }
    }

    // 2. Defesa reativa contra golpe corpo a corpo próximo (< 6m)
    if (
      dist < 6.0 &&
      target.combat.isBusy &&
      this.blockTimer <= 0 &&
      bot.fighter.stamina > 18
    ) {
      if (rng.next() < this.reaction * 0.05) {
        this.blockTimer = 0.45;
      }
    }
    if (this.blockTimer > 0) {
      cmd.defend = true;
      return cmd;
    }

    // 3. Comportamento específico por perfil
    if (this.profile === 'brawler') {
      this.thinkBrawler(bot, cmd, dist, hDist, rng);
    } else {
      this.thinkSkirmisher(bot, cmd, dist, hDist, rng);
    }

    return cmd;
  }

  private thinkBrawler(
    bot: Player,
    cmd: PlayerCommand,
    dist: number,
    hDist: number,
    rng: SeededRNG,
  ): void {
    // Aproxima agressivamente quando hdist > 4.2m
    if (hDist > 4.2) {
      cmd.moveForward = 1;
      cmd.moveRight = this.strafeDir * 0.22;
      if (dist > 18 && bot.fighter.ki > 35) {
        cmd.boost = true;
      }
    } else if (hDist < 2.2) {
      cmd.moveRight = this.strafeDir * 0.6;
    }

    // Ataques corpo a corpo em alcance curto (< 4.6m)
    if (dist < 4.6 && this.meleeCooldown <= 0) {
      if (rng.next() < this.aggression) {
        if (rng.next() < 0.18) {
          cmd.heavyAttack = true;
          this.meleeCooldown = 0.55;
        } else {
          cmd.lightAttack = true;
          this.meleeCooldown = rng.range(0.16, 0.28);
        }
      }
      return;
    }

    // Poderes 1 / 3 / 4 entre 12 e 70m (intervalo 1.6..3.4s)
    if (dist >= 12 && dist <= 70 && this.skillCooldown <= 0 && !bot.combat.isBusy) {
      const slot = this.pickSkill(bot, [4, 3, 1], rng);
      if (slot > 0) {
        cmd.skillSlot = slot;
        this.skillCooldown = rng.range(1.6, 3.4);
      }
    }
  }

  private thinkSkirmisher(
    bot: Player,
    cmd: PlayerCommand,
    dist: number,
    hDist: number,
    rng: SeededRNG,
  ): void {
    // Carrega Ki se estiver baixo e longe
    if (bot.fighter.ki < 28 && dist > 16 && !bot.combat.isBusy) {
      cmd.charge = true;
      return;
    }

    // Mantém faixa de 11..26m orbitando o alvo
    if (hDist < 11) {
      cmd.moveForward = -0.85;
      cmd.moveRight = this.strafeDir;
    } else if (hDist > 26) {
      cmd.moveForward = 0.9;
      cmd.moveRight = this.strafeDir * 0.55;
      if (dist > 40 && bot.fighter.ki > 45) {
        cmd.boost = true;
      }
    } else {
      cmd.moveRight = this.strafeDir;
    }

    // Se encurralado (< 4.4m), revida no corpo a corpo
    if (dist < 4.4 && this.meleeCooldown <= 0) {
      if (rng.next() < this.aggression * 0.9) {
        cmd.lightAttack = true;
        this.meleeCooldown = rng.range(0.22, 0.34);
      }
      return;
    }

    // Usa poderes 1 / 2 / 3 / 4 à distância
    if (dist >= 9 && dist <= 95 && this.skillCooldown <= 0 && !bot.combat.isBusy) {
      const slot = this.pickSkill(bot, [4, 3, 2, 1], rng);
      if (slot > 0) {
        cmd.skillSlot = slot;
        this.skillCooldown = rng.range(1.2, 2.6);
      }
    }
  }

  private pickSkill(bot: Player, prioritySlots: number[], rng: SeededRNG): number {
    for (let i = 0; i < prioritySlots.length; i++) {
      const slot = prioritySlots[i];
      const skill = SKILLS[slot - 1];
      if (!skill) continue;
      if (bot.combat.cooldowns[slot - 1] > 0) continue;
      if (bot.fighter.ki < skill.custoKi) continue;

      // Ultimate e Raio são usados com ponderação para variedade de padrões
      if (slot === 4 && rng.next() > 0.35) continue;
      if (slot === 3 && rng.next() > 0.55) continue;
      return slot;
    }
    return 0;
  }

  private findNearestHumanTarget(bot: Player, players: Player[]): Player | null {
    let best: Player | null = null;
    let bestDistSq = Infinity;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.isBot || p.id === bot.id) continue;
      if (p.fighter.state === FighterState.DEAD) continue;
      const dx = p.pos.x - bot.pos.x;
      const dy = p.pos.y - bot.pos.y;
      const dz = p.pos.z - bot.pos.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = p;
      }
    }
    return best;
  }

  private hasIncomingProjectile(bot: Player, projectiles: ProjectileSlot[]): boolean {
    const bx = bot.pos.x;
    const by = bot.pos.y + 1.0;
    const bz = bot.pos.z;

    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p.active || p.ownerId === bot.id) continue;

      const toBotX = bx - p.x;
      const toBotY = by - p.y;
      const toBotZ = bz - p.z;
      const dist = Math.hypot(toBotX, toBotY, toBotZ);
      if (dist > 26 || dist < 0.01) continue;

      const vLen = Math.hypot(p.vx, p.vy, p.vz) || 1;
      const dot = (toBotX * p.vx + toBotY * p.vy + toBotZ * p.vz) / (dist * vLen);
      if (dot > 0.9) return true;
    }
    return false;
  }
}
