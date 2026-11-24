/**
 * Tabelas de balanceamento de combate corpo a corpo, poderes de Ki e teleporte.
 * Todo ajuste de dano, tempo, alcance e força de destruição fica centralizado aqui.
 */

export interface MeleeMove {
  id: 'L1' | 'L2' | 'L3' | 'L4' | 'H';
  dano: number;
  total: number;
  hitAt: number;
  alcance: number;
  lunge: number;
  knockback: number;
  launch: number;
  stun: number;
  hitStop: number;
  shake: number;
  kiGanho: number;
  forca: number;
}

export const LIGHT_COMBO: readonly MeleeMove[] = [
  {
    id: 'L1',
    dano: 38,
    total: 0.30,
    hitAt: 0.10,
    alcance: 3.1,
    lunge: 22,
    knockback: 5,
    launch: 0,
    stun: 0.26,
    hitStop: 0.045,
    shake: 0.18,
    kiGanho: 3,
    forca: 1,
  },
  {
    id: 'L2',
    dano: 42,
    total: 0.30,
    hitAt: 0.10,
    alcance: 3.1,
    lunge: 22,
    knockback: 6,
    launch: 0,
    stun: 0.28,
    hitStop: 0.05,
    shake: 0.20,
    kiGanho: 3,
    forca: 1,
  },
  {
    id: 'L3',
    dano: 50,
    total: 0.36,
    hitAt: 0.13,
    alcance: 3.3,
    lunge: 24,
    knockback: 8,
    launch: 0,
    stun: 0.30,
    hitStop: 0.06,
    shake: 0.26,
    kiGanho: 4,
    forca: 2,
  },
  {
    id: 'L4',
    dano: 95,
    total: 0.58,
    hitAt: 0.24,
    alcance: 3.6,
    lunge: 28,
    knockback: 36,
    launch: 6,
    stun: 0.55,
    hitStop: 0.10,
    shake: 0.60,
    kiGanho: 8,
    forca: 3,
  },
];

export const HEAVY_MOVE: MeleeMove = {
  id: 'H',
  dano: 130,
  total: 0.78,
  hitAt: 0.38,
  alcance: 3.8,
  lunge: 26,
  knockback: 46,
  launch: 8,
  stun: 0.65,
  hitStop: 0.11,
  shake: 0.75,
  kiGanho: 10,
  forca: 4,
};

// Constantes globais de combate (Fase 2)
export const COMBO_WINDOW = 0.38;
export const INPUT_BUFFER = 0.28;
export const MELEE_MOVE_SCALE = 0.3;
export const BLOCK_MELEE_REDUCTION = 0.2;
export const BLOCK_KI_REDUCTION = 0.4;
export const BLOCK_STAMINA_PER_DAMAGE = 0.55;
export const GUARD_BREAK_STUN = 1.0;
export const RESPAWN_TIME_PLAYER = 3.0;
export const RESPAWN_TIME_BOT = 4.5;

// Constantes da Fase 3 — Teleporte, Clash e Impacto em Parede
export const TELEPORT_KI_COST = 10;
export const TELEPORT_COOLDOWN = 2.0;
export const TELEPORT_INVULN = 0.22;
export const TELEPORT_ANIM_DURATION = 0.14;
export const TELEPORT_BLINK_DIST = 16.0;
export const TELEPORT_TARGET_RANGE = 48.0;
export const TELEPORT_BEHIND_DIST = 2.45;
export const BACKSTAB_WINDOW = 1.4;
export const BACKSTAB_MULTIPLIER = 1.35;

export const CLASH_RANGE = 3.8;
export const CLASH_KNOCKBACK = 20.0;
export const CLASH_HITSTOP = 0.11;

export const WALL_IMPACT_MIN_SPEED = 24.0;
export const WALL_IMPACT_DAMAGE = 35;

export type SkillKind = 'projectile' | 'burst' | 'beam' | 'ultimate';

export interface SkillDef {
  id: string;
  slot: 1 | 2 | 3 | 4;
  nome: string;
  kind: SkillKind;
  custoKi: number;
  cooldown: number;
  tempoCarga: number;
  dano: number;
  velocidade: number;
  raio: number;
  raioExplosao: number;
  knockback: number;
  forcaDestruicao: number;
  tiros?: number;
  intervalo?: number;
  alcance?: number;
  largura?: number;
  cor: string; // vazio = usa appearance.ki do lançador
}

export const SKILLS: readonly SkillDef[] = [
  {
    id: 'ki-pulse',
    slot: 1,
    nome: 'Pulso de Ki',
    kind: 'projectile',
    custoKi: 8,
    cooldown: 0.45,
    tempoCarga: 0.10,
    dano: 55,
    velocidade: 95,
    raio: 0.55,
    raioExplosao: 3.2,
    knockback: 16,
    forcaDestruicao: 2,
    cor: '',
  },
  {
    id: 'ki-barrage',
    slot: 2,
    nome: 'Rajada Contínua',
    kind: 'burst',
    custoKi: 22,
    cooldown: 3.0,
    tempoCarga: 0.10,
    dano: 17,
    velocidade: 115,
    raio: 0.30,
    raioExplosao: 1.6,
    knockback: 6,
    forcaDestruicao: 1,
    tiros: 7,
    intervalo: 0.085,
    cor: '',
  },
  {
    id: 'charged-beam',
    slot: 3,
    nome: 'Raio Carregado',
    kind: 'beam',
    custoKi: 40,
    cooldown: 7.0,
    tempoCarga: 0.90,
    dano: 210,
    velocidade: 0,
    raio: 1.1,
    raioExplosao: 4.0,
    knockback: 34,
    forcaDestruicao: 6,
    alcance: 150,
    largura: 1.6,
    cor: '',
  },
  {
    id: 'devastating-wave',
    slot: 4,
    nome: 'Onda Devastadora',
    kind: 'ultimate',
    custoKi: 80,
    cooldown: 20.0,
    tempoCarga: 1.60,
    dano: 600,
    velocidade: 58,
    raio: 4.2,
    raioExplosao: 24,
    knockback: 70,
    forcaDestruicao: 10,
    cor: '',
  },
];

export function getSkillBySlot(slot: number): SkillDef | null {
  if (slot < 1 || slot > SKILLS.length) return null;
  return SKILLS[slot - 1];
}
