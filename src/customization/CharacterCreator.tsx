import React, { useState } from 'react';
import { Flame, Save, Shuffle, Sparkles, User, X } from 'lucide-react';
import { AccessoryType, CharacterAppearance, normalizeAppearance } from '../entities/Player';
import { CharacterPreview3D } from './CharacterPreview3D';
import {
  AURA_STYLE_NAMES,
  HAIR_STYLE_NAMES,
  loadPresetSlots,
  randomizeAppearance,
  savePresetSlot,
  SKIN_PALETTE,
} from './Presets';

interface CharacterCreatorProps {
  initialAppearance: CharacterAppearance;
  onApply: (appearance: CharacterAppearance) => void;
  onClose: () => void;
}

type CreatorTab = 'corpo' | 'roupas' | 'aura' | 'presets';

const ACCESSORY_OPTIONS: ReadonlyArray<{ id: AccessoryType; label: string }> = [
  { id: 'nenhum', label: 'Nenhum' },
  { id: 'cachecol', label: 'Cachecol' },
  { id: 'capa', label: 'Capa' },
];

export const CharacterCreator: React.FC<CharacterCreatorProps> = ({
  initialAppearance,
  onApply,
  onClose,
}) => {
  const [draft, setDraft] = useState<CharacterAppearance>(() =>
    normalizeAppearance(initialAppearance),
  );
  const [tab, setTab] = useState<CreatorTab>('corpo');
  const [showAuraPreview, setShowAuraPreview] = useState(true);
  const [slots, setSlots] = useState<[CharacterAppearance, CharacterAppearance, CharacterAppearance]>(() =>
    loadPresetSlots(),
  );
  const [savedSlotNotice, setSavedSlotNotice] = useState<number | null>(null);

  const updateRoupa = <K extends keyof CharacterAppearance['roupa']>(
    key: K,
    value: CharacterAppearance['roupa'][K],
  ) => {
    setDraft((prev) => ({
      ...prev,
      roupa: { ...prev.roupa, [key]: value },
    }));
  };

  const handleRandomize = () => {
    setDraft((prev) => randomizeAppearance(prev.nome));
  };

  const handleSaveSlot = (index: 0 | 1 | 2) => {
    const clean = normalizeAppearance(draft);
    savePresetSlot(index, clean);
    setSlots(loadPresetSlots());
    setSavedSlotNotice(index);
    window.setTimeout(() => setSavedSlotNotice(null), 1500);
  };

  const handleLoadSlot = (index: 0 | 1 | 2) => {
    setDraft(normalizeAppearance(slots[index]));
  };

  const handleConfirm = () => {
    onApply(normalizeAppearance(draft));
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Personalização do Guerreiro"
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/82 p-4"
    >
      <div className="flex h-[min(88vh,680px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-white/15 bg-slate-950 text-slate-100 shadow-2xl">
        {/* Cabeçalho */}
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <User className="h-4 w-4 text-sky-400" />
            <h2 className="font-display text-base font-bold tracking-wide text-white">
              PERSONALIZAR GUERREIRO
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar personalização"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Corpo: Preview 3D (esq) + Opções em abas (dir) */}
        <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-12">
          {/* Coluna 3D */}
          <div className="relative flex flex-col border-b border-white/10 bg-[#090f1e] md:col-span-5 md:border-b-0 md:border-r">
            <div className="relative flex-1 min-h-[240px]">
              <CharacterPreview3D appearance={draft} showAura={showAuraPreview} />
              <div className="pointer-events-none absolute left-3 top-3 text-[11px] font-medium text-slate-400">
                Arraste para girar
              </div>
              <button
                type="button"
                onClick={() => setShowAuraPreview((v) => !v)}
                className={`absolute right-3 top-3 flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  showAuraPreview
                    ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                    : 'border-white/15 bg-slate-900/90 text-slate-300 hover:text-white'
                }`}
              >
                <Flame className="h-3.5 w-3.5" />
                <span>{showAuraPreview ? 'Aura Ligada' : 'Ver Aura'}</span>
              </button>
            </div>

            {/* Nome + Aleatório */}
            <div className="border-t border-white/10 bg-slate-950/90 p-3.5 space-y-2.5">
              <div>
                <label
                  htmlFor="fighter-name"
                  className="mb-1 block text-[11px] font-medium text-slate-400"
                >
                  Nome do Guerreiro (exibido no HUD e acima do personagem online)
                </label>
                <input
                  id="fighter-name"
                  type="text"
                  maxLength={20}
                  value={draft.nome}
                  onChange={(e) => setDraft((p) => ({ ...p, nome: e.target.value }))}
                  placeholder="Seu nome na arena"
                  className="w-full rounded-md border border-white/15 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus:border-sky-400"
                />
              </div>

              <button
                type="button"
                onClick={handleRandomize}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-slate-900 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-sky-400/50 hover:bg-slate-800 hover:text-white"
              >
                <Shuffle className="h-3.5 w-3.5 text-sky-400" />
                <span>Gerar Visual Aleatório</span>
              </button>
            </div>
          </div>

          {/* Coluna de Controles */}
          <div className="flex flex-col overflow-hidden md:col-span-7">
            {/* Abas */}
            <nav className="flex border-b border-white/10 bg-slate-900/50 px-3 pt-2">
              {(
                [
                  ['corpo', 'Corpo & Cabelo'],
                  ['roupas', 'Roupas'],
                  ['aura', 'Aura & Ki'],
                  ['presets', 'Presets (3)'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`border-b-2 px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                    tab === id
                      ? 'border-sky-400 text-sky-300'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            {/* Conteúdo rolável da aba */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {tab === 'corpo' && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <div className="mb-1.5 flex justify-between text-xs">
                        <span className="text-slate-300">Altura</span>
                        <span className="font-mono-num text-sky-300">
                          {Math.round(draft.altura * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.85}
                        max={1.2}
                        step={0.01}
                        value={draft.altura}
                        onChange={(e) =>
                          setDraft((p) => ({ ...p, altura: parseFloat(e.target.value) }))
                        }
                        className="w-full accent-sky-400"
                      />
                    </div>

                    <div>
                      <div className="mb-1.5 flex justify-between text-xs">
                        <span className="text-slate-300">Porte Físico</span>
                        <span className="font-mono-num text-sky-300">
                          {draft.porte < 0.35
                            ? 'Ágil'
                            : draft.porte > 0.7
                              ? 'Robusto'
                              : 'Atlético'}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={draft.porte}
                        onChange={(e) =>
                          setDraft((p) => ({ ...p, porte: parseFloat(e.target.value) }))
                        }
                        className="w-full accent-sky-400"
                      />
                    </div>
                  </div>

                  {/* Tom de pele */}
                  <div>
                    <div className="mb-2 text-xs font-medium text-slate-300">Tom de Pele</div>
                    <div className="flex flex-wrap items-center gap-2">
                      {SKIN_PALETTE.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => setDraft((p) => ({ ...p, pele: hex }))}
                          aria-label={`Cor de pele ${hex}`}
                          className={`h-8 w-8 rounded-md border-2 transition-transform hover:scale-105 ${
                            draft.pele.toLowerCase() === hex.toLowerCase()
                              ? 'border-sky-400 ring-2 ring-sky-400/40'
                              : 'border-white/20'
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                      <label className="ml-1 flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 cursor-pointer">
                        <span>Outro</span>
                        <input
                          type="color"
                          value={draft.pele}
                          onChange={(e) => setDraft((p) => ({ ...p, pele: e.target.value }))}
                          className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Estilo de cabelo */}
                  <div>
                    <div className="mb-2 text-xs font-medium text-slate-300">
                      Estilo de Cabelo (5 estilos)
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {HAIR_STYLE_NAMES.map((name, idx) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() =>
                            setDraft((p) => ({
                              ...p,
                              cabelo: { ...p.cabelo, estilo: idx },
                            }))
                          }
                          className={`rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
                            draft.cabelo.estilo === idx
                              ? 'border-sky-400 bg-sky-500/20 text-white'
                              : 'border-white/12 bg-slate-900 text-slate-300 hover:border-white/25 hover:text-white'
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <ColorField
                    label="Cor do Cabelo"
                    value={draft.cabelo.cor}
                    onChange={(cor) =>
                      setDraft((p) => ({ ...p, cabelo: { ...p.cabelo, cor } }))
                    }
                  />
                </>
              )}

              {tab === 'roupas' && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ColorField
                      label="Peitoral / Gi (Parte de Cima)"
                      value={draft.roupa.cima}
                      onChange={(v) => updateRoupa('cima', v)}
                    />
                    <ColorField
                      label="Calça (Parte de Baixo)"
                      value={draft.roupa.baixo}
                      onChange={(v) => updateRoupa('baixo', v)}
                    />
                    <ColorField
                      label="Botas e Armadura"
                      value={draft.roupa.botas}
                      onChange={(v) => updateRoupa('botas', v)}
                    />
                    <ColorField
                      label="Luvas / Manoplas"
                      value={draft.roupa.luvas}
                      onChange={(v) => updateRoupa('luvas', v)}
                    />
                    <ColorField
                      label="Visor e Emblema Luminoso"
                      value={draft.roupa.detalhes}
                      onChange={(v) => updateRoupa('detalhes', v)}
                    />
                    <ColorField
                      label="Cor do Acessório"
                      value={draft.roupa.corAcessorio}
                      onChange={(v) => updateRoupa('corAcessorio', v)}
                    />
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-medium text-slate-300">Acessório Dorsal</div>
                    <div className="grid grid-cols-3 gap-2">
                      {ACCESSORY_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateRoupa('acessorio', opt.id)}
                          className={`rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
                            draft.roupa.acessorio === opt.id
                              ? 'border-sky-400 bg-sky-500/20 text-white'
                              : 'border-white/12 bg-slate-900 text-slate-300 hover:border-white/25 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {tab === 'aura' && (
                <>
                  <div>
                    <div className="mb-2 text-xs font-medium text-slate-300">
                      Estilo da Aura (3 estilos)
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {AURA_STYLE_NAMES.map((name, idx) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => {
                            setShowAuraPreview(true);
                            setDraft((p) => ({
                              ...p,
                              aura: { ...p.aura, estilo: idx },
                            }));
                          }}
                          className={`flex items-center justify-center gap-1.5 rounded-md border px-3 py-2.5 text-xs font-semibold transition-colors ${
                            draft.aura.estilo === idx
                              ? 'border-sky-400 bg-sky-500/20 text-white'
                              : 'border-white/12 bg-slate-900 text-slate-300 hover:border-white/25 hover:text-white'
                          }`}
                        >
                          <Sparkles className="h-3.5 w-3.5 text-sky-400" />
                          <span>{name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <ColorField
                      label="Cor da Aura"
                      value={draft.aura.cor}
                      onChange={(cor) => {
                        setShowAuraPreview(true);
                        setDraft((p) => ({ ...p, aura: { ...p.aura, cor } }));
                      }}
                    />
                    <ColorField
                      label="Cor dos Poderes de Ki e Teleporte"
                      value={draft.ki}
                      onChange={(ki) => {
                        setShowAuraPreview(true);
                        setDraft((p) => ({ ...p, ki }));
                      }}
                    />
                  </div>

                  <div className="rounded-lg border border-white/10 bg-slate-900/60 p-3 text-xs text-slate-400">
                    A cor de Ki define o brilho dos seus ataques energéticos, barreira de defesa e
                    pós-imagens do Teleporte (Q).
                  </div>
                </>
              )}

              {tab === 'presets' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    Salve até 3 configurações no navegador para trocar rapidamente antes ou durante
                    partidas online.
                  </p>
                  {([0, 1, 2] as const).map((idx) => {
                    const slot = slots[idx];
                    return (
                      <div
                        key={idx}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/12 bg-slate-900/80 px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="h-8 w-8 rounded-md border border-white/20"
                            style={{
                              background: `linear-gradient(135deg, ${slot.roupa.cima} 50%, ${slot.ki} 50%)`,
                            }}
                          />
                          <div>
                            <div className="text-xs font-bold text-white">
                              Slot {idx + 1} · {slot.nome}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {HAIR_STYLE_NAMES[slot.cabelo.estilo]} · Aura{' '}
                              {AURA_STYLE_NAMES[slot.aura.estilo]}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleLoadSlot(idx)}
                            className="rounded-md border border-sky-400/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/25"
                          >
                            Carregar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveSlot(idx)}
                            className="flex items-center gap-1 rounded-md border border-white/15 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700"
                          >
                            <Save className="h-3.5 w-3.5" />
                            <span>{savedSlotNotice === idx ? 'Salvo!' : 'Salvar Atual'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Rodapé de confirmação */}
            <footer className="flex items-center justify-end gap-2.5 border-t border-white/10 bg-slate-950 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-white/15 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="rounded-md bg-sky-500 px-5 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-sky-400"
              >
                Aplicar na Arena
              </button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

const ColorField: React.FC<ColorFieldProps> = ({ label, value, onChange }) => (
  <label className="flex items-center justify-between gap-3 rounded-md border border-white/12 bg-slate-900/80 px-3 py-2 cursor-pointer hover:border-white/25">
    <span className="text-xs font-medium text-slate-200">{label}</span>
    <div className="flex items-center gap-2">
      <span className="font-mono-num text-[11px] uppercase text-slate-400">{value}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
      />
    </div>
  </label>
);
