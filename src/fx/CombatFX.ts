import * as THREE from 'three';
import { BeamFx, BEAM_POOL_SIZE, ProjectileSlot, PROJECTILE_POOL_SIZE } from '../combat/Projectile';
import { getSkillBySlot } from '../combat/Skills';
import { EventBus } from '../core/EventBus';
import { Player } from '../entities/Player';
import { CharacterMesh } from '../entities/CharacterMesh';

interface ProjectileVisual {
  group: THREE.Group;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
}

interface BeamVisual {
  group: THREE.Group;
  core: THREE.Mesh;
  shell: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  shellMat: THREE.MeshBasicMaterial;
}

interface PulseSlot {
  active: boolean;
  life: number;
  maxLife: number;
  startRadius: number;
  endRadius: number;
  ringOnly: boolean;
  group: THREE.Group;
  sphere: THREE.Mesh;
  ring: THREE.Mesh;
  sphereMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
}

interface AfterimageSlot {
  active: boolean;
  life: number;
  maxLife: number;
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
}

interface ChargeOrbVisual {
  group: THREE.Group;
  core: THREE.Mesh;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
}

const PULSE_POOL_SIZE = 48;
const AFTERIMAGE_POOL_SIZE = 10;

/**
 * Efeitos visuais de combate e teleporte 100% em pool (zero alocação por frame).
 * Renderiza projéteis, raios, pulsos/explosões, orbes de carga, pós-imagens de teleporte,
 * ondas de clash e impactos em parede. Suporta entrada/saída dinâmica de jogadores online.
 */
export class CombatFX {
  public readonly root = new THREE.Group();

  private readonly projVisuals: ProjectileVisual[] = [];
  private readonly beamVisuals: BeamVisual[] = [];
  private readonly pulses: PulseSlot[] = [];
  private readonly afterimages: AfterimageSlot[] = [];
  private readonly chargeOrbs = new Map<string, ChargeOrbVisual>();

  private readonly sphereGeo: THREE.SphereGeometry;
  private readonly orbCoreMat: THREE.MeshBasicMaterial;

  private pulseCursor = 0;
  private afterimageCursor = 0;
  private unsubscribers: Array<() => void> = [];
  private disposables: Array<{ dispose: () => void }> = [];

  // Vetores reutilizáveis (zero GC)
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();

  constructor(scene: THREE.Scene, events: EventBus, players: Player[]) {
    this.sphereGeo = new THREE.SphereGeometry(1, 14, 10);
    const pulseSphereGeo = new THREE.SphereGeometry(1, 12, 10);
    const ringGeo = new THREE.RingGeometry(0.62, 1.0, 24);
    ringGeo.rotateX(Math.PI / 2);

    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, 0.5);

    this.disposables.push(this.sphereGeo, pulseSphereGeo, ringGeo, beamGeo);

    // 1. Pool de 64 projéteis
    const projCoreMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.disposables.push(projCoreMat);

    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.visible = false;

      const core = new THREE.Mesh(this.sphereGeo, projCoreMat);
      core.scale.set(0.6, 0.6, 0.95);
      core.renderOrder = 8;

      const glowMat = new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const glow = new THREE.Mesh(this.sphereGeo, glowMat);
      glow.scale.set(1.15, 1.15, 2.35);
      glow.renderOrder = 7;

      group.add(glow, core);
      this.root.add(group);
      this.projVisuals.push({ group, core, glow, glowMat });
      this.disposables.push(glowMat);
    }

    // 2. Pool de 6 raios
    for (let i = 0; i < BEAM_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.visible = false;

      const coreMat = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const shellMat = new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });

      const core = new THREE.Mesh(beamGeo, coreMat);
      const shell = new THREE.Mesh(beamGeo, shellMat);
      core.renderOrder = 9;
      shell.renderOrder = 8;

      group.add(shell, core);
      this.root.add(group);
      this.beamVisuals.push({ group, core, shell, coreMat, shellMat });
      this.disposables.push(coreMat, shellMat);
    }

    // 3. Pool de 48 pulsos aditivos
    for (let i = 0; i < PULSE_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.visible = false;

      const sphereMat = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const ringMat = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });

      const sphere = new THREE.Mesh(pulseSphereGeo, sphereMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      sphere.renderOrder = 9;
      ring.renderOrder = 9;

      group.add(sphere, ring);
      this.root.add(group);
      this.pulses.push({
        active: false,
        life: 0,
        maxLife: 0.3,
        startRadius: 0.5,
        endRadius: 3.0,
        ringOnly: false,
        group,
        sphere,
        ring,
        sphereMat,
        ringMat,
      });
      this.disposables.push(sphereMat, ringMat);
    }

    // 4. Pool de 10 pós-imagens translúcidas de teleporte (silhueta humanoide)
    const ghostTorsoGeo = new THREE.BoxGeometry(0.62, 0.68, 0.36);
    const ghostHeadGeo = new THREE.SphereGeometry(0.22, 10, 8);
    const ghostLimbGeo = new THREE.CapsuleGeometry(0.11, 0.52, 4, 8);
    this.disposables.push(ghostTorsoGeo, ghostHeadGeo, ghostLimbGeo);

    for (let i = 0; i < AFTERIMAGE_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const mat = new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });

      const torso = new THREE.Mesh(ghostTorsoGeo, mat);
      torso.position.set(0, 1.35, 0);
      const head = new THREE.Mesh(ghostHeadGeo, mat);
      head.position.set(0, 1.92, 0);
      const lArm = new THREE.Mesh(ghostLimbGeo, mat);
      lArm.position.set(-0.44, 1.25, 0);
      lArm.rotation.z = 0.25;
      const rArm = new THREE.Mesh(ghostLimbGeo, mat);
      rArm.position.set(0.44, 1.25, 0);
      rArm.rotation.z = -0.25;
      const lLeg = new THREE.Mesh(ghostLimbGeo, mat);
      lLeg.position.set(-0.2, 0.55, 0);
      const rLeg = new THREE.Mesh(ghostLimbGeo, mat);
      rLeg.position.set(0.2, 0.55, 0);

      group.add(torso, head, lArm, rArm, lLeg, rLeg);
      this.root.add(group);
      this.afterimages.push({
        active: false,
        life: 0,
        maxLife: 0.45,
        group,
        mat,
      });
      this.disposables.push(mat);
    }

    // 5. Orbes de carga (dinâmico para jogadores online)
    this.orbCoreMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.disposables.push(this.orbCoreMat);

    for (let i = 0; i < players.length; i++) {
      this.registerPlayer(players[i]);
    }

    scene.add(this.root);

    // Eventos de combate e Fase 3
    this.unsubscribers.push(
      events.on('combat:hit', (ev) => {
        const color = ev.backstab
          ? '#fde047'
          : ev.kind === 'blocked'
            ? '#7dd3fc'
            : ev.kind === 'heavy'
              ? '#f97316'
              : ev.kind === 'skill'
                ? '#facc15'
                : '#ffffff';
        const endR = 1.4 + ev.power * 3.4;
        this.spawnPulse(ev.x, ev.y, ev.z, color, 0.35, endR, 0.22 + ev.power * 0.14, false);
        if (ev.backstab) {
          this.spawnPulse(ev.x, ev.y, ev.z, '#f59e0b', 0.45, endR * 1.45, 0.34, true);
        }
      }),
      events.on('projectile:explode', (ev) => {
        const dur = 0.28 + ev.power * 0.45;
        this.spawnPulse(ev.x, ev.y, ev.z, ev.colorHex, ev.radius * 0.25, ev.radius * 1.12, dur, false);
        this.spawnPulse(ev.x, ev.y, ev.z, '#ffffff', ev.radius * 0.18, ev.radius * 1.35, dur * 0.85, true);
      }),
      events.on('combat:dodge', (ev) => {
        this.spawnPulse(ev.x, ev.y, ev.z, '#bae6fd', 0.45, 2.8, 0.24, true);
      }),
      events.on('combat:guardbreak', (ev) => {
        const broken = players.find((pl) => pl.id === ev.playerId);
        if (broken) {
          this.spawnPulse(
            broken.pos.x,
            broken.pos.y + 1.1,
            broken.pos.z,
            '#ef4444',
            0.5,
            4.2,
            0.34,
            true,
          );
        }
      }),
      events.on('combat:clash', (ev) => {
        this.spawnPulse(ev.x, ev.y, ev.z, '#ffffff', 0.5, 6.2, 0.36, false);
        this.spawnPulse(ev.x, ev.y, ev.z, '#38bdf8', 0.6, 8.2, 0.42, true);
      }),
      events.on('combat:wallimpact', (ev) => {
        this.spawnPulse(ev.x, ev.y, ev.z, '#fb923c', 0.5, 4.6, 0.36, false);
        this.spawnPulse(ev.x, ev.y, ev.z, '#ffffff', 0.4, 5.8, 0.32, true);
      }),
      events.on('teleport:trigger', (ev) => {
        // Pós-imagem fantasmagórica na origem + anel de saída + flash/anel de chegada
        this.spawnAfterimage(ev.fromX, ev.fromY, ev.fromZ, ev.yaw, ev.colorHex);
        this.spawnPulse(ev.fromX, ev.fromY + 1.1, ev.fromZ, ev.colorHex, 0.35, 2.9, 0.25, true);
        this.spawnPulse(ev.toX, ev.toY + 1.1, ev.toZ, '#ffffff', 0.28, 2.4, 0.2, false);
        this.spawnPulse(
          ev.toX,
          ev.toY + 1.1,
          ev.toZ,
          ev.behindTarget ? '#fde047' : ev.colorHex,
          0.4,
          3.4,
          0.28,
          true,
        );
      }),
      events.on('fighter:death', (ev) => {
        const deadPlayer = players.find((pl) => pl.id === ev.playerId);
        if (deadPlayer) {
          this.spawnPulse(
            deadPlayer.pos.x,
            deadPlayer.pos.y + 1.0,
            deadPlayer.pos.z,
            '#f97316',
            0.6,
            6.5,
            0.48,
            false,
          );
          this.spawnPulse(
            deadPlayer.pos.x,
            deadPlayer.pos.y + 1.0,
            deadPlayer.pos.z,
            '#ffffff',
            0.5,
            8.0,
            0.42,
            true,
          );
        }
      }),
    );
  }

  public registerPlayer(player: Player): void {
    if (this.chargeOrbs.has(player.id)) {
      this.updatePlayerColor(player);
      return;
    }

    const group = new THREE.Group();
    group.visible = false;

    const core = new THREE.Mesh(this.sphereGeo, this.orbCoreMat);
    core.scale.setScalar(0.55);
    core.renderOrder = 9;

    const haloMat = new THREE.MeshBasicMaterial({
      color: player.appearance.ki,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const halo = new THREE.Mesh(this.sphereGeo, haloMat);
    halo.renderOrder = 8;

    group.add(halo, core);
    this.root.add(group);
    this.chargeOrbs.set(player.id, { group, core, halo, haloMat });
  }

  public unregisterPlayer(playerId: string): void {
    const orb = this.chargeOrbs.get(playerId);
    if (!orb) return;
    this.root.remove(orb.group);
    orb.haloMat.dispose();
    this.chargeOrbs.delete(playerId);
  }

  public updatePlayerColor(player: Player): void {
    const orb = this.chargeOrbs.get(player.id);
    if (orb) {
      orb.haloMat.color.set(player.appearance.ki);
    }
  }

  private spawnAfterimage(x: number, y: number, z: number, yaw: number, colorHex: string): void {
    const slot = this.afterimages[this.afterimageCursor % AFTERIMAGE_POOL_SIZE];
    this.afterimageCursor++;
    slot.active = true;
    slot.maxLife = 0.44;
    slot.life = slot.maxLife;
    slot.group.visible = true;
    slot.group.position.set(x, y, z);
    slot.group.rotation.set(0, yaw, 0);
    slot.group.scale.setScalar(1.0);
    slot.mat.color.set(colorHex);
    slot.mat.opacity = 0.58;
  }

  public spawnPulse(
    x: number,
    y: number,
    z: number,
    colorHex: string,
    startRadius: number,
    endRadius: number,
    duration: number,
    ringOnly: boolean,
  ): void {
    const slot = this.pulses[this.pulseCursor % PULSE_POOL_SIZE];
    this.pulseCursor++;

    slot.active = true;
    slot.life = duration;
    slot.maxLife = duration;
    slot.startRadius = startRadius;
    slot.endRadius = endRadius;
    slot.ringOnly = ringOnly;

    slot.group.visible = true;
    slot.group.position.set(x, y, z);
    slot.ring.rotation.set(
      (this.pulseCursor * 1.1) % Math.PI,
      (this.pulseCursor * 0.7) % Math.PI,
      0,
    );

    slot.sphere.visible = !ringOnly;
    slot.sphereMat.color.set(colorHex);
    slot.ringMat.color.set(colorHex);
    slot.sphere.scale.setScalar(startRadius);
    slot.ring.scale.setScalar(startRadius * 1.1);
  }

  public update(
    dt: number,
    projectiles: ProjectileSlot[],
    beams: BeamFx[],
    players: Player[],
    characterMeshes: Map<string, CharacterMesh>,
  ): void {
    // 1. Atualiza projéteis no pool
    for (let i = 0; i < this.projVisuals.length; i++) {
      const p = projectiles[i];
      const vis = this.projVisuals[i];
      if (!p || !p.active) {
        vis.group.visible = false;
        continue;
      }

      vis.group.visible = true;
      vis.group.position.set(p.x, p.y, p.z);
      this._v1.set(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      vis.group.lookAt(this._v1);

      const r = p.radius;
      vis.core.scale.set(r * 0.62, r * 0.62, r * 1.05);
      vis.glow.scale.set(r * 1.2, r * 1.2, r * 2.3);
      vis.glowMat.color.set(p.colorHex);
    }

    // 2. Atualiza raios (BeamFx)
    for (let i = 0; i < this.beamVisuals.length; i++) {
      const b = beams[i];
      const vis = this.beamVisuals[i];
      if (!b || !b.active || b.life <= 0) {
        vis.group.visible = false;
        continue;
      }

      const t = Math.max(0, b.life / b.maxLife);
      this._v1.set(b.startX, b.startY, b.startZ);
      this._v2.set(b.endX, b.endY, b.endZ);
      const length = this._v1.distanceTo(this._v2);

      vis.group.visible = length > 0.05;
      vis.group.position.copy(this._v1);
      vis.group.lookAt(this._v2);

      const radiusFactor = Math.max(0.08, t);
      const w = b.width * radiusFactor;
      vis.core.scale.set(w * 0.45, w * 0.45, length);
      vis.shell.scale.set(w * 1.05, w * 1.05, length);
      vis.shellMat.color.set(b.colorHex);
      vis.coreMat.opacity = 0.95 * t;
      vis.shellMat.opacity = 0.62 * t;
    }

    // 3. Atualiza pulsos expansivos
    for (let i = 0; i < this.pulses.length; i++) {
      const slot = this.pulses[i];
      if (!slot.active) continue;

      slot.life -= dt;
      if (slot.life <= 0) {
        slot.active = false;
        slot.group.visible = false;
        continue;
      }

      const progress = 1 - slot.life / slot.maxLife;
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const radius = slot.startRadius + (slot.endRadius - slot.startRadius) * easeOut;
      const alpha = 1 - progress;

      if (!slot.ringOnly) {
        slot.sphere.scale.setScalar(radius);
        slot.sphereMat.opacity = alpha * 0.52;
      }
      slot.ring.scale.setScalar(radius * 1.25);
      slot.ringMat.opacity = alpha * 0.78;
    }

    // 4. Atualiza pós-imagens de teleporte
    for (let i = 0; i < this.afterimages.length; i++) {
      const slot = this.afterimages[i];
      if (!slot.active) continue;

      slot.life -= dt;
      if (slot.life <= 0) {
        slot.active = false;
        slot.group.visible = false;
        continue;
      }

      const ratio = slot.life / slot.maxLife;
      slot.mat.opacity = ratio * 0.58;
      slot.group.scale.set(1 + (1 - ratio) * 0.14, 1 + (1 - ratio) * 0.06, 1 + (1 - ratio) * 0.14);
    }

    // 5. Atualiza orbes de carga na frente dos atiradores
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const orb = this.chargeOrbs.get(player.id);
      if (!orb) continue;

      if (player.combat.castTimer <= 0 || player.combat.castSlot <= 0) {
        orb.group.visible = false;
        continue;
      }

      const skill = getSkillBySlot(player.combat.castSlot);
      if (!skill) {
        orb.group.visible = false;
        continue;
      }

      const mesh = characterMeshes.get(player.id);
      const px = mesh ? mesh.root.position.x : player.pos.x;
      const py = mesh ? mesh.root.position.y : player.pos.y;
      const pz = mesh ? mesh.root.position.z : player.pos.z;

      const yaw = player.combat.aimYaw;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);

      const prog = player.combat.castProgress();
      const isUltimate = skill.kind === 'ultimate';
      const maxSize = isUltimate ? 3.2 : skill.kind === 'beam' ? 1.15 : 0.6;
      const curSize = 0.2 + prog * maxSize;
      const distAhead = 1.05 + curSize * 0.7;

      this._v3.set(
        px + fx * distAhead,
        py + (isUltimate ? 2.45 : 1.22),
        pz + fz * distAhead,
      );
      orb.group.visible = true;
      orb.group.position.copy(this._v3);

      const pulse = 1 + Math.sin(prog * 36) * 0.08;
      orb.group.scale.setScalar(curSize * pulse);
      orb.haloMat.color.set(player.appearance.ki || skill.cor);
      orb.haloMat.opacity = 0.45 + prog * 0.45;
    }
  }

  public dispose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    for (const orb of this.chargeOrbs.values()) {
      orb.haloMat.dispose();
    }
    this.chargeOrbs.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.parent?.remove(this.root);
  }
}
