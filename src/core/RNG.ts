/**
 * Gerador determinístico de números pseudoaleatórios (Mulberry32).
 * Evita Math.random() na simulação para manter determinismo no multiplayer (Fase 6).
 */
export class SeededRNG {
  private state: number;

  constructor(seed = 133742) {
    this.state = seed >>> 0;
  }

  /** Retorna float determinístico no intervalo [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Retorna float no intervalo [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Retorna inteiro no intervalo [min, max] (inclusivo). */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Cria um sub-gerador independente a partir de uma seed derivada (ex.: eventos de impacto). */
  fork(salt: number): SeededRNG {
    const derived = (this.state ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0;
    return new SeededRNG(derived);
  }
}
