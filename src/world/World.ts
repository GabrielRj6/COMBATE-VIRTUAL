import * as THREE from 'three';
import { SeededRNG } from '../core/RNG';
import {
  groundHeightAt,
  WORLD_HALF_SIZE,
  WorldBoxCollider,
} from './WorldGeometry';

/** Cria textura procedural de terreno com grade tática sutil e variação de superfície. */
function createTerrainTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Base neutra clara para multiplicar pelas cores dos vértices
  ctx.fillStyle = '#d8dee6';
  ctx.fillRect(0, 0, size, size);

  // Grão orgânico sutil (determinístico)
  const rng = new SeededRNG(9901);
  for (let i = 0; i < 4200; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const w = rng.range(2, 9);
    const h = rng.range(2, 9);
    const shade = rng.int(192, 232);
    ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 4})`;
    ctx.fillRect(x, y, w, h);
  }

  // Linhas de grade sutis para dar excelente percepção de velocidade durante o voo
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 2;
  const step = 64;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/** Cria textura procedural de fachada arquitetônica com janelas e divisórias de andares. */
function createBuildingFacadeTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, 0, 256, 512);

  // Andares e janelas estilizadas
  const cols = 4;
  const rows = 12;
  const padX = 12;
  const padY = 10;
  const cellW = 256 / cols;
  const cellH = 512 / rows;

  const rng = new SeededRNG(7712);
  for (let r = 0; r < rows; r++) {
    // Faixa estrutural do pavimento
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(0, r * cellH, 256, 4);

    for (let c = 0; c < cols; c++) {
      const lit = rng.next() > 0.72;
      ctx.fillStyle = lit ? '#7dd3fc' : '#334155';
      ctx.fillRect(
        c * cellW + padX * 0.5,
        r * cellH + padY * 0.6,
        cellW - padX,
        cellH - padY,
      );
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/** Cria textura da praça central de treinamento. */
function createPlazaTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;

  // Disco pavimentado principal
  ctx.beginPath();
  ctx.arc(cx, cy, 240, 0, Math.PI * 2);
  ctx.fillStyle = '#1e293b';
  ctx.fill();

  // Anel externo ciano
  ctx.beginPath();
  ctx.arc(cx, cy, 232, 0, Math.PI * 2);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 6;
  ctx.stroke();

  // Anel interno laranja
  ctx.beginPath();
  ctx.arc(cx, cy, 130, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(249, 115, 22, 0.72)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Linhas cardeais
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 32, cy + Math.sin(a) * 32);
    ctx.lineTo(cx + Math.cos(a) * 230, cy + Math.sin(a) * 230);
    ctx.stroke();
  }

  // Emblema central
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, Math.PI * 2);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Mundo aberto 3D da Fase 1: terreno 4km x 4km, céu atmosférico, nuvens em altitude,
 * praça central, prédios compostos de referência e natureza instanciada.
 */
export class World {
  public readonly group = new THREE.Group();
  public readonly sunLight: THREE.DirectionalLight;
  public readonly sunTarget = new THREE.Object3D();

  private cloudsMesh: THREE.InstancedMesh | null = null;
  private skyDome: THREE.Mesh | null = null;
  private disposables: Array<{ dispose: () => void }> = [];

  // Offset do sol em relação ao jogador para manter sombras nítidas em qualquer ponto do mapa
  private readonly sunOffset = new THREE.Vector3(95, 165, 75);

  constructor(
    scene: THREE.Scene,
    colliders: WorldBoxCollider[],
    maxAnisotropy: number,
    enableShadows: boolean,
  ) {
    // Cor de horizonte e névoa perfeitamente sincronizadas
    const horizonColor = new THREE.Color('#9ec9e6');
    scene.background = horizonColor;
    scene.fog = new THREE.FogExp2('#9ec9e6', 0.00058);

    // Iluminação 3 pontos: Sol quente + HemisphereLight fria céu/solo + Luz de recorte
    const hemiLight = new THREE.HemisphereLight('#bfe4ff', '#3a4a3f', 0.82);
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff2db', 2.05);
    this.sunLight.position.copy(this.sunOffset);
    this.sunLight.target = this.sunTarget;
    if (enableShadows) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(2048, 2048);
      const d = 95;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.camera.near = 15;
      this.sunLight.shadow.camera.far = 360;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.035;
    }
    scene.add(this.sunLight, this.sunTarget);

    const rimLight = new THREE.DirectionalLight('#60a5fa', 0.45);
    rimLight.position.set(-120, 80, -140);
    scene.add(rimLight);

    // Constrói os elementos do mundo
    this.buildSkyDome();
    this.buildTerrain(maxAnisotropy);
    this.buildCentralPlaza(maxAnisotropy);
    this.buildReferenceStructures(colliders, maxAnisotropy);
    this.buildInstancedNature();
    this.buildSkyClouds();

    scene.add(this.group);
  }

  private buildSkyDome(): void {
    const skyGeo = new THREE.SphereGeometry(2800, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color('#1a4d8f') },
        midColor: { value: new THREE.Color('#5a9fd4') },
        horizonColor: { value: new THREE.Color('#9ec9e6') },
        sunDir: { value: this.sunOffset.clone().normalize() },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 sunDir;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.25, h));
          col = mix(col, topColor, smoothstep(0.22, 0.85, h));

          // Disco solar suave no céu
          float sunDot = max(dot(dir, sunDir), 0.0);
          col += vec3(1.0, 0.92, 0.78) * pow(sunDot, 48.0) * 0.45;
          col += vec3(1.0, 0.97, 0.9) * smoothstep(0.9985, 0.9996, sunDot) * 1.1;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.frustumCulled = false;
    this.group.add(this.skyDome);
    this.disposables.push(skyGeo, skyMat);
  }

  private buildTerrain(maxAnisotropy: number): void {
    const size = WORLD_HALF_SIZE * 2;
    const segments = 180;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const tmpColor = new THREE.Color();

    const plazaColor = new THREE.Color('#475569');
    const grassColor = new THREE.Color('#4a7c59');
    const highlandColor = new THREE.Color('#64745c');
    const rockColor = new THREE.Color('#6b7280');
    const snowPeakColor = new THREE.Color('#cbd5e1');

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = groundHeightAt(x, z);
      pos.setY(i, y);

      const dist = Math.hypot(x, z);
      if (dist < 225) {
        tmpColor.copy(plazaColor).lerp(grassColor, Math.max(0, (dist - 190) / 35));
      } else if (y < 24) {
        tmpColor.copy(grassColor).lerp(highlandColor, Math.min(1, y / 24));
      } else if (y < 95) {
        tmpColor.copy(highlandColor).lerp(rockColor, Math.min(1, (y - 24) / 70));
      } else {
        tmpColor.copy(rockColor).lerp(snowPeakColor, Math.min(1, (y - 95) / 110));
      }

      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const terrainTex = createTerrainTexture(maxAnisotropy);
    const mat = new THREE.MeshStandardMaterial({
      map: terrainTex,
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.04,
    });

    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    this.group.add(terrain);
    this.disposables.push(geo, mat, terrainTex);
  }

  private buildCentralPlaza(maxAnisotropy: number): void {
    // Disco da arena com polygonOffset e elevação +0.03 para zero Z-fighting
    const plazaGeo = new THREE.PlaneGeometry(118, 118);
    plazaGeo.rotateX(-Math.PI / 2);
    const plazaTex = createPlazaTexture(maxAnisotropy);
    const plazaMat = new THREE.MeshStandardMaterial({
      map: plazaTex,
      transparent: true,
      roughness: 0.72,
      metalness: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.position.set(0, 0.03, 0);
    plaza.receiveShadow = true;
    this.group.add(plaza);
    this.disposables.push(plazaGeo, plazaMat, plazaTex);

    // 4 balizas luminosas cardeais ao redor da praça (modelos compostos de 3 partes)
    const baseGeo = new THREE.CylinderGeometry(1.1, 1.4, 1.4, 8);
    const shaftGeo = new THREE.CylinderGeometry(0.45, 0.6, 5.2, 8);
    const orbGeo = new THREE.OctahedronGeometry(0.75, 0);
    const metalMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.32,
      metalness: 0.72,
    });
    const glowCyanMat = new THREE.MeshStandardMaterial({
      color: '#38bdf8',
      emissive: '#38bdf8',
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.3,
    });
    this.disposables.push(baseGeo, shaftGeo, orbGeo, metalMat, glowCyanMat);

    const beaconPositions: Array<[number, number]> = [
      [0, -56],
      [0, 56],
      [-56, 0],
      [56, 0],
    ];

    for (const [bx, bz] of beaconPositions) {
      const pylon = new THREE.Group();
      pylon.position.set(bx, groundHeightAt(bx, bz), bz);

      const base = new THREE.Mesh(baseGeo, metalMat);
      base.position.y = 0.7;
      base.castShadow = true;
      base.receiveShadow = true;

      const shaft = new THREE.Mesh(shaftGeo, metalMat);
      shaft.position.y = 3.8;
      shaft.castShadow = true;

      const orb = new THREE.Mesh(orbGeo, glowCyanMat);
      orb.position.y = 7.1;

      pylon.add(base, shaft, orb);
      this.group.add(pylon);
    }
  }

  /**
   * Constrói prédios e torres compostos (corpo + parapeito metálico + faixa luminosa + topo)
   * alinhados perfeitamente aos colliders AABB da simulação.
   */
  private buildReferenceStructures(
    colliders: WorldBoxCollider[],
    maxAnisotropy: number,
  ): void {
    const facadeTex = createBuildingFacadeTexture(maxAnisotropy);
    const roofTrimMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.34,
      metalness: 0.65,
    });
    this.disposables.push(facadeTex, roofTrimMat);

    // Cache de materiais por cor para economizar draw calls / memória
    const bodyMats = new Map<number, THREE.MeshStandardMaterial>();
    const accentMats = new Map<number, THREE.MeshStandardMaterial>();

    const getBodyMat = (hex: number) => {
      let mat = bodyMats.get(hex);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: hex,
          map: facadeTex,
          roughness: 0.72,
          metalness: 0.18,
        });
        bodyMats.set(hex, mat);
        this.disposables.push(mat);
      }
      return mat;
    };

    const getAccentMat = (hex: number) => {
      let mat = accentMats.get(hex);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 0.95,
          roughness: 0.25,
          metalness: 0.4,
        });
        accentMats.set(hex, mat);
        this.disposables.push(mat);
      }
      return mat;
    };

    // Geometria unitária reutilizada para corpo, topo e faixa luminosa
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.disposables.push(unitBox);

    for (const c of colliders) {
      const building = new THREE.Group();
      building.position.set(c.centerX, c.minY, c.centerZ);

      // 1. Corpo principal
      const body = new THREE.Mesh(unitBox, getBodyMat(c.colorHex));
      body.scale.set(c.width, c.height, c.depth);
      body.position.y = c.height * 0.5;
      body.castShadow = true;
      body.receiveShadow = true;
      building.add(body);

      // 2. Plinto de fundação metálico
      const plinthH = Math.min(2.4, c.height * 0.2);
      const plinth = new THREE.Mesh(unitBox, roofTrimMat);
      plinth.scale.set(c.width + 0.5, plinthH, c.depth + 0.5);
      plinth.position.y = plinthH * 0.5;
      plinth.receiveShadow = true;
      building.add(plinth);

      // 3. Coroa / parapeito no topo
      const crownH = 1.1;
      const crown = new THREE.Mesh(unitBox, roofTrimMat);
      crown.scale.set(c.width + 0.4, crownH, c.depth + 0.4);
      crown.position.y = c.height - crownH * 0.5 + 0.05;
      crown.castShadow = true;
      crown.receiveShadow = true;
      building.add(crown);

      // 4. Faixa luminosa de horizonte em torres e monólitos
      if (c.kind === 'tower' || c.kind === 'monolith') {
        const band = new THREE.Mesh(unitBox, getAccentMat(c.accentHex));
        band.scale.set(c.width + 0.65, 0.55, c.depth + 0.65);
        band.position.y = c.height - 2.6;
        building.add(band);

        // Antena/pináculo nos monólitos cardeais
        if (c.kind === 'monolith') {
          const spire = new THREE.Mesh(unitBox, roofTrimMat);
          spire.scale.set(c.width * 0.32, 16, c.depth * 0.32);
          spire.position.y = c.height + 8;
          building.add(spire);
        }
      }

      this.group.add(building);
    }
  }

  /**
   * Árvores e rochas distribuídas nas colinas externas usando InstancedMesh (alta performance).
   */
  private buildInstancedNature(): void {
    const rng = new SeededRNG(55123);

    // Árvores compostas (tronco + 2 copas instanciadas)
    const treeCount = 320;
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.55, 3.6, 6);
    trunkGeo.translate(0, 1.8, 0);
    const canopyGeo = new THREE.ConeGeometry(2.6, 7.2, 7);
    canopyGeo.translate(0, 6.2, 0);

    const trunkMat = new THREE.MeshStandardMaterial({
      color: '#5c4033',
      roughness: 0.92,
      metalness: 0.02,
    });
    const canopyMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.85,
      metalness: 0.02,
    });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
    trunks.receiveShadow = true;
    canopies.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    let placed = 0;
    let attempts = 0;
    while (placed < treeCount && attempts < treeCount * 4) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const dist = rng.range(260, 1480);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = groundHeightAt(x, z);
      if (y > 95) continue; // acima da linha das árvores

      const s = rng.range(0.85, 1.45);
      dummy.position.set(x, y - 0.15, z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.set(s, s * rng.range(0.9, 1.15), s);
      dummy.updateMatrix();

      trunks.setMatrixAt(placed, dummy.matrix);
      canopies.setMatrixAt(placed, dummy.matrix);

      color.setHSL(rng.range(0.32, 0.39), rng.range(0.32, 0.48), rng.range(0.24, 0.36));
      canopies.setColorAt(placed, color);
      placed++;
    }

    trunks.count = placed;
    canopies.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    trunks.computeBoundingSphere();
    canopies.computeBoundingSphere();

    // Formações rochosas instanciadas
    const rockCount = 160;
    const rockGeo = new THREE.DodecahedronGeometry(3.2, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.88,
      metalness: 0.08,
    });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    rocks.receiveShadow = true;

    for (let i = 0; i < rockCount; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const dist = rng.range(280, 1650);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = groundHeightAt(x, z);

      const sx = rng.range(0.85, 2.8);
      const sy = rng.range(0.75, 2.2);
      const sz = rng.range(0.85, 2.8);
      dummy.position.set(x, y + sy * 1.1, z);
      dummy.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);

      const shade = rng.range(0.36, 0.56);
      color.setRGB(shade, shade * 1.02, shade * 1.06);
      rocks.setColorAt(i, color);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.computeBoundingSphere();

    this.group.add(trunks, canopies, rocks);
    this.disposables.push(trunkGeo, canopyGeo, trunkMat, canopyMat, rockGeo, rockMat);
  }

  /**
   * Camada de nuvens estilizadas em grande altitude (150m–380m) para sensação real de escala ao voar.
   */
  private buildSkyClouds(): void {
    const rng = new SeededRNG(88321);
    const cloudCount = 140;
    const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.86,
    });

    const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudCount);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < cloudCount; i++) {
      const x = rng.range(-1900, 1900);
      const z = rng.range(-1900, 1900);
      const y = rng.range(155, 390);

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.set(rng.range(24, 68), rng.range(7, 16), rng.range(18, 44));
      dummy.updateMatrix();
      clouds.setMatrixAt(i, dummy.matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
    clouds.computeBoundingSphere();
    this.cloudsMesh = clouds;
    this.group.add(clouds);
    this.disposables.push(cloudGeo, cloudMat);
  }

  /** Mantém o sky dome e o frustum de sombras centralizados no jogador local. */
  public updateFocus(playerX: number, playerY: number, playerZ: number, dt: number): void {
    this.sunTarget.position.set(playerX, playerY, playerZ);
    this.sunLight.position.set(
      playerX + this.sunOffset.x,
      playerY + this.sunOffset.y,
      playerZ + this.sunOffset.z,
    );

    if (this.skyDome) {
      this.skyDome.position.set(playerX, 0, playerZ);
    }

    if (this.cloudsMesh) {
      this.cloudsMesh.rotation.y += dt * 0.0022;
    }
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
