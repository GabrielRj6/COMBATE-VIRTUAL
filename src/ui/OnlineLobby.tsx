import React, { useState } from 'react';
import {
  Check,
  Copy,
  Globe,
  Link2,
  LogOut,
  Radio,
  Server,
  User,
  Users,
  X,
} from 'lucide-react';
import type { ScoreboardEntry } from '../core/Game';
import type { NetStatusInfo } from '../net/Protocol';

interface OnlineLobbyProps {
  netStatus: NetStatusInfo;
  scoreboard: ScoreboardEntry[];
  initialRoomCode: string;
  onHostRoom: () => void;
  onJoinRoom: (code: string) => void;
  onConnectWs: (url: string) => void;
  onLeaveRoom: () => void;
  onOpenCreator: () => void;
  onClose: () => void;
}

export const OnlineLobby: React.FC<OnlineLobbyProps> = ({
  netStatus,
  scoreboard,
  initialRoomCode,
  onHostRoom,
  onJoinRoom,
  onConnectWs,
  onLeaveRoom,
  onOpenCreator,
  onClose,
}) => {
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [wsUrl, setWsUrl] = useState('ws://10.147.20.1:3000');
  const [tab, setTab] = useState<'p2p' | 'ws'>('p2p');
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);

  const isInRoom = netStatus.mode === 'hosting' || netStatus.mode === 'connected';
  const isConnecting = netStatus.mode === 'connecting';

  const copyText = (text: string, type: 'code' | 'link') => {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedType(type);
    window.setTimeout(() => setCopiedType(null), 1600);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Multiplayer Online"
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/82 p-4"
    >
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/15 bg-slate-950 text-slate-100 shadow-2xl">
        {/* Cabeçalho */}
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Globe className="h-4 w-4 text-sky-400" />
            <h2 className="font-display text-base font-bold tracking-wide text-white">
              MULTIPLAYER ONLINE
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela online"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-5 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Erro de conexão */}
          {netStatus.error && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/50 px-4 py-2.5 text-xs text-red-200">
              {netStatus.error}
            </div>
          )}

          {/* Estado ativo na sala */}
          {isInRoom ? (
            <section className="space-y-4 rounded-lg border border-sky-400/35 bg-slate-900/75 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                    {netStatus.mode === 'hosting'
                      ? 'Você é o Host da Sala (60Hz Autoritativo)'
                      : 'Conectado à Sala Online'}
                  </div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="font-display font-mono-num text-2xl font-bold text-white">
                      {netStatus.roomCode || 'SALA ATIVA'}
                    </span>
                    {netStatus.mode === 'connected' && netStatus.pingMs > 0 && (
                      <span className="font-mono-num text-xs text-emerald-300">
                        Ping {netStatus.pingMs} ms
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {netStatus.roomCode && netStatus.transport === 'p2p' && (
                    <>
                      <button
                        type="button"
                        onClick={() => copyText(netStatus.roomCode, 'code')}
                        className="flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700"
                      >
                        {copiedType === 'code' ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-sky-400" />
                        )}
                        <span>{copiedType === 'code' ? 'Código Copiado' : 'Copiar Código'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => copyText(netStatus.shareUrl, 'link')}
                        className="flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-sky-400"
                      >
                        {copiedType === 'link' ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Link2 className="h-3.5 w-3.5" />
                        )}
                        <span>{copiedType === 'link' ? 'Link Copiado!' : 'Copiar Link Convite'}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Lista de guerreiros na sala */}
              <div className="border-t border-white/10 pt-3">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <Users className="h-3.5 w-3.5 text-sky-400" />
                    Guerreiros na Arena ({scoreboard.length} / 8)
                  </span>
                  <span>Abates / Quedas</span>
                </div>

                <div className="space-y-1.5">
                  {scoreboard.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-md bg-slate-950/80 px-3 py-2 text-xs"
                    >
                      <span className="font-semibold text-white">
                        {entry.nome}
                        {entry.isLocal && (
                          <span className="ml-2 text-[11px] font-normal text-sky-400">(Você)</span>
                        )}
                      </span>
                      <span className="font-mono-num text-slate-300">
                        {entry.kills} / {entry.deaths}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={onLeaveRoom}
                  className="flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-950/50 px-3.5 py-2 text-xs font-semibold text-red-200 hover:bg-red-900/60"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Sair da Sala</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md bg-emerald-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                >
                  Voltar para a Luta
                </button>
              </div>
            </section>
          ) : (
            <>
              {/* Abas: Sala Online Vercel P2P vs WebSocket / ZeroTier */}
              <div className="flex gap-2 border-b border-white/10 pb-3">
                <button
                  type="button"
                  onClick={() => setTab('p2p')}
                  className={`flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-xs font-semibold transition-colors ${
                    tab === 'p2p'
                      ? 'border-sky-400 bg-sky-500/20 text-white'
                      : 'border-white/12 bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  <Radio className="h-3.5 w-3.5 text-sky-400" />
                  <span>Sala Online (Vercel P2P · Sem Servidor)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('ws')}
                  className={`flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-xs font-semibold transition-colors ${
                    tab === 'ws'
                      ? 'border-sky-400 bg-sky-500/20 text-white'
                      : 'border-white/12 bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  <Server className="h-3.5 w-3.5 text-amber-400" />
                  <span>WebSocket / ZeroTier</span>
                </button>
              </div>

              {tab === 'p2p' ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Card Criar Sala */}
                  <div className="flex flex-col justify-between rounded-lg border border-white/12 bg-slate-900/75 p-4">
                    <div>
                      <h3 className="font-display text-sm font-bold text-white">Criar Nova Sala</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                        Funciona direto na Vercel sem backend. Gera um código{' '}
                        <strong className="font-mono-num text-slate-200">AF-XXXX</strong> e link de
                        convite para até 8 jogadores.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isConnecting}
                      onClick={onHostRoom}
                      className="mt-4 w-full rounded-md bg-sky-500 py-2.5 text-xs font-bold text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-50"
                    >
                      {isConnecting ? 'Abrindo Sala...' : 'Criar Sala Online'}
                    </button>
                  </div>

                  {/* Card Entrar por Código */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      onJoinRoom(joinCode);
                    }}
                    className="flex flex-col justify-between rounded-lg border border-white/12 bg-slate-900/75 p-4"
                  >
                    <div>
                      <h3 className="font-display text-sm font-bold text-white">
                        Entrar em Sala Existente
                      </h3>
                      <p className="mt-1.5 text-xs text-slate-400">
                        Digite o código enviado pelo seu amigo (ex.: AF-7K2P).
                      </p>
                      <input
                        type="text"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                        placeholder="AF-XXXX"
                        maxLength={9}
                        className="mt-3 w-full rounded-md border border-white/15 bg-slate-950 px-3 py-2 font-mono-num text-sm font-bold tracking-wider text-white uppercase outline-none focus:border-sky-400"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isConnecting || !joinCode.trim()}
                      className="mt-4 w-full rounded-md border border-sky-400/45 bg-sky-500/20 py-2.5 text-xs font-bold text-sky-200 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
                    >
                      {isConnecting ? 'Conectando...' : 'Entrar na Sala'}
                    </button>
                  </form>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onConnectWs(wsUrl);
                  }}
                  className="rounded-lg border border-white/12 bg-slate-900/75 p-4 space-y-3"
                >
                  <h3 className="font-display text-sm font-bold text-white">
                    Conectar via WebSocket / ZeroTier LAN
                  </h3>
                  <p className="text-xs text-slate-400">
                    Para servidores dedicados ou partidas em rede privada ZeroTier usando o mesmo
                    protocolo de snapshots.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={wsUrl}
                      onChange={(e) => setWsUrl(e.target.value)}
                      placeholder="ws://10.147.20.1:3000"
                      className="flex-1 rounded-md border border-white/15 bg-slate-950 px-3 py-2 font-mono-num text-xs text-white outline-none focus:border-sky-400"
                    />
                    <button
                      type="submit"
                      disabled={isConnecting}
                      className="rounded-md bg-amber-400 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50"
                    >
                      {isConnecting ? 'Conectando...' : 'Conectar'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {/* Atalho rápido para personalização + modo solo */}
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={onOpenCreator}
              className="flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-sky-400/50 hover:text-white"
            >
              <User className="h-3.5 w-3.5 text-sky-400" />
              <span>Personalizar Guerreiro</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-white/15 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              Treino Livre na Arena
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
};
