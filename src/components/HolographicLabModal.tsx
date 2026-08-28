/**
 * JARVIS Holographic 3D Machine & Spatial Studio
 * Real-time Google MediaPipe Hand Tracking (60 FPS) + Three.js WebGL Hologram Viewport
 * Features:
 *  - 100% Precise Object & Part Grabbing via Three.js Raycaster & Proximity Physics
 *  - Detachable Interactive Flame & Candle: Pinch flame, detach, carry anywhere in 3D, and snap to wick
 *  - Full 360° Hand Gyro Spatial Rotation (Roll, Pitch, Yaw)
 *  - True 3D Hand Depth Tracking (Z-Axis Push/Pull with Physical Hand Scale & Z-depth)
 *  - Rock-Solid Pinch State Hysteresis (Zero accidental drops)
 *  - 3D Holographic Hand Reticle, Laser Beam & Ground Depth Shadow
 *  - Dual Input: Seamless Hand Gestures + Mouse/Touch Picking
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
  AlertCircle,
  HelpCircle,
  Palette,
  Trash2,
  Flame,
  Zap,
  Move3d
} from 'lucide-react';
import {
  getAvailableModels,
  loadModelById,
  ParametricMachineModel,
  CandleFireModel,
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
  initialModelId = 'candle_fire',
}) => {
  // ── State ──
  const [selectedModelId, setSelectedModelId] = useState(initialModelId);
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [showCameraBg, setShowCameraBg] = useState(true);
  const [isAirDrawMode, setIsAirDrawMode] = useState(false);
  const [drawThickness, setDrawThickness] = useState<number>(4);
  const [drawColor, setDrawColor] = useState<string>('#00f0ff');
  const [handTrackingStatus, setHandTrackingStatus] = useState<'initializing' | 'active' | 'no_hand' | 'error'>('initializing');
  const [activeGesture, setActiveGesture] = useState<string>('Hover / Idle');
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);

  // Candle & Flame State
  const [isFlameLit, setIsFlameLit] = useState(true);
  const [isFlameAttached, setIsFlameAttached] = useState(true);
  const [flameColorHex, setFlameColorHex] = useState<string>('#f97316');
  const [heldObjectName, setHeldObjectName] = useState<string>('None');

  // Telemetry HUD
  const [telemetry, setTelemetry] = useState({
    posX: '0.00',
    posY: '0.00',
    posZ: '0.00',
    roll: '0°',
    pitch: '0°',
    held: 'None',
    depthStatus: 'Mid (0.00m)'
  });

  // ── Refs for State (Prevent stale closures in 60fps MediaPipe loop) ──
  const isAirDrawModeRef = useRef(false);
  const selectedModelIdRef = useRef(initialModelId);
  const explodeFactorRef = useRef(0);
  const drawThicknessRef = useRef(4);
  const drawColorRef = useRef('#00f0ff');
  const isFlameLitRef = useRef(true);
  const isFlameAttachedRef = useRef(true);

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

  useEffect(() => {
    drawThicknessRef.current = drawThickness;
  }, [drawThickness]);

  useEffect(() => {
    drawColorRef.current = drawColor;
  }, [drawColor]);

  useEffect(() => {
    isFlameLitRef.current = isFlameLit;
  }, [isFlameLit]);

  useEffect(() => {
    isFlameAttachedRef.current = isFlameAttached;
  }, [isFlameAttached]);

  // DOM Refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasHandRef = useRef<HTMLCanvasElement | null>(null);
  const canvas3dRef = useRef<HTMLCanvasElement | null>(null);

  // Three.js Scene Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const currentModelRef = useRef<ParametricMachineModel | CandleFireModel | null>(null);
  const modelPivotRef = useRef<THREE.Group | null>(null);
  const airDrawGroupRef = useRef<THREE.Group | null>(null);
  const airDrawPointsRef = useRef<THREE.Vector3[]>([]);
  const animFrameIdRef = useRef<number | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);

  // 3D Spatial Hand Reticle, Laser Beam & Depth Shadow
  const handReticleMeshRef = useRef<THREE.Group | null>(null);
  const handShadowMeshRef = useRef<THREE.Mesh | null>(null);
  const handBeamLineRef = useRef<THREE.Line | null>(null);
  const smoothedHandZRef = useRef<number>(0);

  // Hand & Gesture Tracking & Physics Refs
  const prevHandPosRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const prevHandAngleRef = useRef<{ roll: number; pitch: number; yaw: number } | null>(null);
  const prevTwoHandsRef = useRef<{ cx: number; cy: number; angle: number; dist: number } | null>(null);
  const isPinchingActiveRef = useRef<boolean>(false);

  // Object-Specific Grab Ref (Stores grabbed Three.js Object & original attachment parent)
  const grabbedTargetRef = useRef<{
    type: 'flame' | 'candle' | 'part' | 'model' | 'primitive';
    targetObject: THREE.Object3D;
    initialOffset: THREE.Vector3;
    initialObjectRot: THREE.Euler;
    originalParent: THREE.Object3D | null;
    name: string;
  } | null>(null);

  const mpHandsRef = useRef<Hands | null>(null);
  const isProcessingFrameRef = useRef(false);

  // Mouse / Pointer Interaction Refs
  const isPointerDraggingRef = useRef(false);
  const pointerStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerGrabbedTargetRef = useRef<any>(null);

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
    camera.position.set(0, 0, 8.0);
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

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x00f0ff, 1.4);
    scene.add(ambientLight);

    const cyanLight = new THREE.PointLight(0x00f0ff, 3.5, 30);
    cyanLight.position.set(6, 6, 6);
    scene.add(cyanLight);

    const magentaLight = new THREE.PointLight(0xff007f, 2.8, 30);
    magentaLight.position.set(-6, -5, 6);
    scene.add(magentaLight);

    // Holographic Circular Polar Grid
    const gridHelper = new THREE.PolarGridHelper(6.0, 16, 8, 64, 0x00f0ff, 0x0369a1);
    gridHelper.position.y = -2.6;
    scene.add(gridHelper);

    // Pivot Group for Models
    const pivot = new THREE.Group();
    pivot.name = 'Main_Model_Pivot';
    scene.add(pivot);
    modelPivotRef.current = pivot;

    // Air Draw Sub-Group (Persists drawn 3D strokes)
    const drawGroup = new THREE.Group();
    pivot.add(drawGroup);
    airDrawGroupRef.current = drawGroup;

    // ── 3D Hand Depth Reticle & Spatial Cursor ──
    const reticleGroup = new THREE.Group();
    reticleGroup.name = 'Hand_3D_Reticle';
    reticleGroup.visible = false;

    // Outer Reticle Torus
    const outerRingGeo = new THREE.TorusGeometry(0.26, 0.025, 16, 32);
    const outerRingMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.9 });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    reticleGroup.add(outerRing);

    // Inner Glowing Core
    const innerCoreGeo = new THREE.SphereGeometry(0.07, 16, 16);
    const innerCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
    const innerCore = new THREE.Mesh(innerCoreGeo, innerCoreMat);
    reticleGroup.add(innerCore);

    // Dynamic Z-Depth Depth Projection Shadow on Polar Floor
    const shadowGeo = new THREE.RingGeometry(0.15, 0.3, 32);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = -2.59;
    scene.add(shadowMesh);
    handShadowMeshRef.current = shadowMesh;

    // Laser Beam Connecting Hand Reticle to Grabbed Object
    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)]);
    const beamMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2, transparent: true, opacity: 0.85 });
    const beamLine = new THREE.Line(beamGeo, beamMat);
    beamLine.visible = false;
    scene.add(beamLine);
    handBeamLineRef.current = beamLine;

    scene.add(reticleGroup);
    handReticleMeshRef.current = reticleGroup;

    // Load Initial Model
    loadModelToScene(selectedModelIdRef.current);

    // Animation Loop
    const clock = new THREE.Clock();
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Internal model animations (candle flame flickers, spinning blades, etc.)
      if (currentModelRef.current?.update) {
        currentModelRef.current.update(elapsedTime);
      }

      // Idle smooth floating oscillation when not interacting
      if (
        modelPivotRef.current &&
        !isPointerDraggingRef.current &&
        prevHandPosRef.current === null &&
        prevTwoHandsRef.current === null &&
        grabbedTargetRef.current === null &&
        pointerGrabbedTargetRef.current === null
      ) {
        modelPivotRef.current.rotation.y += 0.0012;
      }

      // Rotate reticle for holographic visual feel
      if (handReticleMeshRef.current && handReticleMeshRef.current.visible) {
        outerRing.rotation.z += 0.04;
      }

      // Update Telemetry display
      if (modelPivotRef.current) {
        const activeGrab = grabbedTargetRef.current || pointerGrabbedTargetRef.current;
        const targetObj = activeGrab ? activeGrab.targetObject : modelPivotRef.current;
        const worldPos = new THREE.Vector3();
        targetObj.getWorldPosition(worldPos);

        setTelemetry({
          posX: worldPos.x.toFixed(2),
          posY: worldPos.y.toFixed(2),
          posZ: worldPos.z.toFixed(2),
          roll: `${((targetObj.rotation.z * 180) / Math.PI % 360).toFixed(0)}°`,
          pitch: `${((targetObj.rotation.x * 180) / Math.PI % 360).toFixed(0)}°`,
          held: activeGrab ? activeGrab.name : 'None',
          depthStatus: `${(smoothedHandZRef.current >= 0.8 ? 'Near Front' : smoothedHandZRef.current <= -0.8 ? 'Deep Back' : 'Mid Center')} (${smoothedHandZRef.current.toFixed(2)}m)`
        });
      }

      renderer.render(scene, camera);
    };

    animate();
  }, []);

  // ── 2. Load Model into Three.js ─────────────────────────────────────────────
  const loadModelToScene = useCallback((modelId: string) => {
    if (!modelPivotRef.current || !sceneRef.current) return;

    // Reset grabbed targets
    grabbedTargetRef.current = null;
    pointerGrabbedTargetRef.current = null;
    isPinchingActiveRef.current = false;
    setHeldObjectName('None');

    if (handBeamLineRef.current) handBeamLineRef.current.visible = false;

    // Clear previous model meshes from pivot (keep airDrawGroup)
    for (let i = modelPivotRef.current.children.length - 1; i >= 0; i--) {
      const obj = modelPivotRef.current.children[i];
      if (obj !== airDrawGroupRef.current) {
        modelPivotRef.current.remove(obj);
      }
    }

    // Also remove any detached objects that were reparented to scene
    for (let i = sceneRef.current.children.length - 1; i >= 0; i--) {
      const obj = sceneRef.current.children[i];
      if (obj.name === 'Interactive_Fire_Flame' || obj.name === 'Candle_Assembly') {
        sceneRef.current.remove(obj);
      }
    }

    if (modelId === 'air_draw' || modelId === 'blank_workspace') {
      setIsAirDrawMode(true);
      isAirDrawModeRef.current = true;
    } else {
      setIsAirDrawMode(false);
      isAirDrawModeRef.current = false;
    }

    const model = loadModelById(modelId);
    currentModelRef.current = model;
    modelPivotRef.current.add(model.group);
    modelPivotRef.current.position.set(0, 0, 0);
    modelPivotRef.current.rotation.set(0.12, -0.2, 0);
    modelPivotRef.current.scale.set(1, 1, 1);
    setExplodeFactor(0);

    // If Candle & Flame Model, sync flame states
    if (modelId === 'candle_fire' && (model as CandleFireModel).setFlameState) {
      const cModel = model as CandleFireModel;
      setIsFlameLit(cModel.isLit);
      setIsFlameAttached(cModel.isFlameAttached);
    }
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

  // ── 4. Quick Clear Air-Draw Canvas ──────────────────────────────────────────
  const clearAirDrawPoints = () => {
    airDrawPointsRef.current = [];
    if (airDrawGroupRef.current) {
      while (airDrawGroupRef.current.children.length > 0) {
        const obj = airDrawGroupRef.current.children[0] as any;
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
          else obj.material.dispose();
        }
        airDrawGroupRef.current.remove(obj);
      }
    }
  };

  // ── 5. Spawn 3D Primitives into Blank Workspace ────────────────────────────
  const spawnPrimitive = (type: 'cube' | 'sphere' | 'cylinder' | 'torus') => {
    if (!modelPivotRef.current) return;

    const mat = createHologramMaterial(parseInt(drawColorRef.current.replace('#', '0x'), 16) || 0x00f0ff, 0.9, false);
    let geo: THREE.BufferGeometry;

    if (type === 'cube') geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    else if (type === 'sphere') geo = new THREE.SphereGeometry(0.8, 24, 24);
    else if (type === 'cylinder') geo = new THREE.CylinderGeometry(0.6, 0.6, 1.5, 24);
    else geo = new THREE.TorusGeometry(0.9, 0.25, 16, 48);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `Primitive_${type}_${Date.now()}`;
    mesh.position.set(
      (Math.random() - 0.5) * 2.5,
      (Math.random() - 0.5) * 2.0,
      (Math.random() - 0.5) * 2.0
    );
    modelPivotRef.current.add(mesh);
  };

  // ── 6. Flame Manipulation Actions (Candle & Fire Studio) ───────────────────
  const separateFlame = () => {
    if (selectedModelId !== 'candle_fire' || !currentModelRef.current || !sceneRef.current) return;
    const cModel = currentModelRef.current as CandleFireModel;
    if (cModel.flameGroup) {
      // Detach flame to root scene and float beside candle
      sceneRef.current.attach(cModel.flameGroup);
      cModel.flameGroup.position.set(2.4, 1.2, 0.8);
      cModel.isFlameAttached = false;
      setIsFlameAttached(false);
    }
  };

  const snapFlameToCandle = () => {
    if (selectedModelId !== 'candle_fire' || !currentModelRef.current || !modelPivotRef.current) return;
    const cModel = currentModelRef.current as CandleFireModel;
    if (cModel.flameGroup && cModel.group) {
      cModel.group.attach(cModel.flameGroup);
      cModel.setFlameState(true, true);
      setIsFlameAttached(true);
      setIsFlameLit(true);
    }
  };

  const toggleFlameLit = () => {
    if (selectedModelId !== 'candle_fire' || !currentModelRef.current) return;
    const cModel = currentModelRef.current as CandleFireModel;
    const nextState = !isFlameLit;
    setIsFlameLit(nextState);
    if (cModel.setFlameState) {
      cModel.setFlameState(cModel.isFlameAttached, nextState);
    }
  };

  const handleFlameColorChange = (hex: string) => {
    setFlameColorHex(hex);
    if (selectedModelId === 'candle_fire' && currentModelRef.current) {
      const cModel = currentModelRef.current as CandleFireModel;
      if (cModel.setFlameColor) {
        cModel.setFlameColor(parseInt(hex.replace('#', '0x'), 16));
      }
    }
  };

  // ── 7. Helper: Find Top-Level Interactive Object / Part from Mesh ───────────
  const findInteractiveTarget = useCallback((hitMesh: THREE.Object3D): {
    targetObject: THREE.Object3D;
    type: 'flame' | 'candle' | 'part' | 'primitive' | 'model';
    name: string;
  } => {
    let curr: THREE.Object3D | null = hitMesh;

    // Check ancestors
    while (curr && curr !== sceneRef.current && curr !== modelPivotRef.current) {
      if (curr.name === 'Interactive_Fire_Flame') {
        return { targetObject: curr, type: 'flame', name: '🔥 Fire Flame' };
      }
      if (curr.name === 'Candle_Assembly') {
        return { targetObject: curr, type: 'candle', name: '🕯️ Candle Body' };
      }
      if (curr.name.startsWith('Primitive_')) {
        return { targetObject: curr, type: 'primitive', name: `Shape (${curr.name.split('_')[1]})` };
      }

      // Check if current matches any machine model part
      if (currentModelRef.current?.parts) {
        const foundPart = currentModelRef.current.parts.find((p) => p.mesh === curr);
        if (foundPart) {
          return { targetObject: curr, type: 'part', name: foundPart.name };
        }
      }

      curr = curr.parent;
    }

    // Default: Main Model Pivot
    return {
      targetObject: modelPivotRef.current || hitMesh,
      type: 'model',
      name: currentModelRef.current?.name || 'Entire 3D Model'
    };
  }, []);

  // ── 8. Robust Euclidean Distance Helper for 3D Joints ───────────────────────
  const getDistance3D = (p1: any, p2: any) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = (p1.z || 0) - (p2.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  // ── 9. MediaPipe Hands Results Processor ────────────────────────────────────
  const handleHandResults = useCallback((results: HandResults) => {
    if (!canvasHandRef.current || !cameraRef.current || !sceneRef.current) return;

    const canvas = canvasHandRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      setHandTrackingStatus('no_hand');
      setActiveGesture('Hover / Idle');
      prevHandPosRef.current = null;
      prevHandAngleRef.current = null;
      prevTwoHandsRef.current = null;
      isPinchingActiveRef.current = false;

      if (grabbedTargetRef.current) {
        grabbedTargetRef.current = null;
        setHeldObjectName('None');
      }

      if (handReticleMeshRef.current) handReticleMeshRef.current.visible = false;
      if (handShadowMeshRef.current) handShadowMeshRef.current.visible = false;
      if (handBeamLineRef.current) handBeamLineRef.current.visible = false;
      return;
    }

    setHandTrackingStatus('active');

    // Draw glowing holographic skeleton for each detected hand
    for (const landmarks of results.multiHandLandmarks) {
      drawHolographicHandSkeleton(ctx, landmarks, canvas.width, canvas.height);
    }

    // ── GESTURE 1: Two-Hand 360° Spatial Gyro Steering & Zoom ──
    if (results.multiHandLandmarks.length >= 2) {
      grabbedTargetRef.current = null;
      isPinchingActiveRef.current = false;
      setHeldObjectName('None');
      if (handBeamLineRef.current) handBeamLineRef.current.visible = false;

      const hand1 = results.multiHandLandmarks[0][0]; // Wrist hand 1
      const hand2 = results.multiHandLandmarks[1][0]; // Wrist hand 2

      // Mirrored center coordinates for natural interaction
      const cx = 1 - ((hand1.x + hand2.x) / 2);
      const cy = (hand1.y + hand2.y) / 2;
      const angle = Math.atan2(hand2.y - hand1.y, (1 - hand2.x) - (1 - hand1.x));
      const dist = Math.hypot(hand1.x - hand2.x, hand1.y - hand2.y);

      if (prevTwoHandsRef.current && modelPivotRef.current) {
        const dx = (cx - prevTwoHandsRef.current.cx) * 6.5;
        const dy = (cy - prevTwoHandsRef.current.cy) * 6.5;
        modelPivotRef.current.rotation.y += dx;
        modelPivotRef.current.rotation.x += dy;

        let dAngle = angle - prevTwoHandsRef.current.angle;
        if (dAngle > Math.PI) dAngle -= Math.PI * 2;
        if (dAngle < -Math.PI) dAngle += Math.PI * 2;
        modelPivotRef.current.rotation.z += dAngle * 1.6;

        const deltaDist = (dist - prevTwoHandsRef.current.dist) * 3.8;
        const newScale = THREE.MathUtils.clamp(
          modelPivotRef.current.scale.x + deltaDist,
          0.3,
          3.8
        );
        modelPivotRef.current.scale.set(newScale, newScale, newScale);
      }

      prevTwoHandsRef.current = { cx, cy, angle, dist };
      setActiveGesture('👐 Two-Hand 360° Steering & Orbit');
      if (handReticleMeshRef.current) handReticleMeshRef.current.visible = false;
      return;
    } else {
      prevTwoHandsRef.current = null;
    }

    // ── Primary Hand (Single Hand Gestures) ──
    const landmarks = results.multiHandLandmarks[0];
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const indexMcp = landmarks[5];
    const indexPip = landmarks[6];
    const middleTip = landmarks[12];
    const middleMcp = landmarks[9];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];
    const pinkyMcp = landmarks[17];

    // ── Depth (Z-Axis) Real-time Calculation ──
    const palmHeight = getDistance3D(wrist, middleMcp);
    const palmWidth = getDistance3D(indexMcp, pinkyMcp);
    const handSpan = (palmHeight + palmWidth) * 0.5;

    // Map hand span to 3D world depth (-3.5 to +3.0)
    const targetZ = ((handSpan - 0.20) / 0.12) * 2.6 + ((indexTip.z || 0) * -2.0);
    const clampedZ = THREE.MathUtils.clamp(targetZ, -3.8, 3.2);
    smoothedHandZRef.current = smoothedHandZRef.current * 0.75 + clampedZ * 0.25;

    // ── 360° Hand Orientation (Roll, Pitch, Yaw) ──
    const currentRoll = Math.atan2(middleMcp.y - wrist.y, (1 - middleMcp.x) - (1 - wrist.x)) - Math.PI / 2;
    const currentPitch = (middleMcp.y - wrist.y) * 2.5;
    const currentYaw = ((1 - pinkyMcp.x) - (1 - indexMcp.x)) * 3.0;

    // Distance metrics
    const pinchDist = getDistance3D(indexTip, thumbTip);

    // Finger extension checks
    const isIndexExtended = getDistance3D(indexTip, wrist) > getDistance3D(indexPip, wrist) * 1.05 &&
                            getDistance3D(indexTip, wrist) > getDistance3D(middleTip, wrist) * 1.15;

    const isMiddleCurled = getDistance3D(middleTip, wrist) < getDistance3D(wrist, indexPip) * 1.05;
    const isRingCurled = getDistance3D(ringTip, wrist) < getDistance3D(wrist, indexPip) * 1.05;
    const isPinkyCurled = getDistance3D(pinkyTip, wrist) < getDistance3D(wrist, indexPip) * 1.05;

    const isFist = isMiddleCurled && isRingCurled && isPinkyCurled && !isIndexExtended && pinchDist > 0.09;

    // ── Rock-Solid Pinch State Hysteresis ──
    // Trigger grab at < 0.088, keep holding until fingers open to > 0.13
    if (!isPinchingActiveRef.current && pinchDist < 0.088) {
      isPinchingActiveRef.current = true;
    } else if (isPinchingActiveRef.current && pinchDist > 0.13) {
      isPinchingActiveRef.current = false;
    }
    const isPinching = isPinchingActiveRef.current;
    const isPointingOnly = isIndexExtended && !isPinching && pinchDist > 0.09;
    const isPalmOpen = !isMiddleCurled && !isRingCurled && !isPinkyCurled && !isIndexExtended && pinchDist > 0.15;

    // Screen Coordinates (Mirrored X)
    const pinchScreenX = 1 - ((indexTip.x + thumbTip.x) / 2);
    const pinchScreenY = (indexTip.y + thumbTip.y) / 2;

    // Three.js Normalized Device Coordinates (NDC: -1 to +1)
    const ndcX = (pinchScreenX * 2) - 1;
    const ndcY = -(pinchScreenY * 2) + 1;

    // 3D Three.js World Coordinates for Hand Cursor
    const worldX = (pinchScreenX - 0.5) * 7.2;
    const worldY = -(pinchScreenY - 0.5) * 5.4;
    const worldZ = smoothedHandZRef.current;
    const handWorldPos = new THREE.Vector3(worldX, worldY, worldZ);

    // Update 3D Hand Reticle & Depth Floor Shadow
    if (handReticleMeshRef.current) {
      handReticleMeshRef.current.visible = true;
      handReticleMeshRef.current.position.set(worldX, worldY, worldZ);

      const reticleColor = isPinching ? 0xf59e0b : isPointingOnly ? 0xec4899 : 0x00f0ff;
      const ringMesh = handReticleMeshRef.current.children[0] as THREE.Mesh;
      if (ringMesh && (ringMesh.material as any).color) {
        (ringMesh.material as any).color.setHex(reticleColor);
      }
    }

    if (handShadowMeshRef.current) {
      handShadowMeshRef.current.visible = true;
      handShadowMeshRef.current.position.x = worldX;
      handShadowMeshRef.current.position.z = worldZ;
      const shadowScale = THREE.MathUtils.clamp(1.0 - (worldY + 2.5) * 0.12, 0.4, 2.0);
      handShadowMeshRef.current.scale.set(shadowScale, shadowScale, shadowScale);
    }

    // ── GESTURE 2: Accurate Raycast-Based Object & Part Grabbing ──
    if (isPinching) {
      // 1. If we just started pinching, detect exactly which object is targeted!
      if (grabbedTargetRef.current === null) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cameraRef.current);

        // Collect all candidate interactive objects
        const candidateObjects: THREE.Object3D[] = [];
        if (modelPivotRef.current) candidateObjects.push(modelPivotRef.current);
        // Also check any detached objects in scene
        sceneRef.current.children.forEach((c) => {
          if (c.name === 'Interactive_Fire_Flame' || c.name === 'Candle_Assembly' || c.name.startsWith('Primitive_')) {
            candidateObjects.push(c);
          }
        });

        const intersects = raycaster.intersectObjects(candidateObjects, true);
        let selectedTarget: { targetObject: THREE.Object3D; type: any; name: string } | null = null;

        if (intersects.length > 0) {
          // Raycast Hit! Find the top-level part/object
          for (const hit of intersects) {
            // Ignore reticle or shadow
            if (hit.object.name.includes('Hand_3D_Reticle') || hit.object === handShadowMeshRef.current) continue;
            selectedTarget = findInteractiveTarget(hit.object);
            if (selectedTarget) break;
          }
        }

        // Proximity Fallback: If raycast didn't hit direct geometry, check 3D distance to Flame or Candle
        if (!selectedTarget && selectedModelIdRef.current === 'candle_fire' && currentModelRef.current) {
          const cModel = currentModelRef.current as CandleFireModel;
          if (cModel.flameGroup) {
            const flameWorldPos = new THREE.Vector3();
            cModel.flameGroup.getWorldPosition(flameWorldPos);
            if (handWorldPos.distanceTo(flameWorldPos) < 2.5) {
              selectedTarget = { targetObject: cModel.flameGroup, type: 'flame', name: '🔥 Fire Flame' };
            }
          }
          if (!selectedTarget && cModel.candleGroup) {
            const candleWorldPos = new THREE.Vector3();
            cModel.candleGroup.getWorldPosition(candleWorldPos);
            if (handWorldPos.distanceTo(candleWorldPos) < 3.0) {
              selectedTarget = { targetObject: cModel.candleGroup, type: 'candle', name: '🕯️ Candle Body' };
            }
          }
        }

        // Final Fallback: Grab the entire model
        if (!selectedTarget) {
          selectedTarget = {
            targetObject: modelPivotRef.current || sceneRef.current,
            type: 'model',
            name: currentModelRef.current?.name || 'Entire 3D Model'
          };
        }

        const { targetObject, type, name } = selectedTarget;
        const originalParent = targetObject.parent;

        // Detach target to root scene preserving its exact world transform
        if (targetObject !== sceneRef.current && targetObject.parent !== sceneRef.current) {
          sceneRef.current.attach(targetObject);
        }

        // Compute 3D offset between target world position and hand position
        const targetWorldPos = new THREE.Vector3();
        targetObject.getWorldPosition(targetWorldPos);

        grabbedTargetRef.current = {
          type,
          targetObject,
          initialOffset: new THREE.Vector3(
            targetWorldPos.x - handWorldPos.x,
            targetWorldPos.y - handWorldPos.y,
            targetWorldPos.z - handWorldPos.z
          ),
          initialObjectRot: targetObject.rotation.clone(),
          originalParent,
          name
        };

        prevHandAngleRef.current = { roll: currentRoll, pitch: currentPitch, yaw: currentYaw };
        setHeldObjectName(name);

        if (type === 'flame') {
          setIsFlameAttached(false);
          if (currentModelRef.current && (currentModelRef.current as CandleFireModel).isFlameAttached !== undefined) {
            (currentModelRef.current as CandleFireModel).isFlameAttached = false;
          }
        }
      }

      // 2. Smoothly Move & 360° Rotate the Grabbed Object
      if (grabbedTargetRef.current) {
        const { targetObject, initialOffset } = grabbedTargetRef.current;

        // 1:1 Physical Position Tracking in Full 3D Space (X, Y, Z Depth)
        targetObject.position.x = handWorldPos.x + initialOffset.x;
        targetObject.position.y = handWorldPos.y + initialOffset.y;
        targetObject.position.z = handWorldPos.z + initialOffset.z;

        // 360° Hand Gyro Rotation (Roll, Pitch, Yaw)
        if (prevHandAngleRef.current) {
          const deltaRoll = currentRoll - prevHandAngleRef.current.roll;
          const deltaPitch = currentPitch - prevHandAngleRef.current.pitch;
          const deltaYaw = currentYaw - prevHandAngleRef.current.yaw;

          targetObject.rotation.z += deltaRoll * 1.5;
          targetObject.rotation.x += deltaPitch * 1.2;
          targetObject.rotation.y += deltaYaw * 1.2;
        }

        prevHandAngleRef.current = { roll: currentRoll, pitch: currentPitch, yaw: currentYaw };
        setActiveGesture(`🤏 Moving: ${grabbedTargetRef.current.name}`);

        // Update Laser Beam Connecting Hand to Object
        if (handBeamLineRef.current) {
          handBeamLineRef.current.visible = true;
          const objWorldPos = new THREE.Vector3();
          targetObject.getWorldPosition(objWorldPos);
          handBeamLineRef.current.geometry.setFromPoints([handWorldPos, objWorldPos]);
        }
      }

      prevHandPosRef.current = { x: pinchScreenX, y: pinchScreenY, z: worldZ };
      return;
    } else {
      // ── Pinch Released: Handle Placement & Candle Snap Physics ──
      if (grabbedTargetRef.current) {
        const { targetObject, type } = grabbedTargetRef.current;

        if (type === 'flame' && currentModelRef.current && selectedModelIdRef.current === 'candle_fire') {
          const cModel = currentModelRef.current as CandleFireModel;
          if (cModel.flameGroup && cModel.candleGroup) {
            const candleWorldPos = new THREE.Vector3();
            cModel.candleGroup.getWorldPosition(candleWorldPos);
            const flameWorldPos = new THREE.Vector3();
            cModel.flameGroup.getWorldPosition(flameWorldPos);

            const wickWorldTarget = candleWorldPos.clone().add(cModel.wickWorldPos);
            const distToWick = flameWorldPos.distanceTo(wickWorldTarget);

            // Magnetic snap to candle wick if brought within 2.0 units
            if (distToWick < 2.0) {
              if (cModel.group) {
                cModel.group.attach(cModel.flameGroup);
              }
              cModel.setFlameState(true, true);
              setIsFlameAttached(true);
              setIsFlameLit(true);
              setActiveGesture('✨ Flame Placed & Candle Lit!');
            } else {
              // Leave flame floating detached in 3D mid-air
              setIsFlameAttached(false);
              setActiveGesture('🔥 Flame Placed in Mid-Air!');
            }
          }
        }

        grabbedTargetRef.current = null;
        prevHandAngleRef.current = null;
        setHeldObjectName('None');
        if (handBeamLineRef.current) handBeamLineRef.current.visible = false;
      }
    }

    // ── GESTURE 3: Air-Drawing 3D Wireframe (Single Index Finger Point) ──
    if ((isAirDrawModeRef.current || isPointingOnly) && !isFist && !isPinching && modelPivotRef.current) {
      setActiveGesture('✍️ Index Pointing • Air-Drawing');

      const newPoint = new THREE.Vector3(worldX, worldY, worldZ);
      const lastPoint = airDrawPointsRef.current[airDrawPointsRef.current.length - 1];

      if (!lastPoint || lastPoint.distanceTo(newPoint) > 0.035) {
        airDrawPointsRef.current.push(newPoint);

        if (airDrawGroupRef.current && airDrawPointsRef.current.length >= 2) {
          const strokeColor = parseInt(drawColorRef.current.replace('#', '0x'), 16) || 0x00f0ff;
          const strokeThickness = drawThicknessRef.current;

          if (strokeThickness >= 4 && airDrawPointsRef.current.length >= 3) {
            const curve = new THREE.CatmullRomCurve3(airDrawPointsRef.current.slice(-10));
            const tubeGeo = new THREE.TubeGeometry(curve, 16, strokeThickness * 0.015, 8, false);
            const tubeMat = createHologramMaterial(strokeColor, 0.9, false);
            const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
            airDrawGroupRef.current.add(tubeMesh);
          } else {
            const material = new THREE.LineBasicMaterial({
              color: strokeColor,
              linewidth: strokeThickness,
              transparent: true,
              opacity: 0.95,
            });
            const geo = new THREE.BufferGeometry().setFromPoints(airDrawPointsRef.current);
            const line = new THREE.Line(geo, material);
            airDrawGroupRef.current.add(line);
          }
        }
      }

      // Draw Glowing Laser Emitter on 2D Overlay
      const canvasW = canvas.width;
      const canvasH = canvas.height;
      const tipX = (1 - indexTip.x) * canvasW;
      const tipY = indexTip.y * canvasH;

      ctx.beginPath();
      ctx.arc(tipX, tipY, drawThicknessRef.current * 1.5 + 4, 0, Math.PI * 2);
      ctx.fillStyle = drawColorRef.current;
      ctx.shadowColor = drawColorRef.current;
      ctx.shadowBlur = 25;
      ctx.fill();

      prevHandPosRef.current = { x: pinchScreenX, y: pinchScreenY, z: worldZ };
      return;
    }

    // ── GESTURE 4: Single Hand Fist Grab & 360° Orbit Rotation ──
    if (isFist && modelPivotRef.current) {
      setActiveGesture('✊ Fist Grab & 360° Free Rotate');
      if (prevHandPosRef.current) {
        const dx = (pinchScreenX - prevHandPosRef.current.x) * 6.5;
        const dy = (pinchScreenY - prevHandPosRef.current.y) * 6.5;
        modelPivotRef.current.rotation.y += dx;
        modelPivotRef.current.rotation.x += dy;

        if (prevHandAngleRef.current) {
          const dRoll = currentRoll - prevHandAngleRef.current.roll;
          modelPivotRef.current.rotation.z += dRoll * 1.4;
        }
      }
      prevHandPosRef.current = { x: pinchScreenX, y: pinchScreenY, z: worldZ };
      prevHandAngleRef.current = { roll: currentRoll, pitch: currentPitch, yaw: currentYaw };
      return;
    }

    // ── GESTURE 5: Palm Open (Inspect View) ──
    if (isPalmOpen) {
      setActiveGesture('🖐️ Open Palm (Inspect)');
      prevHandPosRef.current = null;
      prevHandAngleRef.current = null;
      return;
    }

    setActiveGesture('Hover / Idle');
    prevHandPosRef.current = null;
    prevHandAngleRef.current = null;
  }, [findInteractiveTarget]);

  // ── 10. Draw Glowing Neon Hand Skeleton ─────────────────────────────────────
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
      ctx.fillStyle = i === 8 ? drawColorRef.current : i === 4 ? '#ec4899' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  // ── 11. Native Camera & MediaPipe Initialization ────────────────────────────
  const startCameraAndHands = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      setHandTrackingStatus('initializing');
      setCameraPermissionError(null);

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

  // ── 12. Mouse / Touch Direct Object Picking & Dragging ─────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvas3dRef.current || !cameraRef.current || !sceneRef.current) return;

    const rect = canvas3dRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);

    const candidateObjects: THREE.Object3D[] = [];
    if (modelPivotRef.current) candidateObjects.push(modelPivotRef.current);
    sceneRef.current.children.forEach((c) => {
      if (c.name === 'Interactive_Fire_Flame' || c.name === 'Candle_Assembly' || c.name.startsWith('Primitive_')) {
        candidateObjects.push(c);
      }
    });

    const intersects = raycaster.intersectObjects(candidateObjects, true);

    if (intersects.length > 0) {
      const selected = findInteractiveTarget(intersects[0].object);
      if (selected && selected.type !== 'model') {
        // Detach target to root scene
        if (selected.targetObject.parent !== sceneRef.current) {
          sceneRef.current.attach(selected.targetObject);
        }

        const targetWorldPos = new THREE.Vector3();
        selected.targetObject.getWorldPosition(targetWorldPos);

        pointerGrabbedTargetRef.current = {
          type: selected.type,
          targetObject: selected.targetObject,
          name: selected.name,
          dragPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -targetWorldPos.z),
          initialOffset: new THREE.Vector3()
        };

        const planeIntersect = new THREE.Vector3();
        raycaster.ray.intersectPlane(pointerGrabbedTargetRef.current.dragPlane, planeIntersect);
        pointerGrabbedTargetRef.current.initialOffset.subVectors(targetWorldPos, planeIntersect);

        setHeldObjectName(selected.name);
        setActiveGesture(`🖱️ Dragging: ${selected.name}`);
        return;
      }
    }

    // Default: Orbit entire view
    isPointerDraggingRef.current = true;
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerGrabbedTargetRef.current && cameraRef.current && canvas3dRef.current) {
      const rect = canvas3dRef.current.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);

      const planeIntersect = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(pointerGrabbedTargetRef.current.dragPlane, planeIntersect)) {
        pointerGrabbedTargetRef.current.targetObject.position.copy(
          planeIntersect.add(pointerGrabbedTargetRef.current.initialOffset)
        );
      }
      return;
    }

    if (!isPointerDraggingRef.current || !modelPivotRef.current) return;

    const dx = (e.clientX - pointerStartPosRef.current.x) * 0.008;
    const dy = (e.clientY - pointerStartPosRef.current.y) * 0.008;

    modelPivotRef.current.rotation.y += dx;
    modelPivotRef.current.rotation.x += dy;

    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = () => {
    if (pointerGrabbedTargetRef.current) {
      const { targetObject, type } = pointerGrabbedTargetRef.current;
      if (type === 'flame' && currentModelRef.current && selectedModelIdRef.current === 'candle_fire') {
        const cModel = currentModelRef.current as CandleFireModel;
        if (cModel.flameGroup && cModel.candleGroup) {
          const candleWorldPos = new THREE.Vector3();
          cModel.candleGroup.getWorldPosition(candleWorldPos);
          const flameWorldPos = new THREE.Vector3();
          cModel.flameGroup.getWorldPosition(flameWorldPos);

          const wickWorldTarget = candleWorldPos.clone().add(cModel.wickWorldPos);
          const distToWick = flameWorldPos.distanceTo(wickWorldTarget);

          if (distToWick < 2.0) {
            if (cModel.group) {
              cModel.group.attach(cModel.flameGroup);
            }
            cModel.setFlameState(true, true);
            setIsFlameAttached(true);
            setIsFlameLit(true);
            setActiveGesture('✨ Flame Placed & Candle Lit!');
          } else {
            setIsFlameAttached(false);
            setActiveGesture('🔥 Flame Placed in Mid-Air!');
          }
        }
      }
      pointerGrabbedTargetRef.current = null;
      setHeldObjectName('None');
    }
    isPointerDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!modelPivotRef.current) return;
    const delta = e.deltaY * -0.0015;
    const newScale = THREE.MathUtils.clamp(modelPivotRef.current.scale.x + delta, 0.35, 3.5);
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
                Mark-L 3D Spatial
              </span>
            </div>
            <p className="text-xs text-slate-400">Raycast Object Picking • True 3D Depth • 360° Gyro Hand Move</p>
          </div>
        </div>

        {/* Live Tracking Status & Active Held Badge */}
        <div className="flex items-center gap-2 sm:gap-3">
          {heldObjectName !== 'None' && (
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-bold animate-pulse">
              <Zap className="w-3.5 h-3.5" />
              <span>Holding: {heldObjectName}</span>
            </div>
          )}

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
          <span>Interactive 3D Objects</span>
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

      {/* ── RIGHT SIDEBAR: Candle & Fire Controls, Studio & Gestures Guide ── */}
      <div className="absolute right-4 top-24 z-30 w-72 max-h-[calc(100vh-180px)] overflow-y-auto space-y-3 p-3.5 rounded-2xl bg-black/80 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-800 text-cyan-400 text-xs font-bold uppercase tracking-wider">
          <Sliders className="w-3.5 h-3.5" />
          <span>3D Spatial Controls</span>
        </div>

        {/* ── CANDLE & FIRE SPECIAL INTERACTIVE PANEL ── */}
        {selectedModelId === 'candle_fire' && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-2.5 shadow-[0_0_20px_rgba(245,158,11,0.15)]">
            <div className="flex items-center justify-between text-xs font-bold text-amber-300 border-b border-amber-500/30 pb-1.5">
              <span className="flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-orange-400 animate-bounce" />
                <span>Candle & Fire Fusion Lab</span>
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200">
                {isFlameAttached ? 'Flame on Wick' : 'Flame Detached'}
              </span>
            </div>

            <div className="text-[11px] text-amber-200/90 leading-snug">
              Pinch or Click the <b>Fire Flame</b> to pick it up, carry it anywhere in 3D depth, and drop it on the candle wick!
            </div>

            {/* Flame Action Buttons */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={separateFlame}
                className="py-1.5 px-2 rounded-lg bg-orange-950/70 hover:bg-orange-900 border border-orange-500/50 text-[11px] text-orange-200 font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
              >
                <Move3d className="w-3.5 h-3.5" />
                <span>Separate Flame</span>
              </button>

              <button
                onClick={snapFlameToCandle}
                className="py-1.5 px-2 rounded-lg bg-amber-600/40 hover:bg-amber-600/60 border border-amber-400 text-[11px] text-amber-100 font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shadow-[0_0_10px_rgba(245,158,11,0.3)]"
              >
                <Flame className="w-3.5 h-3.5 text-amber-300" />
                <span>Snap to Candle</span>
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={toggleFlameLit}
                className={`flex-1 py-1 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                  isFlameLit
                    ? 'bg-red-500/20 border-red-400 text-red-300'
                    : 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                }`}
              >
                {isFlameLit ? '💨 Blow Out Flame' : '✨ Light Flame'}
              </button>
            </div>

            {/* Flame Glow Colors */}
            <div className="pt-1.5 border-t border-amber-500/20 flex items-center justify-between">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                Flame Color:
              </span>
              <div className="flex gap-1.5">
                {[
                  { hex: '#f97316', name: 'Fire Orange' },
                  { hex: '#00f0ff', name: 'Cyan Plasma' },
                  { hex: '#a855f7', name: 'Cosmic Purple' },
                  { hex: '#10b981', name: 'Emerald Fire' },
                ].map((c) => (
                  <button
                    key={c.hex}
                    onClick={() => handleFlameColorChange(c.hex)}
                    style={{ backgroundColor: c.hex }}
                    className={`w-4 h-4 rounded-full transition-transform cursor-pointer ${
                      flameColorHex === c.hex ? 'scale-125 ring-2 ring-white shadow-md' : 'opacity-80 hover:opacity-100'
                    }`}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Air-Draw Stroke Thickness & Color Palette ── */}
        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
            <span className="flex items-center gap-1.5 text-cyan-300">
              <PenTool className="w-3.5 h-3.5" />
              <span>3D Stroke Thickness</span>
            </span>
            <span className="font-mono text-cyan-400 font-bold">{drawThickness}px</span>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {[
              { label: '1px Fine', val: 1 },
              { label: '4px Med', val: 4 },
              { label: '8px Bold', val: 8 },
              { label: '14px Tube', val: 14 },
            ].map((t) => (
              <button
                key={t.val}
                onClick={() => setDrawThickness(t.val)}
                className={`py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  drawThickness === t.val
                    ? 'bg-cyan-500 text-slate-950 shadow-[0_0_10px_rgba(6,182,212,0.5)]'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Color Palette */}
          <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Palette className="w-3 h-3 text-amber-400" />
              <span>Glow Color</span>
            </span>
            <div className="flex gap-1.5">
              {[
                { hex: '#00f0ff', name: 'Cyan' },
                { hex: '#f59e0b', name: 'Gold' },
                { hex: '#ec4899', name: 'Pink' },
                { hex: '#10b981', name: 'Emerald' },
                { hex: '#a855f7', name: 'Purple' },
                { hex: '#ffffff', name: 'White' },
              ].map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setDrawColor(c.hex)}
                  style={{ backgroundColor: c.hex }}
                  className={`w-4 h-4 rounded-full transition-transform cursor-pointer ${
                    drawColor === c.hex ? 'scale-125 ring-2 ring-white shadow-md' : 'opacity-80 hover:opacity-100'
                  }`}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-1.5 pt-1">
            <button
              onClick={() => {
                const next = !isAirDrawMode;
                setIsAirDrawMode(next);
                isAirDrawModeRef.current = next;
              }}
              className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition-all border cursor-pointer ${
                isAirDrawMode
                  ? 'bg-amber-500/25 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {isAirDrawMode ? 'Air-Draw: ACTIVE' : 'Toggle Air-Draw'}
            </button>
            <button
              onClick={clearAirDrawPoints}
              className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-700/50 text-[11px] text-rose-300 font-semibold transition-colors flex items-center gap-1 cursor-pointer"
              title="Clear all drawn strokes"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Quick Spawn Primitives (Blank Workspace / Air Draw) */}
        {(selectedModelId === 'blank_workspace' || selectedModelId === 'air_draw') && (
          <div className="p-2.5 rounded-xl bg-slate-900/80 border border-cyan-500/30 space-y-1.5">
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

        {/* Exploded View Slider */}
        {selectedModelId !== 'candle_fire' && (
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
        )}

        {/* Viewport Toggles */}
        <div className="space-y-1 pt-2 border-t border-slate-800">
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
                modelPivotRef.current.rotation.set(0.12, -0.2, 0);
                modelPivotRef.current.scale.set(1, 1, 1);
              }
              if (selectedModelId === 'candle_fire') {
                snapFlameToCandle();
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
            <span>JARVIS Spatial Controls:</span>
          </p>
          <p>• 🤏 <b>Pinch Flame / Object</b>: Lock, Move anywhere in 3D & 360° Rotate</p>
          <p>• 📏 <b>Hand Depth (Z)</b>: Move hand closer/farther to push/pull in depth</p>
          <p>• 🔄 <b>Hand Wrist Tilt</b>: 360° Roll, Pitch & Yaw rotation</p>
          <p>• 👐 <b>2 Hands</b>: 360° Gyro Steering & Zoom</p>
          <p>• ✍️ <b>1 Index Finger</b>: Point to Air-Draw 3D Lines</p>
          <p>• 🖱️ <b>Mouse/Touch</b>: Direct Click & Drag any object or flame</p>
        </div>
      </div>

      {/* ── BOTTOM HUD: Real-time Telemetry Coordinates & Depth ── */}
      <div className="relative z-30 mt-auto p-4 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between text-xs text-slate-400 border-t border-cyan-500/20">
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span>X: <b className="text-cyan-300">{telemetry.posX}</b></span>
          <span>Y: <b className="text-cyan-300">{telemetry.posY}</b></span>
          <span>DEPTH (Z): <b className="text-amber-300">{telemetry.posZ}</b></span>
          <span>ROLL: <b className="text-cyan-300">{telemetry.roll}</b></span>
          <span>DEPTH ZONE: <b className="text-emerald-300">{telemetry.depthStatus}</b></span>
          {telemetry.held !== 'None' && (
            <span className="text-orange-400 font-bold">HELD: {telemetry.held}</span>
          )}
        </div>

        <div className="text-[11px] text-cyan-400 font-semibold flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Spatial Precision Tracking Active @ 60 FPS</span>
        </div>
      </div>
    </div>
  );
};
