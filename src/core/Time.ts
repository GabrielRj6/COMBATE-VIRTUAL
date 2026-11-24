/**
 * Gerenciador de timestep fixo (60Hz) com acumulador e interpolação de renderização.
 * Garante física e movimento determinísticos independentemente do FPS do monitor.
 */
export class Time {
  public readonly fixedDelta: number = 1 / 60;
  public readonly maxFrameDelta: number = 0.1; // evita espiral da morte em abas inativas
  public accumulator = 0;
  public tick = 0;
  public alpha = 0;
  public elapsedSimTime = 0;

  // Métricas de desempenho (sem alocação por frame)
  public fps = 60;
  public frameTimeMs = 16.67;
  private lastTimestamp = 0;
  private fpsFrameCount = 0;
  private fpsAccumMs = 0;

  reset(now = performance.now()): void {
    this.lastTimestamp = now;
    this.accumulator = 0;
    this.alpha = 0;
    this.fpsFrameCount = 0;
    this.fpsAccumMs = 0;
  }

  /**
   * Avança o relógio real e executa quantos passos fixos de 60Hz forem necessários.
   * Retorna o delta real (em segundos) para animações de câmera/render.
   */
  advance(now: number, onFixedUpdate: (dt: number, tick: number) => void): number {
    if (this.lastTimestamp === 0) {
      this.lastTimestamp = now;
      return this.fixedDelta;
    }

    const rawDeltaMs = Math.max(0, now - this.lastTimestamp);
    this.lastTimestamp = now;

    // Atualiza contador de FPS a cada 250ms
    this.fpsFrameCount++;
    this.fpsAccumMs += rawDeltaMs;
    this.frameTimeMs = rawDeltaMs;
    if (this.fpsAccumMs >= 250) {
      this.fps = Math.round((this.fpsFrameCount * 1000) / this.fpsAccumMs);
      this.fpsFrameCount = 0;
      this.fpsAccumMs = 0;
    }

    const frameDelta = Math.min(rawDeltaMs / 1000, this.maxFrameDelta);
    this.accumulator += frameDelta;

    // Executa até 5 sub-passos por frame para manter estabilidade
    let steps = 0;
    while (this.accumulator >= this.fixedDelta && steps < 5) {
      this.tick++;
      this.elapsedSimTime += this.fixedDelta;
      onFixedUpdate(this.fixedDelta, this.tick);
      this.accumulator -= this.fixedDelta;
      steps++;
    }

    // Se acumulou demais (ex.: software WebGL lento), descarta sobra
    if (this.accumulator > this.fixedDelta * 2) {
      this.accumulator = 0;
    }

    this.alpha = this.accumulator / this.fixedDelta;
    return frameDelta;
  }
}
