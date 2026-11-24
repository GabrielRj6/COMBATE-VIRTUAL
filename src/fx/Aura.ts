import * as THREE from 'three';

/**
 * Efeitos visuais de aura de Ki (3 estilos: 0 Brilho, 1 Chama, 2 Relâmpago),
 * anel de solo ao carregar Ki, cone aerodinâmico de boost e anel de choque.
 * Todos os recursos são pré-alocados (zero alocação no loop de render).
 */
export class AuraEffect {
  public readonly group = new THREE.Group();

  private readonly auraStyle: number;
  private innerShell: THREE.Mesh;
  private outerShell: THREE.Mesh;
  private lightningGroup: THREE.Group;
  private chargeGroundRing: THREE.Mesh;
  private shockRing: THREE.Mesh;
  private boostCone: THREE.Mesh;

  private innerMat: THREE.MeshBasicMaterial;
  private outerMat: THREE.MeshBasicMaterial;
  private boltMat: THREE.MeshBasicMaterial;
  private groundRingMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private coneMat: THREE.MeshBasicMaterial;

  private shockProgress = 1; // 1 = inativo
  private elapsed = 0;
  private intensity = 0;

  private disposables: Array<{ dispose: () => void }> = [];

  constructor(auraColorHex: string, kiColorHex: string, auraStyle = 1) {
    this.auraStyle = auraStyle;
    const auraColor = new THREE.Color(auraColorHex);
    const kiColor = new THREE.Color(kiColorHex);

    // 1. Camada interna de aura (envoltório energético próximo ao corpo)
    const innerGeo = new THREE.CapsuleGeometry(0.68, 1.35, 6, 12);
    this.innerMat = new THREE.MeshBasicMaterial({
      color: kiColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.innerShell = new THREE.Mesh(innerGeo, this.innerMat);
    this.innerShell.position.set(0, 0.15, 0);
    this.innerShell.renderOrder = 4;

    // 2. Camada externa adaptada ao estilo (0: Brilho esférico suave, 1: Chama cônica, 2: Relâmpago + envelope)
    const outerGeo =
      auraStyle === 0
        ? new THREE.CapsuleGeometry(0.95, 1.55, 8, 14)
        : new THREE.ConeGeometry(1.08, 2.85, auraStyle === 2 ? 6 : 10, 1, true);
    this.outerMat = new THREE.MeshBasicMaterial({
      color: auraColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.outerShell = new THREE.Mesh(outerGeo, this.outerMat);
    this.outerShell.position.set(0, auraStyle === 0 ? 0.18 : 0.34, 0);
    this.outerShell.renderOrder = 5;

    // 3. Arcos elétricos para estilo 2 (Relâmpago)
    this.lightningGroup = new THREE.Group();
    const boltGeo = new THREE.BoxGeometry(0.055, 0.85, 0.055);
    this.boltMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    if (auraStyle === 2) {
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const bolt = new THREE.Mesh(boltGeo, this.boltMat);
        bolt.position.set(Math.cos(angle) * 0.85, (i % 3 - 1) * 0.45 + 0.15, Math.sin(angle) * 0.85);
        bolt.rotation.set((i % 2 === 0 ? 0.35 : -0.35), angle, (i % 2 === 0 ? -0.4 : 0.4));
        bolt.renderOrder = 6;
        this.lightningGroup.add(bolt);
      }
    }
    this.lightningGroup.visible = false;

    // 4. Anel luminoso pulsante no solo ao carregar Ki (Fase 3 polish)
    const groundRingGeo = new THREE.RingGeometry(0.75, 1.45, 24);
    groundRingGeo.rotateX(-Math.PI / 2);
    this.groundRingMat = new THREE.MeshBasicMaterial({
      color: auraColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.chargeGroundRing = new THREE.Mesh(groundRingGeo, this.groundRingMat);
    this.chargeGroundRing.position.set(0, -0.96, 0);
    this.chargeGroundRing.visible = false;
    this.chargeGroundRing.renderOrder = 5;

    // 5. Cone supersônico de vento à frente do guerreiro durante Boost
    const coneGeo = new THREE.ConeGeometry(1.15, 2.2, 14, 1, true);
    coneGeo.rotateX(Math.PI / 2);
    this.coneMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.boostCone = new THREE.Mesh(coneGeo, this.coneMat);
    this.boostCone.position.set(0, 0.25, 0.55);
    this.boostCone.renderOrder = 6;

    // 6. Anel de choque expansivo ao decolar, dar dash ou ligar boost
    const ringGeo = new THREE.RingGeometry(0.4, 0.85, 24);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: auraColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.shockRing = new THREE.Mesh(ringGeo, this.ringMat);
    this.shockRing.rotation.x = Math.PI / 2;
    this.shockRing.renderOrder = 6;

    this.group.add(
      this.innerShell,
      this.outerShell,
      this.lightningGroup,
      this.chargeGroundRing,
      this.boostCone,
      this.shockRing,
    );
    this.disposables.push(
      innerGeo,
      outerGeo,
      boltGeo,
      groundRingGeo,
      coneGeo,
      ringGeo,
      this.innerMat,
      this.outerMat,
      this.boltMat,
      this.groundRingMat,
      this.coneMat,
      this.ringMat,
    );
  }

  /** Dispara pulso visual de anel de choque (decolagem, boost ou dash). */
  public triggerPulse(): void {
    this.shockProgress = 0;
  }

  public update(
    dt: number,
    flyMode: boolean,
    isBoosting: boolean,
    isCharging: boolean,
    speedMs: number,
  ): void {
    this.elapsed += dt;

    const targetIntensity = isCharging ? 1.0 : isBoosting ? 0.88 : flyMode ? 0.18 : 0;
    const rate = 1 - Math.exp(-10 * dt);
    this.intensity += (targetIntensity - this.intensity) * rate;

    const active = this.intensity > 0.015;
    this.innerShell.visible = active;
    this.outerShell.visible = active;

    if (active) {
      if (this.auraStyle === 0) {
        // Brilho suave e respiração contínua
        const pulse = 0.94 + Math.sin(this.elapsed * 10) * 0.06;
        this.innerMat.opacity = this.intensity * 0.3 * pulse;
        this.outerMat.opacity = this.intensity * 0.24 * pulse;
        this.innerShell.scale.setScalar(0.96 + this.intensity * 0.14);
        this.outerShell.scale.setScalar(0.95 + this.intensity * 0.22 * pulse);
      } else {
        // Chama / Relâmpago com vibração de alta energia
        const flicker = 0.86 + Math.sin(this.elapsed * (this.auraStyle === 2 ? 44 : 28)) * 0.14;
        const stretch = 1 + Math.sin(this.elapsed * 19) * 0.09;
        this.innerMat.opacity = this.intensity * 0.26 * flicker;
        this.outerMat.opacity = this.intensity * 0.24 * flicker;

        this.innerShell.scale.set(
          0.95 + this.intensity * 0.15,
          stretch,
          0.95 + this.intensity * 0.15,
        );
        this.outerShell.scale.set(
          0.85 + this.intensity * 0.38,
          0.92 + this.intensity * 0.48 * stretch,
          0.85 + this.intensity * 0.38,
        );
        this.outerShell.rotation.y += dt * (isCharging ? 4.8 : 3.0);
      }

      if (this.auraStyle === 2) {
        const crackle = Math.sin(this.elapsed * 58) > -0.25;
        this.lightningGroup.visible = crackle && this.intensity > 0.25;
        this.boltMat.opacity = this.intensity * 0.85;
        this.lightningGroup.rotation.y += dt * 11.0;
        this.lightningGroup.scale.setScalar(0.95 + Math.sin(this.elapsed * 40) * 0.12);
      }
    } else {
      this.lightningGroup.visible = false;
    }

    // Anel de carga de Ki no solo
    if (isCharging) {
      this.chargeGroundRing.visible = true;
      const wave = (this.elapsed * 1.9) % 1;
      const scale = 0.75 + wave * 1.65;
      this.chargeGroundRing.scale.setScalar(scale);
      this.chargeGroundRing.rotation.z = this.elapsed * 2.2;
      this.groundRingMat.opacity = (1 - wave) * 0.58;
    } else {
      this.chargeGroundRing.visible = false;
    }

    // Cone supersônico em alta velocidade de boost
    const coneTarget = isBoosting && speedMs > 40 ? 0.24 : 0;
    this.coneMat.opacity += (coneTarget - this.coneMat.opacity) * (1 - Math.exp(-12 * dt));
    this.boostCone.visible = this.coneMat.opacity > 0.01;
    if (this.boostCone.visible) {
      const pulse = 0.95 + Math.sin(this.elapsed * 34) * 0.07;
      this.boostCone.scale.set(pulse, pulse, 1.0 + Math.min(0.45, speedMs / 160));
    }

    // Anel de choque expansivo
    if (this.shockProgress < 1) {
      this.shockProgress = Math.min(1, this.shockProgress + dt * 3.1);
      const ease = 1 - Math.pow(1 - this.shockProgress, 3);
      this.shockRing.visible = true;
      this.shockRing.scale.setScalar(0.8 + ease * 4.8);
      this.ringMat.opacity = (1 - this.shockProgress) * 0.65;
    } else {
      this.shockRing.visible = false;
    }
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
