import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CharacterMesh } from '../entities/CharacterMesh';
import type { CharacterAppearance } from '../entities/Player';
import { detectSoftwareWebGL } from '../renderer/SceneRenderer';

interface CharacterPreview3DProps {
  appearance: CharacterAppearance;
  showAura: boolean;
}

/**
 * Viewport 3D isolada com pedestal giratório para pré-visualizar em tempo real
 * o guerreiro customizado (cabelo, porte, roupas, acessórios e aura de Ki).
 */
export const CharacterPreview3D: React.FC<CharacterPreview3DProps> = ({
  appearance,
  showAura,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const meshRef = useRef<CharacterMesh | null>(null);
  const showAuraRef = useRef(showAura);
  const yawRef = useRef(0.35);
  const dragRef = useRef<{ active: boolean; lastX: number }>({ active: false, lastX: 0 });

  showAuraRef.current = showAura;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || 320;
    const height = container.clientHeight || 380;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090f1e');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 40);
    camera.position.set(0, 1.55, 4.35);
    camera.lookAt(0, 1.15, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight('#bae6fd', '#1e293b', 0.85);
    const key = new THREE.DirectionalLight('#fff7ed', 2.2);
    key.position.set(3.5, 5.5, 4.5);
    const rim = new THREE.DirectionalLight('#38bdf8', 1.25);
    rim.position.set(-4.0, 3.0, -3.5);
    scene.add(hemi, key, rim);

    // Pedestal circular minimalista
    const baseGeo = new THREE.CylinderGeometry(1.15, 1.28, 0.14, 32);
    const baseMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.45,
      metalness: 0.55,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, -0.07, 0);
    scene.add(base);

    const ringGeo = new THREE.RingGeometry(1.02, 1.12, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0, 0.01, 0);
    scene.add(ring);

    const onResize = () => {
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 380;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    const onPointerDown = (e: PointerEvent) => {
      dragRef.current = { active: true, lastX: e.clientX };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.lastX;
      dragRef.current.lastX = e.clientX;
      yawRef.current += dx * 0.012;
    };
    const onPointerUp = () => {
      dragRef.current.active = false;
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    let running = true;
    let frameId = 0;
    let lastTime = performance.now();
    let elapsed = 0;

    const tick = () => {
      if (!running) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      elapsed += dt;

      if (!dragRef.current.active) {
        yawRef.current += dt * 0.55;
      }

      const charMesh = meshRef.current;
      if (charMesh) {
        charMesh.root.rotation.set(0, yawRef.current, 0);
        charMesh.updatePreview(dt, showAuraRef.current, elapsed);
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        frameId = window.setTimeout(tick, 90);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      running = false;
      cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      if (meshRef.current) {
        scene.remove(meshRef.current.root);
        meshRef.current.dispose();
        meshRef.current = null;
      }

      baseGeo.dispose();
      baseMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      if (scene.environment) scene.environment.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []);

  // Reconstrói apenas o CharacterMesh ao editar aparência
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (meshRef.current) {
      scene.remove(meshRef.current.root);
      meshRef.current.dispose();
    }

    const nextMesh = new CharacterMesh(appearance);
    nextMesh.root.rotation.set(0, yawRef.current, 0);
    nextMesh.updatePreview(0.016, showAuraRef.current, 0);
    scene.add(nextMesh.root);
    meshRef.current = nextMesh;
  }, [appearance]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full cursor-grab active:cursor-grabbing select-none"
      aria-label="Pré-visualização 3D do guerreiro"
    />
  );
};
