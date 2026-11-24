import {
  AccessoryType,
  CharacterAppearance,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
} from '../entities/Player';

const ACTIVE_KEY = 'aether_fighters_active_appearance_v1';
const SLOTS_KEY = 'aether_fighters_preset_slots_v1';

export const HAIR_STYLE_NAMES = [
  'Careca',
  'Espetado',
  'Longo',
  'Rabo de Cavalo',
  'Moicano',
] as const;

export const AURA_STYLE_NAMES = ['Brilho', 'Chama', 'Relâmpago'] as const;

export const SKIN_PALETTE = [
  '#f8d9c4',
  '#e5b898',
  '#d29972',
  '#a96f49',
  '#74462c',
  '#4c2c1d',
  '#9ec5d6', // tom alienígena/etéreo opcional
] as const;

export const STARTER_PRESETS: readonly CharacterAppearance[] = [
  DEFAULT_APPEARANCE,
  normalizeAppearance({
    nome: 'Ryuji Tempest',
    altura: 1.06,
    porte: 0.72,
    pele: '#d29972',
    cabelo: { estilo: 2, cor: '#e2e8f0' },
    roupa: {
      cima: '#1d4ed8',
      baixo: '#0f172a',
      botas: '#1e293b',
      luvas: '#f59e0b',
      detalhes: '#f59e0b',
      acessorio: 'capa',
      corAcessorio: '#1e3a8a',
    },
    aura: { estilo: 2, cor: '#facc15' },
    ki: '#f59e0b',
  }),
  normalizeAppearance({
    nome: 'Sora Crimson',
    altura: 0.96,
    porte: 0.42,
    pele: '#f8d9c4',
    cabelo: { estilo: 3, cor: '#450a0a' },
    roupa: {
      cima: '#dc2626',
      baixo: '#18181b',
      botas: '#27272a',
      luvas: '#dc2626',
      detalhes: '#fde047',
      acessorio: 'cachecol',
      corAcessorio: '#f43f5e',
    },
    aura: { estilo: 1, cor: '#f43f5e' },
    ki: '#fb7185',
  }),
];

export function loadActiveAppearance(): CharacterAppearance {
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY);
    if (!raw) return normalizeAppearance(DEFAULT_APPEARANCE);
    return normalizeAppearance(JSON.parse(raw) as Partial<CharacterAppearance>);
  } catch {
    return normalizeAppearance(DEFAULT_APPEARANCE);
  }
}

export function saveActiveAppearance(appearance: CharacterAppearance): void {
  try {
    window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(normalizeAppearance(appearance)));
  } catch {
    // Ignora quota/privacidade do navegador
  }
}

export function loadPresetSlots(): [
  CharacterAppearance,
  CharacterAppearance,
  CharacterAppearance,
] {
  try {
    const raw = window.localStorage.getItem(SLOTS_KEY);
    if (!raw) {
      return [
        normalizeAppearance(STARTER_PRESETS[0]),
        normalizeAppearance(STARTER_PRESETS[1]),
        normalizeAppearance(STARTER_PRESETS[2]),
      ];
    }
    const parsed = JSON.parse(raw) as Array<Partial<CharacterAppearance>>;
    return [
      normalizeAppearance(parsed[0] ?? STARTER_PRESETS[0]),
      normalizeAppearance(parsed[1] ?? STARTER_PRESETS[1]),
      normalizeAppearance(parsed[2] ?? STARTER_PRESETS[2]),
    ];
  } catch {
    return [
      normalizeAppearance(STARTER_PRESETS[0]),
      normalizeAppearance(STARTER_PRESETS[1]),
      normalizeAppearance(STARTER_PRESETS[2]),
    ];
  }
}

export function savePresetSlot(index: 0 | 1 | 2, appearance: CharacterAppearance): void {
  const slots = loadPresetSlots();
  slots[index] = normalizeAppearance(appearance);
  try {
    window.localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
  } catch {
    // Ignora falha de localStorage
  }
}

const RANDOM_NAMES = [
  'Kael Vance',
  'Akira Solis',
  'Ren Kurogane',
  'Mina Vex',
  'Dante Aether',
  'Yuki Storm',
  'Zane Kurosawa',
  'Hana Nova',
];

const RANDOM_TOP_COLORS = ['#f97316', '#2563eb', '#dc2626', '#10b981', '#eab308', '#f8fafc', '#18181b'];
const RANDOM_DARK_COLORS = ['#0f172a', '#1e293b', '#18181b', '#27272a', '#312e81', '#3f3f46'];
const RANDOM_HAIR_COLORS = ['#111827', '#f8fafc', '#991b1b', '#1d4ed8', '#eab308', '#581c87', '#7c2d12'];
const RANDOM_KI_COLORS = ['#38bdf8', '#facc15', '#f97316', '#f43f5e', '#34d399', '#a78bfa', '#22d3ee'];
const ACCESSORIES: AccessoryType[] = ['nenhum', 'cachecol', 'capa'];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomizeAppearance(keepName?: string): CharacterAppearance {
  const ki = pick(RANDOM_KI_COLORS);
  const top = pick(RANDOM_TOP_COLORS);
  return normalizeAppearance({
    nome: keepName && keepName.trim().length > 0 ? keepName : pick(RANDOM_NAMES),
    altura: Number((0.9 + Math.random() * 0.24).toFixed(2)),
    porte: Number((0.2 + Math.random() * 0.75).toFixed(2)),
    pele: pick(SKIN_PALETTE.slice(0, 6)),
    cabelo: {
      estilo: Math.floor(Math.random() * HAIR_STYLE_NAMES.length),
      cor: pick(RANDOM_HAIR_COLORS),
    },
    roupa: {
      cima: top,
      baixo: pick(RANDOM_DARK_COLORS),
      botas: pick(RANDOM_DARK_COLORS),
      luvas: Math.random() > 0.5 ? top : pick(RANDOM_DARK_COLORS),
      detalhes: ki,
      acessorio: pick(ACCESSORIES),
      corAcessorio: Math.random() > 0.5 ? ki : top,
    },
    aura: {
      estilo: Math.floor(Math.random() * AURA_STYLE_NAMES.length),
      cor: ki,
    },
    ki,
  });
}
