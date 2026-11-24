import { EventBus } from '../core/EventBus';
import { PlayerCommand } from '../core/Input';
import { FighterState } from '../entities/Fighter';
import { Player } from '../entities/Player';
import {
  groundHeightAt,
  WORLD_MAX_ALTITUDE,
  WORLD_SOFT_LIMIT,
  WorldBoxCollider,
} from '../world/WorldGeometry';
import { segmentAABBIntersectT } from './Projectile';
import {
  BACKSTAB_WINDOW,
  TELEPORT_ANIM_DURATION,
  TELEPORT_BEHIND_DIST,
  TELEPORT_BLINK_DIST,
  TELEPORT_COOLDOWN,
  TELEPORT_INVULN,
  TELEPORT_KI_COST,
  TELEPORT_TARGET_RANGE,
} from './Skills';

function isPointInsideAnyCollider(
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  colliders: WorldBoxCollider[],
): boolean {
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (
      x + radius > b.minX &&
      x - radius < b.maxX &&
      z + radius > b.minZ &&
      z - radius < b.maxZ &&
      y + height > b.minY &&
      y < b.maxY
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Executa o Teleporte (tecla Q — Fase 3).
 * - Com alvo travado ou inimigo próximo na mira: surge atrás/ao lado dele (mesmo no ar),
 *   abre janela de ataque pelas costas (+35% de dano) e cancela recuperação de combo.
 * - Sem alvo: teleporte curto na direção da câmera, parando antes de prédios/terreno.
 */
export function tryExecuteTeleport(
  player: Player,
  cmd: PlayerCommand,
  players: Player[],
  colliders: WorldBoxCollider[],
  events: EventBus,
): boolean {
  const c = player.combat;

  if (player.fighter.state === FighterState.DEAD) return false;
  if (c.stunTimer > 0) return false;
  if (c.teleportCooldown > 0) return false;
  if (player.fighter.ki < TELEPORT_KI_COST) return false;

  const fromX = player.pos.x;
  const fromY = player.pos.y;
  const fromZ = player.pos.z;

  // Direção base da câmera
  let dirX = -Math.sin(cmd.cameraYaw);
  let dirY = -Math.sin(cmd.cameraPitch - 0.22);
  let dirZ = -Math.cos(cmd.cameraYaw);
  const dLen = Math.hypot(dirX, dirY, dirZ) || 1;
  dirX /= dLen;
  dirY /= dLen;
  dirZ /= dLen;

  // 1. Procura alvo (lock-on primeiro; depois inimigo próximo na mira)
  let target: Player | null = null;
  if (c.lockTargetId) {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.id === c.lockTargetId && p.fighter.state !== FighterState.DEAD) {
        const dist = Math.hypot(p.pos.x - fromX, p.pos.y - fromY, p.pos.z - fromZ);
        if (dist <= 95) {
          target = p;
        }
        break;
      }
    }
  }

  if (!target) {
    let bestDist = TELEPORT_TARGET_RANGE;
    for (let i = 0; i < players.length; i++) {
      const cand = players[i];
      if (cand.id === player.id) continue;
      if (cand.fighter.state === FighterState.DEAD) continue;
      if (player.isBot && cand.isBot) continue;

      const dx = cand.pos.x - fromX;
      const dy = cand.pos.y - fromY;
      const dz = cand.pos.z - fromZ;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > bestDist || dist < 0.01) continue;

      const dot = (dx * dirX + dy * dirY + dz * dirZ) / dist;
      if (dot > 0.35) {
        bestDist = dist;
        target = cand;
      }
    }
  }

  let toX = fromX;
  let toY = fromY;
  let toZ = fromZ;
  let newYaw = player.facingYaw;
  let behindTarget = false;

  if (target) {
    behindTarget = true;
    const tFaceX = Math.sin(target.facingYaw);
    const tFaceZ = Math.cos(target.facingYaw);

    // Tenta atrás -> flanco direito -> flanco esquerdo -> acima, evitando ficar dentro de prédios
    const candidates: Array<[number, number, number]> = [
      [-tFaceX * TELEPORT_BEHIND_DIST, 0, -tFaceZ * TELEPORT_BEHIND_DIST],
      [tFaceZ * TELEPORT_BEHIND_DIST, 0, -tFaceX * TELEPORT_BEHIND_DIST],
      [-tFaceZ * TELEPORT_BEHIND_DIST, 0, tFaceX * TELEPORT_BEHIND_DIST],
      [0, 2.4, 0],
    ];

    toX = target.pos.x - tFaceX * TELEPORT_BEHIND_DIST;
    toY = target.pos.y;
    toZ = target.pos.z - tFaceZ * TELEPORT_BEHIND_DIST;

    for (let i = 0; i < candidates.length; i++) {
      const cx = target.pos.x + candidates[i][0];
      const cz = target.pos.z + candidates[i][2];
      const gY = groundHeightAt(cx, cz);
      const cy = Math.max(gY, target.pos.y + candidates[i][1]);
      if (!isPointInsideAnyCollider(cx, cy, cz, player.radius, player.height, colliders)) {
        toX = cx;
        toY = cy;
        toZ = cz;
        break;
      }
    }

    // Encara diretamente o alvo ao chegar
    newYaw = Math.atan2(target.pos.x - toX, target.pos.z - toZ);

    // Se o alvo estiver no ar, ativa voo automaticamente para encadear combos aéreos
    const destGround = groundHeightAt(toX, toZ);
    if (target.flyMode || toY > destGround + 1.8) {
      player.flyMode = true;
      player.isGrounded = false;
    }

    // Abre janela de bônus de golpe pelas costas
    c.backAttackTimer = BACKSTAB_WINDOW;
    c.backAttackTargetId = target.id;
  } else {
    // Sem alvo: blink direcional de 16m na direção da câmera (recortado por prédios/terreno)
    const rawX = fromX + dirX * TELEPORT_BLINK_DIST;
    const rawY = fromY + (player.flyMode ? dirY * TELEPORT_BLINK_DIST : Math.max(0, dirY * TELEPORT_BLINK_DIST * 0.6));
    const rawZ = fromZ + dirZ * TELEPORT_BLINK_DIST;

    let bestT = 1.0;
    for (let i = 0; i < colliders.length; i++) {
      const t = segmentAABBIntersectT(
        fromX,
        fromY + 1.0,
        fromZ,
        rawX,
        rawY + 1.0,
        rawZ,
        colliders[i],
        player.radius + 0.15,
      );
      if (t >= 0 && t < bestT) {
        bestT = Math.max(0, t - 0.08);
      }
    }

    toX = fromX + (rawX - fromX) * bestT;
    toY = fromY + (rawY - fromY) * bestT;
    toZ = fromZ + (rawZ - fromZ) * bestT;

    const gY = groundHeightAt(toX, toZ);
    if (toY < gY) toY = gY;
    newYaw = Math.atan2(dirX, dirZ);
  }

  // Clamp seguro aos limites do mundo
  const distCenter = Math.hypot(toX, toZ);
  if (distCenter > WORLD_SOFT_LIMIT) {
    const scale = WORLD_SOFT_LIMIT / distCenter;
    toX *= scale;
    toZ *= scale;
  }
  toY = Math.max(groundHeightAt(toX, toZ), Math.min(WORLD_MAX_ALTITUDE, toY));

  // Consome Ki, ativa cooldown, invulnerabilidade e cancela recuperações de ataque
  player.fighter.ki = Math.max(0, player.fighter.ki - TELEPORT_KI_COST);
  c.cancelActions();
  c.teleportCooldown = TELEPORT_COOLDOWN;
  c.teleportTimer = TELEPORT_ANIM_DURATION;
  c.invulnTimer = Math.max(c.invulnTimer, TELEPORT_INVULN);
  c.aimYaw = newYaw;

  // Atualiza posição instantaneamente (prevPos = pos para não interpolar atravessando o mapa)
  player.pos.x = toX;
  player.pos.y = toY;
  player.pos.z = toZ;
  player.prevPos.x = toX;
  player.prevPos.y = toY;
  player.prevPos.z = toZ;

  player.facingYaw = newYaw;
  player.prevFacingYaw = newYaw;

  // Zera inércia excessiva na chegada para controle imediato do combo
  player.vel.x *= 0.25;
  player.vel.y = player.flyMode ? 0 : Math.max(0, player.vel.y * 0.25);
  player.vel.z *= 0.25;
  player.fighter.state = FighterState.TELEPORTING;

  events.emit('teleport:trigger', {
    playerId: player.id,
    fromX,
    fromY,
    fromZ,
    toX,
    toY,
    toZ,
    yaw: newYaw,
    colorHex: player.appearance.ki,
    behindTarget,
  });

  return true;
}
