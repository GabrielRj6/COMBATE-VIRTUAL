import * as THREE from 'three';
import { FighterState } from './Fighter';
import { CharacterAppearance, Player } from './Player';
import { groundHeightAt } from '../world/WorldGeometry';
import { AuraEffect } from '../fx/Aura';

// Textura radial suave compartilhada para sombra de contato no solo
let sharedShadowTexture: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture {
  if (sharedShadowTexture) return sharedShadowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(6, 10, 20, 0.72)');
  grad.addColorStop(0.55, 'rgba(6, 10, 20, 0.34)');
  grad.addColorStop(1, 'rgba(6, 10, 20, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedShadowTexture = tex;
  return tex;
}

/**
 * Modelo procedural composto (12+ partes articuladas) do guerreiro estilo anime.
 * Suporta 5 estilos de cabelo, altura/porte, luvas/botas, 3 acessórios (nenhum/cachecol/capa)
 * e 3 estilos de aura. Pivô no centro inferior (y = 0) para assentar no terreno.
 */
export class CharacterMesh {
  public readonly root = new THREE.Group();
  public readonly bodyPivot = new THREE.Group();
  public readonly contactShadow: THREE.Mesh;
  public readonly aura: AuraEffect;

  private readonly scaleY: number;
  private readonly hasAccessory: boolean;
  private readonly isCape: boolean;

  private torsoGroup = new THREE.Group();
  private headGroup = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private leftLeg = new THREE.Group();
  private rightLeg = new THREE.Group();
  private scarfPivot = new THREE.Group();
  private blockShield: THREE.Mesh;
  private coreEmblemMat: THREE.MeshStandardMaterial;

  // Materiais do corpo usados para o flash branco ao tomar dano
  private flashMaterials: THREE.MeshStandardMaterial[] = [];
  private flashTimer = 0;
  private flashPower = 0;

  private disposables: Array<{ dispose: () => void }> = [];

  constructor(source: Player | CharacterAppearance) {
    const app = 'appearance' in source ? source.appearance : source;
    const scaleY = app.altura;
    this.scaleY = scaleY;
    const bulk = 0.84 + app.porte * 0.34;
    this.hasAccessory = app.roupa.acessorio !== 'nenhum';
    this.isCape = app.roupa.acessorio === 'capa';

    // Materiais PBR com variação de roughness e metalness entre peças adjacentes
    const giTopMat = new THREE.MeshStandardMaterial({
      color: app.roupa.cima,
      roughness: 0.78,
      metalness: 0.05,
    });
    const giBottomMat = new THREE.MeshStandardMaterial({
      color: app.roupa.baixo,
      roughness: 0.84,
      metalness: 0.05,
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: app.roupa.botas,
      roughness: 0.3,
      metalness: 0.62,
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: app.roupa.luvas,
      roughness: 0.32,
      metalness: 0.58,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: app.pele,
      roughness: 0.65,
      metalness: 0.02,
    });
    const hairMat = new THREE.MeshStandardMaterial({
      color: app.cabelo.cor,
      roughness: 0.5,
      metalness: 0.12,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: app.roupa.detalhes,
      emissive: new THREE.Color(app.roupa.detalhes),
      emissiveIntensity: 0.9,
      roughness: 0.22,
      metalness: 0.4,
    });
    const accessoryMat = new THREE.MeshStandardMaterial({
      color: app.roupa.corAcessorio,
      roughness: 0.68,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });

    this.coreEmblemMat = accentMat;
    this.flashMaterials.push(
      giTopMat,
      giBottomMat,
      bootMat,
      gloveMat,
      skinMat,
      hairMat,
      accessoryMat,
    );

    this.disposables.push(
      giTopMat,
      giBottomMat,
      bootMat,
      gloveMat,
      skinMat,
      hairMat,
      accentMat,
      accessoryMat,
    );

    // 1. Pivô central do corpo (na cintura ~1.05m * altura)
    this.bodyPivot.position.set(0, 1.05 * scaleY, 0);
    this.root.add(this.bodyPivot);

    // 2. Torso + Peitoral blindado + Ombreiras
    const chestGeo = new THREE.BoxGeometry(0.62 * bulk, 0.64 * scaleY, 0.36 * bulk);
    const chest = new THREE.Mesh(chestGeo, giTopMat);
    chest.position.set(0, 0.32 * scaleY, 0);
    chest.castShadow = true;
    chest.receiveShadow = true;
    this.torsoGroup.add(chest);
    this.disposables.push(chestGeo);

    const breastplateGeo = new THREE.BoxGeometry(0.54 * bulk, 0.34 * scaleY, 0.4 * bulk);
    const breastplate = new THREE.Mesh(breastplateGeo, bootMat);
    breastplate.position.set(0, 0.42 * scaleY, 0.01);
    breastplate.castShadow = true;
    this.torsoGroup.add(breastplate);
    this.disposables.push(breastplateGeo);

    const emblemGeo = new THREE.OctahedronGeometry(0.085, 0);
    const emblem = new THREE.Mesh(emblemGeo, accentMat);
    emblem.position.set(0, 0.44 * scaleY, 0.21 * bulk);
    emblem.scale.set(1.1, 1.1, 0.45);
    this.torsoGroup.add(emblem);
    this.disposables.push(emblemGeo);

    const beltGeo = new THREE.BoxGeometry(0.64 * bulk, 0.14 * scaleY, 0.39 * bulk);
    const belt = new THREE.Mesh(beltGeo, bootMat);
    belt.position.set(0, 0.02 * scaleY, 0);
    belt.castShadow = true;
    this.torsoGroup.add(belt);
    this.disposables.push(beltGeo);

    const pauldronGeo = new THREE.BoxGeometry(0.24 * bulk, 0.16 * scaleY, 0.36 * bulk);
    const leftPauldron = new THREE.Mesh(pauldronGeo, bootMat);
    leftPauldron.position.set(-0.41 * bulk, 0.58 * scaleY, 0);
    leftPauldron.rotation.z = 0.22;
    leftPauldron.castShadow = true;
    const rightPauldron = new THREE.Mesh(pauldronGeo, bootMat);
    rightPauldron.position.set(0.41 * bulk, 0.58 * scaleY, 0);
    rightPauldron.rotation.z = -0.22;
    rightPauldron.castShadow = true;
    this.torsoGroup.add(leftPauldron, rightPauldron);
    this.disposables.push(pauldronGeo);

    // 3. Acessório dorsal dinâmico (nenhum / cachecol / capa)
    this.scarfPivot.position.set(0, 0.58 * scaleY, -0.18 * bulk);
    if (app.roupa.acessorio === 'cachecol') {
      const collarGeo = new THREE.TorusGeometry(0.2 * bulk, 0.055, 6, 12);
      collarGeo.rotateX(Math.PI / 2);
      const collar = new THREE.Mesh(collarGeo, accessoryMat);
      collar.position.set(0, 0.65 * scaleY, 0);
      this.torsoGroup.add(collar);
      this.disposables.push(collarGeo);

      const scarfGeo = new THREE.BoxGeometry(0.3, 0.055, 0.92);
      scarfGeo.translate(0, 0, -0.46);
      const scarf = new THREE.Mesh(scarfGeo, accessoryMat);
      scarf.castShadow = true;
      this.scarfPivot.add(scarf);
      this.disposables.push(scarfGeo);
    } else if (app.roupa.acessorio === 'capa') {
      const capeGeo = new THREE.BoxGeometry(0.76 * bulk, 1.18 * scaleY, 0.05);
      capeGeo.translate(0, -0.58 * scaleY, -0.05);
      const cape = new THREE.Mesh(capeGeo, accessoryMat);
      cape.castShadow = true;
      this.scarfPivot.add(cape);
      this.disposables.push(capeGeo);
    }
    this.torsoGroup.add(this.scarfPivot);

    // 4. Cabeça + Visor luminoso + 5 estilos procedurais de cabelo
    this.headGroup.position.set(0, 0.68 * scaleY, 0);
    const headGeo = new THREE.SphereGeometry(0.22, 16, 14);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 0.18, 0);
    head.castShadow = true;
    this.headGroup.add(head);
    this.disposables.push(headGeo);

    const visorGeo = new THREE.BoxGeometry(0.26, 0.065, 0.08);
    const visor = new THREE.Mesh(visorGeo, accentMat);
    visor.position.set(0, 0.2, 0.19);
    this.headGroup.add(visor);
    this.disposables.push(visorGeo);

    this.buildHairStyle(app.cabelo.estilo, hairMat, accentMat);

    this.torsoGroup.add(this.headGroup);
    this.bodyPivot.add(this.torsoGroup);

    // 5. Braços articulados (luvas customizáveis)
    const upperArmGeo = new THREE.CapsuleGeometry(0.095 * bulk, 0.28 * scaleY, 6, 10);
    const gauntletGeo = new THREE.BoxGeometry(0.18 * bulk, 0.3 * scaleY, 0.18 * bulk);
    this.disposables.push(upperArmGeo, gauntletGeo);

    const buildArm = (armGroup: THREE.Group, side: -1 | 1) => {
      armGroup.position.set(side * 0.42 * bulk, 0.56 * scaleY, 0);
      const upper = new THREE.Mesh(upperArmGeo, skinMat);
      upper.position.set(0, -0.18 * scaleY, 0);
      upper.castShadow = true;
      const gauntlet = new THREE.Mesh(gauntletGeo, gloveMat);
      gauntlet.position.set(0, -0.44 * scaleY, 0.02);
      gauntlet.castShadow = true;
      armGroup.add(upper, gauntlet);
      this.torsoGroup.add(armGroup);
    };
    buildArm(this.leftArm, -1);
    buildArm(this.rightArm, 1);

    // 6. Pernas articuladas (botas customizáveis)
    const thighGeo = new THREE.CapsuleGeometry(0.125 * bulk, 0.34 * scaleY, 6, 10);
    const bootGeo = new THREE.BoxGeometry(0.22 * bulk, 0.44 * scaleY, 0.28 * bulk);
    this.disposables.push(thighGeo, bootGeo);

    const buildLeg = (legGroup: THREE.Group, side: -1 | 1) => {
      legGroup.position.set(side * 0.19 * bulk, -0.02 * scaleY, 0);
      const thigh = new THREE.Mesh(thighGeo, giBottomMat);
      thigh.position.set(0, -0.25 * scaleY, 0);
      thigh.castShadow = true;
      const boot = new THREE.Mesh(bootGeo, bootMat);
      boot.position.set(0, -0.74 * scaleY, 0.03);
      boot.castShadow = true;
      legGroup.add(thigh, boot);
      this.bodyPivot.add(legGroup);
    };
    buildLeg(this.leftLeg, -1);
    buildLeg(this.rightLeg, 1);

    // 7. Barreira frontal translúcida ao bloquear
    const shieldGeo = new THREE.CircleGeometry(0.85, 6);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: app.ki,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.blockShield = new THREE.Mesh(shieldGeo, shieldMat);
    this.blockShield.position.set(0, 0.32 * scaleY, 0.72);
    this.blockShield.visible = false;
    this.blockShield.renderOrder = 7;
    this.bodyPivot.add(this.blockShield);
    this.disposables.push(shieldGeo, shieldMat);

    // 8. Sombra radial de contato no solo
    const shadowGeo = new THREE.PlaneGeometry(2.3, 2.3);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: getContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.58,
    });
    this.contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.contactShadow.renderOrder = 2;
    this.disposables.push(shadowGeo, shadowMat);

    // 9. Aura de ki com estilo customizado (0 Brilho, 1 Chama, 2 Relâmpago)
    this.aura = new AuraEffect(app.aura.cor, app.ki, app.aura.estilo);
    this.bodyPivot.add(this.aura.group);
  }

  private buildHairStyle(
    style: number,
    hairMat: THREE.MeshStandardMaterial,
    accentMat: THREE.MeshStandardMaterial,
  ): void {
    // 0: Careca (apenas faixa energética opcional na testa? mantém limpo)
    if (style === 0) return;

    // 1: Espetado (anime clássico)
    if (style === 1) {
      const spikeGeo = new THREE.ConeGeometry(0.095, 0.34, 5);
      this.disposables.push(spikeGeo);
      const spikeConfigs: Array<[number, number, number, number, number, number, number]> = [
        [0, 0.42, -0.02, -0.18, 0, 0, 1.15],
        [-0.14, 0.36, -0.05, -0.25, 0, 0.55, 1.0],
        [0.14, 0.36, -0.05, -0.25, 0, -0.55, 1.0],
        [0, 0.34, -0.17, -0.95, 0, 0, 1.05],
        [-0.15, 0.26, -0.14, -0.65, 0, 0.85, 0.9],
        [0.15, 0.26, -0.14, -0.65, 0, -0.85, 0.9],
      ];
      for (const [x, y, z, rx, ry, rz, s] of spikeConfigs) {
        const spike = new THREE.Mesh(spikeGeo, hairMat);
        spike.position.set(x, y, z);
        spike.rotation.set(rx, ry, rz);
        spike.scale.setScalar(s);
        spike.castShadow = true;
        this.headGroup.add(spike);
      }
      return;
    }

    // 2: Longo (mechas fluídas caindo até os ombros/costas)
    if (style === 2) {
      const capGeo = new THREE.SphereGeometry(0.238, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
      const cap = new THREE.Mesh(capGeo, hairMat);
      cap.position.set(0, 0.2, -0.01);
      cap.castShadow = true;
      this.headGroup.add(cap);

      const lockGeo = new THREE.BoxGeometry(0.11, 0.56, 0.1);
      this.disposables.push(capGeo, lockGeo);

      const locks: Array<[number, number, number, number, number]> = [
        [0, 0.0, -0.22, 0.16, 0],
        [-0.12, -0.02, -0.19, 0.14, 0.12],
        [0.12, -0.02, -0.19, 0.14, -0.12],
        [-0.19, 0.04, -0.06, 0.05, 0.18],
        [0.19, 0.04, -0.06, 0.05, -0.18],
      ];
      for (const [x, y, z, rx, rz] of locks) {
        const lock = new THREE.Mesh(lockGeo, hairMat);
        lock.position.set(x, y, z);
        lock.rotation.set(rx, 0, rz);
        lock.castShadow = true;
        this.headGroup.add(lock);
      }
      return;
    }

    // 3: Rabo de Cavalo (calota + laço + rabo longo inclinado)
    if (style === 3) {
      const capGeo = new THREE.SphereGeometry(0.236, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58);
      const cap = new THREE.Mesh(capGeo, hairMat);
      cap.position.set(0, 0.2, -0.01);
      cap.castShadow = true;

      const bandGeo = new THREE.TorusGeometry(0.065, 0.022, 6, 10);
      const band = new THREE.Mesh(bandGeo, accentMat);
      band.position.set(0, 0.24, -0.22);

      const tailGeo = new THREE.ConeGeometry(0.11, 0.58, 7);
      const tail = new THREE.Mesh(tailGeo, hairMat);
      tail.position.set(0, 0.05, -0.35);
      tail.rotation.x = -2.45;
      tail.castShadow = true;

      this.headGroup.add(cap, band, tail);
      this.disposables.push(capGeo, bandGeo, tailGeo);
      return;
    }

    // 4: Moicano (crista central agressiva)
    const finGeo = new THREE.BoxGeometry(0.085, 0.24, 0.16);
    this.disposables.push(finGeo);
    const fins: Array<[number, number, number, number]> = [
      [0, 0.42, 0.08, 0.25],
      [0, 0.44, -0.05, 0.0],
      [0, 0.37, -0.18, -0.45],
      [0, 0.24, -0.24, -0.95],
    ];
    for (const [x, y, z, rx] of fins) {
      const fin = new THREE.Mesh(finGeo, hairMat);
      fin.position.set(x, y, z);
      fin.rotation.x = rx;
      fin.castShadow = true;
      this.headGroup.add(fin);
    }
  }

  /** Ativa flash branco emissivo por 0.14s ao receber impacto. */
  public flash(power = 0.5): void {
    this.flashTimer = 0.14;
    this.flashPower = Math.max(0.45, Math.min(1.0, power + 0.35));
  }

  /** Modo de pré-visualização para o editor de personagem 3D. */
  public updatePreview(dt: number, showAura: boolean, elapsed: number): void {
    const breathe = Math.sin(elapsed * 2.4) * 0.025;
    this.bodyPivot.position.y = 1.05 * this.scaleY + breathe;
    this.bodyPivot.rotation.set(0, 0, 0);
    this.torsoGroup.rotation.set(0, 0, 0);

    if (showAura) {
      this.leftArm.rotation.set(-0.68, 0, 0.5);
      this.rightArm.rotation.set(-0.68, 0, -0.5);
      this.leftLeg.rotation.set(-0.15, 0, 0.12);
      this.rightLeg.rotation.set(-0.15, 0, -0.12);
    } else {
      this.leftArm.rotation.set(0.08, 0, 0.15 + breathe);
      this.rightArm.rotation.set(0.08, 0, -0.15 - breathe);
      this.leftLeg.rotation.set(0, 0, 0.05);
      this.rightLeg.rotation.set(0, 0, -0.05);
    }

    if (this.hasAccessory) {
      const flutter = Math.sin(elapsed * 3.2) * 0.08;
      this.scarfPivot.rotation.set(
        (this.isCape ? 0.12 : 0.3) + (showAura ? 0.35 : 0) + flutter,
        flutter * 0.4,
        0,
      );
    }

    this.coreEmblemMat.emissiveIntensity = showAura ? 2.2 : 1.0;
    this.aura.update(dt, false, false, showAura, showAura ? 30 : 0);
  }

  /**
   * Sincroniza o mesh com a simulação interpolada (alpha entre prevPos e pos).
   */
  public sync(player: Player, alpha: number, dt: number): void {
    const ix = player.prevPos.x + (player.pos.x - player.prevPos.x) * alpha;
    const iy = player.prevPos.y + (player.pos.y - player.prevPos.y) * alpha;
    const iz = player.prevPos.z + (player.pos.z - player.prevPos.z) * alpha;
    this.root.position.set(ix, iy, iz);

    let yawDiff = ((player.facingYaw - player.prevFacingYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const iYaw = player.prevFacingYaw + yawDiff * alpha;
    const iPitch = player.prevBodyPitch + (player.bodyPitch - player.prevBodyPitch) * alpha;
    const iRoll = player.prevBodyRoll + (player.bodyRoll - player.prevBodyRoll) * alpha;

    this.root.rotation.set(0, iYaw, 0);
    this.bodyPivot.rotation.set(iPitch, 0, iRoll);
    this.torsoGroup.rotation.set(0, 0, 0);
    this.headGroup.rotation.set(0, 0, 0);

    // Efeito rápido de distorção ao chegar de um teleporte
    if (player.combat.teleportTimer > 0) {
      const t = player.combat.teleportTimer / 0.14;
      this.bodyPivot.scale.set(1 - t * 0.35, 1 + t * 0.4, 1 - t * 0.35);
    } else {
      this.bodyPivot.scale.set(1, 1, 1);
    }

    const baseHipY = 1.05 * this.scaleY;
    const hSpeed = player.getHorizontalSpeed();
    const totalSpeed = player.getSpeed();
    const phase = player.animPhase;

    if (player.isCharging) {
      this.leftArm.rotation.set(-0.7, 0, 0.52);
      this.rightArm.rotation.set(-0.7, 0, -0.52);
      this.leftLeg.rotation.set(-0.18, 0, 0.14);
      this.rightLeg.rotation.set(-0.18, 0, -0.14);
      this.bodyPivot.position.y = baseHipY + Math.sin(phase * 4.5) * 0.03;
    } else if (player.flyMode) {
      const hoverBob = player.isBoosting ? 0 : Math.sin(phase) * 0.08;
      this.bodyPivot.position.y = baseHipY + 0.03 + hoverBob;

      const boostBlend = player.isBoosting ? 1 : Math.min(1, hSpeed / 36);
      this.leftArm.rotation.set(0.35 + boostBlend * 0.55, 0, 0.25 + boostBlend * 0.2);
      this.rightArm.rotation.set(0.35 + boostBlend * 0.55, 0, -0.25 - boostBlend * 0.2);
      this.leftLeg.rotation.set(0.12 + boostBlend * 0.18, 0, 0.06);
      this.rightLeg.rotation.set(-0.35 * (1 - boostBlend) + 0.14 * boostBlend, 0, -0.06);
    } else if (player.isGrounded && hSpeed > 0.8) {
      const stride = Math.min(1.05, (hSpeed / 22) * 0.95);
      const swing = Math.sin(phase) * stride;
      this.leftLeg.rotation.set(swing, 0, 0);
      this.rightLeg.rotation.set(-swing, 0, 0);
      this.leftArm.rotation.set(-swing * 0.85, 0, 0.12);
      this.rightArm.rotation.set(swing * 0.85, 0, -0.12);
      this.bodyPivot.position.y = baseHipY + Math.abs(Math.cos(phase)) * 0.07 * stride;
    } else if (!player.isGrounded) {
      this.leftArm.rotation.set(-0.55, 0, 0.42);
      this.rightArm.rotation.set(-0.55, 0, -0.42);
      this.leftLeg.rotation.set(-0.32, 0, 0.08);
      this.rightLeg.rotation.set(0.22, 0, -0.08);
      this.bodyPivot.position.y = baseHipY;
    } else {
      const breathe = Math.sin(phase) * 0.03;
      this.leftArm.rotation.set(0.08, 0, 0.14 + breathe);
      this.rightArm.rotation.set(0.08, 0, -0.14 - breathe);
      this.leftLeg.rotation.set(0, 0, 0.04);
      this.rightLeg.rotation.set(0, 0, -0.04);
      this.bodyPivot.position.y = baseHipY + breathe * 0.5;
    }

    this.applyCombatPose(player);
    this.updateHitFlash(dt);

    // Cachecol ou capa reage ao vento/velocidade
    if (this.hasAccessory) {
      const windLift = Math.min(1.15, totalSpeed / 45);
      const flutter = Math.sin(phase * (2.6 + windLift * 3)) * (0.06 + windLift * 0.12);
      const baseTilt = this.isCape ? 0.12 : 0.28;
      this.scarfPivot.rotation.set(baseTilt + windLift * 0.85 + flutter, flutter * 0.45, 0);
    }

    this.coreEmblemMat.emissiveIntensity =
      player.isBoosting || player.isCharging || player.combat.castTimer > 0 ? 2.2 : 0.9;

    // Atualiza sombra radial no solo
    const gY = groundHeightAt(ix, iz);
    const alt = Math.max(0, iy - gY);
    this.contactShadow.position.set(ix, gY + 0.04, iz);
    const shadowScale = Math.max(0.35, 1 - alt * 0.014);
    this.contactShadow.scale.setScalar(shadowScale);
    (this.contactShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(
      0.06,
      0.58 - alt * 0.012,
    );

    const auraCharging = player.isCharging || player.combat.castTimer > 0;
    this.aura.update(dt, player.flyMode, player.isBoosting, auraCharging, totalSpeed);
  }

  private applyCombatPose(player: Player): void {
    const c = player.combat;
    const state = player.fighter.state;
    this.blockShield.visible = false;

    if (state === FighterState.DEAD) {
      this.bodyPivot.position.y = 0.38;
      this.bodyPivot.rotation.set(-1.45, 0, 0.12);
      this.leftArm.rotation.set(-0.2, 0, 0.85);
      this.rightArm.rotation.set(-0.2, 0, -0.95);
      this.leftLeg.rotation.set(0.15, 0, 0.2);
      this.rightLeg.rotation.set(-0.1, 0, -0.25);
      return;
    }

    if (state === FighterState.STUNNED || state === FighterState.KNOCKBACK || c.stunTimer > 0) {
      this.torsoGroup.rotation.x = -0.38;
      this.leftArm.rotation.set(-0.35, 0, 1.15);
      this.rightArm.rotation.set(-0.35, 0, -1.15);
      this.leftLeg.rotation.set(-0.25, 0, 0.18);
      this.rightLeg.rotation.set(0.2, 0, -0.18);
      return;
    }

    if (c.castTimer > 0 || c.burstLeft > 0) {
      const shake = Math.sin(player.animPhase * 42) * 0.08;
      this.torsoGroup.rotation.x = 0.12;
      this.leftArm.rotation.set(-1.45 + shake, 0.22, -0.18);
      this.rightArm.rotation.set(-1.45 - shake, -0.22, 0.18);
      return;
    }

    if (c.attackTimer > 0 && c.attackMove) {
      const p = c.attackProgress();
      const hitFrac = c.attackMove.hitAt / c.attackMove.total;
      const strike =
        p < hitFrac
          ? p / Math.max(0.01, hitFrac)
          : Math.max(0, 1 - (p - hitFrac) / Math.max(0.01, 1 - hitFrac));

      const id = c.attackMove.id;
      if (id === 'L1' || id === 'L3') {
        const windup = p < hitFrac ? (1 - strike) * 0.55 : 0;
        this.torsoGroup.rotation.y = -0.55 * windup + 0.72 * strike;
        this.rightArm.rotation.set(-1.58 * strike + 0.5 * windup, 0, -0.12);
        this.leftArm.rotation.set(-0.45, 0, 0.35);
      } else if (id === 'L2') {
        const windup = p < hitFrac ? (1 - strike) * 0.55 : 0;
        this.torsoGroup.rotation.y = 0.55 * windup - 0.72 * strike;
        this.leftArm.rotation.set(-1.58 * strike + 0.5 * windup, 0, 0.12);
        this.rightArm.rotation.set(-0.45, 0, -0.35);
      } else if (id === 'L4') {
        this.bodyPivot.rotation.y = p * Math.PI * 2;
        this.torsoGroup.rotation.x = -0.22 * strike;
        this.rightLeg.rotation.set(-1.45 * strike, 0, -0.28 * strike);
        this.leftArm.rotation.set(-0.4, 0, 0.9 * strike);
        this.rightArm.rotation.set(-0.4, 0, -0.9 * strike);
      } else if (id === 'H') {
        const raise = p < hitFrac ? 1 - strike * 0.3 : 0;
        const slamAngle = p < hitFrac ? -2.65 * raise - 0.4 * strike : -0.95 * strike;
        this.torsoGroup.rotation.x = -0.25 * raise + 0.45 * strike;
        this.leftArm.rotation.set(slamAngle, 0.25, -0.24);
        this.rightArm.rotation.set(slamAngle, -0.25, 0.24);
      }
      return;
    }

    if (c.isBlocking) {
      this.torsoGroup.rotation.x = 0.08;
      this.leftArm.rotation.set(-1.28, 0.62, -0.45);
      this.rightArm.rotation.set(-1.28, -0.62, 0.45);
      this.blockShield.visible = true;
    }
  }

  private updateHitFlash(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const t = this.flashTimer / 0.14;
      const intensity = t * this.flashPower * 1.4;
      for (let i = 0; i < this.flashMaterials.length; i++) {
        const m = this.flashMaterials[i];
        m.emissive.setRGB(1, 1, 1);
        m.emissiveIntensity = intensity;
      }
    } else if (this.flashPower > 0) {
      this.flashPower = 0;
      for (let i = 0; i < this.flashMaterials.length; i++) {
        const m = this.flashMaterials[i];
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 0;
      }
    }
  }

  public dispose(): void {
    this.aura.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
