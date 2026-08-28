/**
 * Procedural Parametric 3D Machine & Structure Models for JARVIS Holographic Studio
 * High-detail hierarchical Three.js models with individual parts for exploded assembly view
 */

import * as THREE from 'three';

export interface ParametricMachineModel {
  id: string;
  name: string;
  category: string;
  description: string;
  group: THREE.Group;
  parts: {
    name: string;
    mesh: THREE.Object3D;
    originalPos: THREE.Vector3;
    explodeDir: THREE.Vector3;
  }[];
  update?: (time: number) => void;
}

// ── Holographic Material Generators ───────────────────────────────────────────

export function createHologramMaterial(colorHex = 0x00f0ff, opacity = 0.85, wireframe = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.8,
    wireframe: wireframe,
    transparent: true,
    opacity: opacity,
    side: THREE.DoubleSide,
  });
}

export function createGlowMaterial(colorHex = 0x00f0ff): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colorHex,
    wireframe: true,
    transparent: true,
    opacity: 0.7,
  });
}

// ── 1. Mark-L Arc Reactor Core ────────────────────────────────────────────────

export function createArcReactorModel(): ParametricMachineModel {
  const group = new THREE.Group();
  const parts: ParametricMachineModel['parts'] = [];

  const cyanMat = createHologramMaterial(0x00f0ff, 0.9);
  const goldMat = createHologramMaterial(0xffb703, 0.95);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    emissive: 0x00ffff,
    emissiveIntensity: 1.5,
    roughness: 0.1,
    transparent: true,
    opacity: 0.95,
  });

  // 1. Central Energy Core
  const coreGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.4, 32);
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.position.set(0, 0, 0);
  group.add(coreMesh);
  parts.push({
    name: 'Palladium Energy Core',
    mesh: coreMesh,
    originalPos: coreMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, 1.5),
  });

  // 2. Inner Magnetic Ring
  const innerRingGeo = new THREE.TorusGeometry(1.4, 0.12, 16, 64);
  const innerRing = new THREE.Mesh(innerRingGeo, cyanMat);
  group.add(innerRing);
  parts.push({
    name: 'Inner Magnetic Ring',
    mesh: innerRing,
    originalPos: innerRing.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, 1.0),
  });

  // 3. 10 Electromagnetic Copper Coils
  const coilGroup = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const coilGeo = new THREE.BoxGeometry(0.3, 0.45, 0.25);
    const coil = new THREE.Mesh(coilGeo, goldMat);
    coil.position.set(Math.cos(angle) * 1.8, Math.sin(angle) * 1.8, 0);
    coil.rotation.z = angle;
    coilGroup.add(coil);
  }
  group.add(coilGroup);
  parts.push({
    name: 'Copper Electromagnetic Coils (10x)',
    mesh: coilGroup,
    originalPos: coilGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, -1.0),
  });

  // 4. Outer Titanium Containment Casing
  const outerRingGeo = new THREE.TorusGeometry(2.3, 0.18, 16, 64);
  const outerRing = new THREE.Mesh(outerRingGeo, cyanMat);
  group.add(outerRing);
  parts.push({
    name: 'Titanium Containment Casing',
    mesh: outerRing,
    originalPos: outerRing.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, -1.8),
  });

  // 5. Back Plate Diffuser
  const backPlateGeo = new THREE.CylinderGeometry(2.4, 2.4, 0.1, 32);
  const backPlateMat = createHologramMaterial(0x0284c7, 0.7);
  const backPlate = new THREE.Mesh(backPlateGeo, backPlateMat);
  backPlate.rotation.x = Math.PI / 2;
  backPlate.position.set(0, 0, -0.3);
  group.add(backPlate);
  parts.push({
    name: 'Back Plate Diffuser & Mount',
    mesh: backPlate,
    originalPos: backPlate.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, -2.5),
  });

  const update = (time: number) => {
    coreMesh.rotation.y = time * 1.5;
    innerRing.rotation.z = time * 0.8;
    coilGroup.rotation.z = -time * 0.4;
  };

  return {
    id: 'arc_reactor',
    name: 'Mark-L Arc Reactor Core',
    category: 'Energy & Fusion',
    description: 'Clean energy plasma fusion core with 10 toroidal copper coils and magnetic containment.',
    group,
    parts,
    update,
  };
}

// ── 2. Quadcopter Drone Assembly ──────────────────────────────────────────────

export function createQuadcopterModel(): ParametricMachineModel {
  const group = new THREE.Group();
  const parts: ParametricMachineModel['parts'] = [];

  const carbonMat = createHologramMaterial(0x0ea5e9, 0.9);
  const motorMat = createHologramMaterial(0xf59e0b, 0.95);
  const propMat = createHologramMaterial(0x38bdf8, 0.75, true);

  // 1. Central Fuselage / Avionics Pod
  const bodyGeo = new THREE.BoxGeometry(1.2, 0.5, 1.6);
  const bodyMesh = new THREE.Mesh(bodyGeo, carbonMat);
  group.add(bodyMesh);
  parts.push({
    name: 'Avionics Center Pod',
    mesh: bodyMesh,
    originalPos: bodyMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, 1.2, 0),
  });

  // 2. 4 Carbon Arms & Motor Hubs
  const armPositions = [
    { x: 1.8, z: 1.8, angle: Math.PI / 4, dir: new THREE.Vector3(1.5, 0, 1.5) },
    { x: -1.8, z: 1.8, angle: -Math.PI / 4, dir: new THREE.Vector3(-1.5, 0, 1.5) },
    { x: 1.8, z: -1.8, angle: (3 * Math.PI) / 4, dir: new THREE.Vector3(1.5, 0, -1.5) },
    { x: -1.8, z: -1.8, angle: (-3 * Math.PI) / 4, dir: new THREE.Vector3(-1.5, 0, -1.5) },
  ];

  const rotorMeshes: THREE.Mesh[] = [];

  armPositions.forEach((pos, idx) => {
    const armGroup = new THREE.Group();

    // Carbon Tube
    const tubeGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.4, 16);
    const tube = new THREE.Mesh(tubeGeo, carbonMat);
    tube.rotation.z = Math.PI / 2;
    tube.rotation.y = pos.angle;
    tube.position.set(pos.x / 2, 0, pos.z / 2);
    armGroup.add(tube);

    // Motor Hub
    const motorGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 16);
    const motor = new THREE.Mesh(motorGeo, motorMat);
    motor.position.set(pos.x, 0.2, pos.z);
    armGroup.add(motor);

    // Propeller Blades
    const propGeo = new THREE.BoxGeometry(2.0, 0.03, 0.2);
    const prop = new THREE.Mesh(propGeo, propMat);
    prop.position.set(pos.x, 0.45, pos.z);
    armGroup.add(prop);
    rotorMeshes.push(prop);

    group.add(armGroup);
    parts.push({
      name: `Rotor Arm & Motor Assembly #${idx + 1}`,
      mesh: armGroup,
      originalPos: armGroup.position.clone(),
      explodeDir: pos.dir,
    });
  });

  // 3. Camera Gimbal Turret (Underneath)
  const gimbalGeo = new THREE.SphereGeometry(0.4, 16, 16);
  const gimbalMat = createHologramMaterial(0x10b981, 0.9);
  const gimbal = new THREE.Mesh(gimbalGeo, gimbalMat);
  gimbal.position.set(0, -0.45, 0.6);
  group.add(gimbal);
  parts.push({
    name: '4K Optical Gimbal Sensor',
    mesh: gimbal,
    originalPos: gimbal.position.clone(),
    explodeDir: new THREE.Vector3(0, -1.5, 0.8),
  });

  const update = (time: number) => {
    rotorMeshes.forEach((prop, i) => {
      prop.rotation.y = time * (i % 2 === 0 ? 25 : -25);
    });
  };

  return {
    id: 'quadcopter_drone',
    name: 'Tactical Recon Drone',
    category: 'Robotics & Aerospace',
    description: 'Autonomous carbon-fiber quadcopter with 4 brushless motors and 3-axis gimbal.',
    group,
    parts,
    update,
  };
}

// ── 3. Supersonic Jet Turbine Engine ─────────────────────────────────────────

export function createJetEngineModel(): ParametricMachineModel {
  const group = new THREE.Group();
  const parts: ParametricMachineModel['parts'] = [];

  const casingMat = createHologramMaterial(0x06b6d4, 0.65, true);
  const bladeMat = createHologramMaterial(0x38bdf8, 0.95);
  const coreMat = createHologramMaterial(0xf97316, 0.9);

  // 1. Intake Nose Cone
  const coneGeo = new THREE.ConeGeometry(0.6, 1.2, 32);
  const cone = new THREE.Mesh(coneGeo, bladeMat);
  cone.rotation.x = Math.PI / 2;
  cone.position.set(0, 0, 2.2);
  group.add(cone);
  parts.push({
    name: 'Air Intake Nose Cone',
    mesh: cone,
    originalPos: cone.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, 2.5),
  });

  // 2. Titanium Fan Rotor Blades
  const fanGroup = new THREE.Group();
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const bladeGeo = new THREE.BoxGeometry(0.15, 1.4, 0.05);
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 1.6);
    blade.rotation.z = angle;
    blade.rotation.y = 0.35;
    fanGroup.add(blade);
  }
  group.add(fanGroup);
  parts.push({
    name: 'Titanium Compressor Fan Stage',
    mesh: fanGroup,
    originalPos: fanGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, 1.8),
  });

  // 3. High-Pressure Combustion Core
  const coreGeo = new THREE.CylinderGeometry(0.9, 0.9, 2.0, 32);
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.rotation.x = Math.PI / 2;
  coreMesh.position.set(0, 0, 0.2);
  group.add(coreMesh);
  parts.push({
    name: 'High-Pressure Combustion Chamber',
    mesh: coreMesh,
    originalPos: coreMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, 1.5, 0),
  });

  // 4. Outer Nacelle Cowling Casing
  const cowlGeo = new THREE.CylinderGeometry(1.8, 1.7, 3.8, 32, 1, true);
  const cowl = new THREE.Mesh(cowlGeo, casingMat);
  cowl.rotation.x = Math.PI / 2;
  group.add(cowl);
  parts.push({
    name: 'Outer Aerodynamic Nacelle Cowling',
    mesh: cowl,
    originalPos: cowl.position.clone(),
    explodeDir: new THREE.Vector3(0, -1.8, 0),
  });

  // 5. Variable Afterburner Exhaust Nozzle
  const nozzleGeo = new THREE.ConeGeometry(1.6, 1.4, 32, 1, true);
  const nozzleMat = createHologramMaterial(0xec4899, 0.9);
  const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
  nozzle.rotation.x = -Math.PI / 2;
  nozzle.position.set(0, 0, -2.4);
  group.add(nozzle);
  parts.push({
    name: 'Afterburner Thrust Vector Nozzle',
    mesh: nozzle,
    originalPos: nozzle.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, -2.8),
  });

  const update = (time: number) => {
    cone.rotation.z = time * 8;
    fanGroup.rotation.z = time * 8;
  };

  return {
    id: 'jet_engine',
    name: 'Supersonic Jet Turbine Engine',
    category: 'Aerospace & Propulsion',
    description: 'Turbofan jet propulsion engine with titanium compressor stage and afterburner thrust nozzle.',
    group,
    parts,
    update,
  };
}

// ── 4. 6-DOF Robotic Arm System ──────────────────────────────────────────────

export function createRoboticArmModel(): ParametricMachineModel {
  const group = new THREE.Group();
  const parts: ParametricMachineModel['parts'] = [];

  const steelMat = createHologramMaterial(0x06b6d4, 0.85);
  const jointMat = createHologramMaterial(0xec4899, 0.95);
  const clawMat = createHologramMaterial(0x10b981, 0.95);

  // 1. Pedestal Base
  const baseGeo = new THREE.CylinderGeometry(1.6, 1.8, 0.4, 32);
  const baseMesh = new THREE.Mesh(baseGeo, steelMat);
  baseMesh.position.set(0, -2.0, 0);
  group.add(baseMesh);
  parts.push({
    name: 'Base Turntable Pedestal',
    mesh: baseMesh,
    originalPos: baseMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, -1.8, 0),
  });

  // 2. Shoulder Actuator Joint
  const shoulderGeo = new THREE.SphereGeometry(0.65, 16, 16);
  const shoulder = new THREE.Mesh(shoulderGeo, jointMat);
  shoulder.position.set(0, -1.4, 0);
  group.add(shoulder);
  parts.push({
    name: 'Hydraulic Shoulder Joint',
    mesh: shoulder,
    originalPos: shoulder.position.clone(),
    explodeDir: new THREE.Vector3(-1.2, -0.5, 0),
  });

  // 3. Lower Arm Cylinder
  const lowerArmGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.8, 16);
  const lowerArm = new THREE.Mesh(lowerArmGeo, steelMat);
  lowerArm.position.set(0.4, -0.4, 0);
  lowerArm.rotation.z = -Math.PI / 8;
  group.add(lowerArm);
  parts.push({
    name: 'Titanium Lower Arm Beam',
    mesh: lowerArm,
    originalPos: lowerArm.position.clone(),
    explodeDir: new THREE.Vector3(1.2, 0, 0),
  });

  // 4. Elbow Joint
  const elbowGeo = new THREE.SphereGeometry(0.5, 16, 16);
  const elbow = new THREE.Mesh(elbowGeo, jointMat);
  elbow.position.set(0.7, 0.6, 0);
  group.add(elbow);
  parts.push({
    name: 'Precision Servo Elbow Joint',
    mesh: elbow,
    originalPos: elbow.position.clone(),
    explodeDir: new THREE.Vector3(0, 1.5, 0),
  });

  // 5. Forearm & Wrist Assembly
  const forearmGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.5, 16);
  const forearm = new THREE.Mesh(forearmGeo, steelMat);
  forearm.position.set(0.3, 1.4, 0);
  forearm.rotation.z = Math.PI / 6;
  group.add(forearm);
  parts.push({
    name: 'Carbon-Fiber Forearm Extension',
    mesh: forearm,
    originalPos: forearm.position.clone(),
    explodeDir: new THREE.Vector3(-1.0, 1.0, 0),
  });

  // 6. Dual Claw Gripper
  const clawGroup = new THREE.Group();
  const claw1Geo = new THREE.BoxGeometry(0.12, 0.6, 0.2);
  const claw1 = new THREE.Mesh(claw1Geo, clawMat);
  claw1.position.set(-0.25, 2.3, 0);
  clawGroup.add(claw1);

  const claw2 = claw1.clone();
  claw2.position.set(0.25, 2.3, 0);
  clawGroup.add(claw2);

  group.add(clawGroup);
  parts.push({
    name: 'Pneumatic 2-Finger Claw Gripper',
    mesh: clawGroup,
    originalPos: clawGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 2.2, 0),
  });

  return {
    id: 'robotic_arm',
    name: '6-DOF Precision Robotic Arm',
    category: 'Industrial Automation',
    description: 'Six degrees-of-freedom robotic manipulator with harmonic drive joints and pneumatic claw.',
    group,
    parts,
  };
}

// ── 5. Cyberpunk Hypercar Spaceframe Chassis ──────────────────────────────────

export function createCarChassisModel(): ParametricMachineModel {
  const group = new THREE.Group();
  const parts: ParametricMachineModel['parts'] = [];

  const chassisMat = createHologramMaterial(0x8b5cf6, 0.9);
  const wheelMat = createHologramMaterial(0x06b6d4, 0.95);
  const aeroMat = createHologramMaterial(0xec4899, 0.9);

  // 1. Spaceframe Monocoque Tub
  const tubGeo = new THREE.BoxGeometry(1.6, 0.6, 3.4);
  const tub = new THREE.Mesh(tubGeo, chassisMat);
  group.add(tub);
  parts.push({
    name: 'Carbon Monocoque Safety Tub',
    mesh: tub,
    originalPos: tub.position.clone(),
    explodeDir: new THREE.Vector3(0, 1.2, 0),
  });

  // 2. 4 Independent Suspension Wheels
  const wheelPositions = [
    { x: 1.3, z: 1.4, name: 'Front-Right Wheel' },
    { x: -1.3, z: 1.4, name: 'Front-Left Wheel' },
    { x: 1.3, z: -1.4, name: 'Rear-Right Wheel' },
    { x: -1.3, z: -1.4, name: 'Rear-Left Wheel' },
  ];

  wheelPositions.forEach((wp) => {
    const wheelGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.45, 24);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wp.x, -0.2, wp.z);
    group.add(wheel);
    parts.push({
      name: `${wp.name} & Brake Caliper`,
      mesh: wheel,
      originalPos: wheel.position.clone(),
      explodeDir: new THREE.Vector3(wp.x > 0 ? 1.8 : -1.8, 0, 0),
    });
  });

  // 3. Active Rear Aero Wing
  const wingGeo = new THREE.BoxGeometry(2.6, 0.08, 0.6);
  const wing = new THREE.Mesh(wingGeo, aeroMat);
  wing.position.set(0, 0.8, -1.8);
  group.add(wing);
  parts.push({
    name: 'Active Aerodynamic Downforce Wing',
    mesh: wing,
    originalPos: wing.position.clone(),
    explodeDir: new THREE.Vector3(0, 1.8, -1.5),
  });

  return {
    id: 'hypercar_chassis',
    name: 'Hypercar Spaceframe Chassis',
    category: 'Automotive Engineering',
    description: 'Electric hypercar platform with carbon-tub monocoque, dual-wishbone corners and active aero.',
    group,
    parts,
  };
}

// ── 6. Blank Hologram Workspace ───────────────────────────────────────────────

export function createBlankWorkspaceModel(): ParametricMachineModel {
  const group = new THREE.Group();
  const parts: ParametricMachineModel['parts'] = [];

  // Glowing 3D Axis Orientation Widget at Origin
  const axisGroup = new THREE.Group();

  // X Axis (Red/Magenta)
  const xLineGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.0, 16);
  const xMat = createHologramMaterial(0xff0055, 0.9);
  const xMesh = new THREE.Mesh(xLineGeo, xMat);
  xMesh.rotation.z = -Math.PI / 2;
  xMesh.position.x = 1.0;
  axisGroup.add(xMesh);

  // Y Axis (Green/Cyan)
  const yLineGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.0, 16);
  const yMat = createHologramMaterial(0x00ff88, 0.9);
  const yMesh = new THREE.Mesh(yLineGeo, yMat);
  yMesh.position.y = 1.0;
  axisGroup.add(yMesh);

  // Z Axis (Blue/Cyan)
  const zLineGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.0, 16);
  const zMat = createHologramMaterial(0x00f0ff, 0.9);
  const zMesh = new THREE.Mesh(zLineGeo, zMat);
  zMesh.rotation.x = Math.PI / 2;
  zMesh.position.z = 1.0;
  axisGroup.add(zMesh);

  // Center Origin Anchor
  const originGeo = new THREE.SphereGeometry(0.15, 16, 16);
  const originMat = createHologramMaterial(0xffffff, 0.95);
  const originMesh = new THREE.Mesh(originGeo, originMat);
  axisGroup.add(originMesh);

  group.add(axisGroup);
  parts.push({
    name: '3D Spatial Coordinate Origin',
    mesh: axisGroup,
    originalPos: axisGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, 0),
  });

  return {
    id: 'blank_workspace',
    name: '✨ Blank Workspace',
    category: 'Open CAD Canvas',
    description: 'Clean spatial holographic coordinate system for freehand air-drawing and custom building.',
    group,
    parts,
  };
}

// ── 7. Interactive Candle & Detachable Fire Flame Fusion ───────────────────────

export interface CandleFireModel extends ParametricMachineModel {
  flameGroup: THREE.Group;
  candleGroup: THREE.Group;
  flameLight: THREE.PointLight;
  isLit: boolean;
  isFlameAttached: boolean;
  wickWorldPos: THREE.Vector3;
  setFlameColor: (colorHex: number) => void;
  setFlameState: (attached: boolean, lit: boolean) => void;
}

export function createCandleFireModel(): CandleFireModel {
  const group = new THREE.Group();
  const parts: ParametricMachineModel['parts'] = [];

  const brassMat = createHologramMaterial(0xf59e0b, 0.95);
  const waxMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xd97706,
    emissiveIntensity: 0.25,
    roughness: 0.35,
    metalness: 0.1,
    transparent: true,
    opacity: 0.9,
  });
  const wickMat = new THREE.MeshStandardMaterial({
    color: 0x1f2937,
    roughness: 0.9,
  });

  // ── A. CANDLE HIERARCHY ──
  const candleGroup = new THREE.Group();
  candleGroup.name = 'Candle_Assembly';

  // 1. Ornate Base Stand
  const baseGeo = new THREE.CylinderGeometry(1.5, 1.8, 0.25, 32);
  const baseMesh = new THREE.Mesh(baseGeo, brassMat);
  baseMesh.position.set(0, -1.8, 0);
  candleGroup.add(baseMesh);

  // Stand Handle Ring
  const handleGeo = new THREE.TorusGeometry(0.45, 0.08, 16, 32);
  const handleMesh = new THREE.Mesh(handleGeo, brassMat);
  handleMesh.rotation.y = Math.PI / 2;
  handleMesh.position.set(1.6, -1.6, 0);
  candleGroup.add(handleMesh);

  // 2. Candle Wax Body (Cylinder with rounded melt rim)
  const waxGeo = new THREE.CylinderGeometry(0.7, 0.78, 2.8, 32);
  const waxMesh = new THREE.Mesh(waxGeo, waxMat);
  waxMesh.position.set(0, -0.3, 0);
  candleGroup.add(waxMesh);

  // Wax Drips on side
  const dripPositions = [
    { x: 0.72, y: 0.7, z: 0.2, s: 0.18 },
    { x: -0.68, y: 0.4, z: 0.35, s: 0.15 },
    { x: 0.1, y: 0.2, z: -0.74, s: 0.22 },
  ];
  dripPositions.forEach((dp) => {
    const dripGeo = new THREE.SphereGeometry(dp.s, 12, 12);
    const dripMesh = new THREE.Mesh(dripGeo, waxMat);
    dripMesh.position.set(dp.x, dp.y, dp.z);
    dripMesh.scale.set(1, 2.2, 1);
    candleGroup.add(dripMesh);
  });

  // 3. Candle Braided Wick
  const wickGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.4, 16);
  const wickMesh = new THREE.Mesh(wickGeo, wickMat);
  wickMesh.position.set(0, 1.25, 0);
  wickMesh.rotation.z = 0.08;
  candleGroup.add(wickMesh);

  group.add(candleGroup);

  parts.push({
    name: 'Candle & Brass Pedestal',
    mesh: candleGroup,
    originalPos: candleGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, -1.2, 0),
  });

  // ── B. DETACHABLE INTERACTIVE FIRE FLAME HIERARCHY ──
  const flameGroup = new THREE.Group();
  flameGroup.name = 'Interactive_Fire_Flame';
  flameGroup.position.set(0, 1.85, 0); // Mounted on wick by default

  // 1. Inner Plasma Core
  const innerFlameGeo = new THREE.ConeGeometry(0.18, 0.65, 16);
  innerFlameGeo.translate(0, 0.3, 0);
  const innerFlameMat = new THREE.MeshStandardMaterial({
    color: 0x60a5fa,
    emissive: 0x93c5fd,
    emissiveIntensity: 2.2,
    roughness: 0.1,
    transparent: true,
    opacity: 0.95,
  });
  const innerFlameMesh = new THREE.Mesh(innerFlameGeo, innerFlameMat);
  flameGroup.add(innerFlameMesh);

  // 2. Outer Fire Envelope (Warm Glowing Orange/Gold Teardrop)
  const outerFlameGeo = new THREE.ConeGeometry(0.36, 1.1, 24);
  outerFlameGeo.translate(0, 0.45, 0);
  const outerFlameMat = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    emissive: 0xfbbf24,
    emissiveIntensity: 1.8,
    roughness: 0.2,
    transparent: true,
    opacity: 0.85,
  });
  const outerFlameMesh = new THREE.Mesh(outerFlameGeo, outerFlameMat);
  flameGroup.add(outerFlameMesh);

  // 3. Flame Halo & Spark Particles (Rising embers)
  const sparkCount = 28;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPositions = new Float32Array(sparkCount * 3);
  const sparkVelocities: { x: number; y: number; z: number; resetY: number }[] = [];

  for (let i = 0; i < sparkCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const rad = Math.random() * 0.45;
    sparkPositions[i * 3] = Math.cos(angle) * rad;
    sparkPositions[i * 3 + 1] = Math.random() * 1.5;
    sparkPositions[i * 3 + 2] = Math.sin(angle) * rad;

    sparkVelocities.push({
      x: (Math.random() - 0.5) * 0.015,
      y: 0.02 + Math.random() * 0.03,
      z: (Math.random() - 0.5) * 0.015,
      resetY: Math.random() * 0.2,
    });
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));

  const sparkMat = new THREE.PointsMaterial({
    color: 0xfef08a,
    size: 0.08,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
  });
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  flameGroup.add(sparkPoints);

  // 4. Dynamic Point Light (Flickering Flame Light Source)
  const flameLight = new THREE.PointLight(0xf59e0b, 3.2, 12);
  flameLight.position.set(0, 0.6, 0);
  flameGroup.add(flameLight);

  // Add Flame to main group
  group.add(flameGroup);

  parts.push({
    name: 'Interactive Fire Flame',
    mesh: flameGroup,
    originalPos: flameGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 1.8, 0),
  });

  let isLit = true;
  let isFlameAttached = true;
  const wickWorldPos = new THREE.Vector3(0, 1.85, 0);

  const setFlameColor = (colorHex: number) => {
    outerFlameMat.color.setHex(colorHex);
    outerFlameMat.emissive.setHex(colorHex);
    sparkMat.color.setHex(colorHex);
    flameLight.color.setHex(colorHex);
  };

  const setFlameState = (attached: boolean, lit: boolean) => {
    isFlameAttached = attached;
    isLit = lit;
    flameGroup.visible = lit;
    flameLight.visible = lit;
    if (attached) {
      flameGroup.position.copy(wickWorldPos);
    }
  };

  // Animation Update loop
  const update = (time: number) => {
    if (!isLit) return;

    // Organic flame flicker and sway
    const flicker1 = Math.sin(time * 18.0) * 0.06;
    const flicker2 = Math.cos(time * 24.0) * 0.04;
    const heightPulse = 1.0 + Math.sin(time * 12.0) * 0.08 + Math.sin(time * 28.0) * 0.04;

    outerFlameMesh.scale.set(1.0 + flicker1, heightPulse, 1.0 + flicker2);
    outerFlameMesh.rotation.z = Math.sin(time * 4.0) * 0.06;
    innerFlameMesh.scale.set(1.0 + flicker2, heightPulse * 0.95, 1.0 + flicker1);

    flameLight.intensity = 2.8 + Math.sin(time * 20.0) * 0.6 + Math.cos(time * 33.0) * 0.4;

    // Animate rising ember sparks
    const positions = sparkGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < sparkCount; i++) {
      const idx = i * 3;
      positions[idx + 1] += sparkVelocities[i].y;
      positions[idx] += sparkVelocities[i].x;
      positions[idx + 2] += sparkVelocities[i].z;

      // Reset when spark reaches top
      if (positions[idx + 1] > 1.8) {
        const angle = Math.random() * Math.PI * 2;
        const rad = Math.random() * 0.3;
        positions[idx] = Math.cos(angle) * rad;
        positions[idx + 1] = sparkVelocities[i].resetY;
        positions[idx + 2] = Math.sin(angle) * rad;
      }
    }
    sparkGeo.attributes.position.needsUpdate = true;
  };

  return {
    id: 'candle_fire',
    name: '🕯️ Candle & Detachable Fire Flame',
    category: 'Interactive Physics & Fusion',
    description: 'Separate candle & magical fire flame! Pinch to carry flame anywhere in 3D depth, 360° rotate, or place on candle wick.',
    group,
    parts,
    flameGroup,
    candleGroup,
    flameLight,
    isLit,
    isFlameAttached,
    wickWorldPos,
    setFlameColor,
    setFlameState,
    update,
  };
}

// ── Model Factory ─────────────────────────────────────────────────────────────

export function getAvailableModels(): { id: string; name: string; category: string; description: string }[] {
  return [
    {
      id: 'candle_fire',
      name: '🕯️ Candle & Interactive Flame',
      category: 'Interactive Physics',
      description: 'Separate candle & fire! Pinch fire to carry in 3D depth, 360° rotate & place on candle wick.',
    },
    {
      id: 'blank_workspace',
      name: '✨ Blank Workspace (Freehand)',
      category: 'Open CAD Canvas',
      description: 'Clean spatial holographic workspace for freehand creation & sculpting.',
    },
    {
      id: 'arc_reactor',
      name: 'Mark-L Arc Reactor Core',
      category: 'Energy & Fusion',
      description: 'Clean energy plasma fusion core with 10 toroidal copper coils.',
    },
    {
      id: 'quadcopter_drone',
      name: 'Tactical Recon Drone',
      category: 'Robotics & Aerospace',
      description: 'Autonomous carbon quadcopter with brushless motors and 4K gimbal.',
    },
    {
      id: 'jet_engine',
      name: 'Supersonic Jet Turbine Engine',
      category: 'Aerospace & Propulsion',
      description: 'Turbofan jet propulsion engine with titanium fan stage and afterburner.',
    },
    {
      id: 'robotic_arm',
      name: '6-DOF Precision Robotic Arm',
      category: 'Industrial Automation',
      description: 'Six degrees-of-freedom robotic manipulator with harmonic drives.',
    },
    {
      id: 'hypercar_chassis',
      name: 'Hypercar Spaceframe Chassis',
      category: 'Automotive Engineering',
      description: 'Electric hypercar chassis with carbon monocoque and active aero.',
    },
    {
      id: 'air_draw',
      name: 'Air-Draw Custom 3D Space',
      category: 'Generative CAD',
      description: 'Draw freehand custom 3D glowing holographic structures in mid-air.',
    },
  ];
}

export function loadModelById(id: string): ParametricMachineModel {
  switch (id) {
    case 'candle_fire':
      return createCandleFireModel();
    case 'blank_workspace':
      return createBlankWorkspaceModel();
    case 'quadcopter_drone':
      return createQuadcopterModel();
    case 'jet_engine':
      return createJetEngineModel();
    case 'robotic_arm':
      return createRoboticArmModel();
    case 'hypercar_chassis':
      return createCarChassisModel();
    case 'arc_reactor':
    default:
      return createArcReactorModel();
  }
}

