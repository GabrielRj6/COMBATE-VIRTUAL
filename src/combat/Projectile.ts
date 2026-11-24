import { SkillDef } from './Skills';
import { WorldBoxCollider } from '../world/WorldGeometry';

export const PROJECTILE_POOL_SIZE = 64;
export const BEAM_POOL_SIZE = 6;
export const PROJECTILE_DEFAULT_LIFE = 4.0;
export const BEAM_DEFAULT_LIFE = 0.5;

/**
 * Slot reutilizável de projétil de energia (zero alocação no loop 60Hz).
 */
export interface ProjectileSlot {
  active: boolean;
  id: string;
  ownerId: string;
  skill: SkillDef | null;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  radius: number;
  colorHex: string;
}

/**
 * Slot reutilizável de feixe instantâneo (Raio Carregado) para renderização em CombatFX.
 */
export interface BeamFx {
  active: boolean;
  id: string;
  ownerId: string;
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  width: number;
  colorHex: string;
  life: number;
  maxLife: number;
}

export function createProjectilePool(size = PROJECTILE_POOL_SIZE): ProjectileSlot[] {
  const pool: ProjectileSlot[] = [];
  for (let i = 0; i < size; i++) {
    pool.push({
      active: false,
      id: `proj-${i}`,
      ownerId: '',
      skill: null,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      radius: 0.5,
      colorHex: '#38bdf8',
    });
  }
  return pool;
}

export function createBeamPool(size = BEAM_POOL_SIZE): BeamFx[] {
  const pool: BeamFx[] = [];
  for (let i = 0; i < size; i++) {
    pool.push({
      active: false,
      id: `beam-${i}`,
      ownerId: '',
      startX: 0,
      startY: 0,
      startZ: 0,
      endX: 0,
      endY: 0,
      endZ: 0,
      width: 1.6,
      colorHex: '#38bdf8',
      life: 0,
      maxLife: BEAM_DEFAULT_LIFE,
    });
  }
  return pool;
}

/**
 * Distância ao quadrado entre o ponto P e o segmento AB (varredura anti-tunneling).
 */
export function segmentPointDistSq(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  px: number,
  py: number,
  pz: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;

  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (abLenSq > 1e-8) {
    t = (apx * abx + apy * aby + apz * abz) / abLenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }

  const cx = ax + abx * t - px;
  const cy = ay + aby * t - py;
  const cz = az + abz * t - pz;
  return cx * cx + cy * cy + cz * cz;
}

/**
 * Interseção segmento AB contra AABB expandida por `expand` (método slab).
 * Retorna o parâmetro t em [0, 1] do primeiro impacto, ou -1 se não houver colisão.
 */
export function segmentAABBIntersectT(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  box: WorldBoxCollider,
  expand: number,
): number {
  const minX = box.minX - expand;
  const maxX = box.maxX + expand;
  const minY = box.minY - expand;
  const maxY = box.maxY + expand;
  const minZ = box.minZ - expand;
  const maxZ = box.maxZ + expand;

  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;

  let tMin = 0;
  let tMax = 1;

  // Eixo X
  if (Math.abs(dx) < 1e-8) {
    if (ax < minX || ax > maxX) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - ax) * inv;
    let t2 = (maxX - ax) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }

  // Eixo Y
  if (Math.abs(dy) < 1e-8) {
    if (ay < minY || ay > maxY) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - ay) * inv;
    let t2 = (maxY - ay) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }

  // Eixo Z
  if (Math.abs(dz) < 1e-8) {
    if (az < minZ || az > maxZ) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - az) * inv;
    let t2 = (maxZ - az) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }

  return tMin;
}
