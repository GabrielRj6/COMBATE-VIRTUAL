import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Game, HudTelemetry, RemoteLabelTelemetry } from '../core/Game';
import { Input } from '../core/Input';
import { Time } from '../core/Time';
import { CharacterMesh } from '../entities/CharacterMesh';
import { FighterState } from '../entities/Fighter';
import { CharacterAppearance, Player } from '../entities/Player';
import { AudioEngine } from '../fx/AudioEngine';
import { CombatFX } from '../fx/CombatFX';
import { NetManager } from '../net/NetManager';
import type { NetStatusInfo } from '../net/Protocol';
import { World } from '../world/World';
import { groundHeightAt } from '../world/WorldGeometry';

interface SpeedStreak {
  x: number;
  y: number;
  z: number;
  life: number;
  maxLife: number;
}

/**
 * Detecta renderização WebGL em software (SwiftShader, llvmpipe, WARP) pela string da GPU.
 * Usado apenas para ajustar custo gráfico (pixelRatio, sombras, pacing afterDraw).
 */
export function detectSoftwareWebGL(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export interface SceneRendererCallbacks {
  onHudUpdate: (telemetry: HudTelemetry) => void;
  onPointerLockChange: (locked: boolean) => void;
  onToggleDebug: () => void;
  onToggleControlsDock: () => void;
  onToggleMenu: () => void;
  onNetStatusChange: (status: NetStatusInfo) => void;
  onContextLost: () => void;
  onContextRestored: () => void;
}

/**
 * Controla o WebGLRenderer, câmera de 3ª pessoa (com lock-on e shake),
 * loop 60Hz + render interpolado, efeitos de combate/teleporte, customização dinâmica
 * e multiplayer online (PeerJS Host-Autoritativo + WebSocket opcional).
 */
export class SceneRenderer {
  public readonly isSoftwareGl: boolean;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly game: Game;
  public readonly input: Input;
  public readonly audio: AudioEngine;
  public readonly net: NetManager;

  private readonly time = new Time();
  private readonly world: World;
  private readonly combatFX: CombatFX;
  private readonly characterMeshes = new Map<string, CharacterMesh>();
  private readonly callbacks: SceneRendererCallbacks;
  private readonly container: HTMLElement;

  // Pool de linhas de velocidade (zero GC no loop)
  private readonly streakCount = 42;
  private readonly streaks: SpeedStreak[] = [];
  private readonly streakMesh: THREE.InstancedMesh;
  private streakCursor = 0;

  // Estado suave da câmera em 3ª pessoa
  private camFocusPos = new THREE.Vector3(0, 2, 18);
  private camCurrentPos = new THREE.Vector3(0, 4.5, 26);
  private currentFov = 62;

  // Screen shake
  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeTimeLeft = 0;

  // Projeções 2D reutilizáveis (alvo travado + nameplates dos jogadores remotos)
  private readonly _lockScreen = { screenX: 50, screenY: 50, onScreen: false };
  private _remoteLabels: RemoteLabelTelemetry[] = [];

  // Vetores/objetos pré-alocados (zero GC)
  private readonly _tmpVec1 = new THREE.Vector3();
  private readonly _tmpVec2 = new THREE.Vector3();
  private readonly _tmpProj = new THREE.Vector3();
  private readonly _tmpObj = new THREE.Object3D();

  private frameId = 0;
  private running = false;
  private hudSyncAccum = 0;
  private unsubscribers: Array<() => void> = [];

  constructor(container: HTMLElement, callbacks: SceneRendererCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.scene = new THREE.Scene();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.2, 3400);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // Ambiente PBR procedural (RoomEnvironment)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Inicializa núcleo da simulação (sem bots), entrada, áudio e multiplayer
    this.game = new Game();
    this.input = new Input(this.renderer.domElement, {
      onPointerLockChange: callbacks.onPointerLockChange,
      onToggleDebug: callbacks.onToggleDebug,
      onToggleControlsDock: callbacks.onToggleControlsDock,
      onToggleMenu: callbacks.onToggleMenu,
    });
    this.audio = new AudioEngine(this.game.events, this.game.localPlayer.id);
    this.net = new NetManager(this.game, callbacks.onNetStatusChange);

    // Constrói cenário 3D aberto e efeitos de combate/teleporte em pool
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.world = new World(
      this.scene,
      this.game.colliders,
      maxAniso,
      !this.isSoftwareGl,
    );
    this.combatFX = new CombatFX(this.scene, this.game.events, this.game.allPlayers);

    // Cria mesh do jogador local
    for (const player of this.game.allPlayers) {
      this.mountCharacterMesh(player);
    }

    // Pool de partículas aerodinâmicas de velocidade
    const streakGeo = new THREE.BoxGeometry(0.06, 0.06, 2.4);
    const streakMat = new THREE.MeshBasicMaterial({
      color: '#bae6fd',
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.streakMesh = new THREE.InstancedMesh(streakGeo, streakMat, this.streakCount);
    this.streakMesh.frustumCulled = false;
    this._tmpObj.scale.set(0, 0, 0);
    this._tmpObj.updateMatrix();
    for (let i = 0; i < this.streakCount; i++) {
      this.streaks.push({ x: 0, y: -999, z: 0, life: 0, maxLife: 0.35 });
      this.streakMesh.setMatrixAt(i, this._tmpObj.matrix);
    }
    this.streakMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.streakMesh);

    // Conecta eventos da simulação aos efeitos visuais, câmera e ciclo de vida dos jogadores online
    this.unsubscribers.push(
      this.game.events.on('flight:toggle', ({ playerId, flying }) => {
        if (flying) this.characterMeshes.get(playerId)?.aura.triggerPulse();
      }),
      this.game.events.on('boost:start', ({ playerId }) => {
        this.characterMeshes.get(playerId)?.aura.triggerPulse();
      }),
      this.game.events.on('player:dash', ({ playerId }) => {
        this.characterMeshes.get(playerId)?.aura.triggerPulse();
      }),
      this.game.events.on('combat:hit', ({ targetId, power }) => {
        this.characterMeshes.get(targetId)?.flash(power);
      }),
      this.game.events.on('player:added', ({ playerId }) => {
        const player = this.game.combat.findPlayerById(playerId);
        if (player) {
          this.mountCharacterMesh(player);
          this.combatFX.registerPlayer(player);
        }
      }),
      this.game.events.on('player:removed', ({ playerId }) => {
        this.unmountCharacterMesh(playerId);
        this.combatFX.unregisterPlayer(playerId);
      }),
      this.game.events.on('player:appearance', ({ playerId }) => {
        const player = this.game.combat.findPlayerById(playerId);
        if (player) {
          this.unmountCharacterMesh(playerId);
          this.mountCharacterMesh(player);
          this.combatFX.updatePlayerColor(player);
        }
      }),
      this.game.events.on('camera:shake', ({ intensity, duration }) => {
        const currentStrength =
          this.shakeDuration > 0
            ? this.shakeIntensity * (this.shakeTimeLeft / this.shakeDuration)
            : 0;
        if (intensity >= currentStrength) {
          this.shakeIntensity = Math.min(1.4, intensity);
          this.shakeDuration = Math.max(0.08, duration);
          this.shakeTimeLeft = this.shakeDuration;
        }
      }),
    );

    // Posição inicial da câmera atrás do jogador local
    const lp = this.game.localPlayer;
    this.camFocusPos.set(lp.pos.x, lp.pos.y + 1.75, lp.pos.z);
    this.camCurrentPos.set(lp.pos.x, lp.pos.y + 3.6, lp.pos.z + 8.0);
    this.camera.position.copy(this.camCurrentPos);
    this.camera.lookAt(this.camFocusPos);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindLifecycleEvents();
  }

  private mountCharacterMesh(player: Player): void {
    this.unmountCharacterMesh(player.id);
    const charMesh = new CharacterMesh(player);
    this.characterMeshes.set(player.id, charMesh);
    this.scene.add(charMesh.root, charMesh.contactShadow);
    charMesh.sync(player, 1, 0.016);
  }

  private unmountCharacterMesh(playerId: string): void {
    const existing = this.characterMeshes.get(playerId);
    if (!existing) return;
    this.scene.remove(existing.root, existing.contactShadow);
    existing.dispose();
    this.characterMeshes.delete(playerId);
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.time.reset(performance.now());
    this.tick();
  }

  public stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);
  }

  public setPaused(paused: boolean): void {
    this.input.setPaused(paused);
  }

  public requestPointerLock(): void {
    this.audio.unlock();
    this.input.requestPointerLock();
  }

  public resetCamera(): void {
    this.input.resetCameraBehind(this.game.localPlayer.facingYaw + Math.PI);
  }

  public respawnAtPlaza(): void {
    this.game.respawnLocalAtPlaza();
    this.input.resetCameraBehind(0);
  }

  public getLocalAppearance(): CharacterAppearance {
    return this.game.localPlayer.appearance;
  }

  public applyLocalAppearance(appearance: CharacterAppearance): void {
    this.game.setLocalAppearance(appearance);
    this.net.broadcastLocalAppearance(this.game.localPlayer.appearance);
  }

  public hostRoom(customCode?: string): void {
    this.audio.unlock();
    this.net.hostRoom(customCode);
  }

  public joinRoom(code: string): void {
    this.audio.unlock();
    this.net.joinRoom(code);
  }

  public connectWebSocket(url: string): void {
    this.audio.unlock();
    this.net.connectWebSocket(url);
  }

  public leaveRoom(): void {
    this.net.leaveRoom();
  }

  public getNetStatus(): NetStatusInfo {
    return this.net.getStatus();
  }

  /** Loop principal: fixed timestep 60Hz + rede + render interpolado + pacing seguro em software WebGL. */
  private tick = (): void => {
    if (!this.running) return;

    const now = performance.now();
    const frameDt = this.time.advance(now, (fixedDt, tickNum) => {
      const cmd = this.input.sampleCommand(tickNum);
      this.game.fixedUpdate(fixedDt, tickNum, cmd);
      this.net.sendLocalCommand(cmd);
    });

    this.net.tickNetwork(frameDt);
    this.input.updateContinuousLook(frameDt);

    const interpAlpha = this.game.hitStop > 0 ? 1 : this.time.alpha;

    for (let i = 0; i < this.game.allPlayers.length; i++) {
      const player = this.game.allPlayers[i];
      const mesh = this.characterMeshes.get(player.id);
      if (mesh) {
        mesh.sync(player, interpAlpha, frameDt);
      }
    }

    const lp = this.game.localPlayer;
    const localMesh = this.characterMeshes.get(lp.id);
    const focusX = localMesh ? localMesh.root.position.x : lp.pos.x;
    const focusY = localMesh ? localMesh.root.position.y : lp.pos.y;
    const focusZ = localMesh ? localMesh.root.position.z : lp.pos.z;

    this.updateThirdPersonCamera(focusX, focusY, focusZ, frameDt);
    this.world.updateFocus(focusX, focusY, focusZ, frameDt);
    this.updateSpeedStreaks(focusX, focusY, focusZ, frameDt);
    this.combatFX.update(
      frameDt,
      this.game.combat.projectiles,
      this.game.combat.beams,
      this.game.allPlayers,
      this.characterMeshes,
    );
    this.audio.updateContinuous(lp.getSpeed(), lp.flyMode, lp.isBoosting, lp.isCharging);

    this.renderer.render(this.scene, this.camera);

    // Telemetria para HUD (~20Hz) incluindo projeções 2D do alvo travado e jogadores online
    this.hudSyncAccum += frameDt;
    if (this.hudSyncAccum >= 0.05) {
      this.hudSyncAccum = 0;
      this.projectLockedTarget();
      this.projectRemoteLabels();
      const netStatus = this.net.getStatus();
      this.callbacks.onHudUpdate(
        this.game.getHudTelemetry(
          this.time.fps,
          this._lockScreen,
          this._remoteLabels,
          {
            mode: netStatus.mode,
            roomCode: netStatus.roomCode,
            pingMs: netStatus.pingMs,
          },
        ),
      );
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (!this.running) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private updateThirdPersonCamera(px: number, py: number, pz: number, dt: number): void {
    const lp = this.game.localPlayer;

    if (lp.combat.lockTargetId) {
      const target = this.game.combat.findPlayerById(lp.combat.lockTargetId);
      if (target && target.fighter.state !== FighterState.DEAD) {
        const targetMesh = this.characterMeshes.get(target.id);
        const tx = targetMesh ? targetMesh.root.position.x : target.pos.x;
        const ty = targetMesh ? targetMesh.root.position.y : target.pos.y;
        const tz = targetMesh ? targetMesh.root.position.z : target.pos.z;

        const dx = tx - px;
        const dy = ty - py;
        const dz = tz - pz;
        const distH = Math.hypot(dx, dz) || 0.001;

        const targetYaw = Math.atan2(-dx, -dz);
        const targetPitch = Math.max(-0.55, Math.min(1.0, 0.22 - Math.atan2(dy, distH) * 0.55));
        this.input.steerCamera(targetYaw, targetPitch, dt, 7.0);
      }
    }

    const yaw = this.input.cameraYaw;
    const pitch = this.input.cameraPitch;

    const boostExtraDist = lp.isBoosting ? 2.4 : lp.flyMode ? 0.9 : 0;
    const dist = this.input.cameraDistance + boostExtraDist;

    this._tmpVec1.set(px, py + 1.85, pz);
    const focusAlpha = 1 - Math.exp(-16 * dt);
    this.camFocusPos.lerp(this._tmpVec1, focusAlpha);

    const cosPitch = Math.cos(pitch);
    const desiredX = this.camFocusPos.x + Math.sin(yaw) * cosPitch * dist;
    const desiredY = this.camFocusPos.y + Math.sin(pitch) * dist + 0.65;
    const desiredZ = this.camFocusPos.z + Math.cos(yaw) * cosPitch * dist;

    const minCamY = groundHeightAt(desiredX, desiredZ) + 0.75;
    this._tmpVec2.set(desiredX, Math.max(minCamY, desiredY), desiredZ);

    const posAlpha = 1 - Math.exp(-(lp.isBoosting ? 12.5 : 15) * dt);
    this.camCurrentPos.lerp(this._tmpVec2, posAlpha);

    this.camera.position.copy(this.camCurrentPos);

    let rollOffset = 0;
    if (this.shakeTimeLeft > 0) {
      this.shakeTimeLeft = Math.max(0, this.shakeTimeLeft - dt);
      const decay = this.shakeDuration > 0 ? this.shakeTimeLeft / this.shakeDuration : 0;
      const k = this.shakeIntensity * decay;
      const amp = 0.38 * k * k + 0.1 * k;
      this.camera.position.x += (Math.random() * 2 - 1) * amp;
      this.camera.position.y += (Math.random() * 2 - 1) * amp;
      this.camera.position.z += (Math.random() * 2 - 1) * amp;
      rollOffset = (Math.random() * 2 - 1) * amp * 0.08;
    }

    this.camera.lookAt(this.camFocusPos);
    if (rollOffset !== 0) {
      this.camera.rotation.z += rollOffset;
    }

    const targetFov = lp.isBoosting ? 78 : lp.flyMode && lp.getSpeed() > 26 ? 68 : 62;
    if (Math.abs(this.currentFov - targetFov) > 0.05) {
      this.currentFov = THREE.MathUtils.damp(this.currentFov, targetFov, 7.5, dt);
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  private projectLockedTarget(): void {
    const targetId = this.game.localPlayer.combat.lockTargetId;
    if (!targetId) {
      this._lockScreen.onScreen = false;
      return;
    }

    const target = this.game.combat.findPlayerById(targetId);
    if (!target || target.fighter.state === FighterState.DEAD) {
      this._lockScreen.onScreen = false;
      return;
    }

    const mesh = this.characterMeshes.get(target.id);
    if (mesh) {
      this._tmpProj.set(
        mesh.root.position.x,
        mesh.root.position.y + 1.15,
        mesh.root.position.z,
      );
    } else {
      this._tmpProj.set(target.pos.x, target.pos.y + 1.15, target.pos.z);
    }

    this._tmpProj.project(this.camera);
    const sx = (this._tmpProj.x * 0.5 + 0.5) * 100;
    const sy = (-this._tmpProj.y * 0.5 + 0.5) * 100;
    const inFront = this._tmpProj.z >= -1 && this._tmpProj.z <= 1;

    this._lockScreen.screenX = sx;
    this._lockScreen.screenY = sy;
    this._lockScreen.onScreen = inFront && sx >= 0 && sx <= 100 && sy >= 0 && sy <= 100;
  }

  private projectRemoteLabels(): void {
    const remotes = this.game.remotePlayers;
    const lp = this.game.localPlayer;
    const out: RemoteLabelTelemetry[] = [];

    for (let i = 0; i < remotes.length; i++) {
      const rp = remotes[i];
      const mesh = this.characterMeshes.get(rp.id);
      const rx = mesh ? mesh.root.position.x : rp.pos.x;
      const ry = mesh ? mesh.root.position.y : rp.pos.y;
      const rz = mesh ? mesh.root.position.z : rp.pos.z;

      const dist = Math.hypot(rx - lp.pos.x, ry - lp.pos.y, rz - lp.pos.z);
      this._tmpProj.set(rx, ry + 2.45 * rp.appearance.altura, rz);
      this._tmpProj.project(this.camera);

      const sx = (this._tmpProj.x * 0.5 + 0.5) * 100;
      const sy = (-this._tmpProj.y * 0.5 + 0.5) * 100;
      const inFront = this._tmpProj.z >= -1 && this._tmpProj.z <= 1;

      out.push({
        id: rp.id,
        nome: rp.name,
        hp: Math.round(rp.fighter.hp),
        maxHp: rp.fighter.maxHp,
        dist: Math.round(dist),
        screenX: sx,
        screenY: sy,
        onScreen: inFront && sx >= 2 && sx <= 98 && sy >= 4 && sy <= 94 && dist < 240,
        dead: rp.fighter.state === FighterState.DEAD,
      });
    }

    this._remoteLabels = out;
  }

  private updateSpeedStreaks(px: number, py: number, pz: number, dt: number): void {
    const lp = this.game.localPlayer;
    const speed = lp.getSpeed();

    if (lp.flyMode && speed > 30) {
      const spawnPerFrame = lp.isBoosting ? 3 : 1;
      for (let s = 0; s < spawnPerFrame; s++) {
        const idx = this.streakCursor % this.streakCount;
        this.streakCursor++;
        const st = this.streaks[idx];
        const angle = (idx * 2.39996) % (Math.PI * 2);
        const radius = lp.isBoosting ? 1.4 + (idx % 5) * 0.7 : 1.0 + (idx % 3) * 0.5;
        st.x = px + Math.cos(angle) * radius;
        st.y = py + 1.1 + Math.sin(angle) * radius;
        st.z = pz + Math.sin(angle * 1.7) * radius;
        st.maxLife = lp.isBoosting ? 0.28 : 0.22;
        st.life = st.maxLife;
      }
    }

    const vx = lp.vel.x;
    const vy = lp.vel.y;
    const vz = lp.vel.z;
    let dirty = false;

    for (let i = 0; i < this.streakCount; i++) {
      const st = this.streaks[i];
      if (st.life > 0) {
        st.life -= dt;
        dirty = true;
        if (st.life <= 0) {
          this._tmpObj.scale.set(0, 0, 0);
          this._tmpObj.updateMatrix();
          this.streakMesh.setMatrixAt(i, this._tmpObj.matrix);
        } else {
          const ratio = st.life / st.maxLife;
          this._tmpObj.position.set(st.x, st.y, st.z);
          this._tmpVec1.set(st.x + vx, st.y + vy, st.z + vz);
          this._tmpObj.lookAt(this._tmpVec1);
          this._tmpObj.scale.set(ratio, ratio, 0.7 + (speed / 65) * ratio);
          this._tmpObj.updateMatrix();
          this.streakMesh.setMatrixAt(i, this._tmpObj.matrix);
        }
      }
    }

    if (dirty) {
      this.streakMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private onResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private onUserUnlockAudio = (): void => {
    this.audio.unlock();
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.stop();
    this.callbacks.onContextLost();
  };

  private onContextRestored = (): void => {
    this.callbacks.onContextRestored();
    this.start();
  };

  private bindLifecycleEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onUserUnlockAudio, { once: true });
    this.renderer.domElement.addEventListener('pointerdown', this.onUserUnlockAudio, {
      once: true,
    });
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  public dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onUserUnlockAudio);
    this.renderer.domElement.removeEventListener('pointerdown', this.onUserUnlockAudio);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.net.dispose();

    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    for (const mesh of this.characterMeshes.values()) {
      mesh.dispose();
    }
    this.characterMeshes.clear();

    this.combatFX.dispose();
    this.streakMesh.geometry.dispose();
    (this.streakMesh.material as THREE.Material).dispose();
    this.world.dispose();
    this.input.dispose();
    this.audio.dispose();

    if (this.scene.environment) {
      this.scene.environment.dispose();
    }

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
