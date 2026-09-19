import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { motion } from 'motion/react';
import FridayAvatar from './FridayAvatar';
import type { AgentFaceReaction } from './AgentFace';

export type AvatarAction =
  | 'dance'
  | 'dance_hiphop2'
  | 'dance_salsa'
  | 'dance_swing'
  | 'dance_silly'
  | 'dance_silly2'
  | 'rap'
  | 'jump'
  | 'pushup'
  | 'flip'
  | 'flip_uppercut'
  | 'flip_front'
  | 'flip_twist'
  | 'flip_kick'
  | 'run_flip'
  | 'walk'
  | 'namaste'
  | 'salute'
  | 'angry'
  | 'think'
  | 'wave'
  | 'bow'
  | 'nod-yes'
  | 'nod-no'
  | 'phone'
  | 'stop'
  | null;

export const AVATAR_ACTION_LIST: string[] = [
  'dance',
  'dance_hiphop2',
  'dance_salsa',
  'dance_swing',
  'dance_silly',
  'dance_silly2',
  'rap',
  'jump',
  'pushup',
  'flip',
  'flip_uppercut',
  'flip_front',
  'flip_twist',
  'flip_kick',
  'run_flip',
  'walk',
  'namaste',
  'salute',
  'angry',
  'think',
  'wave',
  'bow',
  'nod-yes',
  'nod-no',
  'phone',
  'stop',
];

export const ACTION_ALIASES: Record<string, string> = {
  backflip: 'flip',
  'back flip': 'flip',
  back_flip: 'flip',
  'back-flip': 'flip',
  frontflip: 'flip_front',
  'front flip': 'flip_front',
  front_flip: 'flip_front',
  'front-flip': 'flip_front',
  flipkick: 'flip_kick',
  'flip kick': 'flip_kick',
  flip_kick: 'flip_kick',
  twistflip: 'flip_twist',
  'twist flip': 'flip_twist',
  uppercut: 'flip_uppercut',
  praying: 'namaste',
  pray: 'namaste',
  pranam: 'namaste',
  pushups: 'pushup',
  'push up': 'pushup',
  push_up: 'pushup',
  'push-up': 'pushup',
  jumping: 'jump',
  rapping: 'rap',
  walking: 'walk',
  dancing: 'dance',
  salsa: 'dance_salsa',
  swing: 'dance_swing',
  silly: 'dance_silly',
};

export const normalizeAvatarAction = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const clean = raw.toLowerCase().trim();
  if (clean === 'stop' || clean === '') return null;
  return ACTION_ALIASES[clean] || clean;
};

interface FridayModel3DProps {
  status: string;
  volume: number;
  reaction?: AgentFaceReaction;
  height?: number;
  onTap?: () => void;
  action?: AvatarAction;
  onActionDone?: () => void;
  fluid?: boolean;
}

const MODEL_URLS = ['/friday.glb', '/friday.fbx'];
const LOCKED_ZOOM = 0.91;
const LOCKED_POS = { x: -0.03, y: 0 };

const FridayModel3D: React.FC<FridayModel3DProps> = ({
  status,
  volume,
  reaction,
  height = 340,
  onTap,
  action,
  onActionDone,
  fluid,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ status, volume, reaction, action });
  stateRef.current = { status, volume, reaction, action };
  const doneRef = useRef(onActionDone);
  doneRef.current = onActionDone;
  const mouseRef = useRef({ x: 0, y: 0 });
  const [modelMissing, setModelMissing] = useState(false);
  const [localAction, setLocalAction] = useState<AvatarAction>(null);
  const localRef = useRef<AvatarAction>(null);

  useEffect(() => {
    const h = (e: Event) => {
      const raw = (e as CustomEvent).detail as string;
      const normalized = normalizeAvatarAction(raw);
      if (!normalized) {
        localRef.current = null;
        setLocalAction(null);
        return;
      }
      localRef.current = normalized as AvatarAction;
      setLocalAction(normalized as AvatarAction);
    };
    window.addEventListener('friday-action', h);
    return () => window.removeEventListener('friday-action', h);
  }, []);

  const isSpeaking = status === 'Speaking...';

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let raf = 0;
    let mixer: THREE.AnimationMixer | null = null;
    const actions: Record<string, THREE.AnimationAction> = {};
    let currentActionName = '';
    let jawBone: THREE.Object3D | null = null;
    let headBone: THREE.Object3D | null = null;

    let spine: THREE.Object3D | null = null;
    let eyeL: THREE.Object3D | null = null;
    let eyeR: THREE.Object3D | null = null;
    let sacT = 2;
    let sacX = 0,
      sacY = 0,
      sacTX = 0,
      sacTY = 0;
    let glanceT = 4;
    let glanceX = 0,
      glanceY = 0,
      glanceTX = 0,
      glanceTY = 0;

    let mouthMorph: { mesh: THREE.Mesh; index: number } | null = null;
    const blinkMorphs: { mesh: THREE.Mesh; index: number }[] = [];
    const visemes: Record<string, { mesh: THREE.Mesh; index: number }> = {};
    let visemePhase = 0;
    let lastVolPeak = 0;

    const W = mount.clientWidth || 300;
    const H = mount.clientHeight || height;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 100);
    camera.position.set(0, 1.35, 3.4);
    camera.lookAt(0, 1.0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xfff1dd, 2.0);
    key.position.set(2, 4, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9db8ff, 0.7);
    fill.position.set(-3, 1.5, 2.5);
    scene.add(fill);
    const rim = new THREE.PointLight(0x3b82f6, 20, 20);
    rim.position.set(0, 2.5, -3);
    scene.add(rim);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 48),
      new THREE.MeshBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.4 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.02;
    modelRoot.add(disc);

    const clock = new THREE.Clock();
    let blinkTimer = 2;
    let blinkT = -1;

    const fadeToAction = (targetName: string, dur = 0.35) => {
      if (!mixer || currentActionName === targetName) return;
      const current = actions[currentActionName];
      const next = actions[targetName];
      if (!next) return;

      next.reset();
      next.setEffectiveTimeScale(1);
      next.setEffectiveWeight(1);
      if (current) {
        current.crossFadeTo(next, dur, true);
      }
      next.play();
      currentActionName = targetName;
    };

    const sanitizeClip = (clip: THREE.AnimationClip, targetModel: THREE.Object3D) => {
      const normalizeKey = (str: string) =>
        str
          .replace(/^(mixamorig\d*|armature|root|_)+/i, '')
          .replace(/[:._\-\s]/g, '')
          .toLowerCase();

      const boneMap = new Map<string, string>();
      targetModel.traverse((o) => {
        if ((o as THREE.Bone).isBone) {
          const k = normalizeKey(o.name);
          boneMap.set(k, o.name);
          boneMap.set(o.name.toLowerCase(), o.name);
        }
      });

      clip.tracks.forEach((track) => {
        const parts = track.name.split('.');
        const nodeName = parts[0];
        const k = normalizeKey(nodeName);
        const matched = boneMap.get(k) ?? boneMap.get(nodeName.toLowerCase());
        if (matched) {
          parts[0] = matched;
          track.name = parts.join('.');
        }
      });
      return clip;
    };

    const handleLoaded = (model: THREE.Object3D, _animations: THREE.AnimationClip[]) => {
      if (disposed) return;

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;
      const targetH = 2.1;
      const s = targetH / Math.max(size.y, 0.001);
      model.scale.setScalar(s);
      modelRoot.add(model);

      model.traverse((o) => {
        const n = o.name.toLowerCase();
        if (!spine && n === 'spine2') spine = o;
        else if (!eyeL && n === 'lefteye') eyeL = o;
        else if (!eyeR && n === 'righteye') eyeR = o;
        else if (!jawBone && /jaw|chin|mouth/i.test(n)) jawBone = o;
        else if (!headBone && /head/i.test(n)) headBone = o;

        const mesh = o as THREE.Mesh;
        const dict = (mesh as THREE.Mesh & { morphTargetDictionary?: Record<string, number> })
          .morphTargetDictionary;
        if (dict && mesh.morphTargetInfluences) {
          Object.entries(dict).forEach(([name, idx]) => {
            const nm = name.toLowerCase();
            if (!mouthMorph && /jawopen|mouthopen|aa|ah|open/i.test(nm))
              mouthMorph = { mesh, index: idx };
            if (/blink|eyelid|eye.*close/i.test(nm)) blinkMorphs.push({ mesh, index: idx });
            if (/mouthsmile|smile/i.test(nm) && !visemes.smile) visemes.smile = { mesh, index: idx };
            if (/mouthfunnel|funnel|oo|oh/i.test(nm) && !visemes.funnel)
              visemes.funnel = { mesh, index: idx };
            if (/mouthpucker|pucker/i.test(nm) && !visemes.pucker)
              visemes.pucker = { mesh, index: idx };
            if (/mouthstretch|stretch/i.test(nm) && !visemes.stretch)
              visemes.stretch = { mesh, index: idx };
            if (/mouthclose|mouthpress|press/i.test(nm) && !visemes.press)
              visemes.press = { mesh, index: idx };
            if (/mouthlower|lowerlip/i.test(nm) && !visemes.lowerLip)
              visemes.lowerLip = { mesh, index: idx };
            if (/mouthshrugup|shrug/i.test(nm) && !visemes.shrug)
              visemes.shrug = { mesh, index: idx };
            if (/jawforward|jawleft|jawright/i.test(nm) && !visemes.jawShift)
              visemes.jawShift = { mesh, index: idx };
            if (/cheekpuff|puff/i.test(nm) && !visemes.cheekPuff)
              visemes.cheekPuff = { mesh, index: idx };
          });
        }
      });

      if (!headBone) headBone = model;

      modelRoot.updateMatrixWorld(true);
      const frame = new THREE.Box3().setFromObject(modelRoot);
      const fullH = Math.max(frame.max.y - frame.min.y, 0.001);
      const centerY = frame.min.y + fullH * 0.5;
      const visH = fullH;
      const visW = Math.min(frame.max.x - frame.min.x, 1.2);
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const fitH = visH / 2 / Math.tan(halfFov);
      const fitW = visW / 2 / (Math.tan(halfFov) * Math.max(camera.aspect, 0.3));
      const fitDist = Math.max(fitH, fitW) * 1.12;
      const camOffsetY = fullH * 0.09;
      camera.position.set(0, centerY + camOffsetY + 0.05, fitDist / LOCKED_ZOOM);
      camera.lookAt(0, centerY + camOffsetY, 0);

      // ── MIXAMO MOCAP ENGINE ──
      mixer = new THREE.AnimationMixer(model);

      mixer.addEventListener('finished', (e: any) => {
        const finishedClipName = e.action?.getClip()?.name;
        console.log(`[FridayModel3D] Mocap finished: ${finishedClipName}`);
        if (localRef.current === finishedClipName) {
          localRef.current = null;
          setLocalAction(null);
        }
        try {
          doneRef.current?.();
        } catch {
          /* noop */
        }
        const isSpk = stateRef.current.status === 'Speaking...';
        fadeToAction(isSpk ? 'talking' : 'idle', 0.35);
      });

      const animLoader = new FBXLoader();
      const animFiles: { name: string; url: string; loop?: boolean }[] = [
        { name: 'idle', url: '/Breathing%20Idle%20(1).fbx', loop: true },
        { name: 'talking', url: '/Talking.fbx', loop: true },
        { name: 'talking_alt', url: '/Talking%20(1).fbx', loop: true },
        { name: 'dance', url: '/Hip%20Hop%20Dancing.fbx', loop: true },
        { name: 'dance_hiphop2', url: '/Hip%20Hop%20Dancing%20(1).fbx', loop: true },
        { name: 'dance_salsa', url: '/Salsa%20Dancing.fbx', loop: true },
        { name: 'dance_swing', url: '/Swing%20Dancing.fbx', loop: true },
        { name: 'dance_silly', url: '/Silly%20Dancing.fbx', loop: true },
        { name: 'dance_silly2', url: '/Silly%20Dancing%20(1).fbx', loop: true },
        { name: 'namaste', url: '/Praying.fbx', loop: false },
        { name: 'salute', url: '/Salute.fbx', loop: false },
        { name: 'angry', url: '/Angry.fbx', loop: false },
        { name: 'rap', url: '/Rapping.fbx', loop: true },
        { name: 'jump', url: '/Jump.fbx', loop: false },
        { name: 'pushup', url: '/Push%20Up.fbx', loop: false },
        { name: 'flip', url: '/Backflip.fbx', loop: false },
        { name: 'flip_uppercut', url: '/Back%20Flip%20To%20Uppercut.fbx', loop: false },
        { name: 'flip_front', url: '/Front%20Flip.fbx', loop: false },
        { name: 'flip_twist', url: '/Front%20Twist%20Flip.fbx', loop: false },
        { name: 'flip_kick', url: '/Flip%20Kick.fbx', loop: false },
        { name: 'run_flip', url: '/Run%20To%20Flip.fbx', loop: false },
        { name: 'walk', url: '/Walking.fbx', loop: true },
      ];

      let loadedIdle = false;
      animFiles.forEach(({ name, url, loop }) => {
        animLoader.load(
          url,
          (animFbx) => {
            if (disposed || !mixer) return;
            if (animFbx.animations && animFbx.animations.length > 0) {
              const rawClip = animFbx.animations[0];
              const clip = sanitizeClip(rawClip, model);
              clip.name = name;
              const action = mixer.clipAction(clip);
              if (loop) {
                action.setLoop(THREE.LoopRepeat, Infinity);
              } else {
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
              }
              actions[name] = action;

              if (name === 'idle' && !loadedIdle) {
                loadedIdle = true;
                action.play();
                currentActionName = 'idle';
              }
              console.log(`[FridayModel3D] Loaded mocap clip: ${name}`);
            }
          },
          undefined,
          (err) => {
            console.warn(`[FridayModel3D] Could not load ${name} animation:`, err);
          }
        );
      });
    };

    const tryLoad = (i: number) => {
      if (disposed) return;
      if (i >= MODEL_URLS.length) {
        setModelMissing(true);
        return;
      }
      const url = MODEL_URLS[i];
      const onError = () => tryLoad(i + 1);
      if (url.endsWith('.fbx')) {
        new FBXLoader().load(
          url,
          (model) =>
            handleLoaded(
              model,
              (model as THREE.Group & { animations: THREE.AnimationClip[] }).animations ?? []
            ),
          undefined,
          onError
        );
      } else {
        new GLTFLoader().load(
          url,
          (gltf) => handleLoaded(gltf.scene, gltf.animations),
          undefined,
          onError
        );
      }
    };
    tryLoad(0);

    const onMouse = (e: MouseEvent) => {
      const r = mount.getBoundingClientRect();
      if (r.width < 1) return;
      const cx = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1);
      const cy = THREE.MathUtils.clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1);
      mouseRef.current.x = cx * 0.5;
      mouseRef.current.y = cy * 0.5;
    };
    window.addEventListener('mousemove', onMouse);

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    let jawOpen = 0;

    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const { status, volume, reaction } = stateRef.current;
      const speaking = status === 'Speaking...';
      const listening = status === 'Listening...';
      const thinking = status === 'Thinking...';
      const happy =
        reaction === 'happy' || reaction === 'success' || reaction === 'photo' || reaction === 'winking';

      const rawActCheck = stateRef.current.action ?? localRef.current;
      const actCheck = normalizeAvatarAction(rawActCheck as string);

      if (actCheck && actions[actCheck]) {
        fadeToAction(actCheck, 0.25);
      } else if (speaking && (actions['talking'] || actions['talking_alt'])) {
        fadeToAction(actions['talking'] ? 'talking' : 'talking_alt', 0.3);
      } else if (!actCheck && actions['idle']) {
        fadeToAction('idle', 0.4);
      }

      mixer?.update(dt);

      // ── Lip-sync & Multi-Visemes ──
      if (speaking && volume > lastVolPeak) lastVolPeak = volume;
      lastVolPeak = lerp(lastVolPeak, 0, 1 - Math.pow(0.05, dt));

      const v = speaking ? Math.max(volume, 0.05) : 0;
      const emphasis = Math.min(v * 3, 1);
      const syllable =
        Math.abs(Math.sin(t * 11.5)) * 0.6 +
        Math.abs(Math.sin(t * 7.3)) * 0.25 +
        Math.abs(Math.sin(t * 18.7)) * 0.15;
      const phrase = 0.5 + 0.5 * Math.sin(t * 1.8);

      const openTarget = speaking
        ? (0.15 + emphasis * 0.55) * syllable * (0.6 + phrase * 0.4)
        : happy
          ? 0.25
          : 0.02;
      jawOpen = lerp(jawOpen, openTarget, 1 - Math.pow(0.001, dt));

      if (jawBone && jawBone !== modelRoot) jawBone.rotation.x = jawOpen * 0.55;
      if (mouthMorph && mouthMorph.mesh.morphTargetInfluences) {
        mouthMorph.mesh.morphTargetInfluences[mouthMorph.index] = Math.min(jawOpen, 1);
      }

      if (speaking) {
        visemePhase += dt * (8 + emphasis * 6);
        const vp = visemePhase;
        const setV = (key: string, val: number) => {
          const vObj = visemes[key];
          if (vObj && vObj.mesh.morphTargetInfluences) {
            vObj.mesh.morphTargetInfluences[vObj.index] = lerp(
              vObj.mesh.morphTargetInfluences[vObj.index] ?? 0,
              Math.max(0, Math.min(val, 1)),
              1 - Math.pow(0.005, dt)
            );
          }
        };
        setV('smile', Math.max(0, Math.sin(vp * 1.3 + 1.5)) * emphasis * 0.4);
        setV('funnel', Math.max(0, Math.sin(vp * 0.9 + 3.0)) * emphasis * 0.45);
        setV('pucker', Math.max(0, Math.sin(vp * 1.1 + 4.5)) * emphasis * 0.3);
        setV('stretch', Math.max(0, Math.sin(vp * 0.7)) * emphasis * 0.25);
        setV('press', Math.max(0, Math.sin(vp * 2.1 + 2.0)) * 0.3 * (syllable < 0.3 ? 1 : 0));
        setV('lowerLip', Math.max(0, Math.sin(vp * 1.5 + 1.0)) * emphasis * 0.3);
        setV('cheekPuff', Math.max(0, Math.sin(vp * 0.4 + 5.0)) * emphasis * 0.15);
        setV('jawShift', Math.sin(vp * 0.6) * emphasis * 0.12);
      } else {
        Object.values(visemes).forEach(({ mesh, index }) => {
          if (mesh.morphTargetInfluences) {
            mesh.morphTargetInfluences[index] = lerp(
              mesh.morphTargetInfluences[index] ?? 0,
              0,
              1 - Math.pow(0.01, dt)
            );
          }
        });
      }

      // ── Blink ──
      blinkTimer -= dt;
      if (blinkTimer <= 0 && blinkT < 0) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt / 0.18;
        if (blinkT >= 1) {
          blinkT = -1;
          blinkTimer = 1.8 + Math.random() * 2.6;
        }
      }
      const blink = blinkT >= 0 ? Math.sin(Math.min(blinkT, 1) * Math.PI) : 0;
      blinkMorphs.forEach(({ mesh, index }) => {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = blink;
      });

      // ── Gaze tracking & Head Orientation ──
      const m = mouseRef.current;
      if (headBone && headBone !== modelRoot) {
        if (speaking) {
          headBone.rotation.x = lerp(headBone.rotation.x, m.y * 0.04, 0.1);
          headBone.rotation.y = lerp(headBone.rotation.y, m.x * 0.08, 0.1);
          headBone.rotation.z = lerp(headBone.rotation.z, 0, 0.1);
        } else {
          headBone.rotation.y = lerp(
            headBone.rotation.y,
            m.x * 0.35 + (thinking ? Math.sin(t * 1.6) * 0.2 : 0),
            0.08
          );
          headBone.rotation.x = lerp(
            headBone.rotation.x,
            m.y * 0.18 + (listening ? -0.1 : 0),
            0.08
          );
          headBone.rotation.z = lerp(headBone.rotation.z, thinking ? 0.12 : 0, 0.06);
        }
        headBone.rotation.x = THREE.MathUtils.clamp(headBone.rotation.x, -0.35, 0.35);
        headBone.rotation.y = THREE.MathUtils.clamp(headBone.rotation.y, -0.45, 0.45);
        headBone.rotation.z = THREE.MathUtils.clamp(headBone.rotation.z, -0.3, 0.3);
      }

      // Procedural Head Nods if explicitly requested
      if (actCheck === 'nod-yes' && headBone && headBone !== modelRoot) {
        headBone.rotation.x += Math.sin(t * 10) * 0.14;
      } else if (actCheck === 'nod-no' && headBone && headBone !== modelRoot) {
        headBone.rotation.y += Math.sin(t * 9) * 0.25;
      }

      // ── Eye Saccades (Darting Look) ──
      sacT -= dt;
      if (sacT <= 0) {
        sacT = 1.8 + Math.random() * 2.5;
        sacTX = (Math.random() - 0.5) * 0.24;
        sacTY = (Math.random() - 0.5) * 0.14;
      }
      sacX = lerp(sacX, sacTX, 1 - Math.pow(0.0001, dt));
      sacY = lerp(sacY, sacTY, 1 - Math.pow(0.0001, dt));
      if (eyeL) {
        eyeL.rotation.y = sacX;
        eyeL.rotation.x = sacY;
      }
      if (eyeR) {
        eyeR.rotation.y = sacX;
        eyeR.rotation.x = sacY;
      }

      // Rim glow theme pulse
      rim.intensity = 18 + Math.min(volume * 60, 22) + Math.sin(t * 2) * 3;

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth || 300;
      const h = mount.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('resize', onResize);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  if (modelMissing) {
    return (
      <FridayAvatar
        status={status}
        volume={volume}
        reaction={reaction}
        height={height}
        onTap={onTap}
      />
    );
  }

  return (
    <div
      className={`relative flex flex-col items-center ${fluid ? 'w-full h-full' : ''}`}
      style={{ perspective: 900 }}
      onDoubleClick={onTap}
    >
      <div
        ref={mountRef}
        style={
          fluid
            ? { width: '100%', height: '100%' }
            : { width: Math.round(height * 0.75), height }
        }
      />
      {isSpeaking && (
        <div
          className={`absolute flex items-end gap-1 pointer-events-none ${
            fluid ? 'bottom-28' : '-bottom-1'
          }`}
        >
          {[0.5, 0.9, 0.65, 1, 0.75, 0.55, 0.85].map((b, i) => (
            <motion.span
              key={i}
              style={{
                width: 4,
                borderRadius: 3,
                background: '#38bdf8',
                boxShadow: '0 0 8px #38bdf8',
              }}
              animate={{ height: [4, 5 + Math.min(volume * 70, 22) * b, 4] }}
              transition={{
                duration: 0.3 + i * 0.03,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default FridayModel3D;
