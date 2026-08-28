/**
 * JARVIS Holographic 3D Machine & Structure Studio for FRIDAY
 * Real-time Google MediaPipe Hand Tracking (60 FPS) + Three.js WebGL Hologram Viewport
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  X,
  Camera,
  Layers,
  Sparkles,
  RotateCcw,
  Maximize2,
  Minimize2,
  Hand,
  Sliders,
  Compass,
  Cpu,
  Eye,
  PenTool,
  Move,
  Play,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  getAvailableModels,
  loadModelById,
  ParametricMachineModel,
  createHologramMaterial
} from '@/utils/parametricModels';

// MediaPipe Hands & CameraUtils
import { Hands, Results as HandResults, HAND_CONNECTIONS } from '@mediapipe/hands';
import { Camera as MpCamera } from '@mediapipe/camera_utils';

interface HolographicLabModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialModelId?: string;
}

export const HolographicLabModal: React.FC<HolographicLabModalProps> = ({
  isOpen,
  onClose,
  initialModelId = 'arc_reactor',
}) => {
  // State
  const [selectedModelId, setSelectedModelId] = useState(initialModelId);
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [isWireframe, setIsWireframe] = useState(false);
  const [showCameraBg, setShowCameraBg] = useState(true);
  const [isAirDrawMode, setIsAirDrawMode] = useState(false);
  const [handTrackingStatus, setHandTrackingStatus] = useState<'initializing' | 'active' | 'no_hand' | 'error'>('initializing');
  const [activeGesture, setActiveGesture] = useState<string>('Hover / Idle');
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);

  // Refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasHandRef = useRef<HTMLCanvasElement | null>(null);
  const canvas3dRef = useRef<HTMLCanvasElement | null>(null);

  // Three.js State Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const currentModelRef = useRef<ParametricMachineModel | null>(null);
  const modelPivotRef = useRef<THREE.Group | null>(null);
  const airDrawLineRef = useRef<THREE.Line | null>(null);
  const airDrawPointsRef = useRef<THREE.Vector3[]>([]);
  const animFrameIdRef = useRef<number | null>(null);

  // Hand Tracking Coordinates & Gesture Refs
  const prevHandPosRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const prevTwoHandDistRef = useRef<number | null>(null);
  const mpHandsRef = useRef<Hands | null>(null);
  const mpCameraRef = useRef<MpCamera | null>(null);

  // Available Presets
  const models = getAvailableModels();

  // ── 1. Setup Three.js Scene ─────────────────────────────────────────────────
  const initThreeScene = useCallback(() => {
    if (!canvas3dRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 7.5);
    cameraRef.current = camera;

    // WebGL Renderer with Alpha Transparent Background
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas3dRef.current,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    rendererRef.current = renderer;

    // Lighting (Holographic Ambient + Neon Cyan Point Lights)
    const ambientLight = new THREE.AmbientLight(0x00f0ff, 1.2);
    scene.add(ambientLight);

    const cyanPointLight = new THREE.PointLight(0x00f0ff, 3, 20);
    cyanPointLight.position.set(5, 5, 5);
    scene.add(cyanPointLight);

    const fuchsiaPointLight = new THREE.PointLight(0xff007f, 2, 20);
    fuchsiaPointLight.position.set(-5, -5, 5);
    scene.add(fuchsiaPointLight);

    // Holographic Circular Grid Floor
    const gridHelper = new THREE.PolarGridHelper(5, 16, 8, 64, 0x00f0ff, 0x0284c7);
    gridHelper.position.y = -2.5;
    scene.add(gridHelper);

    // Pivot Group for rotation and manipulation
    const pivot = new THREE.Group();
    scene.add(pivot);
    modelPivotRef.current = pivot;

    // Load Initial Model
    loadModelToScene(selectedModelId);

    // Animation Loop
    let clock = new THREE.Clock();
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Model internal animation (spinning rotors, reactor core rotation, etc.)
      if (currentModelRef.current?.update) {
        currentModelRef.current.update(elapsedTime);
      }

      // Idle smooth floating oscillation
      if (modelPivotRef.current && activeGesture === 'Hover / Idle') {
        modelPivotRef.current.rotation.y += 0.003;
      }

      renderer.render(scene, camera);
    };

    animate();
  }, [selectedModelId, activeGesture]);

  // ── 2. Load Model into Three.js ─────────────────────────────────────────────
  const loadModelToScene = useCallback((modelId: string) => {
    if (!modelPivotRef.current || !sceneRef.current) return;

    // Clear previous model from pivot
    while (modelPivotRef.current.children.length > 0) {
      const obj = modelPivotRef.current.children[0];
      modelPivotRef.current.remove(obj);
    }

    if (modelId === 'air_draw') {
      setIsAirDrawMode(true);
      currentModelRef.current = null;

      // Create new line for air drawing
      const material = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        linewidth: 4,
        transparent: true,
        opacity: 0.9,
      });
      const geometry = new THREE.BufferGeometry().setFromPoints([]);
      const line = new THREE.Line(geometry, material);
      modelPivotRef.current.add(line);
      airDrawLineRef.current = line;
      airDrawPointsRef.current = [];
      return;
    }

    setIsAirDrawMode(false);
    const model = loadModelById(modelId);
    currentModelRef.current = model;
    modelPivotRef.current.add(model.group);
    modelPivotRef.current.position.set(0, 0, 0);
    modelPivotRef.current.rotation.set(0.2, -0.3, 0);
    modelPivotRef.current.scale.set(1, 1, 1);
    setExplodeFactor(0);
  }, []);

  // ── 3. Handle Explode Factor ────────────────────────────────────────────────
  const applyExplodeFactor = (factor: number) => {
    setExplodeFactor(factor);
    if (!currentModelRef.current) return;

    currentModelRef.current.parts.forEach((part) => {
      const targetPos = part.originalPos
        .clone()
        .add(part.explodeDir.clone().multiplyScalar(factor));
      part.mesh.position.lerp(targetPos, 0.85);
    });
  };

  // ── 4. Google MediaPipe Hands & Gesture Recognition Engine ─────────────────
  const initMediaPipeHands = useCallback(async () => {
    if (!videoRef.current || !canvasHandRef.current) return;

    try {
      setHandTrackingStatus('initializing');
      setCameraPermissionError(null);

      // Create MediaPipe Hands Instance
      const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65,
      });

      hands.onResults(handleHandResults);
      mpHandsRef.current = hands;

      // Start Camera Loop
      const camera = new MpCamera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current && mpHandsRef.current) {
            await mpHandsRef.current.send({ image: videoRef.current });
          }
        },
        width: 1280,
        height: 720,
      });

      await camera.start();
      mpCameraRef.current = camera;
      setHandTrackingStatus('active');
    } catch (err: any) {
      console.error('[HologramLab] MediaPipe camera error:', err);
      setHandTrackingStatus('error');
      setCameraPermissionError(err?.message || 'Webcam access denied or unavailable.');
    }
  }, []);

  // ── 5. Spatial Gesture Classifier & 3D Manipulator ──────────────────────────
  const handleHandResults = (results: HandResults) => {
    if (!canvasHandRef.current || !results.image) return;

    const canvas = canvasHandRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      setHandTrackingStatus('no_hand');
      setActiveGesture('Hover / Idle');
      prevHandPosRef.current = null;
      prevTwoHandDistRef.current = null;
      return;
    }

    setHandTrackingStatus('active');

    // Draw glowing holographic skeleton for all visible hands
    for (const landmarks of results.multiHandLandmarks) {
      drawHolographicHandSkeleton(ctx, landmarks, canvas.width, canvas.height);
    }

    // ── GESTURE 1: Two-Hand Zoom / Scale ──
    if (results.multiHandLandmarks.length >= 2) {
      const hand1 = results.multiHandLandmarks[0][0]; // Wrist hand 1
      const hand2 = results.multiHandLandmarks[1][0]; // Wrist hand 2

      const dist = Math.hypot(hand1.x - hand2.x, hand1.y - hand2.y);
      if (prevTwoHandDistRef.current !== null && modelPivotRef.current) {
        const delta = (dist - prevTwoHandDistRef.current) * 3.5;
        const newScale = THREE.MathUtils.clamp(
          modelPivotRef.current.scale.x + delta,
          0.4,
          2.8
        );
        modelPivotRef.current.scale.set(newScale, newScale, newScale);
      }
      prevTwoHandDistRef.current = dist;
      setActiveGesture('👐 Two-Hand Scale / Zoom');
      return;
    } else {
      prevTwoHandDistRef.current = null;
    }

    // ── Primary Hand (Single Hand Gestures) ──
    const landmarks = results.multiHandLandmarks[0];
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const indexPip = landmarks[6];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];

    // Distances
    const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
    const isFist =
      indexTip.y > indexPip.y &&
      middleTip.y > landmarks[10].y &&
      ringTip.y > landmarks[14].y &&
      pinkyTip.y > landmarks[18].y;

    const isIndexExtendedOnly =
      indexTip.y < indexPip.y &&
      middleTip.y > landmarks[10].y &&
      ringTip.y > landmarks[14].y &&
      pinkyTip.y > landmarks[18].y;

    const isPalmOpen =
      indexTip.y < indexPip.y &&
      middleTip.y < landmarks[10].y &&
      ringTip.y < landmarks[14].y &&
      pinkyTip.y < landmarks[18].y;

    const currentPos = { x: indexTip.x, y: indexTip.y, z: indexTip.z || 0 };

    // ── GESTURE 2: Air-Draw 3D Wireframe (Pointing index finger) ──
    if (isAirDrawMode && isIndexExtendedOnly && modelPivotRef.current) {
      setActiveGesture('✍️ Air-Draw 3D Wireframe');
      // Convert screen coords to 3D Three.js world coordinates
      const worldX = (1 - indexTip.x - 0.5) * 6;
      const worldY = -(indexTip.y - 0.5) * 4.5;
      const worldZ = (indexTip.z || 0) * 3;

      airDrawPointsRef.current.push(new THREE.Vector3(worldX, worldY, worldZ));
      if (airDrawLineRef.current && airDrawPointsRef.current.length > 1) {
        airDrawLineRef.current.geometry.setFromPoints(airDrawPointsRef.current);
      }
      return;
    }

    // ── GESTURE 3: Fist Grab & 360° Orbit Rotation ──
    if (isFist && modelPivotRef.current) {
      setActiveGesture('✊ Fist Grab & 360° Rotate');
      if (prevHandPosRef.current) {
        const dx = (currentPos.x - prevHandPosRef.current.x) * 6;
        const dy = (currentPos.y - prevHandPosRef.current.y) * 6;
        modelPivotRef.current.rotation.y += dx;
        modelPivotRef.current.rotation.x += dy;
      }
      prevHandPosRef.current = currentPos;
      return;
    }

    // ── GESTURE 4: Pinch to Move / Translate ──
    if (pinchDist < 0.075 && modelPivotRef.current) {
      setActiveGesture('🤏 Pinch Pick & Translate');
      if (prevHandPosRef.current) {
        const dx = (1 - currentPos.x - (1 - prevHandPosRef.current.x)) * 5;
        const dy = -(currentPos.y - prevHandPosRef.current.y) * 4;
        modelPivotRef.current.position.x += dx;
        modelPivotRef.current.position.y += dy;
      }
      prevHandPosRef.current = currentPos;
      return;
    }

    // ── GESTURE 5: Palm Open Burst (Explode view gesture) ──
    if (isPalmOpen && pinchDist > 0.15) {
      setActiveGesture('🖐️ Open Palm (Inspect)');
      prevHandPosRef.current = null;
      return;
    }

    setActiveGesture('Hover / Idle');
    prevHandPosRef.current = null;
  };

  // ── 6. Draw Glowing Cyan Hand Skeleton ──────────────────────────────────────
  const drawHolographicHandSkeleton = (
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    width: number,
    height: number
  ) => {
    // Draw Bones
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;

    for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
      const p1 = landmarks[startIdx];
      const p2 = landmarks[endIdx];
      // Mirror X so it maps naturally to the user's view
      const x1 = (1 - p1.x) * width;
      const y1 = p1.y * height;
      const x2 = (1 - p2.x) * width;
      const y2 = p2.y * height;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw Joint Nodes
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      const x = (1 - p.x) * width;
      const y = p.y * height;

      ctx.beginPath();
      ctx.arc(x, y, i === 4 || i === 8 ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = i === 8 ? '#f59e0b' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  // ── Lifecycle: Initialize Everything ─────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      initThreeScene();
      initMediaPipeHands();
    }

    return () => {
      // Cleanup Three.js
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      // Cleanup Camera
      if (mpCameraRef.current) {
        try {
          mpCameraRef.current.stop();
        } catch {}
      }
      if (mpHandsRef.current) {
        try {
          mpHandsRef.current.close();
        } catch {}
      }
    };
  }, [isOpen, initThreeScene, initMediaPipeHands]);

  // Window Resize
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const width = containerRef.current.clientWidth || window.innerWidth;
      const height = containerRef.current.clientHeight || window.innerHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[3000] bg-slate-950 flex flex-col select-none overflow-hidden font-sans"
    >
      {/* ── Background: Live Webcam Video Feed (AR Mode) ── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 w-full h-full object-cover transform -scale-x-100 transition-opacity duration-300 ${
          showCameraBg ? 'opacity-30' : 'opacity-0'
        }`}
      />

      {/* ── Dark Futuristic Ambient Mesh (When camera bg is dim) ── */}
      <div className="absolute inset-0 bg-radial from-cyan-950/40 via-slate-950/85 to-black pointer-events-none" />

      {/* ── 2D Canvas for MediaPipe Hand Skeleton Overlay ── */}
      <canvas
        ref={canvasHandRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* ── 3D WebGL Canvas (Three.js Hologram) ── */}
      <canvas
        ref={canvas3dRef}
        className="absolute inset-0 w-full h-full z-20 cursor-grab active:cursor-grabbing"
      />

      {/* ── Scanlines Hologram Grid Overlay ── */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_50%,rgba(0,240,255,0.03)_51%)] bg-[length:100%_4px] pointer-events-none z-20" />

      {/* ── TOP BAR: JARVIS Header, Status & Close ── */}
      <div className="relative z-30 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent backdrop-blur-md border-b border-cyan-500/30">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.5)]">
            <Cpu className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-white font-extrabold text-lg tracking-wider">
                JARVIS HOLOGRAPHIC 3D LAB
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/40">
                v2.0 Mark-L
              </span>
            </div>
            <p className="text-xs text-slate-400">Spatial Hand-Tracking & Machine Assembly Suite</p>
          </div>
        </div>

        {/* Live Tracking Status Badge */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-md transition-all ${
              handTrackingStatus === 'active'
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                : handTrackingStatus === 'no_hand'
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-red-500/15 border-red-500/40 text-red-300'
            }`}
          >
            <Hand className="w-4 h-4" />
            <span className="capitalize">{activeGesture}</span>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-red-500/30 border border-white/20 text-slate-300 hover:text-white transition-all cursor-pointer"
            title="Exit Hologram Lab"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── ERROR NOTICE (If Camera Denied) ── */}
      {cameraPermissionError && (
        <div className="relative z-30 mx-4 mt-2 p-3 rounded-2xl bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{cameraPermissionError} (Mouse drag still works for 3D rotation)</span>
          </div>
          <button
            onClick={initMediaPipeHands}
            className="px-2.5 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px]"
          >
            Retry Camera
          </button>
        </div>
      )}

      {/* ── LEFT SIDEBAR: 3D Model Presets ── */}
      <div className="absolute left-4 top-24 z-30 w-64 max-h-[calc(100vh-180px)] overflow-y-auto space-y-2 p-3 rounded-2xl bg-black/70 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-800 text-cyan-400 text-xs font-bold uppercase tracking-wider">
          <Layers className="w-3.5 h-3.5" />
          <span>Machine Structures</span>
        </div>

        <div className="space-y-1.5">
          {models.map((m) => {
            const isSelected = selectedModelId === m.id;
            return (
              <button
                key={m.id}
                onClick={() => {
                  setSelectedModelId(m.id);
                  loadModelToScene(m.id);
                }}
                className={`w-full text-left p-2.5 rounded-xl text-xs transition-all border ${
                  isSelected
                    ? 'bg-cyan-500/20 border-cyan-400/80 text-white shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                    : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between font-bold">
                  <span>{m.name}</span>
                  {isSelected && <Sparkles className="w-3 h-3 text-cyan-400 animate-spin" />}
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5 line-clamp-1">
                  {m.category}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT SIDEBAR: Hologram Controls & Disassembly Inspector ── */}
      <div className="absolute right-4 top-24 z-30 w-64 space-y-3 p-3 rounded-2xl bg-black/70 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-800 text-cyan-400 text-xs font-bold uppercase tracking-wider">
          <Sliders className="w-3.5 h-3.5" />
          <span>Assembly Controls</span>
        </div>

        {/* Exploded View Slider */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-medium text-slate-300">
            <span>Exploded CAD View</span>
            <span className="text-cyan-400 font-mono">{Math.round(explodeFactor * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.02"
            value={explodeFactor}
            onChange={(e) => applyExplodeFactor(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex gap-1.5 pt-1">
            <button
              onClick={() => applyExplodeFactor(0)}
              className="flex-1 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-semibold transition-colors"
            >
              Assemble
            </button>
            <button
              onClick={() => applyExplodeFactor(1.0)}
              className="flex-1 py-1 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/50 text-[10px] text-cyan-200 font-semibold transition-colors"
            >
              Explode All
            </button>
          </div>
        </div>

        {/* Viewport Toggles */}
        <div className="space-y-1 pt-2 border-t border-slate-800">
          <button
            onClick={() => setShowCameraBg(!showCameraBg)}
            className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-xs text-slate-200 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-cyan-400" />
              <span>AR Camera Backdrop</span>
            </span>
            <span className={`text-[10px] font-bold ${showCameraBg ? 'text-emerald-400' : 'text-slate-500'}`}>
              {showCameraBg ? 'ON' : 'OFF'}
            </span>
          </button>

          <button
            onClick={() => {
              if (modelPivotRef.current) {
                modelPivotRef.current.position.set(0, 0, 0);
                modelPivotRef.current.rotation.set(0.2, -0.3, 0);
                modelPivotRef.current.scale.set(1, 1, 1);
              }
            }}
            className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-xs text-slate-200 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>Reset 3D Orientation</span>
            </span>
          </button>
        </div>

        {/* Gestures Quick Guide */}
        <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-[11px] text-cyan-300/90 space-y-1">
          <p className="font-bold text-white uppercase text-[10px] tracking-wider">🎮 Hand Gestures:</p>
          <p>• ✊ <b>Fist</b>: Rotate Hologram 360°</p>
          <p>• 🤏 <b>Pinch</b>: Pick & Drag Object</p>
          <p>• 👐 <b>2 Hands</b>: Stretch to Scale / Zoom</p>
          <p>• ✍️ <b>Point</b>: Air-Draw 3D Shapes</p>
        </div>
      </div>

      {/* ── BOTTOM HUD: Live Telemetry Coordinates ── */}
      <div className="relative z-30 mt-auto p-4 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between text-xs text-slate-400 border-t border-cyan-500/20">
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span>X: <b>{modelPivotRef.current ? modelPivotRef.current.position.x.toFixed(2) : '0.00'}</b></span>
          <span>Y: <b>{modelPivotRef.current ? modelPivotRef.current.position.y.toFixed(2) : '0.00'}</b></span>
          <span>SCALE: <b>{modelPivotRef.current ? modelPivotRef.current.scale.x.toFixed(2) : '1.00'}x</b></span>
          <span>ROT_Y: <b>{modelPivotRef.current ? ((modelPivotRef.current.rotation.y * 180) / Math.PI).toFixed(0) : '0'}°</b></span>
        </div>

        <div className="text-[11px] text-cyan-400 font-semibold flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          <span>FRIDAY Holographic Engine Active</span>
        </div>
      </div>
    </div>
  );
};
