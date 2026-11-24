import type { CharacterAppearance } from '../entities/Player';

export interface GameEvents {
  // Fase 1 — Movimento e impacto base
  'flight:toggle': { playerId: string; flying: boolean };
  'boost:start': { playerId: string };
  'boost:end': { playerId: string };
  'player:jump': { playerId: string; airJump: boolean };
  'player:land': { playerId: string; impactSpeed: number };
  'player:dash': { playerId: string };
  'impact:event': {
    id: string;
    x: number;
    y: number;
    z: number;
    radius: number;
    force: number;
    dirX: number;
    dirY: number;
    dirZ: number;
    seed: number;
  };

  // Fase 2 — Combate
  'combat:attack': { playerId: string; kind: 'light' | 'heavy' | 'skill'; slot: number };
  'combat:hit': {
    attackerId: string;
    targetId: string;
    x: number;
    y: number;
    z: number;
    damage: number;
    kind: 'light' | 'heavy' | 'skill' | 'blocked';
    power: number;
    backstab?: boolean;
  };
  'combat:dodge': { playerId: string; x: number; y: number; z: number };
  'combat:guardbreak': { playerId: string };
  'skill:charge': { playerId: string; slot: number; duration: number };
  'skill:fire': { playerId: string; slot: number };
  'projectile:explode': {
    x: number;
    y: number;
    z: number;
    radius: number;
    colorHex: string;
    power: number;
  };
  'fighter:death': { playerId: string; killerId: string | null };
  'fighter:respawn': { playerId: string };
  'camera:shake': { intensity: number; duration: number };
  'lock:change': { playerId: string; targetId: string | null };

  // Fase 3 — Teleporte, clash e impacto em parede
  'teleport:trigger': {
    playerId: string;
    fromX: number;
    fromY: number;
    fromZ: number;
    toX: number;
    toY: number;
    toZ: number;
    yaw: number;
    colorHex: string;
    behindTarget: boolean;
  };
  'combat:clash': {
    x: number;
    y: number;
    z: number;
    playerA: string;
    playerB: string;
  };
  'combat:wallimpact': {
    playerId: string;
    x: number;
    y: number;
    z: number;
    speed: number;
  };

  // Personalização e Multiplayer
  'player:appearance': { playerId: string; appearance: CharacterAppearance };
  'player:added': { playerId: string };
  'player:removed': { playerId: string };
}

type Handler<T> = (payload: T) => void;

/**
 * Barramento de eventos tipado para desacoplar simulação, áudio, efeitos, rede e HUD.
 */
export class EventBus {
  private listeners = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler<unknown>);
    return () => this.off(event, handler);
  }

  off<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): void {
    this.listeners.get(event)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as Handler<GameEvents[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
