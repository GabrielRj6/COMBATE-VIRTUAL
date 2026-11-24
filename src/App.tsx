import { useCallback, useEffect, useRef, useState } from 'react';
import { SKILLS, TELEPORT_COOLDOWN } from './combat/Skills';
import { HudTelemetry } from './core/Game';
import { CharacterCreator } from './customization/CharacterCreator';
import { loadActiveAppearance } from './customization/Presets';
import { FighterState } from './entities/Fighter';
import type { CharacterAppearance } from './entities/Player';
import type { NetStatusInfo } from './net/Protocol';
import { formatRoomCode } from './net/Protocol';
import { SceneRenderer } from './renderer/SceneRenderer';
import { HUD } from './ui/HUD';
import { OnlineLobby } from './ui/OnlineLobby';

type ActiveModal = 'none' | 'online' | 'creator';

const INITIAL_TELEMETRY: HudTelemetry = {
  playerName: 'Kael Vance',
  hp: 1000,
  maxHp: 1000,
  ki: 100,
  maxKi: 100,
  stamina: 100,
  maxStamina: 100,
  state: FighterState.GROUNDED,
  flyMode: false,
  isBoosting: false,
  isCharging: false,
  isBlocking: false,
  speedKmh: 0,
  altitude: 0,
  posX: 0,
  posY: 0,
  posZ: 18,
  tick: 0,
  fps: 60,
  activeEntities: 1,
  activeDebris: 0,
  activeProjectiles: 0,
  lock: null,
  skills: SKILLS.map((sk) => ({
    slot: sk.slot,
    nome: sk.nome,
    custoKi: sk.custoKi,
    cooldown: 0,
    cooldownMax: sk.cooldown,
    affordable: true,
  })),
  teleportCooldown: 0,
  teleportCooldownMax: TELEPORT_COOLDOWN,
  comboHits: 0,
  hurt: 0,
  dead: false,
  respawnIn: 0,
  kills: 0,
  deaths: 0,
  hitMarker: false,
  backstabCallout: false,
  clashCallout: false,
  remoteLabels: [],
  scoreboard: [],
  netMode: 'offline',
  roomCode: '',
  pingMs: 0,
};

const INITIAL_NET_STATUS: NetStatusInfo = {
  mode: 'offline',
  transport: 'p2p',
  roomCode: '',
  shareUrl: '',
  pingMs: 0,
  playerCount: 1,
  error: null,
};

function readRoomCodeFromUrl(): string {
  try {
    const raw = new URLSearchParams(window.location.search).get('sala');
    return raw ? formatRoomCode(raw) : '';
  } catch {
    return '';
  }
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);

  const [initialRoomCode] = useState<string>(() => readRoomCodeFromUrl());
  const [activeModal, setActiveModal] = useState<ActiveModal>(() =>
    readRoomCodeFromUrl() ? 'online' : 'none',
  );
  const [appearance, setAppearance] = useState<CharacterAppearance>(() => loadActiveAppearance());
  const [netStatus, setNetStatus] = useState<NetStatusInfo>(INITIAL_NET_STATUS);

  const [telemetry, setTelemetry] = useState<HudTelemetry>(() => ({
    ...INITIAL_TELEMETRY,
    playerName: loadActiveAppearance().nome,
  }));
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [controlsExpanded, setControlsExpanded] = useState(true);
  const [muted, setMuted] = useState(false);
  const [isSoftwareGl, setIsSoftwareGl] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const sceneRenderer = new SceneRenderer(container, {
      onHudUpdate: (data) => setTelemetry(data),
      onPointerLockChange: (locked) => setIsPointerLocked(locked),
      onToggleDebug: () => setShowDebug((prev) => !prev),
      onToggleControlsDock: () => setControlsExpanded((prev) => !prev),
      onToggleMenu: () =>
        setActiveModal((prev) => (prev === 'none' ? 'creator' : 'none')),
      onNetStatusChange: (status) => setNetStatus(status),
      onContextLost: () => setContextLost(true),
      onContextRestored: () => setContextLost(false),
    });

    rendererRef.current = sceneRenderer;
    setIsSoftwareGl(sceneRenderer.isSoftwareGl);
    setAppearance(sceneRenderer.getLocalAppearance());
    setNetStatus(sceneRenderer.getNetStatus());
    sceneRenderer.setPaused(readRoomCodeFromUrl() !== '');
    sceneRenderer.start();

    return () => {
      sceneRenderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Pausa captura de teclado/mouse do jogo enquanto qualquer modal estiver aberto
  useEffect(() => {
    rendererRef.current?.setPaused(activeModal !== 'none');
  }, [activeModal]);

  const handleEnterMouseLook = useCallback(() => {
    rendererRef.current?.requestPointerLock();
  }, []);

  const handleToggleControls = useCallback(() => {
    setControlsExpanded((prev) => !prev);
  }, []);

  const handleToggleDebug = useCallback(() => {
    setShowDebug((prev) => !prev);
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      rendererRef.current?.audio.setMuted(next);
      return next;
    });
  }, []);

  const handleResetCamera = useCallback(() => {
    rendererRef.current?.resetCamera();
  }, []);

  const handleRespawnPlaza = useCallback(() => {
    rendererRef.current?.respawnAtPlaza();
  }, []);

  const handleApplyAppearance = useCallback((next: CharacterAppearance) => {
    setAppearance(next);
    rendererRef.current?.applyLocalAppearance(next);
  }, []);

  const handleHostRoom = useCallback(() => {
    rendererRef.current?.hostRoom();
  }, []);

  const handleJoinRoom = useCallback((code: string) => {
    rendererRef.current?.joinRoom(code);
  }, []);

  const handleConnectWs = useCallback((url: string) => {
    rendererRef.current?.connectWebSocket(url);
  }, []);

  const handleLeaveRoom = useCallback(() => {
    rendererRef.current?.leaveRoom();
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-950">
      {/* Container isolado para o canvas WebGL — nunca desmontado por updates do HUD */}
      <div
        ref={canvasMountRef}
        className="h-full w-full cursor-crosshair"
        aria-label="Viewport 3D Aether Fighters"
      />

      {/* Fallback seguro caso o contexto WebGL seja perdido */}
      {contextLost && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/92 p-6 text-center">
          <div className="max-w-md rounded-lg border border-white/15 bg-slate-900 p-6">
            <h2 className="font-display text-lg font-bold text-white">
              Contexto WebGL interrompido
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Aguardando restauração da GPU para retomar a arena 3D de Aether Fighters.
            </p>
          </div>
        </div>
      )}

      {/* HUD semântico sobreposto */}
      <HUD
        telemetry={telemetry}
        isPointerLocked={isPointerLocked}
        showDebug={showDebug}
        controlsExpanded={controlsExpanded}
        muted={muted}
        isSoftwareGl={isSoftwareGl}
        modalOpen={activeModal !== 'none'}
        onEnterMouseLook={handleEnterMouseLook}
        onToggleControls={handleToggleControls}
        onToggleDebug={handleToggleDebug}
        onToggleMute={handleToggleMute}
        onResetCamera={handleResetCamera}
        onRespawnPlaza={handleRespawnPlaza}
        onOpenOnline={() => setActiveModal('online')}
        onOpenCreator={() => setActiveModal('creator')}
      />

      {/* Modal de Personalização do Guerreiro (Preview 3D + 3 Presets) */}
      {activeModal === 'creator' && (
        <CharacterCreator
          initialAppearance={appearance}
          onApply={handleApplyAppearance}
          onClose={() => setActiveModal('none')}
        />
      )}

      {/* Modal de Multiplayer Online (Vercel P2P + WebSocket/ZeroTier) */}
      {activeModal === 'online' && (
        <OnlineLobby
          netStatus={netStatus}
          scoreboard={telemetry.scoreboard}
          initialRoomCode={initialRoomCode}
          onHostRoom={handleHostRoom}
          onJoinRoom={handleJoinRoom}
          onConnectWs={handleConnectWs}
          onLeaveRoom={handleLeaveRoom}
          onOpenCreator={() => setActiveModal('creator')}
          onClose={() => setActiveModal('none')}
        />
      )}
    </main>
  );
}
