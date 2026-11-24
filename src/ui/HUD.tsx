import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Globe,
  RotateCcw,
  Terminal,
  User,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { TELEPORT_KI_COST } from '../combat/Skills';
import { HudTelemetry } from '../core/Game';
import { FighterState } from '../entities/Fighter';

interface HUDProps {
  telemetry: HudTelemetry;
  isPointerLocked: boolean;
  showDebug: boolean;
  controlsExpanded: boolean;
  muted: boolean;
  isSoftwareGl: boolean;
  modalOpen: boolean;
  onEnterMouseLook: () => void;
  onToggleControls: () => void;
  onToggleDebug: () => void;
  onToggleMute: () => void;
  onResetCamera: () => void;
  onRespawnPlaza: () => void;
  onOpenOnline: () => void;
  onOpenCreator: () => void;
}

const STATE_LABELS: Record<FighterState, string> = {
  [FighterState.GROUNDED]: 'Solo',
  [FighterState.FLYING]: 'Voo Livre',
  [FighterState.DASHING]: 'Esquiva',
  [FighterState.ATTACKING]: 'Ataque',
  [FighterState.CHARGING]: 'Carregando Ki',
  [FighterState.STUNNED]: 'Atordoado',
  [FighterState.KNOCKBACK]: 'Impulso',
  [FighterState.TELEPORTING]: 'Teleporte',
  [FighterState.DEAD]: 'Nocauteado',
};

export const HUD: React.FC<HUDProps> = ({
  telemetry,
  isPointerLocked,
  showDebug,
  controlsExpanded,
  muted,
  isSoftwareGl,
  modalOpen,
  onEnterMouseLook,
  onToggleControls,
  onToggleDebug,
  onToggleMute,
  onResetCamera,
  onRespawnPlaza,
  onOpenOnline,
  onOpenCreator,
}) => {
  const hpPct = Math.max(0, Math.min(100, (telemetry.hp / telemetry.maxHp) * 100));
  const kiPct = Math.max(0, Math.min(100, (telemetry.ki / telemetry.maxKi) * 100));
  const staminaPct = Math.max(0, Math.min(100, (telemetry.stamina / telemetry.maxStamina) * 100));

  const modeLabel = telemetry.isBlocking
    ? 'Defendendo'
    : telemetry.isBoosting
      ? 'Boost Aéreo'
      : STATE_LABELS[telemetry.state] ?? telemetry.state;

  const lock = telemetry.lock;
  const lockHpPct = lock ? Math.max(0, Math.min(100, (lock.hp / lock.maxHp) * 100)) : 0;

  const tpOnCd = telemetry.teleportCooldown > 0;
  const tpCdRatio =
    tpOnCd && telemetry.teleportCooldownMax > 0
      ? Math.min(1, telemetry.teleportCooldown / telemetry.teleportCooldownMax)
      : 0;
  const tpAffordable = telemetry.ki >= TELEPORT_KI_COST;

  const isOnline = telemetry.netMode === 'hosting' || telemetry.netMode === 'connected';

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4 sm:p-5">
      {/* Vinheta vermelha ao tomar dano */}
      {telemetry.hurt > 0.01 && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0"
          style={{
            opacity: telemetry.hurt * 0.72,
            boxShadow: 'inset 0 0 110px 32px rgba(239, 68, 68, 0.85)',
          }}
        />
      )}

      {/* Nameplates 3D->2D sobre jogadores remotos conectados */}
      {telemetry.remoteLabels.map((rl) => {
        if (!rl.onScreen || rl.dead) return null;
        const rHpPct = Math.max(0, Math.min(100, (rl.hp / rl.maxHp) * 100));
        return (
          <div
            key={rl.id}
            aria-hidden="true"
            className="pointer-events-none fixed z-10 -translate-x-1/2 -translate-y-full"
            style={{ left: `${rl.screenX}%`, top: `${rl.screenY}%` }}
          >
            <div className="rounded border border-white/15 bg-slate-950/82 px-2 py-1 text-center shadow">
              <div className="flex items-center justify-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-white">
                <span>{rl.nome}</span>
                <span className="font-mono-num text-[10px] text-slate-400">{rl.dist}m</span>
              </div>
              <div className="mt-0.5 h-1 w-20 overflow-hidden rounded-xs bg-slate-800">
                <div className="h-full bg-rose-500" style={{ width: `${rHpPct}%` }} />
              </div>
            </div>
          </div>
        );
      })}

      {/* Mira de lock-on projetada sobre o alvo na tela */}
      {lock && lock.onScreen && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${lock.screenX}%`, top: `${lock.screenY}%` }}
        >
          <div className="h-8 w-8 rotate-45 border-2 border-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.65)]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-1.5 w-1.5 bg-white" />
          </div>
        </div>
      )}

      {/* Marcador de acerto (X no centro da tela) */}
      {telemetry.hitMarker && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
        >
          <svg width="26" height="26" viewBox="0 0 26 26" className="text-white drop-shadow">
            <line x1="4" y1="4" x2="10" y2="10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <line x1="22" y1="4" x2="16" y2="10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <line x1="4" y1="22" x2="10" y2="16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <line x1="22" y1="22" x2="16" y2="16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {/* Callouts de Fase 3: Golpe pelas Costas (+35%) e Clash */}
      {(telemetry.backstabCallout || telemetry.clashCallout) && (
        <div className="pointer-events-none fixed left-1/2 top-[38%] z-20 flex -translate-x-1/2 flex-col items-center gap-1">
          {telemetry.clashCallout && (
            <div className="font-display text-2xl font-bold tracking-widest text-sky-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
              CLASH!
            </div>
          )}
          {telemetry.backstabCallout && (
            <div className="font-display text-lg font-bold tracking-wider text-amber-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
              PELAS COSTAS · +35%
            </div>
          )}
        </div>
      )}

      {/* Contador de combo à direita (a partir de 2 acertos) */}
      {telemetry.comboHits >= 2 && (
        <div
          aria-label="Contador de combo"
          className="pointer-events-none fixed right-6 top-1/2 z-10 -translate-y-1/2 text-right"
        >
          <div className="font-display font-mono-num text-5xl font-bold leading-none text-amber-400 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
            {telemetry.comboHits}
          </div>
          <div className="font-display text-sm font-bold tracking-wider text-white drop-shadow">
            HITS
          </div>
        </div>
      )}

      {/* Tela de nocaute */}
      {telemetry.dead && (
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-slate-950/60">
          <div className="rounded-lg border border-red-500/40 bg-slate-950/92 px-8 py-6 text-center shadow-2xl">
            <h2 className="font-display text-3xl font-bold tracking-wider text-red-400">
              NOCAUTEADO
            </h2>
            <p className="mt-2 font-mono-num text-sm text-slate-200">
              Renascendo em {telemetry.respawnIn.toFixed(1)} s
            </p>
          </div>
        </div>
      )}

      {/* Faixa superior: Status do Guerreiro (esq) · Alvo / Mira (centro) · Online / Personagem / Debug (dir) */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        {/* Status de Vida, Ki, Stamina e Placar */}
        <section
          aria-label="Status do guerreiro"
          className="w-72 sm:w-80 rounded-lg border border-white/12 bg-slate-950/84 px-4 py-3 text-slate-100 shadow-lg"
        >
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <h1 className="font-display text-base font-bold tracking-wide text-white whitespace-nowrap">
              AETHER FIGHTERS
            </h1>
            <span className="text-xs font-medium text-sky-300 whitespace-nowrap">
              {modeLabel}
            </span>
          </div>

          <div className="mb-2.5 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span className="truncate font-semibold text-slate-200">{telemetry.playerName}</span>
            <span className="font-mono-num text-slate-300 whitespace-nowrap">
              Abates {telemetry.kills} · Quedas {telemetry.deaths}
            </span>
          </div>

          {/* Barra de Vida (HP) */}
          <div className="mb-2">
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-300">
              <span>Vida</span>
              <span className="font-mono-num text-slate-100">
                {telemetry.hp} / {telemetry.maxHp}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-sm bg-slate-800/95">
              <div
                className={`h-full transition-[width] duration-75 ${
                  hpPct > 30 ? 'bg-emerald-500' : 'bg-red-500'
                }`}
                style={{ width: `${hpPct}%` }}
              />
            </div>
          </div>

          {/* Barra de Ki */}
          <div className="mb-2">
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-300">
              <span>Ki</span>
              <span className="font-mono-num text-sky-300">
                {Math.round(telemetry.ki)} / {telemetry.maxKi}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-sm bg-slate-800/95">
              <div
                className={`h-full transition-[width] duration-75 ${
                  telemetry.isBoosting
                    ? 'bg-amber-400'
                    : telemetry.isCharging
                      ? 'bg-cyan-300'
                      : 'bg-sky-400'
                }`}
                style={{ width: `${kiPct}%` }}
              />
            </div>
          </div>

          {/* Barra de Stamina */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-400">
              <span>Stamina</span>
              <span className="font-mono-num text-slate-300">
                {Math.round(telemetry.stamina)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-sm bg-slate-800/95">
              <div
                className="h-full bg-amber-500 transition-[width] duration-75"
                style={{ width: `${staminaPct}%` }}
              />
            </div>
          </div>
        </section>

        {/* Centro superior: Painel do alvo travado + botão de travar mouse */}
        <div className="flex flex-col items-center gap-2">
          {lock && (
            <section
              aria-label="Alvo travado"
              className="w-64 sm:w-72 rounded-lg border border-amber-400/35 bg-slate-950/86 px-4 py-2.5 shadow-lg"
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="font-display text-sm font-bold text-white truncate">
                  {lock.nome}
                </span>
                <span className="font-mono-num text-xs text-amber-300 whitespace-nowrap">
                  {lock.dist} m
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-sm bg-slate-800">
                <div
                  className="h-full bg-rose-500 transition-[width] duration-75"
                  style={{ width: `${lockHpPct}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] font-mono-num text-slate-400">
                <span>Alvo Travado</span>
                <span>
                  {lock.hp} / {lock.maxHp}
                </span>
              </div>
            </section>
          )}

          {!isPointerLocked && !modalOpen && (
            <div className="pointer-events-auto hidden md:flex items-center">
              <button
                type="button"
                onClick={onEnterMouseLook}
                className="flex items-center gap-2 rounded-lg border border-sky-400/35 bg-slate-950/85 px-4 py-1.5 text-xs font-semibold text-slate-100 transition-colors hover:border-sky-400 hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-sky-400 whitespace-nowrap"
              >
                <Crosshair className="h-3.5 w-3.5 text-sky-400" />
                <span>Travar Câmera no Mouse (ou clique/arraste)</span>
              </button>
            </div>
          )}
        </div>

        {/* Canto superior direito: Botões Online & Personagem + Placar da Sala + Debug F3 */}
        <div className="flex flex-col items-end gap-2">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenOnline}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                isOnline
                  ? 'border-emerald-400/45 bg-slate-950/90 text-emerald-300 hover:bg-slate-900'
                  : 'border-sky-400/35 bg-slate-950/85 text-slate-100 hover:border-sky-400 hover:bg-slate-900'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>
                {isOnline
                  ? `${telemetry.roomCode || 'Online'} (${telemetry.activeEntities}/8)`
                  : 'Online'}
              </span>
              {telemetry.netMode === 'connected' && telemetry.pingMs > 0 && (
                <span className="font-mono-num text-[10px] text-slate-400">
                  {telemetry.pingMs}ms
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenCreator}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-slate-950/85 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-colors hover:border-sky-400/50 hover:bg-slate-900 whitespace-nowrap"
            >
              <User className="h-3.5 w-3.5 text-sky-400" />
              <span>Personagem (Esc)</span>
            </button>
          </div>

          {/* Placar compacto quando houver mais jogadores na sala */}
          {telemetry.scoreboard.length > 1 && (
            <aside
              aria-label="Placar da sala"
              className="w-56 rounded-lg border border-white/12 bg-slate-950/82 px-3 py-2 text-[11px] text-slate-200"
            >
              <div className="mb-1 flex items-center justify-between border-b border-white/10 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <span>Sala {telemetry.roomCode}</span>
                <span>K / D</span>
              </div>
              <div className="space-y-0.5">
                {telemetry.scoreboard.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate ${
                        entry.isLocal ? 'font-semibold text-sky-300' : 'text-slate-200'
                      }`}
                    >
                      {entry.nome}
                    </span>
                    <span className="font-mono-num text-slate-300 whitespace-nowrap">
                      {entry.kills} / {entry.deaths}
                    </span>
                  </div>
                ))}
              </div>
            </aside>
          )}

          {/* Painel de Debug F3 */}
          {showDebug && (
            <aside
              aria-label="Diagnóstico F3"
              className="w-60 rounded-lg border border-white/12 bg-slate-950/86 px-3.5 py-2.5 text-xs text-slate-200 font-mono-num"
            >
              <div className="mb-1.5 flex items-center justify-between border-b border-white/10 pb-1 text-[11px] font-sans font-semibold text-sky-300">
                <span>Debug (F3)</span>
                <span>{isSoftwareGl ? 'Software WebGL' : 'GPU WebGL2'}</span>
              </div>
              <div className="space-y-0.5 text-[11px] leading-relaxed">
                <div className="flex justify-between">
                  <span className="text-slate-400">FPS</span>
                  <span className={telemetry.fps >= 55 ? 'text-emerald-400' : 'text-amber-400'}>
                    {telemetry.fps}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Sim Tick (60Hz)</span>
                  <span>{telemetry.tick}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Posição</span>
                  <span>
                    {telemetry.posX}, {telemetry.posY}, {telemetry.posZ}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Jogadores</span>
                  <span>{telemetry.activeEntities}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Projéteis ativos</span>
                  <span>{telemetry.activeProjectiles}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Rede</span>
                  <span>
                    {telemetry.netMode}
                    {telemetry.pingMs > 0 ? ` (${telemetry.pingMs}ms)` : ''}
                  </span>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Faixa inferior: Poderes + Teleporte (esq) · Dock retrátil (centro) · Velocímetro/Altitude (dir) */}
      <div className="relative z-10 flex items-end justify-between gap-4">
        {/* Barra de Poderes (1-4) + Slot de Teleporte (Q) */}
        <section
          aria-label="Poderes de Ki e Teleporte"
          className="flex flex-wrap items-end gap-2"
        >
          {/* Slot Q — Teleporte Instantâneo (Fase 3) */}
          <div
            className={`relative w-24 overflow-hidden rounded-lg border px-2.5 py-2 transition-opacity ${
              tpOnCd
                ? 'border-white/10 bg-slate-950/88 opacity-75'
                : !tpAffordable
                  ? 'border-white/10 bg-slate-950/75 opacity-50'
                  : 'border-amber-400/45 bg-slate-950/88'
            }`}
          >
            {tpOnCd && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-900/75"
                style={{ height: `${tpCdRatio * 100}%` }}
              />
            )}
            <div className="relative flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-0.5 font-display font-mono-num font-bold text-amber-300">
                <Zap className="h-3 w-3" />Q
              </span>
              <span
                className={`font-mono-num text-[10px] font-semibold ${
                  tpOnCd
                    ? 'text-amber-300'
                    : tpAffordable
                      ? 'text-slate-300'
                      : 'text-red-400'
                }`}
              >
                {tpOnCd ? `${telemetry.teleportCooldown.toFixed(1)}s` : `${TELEPORT_KI_COST} Ki`}
              </span>
            </div>
            <div className="relative mt-1 truncate text-[11px] font-semibold text-white">
              Teleporte
            </div>
          </div>

          {telemetry.skills.map((skill) => {
            const onCd = skill.cooldown > 0;
            const cdRatio =
              onCd && skill.cooldownMax > 0
                ? Math.min(1, skill.cooldown / skill.cooldownMax)
                : 0;
            const dimmed = !skill.affordable && !onCd;

            return (
              <div
                key={skill.slot}
                className={`relative w-26 overflow-hidden rounded-lg border px-2.5 py-2 transition-opacity ${
                  onCd
                    ? 'border-white/10 bg-slate-950/88 opacity-75'
                    : dimmed
                      ? 'border-white/10 bg-slate-950/75 opacity-50'
                      : 'border-sky-400/35 bg-slate-950/86'
                }`}
              >
                {onCd && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-900/75"
                    style={{ height: `${cdRatio * 100}%` }}
                  />
                )}

                <div className="relative flex items-center justify-between text-[11px]">
                  <span className="font-display font-mono-num font-bold text-sky-300">
                    {skill.slot}
                  </span>
                  <span
                    className={`font-mono-num text-[10px] font-semibold ${
                      onCd
                        ? 'text-amber-300'
                        : skill.affordable
                          ? 'text-slate-300'
                          : 'text-red-400'
                    }`}
                  >
                    {onCd ? `${skill.cooldown.toFixed(1)}s` : `${skill.custoKi} Ki`}
                  </span>
                </div>
                <div className="relative mt-1 truncate text-[11px] font-semibold text-white">
                  {skill.nome}
                </div>
              </div>
            );
          })}
        </section>

        {/* Dock de controles retrátil centralizado */}
        <div className="pointer-events-auto mx-auto hidden xl:flex flex-col items-center">
          <button
            type="button"
            onClick={onToggleControls}
            className="mb-1.5 flex items-center gap-1.5 rounded-md border border-white/12 bg-slate-950/82 px-3 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-white/25 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-400 whitespace-nowrap"
          >
            {controlsExpanded ? (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Ocultar Controles (H)</span>
              </>
            ) : (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span>Mostrar Controles (H)</span>
              </>
            )}
          </button>

          {controlsExpanded && (
            <div className="max-w-[540px] rounded-lg border border-white/12 bg-slate-950/85 px-4 py-2.5 shadow-lg">
              <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[11px] text-slate-300">
                <span>
                  <strong className="font-mono-num text-white">Esq / Dir</strong> Combo / Pesado
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span>
                  <strong className="font-mono-num text-white">Q</strong> Teleporte
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span>
                  <strong className="font-mono-num text-white">1–4</strong> Poderes
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span>
                  <strong className="font-mono-num text-white">Tab</strong> Lock-On
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span>
                  <strong className="font-mono-num text-white">E</strong> Defesa / Esquiva
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span>
                  <strong className="font-mono-num text-white">F</strong> Voar
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span>
                  <strong className="font-mono-num text-white">Shift</strong> Boost
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span>
                  <strong className="font-mono-num text-white">C</strong> Ki
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 border-t border-white/10 pt-2">
                <button
                  type="button"
                  onClick={onEnterMouseLook}
                  className="flex items-center gap-1.5 rounded-md bg-sky-500/20 px-2.5 py-1 text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/30 whitespace-nowrap"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  <span>{isPointerLocked ? 'Mouse Travado (Esc)' : 'Travar Mouse'}</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleMute}
                  className="flex items-center gap-1.5 rounded-md bg-slate-800/90 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap"
                >
                  {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  <span>{muted ? 'Mudo' : 'Áudio'}</span>
                </button>

                <button
                  type="button"
                  onClick={onResetCamera}
                  className="flex items-center gap-1.5 rounded-md bg-slate-800/90 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap"
                >
                  <Compass className="h-3.5 w-3.5" />
                  <span>Câmera</span>
                </button>

                <button
                  type="button"
                  onClick={onRespawnPlaza}
                  className="flex items-center gap-1.5 rounded-md bg-slate-800/90 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Praça</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleDebug}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    showDebug
                      ? 'bg-emerald-500/25 text-emerald-300'
                      : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <Terminal className="h-3.5 w-3.5" />
                  <span>F3</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Telemetria de voo (Velocidade e Altitude) no canto inferior direito */}
        <section
          aria-label="Telemetria de movimento"
          className="hidden sm:flex items-center gap-4 rounded-lg border border-white/12 bg-slate-950/84 px-4 py-2.5 text-right"
        >
          <div>
            <div className="text-[11px] font-medium text-slate-400">Velocidade</div>
            <div className="font-display font-mono-num text-xl font-bold leading-tight text-white">
              {telemetry.speedKmh}
              <span className="ml-1 text-xs font-medium text-slate-400">km/h</span>
            </div>
          </div>

          <div className="h-7 w-px bg-white/10" aria-hidden="true" />

          <div>
            <div className="text-[11px] font-medium text-slate-400">Altitude</div>
            <div className="font-display font-mono-num text-xl font-bold leading-tight text-sky-300">
              {telemetry.altitude}
              <span className="ml-1 text-xs font-medium text-slate-400">m</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
