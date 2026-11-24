import Peer, { DataConnection } from 'peerjs';
import type { GameEvents } from '../core/EventBus';
import type { Game } from '../core/Game';
import type { PlayerCommand } from '../core/Input';
import type { CharacterAppearance } from '../entities/Player';
import {
  formatRoomCode,
  generateRoomCode,
  NetMessage,
  NetMode,
  NetStatusInfo,
  NetWorldSnapshot,
  normalizeRoomCode,
  ReplicatedEventName,
  ROOM_CODE_PREFIX,
} from './Protocol';

const MAX_ROOM_PLAYERS = 8;
const HOST_PUBLIC_ID = 'host-0';
const SNAPSHOT_INTERVAL = 1 / 20; // 20Hz snapshots do Host para Guests
const CMD_INTERVAL = 1 / 30; // 30Hz comandos contínuos do Guest para Host

const REPLICATED_EVENTS: readonly ReplicatedEventName[] = [
  'combat:attack',
  'combat:hit',
  'combat:dodge',
  'combat:guardbreak',
  'combat:clash',
  'combat:wallimpact',
  'teleport:trigger',
  'skill:charge',
  'skill:fire',
  'projectile:explode',
  'fighter:death',
  'fighter:respawn',
  'impact:event',
];

function mapId(id: string | null | undefined, from: string, to: string): string {
  if (!id) return '';
  return id === from ? to : id;
}

function remapSnapshotIds(
  snapshot: NetWorldSnapshot,
  fromId: string,
  toId: string,
): NetWorldSnapshot {
  return {
    tick: snapshot.tick,
    players: snapshot.players.map((p) => ({
      ...p,
      id: mapId(p.id, fromId, toId),
      combat: {
        ...p.combat,
        lockTargetId: p.combat.lockTargetId
          ? mapId(p.combat.lockTargetId, fromId, toId)
          : null,
      },
    })),
    projectiles: snapshot.projectiles.map((pr) => ({
      ...pr,
      ownerId: mapId(pr.ownerId, fromId, toId),
    })),
    beams: snapshot.beams.map((b) => ({
      ...b,
      ownerId: mapId(b.ownerId, fromId, toId),
    })),
  };
}

function remapEventPayload<K extends ReplicatedEventName>(
  name: K,
  payload: GameEvents[K],
  fromId: string,
  toId: string,
): GameEvents[K] {
  const copy = { ...(payload as Record<string, unknown>) };
  if (typeof copy.playerId === 'string') copy.playerId = mapId(copy.playerId, fromId, toId);
  if (typeof copy.attackerId === 'string') copy.attackerId = mapId(copy.attackerId, fromId, toId);
  if (typeof copy.targetId === 'string') copy.targetId = mapId(copy.targetId, fromId, toId);
  if (typeof copy.killerId === 'string') copy.killerId = mapId(copy.killerId, fromId, toId);
  if (typeof copy.playerA === 'string') copy.playerA = mapId(copy.playerA, fromId, toId);
  if (typeof copy.playerB === 'string') copy.playerB = mapId(copy.playerB, fromId, toId);
  return copy as unknown as GameEvents[K];
}

function hasEdgeInput(cmd: PlayerCommand): boolean {
  return (
    cmd.jumpPressed ||
    cmd.flyTogglePressed ||
    cmd.dashPressed ||
    cmd.lockOnPressed ||
    cmd.teleportPressed ||
    cmd.lightAttack ||
    cmd.heavyAttack ||
    cmd.skillSlot > 0
  );
}

/**
 * Gerenciador de Multiplayer Online pronto para Vercel (PeerJS WebRTC DataChannels,
 * arquitetura Host-Autoritativo 60Hz + snapshots 20Hz + relay de eventos)
 * com modo opcional WebSocket (ZeroTier / LAN) usando o mesmo Protocol.ts.
 */
export class NetManager {
  private readonly game: Game;
  private readonly onStatusChange?: (status: NetStatusInfo) => void;

  private mode: NetMode = 'offline';
  private transport: 'p2p' | 'ws' = 'p2p';
  private roomCode = '';
  private pingMs = 0;
  private error: string | null = null;

  // Estado P2P (PeerJS)
  private peer: Peer | null = null;
  private hostConnections = new Map<string, DataConnection>(); // playerId -> DataConnection (no Host)
  private connToPlayerId = new Map<DataConnection, string>();
  private guestConn: DataConnection | null = null; // conexão do Guest com o Host
  private nextGuestSeq = 1;

  // Estado WebSocket opcional (ZeroTier / servidor dedicado)
  private ws: WebSocket | null = null;

  // ID atribuído ao jogador local pelo Host quando em modo Guest
  private assignedId: string | null = null;
  private replayingEvent = false;

  // Acumuladores de envio
  private snapshotAccum = 0;
  private cmdAccum = 0;
  private pingAccum = 0;
  private pendingPingSentAt = 0;

  private eventUnsubs: Array<() => void> = [];

  constructor(game: Game, onStatusChange?: (status: NetStatusInfo) => void) {
    this.game = game;
    this.onStatusChange = onStatusChange;
    this.bindGameEvents();
  }

  private bindGameEvents(): void {
    for (const name of REPLICATED_EVENTS) {
      const unsub = this.game.events.on(name, (payload) => {
        if (this.replayingEvent) return;
        if (this.mode !== 'hosting') return;
        const mapped = remapEventPayload(name, payload, this.game.localPlayer.id, HOST_PUBLIC_ID);
        this.broadcastToGuests({
          type: 'event',
          name,
          payload: mapped,
        });
      });
      this.eventUnsubs.push(unsub);
    }
  }

  public getStatus(): NetStatusInfo {
    const shareUrl =
      this.roomCode && typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}?sala=${formatRoomCode(this.roomCode)}`
        : '';

    return {
      mode: this.mode,
      transport: this.transport,
      roomCode: formatRoomCode(this.roomCode),
      shareUrl,
      pingMs: this.pingMs,
      playerCount: this.game.allPlayers.length,
      error: this.error,
    };
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.getStatus());
  }

  // ============================================================================
  // HOSPEDAR SALA ONLINE (VERCEL P2P — HOST AUTORITATIVO)
  // ============================================================================

  public hostRoom(customCode?: string): void {
    this.leaveRoom();

    const code = normalizeRoomCode(customCode ?? '') || generateRoomCode();
    this.transport = 'p2p';
    this.roomCode = code;
    this.mode = 'connecting';
    this.error = null;
    this.game.isNetGuest = false;
    this.assignedId = HOST_PUBLIC_ID;
    this.nextGuestSeq = 1;
    this.emitStatus();

    const peerId = `${ROOM_CODE_PREFIX}${code}`;
    const peer = new Peer(peerId, { debug: 0 });
    this.peer = peer;

    peer.on('open', () => {
      if (this.peer !== peer) return;
      this.mode = 'hosting';
      this.error = null;
      this.emitStatus();
    });

    peer.on('connection', (conn) => {
      this.handleHostIncomingConnection(conn);
    });

    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      if (err.type === 'unavailable-id') {
        // Código colidiu: gera outro automaticamente
        this.hostRoom(generateRoomCode());
        return;
      }
      this.error = this.translatePeerError(err.type, err.message);
      if (this.mode === 'connecting') {
        this.mode = 'offline';
        this.roomCode = '';
      }
      this.emitStatus();
    });

    peer.on('disconnected', () => {
      if (this.peer !== peer || peer.destroyed) return;
      try {
        peer.reconnect();
      } catch {
        // Ignora reconexão se destruído
      }
    });
  }

  private handleHostIncomingConnection(conn: DataConnection): void {
    conn.on('data', (raw) => {
      const msg = raw as NetMessage;
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

      if (msg.type === 'hello') {
        if (this.game.allPlayers.length >= MAX_ROOM_PLAYERS) {
          this.sendToConn(conn, {
            type: 'room:error',
            message: `Sala cheia (máximo ${MAX_ROOM_PLAYERS} guerreiros).`,
          });
          setTimeout(() => conn.close(), 150);
          return;
        }

        const guestId = `guest-${this.nextGuestSeq++}`;
        this.hostConnections.set(guestId, conn);
        this.connToPlayerId.set(conn, guestId);

        const added = this.game.addRemotePlayer(guestId, msg.appearance);
        const fullSnap = remapSnapshotIds(
          this.game.createNetSnapshot(true),
          this.game.localPlayer.id,
          HOST_PUBLIC_ID,
        );

        // Envia boas-vindas ao novo convidado com todos os jogadores + aparências
        this.sendToConn(conn, {
          type: 'welcome',
          assignedId: guestId,
          roomCode: formatRoomCode(this.roomCode),
          snapshot: fullSnap,
        });

        // Avisa os demais convidados da sala
        this.broadcastToGuests(
          {
            type: 'player:join',
            player: added.toJSON(true),
          },
          guestId,
        );

        this.emitStatus();
        return;
      }

      const senderId = this.connToPlayerId.get(conn);
      if (!senderId) return;

      if (msg.type === 'cmd') {
        this.game.queueRemoteCommand(senderId, msg.cmd);
      } else if (msg.type === 'appearance') {
        this.game.updatePlayerAppearance(senderId, msg.appearance);
        this.broadcastToGuests(
          {
            type: 'appearance',
            playerId: senderId,
            appearance: msg.appearance,
          },
          senderId,
        );
      } else if (msg.type === 'ping') {
        this.sendToConn(conn, { type: 'pong', t: msg.t });
      }
    });

    const onDisconnect = () => {
      const playerId = this.connToPlayerId.get(conn);
      if (!playerId) return;
      this.connToPlayerId.delete(conn);
      this.hostConnections.delete(playerId);
      this.game.removeRemotePlayer(playerId);
      this.broadcastToGuests({ type: 'player:leave', playerId });
      this.emitStatus();
    };

    conn.on('close', onDisconnect);
    conn.on('error', onDisconnect);
  }

  // ============================================================================
  // ENTRAR EM SALA ONLINE POR CÓDIGO (VERCEL P2P — GUEST)
  // ============================================================================

  public joinRoom(rawCode: string): void {
    const clean = normalizeRoomCode(rawCode);
    if (!clean) {
      this.error = 'Informe um código de sala válido (ex.: AF-7K2P).';
      this.emitStatus();
      return;
    }

    this.leaveRoom();

    this.transport = 'p2p';
    this.roomCode = clean;
    this.mode = 'connecting';
    this.error = null;
    this.assignedId = null;
    this.emitStatus();

    const peer = new Peer({ debug: 0 });
    this.peer = peer;

    peer.on('open', () => {
      if (this.peer !== peer) return;
      const hostPeerId = `${ROOM_CODE_PREFIX}${clean}`;
      const conn = peer.connect(hostPeerId, {
        reliable: true,
        serialization: 'json',
      });
      this.guestConn = conn;

      conn.on('open', () => {
        if (this.guestConn !== conn) return;
        this.sendToConn(conn, {
          type: 'hello',
          appearance: this.game.localPlayer.appearance,
        });
      });

      conn.on('data', (raw) => {
        if (this.guestConn !== conn) return;
        this.handleGuestMessage(raw as NetMessage);
      });

      conn.on('close', () => {
        if (this.guestConn !== conn) return;
        this.error = 'Conexão com o Host da sala foi encerrada.';
        this.leaveRoom(true);
      });

      conn.on('error', () => {
        if (this.guestConn !== conn) return;
        this.error = 'Não foi possível manter conexão com a sala.';
        this.leaveRoom(true);
      });
    });

    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      this.error = this.translatePeerError(err.type, err.message);
      this.leaveRoom(true);
    });
  }

  // ============================================================================
  // CONEXÃO OPCIONAL WEBSOCKET (ZEROTIER / LAN / SERVIDOR DEDICADO)
  // ============================================================================

  public connectWebSocket(rawUrl: string): void {
    const url = rawUrl.trim();
    if (!url || (!url.startsWith('ws://') && !url.startsWith('wss://'))) {
      this.error = 'Use um endereço WebSocket válido (ex.: ws://10.147.20.1:3000).';
      this.emitStatus();
      return;
    }

    this.leaveRoom();

    this.transport = 'ws';
    this.roomCode = 'WS';
    this.mode = 'connecting';
    this.error = null;
    this.assignedId = null;
    this.emitStatus();

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.sendWs({
          type: 'hello',
          appearance: this.game.localPlayer.appearance,
        });
      };

      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        try {
          const msg = JSON.parse(String(ev.data)) as NetMessage;
          this.handleGuestMessage(msg);
        } catch {
          // Ignora frame inválido
        }
      };

      ws.onerror = () => {
        if (this.ws !== ws) return;
        this.error = 'Falha ao conectar no servidor WebSocket / ZeroTier.';
        this.leaveRoom(true);
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        if (this.mode === 'connected' || this.mode === 'connecting') {
          this.error = this.error ?? 'Conexão WebSocket encerrada.';
          this.leaveRoom(true);
        }
      };
    } catch {
      this.error = 'Endereço WebSocket inválido.';
      this.leaveRoom(true);
    }
  }

  // ============================================================================
  // MENSAGENS RECEBIDAS PELO CONVIDADO (P2P OU WEBSOCKET)
  // ============================================================================

  private handleGuestMessage(msg: NetMessage): void {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

    if (msg.type === 'room:error') {
      this.error = msg.message;
      this.leaveRoom(true);
      return;
    }

    if (msg.type === 'welcome') {
      this.assignedId = msg.assignedId;
      this.roomCode = normalizeRoomCode(msg.roomCode) || this.roomCode;
      this.mode = 'connected';
      this.error = null;
      this.game.isNetGuest = true;
      this.game.applyNetSnapshot(msg.snapshot, msg.assignedId);
      this.emitStatus();
      return;
    }

    if (msg.type === 'snapshot') {
      if (!this.assignedId) return;
      this.game.applyNetSnapshot(msg.snapshot, this.assignedId);
      return;
    }

    if (msg.type === 'player:join') {
      if (msg.player.id === this.assignedId) return;
      this.game.addRemotePlayer(
        msg.player.id,
        msg.player.appearance ?? { ...this.game.localPlayer.appearance, nome: msg.player.name },
        msg.player.pos,
      );
      this.emitStatus();
      return;
    }

    if (msg.type === 'player:leave') {
      this.game.removeRemotePlayer(msg.playerId);
      this.emitStatus();
      return;
    }

    if (msg.type === 'appearance') {
      if (msg.playerId === this.assignedId) return;
      this.game.updatePlayerAppearance(msg.playerId, msg.appearance);
      return;
    }

    if (msg.type === 'pong') {
      if (this.pendingPingSentAt > 0) {
        this.pingMs = Math.max(1, Math.round(performance.now() - msg.t));
        this.pendingPingSentAt = 0;
      }
      return;
    }

    if (msg.type === 'event') {
      this.replayReplicatedEvent(msg.name, msg.payload);
    }
  }

  private replayReplicatedEvent<K extends ReplicatedEventName>(
    name: K,
    payload: GameEvents[K],
  ): void {
    const localId = this.game.localPlayer.id;
    const mapped = this.assignedId
      ? remapEventPayload(name, payload, this.assignedId, localId)
      : payload;

    // Atualiza feedback local de HUD/câmera/hitstop no Guest
    if (name === 'combat:hit') {
      const ev = mapped as GameEvents['combat:hit'];
      if (ev.attackerId === localId) {
        if (ev.kind !== 'blocked') {
          this.game.combat.localComboHits++;
          this.game.combat.localComboTimer = 2.4;
        }
        this.game.combat.localHitMarkerTimer = 0.22;
        if (ev.backstab) {
          this.game.combat.localBackstabTimer = 0.95;
        }
        if (ev.power >= 0.45) {
          this.game.events.emit('camera:shake', {
            intensity: 0.22 + ev.power * 0.45,
            duration: 0.16,
          });
        }
      } else if (ev.targetId === localId) {
        this.game.combat.localHurtTimer = Math.max(
          this.game.combat.localHurtTimer,
          0.25 + ev.power * 0.25,
        );
        this.game.events.emit('camera:shake', {
          intensity: 0.3 + ev.power * 0.5,
          duration: 0.2,
        });
      }
    } else if (name === 'combat:clash') {
      const ev = mapped as GameEvents['combat:clash'];
      if (ev.playerA === localId || ev.playerB === localId) {
        this.game.combat.localClashTimer = 0.85;
        this.game.hitStop = Math.max(this.game.hitStop, 0.08);
        this.game.events.emit('camera:shake', { intensity: 0.58, duration: 0.22 });
      }
    } else if (name === 'combat:wallimpact') {
      const ev = mapped as GameEvents['combat:wallimpact'];
      if (ev.playerId === localId) {
        this.game.combat.localHurtTimer = Math.max(this.game.combat.localHurtTimer, 0.32);
        this.game.events.emit('camera:shake', { intensity: 0.52, duration: 0.22 });
      }
    } else if (name === 'teleport:trigger') {
      const ev = mapped as GameEvents['teleport:trigger'];
      if (ev.playerId === localId) {
        this.game.events.emit('camera:shake', { intensity: 0.16, duration: 0.1 });
      }
    } else if (name === 'projectile:explode') {
      const ev = mapped as GameEvents['projectile:explode'];
      const lp = this.game.localPlayer;
      const d = Math.hypot(ev.x - lp.pos.x, ev.y - lp.pos.y, ev.z - lp.pos.z);
      if (d < 45) {
        const falloff = 1 - d / 45;
        this.game.events.emit('camera:shake', {
          intensity: (0.25 + ev.power * 0.6) * falloff,
          duration: 0.24,
        });
      }
    }

    this.replayingEvent = true;
    try {
      this.game.events.emit(name, mapped);
    } finally {
      this.replayingEvent = false;
    }
  }

  // ============================================================================
  // ENVIO CONTÍNUO NO LOOP (COMANDOS DO GUEST & SNAPSHOTS DO HOST)
  // ============================================================================

  public sendLocalCommand(cmd: PlayerCommand): void {
    if (this.mode !== 'connected') return;
    if (hasEdgeInput(cmd) || this.cmdAccum >= CMD_INTERVAL) {
      this.cmdAccum = 0;
      this.sendToHost({ type: 'cmd', cmd: { ...cmd } });
    }
  }

  public tickNetwork(dt: number): void {
    if (this.mode === 'hosting') {
      this.snapshotAccum += dt;
      if (this.snapshotAccum >= SNAPSHOT_INTERVAL) {
        this.snapshotAccum = 0;
        if (this.hostConnections.size > 0) {
          const snap = remapSnapshotIds(
            this.game.createNetSnapshot(false),
            this.game.localPlayer.id,
            HOST_PUBLIC_ID,
          );
          this.broadcastToGuests({ type: 'snapshot', snapshot: snap });
        }
      }
    } else if (this.mode === 'connected') {
      this.cmdAccum += dt;
      this.pingAccum += dt;
      if (this.pingAccum >= 2.0) {
        this.pingAccum = 0;
        this.pendingPingSentAt = performance.now();
        this.sendToHost({ type: 'ping', t: this.pendingPingSentAt });
      }
    }
  }

  /** Sincroniza nova aparência customizada com todos os jogadores da sala. */
  public broadcastLocalAppearance(appearance: CharacterAppearance): void {
    if (this.mode === 'hosting') {
      this.broadcastToGuests({
        type: 'appearance',
        playerId: HOST_PUBLIC_ID,
        appearance,
      });
    } else if (this.mode === 'connected' && this.assignedId) {
      this.sendToHost({
        type: 'appearance',
        playerId: this.assignedId,
        appearance,
      });
    }
  }

  public leaveRoom(preserveError = false): void {
    for (const conn of this.hostConnections.values()) {
      try {
        conn.close();
      } catch {
        // ignore
      }
    }
    this.hostConnections.clear();
    this.connToPlayerId.clear();

    if (this.guestConn) {
      try {
        this.guestConn.close();
      } catch {
        // ignore
      }
      this.guestConn = null;
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    this.game.clearRemotePlayers();
    this.mode = 'offline';
    this.roomCode = '';
    this.pingMs = 0;
    this.assignedId = null;
    if (!preserveError) this.error = null;
    this.emitStatus();
  }

  private sendToConn(conn: DataConnection, msg: NetMessage): void {
    if (!conn.open) return;
    try {
      conn.send(msg);
    } catch {
      // ignora erro transitório de canal fechado
    }
  }

  private sendWs(msg: NetMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }

  private sendToHost(msg: NetMessage): void {
    if (this.transport === 'ws') {
      this.sendWs(msg);
    } else if (this.guestConn) {
      this.sendToConn(this.guestConn, msg);
    }
  }

  private broadcastToGuests(msg: NetMessage, excludePlayerId?: string): void {
    for (const [playerId, conn] of this.hostConnections.entries()) {
      if (excludePlayerId && playerId === excludePlayerId) continue;
      this.sendToConn(conn, msg);
    }
  }

  private translatePeerError(type: string, fallback: string): string {
    if (type === 'peer-unavailable') {
      return 'Sala não encontrada. Verifique o código ou se o Host está online.';
    }
    if (type === 'network' || type === 'server-error' || type === 'socket-error') {
      return 'Sem conexão com o servidor de sinalização P2P. Tente novamente.';
    }
    if (type === 'browser-incompatible') {
      return 'Seu navegador não suporta WebRTC para salas P2P.';
    }
    return fallback || 'Erro de conexão online.';
  }

  public dispose(): void {
    this.leaveRoom();
    for (const unsub of this.eventUnsubs) unsub();
    this.eventUnsubs = [];
  }
}
