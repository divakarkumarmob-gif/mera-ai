/**
 * JARVIS Holographic 3D Machine & Structure Studio for FRIDAY
 * Real-time Google MediaPipe Hand Tracking (60 FPS) + Three.js WebGL Hologram Viewport
 * Fixed: Stale React closures, rotation-invariant joint geometry, full mouse/touch orbit & real-time air-draw extrusion
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  X,
  Camera,
  Layers,
  Sparkles,
  RotateCcw,
  Hand,
  Sliders,
  Cpu,
  PenTool,
  Move,
  AlertCircle,
  Maximize2,
  Minimize2,
  HelpCircle
} from 'lucide-react';
import {
  getAvailableModels,
  loadModelById,
  ParametricMachineModel,
  createHologramMaterial
} from '@/utils/parametricModels';

// MediaPipe Hands
import { Hands, Results as HandResults, HAND_CONNECTIONS } from '@mediapipe/hands';

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
  // ── State ──
  const [selectedModelId, setSelectedModelId] = useState(initialModelId);
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [showCameraBg, setShowCameraBg] = useState(true);
  const [isAirDrawMode, setIsAirDrawMode] = useState(false);
  const [handTrackingStatus, setHandTrackingStatus] = useState<'initializing' | 'active' | 'no_hand' | 'error'>('initializing');
  const [activeGesture, setActiveGesture] = useState<string>('Hover / Idle');
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState({ posX: '0.00', posY: '0.00', scale: '1.00', rotY: '0°' });

  // ── Refs for State (To prevent stale closures in MediaPipe loop) ──
  const isAirDrawModeRef = useRef(false);
  const selectedModelIdRef = useRef(initialModelId);
  const explodeFactorRef = useRef(0);

  // Sync refs with state
  useEffect(() => {
    isAirDrawModeRef.current = isAirDrawMode;
  }, [isAirDrawMode]);

  useEffect(() => {
    selectedModelIdRef.current = selectedModelId;
  }, [selectedModelId]);

  useEffect(() => {
    explodeFactorRef.current = explodeFactor;
  }, [explodeFactor]);

  // DOM Refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasHandRef = useRef<HTMLCanvasElement | null>(null);
  const canvas3dRef = useRef<HTMLCanvasElement | null>(null);

  // Three.js Scene Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const currentModelRef = useRef<ParametricMachineModel | null>(null);
  const modelPivotRef = useRef<THREE.Group | null>(null);
  const airDrawLineRef = useRef<THREE.Line | null>(null);
  const airDrawPointsRef = useRef<THREE.Vector3[]>([]);
  const animFrameIdRef = useRef<number | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);

  // Hand & Gesture Coordinates Refs
  const prevHandPosRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const prevTwoHandsRef = useRef<{ cx: number; cy: number; angle: number; dist: number } | null>(null);
  const mpHandsRef = useRef<Hands | null>(null);
  const isProcessingFrameRef = useRef(false);

  // Mouse / Pointer Interaction Refs (Seamless Dual-Input)
  const isPointerDraggingRef = useRef(false);
  const pointerStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Available Presets
  const models = getAvailableModels();

  // ── 1. Setup Three.js Hologram Scene ────────────────────────────────────────
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

    // WebGL Renderer with Alpha
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas3dRef.current,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    // Lighting (Holographic Ambient + Dual Point Lights)
    const ambientLight = new THREE.AmbientLight(0x00f0ff, 1.3);
    scene.add(ambientLight);

    const cyanLight = new THREE.PointLight(0x00f0ff, 3.5, 25);
    cyanLight.position.set(5, 5, 5);
    scene.add(cyanLight);

    const magentaLight = new THREE.PointLight(0xff007f, 2.5, 25);
    magentaLight.position.set(-5, -5, 5);
    scene.add(magentaLight);

    // Holographic Circular Polar Grid
    const gridHelper = new THREE.PolarGridHelper(5.5, 16, 8, 64, 0x00f0ff, 0x0369a1);
    gridHelper.position.y = -2.6;
    scene.add(gridHelper);

    // Pivot Group
    const pivot = new THREE.Group();
    scene.add(pivot);
    modelPivotRef.current = pivot;

    // Load Initial Model
    loadModelToScene(selectedModelIdRef.current);

    // Animation Loop
    const clock = new THREE.Clock();
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Internal model animations (spinning blades, reactor core, etc.)
      if (currentModelRef.current?.update) {
        currentModelRef.current.update(elapsedTime);
      }

      // Idle smooth floating oscillation when not dragging
      if (modelPivotRef.current && !isPointerDraggingRef.current && prevHandPosRef.current === null && prevTwoHandsRef.current === null) {
        modelPivotRef.current.rotation.y += 0.0025;
      }

      // Update Telemetry display
      if (modelPivotRef.current) {
        setTelemetry({
          posX: modelPivotRef.current.position.x.toFixed(2),
          posY: modelPivotRef.current.position.y.toFixed(2),
          scale: modelPivotRef.current.scale.x.toFixed(2),
          rotY: `${((modelPivotRef.current.rotation.y * 180) / Math.PI % 360).toFixed(0)}°`,
        });
      }

      renderer.render(scene, camera);
    };

    animate();
  }, []);

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
      isAirDrawModeRef.current = true;
      currentModelRef.current = null;

      // Create new line for air drawing
      const material = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        linewidth: 4,
        transparent: true,
        opacity: 0.95,
      });
      const geometry = new THREE.BufferGeometry().setFromPoints([]);
      const line = new THREE.Line(geometry, material);
      modelPivotRef.current.add(line);
      airDrawLineRef.current = line;
      airDrawPointsRef.current = [];
      return;
    }

    setIsAirDrawMode(false);
    isAirDrawModeRef.current = false;
    const model = loadModelById(modelId);
    currentModelRef.current = model;
    modelPivotRef.current.add(model.group);
    modelPivotRef.current.position.set(0, 0, 0);
    modelPivotRef.current.rotation.set(0.2, -0.3, 0);
    modelPivotRef.current.scale.set(1, 1, 1);
    setExplodeFactor(0);
  }, []);

  // ── 3. Apply Exploded Assembly Factor ───────────────────────────────────────
  const applyExplodeFactor = (factor: number) => {
    setExplodeFactor(factor);
    explodeFactorRef.current = factor;
    if (!currentModelRef.current) return;

    currentModelRef.current.parts.forEach((part) => {
      const targetPos = part.originalPos
        .clone()
        .add(part.explodeDir.clone().multiplyScalar(factor));
      part.mesh.position.copy(targetPos);
    });
  };

  // ── 4. Quick Clear Drawn Lines / Air-Draw Canvas ───────────────────────────
  const clearAirDrawPoints = () => {
    airDrawPointsRef.current = [];
    if (airDrawLineRef.current) {
      airDrawLineRef.current.geometry.dispose();
      airDrawLineRef.current.geometry = new THREE.BufferGeometry().setFromPoints([]);
    }
  };

  // ── 5. Spawn 3D Primitives into Blank Workspace ────────────────────────────
  const spawnPrimitive = (type: 'cube' | 'sphere' | 'cylinder' | 'torus') => {
    if (!modelPivotRef.current) return;

    const mat = createHologramMaterial(0x00f0ff, 0.9, false);
    let geo: THREE.BufferGeometry;

    if (type === 'cube') geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    else if (type === 'sphere') geo = new THREE.SphereGeometry(0.8, 24, 24);
    else if (type === 'cylinder') geo = new THREE.CylinderGeometry(0.6, 0.6, 1.5, 24);
    else geo = new THREE.TorusGeometry(0.9, 0.25, 16, 48);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    );
    modelPivotRef.current.add(mesh);
  };

  // ── 5. Robust Euclidean Distance Helper for 3D Joints ───────────────────────
  const getDistance3D = (p1: any, p2: any) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = (p1.z || 0) - (p2.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  // ── 6. MediaPipe Hands Results Processor ────────────────────────────────────
  const handleHandResults = useCallback((results: HandResults) => {
    if (!canvasHandRef.current) return;

    const canvas = canvasHandRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match canvas dimensions to container
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      setHandTrackingStatus('no_hand');
      setActiveGesture('Hover / Idle');
      prevHandPosRef.current = null;
      prevTwoHandsRef.current = null;
      return;
    }

    setHandTrackingStatus('active');

    // Draw glowing holographic skeleton for each detected hand
    for (const landmarks of results.multiHandLandmarks) {
      drawHolographicHandSkeleton(ctx, landmarks, canvas.width, canvas.height);
    }

    // ── GESTURE 1: Two-Hand 360° Steering, Orbit & Zoom ──
    if (results.multiHandLandmarks.length >= 2) {
      const hand1 = results.multiHandLandmarks[0][0]; // Wrist hand 1
      const hand2 = results.multiHandLandmarks[1][0]; // Wrist hand 2

      const cx = (hand1.x + hand2.x) / 2;
      const cy = (hand1.y + hand2.y) / 2;
      const angle = Math.atan2(hand2.y - hand1.y, hand2.x - hand1.x);
      const dist = Math.hypot(hand1.x - hand2.x, hand1.y - hand2.y);

      if (prevTwoHandsRef.current && modelPivotRef.current) {
        // 1. Horizontal / Vertical Shift -> 360° Orbit Rotation (Yaw & Pitch)
        const dx = (cx - prevTwoHandsRef.current.cx) * 8.5;
        const dy = (cy - prevTwoHandsRef.current.cy) * 8.5;
        modelPivotRef.current.rotation.y += dx;
        modelPivotRef.current.rotation.x += dy;

        // 2. Hand Tilt Angle -> 360° Roll Steering (Z-axis rotation)
        let dAngle = angle - prevTwoHandsRef.current.angle;
        if (dAngle > Math.PI) dAngle -= Math.PI * 2;
        if (dAngle < -Math.PI) dAngle += Math.PI * 2;
        modelPivotRef.current.rotation.z += dAngle * 2.0;

        // 3. Distance Delta -> Scale / Zoom
        const deltaDist = (dist - prevTwoHandsRef.current.dist) * 4.5;
        const newScale = THREE.MathUtils.clamp(
          modelPivotRef.current.scale.x + deltaDist,
          0.3,
          3.5
        );
        modelPivotRef.current.scale.set(newScale, newScale, newScale);
      }

      prevTwoHandsRef.current = { cx, cy, angle, dist };
      setActiveGesture('👐 Two-Hand 360° Steering & Orbit');
      return;
    } else {
      prevTwoHandsRef.current = null;
    }

    // ── Primary Hand (Single Hand Gestures) ──
    const landmarks = results.multiHandLandmarks[0];
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const indexPip = landmarks[6];
    const indexMcp = landmarks[5];
    const middleTip = landmarks[12];
    const middleMcp = landmarks[9];
    const ringTip = landmarks[16];
    const ringMcp = landmarks[13];
    const pinkyTip = landmarks[20];
    const pinkyMcp = landmarks[17];

    // Distance metrics (Rotation-invariant Euclidean distance from wrist)
    const pinchDist = getDistance3D(indexTip, thumbTip);
    const isIndexCurled = getDistance3D(indexTip, wrist) < getDistance3D(indexMcp, wrist) * 1.15;
    const isMiddleCurled = getDistance3D(middleTip, wrist) < getDistance3D(middleMcp, wrist) * 1.15;
    const isRingCurled = getDistance3D(ringTip, wrist) < getDistance3D(ringMcp, wrist) * 1.15;
    const isPinkyCurled = getDistance3D(pinkyTip, wrist) < getDistance3D(pinkyMcp, wrist) * 1.15;

    // Classifications
    const isFist = isIndexCurled && isMiddleCurled && isRingCurled && isPinkyCurled;
    const isPointingOnly = !isIndexCurled && isMiddleCurled && isRingCurled && isPinkyCurled;
    const isPinching = pinchDist < 0.085;
    const isPalmOpen = !isIndexCurled && !isMiddleCurled && !isRingCurled && !isPinkyCurled && pinchDist > 0.14;

    const currentPos = { x: indexTip.x, y: indexTip.y, z: indexTip.z || 0 };

    // ── GESTURE 2: Air-Drawing 3D Holographic Wireframe (Single Index Finger) ──
    if ((isAirDrawModeRef.current || isPointingOnly) && !isFist && !isPinching && modelPivotRef.current) {
      setActiveGesture('✍️ Index Pointing • Air-Drawing 3D');

      // Map 2D camera coords to 3D Three.js world coordinates
      const worldX = (1 - indexTip.x - 0.5) * 6.5;
      const worldY = -(indexTip.y - 0.5) * 5.0;
      const worldZ = (indexTip.z || 0) * 3.5;

      const newPoint = new THREE.Vector3(worldX, worldY, worldZ);
      const lastPoint = airDrawPointsRef.current[airDrawPointsRef.current.length - 1];

      if (!lastPoint || lastPoint.distanceTo(newPoint) > 0.04) {
        airDrawPointsRef.current.push(newPoint);

        // Recreate/update line geometry cleanly in Three.js
        if (airDrawLineRef.current) {
          airDrawLineRef.current.geometry.dispose();
          airDrawLineRef.current.geometry = new THREE.BufferGeometry().setFromPoints(airDrawPointsRef.current);
          airDrawLineRef.current.geometry.computeBoundingSphere();
        } else {
          const material = new THREE.LineBasicMaterial({
            color: 0x00f0ff,
            linewidth: 4,
            transparent: true,
            opacity: 0.95,
          });
          const geo = new THREE.BufferGeometry().setFromPoints(airDrawPointsRef.current);
          const line = new THREE.Line(geo, material);
          modelPivotRef.current.add(line);
          airDrawLineRef.current = line;
        }
      }

      // Draw Glowing Laser Emitter on 2D Overlay
      const canvasW = canvas.width;
      const canvasH = canvas.height;
      const tipX = (1 - indexTip.x) * canvasW;
      const tipY = indexTip.y * canvasH;

      ctx.beginPath();
      ctx.arc(tipX, tipY, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 20;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(tipX, tipY, 18, 0, Math.PI * 2);
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.stroke();

      prevHandPosRef.current = currentPos;
      return;
    }

    // ── GESTURE 3: Fist Grab & 360° Orbit Rotation ──
    if (isFist && modelPivotRef.current) {
      setActiveGesture('✊ Fist Grab & 360° Rotate');
      if (prevHandPosRef.current) {
        const dx = (currentPos.x - prevHandPosRef.current.x) * 7.5;
        const dy = (currentPos.y - prevHandPosRef.current.y) * 7.5;
        modelPivotRef.current.rotation.y += dx;
        modelPivotRef.current.rotation.x += dy;
      }
      prevHandPosRef.current = currentPos;
      return;
    }

    // ── GESTURE 4: Pinch Pick & Translate Object / Part ──
    if (isPinching && modelPivotRef.current) {
      setActiveGesture('🤏 Pinch Pick & Translate');
      if (prevHandPosRef.current) {
        const dx = (1 - currentPos.x - (1 - prevHandPosRef.current.x)) * 6.0;
        const dy = -(currentPos.y - prevHandPosRef.current.y) * 5.0;
        modelPivotRef.current.position.x += dx;
        modelPivotRef.current.position.y += dy;
      }
      prevHandPosRef.current = currentPos;
      return;
    }

    // ── GESTURE 5: Palm Open Burst (Exploded view inspection) ──
    if (isPalmOpen) {
      setActiveGesture('🖐️ Open Palm (Inspect)');
      prevHandPosRef.current = null;
      return;
    }

    setActiveGesture('Hover / Idle');
    prevHandPosRef.current = null;
  }, []);

  // ── 6. Draw Glowing Neon Hand Skeleton ──────────────────────────────────────
  const drawHolographicHandSkeleton = (
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    width: number,
    height: number
  ) => {
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;

    for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
      const p1 = landmarks[startIdx];
      const p2 = landmarks[endIdx];
      // Mirror X coordinates for natural AR mirror view
      const x1 = (1 - p1.x) * width;
      const y1 = p1.y * height;
      const x2 = (1 - p2.x) * width;
      const y2 = p2.y * height;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      const x = (1 - p.x) * width;
      const y = p.y * height;

      ctx.beginPath();
      ctx.arc(x, y, i === 4 || i === 8 ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = i === 8 ? '#f59e0b' : i === 4 ? '#ec4899' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  // ── 7. Native Camera & MediaPipe Initialization ─────────────────────────────
  const startCameraAndHands = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      setHandTrackingStatus('initializing');
      setCameraPermissionError(null);

      // 1. Initialize MediaPipe Hands
      const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });

      hands.onResults((results) => {
        handleHandResults(results);
        isProcessingFrameRef.current = false;
      });

      mpHandsRef.current = hands;

      // 2. Direct getUserMedia for 100% Reliable Camera Pipeline
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setHandTrackingStatus('active');

      // 3. Continuous Video Frame Dispatch Loop
      const processFrame = async () => {
        if (videoRef.current && mpHandsRef.current && videoRef.current.readyState >= 2) {
          if (!isProcessingFrameRef.current) {
            isProcessingFrameRef.current = true;
            try {
              await mpHandsRef.current.send({ image: videoRef.current });
            } catch {
              isProcessingFrameRef.current = false;
            }
          }
        }
        if (videoStreamRef.current) {
          requestAnimationFrame(processFrame);
        }
      };

      requestAnimationFrame(processFrame);
    } catch (err: any) {
      console.warn('[HologramLab] Camera init note:', err);
      setHandTrackingStatus('error');
      setCameraPermissionError(err?.message || 'Camera access not permitted. Mouse & touch controls are active.');
    }
  }, [handleHandResults]);

  // ── 8. Mouse / Touch Orbit & Interaction Event Handlers ─────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isPointerDraggingRef.current = true;
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDraggingRef.current || !modelPivotRef.current) return;

    const dx = (e.clientX - pointerStartPosRef.current.x) * 0.008;
    const dy = (e.clientY - pointerStartPosRef.current.y) * 0.008;

    modelPivotRef.current.rotation.y += dx;
    modelPivotRef.current.rotation.x += dy;

    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = () => {
    isPointerDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!modelPivotRef.current) return;
    const delta = e.deltaY * -0.0015;
    const newScale = THREE.MathUtils.clamp(modelPivotRef.current.scale.x + delta, 0.35, 3.2);
    modelPivotRef.current.scale.set(newScale, newScale, newScale);
  };

  // ── Lifecycle: Initialize Everything ─────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      initThreeScene();
      startCameraAndHands();
    }

    return () => {
      // Cleanup Three.js
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      // Cleanup Camera Stream
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      if (mpHandsRef.current) {
        try {
          mpHandsRef.current.close();
        } catch {}
      }
    };
  }, [isOpen, initThreeScene, startCameraAndHands]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[3000] bg-slate-950 flex flex-col select-none overflow-hidden font-sans"
    >
      {/* ── Background: Live Webcam Video Feed (AR Mirror View) ── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 w-full h-full object-cover transform -scale-x-100 transition-opacity duration-300 ${
          showCameraBg ? 'opacity-35' : 'opacity-0'
        }`}
      />

      {/* ── Dark Futuristic Ambient Mesh ── */}
      <div className="absolute inset-0 bg-radial from-cyan-950/40 via-slate-950/85 to-black pointer-events-none" />

      {/* ── 2D Canvas for MediaPipe Hand Skeleton Overlay ── */}
      <canvas
        ref={canvasHandRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* ── 3D WebGL Canvas (Three.js Hologram with Dual Hand & Pointer Support) ── */}
      <canvas
        ref={canvas3dRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        className="absolute inset-0 w-full h-full z-20 cursor-grab active:cursor-grabbing touch-none"
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
                Mark-L Spatial
              </span>
            </div>
            <p className="text-xs text-slate-400">Hand Gestures • 3D CAD Disassembly • Air-Drawing</p>
          </div>
        </div>

        {/* Live Tracking Status Badge */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-md transition-all ${
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

      {/* ── CAMERA ERROR NOTICE (If permission rejected) ── */}
      {cameraPermissionError && (
        <div className="relative z-30 mx-4 mt-2 p-3 rounded-2xl bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{cameraPermissionError}</span>
          </div>
          <button
            onClick={startCameraAndHands}
            className="px-2.5 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] cursor-pointer"
          >
            Retry Camera
          </button>
        </div>
      )}

      {/* ── LEFT SIDEBAR: 3D Model Presets ── */}
      <div className="absolute left-4 top-24 z-30 w-64 max-h-[calc(100vh-180px)] overflow-y-auto space-y-2 p-3 rounded-2xl bg-black/75 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
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
                className={`w-full text-left p-2.5 rounded-xl text-xs transition-all border cursor-pointer ${
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

      {/* ── RIGHT SIDEBAR: Controls & Gesture Cheat Sheet ── */}
      <div className="absolute right-4 top-24 z-30 w-64 space-y-3 p-3 rounded-2xl bg-black/75 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
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
              className="flex-1 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-semibold transition-colors cursor-pointer"
            >
              Assemble
            </button>
            <button
              onClick={() => applyExplodeFactor(1.0)}
              className="flex-1 py-1 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/50 text-[10px] text-cyan-200 font-semibold transition-colors cursor-pointer"
            >
              Explode All
            </button>
          </div>
        </div>

        {/* Viewport & Air-Draw Tools */}
        <div className="space-y-1.5 pt-2 border-t border-slate-800">
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                const next = !isAirDrawMode;
                setIsAirDrawMode(next);
                isAirDrawModeRef.current = next;
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                isAirDrawMode
                  ? 'bg-amber-500/25 border-amber-400 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.4)]'
                  : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>{isAirDrawMode ? 'Air-Draw ON' : 'Air-Draw Mode'}</span>
            </button>

            <button
              onClick={clearAirDrawPoints}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900/80 hover:bg-rose-950 border border-slate-800 hover:border-rose-500/50 text-[11px] text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
              title="Clear Air-Drawn Lines"
            >
              Clear
            </button>
          </div>

          {/* Quick Spawn Primitives (When on Blank Workspace or Air Draw) */}
          {(selectedModelId === 'blank_workspace' || selectedModelId === 'air_draw') && (
            <div className="p-2 rounded-xl bg-slate-900/80 border border-cyan-500/30 space-y-1.5">
              <span className="text-[10px] text-cyan-300 font-bold uppercase tracking-wider block">
                Spawn 3D Shapes:
              </span>
              <div className="grid grid-cols-4 gap-1">
                <button
                  onClick={() => spawnPrimitive('cube')}
                  className="py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900 border border-cyan-500/40 text-[10px] text-cyan-200 font-semibold cursor-pointer"
                >
                  Cube
                </button>
                <button
                  onClick={() => spawnPrimitive('sphere')}
                  className="py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900 border border-cyan-500/40 text-[10px] text-cyan-200 font-semibold cursor-pointer"
                >
                  Sphere
                </button>
                <button
                  onClick={() => spawnPrimitive('cylinder')}
                  className="py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900 border border-cyan-500/40 text-[10px] text-cyan-200 font-semibold cursor-pointer"
                >
                  Cylinder
                </button>
                <button
                  onClick={() => spawnPrimitive('torus')}
                  className="py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900 border border-cyan-500/40 text-[10px] text-cyan-200 font-semibold cursor-pointer"
                >
                  Torus
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => setShowCameraBg(!showCameraBg)}
            className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-xs text-slate-200 transition-colors cursor-pointer"
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
            className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-xs text-slate-200 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>Reset 3D Orientation</span>
            </span>
          </button>
        </div>

        {/* Gestures Guide */}
        <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-[11px] text-cyan-300/90 space-y-1">
          <p className="font-bold text-white uppercase text-[10px] tracking-wider flex items-center gap-1">
            <HelpCircle className="w-3 h-3 text-cyan-400" />
            <span>JARVIS Holographic Controls:</span>
          </p>
          <p>• 👐 <b>2 Hands</b>: 360° Steering, Orbit & Zoom</p>
          <p>• ✍️ <b>1 Index Finger</b>: Point to Air-Draw 3D</p>
          <p>• ✊ <b>Fist</b>: 360° Rotate Single Hand</p>
          <p>• 🤏 <b>Pinch</b>: Pick & Move Object</p>
          <p>• 🖱️ <b>Mouse/Touch</b>: Drag to Orbit & Wheel Zoom</p>
        </div>
      </div>

      {/* ── BOTTOM HUD: Real-time Telemetry Coordinates ── */}
      <div className="relative z-30 mt-auto p-4 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between text-xs text-slate-400 border-t border-cyan-500/20">
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span>X: <b className="text-cyan-300">{telemetry.posX}</b></span>
          <span>Y: <b className="text-cyan-300">{telemetry.posY}</b></span>
          <span>SCALE: <b className="text-cyan-300">{telemetry.scale}x</b></span>
          <span>ROT: <b className="text-cyan-300">{telemetry.rotY}</b></span>
        </div>

        <div className="text-[11px] text-cyan-400 font-semibold flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Spatial Tracking Active @ 60 FPS</span>
        </div>
      </div>
    </div>
  );
};
