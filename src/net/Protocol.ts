import type { GameEvents } from '../core/EventBus';
import type { PlayerCommand } from '../core/Input';
import type { CharacterAppearance, PlayerSnapshot } from '../entities/Player';

export type NetMode = 'offline' | 'connecting' | 'hosting' | 'connected';

export interface NetProjectileSnapshot {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  colorHex: string;
  life: number;
}

export interface NetBeamSnapshot {
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

export interface NetWorldSnapshot {
  tick: number;
  players: PlayerSnapshot[];
  projectiles: NetProjectileSnapshot[];
  beams: NetBeamSnapshot[];
}

export type ReplicatedEventName =
  | 'combat:attack'
  | 'combat:hit'
  | 'combat:dodge'
  | 'combat:guardbreak'
  | 'combat:clash'
  | 'combat:wallimpact'
  | 'teleport:trigger'
  | 'skill:charge'
  | 'skill:fire'
  | 'projectile:explode'
  | 'fighter:death'
  | 'fighter:respawn'
  | 'impact:event';

export type NetMessage =
  | {
      type: 'hello';
      appearance: CharacterAppearance;
    }
  | {
      type: 'welcome';
      assignedId: string;
      roomCode: string;
      snapshot: NetWorldSnapshot;
    }
  | {
      type: 'cmd';
      cmd: PlayerCommand;
    }
  | {
      type: 'appearance';
      playerId: string;
      appearance: CharacterAppearance;
    }
  | {
      type: 'snapshot';
      snapshot: NetWorldSnapshot;
    }
  | {
      type: 'event';
      name: ReplicatedEventName;
      payload: GameEvents[ReplicatedEventName];
    }
  | {
      type: 'player:join';
      player: PlayerSnapshot;
    }
  | {
      type: 'player:leave';
      playerId: string;
    }
  | {
      type: 'ping';
      t: number;
    }
  | {
      type: 'pong';
      t: number;
    }
  | {
      type: 'room:error';
      message: string;
    };

export interface NetStatusInfo {
  mode: NetMode;
  transport: 'p2p' | 'ws';
  roomCode: string;
  shareUrl: string;
  pingMs: number;
  playerCount: number;
  error: string | null;
}

export const ROOM_CODE_PREFIX = 'aether-fighters-room-';

export function normalizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/^AF-?/, '')
    .slice(0, 6);
}

export function formatRoomCode(code: string): string {
  const clean = normalizeRoomCode(code);
  return clean ? `AF-${clean}` : '';
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
