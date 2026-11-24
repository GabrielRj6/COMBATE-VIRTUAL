import { SeededRNG } from '../core/RNG';

/**
 * Caixa AABB estática usada na simulação para colisão com estruturas do mapa.
 * Sem dependência de Three.js para poder rodar idêntica no servidor Node (Fase 6).
 */
export interface WorldBoxCollider {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  width: number;
  height: number;
  depth: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  kind: 'tower' | 'building' | 'monolith' | 'arch';
  colorHex: number;
  accentHex: number;
}

export const WORLD_HALF_SIZE = 2000; // Mapa 4km x 4km
export const WORLD_SOFT_LIMIT = 1880;
export const WORLD_MAX_ALTITUDE = 820;

/**
 * Altura determinística do terreno em (x, z).
 * Centro plano (arena de treino + distrito urbano) e colinas/cânions suaves nas bordas naturais.
 */
export function groundHeightAt(x: number, z: number): number {
  const distFromCenter = Math.hypot(x, z);

  // Planície de combate/cidade central (raio ~260m perfeitamente nivelada para prédios)
  if (distFromCenter < 240) {
    return 0;
  }

  // Transição suave entre 240m e 420m
  const t = Math.min(1, (distFromCenter - 240) / 220);
  const smoothT = t * t * (3 - 2 * t);

  // Ondulações amplas de relevo natural
  const hills =
    Math.sin(x * 0.0045) * Math.cos(z * 0.0045) * 28 +
    Math.sin(x * 0.011 + 1.2) * Math.sin(z * 0.009 - 0.7) * 14 +
    Math.cos((x + z) * 0.0025) * 22;

  // Cadeia montanhosa nas bordas externas (> 1300m) como perímetro natural do mundo aberto
  let rim = 0;
  if (distFromCenter > 1300) {
    const rimT = Math.min(1, (distFromCenter - 1300) / 650);
    rim = rimT * rimT * 195 * (0.7 + 0.3 * Math.sin(Math.atan2(z, x) * 9));
  }

  return Math.max(0, (hills + 24) * smoothT + rim);
}

/**
 * Gera marcos arquitetônicos determinísticos (torres, blocos urbanos e arcos de voo)
 * para referência espacial e teste de colisão/voo na Fase 1.
 * Na Fase 4 estes blocos serão substituídos pelo CityGenerator destrutível por chunks.
 */
export function generateReferenceColliders(seed = 40491): WorldBoxCollider[] {
  const rng = new SeededRNG(seed);
  const colliders: WorldBoxCollider[] = [];
  let idx = 0;

  const pushBox = (
    cx: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    kind: WorldBoxCollider['kind'],
    colorHex: number,
    accentHex: number,
  ) => {
    const baseY = groundHeightAt(cx, cz);
    colliders.push({
      id: `struct-${idx++}`,
      centerX: cx,
      centerY: baseY + h * 0.5,
      centerZ: cz,
      width: w,
      height: h,
      depth: d,
      minX: cx - w * 0.5,
      maxX: cx + w * 0.5,
      minY: baseY,
      maxY: baseY + h,
      minZ: cz - d * 0.5,
      maxZ: cz + d * 0.5,
      kind,
      colorHex,
      accentHex,
    });
  };

  // Distrito urbano ao Norte/Nordeste (deixando a praça central x=0,z=0 livre para spawn e combate)
  const palettes: Array<[number, number]> = [
    [0x2b3648, 0x38bdf8],
    [0x334155, 0xf97316],
    [0x3f4756, 0x94a3b8],
    [0x263242, 0xf59e0b],
  ];

  // Quarteirões estruturados com avenidas amplas para voar entre prédios
  const gridCoords = [-180, -135, -90, 90, 135, 180];
  for (const gx of gridCoords) {
    for (const gz of [-195, -145, -95, 95, 145, 195]) {
      // Mantém corredor principal N-S e L-O aberto
      if (Math.abs(gx) < 80 && Math.abs(gz) < 80) continue;
      if (rng.next() < 0.22) continue;

      const w = rng.range(14, 24);
      const d = rng.range(14, 24);
      const isTall = rng.next() < 0.38;
      const h = isTall ? rng.range(42, 96) : rng.range(16, 38);
      const pal = palettes[rng.int(0, palettes.length - 1)];

      pushBox(
        gx + rng.range(-4, 4),
        gz + rng.range(-4, 4),
        w,
        h,
        d,
        isTall ? 'tower' : 'building',
        pal[0],
        pal[1],
      );
    }
  }

  // 4 Torres Monolíticas de referência nos pontos cardeais (excelentes para testar altitude e velocidade)
  pushBox(0, -220, 26, 138, 26, 'monolith', 0x1e293b, 0x38bdf8);
  pushBox(235, 0, 22, 112, 22, 'monolith', 0x1e293b, 0xf97316);
  pushBox(-235, 0, 22, 108, 22, 'monolith', 0x1e293b, 0x38bdf8);
  pushBox(0, 240, 24, 120, 24, 'monolith', 0x1e293b, 0xf59e0b);

  // Plataformas/pilares de treino próximos à arena central para testar pulo e transição chão<->voo
  pushBox(-34, -26, 10, 8, 10, 'building', 0x475569, 0x38bdf8);
  pushBox(34, -26, 10, 14, 10, 'building', 0x475569, 0xf97316);
  pushBox(-42, 30, 12, 20, 12, 'building', 0x3b485b, 0x94a3b8);
  pushBox(42, 30, 12, 26, 12, 'building', 0x3b485b, 0x38bdf8);

  return colliders;
}
