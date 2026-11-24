import { CombatSystem } from '../combat/CombatSystem';
import {
  HEAVY_MOVE,
  LIGHT_COMBO,
  MeleeMove,
  SKILLS,
  TELEPORT_COOLDOWN,
} from '../combat/Skills';
import { loadActiveAppearance, saveActiveAppearance } from '../customization/Presets';
import { EventBus } from './EventBus';
import { PlayerCommand } from './Input';
import { SeededRNG } from './RNG';
import { FighterState } from '../entities/Fighter';
import {
  CharacterAppearance,
  normalizeAppearance,
  Player,
  PlayerSnapshot,
} from '../entities/Player';
import { PlayerController } from '../entities/PlayerController';
import type { NetMode, NetWorldSnapshot } from '../net/Protocol';
import {
  generateReferenceColliders,
  groundHeightAt,
  WorldBoxCollider,
} from '../world/WorldGeometry';

export interface LockTargetTelemetry {
  id: string;
  nome: string;
  hp: number;
  maxHp: number;
  dist: number;
  screenX: number;
  screenY: number;
  onScreen: boolean;
}

export interface RemoteLabelTelemetry {
  id: string;
  nome: string;
  hp: number;
  maxHp: number;
  dist: number;
  screenX: number;
  screenY: number;
  onScreen: boolean;
  dead: boolean;
}

export interface ScoreboardEntry {
  id: string;
  nome: string;
  kills: number;
  deaths: number;
  isLocal: boolean;
}

export interface SkillSlotTelemetry {
  slot: number;
  nome: string;
  custoKi: number;
  cooldown: number;
  cooldownMax: number;
  affordable: boolean;
}

export interface HudTelemetry {
  playerName: string;
  hp: number;
  maxHp: number;
  ki: number;
  maxKi: number;
  stamina: number;
  maxStamina: number;
  state: FighterState;
  flyMode: boolean;
  isBoosting: boolean;
  isCharging: boolean;
  isBlocking: boolean;
  speedKmh: number;
  altitude: number;
  posX: number;
  posY: number;
  posZ: number;
  tick: number;
  fps: number;
  activeEntities: number;
  activeDebris: number;
  activeProjectiles: number;
  // Fase 2 & 3 — Combate e Teleporte
  lock: LockTargetTelemetry | null;
  skills: SkillSlotTelemetry[];
  teleportCooldown: number;
  teleportCooldownMax: number;
  comboHits: number;
  hurt: number;
  dead: boolean;
  respawnIn: number;
  kills: number;
  deaths: number;
  hitMarker: boolean;
  backstabCallout: boolean;
  clashCallout: boolean;
  // Multiplayer Online
  remoteLabels: RemoteLabelTelemetry[];
  scoreboard: ScoreboardEntry[];
  netMode: NetMode;
  roomCode: string;
  pingMs: number;
}

const SPAWN_RING_POSITIONS: ReadonlyArray<{ x: number; z: number; yaw: number }> = [
  { x: 0, z: 18, yaw: Math.PI },
  { x: 0, z: -18, yaw: 0 },
  { x: 18, z: 0, yaw: -Math.PI / 2 },
  { x: -18, z: 0, yaw: Math.PI / 2 },
  { x: 13, z: 13, yaw: -Math.PI * 0.75 },
  { x: -13, z: -13, yaw: Math.PI * 0.25 },
  { x: 13, z: -13, yaw: -Math.PI * 0.25 },
  { x: -13, z: 13, yaw: Math.PI * 0.75 },
];

const MELEE_BY_ID: Record<MeleeMove['id'], MeleeMove> = {
  L1: LIGHT_COMBO[0],
  L2: LIGHT_COMBO[1],
  L3: LIGHT_COMBO[2],
  L4: LIGHT_COMBO[3],
  H: HEAVY_MOVE,
};

/**
 * Núcleo da simulação (60Hz, sem Three.js, sem bots por padrão).
 * Suporta modo solo/treino livre, modo Host autoritativo e modo Guest (predição + snapshots).
 */
export class Game {
  public readonly events = new EventBus();
  public readonly rng = new SeededRNG(202611);
  public readonly colliders: WorldBoxCollider[];
  public readonly controller: PlayerController;
  public readonly combat: CombatSystem;

  public localPlayer: Player;
  public readonly remotePlayers: Player[] = [];
  public readonly allPlayers: Player[] = [];

  // Último comando recebido de cada jogador remoto (usado pelo Host autoritativo)
  private readonly remoteCommands = new Map<string, PlayerCommand>();

  // Metas de interpolação de rede para jogadores remotos (usado pelo Guest)
  private readonly remoteTargets = new Map<
    string,
    { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }
  >();

  public isNetGuest = false;
  public tick = 0;
  public hitStop = 0;

  private spawnSlotCursor = 1;

  constructor() {
    this.colliders = generateReferenceColliders(40491);
    this.controller = new PlayerController(this.events, this.colliders);

    const savedAppearance = loadActiveAppearance();
    const spawnY = groundHeightAt(0, 18);
    this.localPlayer = new Player(
      'player-local',
      true,
      { x: 0, y: spawnY, z: 18 },
      savedAppearance,
      false,
    );
    this.localPlayer.facingYaw = Math.PI;
    this.localPlayer.prevFacingYaw = Math.PI;

    // Sem bots: apenas o jogador local inicia na arena até amigos conectarem online
    this.allPlayers.push(this.localPlayer);

    this.combat = new CombatSystem(
      this.allPlayers,
      this.colliders,
      this.events,
      this.rng,
      this.localPlayer.id,
    );

    // Conecta impacto em parede em alta velocidade ao CombatSystem (Fase 3)
    this.controller.onWallImpact = (player, x, y, z, speed) => {
      if (!this.isNetGuest) {
        this.combat.handleWallImpact(player, x, y, z, speed);
      }
    };
  }

  /** Atualiza a aparência local, salva em localStorage e emite evento para reconstruir o mesh e sincronizar na rede. */
  public setLocalAppearance(appearance: CharacterAppearance): void {
    const clean = normalizeAppearance(appearance);
    this.localPlayer.setAppearance(clean);
    saveActiveAppearance(clean);
    this.events.emit('player:appearance', {
      playerId: this.localPlayer.id,
      appearance: clean,
    });
  }

  /** Atualiza a aparência de um jogador remoto (recebida pela rede). */
  public updatePlayerAppearance(playerId: string, appearance: CharacterAppearance): void {
    const player = this.combat.findPlayerById(playerId);
    if (!player) return;
    const clean = normalizeAppearance(appearance);
    player.setAppearance(clean);
    this.events.emit('player:appearance', {
      playerId: player.id,
      appearance: clean,
    });
  }

  /** Adiciona um jogador remoto conectado (idempotente). */
  public addRemotePlayer(id: string, appearance: CharacterAppearance, spawnOverride?: { x: number; y: number; z: number }): Player {
    const existing = this.combat.findPlayerById(id);
    if (existing) {
      this.updatePlayerAppearance(id, appearance);
      return existing;
    }

    const slot = SPAWN_RING_POSITIONS[this.spawnSlotCursor % SPAWN_RING_POSITIONS.length];
    this.spawnSlotCursor++;
    const sx = spawnOverride?.x ?? slot.x;
    const sz = spawnOverride?.z ?? slot.z;
    const sy = spawnOverride?.y ?? groundHeightAt(sx, sz);

    const remote = new Player(id, false, { x: sx, y: sy, z: sz }, appearance, false);
    remote.facingYaw = slot.yaw;
    remote.prevFacingYaw = slot.yaw;

    this.remotePlayers.push(remote);
    this.allPlayers.push(remote);
    this.events.emit('player:added', { playerId: id });
    return remote;
  }

  /** Remove um jogador remoto desconectado e limpa lock-on se apontava para ele. */
  public removeRemotePlayer(id: string): void {
    const idxRemote = this.remotePlayers.findIndex((p) => p.id === id);
    if (idxRemote >= 0) this.remotePlayers.splice(idxRemote, 1);

    const idxAll = this.allPlayers.findIndex((p) => p.id === id);
    if (idxAll >= 0) this.allPlayers.splice(idxAll, 1);

    this.remoteCommands.delete(id);
    this.remoteTargets.delete(id);

    if (this.localPlayer.combat.lockTargetId === id) {
      this.localPlayer.combat.lockTargetId = null;
      this.events.emit('lock:change', { playerId: this.localPlayer.id, targetId: null });
    }

    this.events.emit('player:removed', { playerId: id });
  }

  /** Remove todos os jogadores remotos (ao sair de uma sala). */
  public clearRemotePlayers(): void {
    const ids = this.remotePlayers.map((p) => p.id);
    for (let i = 0; i < ids.length; i++) {
      this.removeRemotePlayer(ids[i]);
    }
    this.isNetGuest = false;
  }

  /**
   * Recebe comando de um convidado no Host autoritativo.
   * Preserva bordas de ação (ataque/poder/teleporte/pulo/voo) até o próximo tick de 60Hz.
   */
  public queueRemoteCommand(playerId: string, incoming: PlayerCommand): void {
    const prev = this.remoteCommands.get(playerId);
    if (!prev) {
      this.remoteCommands.set(playerId, { ...incoming });
      return;
    }

    prev.tick = incoming.tick;
    prev.moveForward = incoming.moveForward;
    prev.moveRight = incoming.moveRight;
    prev.moveUp = incoming.moveUp;
    prev.cameraYaw = incoming.cameraYaw;
    prev.cameraPitch = incoming.cameraPitch;
    prev.boost = incoming.boost;
    prev.charge = incoming.charge;
    prev.defend = incoming.defend;
    // Acumula bordas (OR) para nunca perder clique rápido entre pacotes de rede
    prev.jumpPressed = prev.jumpPressed || incoming.jumpPressed;
    prev.flyTogglePressed = prev.flyTogglePressed || incoming.flyTogglePressed;
    prev.dashPressed = prev.dashPressed || incoming.dashPressed;
    prev.lockOnPressed = prev.lockOnPressed || incoming.lockOnPressed;
    prev.teleportPressed = prev.teleportPressed || incoming.teleportPressed;
    prev.lightAttack = prev.lightAttack || incoming.lightAttack;
    prev.heavyAttack = prev.heavyAttack || incoming.heavyAttack;
    if (incoming.skillSlot > 0) prev.skillSlot = incoming.skillSlot;
  }

  /**
   * Executa um passo determinístico da simulação (60Hz).
   */
  public fixedUpdate(dt: number, tick: number, localCommand: PlayerCommand): void {
    this.tick = tick;

    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      return;
    }

    if (this.isNetGuest) {
      // Modo Guest: predição local do movimento + suavização dos remotos via snapshots do Host
      this.controller.step(this.localPlayer, localCommand, dt);
      this.stepGuestRemoteInterpolation(dt);
      this.stepGuestProjectiles(dt);
      this.combat.updateHudTimers(dt);
      return;
    }

    // Modo Solo / Host Autoritativo: simula todos os jogadores com 100% de autoridade
    this.controller.step(this.localPlayer, localCommand, dt);
    this.combat.step(this.localPlayer, localCommand, dt);

    for (let i = 0; i < this.remotePlayers.length; i++) {
      const remote = this.remotePlayers[i];
      const cmd = this.remoteCommands.get(remote.id);
      if (cmd) {
        this.controller.step(remote, cmd, dt);
        this.combat.step(remote, cmd, dt);
        // Consome flags de borda após aplicar o tick
        cmd.jumpPressed = false;
        cmd.flyTogglePressed = false;
        cmd.dashPressed = false;
        cmd.lockOnPressed = false;
        cmd.teleportPressed = false;
        cmd.lightAttack = false;
        cmd.heavyAttack = false;
        cmd.skillSlot = 0;
      } else {
        // Sem comando ainda: mantém gravidade/colisão e timers
        this.controller.step(remote, EMPTY_CMD, dt);
        this.combat.step(remote, EMPTY_CMD, dt);
      }
    }

    this.combat.updateProjectiles(dt);

    if (this.combat.hitStopRequest > 0) {
      this.hitStop = Math.max(this.hitStop, this.combat.hitStopRequest);
      this.combat.hitStopRequest = 0;
    }

    this.combat.updateHudTimers(dt);
  }

  private stepGuestRemoteInterpolation(dt: number): void {
    const rate = 1 - Math.exp(-16 * dt);
    for (let i = 0; i < this.remotePlayers.length; i++) {
      const rp = this.remotePlayers[i];
      rp.capturePreviousState();
      const t = this.remoteTargets.get(rp.id);
      if (!t) continue;

      const jumpDist = Math.hypot(t.x - rp.pos.x, t.y - rp.pos.y, t.z - rp.pos.z);
      if (jumpDist > 10) {
        // Teleporte ou respawn: snap instantâneo
        rp.pos.x = t.x;
        rp.pos.y = t.y;
        rp.pos.z = t.z;
        rp.prevPos.x = t.x;
        rp.prevPos.y = t.y;
        rp.prevPos.z = t.z;
      } else {
        rp.pos.x += (t.x - rp.pos.x) * rate;
        rp.pos.y += (t.y - rp.pos.y) * rate;
        rp.pos.z += (t.z - rp.pos.z) * rate;
      }

      let diff = ((t.yaw - rp.facingYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (diff < -Math.PI) diff += Math.PI * 2;
      rp.facingYaw += diff * rate;
      rp.bodyPitch += (t.pitch - rp.bodyPitch) * rate;
      rp.bodyRoll += (t.roll - rp.bodyRoll) * rate;

      const speed = rp.getHorizontalSpeed();
      rp.animPhase += dt * (rp.flyMode ? (rp.isBoosting ? 12 : 3.2) : speed > 0.6 ? speed * 0.65 : 2.2);
    }
  }

  private stepGuestProjectiles(dt: number): void {
    for (let i = 0; i < this.combat.beams.length; i++) {
      const b = this.combat.beams[i];
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) b.active = false;
    }
    for (let i = 0; i < this.combat.projectiles.length; i++) {
      const p = this.combat.projectiles[i];
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.life -= dt;
      if (p.life <= 0) p.active = false;
    }
  }

  /**
   * Cria snapshot serializável de 20Hz enviado pelo Host aos convidados.
   */
  public createNetSnapshot(includeAppearances = false): NetWorldSnapshot {
    const projectiles = [];
    for (let i = 0; i < this.combat.projectiles.length; i++) {
      const p = this.combat.projectiles[i];
      if (!p.active) continue;
      projectiles.push({
        id: p.id,
        ownerId: p.ownerId,
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        vx: Number(p.vx.toFixed(1)),
        vy: Number(p.vy.toFixed(1)),
        vz: Number(p.vz.toFixed(1)),
        radius: p.radius,
        colorHex: p.colorHex,
        life: Number(p.life.toFixed(2)),
      });
    }

    const beams = [];
    for (let i = 0; i < this.combat.beams.length; i++) {
      const b = this.combat.beams[i];
      if (!b.active) continue;
      beams.push({
        id: b.id,
        ownerId: b.ownerId,
        startX: Number(b.startX.toFixed(2)),
        startY: Number(b.startY.toFixed(2)),
        startZ: Number(b.startZ.toFixed(2)),
        endX: Number(b.endX.toFixed(2)),
        endY: Number(b.endY.toFixed(2)),
        endZ: Number(b.endZ.toFixed(2)),
        width: b.width,
        colorHex: b.colorHex,
        life: Number(b.life.toFixed(2)),
        maxLife: b.maxLife,
      });
    }

    return {
      tick: this.tick,
      players: this.allPlayers.map((p) => p.toJSON(includeAppearances)),
      projectiles,
      beams,
    };
  }

  /**
   * Aplica snapshot autoritativo recebido do Host (Guest mode):
   * reconcilia jogador local e atualiza alvos de interpolação dos remotos, projéteis e raios.
   */
  public applyNetSnapshot(snapshot: NetWorldSnapshot, localAssignedId: string): void {
    const seenIds = new Set<string>();

    for (let i = 0; i < snapshot.players.length; i++) {
      const ps = snapshot.players[i];
      seenIds.add(ps.id);

      if (ps.id === localAssignedId) {
        this.reconcileLocalFromSnapshot(ps);
        continue;
      }

      let remote = this.combat.findPlayerById(ps.id);
      if (!remote) {
        remote = this.addRemotePlayer(
          ps.id,
          ps.appearance ?? { ...this.localPlayer.appearance, nome: ps.name },
          ps.pos,
        );
      } else if (ps.appearance) {
        remote.setAppearance(ps.appearance);
      }

      this.remoteTargets.set(remote.id, {
        x: ps.pos.x,
        y: ps.pos.y,
        z: ps.pos.z,
        yaw: ps.facingYaw,
        pitch: ps.bodyPitch,
        roll: ps.bodyRoll,
      });
      this.applyVitalAndCombatSnapshot(remote, ps);
    }

    // Remove jogadores que não existem mais no snapshot do Host
    for (let i = this.remotePlayers.length - 1; i >= 0; i--) {
      const rp = this.remotePlayers[i];
      if (!seenIds.has(rp.id)) {
        this.removeRemotePlayer(rp.id);
      }
    }

    // Sincroniza pool de projéteis visuais
    for (let i = 0; i < this.combat.projectiles.length; i++) {
      const src = snapshot.projectiles[i];
      const dst = this.combat.projectiles[i];
      if (src) {
        dst.active = true;
        dst.id = src.id;
        dst.ownerId = src.ownerId;
        dst.x = src.x;
        dst.y = src.y;
        dst.z = src.z;
        dst.vx = src.vx;
        dst.vy = src.vy;
        dst.vz = src.vz;
        dst.radius = src.radius;
        dst.colorHex = src.colorHex;
        dst.life = src.life;
      } else {
        dst.active = false;
      }
    }

    // Sincroniza pool de raios visuais
    for (let i = 0; i < this.combat.beams.length; i++) {
      const src = snapshot.beams[i];
      const dst = this.combat.beams[i];
      if (src) {
        dst.active = true;
        dst.id = src.id;
        dst.ownerId = src.ownerId;
        dst.startX = src.startX;
        dst.startY = src.startY;
        dst.startZ = src.startZ;
        dst.endX = src.endX;
        dst.endY = src.endY;
        dst.endZ = src.endZ;
        dst.width = src.width;
        dst.colorHex = src.colorHex;
        dst.life = src.life;
        dst.maxLife = src.maxLife;
      } else {
        dst.active = false;
      }
    }
  }

  private reconcileLocalFromSnapshot(ps: PlayerSnapshot): void {
    const lp = this.localPlayer;
    const err = Math.hypot(ps.pos.x - lp.pos.x, ps.pos.y - lp.pos.y, ps.pos.z - lp.pos.z);

    // Reconciliação suave para pequenos desvios de latência; snap imediato em teleporte/knockback forte
    if (err > 5.5 || ps.fighter.state === FighterState.DEAD || ps.combat.teleportTimer > 0) {
      lp.pos.x = ps.pos.x;
      lp.pos.y = ps.pos.y;
      lp.pos.z = ps.pos.z;
      lp.prevPos.x = ps.pos.x;
      lp.prevPos.y = ps.pos.y;
      lp.prevPos.z = ps.pos.z;
      lp.vel.x = ps.vel.x;
      lp.vel.y = ps.vel.y;
      lp.vel.z = ps.vel.z;
    } else if (err > 0.35) {
      lp.pos.x += (ps.pos.x - lp.pos.x) * 0.25;
      lp.pos.y += (ps.pos.y - lp.pos.y) * 0.25;
      lp.pos.z += (ps.pos.z - lp.pos.z) * 0.25;
    }

    this.applyVitalAndCombatSnapshot(lp, ps);
  }

  private applyVitalAndCombatSnapshot(player: Player, ps: PlayerSnapshot): void {
    player.name = ps.name;
    player.vel.x = ps.vel.x;
    player.vel.y = ps.vel.y;
    player.vel.z = ps.vel.z;
    player.flyMode = ps.flyMode;
    player.isBoosting = ps.isBoosting;
    player.isCharging = ps.isCharging;
    player.isGrounded = ps.isGrounded;
    player.kills = ps.kills;
    player.deaths = ps.deaths;

    player.fighter.hp = ps.fighter.hp;
    player.fighter.maxHp = ps.fighter.maxHp;
    player.fighter.ki = ps.fighter.ki;
    player.fighter.maxKi = ps.fighter.maxKi;
    player.fighter.stamina = ps.fighter.stamina;
    player.fighter.maxStamina = ps.fighter.maxStamina;
    player.fighter.state = ps.fighter.state;

    const c = player.combat;
    c.lockTargetId = ps.combat.lockTargetId;
    c.attackKind = ps.combat.attackKind;
    c.attackTimer = ps.combat.attackTimer;
    c.attackDuration = ps.combat.attackDuration;
    c.attackMove = ps.combat.attackMoveId ? MELEE_BY_ID[ps.combat.attackMoveId] : null;
    c.comboIndex = ps.combat.comboIndex;
    c.castSlot = ps.combat.castSlot;
    c.castTimer = ps.combat.castTimer;
    c.castDuration = ps.combat.castDuration;
    c.cooldowns[0] = ps.combat.cooldowns[0];
    c.cooldowns[1] = ps.combat.cooldowns[1];
    c.cooldowns[2] = ps.combat.cooldowns[2];
    c.cooldowns[3] = ps.combat.cooldowns[3];
    c.teleportCooldown = ps.combat.teleportCooldown;
    c.teleportTimer = ps.combat.teleportTimer;
    c.stunTimer = ps.combat.stunTimer;
    c.isBlocking = ps.combat.isBlocking;
    c.respawnTimer = ps.combat.respawnTimer;
  }

  public respawnLocalAtPlaza(): void {
    this.combat.respawn(this.localPlayer);
    this.localPlayer.facingYaw = Math.PI;
    this.localPlayer.prevFacingYaw = Math.PI;
  }

  public getHudTelemetry(
    fps: number,
    lockScreen?: { screenX: number; screenY: number; onScreen: boolean },
    remoteLabels: RemoteLabelTelemetry[] = [],
    netInfo?: { mode: NetMode; roomCode: string; pingMs: number },
  ): HudTelemetry {
    const p = this.localPlayer;
    const speedMs = p.getSpeed();
    const groundY = groundHeightAt(p.pos.x, p.pos.z);

    let lock: LockTargetTelemetry | null = null;
    if (p.combat.lockTargetId) {
      const target = this.combat.findPlayerById(p.combat.lockTargetId);
      if (target && target.fighter.state !== FighterState.DEAD) {
        const dist = Math.hypot(
          target.pos.x - p.pos.x,
          target.pos.y - p.pos.y,
          target.pos.z - p.pos.z,
        );
        lock = {
          id: target.id,
          nome: target.name,
          hp: Math.round(target.fighter.hp),
          maxHp: target.fighter.maxHp,
          dist: Math.round(dist),
          screenX: lockScreen?.screenX ?? 50,
          screenY: lockScreen?.screenY ?? 50,
          onScreen: lockScreen?.onScreen ?? false,
        };
      }
    }

    const skills: SkillSlotTelemetry[] = SKILLS.map((sk, idx) => ({
      slot: sk.slot,
      nome: sk.nome,
      custoKi: sk.custoKi,
      cooldown: Number(p.combat.cooldowns[idx].toFixed(1)),
      cooldownMax: sk.cooldown,
      affordable: p.fighter.ki >= sk.custoKi,
    }));

    const scoreboard: ScoreboardEntry[] = this.allPlayers
      .map((pl) => ({
        id: pl.id,
        nome: pl.name,
        kills: pl.kills,
        deaths: pl.deaths,
        isLocal: pl.id === this.localPlayer.id,
      }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

    return {
      playerName: p.name,
      hp: Math.round(p.fighter.hp),
      maxHp: p.fighter.maxHp,
      ki: p.fighter.ki,
      maxKi: p.fighter.maxKi,
      stamina: p.fighter.stamina,
      maxStamina: p.fighter.maxStamina,
      state: p.fighter.state,
      flyMode: p.flyMode,
      isBoosting: p.isBoosting,
      isCharging: p.isCharging,
      isBlocking: p.combat.isBlocking,
      speedKmh: Math.round(speedMs * 3.6),
      altitude: Math.max(0, Math.round(p.pos.y - groundY)),
      posX: Number(p.pos.x.toFixed(1)),
      posY: Number(p.pos.y.toFixed(1)),
      posZ: Number(p.pos.z.toFixed(1)),
      tick: this.tick,
      fps,
      activeEntities: this.allPlayers.length,
      activeDebris: 0,
      activeProjectiles: this.combat.countActiveProjectiles(),
      lock,
      skills,
      teleportCooldown: Number(p.combat.teleportCooldown.toFixed(1)),
      teleportCooldownMax: TELEPORT_COOLDOWN,
      comboHits: this.combat.localComboHits,
      hurt: Math.min(1, this.combat.localHurtTimer / 0.4),
      dead: p.fighter.state === FighterState.DEAD,
      respawnIn: Math.max(0, Math.ceil(p.combat.respawnTimer * 10) / 10),
      kills: p.kills,
      deaths: p.deaths,
      hitMarker: this.combat.localHitMarkerTimer > 0,
      backstabCallout: this.combat.localBackstabTimer > 0,
      clashCallout: this.combat.localClashTimer > 0,
      remoteLabels,
      scoreboard,
      netMode: netInfo?.mode ?? 'offline',
      roomCode: netInfo?.roomCode ?? '',
      pingMs: netInfo?.pingMs ?? 0,
    };
  }
}

const EMPTY_CMD: PlayerCommand = {
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
