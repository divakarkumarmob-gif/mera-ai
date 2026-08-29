/**
 * JARVIS Holographic 3D Machine & Spatial Studio with FRIDAY AI Voice Integration
 * Real-time Google MediaPipe Hand Tracking (60 FPS) + Three.js WebGL Hologram Viewport
 * Features:
 *  - 🤖 FRIDAY AI Natural Voice Command System (Hindi + English + Hinglish + Multi-part resolution)
 *  - 🏷️ Non-Overlapping Radial Dispersion 3D Annotations & Glowing Arrow Pointers
 *  - 🔄 Precision XYZ 3-Axis Multi-Angle Rotation ("magnetic ring 270 * turn", "z axis par 60 turn karo")
 *  - 🎨 Smart Color Cycling & Voice Palette ("colour change", "lal rang", "gold")
 *  - 🎯 Focused Part Selection, Isolation ("Selected ke alawa hatao") & Restore ("Sab wapas lao")
 *  - 🕯️ Interactive Candle & Detachable Fire Flame Physics
 *  - 👐 60 FPS Ultra-Responsive Single & Two-Hand Free Orbit, Depth Push/Pull & Grab
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
  Cpu,
  AlertCircle,
  HelpCircle,
  Palette,
  Trash2,
  Flame,
  Zap,
  Move3d,
  Mic,
  MicOff,
  Eye,
  EyeOff,
  CornerDownRight,
  Send,
  Volume2,
  VolumeX,
  Compass
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

interface PartAnnotation {
  id: string;
  name: string;
  worldPos: THREE.Vector3;
  screenPos: { x: number; y: number; visible: boolean };
  labelPos: { x: number; y: number };
  mesh: THREE.Object3D;
  isSelected: boolean;
}

const PALETTE_COLORS = [
  { hex: '#00f0ff', name: 'Cyan Neon' },
  { hex: '#f59e0b', name: 'Gold Arc' },
  { hex: '#ef4444', name: 'Crimson Red' },
  { hex: '#10b981', name: 'Emerald Green' },
  { hex: '#a855f7', name: 'Purple Plasma' },
  { hex: '#f97316', name: 'Solar Orange' },
  { hex: '#ffffff', name: 'Pure White' },
];

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

  // FRIDAY AI Voice & Selection State
  const [selectedPartName, setSelectedPartName] = useState<string | null>(null);
  const [isIsolatedMode, setIsIsolatedMode] = useState<boolean>(false);
  const [showAnnotations, setShowAnnotations] = useState<boolean>(true);
  const [annotations, setAnnotations] = useState<PartAnnotation[]>([]);
  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);
  const [voiceQueryInput, setVoiceQueryInput] = useState<string>('');
  const [fridayStatusText, setFridayStatusText] = useState<string>('FRIDAY AI: Standing by for voice commands...');
  const [fridayTtsEnabled, setFridayTtsEnabled] = useState<boolean>(true);

  // Telemetry HUD
  const [telemetry, setTelemetry] = useState({
    posX: '0.00',
    posY: '0.00',
    posZ: '0.00',
    roll: '0°',
    pitch: '0°',
    held: 'None',
    selectedPart: 'None',
    depthStatus: 'Mid (0.00m)'
  });

  // ── Refs for State (Prevent stale closures in 60fps loop) ──
  const isAirDrawModeRef = useRef(false);
  const selectedModelIdRef = useRef(initialModelId);
  const explodeFactorRef = useRef(0);
  const drawThicknessRef = useRef(4);
  const drawColorRef = useRef('#00f0ff');
  const isFlameLitRef = useRef(true);
  const isFlameAttachedRef = useRef(true);
  const selectedPartNameRef = useRef<string | null>(null);
  const showAnnotationsRef = useRef(true);
  const isIsolatedModeRef = useRef(false);
  const colorCycleIdxRef = useRef<number>(0);
  const lastAnnotationUpdateRef = useRef<number>(0);

  // Sync refs with state
  useEffect(() => { isAirDrawModeRef.current = isAirDrawMode; }, [isAirDrawMode]);
  useEffect(() => { selectedModelIdRef.current = selectedModelId; }, [selectedModelId]);
  useEffect(() => { explodeFactorRef.current = explodeFactor; }, [explodeFactor]);
  useEffect(() => { drawThicknessRef.current = drawThickness; }, [drawThickness]);
  useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
  useEffect(() => { isFlameLitRef.current = isFlameLit; }, [isFlameLit]);
  useEffect(() => { isFlameAttachedRef.current = isFlameAttached; }, [isFlameAttached]);
  useEffect(() => { selectedPartNameRef.current = selectedPartName; }, [selectedPartName]);
  useEffect(() => { showAnnotationsRef.current = showAnnotations; }, [showAnnotations]);
  useEffect(() => { isIsolatedModeRef.current = isIsolatedMode; }, [isIsolatedMode]);

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

  // 3D Spatial Hand Reticle, Laser Beam & Highlight Box
  const handReticleMeshRef = useRef<THREE.Group | null>(null);
  const handShadowMeshRef = useRef<THREE.Mesh | null>(null);
  const handBeamLineRef = useRef<THREE.Line | null>(null);
  const selectionHighlightBoxRef = useRef<THREE.BoxHelper | null>(null);
  const smoothedHandZRef = useRef<number>(0);

  // Hand & Gesture Tracking & Physics Refs
  const prevHandPosRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const prevHandAngleRef = useRef<{ roll: number; pitch: number; yaw: number } | null>(null);
  const prevTwoHandsRef = useRef<{ cx: number; cy: number; angle: number; dist: number } | null>(null);
  const isPinchingActiveRef = useRef<boolean>(false);

  // Object-Specific Grab Ref
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

  // Speech Recognition Ref
  const speechRecognitionRef = useRef<any>(null);

  // Available Presets
  const models = getAvailableModels();

  // ── FRIDAY Speech Response Helper (TTS) ────────────────────────────────────
  const speakFriday = useCallback((text: string) => {
    setFridayStatusText(`FRIDAY: "${text}"`);
    if (!fridayTtsEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) => v.name.includes('Google') || v.name.includes('Natural') || v.lang.includes('en'));
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.speak(utterance);
    } catch {}
  }, [fridayTtsEnabled]);

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

    // 3D Selection Highlight Wireframe Box
    const dummyObj = new THREE.Object3D();
    scene.add(dummyObj);
    const boxHelper = new THREE.BoxHelper(dummyObj, 0xfbbf24);
    boxHelper.visible = false;
    scene.add(boxHelper);
    selectionHighlightBoxRef.current = boxHelper;

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

      // Update Selection Box Helper if a part is focused
      if (selectionHighlightBoxRef.current && selectedPartNameRef.current) {
        const foundMesh = findMeshByName(selectedPartNameRef.current);
        if (foundMesh && foundMesh.visible) {
          selectionHighlightBoxRef.current.setFromObject(foundMesh);
          selectionHighlightBoxRef.current.visible = true;
        } else {
          selectionHighlightBoxRef.current.visible = false;
        }
      } else if (selectionHighlightBoxRef.current) {
        selectionHighlightBoxRef.current.visible = false;
      }

      // Throttle 3D Part Annotations to 10 FPS (every 100ms) to prevent React state flood
      const now = performance.now();
      if (showAnnotationsRef.current && cameraRef.current && containerRef.current && (now - lastAnnotationUpdateRef.current > 100)) {
        lastAnnotationUpdateRef.current = now;
        updatePartAnnotations();
      }

      renderer.render(scene, camera);
    };

    animate();
  }, []);

  // ── 2. Helper: Find Mesh by Name Across Scene ──────────────────────────────
  const findMeshByName = (name: string): THREE.Object3D | null => {
    if (!sceneRef.current) return null;
    const lower = name.toLowerCase().trim();

    if (lower.includes('flame') || lower.includes('fire') || lower.includes('aag')) {
      const cModel = currentModelRef.current as CandleFireModel;
      return cModel?.flameGroup || sceneRef.current.getObjectByName('Interactive_Fire_Flame') || null;
    }
    if (lower.includes('candle') || lower.includes('wax') || lower.includes('mombatti')) {
      const cModel = currentModelRef.current as CandleFireModel;
      return cModel?.candleGroup || sceneRef.current.getObjectByName('Candle_Assembly') || null;
    }

    if (currentModelRef.current?.parts) {
      const p = currentModelRef.current.parts.find((part) => {
        const pName = part.name.toLowerCase();
        return pName === lower || pName.includes(lower) || lower.includes(pName);
      });
      if (p) return p.mesh;
    }

    let found: THREE.Object3D | null = null;
    sceneRef.current.traverse((child) => {
      const cName = (child.name || '').toLowerCase();
      if (cName && (cName === lower || cName.includes(lower) || lower.includes(cName))) {
        found = child;
      }
    });

    return found;
  };

  // ── 3. Update 3D-to-2D Part Annotations with Non-Overlapping Radial Dispersion ──
  const updatePartAnnotations = () => {
    if (!cameraRef.current || !containerRef.current) return;
    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    const list: PartAnnotation[] = [];

    // 1. Candle & Flame Items
    if (selectedModelIdRef.current === 'candle_fire' && currentModelRef.current) {
      const cModel = currentModelRef.current as CandleFireModel;
      if (cModel.flameGroup && cModel.flameGroup.visible) {
        const flamePos = new THREE.Vector3();
        cModel.flameGroup.getWorldPosition(flamePos);
        flamePos.y += 0.5;
        const p = projectToScreen(flamePos, cameraRef.current, width, height);
        list.push({
          id: 'flame',
          name: '🔥 Fire Flame',
          worldPos: flamePos,
          screenPos: p,
          labelPos: { x: p.x, y: p.y },
          mesh: cModel.flameGroup,
          isSelected: selectedPartNameRef.current === '🔥 Fire Flame'
        });
      }

      if (cModel.candleGroup && cModel.candleGroup.visible) {
        const candlePos = new THREE.Vector3();
        cModel.candleGroup.getWorldPosition(candlePos);
        candlePos.y += 0.2;
        const p = projectToScreen(candlePos, cameraRef.current, width, height);
        list.push({
          id: 'candle',
          name: '🕯️ Candle Wax Body',
          worldPos: candlePos,
          screenPos: p,
          labelPos: { x: p.x, y: p.y },
          mesh: cModel.candleGroup,
          isSelected: selectedPartNameRef.current === '🕯️ Candle Wax Body'
        });
      }
    } else if (currentModelRef.current?.parts) {
      // 2. Machine Model Parts
      currentModelRef.current.parts.forEach((part, idx) => {
        if (!part.mesh.visible) return;
        const partPos = new THREE.Vector3();
        part.mesh.getWorldPosition(partPos);
        const p = projectToScreen(partPos, cameraRef.current!, width, height);
        list.push({
          id: `part_${idx}`,
          name: part.name,
          worldPos: partPos,
          screenPos: p,
          labelPos: { x: p.x, y: p.y },
          mesh: part.mesh,
          isSelected: selectedPartNameRef.current === part.name
        });
      });
    }

    // 3. Spawned Primitives
    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child.name.startsWith('Primitive_') && child.visible) {
          const primPos = new THREE.Vector3();
          child.getWorldPosition(primPos);
          const p = projectToScreen(primPos, cameraRef.current!, width, height);
          const label = `Shape (${child.name.split('_')[1]})`;
          list.push({
            id: child.name,
            name: label,
            worldPos: primPos,
            screenPos: p,
            labelPos: { x: p.x, y: p.y },
            mesh: child,
            isSelected: selectedPartNameRef.current === label
          });
        }
      });
    }

    // ── Non-Overlapping Radial Dispersion Calculation ──
    const total = list.length;
    list.forEach((ann, idx) => {
      // Distribute each badge on an angular ellipse around the model
      const angle = total > 1 ? (idx / total) * Math.PI * 2 - Math.PI / 2 : 0;
      const radiusX = Math.min(220, Math.max(140, width * 0.18));
      const radiusY = Math.min(150, Math.max(90, height * 0.16));

      const offsetX = Math.cos(angle) * radiusX;
      const offsetY = Math.sin(angle) * radiusY;

      ann.labelPos = {
        x: THREE.MathUtils.clamp(ann.screenPos.x + offsetX, 20, width - 210),
        y: THREE.MathUtils.clamp(ann.screenPos.y + offsetY, 100, height - 90)
      };
    });

    setAnnotations(list);
  };

  const projectToScreen = (worldPos: THREE.Vector3, camera: THREE.PerspectiveCamera, width: number, height: number) => {
    const v = worldPos.clone().project(camera);
    const x = (v.x * 0.5 + 0.5) * width;
    const y = (-(v.y * 0.5) + 0.5) * height;
    return { x, y, visible: v.z < 1 };
  };

  // ── 4. Load Model into Three.js ─────────────────────────────────────────────
  const loadModelToScene = useCallback((modelId: string) => {
    if (!modelPivotRef.current || !sceneRef.current) return;

    grabbedTargetRef.current = null;
    pointerGrabbedTargetRef.current = null;
    isPinchingActiveRef.current = false;
    setSelectedPartName(null);
    setIsIsolatedMode(false);
    setHeldObjectName('None');

    if (handBeamLineRef.current) handBeamLineRef.current.visible = false;
    if (selectionHighlightBoxRef.current) selectionHighlightBoxRef.current.visible = false;

    // Clear previous model meshes from pivot (keep airDrawGroup)
    for (let i = modelPivotRef.current.children.length - 1; i >= 0; i--) {
      const obj = modelPivotRef.current.children[i];
      if (obj !== airDrawGroupRef.current) {
        modelPivotRef.current.remove(obj);
      }
    }

    // Remove detached objects from scene
    for (let i = sceneRef.current.children.length - 1; i >= 0; i--) {
      const obj = sceneRef.current.children[i];
      if (obj.name === 'Interactive_Fire_Flame' || obj.name === 'Candle_Assembly' || obj.name.startsWith('Primitive_')) {
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

    if (modelId === 'candle_fire' && (model as CandleFireModel).setFlameState) {
      const cModel = model as CandleFireModel;
      setIsFlameLit(cModel.isLit);
      setIsFlameAttached(cModel.isFlameAttached);
    }

    speakFriday(`Loaded ${model.name}.`);
  }, [speakFriday]);

  // ── 5. Apply Exploded Assembly Factor ───────────────────────────────────────
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

  // ── 6. Select Part & Isolate / Restore Operations ───────────────────────────
  const selectPart = (partName: string | null) => {
    setSelectedPartName(partName);
    selectedPartNameRef.current = partName;
    if (partName) {
      speakFriday(`Selected: ${partName}.`);
    } else {
      speakFriday(`Selection cleared.`);
    }
  };

  const isolateSelectedPart = () => {
    if (!selectedPartNameRef.current) {
      speakFriday(`Please select a component first.`);
      return;
    }

    setIsIsolatedMode(true);
    isIsolatedModeRef.current = true;

    const selectedMesh = findMeshByName(selectedPartNameRef.current);

    if (selectedModelIdRef.current === 'candle_fire' && currentModelRef.current) {
      const cModel = currentModelRef.current as CandleFireModel;
      if (cModel.flameGroup) cModel.flameGroup.visible = (selectedMesh === cModel.flameGroup);
      if (cModel.candleGroup) cModel.candleGroup.visible = (selectedMesh === cModel.candleGroup);
    } else if (currentModelRef.current?.parts) {
      currentModelRef.current.parts.forEach((p) => {
        p.mesh.visible = (p.mesh === selectedMesh);
      });
    }

    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child.name.startsWith('Primitive_')) {
          child.visible = (child === selectedMesh);
        }
      });
    }

    speakFriday(`Isolated ${selectedPartNameRef.current}. Other parts hidden.`);
  };

  const restoreAllParts = () => {
    setIsIsolatedMode(false);
    isIsolatedModeRef.current = false;

    if (selectedModelIdRef.current === 'candle_fire' && currentModelRef.current) {
      const cModel = currentModelRef.current as CandleFireModel;
      if (cModel.flameGroup) cModel.flameGroup.visible = isFlameLitRef.current;
      if (cModel.candleGroup) cModel.candleGroup.visible = true;
    } else if (currentModelRef.current?.parts) {
      currentModelRef.current.parts.forEach((p) => {
        p.mesh.visible = true;
      });
    }

    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child.name.startsWith('Primitive_')) {
          child.visible = true;
        }
      });
    }

    speakFriday(`All components restored.`);
  };

  const turnSelectedPart = (deg: number, axis: 'x' | 'y' | 'z' = 'y', specificTargetMesh?: THREE.Object3D | null) => {
    const rad = (deg * Math.PI) / 180;
    const target = specificTargetMesh || (selectedPartNameRef.current ? findMeshByName(selectedPartNameRef.current) : modelPivotRef.current);
    if (target) {
      target.rotation[axis] += rad;
      const targetName = selectedPartNameRef.current || currentModelRef.current?.name || 'Entire 3D Model';
      speakFriday(`Rotated ${targetName} by ${deg}° on ${axis.toUpperCase()} axis.`);
    }
  };

  const moveSelectedPart = (dx: number, dy: number, dz: number) => {
    const target = selectedPartNameRef.current ? findMeshByName(selectedPartNameRef.current) : modelPivotRef.current;
    if (target && sceneRef.current) {
      if (target !== modelPivotRef.current && target.parent !== sceneRef.current) {
        sceneRef.current.attach(target);
      }
      target.position.x += dx;
      target.position.y += dy;
      target.position.z += dz;
      speakFriday(`Moved ${selectedPartNameRef.current || 'model'}.`);
    }
  };

  const cycleNextColor = () => {
    colorCycleIdxRef.current = (colorCycleIdxRef.current + 1) % PALETTE_COLORS.length;
    const chosen = PALETTE_COLORS[colorCycleIdxRef.current];
    changeSelectedColor(chosen.hex);
  };

  const changeSelectedColor = (hex: string) => {
    const target = selectedPartNameRef.current ? findMeshByName(selectedPartNameRef.current) : (currentModelRef.current ? currentModelRef.current.group : modelPivotRef.current);
    const colorInt = parseInt(hex.replace('#', '0x'), 16);

    if (selectedPartNameRef.current === '🔥 Fire Flame' || (target && target.name === 'Interactive_Fire_Flame')) {
      handleFlameColorChange(hex);
      speakFriday(`Flame color changed.`);
      return;
    }

    if (target) {
      target.traverse((child: any) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m: any) => {
              if (m.color) m.color.setHex(colorInt);
              if (m.emissive) m.emissive.setHex(colorInt);
            });
          } else {
            if (child.material.color) child.material.color.setHex(colorInt);
            if (child.material.emissive) child.material.emissive.setHex(colorInt);
          }
        }
      });
      speakFriday(`Color updated.`);
    } else {
      setDrawColor(hex);
      speakFriday(`Studio accent color updated.`);
    }
  };

  // ── Shape Morphing Function for Selected Component / Atom ──────────────────
  const morphSelectedPartShape = (shapeType: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'capsule' | 'dodecahedron') => {
    const targetMesh = selectedPartNameRef.current ? findMeshByName(selectedPartNameRef.current) : null;
    if (!targetMesh) {
      speakFriday('Please select or pinch an atom or component first to change its shape.');
      return;
    }

    let newGeo: THREE.BufferGeometry;
    if (shapeType === 'cube') newGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    else if (shapeType === 'sphere') newGeo = new THREE.SphereGeometry(0.8, 32, 32);
    else if (shapeType === 'cylinder') newGeo = new THREE.CylinderGeometry(0.6, 0.6, 1.5, 32);
    else if (shapeType === 'cone') newGeo = new THREE.ConeGeometry(0.8, 1.6, 32);
    else if (shapeType === 'torus') newGeo = new THREE.TorusGeometry(0.9, 0.25, 16, 48);
    else if (shapeType === 'capsule') newGeo = new THREE.CapsuleGeometry(0.5, 1.0, 16, 32);
    else if (shapeType === 'dodecahedron') newGeo = new THREE.DodecahedronGeometry(0.9);
    else newGeo = new THREE.SphereGeometry(0.8, 32, 32);

    if ((targetMesh as any).isMesh) {
      (targetMesh as any).geometry.dispose();
      (targetMesh as any).geometry = newGeo;
    } else {
      targetMesh.traverse((child: any) => {
        if (child.isMesh) {
          child.geometry.dispose();
          child.geometry = newGeo;
        }
      });
    }
    speakFriday(`Morphed ${selectedPartNameRef.current} into holographic ${shapeType}.`);
  };

  const removeSelectedPart = () => {
    if (!selectedPartNameRef.current) return;
    const target = findMeshByName(selectedPartNameRef.current);
    if (target) {
      target.visible = false;
      speakFriday(`Removed ${selectedPartNameRef.current}.`);
      setSelectedPartName(null);
    }
  };

  // ── 7. Enhanced FRIDAY AI Natural Language Voice Command Processor ─────────
  const processVoiceCommand = (cmdText: string) => {
    const text = cmdText.toLowerCase().trim();
    if (!text) return;

    setFridayStatusText(`FRIDAY Heard: "${cmdText}"`);

    // ── Part & Atom Name Identification in the Voice Sentence ──
    let matchedPartName: string | null = null;
    if (text.includes('magnetic') || text.includes('ring') || text.includes('stabilization')) {
      matchedPartName = 'Magnetic Stabilization Ring';
    } else if (text.includes('nucleus') || text.includes('proton') || text.includes('neutron')) {
      matchedPartName = '⚛️ Atomic Nucleus (Protons/Neutrons)';
    } else if (text.includes('electron')) {
      matchedPartName = '⚡ Orbiting Electron #1-1';
    } else if (text.includes('orbital') || text.includes('shell')) {
      matchedPartName = 'K-Shell Orbital Ring #1';
    } else if (text.includes('flame') || text.includes('fire') || text.includes('aag')) {
      matchedPartName = '🔥 Fire Flame';
    } else if (text.includes('candle') || text.includes('mombatti') || text.includes('wax')) {
      matchedPartName = '🕯️ Candle Wax Body';
    } else if (text.includes('core') || text.includes('reactor') || text.includes('palladium')) {
      matchedPartName = 'Palladium Energy Core';
    } else if (text.includes('coil') || text.includes('copper')) {
      matchedPartName = 'Copper Electromagnetic Coils (10x)';
    } else if (text.includes('fan') || text.includes('compressor') || text.includes('blade')) {
      matchedPartName = 'Titanium Compressor Fan Stage';
    } else if (text.includes('drone') || text.includes('rotor') || text.includes('arm')) {
      matchedPartName = 'Rotor Arm & Motor Assembly #1';
    } else if (text.includes('gimbal') || text.includes('camera')) {
      matchedPartName = '4K Optical Gimbal Sensor';
    } else if (text.includes('dna') || text.includes('strand') || text.includes('helix')) {
      matchedPartName = '🧬 Sugar-Phosphate Strand #1 (5’ to 3’)';
    } else if (text.includes('satellite') || text.includes('dish') || text.includes('antenna')) {
      matchedPartName = '📡 High-Gain Parabolic Transceiver';
    } else if (text.includes('wing') || text.includes('aero')) {
      matchedPartName = 'Active Aerodynamic Downforce Wing';
    } else if (text.includes('wheel')) {
      matchedPartName = 'Front-Right Wheel & Brake Caliper';
    } else if (text.includes('cube') || text.includes('box')) {
      matchedPartName = 'Shape (cube)';
    } else if (text.includes('sphere') || text.includes('gola')) {
      matchedPartName = 'Shape (sphere)';
    }

    // ── 1. Universal 3D Model Imports by Voice ("Friday, atom import karo", "drone lao", "DNA import karo") ──
    if (text.includes('import') || text.includes('load') || text.includes('lao') || text.includes('dikhao') || text.includes('switch to')) {
      if (text.includes('atom') || text.includes('bohr') || text.includes('quantum')) {
        setSelectedModelId('quantum_atom');
        loadModelToScene('quantum_atom');
        speakFriday('Imported Quantum Bohr Atom structure.');
        return;
      }
      if (text.includes('dna') || text.includes('helix') || text.includes('gene')) {
        setSelectedModelId('dna_helix');
        loadModelToScene('dna_helix');
        speakFriday('Imported DNA Double Helix macromolecule.');
        return;
      }
      if (text.includes('satellite') || text.includes('dish') || text.includes('orbit')) {
        setSelectedModelId('satellite_orbit');
        loadModelToScene('satellite_orbit');
        speakFriday('Imported Orbital Communications Satellite.');
        return;
      }
      if (text.includes('drone') || text.includes('quadcopter')) {
        setSelectedModelId('quadcopter_drone');
        loadModelToScene('quadcopter_drone');
        speakFriday('Imported Tactical Recon Drone.');
        return;
      }
      if (text.includes('jet') || text.includes('turbine') || text.includes('engine')) {
        setSelectedModelId('jet_engine');
        loadModelToScene('jet_engine');
        speakFriday('Imported Supersonic Jet Turbine Engine.');
        return;
      }
      if (text.includes('reactor') || text.includes('arc core')) {
        setSelectedModelId('arc_reactor');
        loadModelToScene('arc_reactor');
        speakFriday('Imported Mark-L Arc Reactor Core.');
        return;
      }
      if (text.includes('robot') || text.includes('arm')) {
        setSelectedModelId('robotic_arm');
        loadModelToScene('robotic_arm');
        speakFriday('Imported 6-DOF Robotic Arm.');
        return;
      }
      if (text.includes('car') || text.includes('chassis')) {
        setSelectedModelId('hypercar_chassis');
        loadModelToScene('hypercar_chassis');
        speakFriday('Imported Hypercar Spaceframe Chassis.');
        return;
      }
      if (text.includes('candle') || text.includes('flame') || text.includes('fire') || text.includes('mombatti')) {
        setSelectedModelId('candle_fire');
        loadModelToScene('candle_fire');
        speakFriday('Imported Candle & Interactive Flame.');
        return;
      }
    }

    // ── 2. Dynamic Shape Morphing of Selected Part / Atom ("shape change karo", "cube bana do", "sphere banao") ──
    if (text.includes('shape') || text.includes('bana do') || text.includes('banao') || text.includes('morph') || text.includes('convert')) {
      if (matchedPartName) selectPart(matchedPartName);

      if (text.includes('cube') || text.includes('box') || text.includes('chaunkor')) { morphSelectedPartShape('cube'); return; }
      if (text.includes('sphere') || text.includes('gola') || text.includes('ball') || text.includes('atom')) { morphSelectedPartShape('sphere'); return; }
      if (text.includes('cylinder') || text.includes('pipe')) { morphSelectedPartShape('cylinder'); return; }
      if (text.includes('cone') || text.includes('pyramid')) { morphSelectedPartShape('cone'); return; }
      if (text.includes('torus') || text.includes('ring') || text.includes('donut')) { morphSelectedPartShape('torus'); return; }
      if (text.includes('capsule')) { morphSelectedPartShape('capsule'); return; }
      if (text.includes('dodecahedron') || text.includes('crystal') || text.includes('diamond')) { morphSelectedPartShape('dodecahedron'); return; }
    }

    // If user explicitly asked to select a part:
    if (matchedPartName && (text.includes('select') || text.includes('pakad') || text.includes('chun') || text.includes('lock'))) {
      selectPart(matchedPartName);
      return;
    }

    // ── 3. Color Change Commands ("ccolour change", "color change", "lal rang", "gold") ──
    if (
      text.includes('colour') ||
      text.includes('color') ||
      text.includes('ccolour') ||
      text.includes('rang') ||
      text.includes('shade')
    ) {
      if (matchedPartName) {
        selectPart(matchedPartName);
      }
      if (text.includes('red') || text.includes('lal')) changeSelectedColor('#ef4444');
      else if (text.includes('cyan') || text.includes('blue') || text.includes('neela') || text.includes('sky')) changeSelectedColor('#00f0ff');
      else if (text.includes('gold') || text.includes('yellow') || text.includes('pila') || text.includes('peela')) changeSelectedColor('#f59e0b');
      else if (text.includes('green') || text.includes('hara')) changeSelectedColor('#10b981');
      else if (text.includes('purple') || text.includes('violet') || text.includes('baigani')) changeSelectedColor('#a855f7');
      else if (text.includes('pink') || text.includes('gulabi')) changeSelectedColor('#ec4899');
      else if (text.includes('orange') || text.includes('narangi')) changeSelectedColor('#f97316');
      else if (text.includes('white') || text.includes('safed')) changeSelectedColor('#ffffff');
      else {
        cycleNextColor();
      }
      return;
    }

    // ── 4. Isolate / Remove Other Parts ("Selected ke alawa sab hatao") ──
    if (
      text.includes('alawa') ||
      text.includes('isolate') ||
      text.includes('remove unselected') ||
      text.includes('hide other') ||
      text.includes('baki sab hatao') ||
      text.includes('baki remove')
    ) {
      isolateSelectedPart();
      return;
    }

    // ── 5. Restore All Items ("Jitne item the sab wapas lao") ──
    if (
      text.includes('wapas lao') ||
      text.includes('restore') ||
      text.includes('sab lao') ||
      text.includes('show all') ||
      text.includes('bring back') ||
      text.includes('reset visibility')
    ) {
      restoreAllParts();
      return;
    }

    // ── 6. XYZ Multi-Axis Rotation & Turn ("magnetic ring 270 * turn", "z axis par 60 turn karo", "30 degree ghumao") ──
    if (
      text.includes('turn') ||
      text.includes('ghumao') ||
      text.includes('rotate') ||
      text.includes('degree') ||
      text.includes('deg') ||
      text.includes('angle') ||
      text.includes('axis') ||
      text.includes('tilt') ||
      text.includes('roll') ||
      text.includes('pitch') ||
      text.includes('yaw') ||
      text.includes('*') ||
      text.includes('°')
    ) {
      if (matchedPartName) {
        selectPart(matchedPartName);
      }

      let axis: 'x' | 'y' | 'z' = 'y';
      if (/\b([z])\b|z\s*axis|z\s*pe|z\s*par|roll/i.test(text)) axis = 'z';
      else if (/\b([x])\b|x\s*axis|x\s*pe|x\s*par|pitch|tilt|upar|neeche/i.test(text)) axis = 'x';
      else if (/\b([y])\b|y\s*axis|y\s*pe|y\s*par|yaw|left|right/i.test(text)) axis = 'y';

      const numMatch = text.match(/(-?\d+)\s*(?:deg|degree|°|\*|percent)?/i);
      let deg = numMatch ? parseFloat(numMatch[1]) : 30;

      if (!numMatch) {
        if (text.includes('360')) deg = 360;
        else if (text.includes('270')) deg = 270;
        else if (text.includes('180')) deg = 180;
        else if (text.includes('90')) deg = 90;
        else if (text.includes('60')) deg = 60;
        else if (text.includes('45')) deg = 45;
        else if (text.includes('30')) deg = 30;
      }

      if (text.includes('left') || text.includes('ulta') || text.includes('anti') || text.includes('baye')) {
        deg = -Math.abs(deg);
      }

      turnSelectedPart(deg, axis);
      return;
    }

    // ── 7. Move Directions: Left, Right, Up, Down, Forward, Back ──
    if (text.includes('move') || text.includes('hatao') || text.includes('idhar') || text.includes('udhar') || text.includes('sarkao')) {
      if (matchedPartName) selectPart(matchedPartName);

      let dx = 0, dy = 0, dz = 0;
      if (text.includes('left') || text.includes('baye')) dx = -1.2;
      if (text.includes('right') || text.includes('daye')) dx = 1.2;
      if (text.includes('up') || text.includes('upar')) dy = 1.0;
      if (text.includes('down') || text.includes('neeche')) dy = -1.0;
      if (text.includes('forward') || text.includes('aage') || text.includes('front')) dz = 1.2;
      if (text.includes('back') || text.includes('peeche') || text.includes('deep')) dz = -1.2;

      if (dx === 0 && dy === 0 && dz === 0) dy = 1.0;
      moveSelectedPart(dx, dy, dz);
      return;
    }

    // ── 8. Add / Spawn 3D Shapes ──
    if (text.includes('add') || text.includes('spawn') || text.includes('banao') || text.includes('dalo')) {
      if (text.includes('cube') || text.includes('box')) { spawnPrimitive('cube'); speakFriday('Added 3D Cube.'); return; }
      if (text.includes('sphere') || text.includes('gola') || text.includes('atom')) { spawnPrimitive('sphere'); speakFriday('Added 3D Sphere Atom.'); return; }
      if (text.includes('cylinder')) { spawnPrimitive('cylinder'); speakFriday('Added 3D Cylinder.'); return; }
      if (text.includes('torus') || text.includes('ring')) { spawnPrimitive('torus'); speakFriday('Added 3D Torus Ring.'); return; }
      spawnPrimitive('cube');
      speakFriday('Added new 3D shape.');
      return;
    }

    // ── 9. Delete / Remove ──
    if (text.includes('remove') || text.includes('delete') || text.includes('hata do')) {
      removeSelectedPart();
      return;
    }

    // ── 10. Candle & Fire Specific ──
    if (text.includes('separate flame') || text.includes('aag alag')) {
      separateFlame();
      speakFriday('Fire flame detached.');
      return;
    }
    if (text.includes('snap') || text.includes('light candle') || text.includes('mombatti jalao') || text.includes('aag lagao')) {
      snapFlameToCandle();
      speakFriday('Flame snapped onto candle wick.');
      return;
    }
    if (text.includes('blow') || text.includes('bujhao') || text.includes('extinguish')) {
      toggleFlameLit();
      speakFriday(isFlameLit ? 'Flame extinguished.' : 'Flame ignited.');
      return;
    }

    if (matchedPartName) {
      selectPart(matchedPartName);
      return;
    }

    speakFriday(`Command acknowledged: "${cmdText}".`);
  };

  // ── 8. Voice Recognition Toggle ────────────────────────────────────────────
  const toggleVoiceListening = () => {
    if (isListeningVoice) {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch {}
      }
      setIsListeningVoice(false);
    } else {
      const SpeechClass = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      if (!SpeechClass) {
        speakFriday('Speech recognition not supported. Please type your command.');
        return;
      }
      try {
        const sr = new SpeechClass();
        sr.continuous = false;
        sr.interimResults = false;
        sr.lang = 'en-IN';

        sr.onstart = () => {
          setIsListeningVoice(true);
          setFridayStatusText('FRIDAY: Listening... (e.g. "magnetic ring 270 turn", "colour change", "z axis par 60 turn")');
        };

        sr.onresult = (e: any) => {
          const transcript = e.results[0][0].transcript;
          setVoiceQueryInput(transcript);
          processVoiceCommand(transcript);
          setIsListeningVoice(false);
        };

        sr.onerror = (err: any) => {
          console.warn('[Speech Recognition] Error:', err);
          setIsListeningVoice(false);
        };

        sr.onend = () => {
          setIsListeningVoice(false);
        };

        speechRecognitionRef.current = sr;
        sr.start();
      } catch (e) {
        console.warn('Speech init catch:', e);
        setIsListeningVoice(false);
      }
    }
  };

  // ── 9. Spawn 3D Primitives ──────────────────────────────────────────────────
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

  // ── 10. Flame Actions ───────────────────────────────────────────────────────
  const separateFlame = () => {
    if (selectedModelId !== 'candle_fire' || !currentModelRef.current || !sceneRef.current) return;
    const cModel = currentModelRef.current as CandleFireModel;
    if (cModel.flameGroup) {
      sceneRef.current.attach(cModel.flameGroup);
      cModel.flameGroup.position.set(2.4, 1.2, 0.8);
      cModel.isFlameAttached = false;
      setIsFlameAttached(false);
      speakFriday('Flame separated from candle.');
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
      speakFriday('Flame snapped to candle wick.');
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

  // ── 11. Helper: Find Top-Level Interactive Object from Mesh ────────────────
  const findInteractiveTarget = useCallback((hitMesh: THREE.Object3D): {
    targetObject: THREE.Object3D;
    type: 'flame' | 'candle' | 'part' | 'primitive' | 'model';
    name: string;
  } => {
    let curr: THREE.Object3D | null = hitMesh;

    while (curr && curr !== sceneRef.current && curr !== modelPivotRef.current) {
      if (curr.name === 'Interactive_Fire_Flame') {
        return { targetObject: curr, type: 'flame', name: '🔥 Fire Flame' };
      }
      if (curr.name === 'Candle_Assembly') {
        return { targetObject: curr, type: 'candle', name: '🕯️ Candle Wax Body' };
      }
      if (curr.name.startsWith('Primitive_')) {
        return { targetObject: curr, type: 'primitive', name: `Shape (${curr.name.split('_')[1]})` };
      }

      if (currentModelRef.current?.parts) {
        const foundPart = currentModelRef.current.parts.find((p) => p.mesh === curr);
        if (foundPart) {
          return { targetObject: curr, type: 'part', name: foundPart.name };
        }
      }

      curr = curr.parent;
    }

    return {
      targetObject: modelPivotRef.current || hitMesh,
      type: 'model',
      name: currentModelRef.current?.name || 'Entire 3D Model'
    };
  }, []);

  const getDistance3D = (p1: any, p2: any) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = (p1.z || 0) - (p2.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  // ── 12. MediaPipe Hands 60 FPS Fluid Processor ──────────────────────────────
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

    for (const landmarks of results.multiHandLandmarks) {
      drawHolographicHandSkeleton(ctx, landmarks, canvas.width, canvas.height);
    }

    // ── GESTURE 1: Two-Hand 360° Gyro Steering & Orbit ──
    if (results.multiHandLandmarks.length >= 2) {
      grabbedTargetRef.current = null;
      isPinchingActiveRef.current = false;
      setHeldObjectName('None');
      if (handBeamLineRef.current) handBeamLineRef.current.visible = false;

      const hand1 = results.multiHandLandmarks[0][0];
      const hand2 = results.multiHandLandmarks[1][0];

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

    // ── Primary Hand ──
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

    // Depth (Z-Axis) Real-time Calculation
    const palmHeight = getDistance3D(wrist, middleMcp);
    const palmWidth = getDistance3D(indexMcp, pinkyMcp);
    const handSpan = (palmHeight + palmWidth) * 0.5;

    const targetZ = ((handSpan - 0.20) / 0.12) * 2.6 + ((indexTip.z || 0) * -2.0);
    const clampedZ = THREE.MathUtils.clamp(targetZ, -3.8, 3.2);
    smoothedHandZRef.current = smoothedHandZRef.current * 0.75 + clampedZ * 0.25;

    // 360° Hand Orientation (Roll, Pitch, Yaw)
    const currentRoll = Math.atan2(middleMcp.y - wrist.y, (1 - middleMcp.x) - (1 - wrist.x)) - Math.PI / 2;
    const currentPitch = (middleMcp.y - wrist.y) * 2.5;
    const currentYaw = ((1 - pinkyMcp.x) - (1 - indexMcp.x)) * 3.0;

    const pinchDist = getDistance3D(indexTip, thumbTip);

    const isIndexExtended = getDistance3D(indexTip, wrist) > getDistance3D(indexPip, wrist) * 1.05 &&
                            getDistance3D(indexTip, wrist) > getDistance3D(middleTip, wrist) * 1.15;

    const isMiddleCurled = getDistance3D(middleTip, wrist) < getDistance3D(wrist, indexPip) * 1.05;
    const isRingCurled = getDistance3D(ringTip, wrist) < getDistance3D(wrist, indexPip) * 1.05;
    const isPinkyCurled = getDistance3D(pinkyTip, wrist) < getDistance3D(wrist, indexPip) * 1.05;

    const isFist = isMiddleCurled && isRingCurled && isPinkyCurled && !isIndexExtended && pinchDist > 0.09;

    // Pinch Hysteresis
    if (!isPinchingActiveRef.current && pinchDist < 0.088) {
      isPinchingActiveRef.current = true;
    } else if (isPinchingActiveRef.current && pinchDist > 0.13) {
      isPinchingActiveRef.current = false;
    }
    const isPinching = isPinchingActiveRef.current;
    const isPointingOnly = isIndexExtended && !isPinching && pinchDist > 0.09;
    const isPalmOpen = !isMiddleCurled && !isRingCurled && !isPinkyCurled && !isIndexExtended && pinchDist > 0.15;

    const pinchScreenX = 1 - ((indexTip.x + thumbTip.x) / 2);
    const pinchScreenY = (indexTip.y + thumbTip.y) / 2;

    const ndcX = (pinchScreenX * 2) - 1;
    const ndcY = -(pinchScreenY * 2) + 1;

    const worldX = (pinchScreenX - 0.5) * 7.2;
    const worldY = -(pinchScreenY - 0.5) * 5.4;
    const worldZ = smoothedHandZRef.current;
    const handWorldPos = new THREE.Vector3(worldX, worldY, worldZ);

    // Update 3D Reticle
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

    // ── GESTURE 2: Object & Selective Part Grabbing ──
    if (isPinching) {
      if (grabbedTargetRef.current === null) {
        let selectedTarget: { targetObject: THREE.Object3D; type: any; name: string } | null = null;

        // Raycasting check first
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cameraRef.current);

        const candidateObjects: THREE.Object3D[] = [];
        if (modelPivotRef.current) candidateObjects.push(modelPivotRef.current);
        sceneRef.current.children.forEach((c) => {
          if (c.name === 'Interactive_Fire_Flame' || c.name === 'Candle_Assembly' || c.name.startsWith('Primitive_')) {
            candidateObjects.push(c);
          }
        });

        const intersects = raycaster.intersectObjects(candidateObjects, true);
        if (intersects.length > 0) {
          for (const hit of intersects) {
            if (hit.object.name.includes('Hand_3D_Reticle') || hit.object === handShadowMeshRef.current) continue;
            selectedTarget = findInteractiveTarget(hit.object);
            if (selectedTarget) break;
          }
        }

        // Proximity Fallback for candle flame
        if (!selectedTarget && selectedModelIdRef.current === 'candle_fire' && currentModelRef.current) {
          const cModel = currentModelRef.current as CandleFireModel;
          if (cModel.flameGroup) {
            const flameWorldPos = new THREE.Vector3();
            cModel.flameGroup.getWorldPosition(flameWorldPos);
            if (handWorldPos.distanceTo(flameWorldPos) < 2.5) {
              selectedTarget = { targetObject: cModel.flameGroup, type: 'flame', name: '🔥 Fire Flame' };
            }
          }
        }

        // Default: Model Pivot
        if (!selectedTarget) {
          selectedTarget = {
            targetObject: modelPivotRef.current || sceneRef.current,
            type: 'model',
            name: currentModelRef.current?.name || 'Entire 3D Model'
          };
        }

        const { targetObject, type, name } = selectedTarget;
        const originalParent = targetObject.parent;

        if (targetObject !== sceneRef.current && targetObject !== modelPivotRef.current && targetObject.parent !== sceneRef.current) {
          sceneRef.current.attach(targetObject);
        }

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
        setSelectedPartName(name);

        if (type === 'flame') {
          setIsFlameAttached(false);
        }
      }

      if (grabbedTargetRef.current) {
        const { targetObject, initialOffset } = grabbedTargetRef.current;

        targetObject.position.x = handWorldPos.x + initialOffset.x;
        targetObject.position.y = handWorldPos.y + initialOffset.y;
        targetObject.position.z = handWorldPos.z + initialOffset.z;

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

            if (distToWick < 2.0) {
              if (cModel.group) {
                cModel.group.attach(cModel.flameGroup);
              }
              cModel.setFlameState(true, true);
              setIsFlameAttached(true);
              setIsFlameLit(true);
              setActiveGesture('✨ Flame Placed & Candle Lit!');
              speakFriday('Flame snapped onto candle wick.');
            } else {
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

    // ── GESTURE 3: Air-Drawing ──
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

      prevHandPosRef.current = { x: pinchScreenX, y: pinchScreenY, z: worldZ };
      return;
    }

    // ── GESTURE 4: Single Hand Fist Grab & 360° Free Rotate ──
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

    if (isPalmOpen) {
      setActiveGesture('🖐️ Open Palm (Inspect)');
      prevHandPosRef.current = null;
      prevHandAngleRef.current = null;
      return;
    }

    setActiveGesture('Hover / Idle');
    prevHandPosRef.current = null;
    prevHandAngleRef.current = null;
  }, [findInteractiveTarget, speakFriday]);

  // ── 13. Neon Hand Skeleton ──────────────────────────────────────────────────
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

  // ── 14. Native Camera & MediaPipe Initialization ────────────────────────────
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

  // ── 15. Pointer Interaction Handlers ────────────────────────────────────────
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
        setSelectedPartName(selected.name);
        setActiveGesture(`🖱️ Dragging: ${selected.name}`);
        return;
      }
    }

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
      const { type } = pointerGrabbedTargetRef.current;
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

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      initThreeScene();
      startCameraAndHands();
    }

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      if (mpHandsRef.current) {
        try { mpHandsRef.current.close(); } catch {}
      }
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch {}
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

      {/* ── 3D WebGL Canvas (Three.js Hologram) ── */}
      <canvas
        ref={canvas3dRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        className="absolute inset-0 w-full h-full z-20 cursor-grab active:cursor-grabbing touch-none"
      />

      {/* ── 3D Floating Part Labels & Callout Arrows (Non-Overlapping Radial Overlay) ── */}
      {showAnnotations && (
        <div className="absolute inset-0 pointer-events-none z-25 overflow-hidden">
          <svg className="absolute inset-0 w-full h-full">
            <defs>
              <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <polygon points="0 0, 6 3, 0 6" fill="#00f0ff" />
              </marker>
              <marker id="arrowhead-selected" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <polygon points="0 0, 6 3, 0 6" fill="#fbbf24" />
              </marker>
            </defs>
            {annotations.map((ann) => {
              if (!ann.screenPos.visible) return null;
              const isSel = ann.isSelected;

              return (
                <g key={ann.id}>
                  {/* Glowing Leader Line from Badge to 3D Part */}
                  <line
                    x1={ann.labelPos.x + 40}
                    y1={ann.labelPos.y + 12}
                    x2={ann.screenPos.x}
                    y2={ann.screenPos.y}
                    stroke={isSel ? '#fbbf24' : '#00f0ff'}
                    strokeWidth={isSel ? '2' : '1.5'}
                    strokeDasharray={isSel ? 'none' : '4,3'}
                    markerEnd={isSel ? 'url(#arrowhead-selected)' : 'url(#arrowhead)'}
                  />
                  {/* Target 3D Point Reticle */}
                  <circle
                    cx={ann.screenPos.x}
                    cy={ann.screenPos.y}
                    r={isSel ? 6 : 4}
                    fill={isSel ? '#fbbf24' : '#00f0ff'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    className={isSel ? 'animate-ping' : ''}
                  />
                </g>
              );
            })}
          </svg>

          {/* HTML Interactive Badges for Labels */}
          {annotations.map((ann) => {
            if (!ann.screenPos.visible) return null;
            const isSel = ann.isSelected;

            return (
              <div
                key={`badge_${ann.id}`}
                style={{ transform: `translate(${ann.labelPos.x}px, ${ann.labelPos.y}px)` }}
                onClick={() => selectPart(ann.name)}
                className={`absolute top-0 left-0 pointer-events-auto px-2.5 py-1 rounded-xl text-[11px] font-bold border backdrop-blur-md cursor-pointer transition-all flex items-center gap-1.5 shadow-lg ${
                  isSel
                    ? 'bg-amber-500/25 border-amber-400 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.5)] scale-105 ring-2 ring-amber-400/50'
                    : 'bg-black/80 border-cyan-500/50 text-cyan-200 hover:border-cyan-300 hover:bg-slate-900/90'
                }`}
              >
                <CornerDownRight className={`w-3 h-3 ${isSel ? 'text-amber-400' : 'text-cyan-400'}`} />
                <span className="truncate max-w-[140px]">{ann.name}</span>
                {isSel && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500 text-black font-black uppercase">
                    Locked
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Scanlines Hologram Grid Overlay ── */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_50%,rgba(0,240,255,0.03)_51%)] bg-[length:100%_4px] pointer-events-none z-20" />

      {/* ── TOP BAR: JARVIS Header, Voice Status & Close ── */}
      <div className="relative z-30 flex items-center justify-between p-4 bg-gradient-to-b from-black/85 to-transparent backdrop-blur-md border-b border-cyan-500/30">
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
                FRIDAY AI Connected
              </span>
            </div>
            <p className="text-xs text-slate-400">Voice Commands • Multi-Axis 360° Gyro • Color Shifter • Annotations</p>
          </div>
        </div>

        {/* Live Tracking Status & Active Held Badge */}
        <div className="flex items-center gap-2 sm:gap-3">
          {selectedPartName && (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-bold shadow-[0_0_15px_rgba(245,158,11,0.25)]">
              <Zap className="w-3.5 h-3.5" />
              <span>Locked: {selectedPartName}</span>
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

      {/* ── FRIDAY AI VOICE COMMAND FLOATING CAPSULE BAR ── */}
      <div className="relative z-30 mx-4 mt-2 p-2.5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-cyan-950/80 to-slate-900/90 border border-cyan-500/40 backdrop-blur-xl shadow-[0_0_30px_rgba(0,240,255,0.2)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 flex-1 min-w-[280px]">
          <button
            onClick={toggleVoiceListening}
            className={`p-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
              isListeningVoice
                ? 'bg-rose-500 text-white animate-pulse shadow-[0_0_20px_rgba(244,63,94,0.6)]'
                : 'bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-400/60 text-cyan-300'
            }`}
            title="Toggle Speech Recognition"
          >
            {isListeningVoice ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            <span>{isListeningVoice ? 'Listening...' : 'Voice AI'}</span>
          </button>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              processVoiceCommand(voiceQueryInput);
              setVoiceQueryInput('');
            }}
            className="flex-1 flex items-center gap-1 bg-black/60 border border-cyan-500/30 rounded-xl px-2.5 py-1 focus-within:border-cyan-400"
          >
            <input
              type="text"
              value={voiceQueryInput}
              onChange={(e) => setVoiceQueryInput(e.target.value)}
              placeholder='Bol kar ya type karein: "magnetic ring 270 turn", "colour change", "z axis par 60 turn", "sab wapas lao"...'
              className="w-full bg-transparent text-xs text-white placeholder-slate-400 outline-none"
            />
            <button type="submit" className="text-cyan-400 hover:text-white p-1">
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* FRIDAY Status Pill & Fast Action Buttons */}
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-mono text-cyan-300 max-w-xs truncate hidden lg:block bg-black/40 px-2.5 py-1 rounded-lg border border-cyan-500/20">
            {fridayStatusText}
          </div>

          <button
            onClick={() => setFridayTtsEnabled(!fridayTtsEnabled)}
            className={`p-1.5 rounded-lg border text-xs cursor-pointer ${
              fridayTtsEnabled ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300' : 'bg-slate-800 border-slate-700 text-slate-500'
            }`}
            title={fridayTtsEnabled ? 'Friday Voice Audio ON' : 'Friday Voice Audio Muted'}
          >
            {fridayTtsEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => setShowAnnotations(!showAnnotations)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
              showAnnotations
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
          >
            {showAnnotations ? <Eye className="w-3.5 h-3.5 text-cyan-400" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>3D Labels & Arrows</span>
          </button>
        </div>
      </div>

      {/* ── CAMERA ERROR NOTICE ── */}
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
      <div className="absolute left-4 top-36 z-30 w-64 max-h-[calc(100vh-230px)] overflow-y-auto space-y-2 p-3 rounded-2xl bg-black/75 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
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

      {/* ── RIGHT SIDEBAR: Friday Part Control, Isolation, Angles & Colors ── */}
      <div className="absolute right-4 top-36 z-30 w-72 max-h-[calc(100vh-230px)] overflow-y-auto space-y-3 p-3.5 rounded-2xl bg-black/80 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
        
        {/* ── SELECTED PART / COMPONENT MANAGER ── */}
        <div className="p-3 rounded-xl bg-slate-900/90 border border-cyan-500/40 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-cyan-300 border-b border-slate-800 pb-1.5">
            <span className="flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-amber-400 animate-spin" />
              <span>Selected Part Actions</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {selectedPartName ? '1 Focused' : 'None'}
            </span>
          </div>

          <div className="text-xs text-white font-bold p-2 rounded-lg bg-black/60 border border-cyan-500/30 flex items-center justify-between">
            <span className="truncate">{selectedPartName || 'Select a part or flame'}</span>
            {selectedPartName && (
              <button onClick={() => selectPart(null)} className="text-[10px] text-rose-400 hover:underline">
                Clear
              </button>
            )}
          </div>

          {/* Isolate & Restore Buttons */}
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button
              onClick={isolateSelectedPart}
              className="py-1.5 px-2 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 border border-amber-400 text-[11px] text-amber-200 font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
              title="Hide all other parts and keep only selected"
            >
              <span>Selected Ke Alawa Hatao</span>
            </button>

            <button
              onClick={restoreAllParts}
              className="py-1.5 px-2 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400 text-[11px] text-emerald-200 font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
              title="Show all hidden parts"
            >
              <span>Sab Wapas Lao</span>
            </button>
          </div>

          {/* 360° XYZ 3-Axis Angle Turn Quick Controls */}
          <div className="space-y-2 pt-1.5 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider block">
                XYZ 3-Axis Spatial Gyro:
              </span>
              <span className="text-[9px] text-slate-400 font-mono">
                {selectedPartName ? 'Focused Part' : 'Entire Model'}
              </span>
            </div>

            {/* X-Axis (Pitch / Tilt Up-Down) */}
            <div className="p-1.5 rounded-lg bg-black/40 border border-red-500/20 space-y-1">
              <div className="flex justify-between text-[10px] text-red-300 font-semibold">
                <span>🔴 X-Axis (Pitch)</span>
                <button onClick={() => turnSelectedPart(30, 'x')} className="text-red-400 hover:underline">+30°</button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                <button onClick={() => turnSelectedPart(-45, 'x')} className="py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-red-200">-45°</button>
                <button onClick={() => turnSelectedPart(30, 'x')} className="py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-red-200">+30°</button>
                <button onClick={() => turnSelectedPart(45, 'x')} className="py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-red-200">+45°</button>
                <button onClick={() => turnSelectedPart(90, 'x')} className="py-0.5 rounded bg-red-950/60 border border-red-500/40 text-[9px] text-red-300 font-bold">+90°</button>
              </div>
            </div>

            {/* Y-Axis (Yaw / Turn Left-Right) */}
            <div className="p-1.5 rounded-lg bg-black/40 border border-cyan-500/20 space-y-1">
              <div className="flex justify-between text-[10px] text-cyan-300 font-semibold">
                <span>🔵 Y-Axis (Yaw)</span>
                <button onClick={() => turnSelectedPart(30, 'y')} className="text-cyan-400 hover:underline">+30°</button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                <button onClick={() => turnSelectedPart(-90, 'y')} className="py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-cyan-200">-90°</button>
                <button onClick={() => turnSelectedPart(30, 'y')} className="py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-cyan-200">+30°</button>
                <button onClick={() => turnSelectedPart(90, 'y')} className="py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-cyan-200">+90°</button>
                <button onClick={() => turnSelectedPart(270, 'y')} className="py-0.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-[9px] text-cyan-300 font-bold">270°</button>
              </div>
            </div>

            {/* Z-Axis (Roll / Side Tilt) */}
            <div className="p-1.5 rounded-lg bg-black/40 border border-emerald-500/20 space-y-1">
              <div className="flex justify-between text-[10px] text-emerald-300 font-semibold">
                <span>🟢 Z-Axis (Roll)</span>
                <button onClick={() => turnSelectedPart(30, 'z')} className="text-emerald-400 hover:underline">+30°</button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                <button onClick={() => turnSelectedPart(-30, 'z')} className="py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-emerald-200">-30°</button>
                <button onClick={() => turnSelectedPart(30, 'z')} className="py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-emerald-200">+30°</button>
                <button onClick={() => turnSelectedPart(60, 'z')} className="py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-emerald-200">+60°</button>
                <button onClick={() => turnSelectedPart(90, 'z')} className="py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-[9px] text-emerald-300 font-bold">+90°</button>
              </div>
            </div>
          </div>

          {/* Morph Shape for Selected Component / Atom */}
          <div className="space-y-1.5 pt-1.5 border-t border-slate-800">
            <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider block">
              Morph Shape:
            </span>
            <div className="grid grid-cols-3 gap-1">
              <button
                onClick={() => morphSelectedPartShape('cube')}
                className="py-1 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-cyan-200 font-semibold cursor-pointer"
              >
                Cube
              </button>
              <button
                onClick={() => morphSelectedPartShape('sphere')}
                className="py-1 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-cyan-200 font-semibold cursor-pointer"
              >
                Sphere
              </button>
              <button
                onClick={() => morphSelectedPartShape('cylinder')}
                className="py-1 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-cyan-200 font-semibold cursor-pointer"
              >
                Cylinder
              </button>
              <button
                onClick={() => morphSelectedPartShape('cone')}
                className="py-1 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-cyan-200 font-semibold cursor-pointer"
              >
                Cone
              </button>
              <button
                onClick={() => morphSelectedPartShape('torus')}
                className="py-1 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-cyan-200 font-semibold cursor-pointer"
              >
                Torus
              </button>
              <button
                onClick={() => morphSelectedPartShape('dodecahedron')}
                className="py-1 rounded bg-amber-950/60 border border-amber-500/40 text-[9px] text-amber-300 font-bold cursor-pointer"
              >
                Crystal
              </button>
            </div>
          </div>

          {/* Color Shifting for Selected Part */}
          <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Palette className="w-3 h-3 text-amber-400" />
              <span>Color</span>
            </span>
            <div className="flex gap-1.5">
              {PALETTE_COLORS.slice(0, 6).map((c) => (
                <button
                  key={c.hex}
                  onClick={() => changeSelectedColor(c.hex)}
                  style={{ backgroundColor: c.hex }}
                  className="w-4 h-4 rounded-full transition-transform hover:scale-125 cursor-pointer ring-1 ring-white/30"
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Remove / Delete Part Button */}
          {selectedPartName && (
            <button
              onClick={removeSelectedPart}
              className="w-full py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-600/50 text-rose-300 text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Remove This Part</span>
            </button>
          )}
        </div>

        {/* ── CANDLE & FIRE SPECIAL INTERACTIVE PANEL ── */}
        {selectedModelId === 'candle_fire' && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-2.5 shadow-[0_0_20px_rgba(245,158,11,0.15)]">
            <div className="flex items-center justify-between text-xs font-bold text-amber-300 border-b border-amber-500/30 pb-1.5">
              <span className="flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-orange-400 animate-bounce" />
                <span>Candle & Fire Studio</span>
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200">
                {isFlameAttached ? 'On Wick' : 'Detached'}
              </span>
            </div>

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
                <span>Snap to Wick</span>
              </button>
            </div>

            <button
              onClick={toggleFlameLit}
              className={`w-full py-1 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                isFlameLit
                  ? 'bg-red-500/20 border-red-400 text-red-300'
                  : 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
              }`}
            >
              {isFlameLit ? '💨 Blow Out Flame' : '✨ Light Flame'}
            </button>
          </div>
        )}

        {/* Quick Spawn 3D Shapes */}
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-cyan-500/30 space-y-1.5">
          <span className="text-[10px] text-cyan-300 font-bold uppercase tracking-wider block">
            Add 3D Primitives:
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
              restoreAllParts();
              speakFriday('3D Orientation reset.');
            }}
            className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-xs text-slate-200 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>Reset 3D Orientation</span>
            </span>
          </button>
        </div>

        {/* Gestures & Voice Guide */}
        <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-[11px] text-cyan-300/90 space-y-1">
          <p className="font-bold text-white uppercase text-[10px] tracking-wider flex items-center gap-1">
            <HelpCircle className="w-3 h-3 text-cyan-400" />
            <span>Voice & Gestures:</span>
          </p>
          <p>• 🗣️ "magnetic ring 270 turn" / "z axis par 60 turn"</p>
          <p>• 🗣️ "colour change" / "lal rang karo" / "gold"</p>
          <p>• 🗣️ "Selected ke alawa sab hatao" / "Sab wapas lao"</p>
          <p>• ✊ <b>Fist</b>: 360° Free Rotate | 🤏 <b>Pinch</b>: 1:1 Pick & Depth</p>
        </div>
      </div>

      {/* ── BOTTOM HUD: Real-time Telemetry Coordinates & Depth ── */}
      <div className="relative z-30 mt-auto p-4 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between text-xs text-slate-400 border-t border-cyan-500/20">
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span>X: <b className="text-cyan-300">{telemetry.posX}</b></span>
          <span>Y: <b className="text-cyan-300">{telemetry.posY}</b></span>
          <span>DEPTH (Z): <b className="text-amber-300">{telemetry.posZ}</b></span>
          <span>ROLL: <b className="text-cyan-300">{telemetry.roll}</b></span>
          <span>FOCUSED: <b className="text-amber-400">{telemetry.selectedPart}</b></span>
          {telemetry.held !== 'None' && (
            <span className="text-orange-400 font-bold">HELD: {telemetry.held}</span>
          )}
        </div>

        <div className="text-[11px] text-cyan-400 font-semibold flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          <span>FRIDAY Spatial Precision Engine @ 60 FPS</span>
        </div>
      </div>
    </div>
  );
};
