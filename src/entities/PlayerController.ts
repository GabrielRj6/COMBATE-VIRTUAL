import { WALL_IMPACT_MIN_SPEED } from '../combat/Skills';
import { EventBus } from '../core/EventBus';
import { PlayerCommand } from '../core/Input';
import { FighterState } from './Fighter';
import { Player } from './Player';
import {
  groundHeightAt,
  WORLD_MAX_ALTITUDE,
  WORLD_SOFT_LIMIT,
  WorldBoxCollider,
} from '../world/WorldGeometry';

const GRAVITY = 36.0;
const JUMP_SPEED = 16.5;

const WALK_SPEED = 12.5;
const RUN_SPEED = 24.0;
const GROUND_ACCEL = 115.0;
const GROUND_FRICTION = 14.0;
const KNOCKBACK_GROUND_FRICTION = 3.0;
const AIR_ACCEL = 32.0;

const FLY_NORMAL_SPEED = 36.0;
const FLY_BOOST_SPEED = 94.0;
const FLY_VERTICAL_SPEED = 28.0;
const FLY_BOOST_VERTICAL_SPEED = 56.0;
const FLY_ACCEL = 68.0;
const FLY_BOOST_ACCEL = 145.0;
const FLY_DRAG = 4.6;
const KNOCKBACK_FLY_DRAG = 2.1;

const DASH_SPEED = 48.0;
const DASH_DURATION = 0.18;

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  const factor = 1 - Math.exp(-lambda * dt);
  return current + diff * factor;
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export type WallImpactCallback = (
  player: Player,
  x: number,
  y: number,
  z: number,
  speed: number,
) => void;

/**
 * Controlador cinemático de personagem (chão, pulo, dash, voo livre 3D, boost e impacto em parede).
 */
export class PlayerController {
  private events: EventBus;
  private colliders: WorldBoxCollider[];
  public onWallImpact?: WallImpactCallback;

  private readonly scratchCmd: PlayerCommand = {
    tick: 0,
    moveForward: 0,
    moveRight: 0,
    moveUp: 0,
    cameraYaw: 0,
    cameraPitch: 0,
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

  constructor(events: EventBus, colliders: WorldBoxCollider[]) {
    this.events = events;
    this.colliders = colliders;
  }

  public step(player: Player, rawCmd: PlayerCommand, dt: number): void {
    player.capturePreviousState();

    if (player.fighter.state === FighterState.DEAD) {
      return;
    }

    const cmd = this.scratchCmd;
    cmd.tick = rawCmd.tick;
    cmd.moveForward = rawCmd.moveForward;
    cmd.moveRight = rawCmd.moveRight;
    cmd.moveUp = rawCmd.moveUp;
    cmd.cameraYaw = rawCmd.cameraYaw;
    cmd.cameraPitch = rawCmd.cameraPitch;
    cmd.boost = rawCmd.boost;
    cmd.charge = rawCmd.charge;
    cmd.defend = rawCmd.defend;
    cmd.jumpPressed = rawCmd.jumpPressed;
    cmd.flyTogglePressed = rawCmd.flyTogglePressed;
    cmd.dashPressed = rawCmd.dashPressed;
    cmd.lockOnPressed = rawCmd.lockOnPressed;
    cmd.teleportPressed = rawCmd.teleportPressed;
    cmd.lightAttack = rawCmd.lightAttack;
    cmd.heavyAttack = rawCmd.heavyAttack;
    cmd.skillSlot = rawCmd.skillSlot;

    const isKnockbackLocked = player.controlLock > 0;
    if (isKnockbackLocked) {
      player.controlLock = Math.max(0, player.controlLock - dt);
      cmd.moveForward = 0;
      cmd.moveRight = 0;
      cmd.moveUp = 0;
      cmd.boost = false;
      cmd.charge = false;
      cmd.jumpPressed = false;
      cmd.dashPressed = false;
      cmd.flyTogglePressed = false;
    } else if (player.moveScale < 1) {
      cmd.moveForward *= player.moveScale;
      cmd.moveRight *= player.moveScale;
      cmd.moveUp *= player.moveScale;
      cmd.boost = false;
      cmd.charge = false;
    }

    const sinYaw = Math.sin(cmd.cameraYaw);
    const cosYaw = Math.cos(cmd.cameraYaw);
    const forwardX = -sinYaw;
    const forwardZ = -cosYaw;
    const rightX = cosYaw;
    const rightZ = -sinYaw;

    const wishX = forwardX * cmd.moveForward + rightX * cmd.moveRight;
    const wishZ = forwardZ * cmd.moveForward + rightZ * cmd.moveRight;
    const wishMag = Math.hypot(wishX, wishZ);
    const normWishX = wishMag > 0.001 ? wishX / wishMag : 0;
    const normWishZ = wishMag > 0.001 ? wishZ / wishMag : 0;

    if (cmd.flyTogglePressed) {
      this.setFlightMode(player, !player.flyMode);
    }

    const wantsCharge = cmd.charge && wishMag < 0.15 && Math.abs(cmd.moveUp) < 0.1 && !cmd.boost;
    player.isCharging = wantsCharge;

    if (cmd.dashPressed && player.dashTimer <= 0 && wishMag > 0.1) {
      if (player.fighter.tryConsumeStamina(player.fighter.dashStaminaCost)) {
        player.dashTimer = DASH_DURATION;
        player.dashDir.x = normWishX;
        player.dashDir.y = player.flyMode ? cmd.moveUp * 0.45 : 0;
        player.dashDir.z = normWishZ;
        player.vel.x = player.dashDir.x * DASH_SPEED;
        player.vel.y = player.flyMode ? player.dashDir.y * DASH_SPEED : Math.max(player.vel.y, 2);
        player.vel.z = player.dashDir.z * DASH_SPEED;
        this.events.emit('player:dash', { playerId: player.id });
      }
    }

    const wantsFlyBoost =
      player.flyMode &&
      cmd.boost &&
      (wishMag > 0.1 || Math.abs(cmd.moveUp) > 0.1) &&
      player.fighter.canBoost() &&
      !player.isCharging;

    if (wantsFlyBoost && !player.isBoosting) {
      player.isBoosting = true;
      this.events.emit('boost:start', { playerId: player.id });
    } else if (!wantsFlyBoost && player.isBoosting) {
      player.isBoosting = false;
      this.events.emit('boost:end', { playerId: player.id });
    }

    player.fighter.updateResources(dt, player.isBoosting, player.isCharging);

    if (player.dashTimer > 0) {
      player.dashTimer = Math.max(0, player.dashTimer - dt);
      player.vel.x = damp(player.vel.x, player.dashDir.x * DASH_SPEED * 0.65, 5, dt);
      player.vel.z = damp(player.vel.z, player.dashDir.z * DASH_SPEED * 0.65, 5, dt);
      player.fighter.state = FighterState.DASHING;
    } else if (player.flyMode) {
      this.updateFlight(player, cmd, normWishX, normWishZ, wishMag, isKnockbackLocked, dt);
    } else {
      this.updateGroundedAndAir(player, cmd, normWishX, normWishZ, wishMag, isKnockbackLocked, dt);
    }

    player.pos.x += player.vel.x * dt;
    player.pos.y += player.vel.y * dt;
    player.pos.z += player.vel.z * dt;

    this.resolveWorldBounds(player, dt);
    this.resolveTerrainCollision(player);
    this.resolveBoxCollisions(player, isKnockbackLocked);

    if (player.dashTimer > 0) {
      player.fighter.state = FighterState.DASHING;
    } else if (player.isCharging) {
      player.fighter.state = FighterState.CHARGING;
    } else if (player.flyMode) {
      player.fighter.state = FighterState.FLYING;
    } else {
      player.fighter.state = FighterState.GROUNDED;
    }

    this.updateBodyOrientation(player, normWishX, normWishZ, wishMag, cmd, isKnockbackLocked, dt);

    const speed = player.getHorizontalSpeed();
    if (player.flyMode) {
      player.animPhase += dt * (player.isBoosting ? 12 : 3.2);
    } else if (player.isGrounded && speed > 0.6) {
      player.animPhase += dt * (speed * 0.65);
    } else {
      player.animPhase += dt * 2.2;
    }
  }

  private setFlightMode(player: Player, enable: boolean): void {
    if (player.flyMode === enable) return;
    player.flyMode = enable;
    if (enable) {
      player.isGrounded = false;
      if (player.pos.y <= groundHeightAt(player.pos.x, player.pos.z) + 0.6) {
        player.vel.y = Math.max(player.vel.y, 12.0);
        player.pos.y += 0.25;
      }
    } else {
      if (player.isBoosting) {
        player.isBoosting = false;
        this.events.emit('boost:end', { playerId: player.id });
      }
    }
    this.events.emit('flight:toggle', { playerId: player.id, flying: enable });
  }

  private updateFlight(
    player: Player,
    cmd: PlayerCommand,
    wishX: number,
    wishZ: number,
    wishMag: number,
    isKnockbackLocked: boolean,
    dt: number,
  ): void {
    if (player.isCharging) {
      const brake = Math.exp(-8.5 * dt);
      player.vel.x *= brake;
      player.vel.y *= brake;
      player.vel.z *= brake;
      return;
    }

    const maxSpeed = player.isBoosting ? FLY_BOOST_SPEED : FLY_NORMAL_SPEED;
    const maxVert = player.isBoosting ? FLY_BOOST_VERTICAL_SPEED : FLY_VERTICAL_SPEED;
    const accel = player.isBoosting ? FLY_BOOST_ACCEL : FLY_ACCEL;

    const pitchInfluence = Math.abs(cmd.moveForward) > 0.1 ? -Math.sin(cmd.cameraPitch) * cmd.moveForward : 0;
    const targetVx = wishX * maxSpeed * Math.min(1, wishMag);
    const targetVz = wishZ * maxSpeed * Math.min(1, wishMag);

    let targetVy = cmd.moveUp * maxVert;
    if (Math.abs(cmd.moveUp) < 0.05 && Math.abs(pitchInfluence) > 0.08) {
      targetVy = pitchInfluence * maxSpeed * 0.78;
    }

    const hasInput = wishMag > 0.05 || Math.abs(cmd.moveUp) > 0.05;
    if (hasInput) {
      const rate = 1 - Math.exp(-(accel / maxSpeed) * 2.2 * dt);
      player.vel.x += (targetVx - player.vel.x) * rate;
      player.vel.y += (targetVy - player.vel.y) * rate;
      player.vel.z += (targetVz - player.vel.z) * rate;
    } else {
      const dragRate = isKnockbackLocked ? KNOCKBACK_FLY_DRAG : FLY_DRAG;
      const drag = Math.exp(-dragRate * dt);
      player.vel.x *= drag;
      player.vel.y *= drag;
      player.vel.z *= drag;
    }

    const groundY = groundHeightAt(player.pos.x, player.pos.z);
    if (!isKnockbackLocked && cmd.moveUp < -0.5 && player.pos.y <= groundY + 0.35 && player.vel.y < -4) {
      this.setFlightMode(player, false);
    }
  }

  private updateGroundedAndAir(
    player: Player,
    cmd: PlayerCommand,
    wishX: number,
    wishZ: number,
    wishMag: number,
    isKnockbackLocked: boolean,
    dt: number,
  ): void {
    const targetSpeed = player.isCharging ? 0 : cmd.boost ? RUN_SPEED : WALK_SPEED;

    if (player.isGrounded) {
      player.airTime = 0;

      if (wishMag > 0.05 && !player.isCharging) {
        const targetVx = wishX * targetSpeed * Math.min(1, wishMag);
        const targetVz = wishZ * targetSpeed * Math.min(1, wishMag);
        const step = GROUND_ACCEL * dt;
        const dx = targetVx - player.vel.x;
        const dz = targetVz - player.vel.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= step) {
          player.vel.x = targetVx;
          player.vel.z = targetVz;
        } else {
          player.vel.x += (dx / dist) * step;
          player.vel.z += (dz / dist) * step;
        }
      } else {
        const friction = isKnockbackLocked ? KNOCKBACK_GROUND_FRICTION : GROUND_FRICTION;
        const drag = Math.exp(-friction * dt);
        player.vel.x *= drag;
        player.vel.z *= drag;
      }

      if (cmd.jumpPressed && !player.isCharging) {
        player.vel.y = JUMP_SPEED;
        player.isGrounded = false;
        player.airTime = 0.02;
        this.events.emit('player:jump', { playerId: player.id, airJump: false });
      }
    } else {
      player.airTime += dt;

      if (wishMag > 0.05) {
        player.vel.x += wishX * AIR_ACCEL * dt;
        player.vel.z += wishZ * AIR_ACCEL * dt;
        const hSpeed = Math.hypot(player.vel.x, player.vel.z);
        const maxAir = Math.max(RUN_SPEED, hSpeed * 0.995);
        if (hSpeed > maxAir) {
          player.vel.x = (player.vel.x / hSpeed) * maxAir;
          player.vel.z = (player.vel.z / hSpeed) * maxAir;
        }
      }

      if (cmd.jumpPressed && player.airTime > 0.12) {
        this.setFlightMode(player, true);
        player.vel.y = Math.max(player.vel.y, 11.0);
        this.events.emit('player:jump', { playerId: player.id, airJump: true });
        return;
      }

      player.vel.y -= GRAVITY * dt;
      if (player.vel.y < -85) player.vel.y = -85;
    }
  }

  private resolveTerrainCollision(player: Player): void {
    const groundY = groundHeightAt(player.pos.x, player.pos.z);

    if (player.pos.y <= groundY) {
      const impact = -player.vel.y;
      player.pos.y = groundY;
      if (player.vel.y < 0) player.vel.y = 0;

      if (!player.flyMode) {
        if (!player.isGrounded && impact > 9) {
          this.events.emit('player:land', { playerId: player.id, impactSpeed: impact });
        }
        player.isGrounded = true;
      }
    } else if (!player.flyMode && player.pos.y > groundY + 0.15) {
      player.isGrounded = false;
    }
  }

  private resolveBoxCollisions(player: Player, isKnockbackLocked: boolean): void {
    const r = player.radius;
    const h = player.height;

    for (let i = 0; i < this.colliders.length; i++) {
      const b = this.colliders[i];

      if (
        player.pos.x + r < b.minX ||
        player.pos.x - r > b.maxX ||
        player.pos.z + r < b.minZ ||
        player.pos.z - r > b.maxZ ||
        player.pos.y + h < b.minY ||
        player.pos.y > b.maxY
      ) {
        continue;
      }

      const overlapLeft = player.pos.x + r - b.minX;
      const overlapRight = b.maxX - (player.pos.x - r);
      const overlapFront = player.pos.z + r - b.minZ;
      const overlapBack = b.maxZ - (player.pos.z - r);
      const overlapTop = b.maxY - player.pos.y;
      const overlapBottom = player.pos.y + h - b.minY;

      const minXOverlap = Math.min(overlapLeft, overlapRight);
      const minZOverlap = Math.min(overlapFront, overlapBack);
      const minYOverlap = Math.min(overlapTop, overlapBottom);

      if (minYOverlap <= minXOverlap && minYOverlap <= minZOverlap) {
        if (overlapTop <= overlapBottom) {
          const impact = -player.vel.y;
          player.pos.y = b.maxY;
          if (player.vel.y < 0) player.vel.y = 0;
          if (!player.flyMode) {
            if (!player.isGrounded && impact > 9) {
              this.events.emit('player:land', { playerId: player.id, impactSpeed: impact });
            }
            player.isGrounded = true;
          }
        } else {
          player.pos.y = b.minY - h;
          if (player.vel.y > 0) player.vel.y = 0;
        }
      } else if (minXOverlap < minZOverlap) {
        const hitSpeed = Math.abs(player.vel.x);
        if (overlapLeft < overlapRight) {
          player.pos.x = b.minX - r;
          if (isKnockbackLocked && hitSpeed > WALL_IMPACT_MIN_SPEED) {
            player.vel.x = -player.vel.x * 0.45;
            this.onWallImpact?.(player, b.minX, player.pos.y + 1.0, player.pos.z, hitSpeed);
          } else if (player.vel.x > 0) {
            player.vel.x = 0;
          }
        } else {
          player.pos.x = b.maxX + r;
          if (isKnockbackLocked && hitSpeed > WALL_IMPACT_MIN_SPEED) {
            player.vel.x = -player.vel.x * 0.45;
            this.onWallImpact?.(player, b.maxX, player.pos.y + 1.0, player.pos.z, hitSpeed);
          } else if (player.vel.x < 0) {
            player.vel.x = 0;
          }
        }
      } else {
        const hitSpeed = Math.abs(player.vel.z);
        if (overlapFront < overlapBack) {
          player.pos.z = b.minZ - r;
          if (isKnockbackLocked && hitSpeed > WALL_IMPACT_MIN_SPEED) {
            player.vel.z = -player.vel.z * 0.45;
            this.onWallImpact?.(player, player.pos.x, player.pos.y + 1.0, b.minZ, hitSpeed);
          } else if (player.vel.z > 0) {
            player.vel.z = 0;
          }
        } else {
          player.pos.z = b.maxZ + r;
          if (isKnockbackLocked && hitSpeed > WALL_IMPACT_MIN_SPEED) {
            player.vel.z = -player.vel.z * 0.45;
            this.onWallImpact?.(player, player.pos.x, player.pos.y + 1.0, b.maxZ, hitSpeed);
          } else if (player.vel.z < 0) {
            player.vel.z = 0;
          }
        }
      }
    }
  }

  private resolveWorldBounds(player: Player, dt: number): void {
    const dist = Math.hypot(player.pos.x, player.pos.z);
    if (dist > WORLD_SOFT_LIMIT) {
      const nx = player.pos.x / dist;
      const nz = player.pos.z / dist;
      const overshoot = dist - WORLD_SOFT_LIMIT;
      player.vel.x -= nx * overshoot * 6 * dt;
      player.vel.z -= nz * overshoot * 6 * dt;
      if (dist > WORLD_SOFT_LIMIT + 65) {
        player.pos.x = nx * (WORLD_SOFT_LIMIT + 65);
        player.pos.z = nz * (WORLD_SOFT_LIMIT + 65);
      }
    }

    if (player.pos.y > WORLD_MAX_ALTITUDE) {
      player.pos.y = WORLD_MAX_ALTITUDE;
      if (player.vel.y > 0) player.vel.y = 0;
    }
  }

  private updateBodyOrientation(
    player: Player,
    wishX: number,
    wishZ: number,
    wishMag: number,
    cmd: PlayerCommand,
    isKnockbackLocked: boolean,
    dt: number,
  ): void {
    if (isKnockbackLocked || player.combat.isBusy) {
      player.bodyPitch = damp(player.bodyPitch, 0, 9.5, dt);
      player.bodyRoll = damp(player.bodyRoll, 0, 9.5, dt);
      return;
    }

    const hSpeed = player.getHorizontalSpeed();

    if (wishMag > 0.1) {
      const targetYaw = Math.atan2(wishX, wishZ);
      player.facingYaw = dampAngle(player.facingYaw, targetYaw, player.flyMode ? 11 : 14, dt);
    } else if (hSpeed > 2.5) {
      const targetYaw = Math.atan2(player.vel.x, player.vel.z);
      player.facingYaw = dampAngle(player.facingYaw, targetYaw, 8, dt);
    } else if (player.flyMode || player.combat.isBlocking) {
      const camForwardYaw = Math.atan2(-Math.sin(cmd.cameraYaw), -Math.cos(cmd.cameraYaw));
      player.facingYaw = dampAngle(player.facingYaw, camForwardYaw, 8.5, dt);
    }

    let targetPitch = 0;
    let targetRoll = 0;

    if (player.flyMode) {
      const speedNorm = Math.min(1, hSpeed / FLY_BOOST_SPEED);
      const forwardSpeed =
        player.vel.x * Math.sin(player.facingYaw) + player.vel.z * Math.cos(player.facingYaw);
      const sideSpeed =
        player.vel.x * Math.cos(player.facingYaw) - player.vel.z * Math.sin(player.facingYaw);

      const baseTilt = player.isBoosting ? 1.15 : 0.42;
      targetPitch = Math.max(
        -0.4,
        Math.min(
          1.25,
          (forwardSpeed / FLY_NORMAL_SPEED) * 0.42 + speedNorm * (player.isBoosting ? 0.72 : 0.15),
        ),
      );
      if (hSpeed > 6) {
        targetPitch -= Math.max(-0.45, Math.min(0.45, player.vel.y / 55));
      } else {
        targetPitch = Math.max(-0.18, Math.min(0.28, targetPitch * baseTilt));
      }

      targetRoll = Math.max(
        -0.55,
        Math.min(0.55, -sideSpeed * 0.028 - cmd.moveRight * (player.isBoosting ? 0.35 : 0.18)),
      );
    } else if (player.isGrounded && hSpeed > 1) {
      targetPitch = Math.min(0.22, (hSpeed / RUN_SPEED) * 0.2);
      targetRoll = -cmd.moveRight * 0.08;
    }

    player.bodyPitch = damp(player.bodyPitch, targetPitch, 9.5, dt);
    player.bodyRoll = damp(player.bodyRoll, targetRoll, 9.5, dt);
  }
}
