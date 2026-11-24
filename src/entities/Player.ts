import { CombatState, CombatStateSnapshot } from '../combat/CombatState';
import { Fighter, FighterSnapshot, FighterState } from './Fighter';

export type AccessoryType = 'nenhum' | 'cachecol' | 'capa';

/**
 * Formato JSON de customização (Seção 7), pronto para persistência e sincronização online.
 */
export interface CharacterAppearance {
  nome: string;
  altura: number; // 0.85 .. 1.20
  porte: number;  // 0.0 (magro) .. 1.0 (forte)
  pele: string;
  cabelo: { estilo: number; cor: string }; // 0..4
  roupa: {
    cima: string;
    baixo: string;
    botas: string;
    luvas: string;
    detalhes: string;
    acessorio: AccessoryType;
    corAcessorio: string;
  };
  aura: { estilo: number; cor: string }; // 0: brilho, 1: chama, 2: relâmpago
  ki: string;
}

export interface Vec3Data {
  x: number;
  y: number;
  z: number;
}

export interface PlayerSnapshot {
  id: string;
  isLocal: boolean;
  isBot: boolean;
  name: string;
  pos: Vec3Data;
  vel: Vec3Data;
  facingYaw: number;
  bodyPitch: number;
  bodyRoll: number;
  flyMode: boolean;
  isBoosting: boolean;
  isCharging: boolean;
  isGrounded: boolean;
  kills: number;
  deaths: number;
  fighter: FighterSnapshot;
  combat: CombatStateSnapshot;
  appearance?: CharacterAppearance;
}

export const DEFAULT_APPEARANCE: CharacterAppearance = {
  nome: 'Kael Vance',
  altura: 1.0,
  porte: 0.55,
  pele: '#e5b898',
  cabelo: { estilo: 1, cor: '#141926' },
  roupa: {
    cima: '#f97316',
    baixo: '#1e293b',
    botas: '#0f172a',
    luvas: '#0f172a',
    detalhes: '#38bdf8',
    acessorio: 'cachecol',
    corAcessorio: '#38bdf8',
  },
  aura: { estilo: 1, cor: '#38bdf8' },
  ki: '#38bdf8',
};

export function normalizeAppearance(
  partial?: Partial<CharacterAppearance>,
): CharacterAppearance {
  return {
    nome: (partial?.nome ?? DEFAULT_APPEARANCE.nome).trim().slice(0, 20) || 'Guerreiro',
    altura: Math.max(0.85, Math.min(1.2, partial?.altura ?? DEFAULT_APPEARANCE.altura)),
    porte: Math.max(0, Math.min(1, partial?.porte ?? DEFAULT_APPEARANCE.porte)),
    pele: partial?.pele ?? DEFAULT_APPEARANCE.pele,
    cabelo: {
      estilo: Math.max(0, Math.min(4, Math.round(partial?.cabelo?.estilo ?? DEFAULT_APPEARANCE.cabelo.estilo))),
      cor: partial?.cabelo?.cor ?? DEFAULT_APPEARANCE.cabelo.cor,
    },
    roupa: {
      cima: partial?.roupa?.cima ?? DEFAULT_APPEARANCE.roupa.cima,
      baixo: partial?.roupa?.baixo ?? DEFAULT_APPEARANCE.roupa.baixo,
      botas: partial?.roupa?.botas ?? DEFAULT_APPEARANCE.roupa.botas,
      luvas: partial?.roupa?.luvas ?? partial?.roupa?.botas ?? DEFAULT_APPEARANCE.roupa.luvas,
      detalhes: partial?.roupa?.detalhes ?? DEFAULT_APPEARANCE.roupa.detalhes,
      acessorio: partial?.roupa?.acessorio ?? DEFAULT_APPEARANCE.roupa.acessorio,
      corAcessorio:
        partial?.roupa?.corAcessorio ??
        partial?.roupa?.detalhes ??
        DEFAULT_APPEARANCE.roupa.corAcessorio,
    },
    aura: {
      estilo: Math.max(0, Math.min(2, Math.round(partial?.aura?.estilo ?? DEFAULT_APPEARANCE.aura.estilo))),
      cor: partial?.aura?.cor ?? DEFAULT_APPEARANCE.aura.cor,
    },
    ki: partial?.ki ?? DEFAULT_APPEARANCE.ki,
  };
}

/**
 * Entidade de jogador (local ou remoto).
 * Armazena estado anterior e atual para interpolação suave no renderizador.
 */
export class Player {
  public readonly id: string;
  public readonly isLocal: boolean;
  public readonly isBot: boolean;
  public name: string;
  public appearance: CharacterAppearance;
  public readonly fighter: Fighter;
  public readonly combat: CombatState;

  public readonly spawn: Vec3Data;
  public kills = 0;
  public deaths = 0;

  public controlLock = 0;
  public moveScale = 1.0;

  public readonly radius = 0.55;
  public readonly height = 2.05;

  public pos: Vec3Data;
  public prevPos: Vec3Data;
  public vel: Vec3Data = { x: 0, y: 0, z: 0 };

  public facingYaw = 0;
  public prevFacingYaw = 0;
  public bodyPitch = 0;
  public prevBodyPitch = 0;
  public bodyRoll = 0;
  public prevBodyRoll = 0;

  public isGrounded = true;
  public flyMode = false;
  public isBoosting = false;
  public isCharging = false;
  public dashTimer = 0;
  public dashDir: Vec3Data = { x: 0, y: 0, z: 0 };
  public jumpHoldTimer = 0;
  public airTime = 0;

  public animPhase = 0;

  constructor(
    id: string,
    isLocal: boolean,
    spawnPos: Vec3Data,
    appearance: Partial<CharacterAppearance> = {},
    isBot = false,
  ) {
    this.id = id;
    this.isLocal = isLocal;
    this.isBot = isBot;
    this.appearance = normalizeAppearance(appearance);
    this.name = this.appearance.nome;
    this.fighter = new Fighter();
    this.combat = new CombatState();
    this.spawn = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
    this.pos = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
    this.prevPos = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
  }

  public setAppearance(next: Partial<CharacterAppearance>): void {
    this.appearance = normalizeAppearance(next);
    this.name = this.appearance.nome;
  }

  public capturePreviousState(): void {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.prevPos.z = this.pos.z;
    this.prevFacingYaw = this.facingYaw;
    this.prevBodyPitch = this.bodyPitch;
    this.prevBodyRoll = this.bodyRoll;
  }

  public getSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.y, this.vel.z);
  }

  public getHorizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  public getState(): FighterState {
    return this.fighter.state;
  }

  public toJSON(includeAppearance = false): PlayerSnapshot {
    const snap: PlayerSnapshot = {
      id: this.id,
      isLocal: this.isLocal,
      isBot: this.isBot,
      name: this.name,
      pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
      vel: { x: this.vel.x, y: this.vel.y, z: this.vel.z },
      facingYaw: this.facingYaw,
      bodyPitch: this.bodyPitch,
      bodyRoll: this.bodyRoll,
      flyMode: this.flyMode,
      isBoosting: this.isBoosting,
      isCharging: this.isCharging,
      isGrounded: this.isGrounded,
      kills: this.kills,
      deaths: this.deaths,
      fighter: this.fighter.toJSON(),
      combat: this.combat.toJSON(),
    };
    if (includeAppearance) {
      snap.appearance = this.appearance;
    }
    return snap;
  }
}
