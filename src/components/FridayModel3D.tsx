import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { motion } from 'motion/react';
import FridayAvatar from './FridayAvatar';
import type { AgentFaceReaction } from './AgentFace';

// Body actions: voice command ("dance karo", "namaste karo"...) ya window event se trigger.
// Test: dispatchEvent(new CustomEvent('friday-action', { detail: 'dance' }))
export type AvatarAction = 'dance' | 'namaste' | 'think' | 'wave' | 'bow' | 'nod-yes' | 'nod-no' | 'phone' | 'stop' | null;
export const AVATAR_ACTION_LIST = ['dance', 'namaste', 'think', 'wave', 'bow', 'nod-yes', 'nod-no', 'phone', 'stop'];
const ONE_SHOT_SECONDS: Record<string, number> = { wave: 4, namaste: 6, think: 6, bow: 3.2, 'nod-yes': 2.5, 'nod-no': 2.5, phone: 8 };

interface FridayModel3DProps {
  status: string;
  volume: number;
  reaction?: AgentFaceReaction;
  height?: number;
  onTap?: () => void;
  action?: AvatarAction;
  onActionDone?: () => void;
  /** fluid = poori screen ka stage (LiveAIInterface), fixed box nahi */
  fluid?: boolean;
}

// Tumhara real 3D model: public/friday.glb (best) ya public/friday.fbx — pehle .glb, phir .fbx try hoga.
// Koi file na mile to photo wala avatar fallback rahega.
const MODEL_URLS = ['/friday.glb', '/friday.fbx'];

// 🔒 LOCKED position: zoom=0.91 x=-0.03 y=0 (camera offset handles bottom alignment)
const LOCKED_ZOOM = 0.91;
const LOCKED_POS = { x: -0.03, y: 0 };

const FridayModel3D: React.FC<FridayModel3DProps> = ({ status, volume, reaction, height = 340, onTap, action, onActionDone, fluid }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ status, volume, reaction, action });
  stateRef.current = { status, volume, reaction, action };
  const doneRef = useRef(onActionDone);
  doneRef.current = onActionDone;
  const mouseRef = useRef({ x: 0, y: 0 });
  const [modelMissing, setModelMissing] = useState(false);
  // Manual override (console test / future buttons) — prop action se merge hota hai
  const [localAction, setLocalAction] = useState<AvatarAction>(null);
  const localRef = useRef<AvatarAction>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const a = (e as CustomEvent).detail as AvatarAction;
      if (a === 'stop' || a === null) { localRef.current = null; setLocalAction(null); return; }
      if (AVATAR_ACTION_LIST.includes(a as string)) {
        localRef.current = a; setLocalAction(a);
        const dur = (ONE_SHOT_SECONDS[a as string] ?? 5) * 1000;
        if (a !== 'dance') setTimeout(() => {
          if (localRef.current === a) { localRef.current = null; setLocalAction(null); }
        }, dur + 400);
      }
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
    let jawBone: THREE.Object3D | null = null;
    let headBone: THREE.Object3D | null = null;
    // Action rig: upper arms + forearms (LeftArm/RightArm, LeftForeArm/RightForeArm)
    let upL: THREE.Object3D | null = null;
    let upR: THREE.Object3D | null = null;
    let foreL: THREE.Object3D | null = null;
    let foreR: THREE.Object3D | null = null;
    let handL: THREE.Object3D | null = null;
    let handR: THREE.Object3D | null = null;
    // Leg rig: thighs, knees, feet (dance ke liye)
    let thighL: THREE.Object3D | null = null;
    let thighR: THREE.Object3D | null = null;
    let shinL: THREE.Object3D | null = null;
    let shinR: THREE.Object3D | null = null;
    let footL: THREE.Object3D | null = null;
    let footR: THREE.Object3D | null = null;
    // Phone model (iPhone 14 Pro)
    let phoneModel: THREE.Object3D | null = null;
    let phoneVisible = false;
    // Alive-idle rig: seena (saans), aankhein (saccade)
    let spine: THREE.Object3D | null = null;
    let eyeL: THREE.Object3D | null = null;
    let eyeR: THREE.Object3D | null = null;
    let sacT = 2; // next eye saccade timer
    let sacX = 0, sacY = 0, sacTX = 0, sacTY = 0; // eye look current/target
    let glanceT = 4; // next head glance timer
    let glanceX = 0, glanceY = 0, glanceTX = 0, glanceTY = 0;
    // Co-speech gesture engine: bolte time haath/sir/body — energy volume se, style phrase se
    let speakEnergy = 0;
    let wasSpeaking = false;
    let speakPhrase = 'nod';
    let phraseT = 0;
    let phraseDur = 2;
    const baseHandL = new THREE.Vector3();
    const baseHandR = new THREE.Vector3();
    let baseHandsSaved = false;
    const PHRASES = ['nod', 'tilt', 'handR', 'handL', 'both', 'lean', 'nod', 'handR'];
    const baseQ = new Map<THREE.Object3D, THREE.Quaternion>();
    let prevAction: AvatarAction = null;
    let actionStart = 0;
    let mouthMorph: { mesh: THREE.Mesh; index: number } | null = null;
    let blinkMorphs: { mesh: THREE.Mesh; index: number }[] = [];
    // Multi-viseme lip-sync: realistic speech needs multiple mouth shapes
    let visemes: Record<string, { mesh: THREE.Mesh; index: number }> = {};
    // Viseme state for smooth blending
    let visemePhase = 0; // cycles through phoneme patterns
    let visemeSpeed = 8; // base oscillation speed
    let lastVolPeak = 0; // track volume peaks for emphasis

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

    // Studio lights
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

    // Soft floor glow disc — modelRoot ka hissa (pairon ke neeche chipka, drag ke saath chalega)
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

    // ── Auto arm-rigging: T-pose haathon ko neeche lao ──
    // Kisi bhi humanoid rig par kaam karega — bone ke local axis guess nahi karta,
    // world-space direction se rotate karta hai (shoulder -> elbow abhi kidhar, neeche kidhar).
    const aimBone = (bone: THREE.Object3D, curDir: THREE.Vector3, wantDir: THREE.Vector3) => {
      const q = new THREE.Quaternion().setFromUnitVectors(curDir.clone().normalize(), wantDir.clone().normalize());
      const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
      const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      bone.quaternion.copy(parentQ.invert().multiply(q.multiply(worldQ)));
      bone.updateMatrixWorld(true);
    };
    // Chain resolver: stray duplicate nodes ignore, sirf asli parent->child chain wali haddi
    const isAncestor = (a: THREE.Object3D, b: THREE.Object3D) => {
      let p = b.parent;
      while (p) { if (p === a) return true; p = p.parent; }
      return false;
    };
    const relaxArms = (model: THREE.Object3D) => {
      model.updateMatrixWorld(true);
      const bones: THREE.Bone[] = [];
      model.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
      if (!bones.length) return false;
      // Anatomical upper-arm = woh 'arm' bone jiske neeche forearm chain hai.
      // Shoulder/clavicle ko CHHUO MAT — wahi peeche dhansne ka kaaran tha!
      const pickUpper = (side: 'left' | 'right') => {
        const cands = bones.filter((b) => b.name.toLowerCase() === `${side}arm`);
        const fore = bones.find((b) => b.name.toLowerCase().startsWith(`${side}forearm`));
        return cands.find((c) => fore && isAncestor(c, fore)) ?? cands[0] ?? null;
      };
      let fixed = 0;
      (['left', 'right'] as const).forEach((side) => {
        const up = pickUpper(side) as THREE.Object3D | null;
        if (!up) return;
        // Kohni = upper ke neeche wali chain (stray duplicate nahi)
        let fore: THREE.Object3D | null = null;
        up.traverse((o) => {
          if (!fore && o !== up && (o as THREE.Bone).isBone && /forearm|elbow/i.test(o.name)) fore = o;
        });
        if (!fore) return;
        up.updateMatrixWorld(true);
        const shoulderP = up.getWorldPosition(new THREE.Vector3());
        const elbowP = fore.getWorldPosition(new THREE.Vector3());
        const curDir = elbowP.sub(shoulderP);
        if (curDir.length() < 1e-4) return;
        curDir.normalize();
        // Sirf tab fix karo jab haath waqai faila ho (sideways), nahi to chhedo mat
        if (Math.abs(curDir.y) > 0.55) return;
        const out = side === 'left' ? 1 : -1;
        // Harness-verified (chain bones): kohni (±0.23, 1.35), haath (±0.22, 1.08, 0.07), shoulder untouched
        aimBone(up, curDir, new THREE.Vector3(out * 0.08, -1, 0.2));
        // Kohni me halka mod (natural look)
        const wristObj = (fore as THREE.Object3D).children.find((c) => (c as THREE.Bone).isBone);
        if (wristObj) {
          fore.updateMatrixWorld(true);
          const eP = fore.getWorldPosition(new THREE.Vector3());
          const wP = wristObj.getWorldPosition(new THREE.Vector3());
          const fDir = wP.sub(eP);
          if (fDir.length() > 1e-4) {
            fDir.normalize();
            aimBone(fore as THREE.Object3D, fDir, new THREE.Vector3(0, -1, 0.35));
          }
        }
        fixed++;
      });
      console.log(`[FridayModel3D] arms relaxed: ${fixed}`);
      return fixed > 0;
    };

    // ── Natural finger curl: khade time ungliyaan halki mudi honi chahiye ──
    // Real human jab seedha khada hota hai, ungliyaan thodi curved rehti hain — akdi nahi
    const curlFingers = (model: THREE.Object3D) => {
      model.updateMatrixWorld(true);
      const fingerPattern = /^(left|right)(hand|index|middle|ring|pinky|thumb)(\d|proximal|intermediate|distal|metacarpal|tip)/i;
      let curled = 0;
      model.traverse((o) => {
        if (!(o as THREE.Bone).isBone) return;
        const n = o.name.toLowerCase();
        // Finger bones: index1/2/3, middle1/2/3, ring1/2/3, pinky1/2/3, thumb1/2/3
        // OR: proximal/intermediate/distal naming
        if (!fingerPattern.test(o.name) && !/finger/i.test(n)) return;
        // Skip thumb metacarpal (base) — sirf phalanges curl karo
        if (/metacarpal/i.test(n)) return;
        // Thumb ko kam curl karo (natural rest position me thumb kam muda hota hai)
        const isThumb = /thumb/i.test(n);
        // Distal (fingertip) thoda zyada curl, proximal thoda kam
        const isDistal = /distal|3$/i.test(n);
        const isIntermediate = /intermediate|2$/i.test(n);
        const curlAmount = isThumb
          ? 0.12 + (isDistal ? 0.08 : 0)
          : isDistal ? 0.35 : isIntermediate ? 0.28 : 0.18;
        // X-axis rotation = ungli andar ki taraf mudi (grip direction)
        o.rotation.x += curlAmount;
        // Pinky aur ring thoda zyada natural curl
        if (/pinky|ring/i.test(n)) o.rotation.x += 0.06;
        curled++;
      });
      if (curled > 0) console.log(`[FridayModel3D] fingers curled: ${curled} bones`);
      return curled > 0;
    };

    // .glb aur .fbx dono support — jo file mile wahi load hogi
    const handleLoaded = (model: THREE.Object3D, animations: THREE.AnimationClip[]) => {
        if (disposed) return;

        // Auto-frame: model ko ground par khada karo, camera fit
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

        // T-pose haath neeche lao (rigging), phir framing — taaki frame sahi bane
        try { relaxArms(model); } catch (e) { console.warn('[FridayModel3D] arm relax failed', e); }
        // Ungliyaan natural curl karo (real human standing pose)
        try { curlFingers(model); } catch (e) { console.warn('[FridayModel3D] finger curl failed', e); }

        // Action bones: chain-resolved (stray duplicates nahi — wahi jo relax me use hue)
        const chainBones = (side: 'left' | 'right') => {
          const chain: THREE.Object3D[] = [];
          model.traverse((o) => { if ((o as THREE.Bone).isBone) chain.push(o); });
          const ups = chain.filter((b) => b.name.toLowerCase() === `${side}arm`);
          const firstFore = chain.find((b) => b.name.toLowerCase().startsWith(`${side}forearm`));
          const up = ups.find((c) => firstFore && isAncestor(c, firstFore)) ?? ups[0] ?? null;
          let fore: THREE.Object3D | null = null;
          if (up) up.traverse((o) => {
            if (!fore && o !== up && (o as THREE.Bone).isBone && /forearm|elbow/i.test(o.name)) fore = o;
          });
          let hand: THREE.Object3D | null = null;
          if (fore) fore.traverse((o) => {
            if (!hand && o !== fore && (o as THREE.Bone).isBone && /hand$/i.test(o.name)) hand = o;
          });
          return { up, fore, hand };
        };
        const chainL = chainBones('left');
        const chainR = chainBones('right');
        upL = chainL.up; foreL = chainL.fore; handL = chainL.hand;
        upR = chainR.up; foreR = chainR.fore; handR = chainR.hand;
        [upL, upR, foreL, foreR, handL, handR].forEach((b) => { if (b) baseQ.set(b, b.quaternion.clone()); });
        // Haathon ki rest position (root-local) — speaking gestures isi se uthenge
        modelRoot.updateMatrixWorld(true);
        if (handL) { baseHandL.copy(modelRoot.worldToLocal(handL.getWorldPosition(new THREE.Vector3()))); baseHandsSaved = true; }
        if (handR) { baseHandR.copy(modelRoot.worldToLocal(handR.getWorldPosition(new THREE.Vector3()))); baseHandsSaved = true; }
        // Alive rig: pehla Spine2 + aankhein + legs pakdo
        model.traverse((o) => {
          const n = o.name.toLowerCase();
          if (!spine && n === 'spine2') spine = o;
          else if (!eyeL && n === 'lefteye') eyeL = o;
          else if (!eyeR && n === 'righteye') eyeR = o;
          // Leg bones: thigh (upleg), shin (leg), foot
          else if (!thighL && (n === 'leftupleg' || n === 'lefthip')) thighL = o;
          else if (!thighR && (n === 'rightupleg' || n === 'righthip')) thighR = o;
          else if (!shinL && (n === 'leftleg' || n === 'leftshin')) shinL = o;
          else if (!shinR && (n === 'rightleg' || n === 'rightshin')) shinR = o;
          else if (!footL && (n === 'leftfoot' || n === 'leftankle')) footL = o;
          else if (!footR && (n === 'rightfoot' || n === 'rightankle')) footR = o;
        });
        // Save base quaternions for leg bones
        [thighL, thighR, shinL, shinR, footL, footR].forEach((b) => { if (b) baseQ.set(b, b.quaternion.clone()); });
        console.log('[FridayModel3D] leg rig:', { thighL: !!thighL, thighR: !!thighR, shinL: !!shinL, shinR: !!shinR, footL: !!footL, footR: !!footR });
        // Load hote hi friendly wave — "zinda" first impression!
        setTimeout(() => {
          if (disposed || stateRef.current.action || localRef.current) return;
          localRef.current = 'wave'; setLocalAction('wave');
          setTimeout(() => {
            if (disposed || localRef.current !== 'wave') return;
            localRef.current = null; setLocalAction(null);
          }, 4400);
        }, 800);
        console.log('[FridayModel3D] action rig:', { upL: !!upL, upR: !!upR, foreL: !!foreL, foreR: !!foreR });

        // Full-body framing: sir se pair tak — pair neeche buttons ke PEECHE jhaankenge
        modelRoot.updateMatrixWorld(true);
        const frame = new THREE.Box3().setFromObject(modelRoot);
        const fullH = Math.max(frame.max.y - frame.min.y, 0.001);
        const centerY = frame.min.y + fullH * 0.5;
        const visH = fullH;
        const visW = Math.min(frame.max.x - frame.min.x, 1.2);
        const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        const fitH = (visH / 2) / Math.tan(halfFov);
        const fitW = (visW / 2) / (Math.tan(halfFov) * Math.max(camera.aspect, 0.3));
        const fitDist = Math.max(fitH, fitW) * 1.12;
        // Camera ko model ke center se UPAR point karo — model screen ke bottom pe dikhega
        const camOffsetY = fullH * 0.09; // 9% upar — pair bottom edge par
        camera.position.set(0, centerY + camOffsetY + 0.05, fitDist / LOCKED_ZOOM);
        camera.lookAt(0, centerY + camOffsetY, 0);

        // Animations: idle wali clip chalao
        if (animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          const idle = animations.find((c) => /idle|breath|stand/i.test(c.name)) ?? animations[0];
          mixer.clipAction(idle).play();
        }

        // Debug: rig ke bone naam console me (arms/pose fix ke kaam aayega)
        const boneNames: string[] = [];
        model.traverse((o) => {
          if ((o as THREE.Bone).isBone) boneNames.push(o.name);
        });
        if (boneNames.length) console.log('[FridayModel3D] bones:', boneNames.slice(0, 60), `...total ${boneNames.length}`);

        // Jaw / head bones dhoondo (lip-sync + nod ke liye)
        model.traverse((o) => {
          const n = o.name.toLowerCase();
          if (!jawBone && /jaw|chin|mouth/i.test(n)) jawBone = o;
          if (!headBone && /head/i.test(n)) headBone = o;
          const mesh = o as THREE.Mesh;
          const dict = (mesh as THREE.Mesh & { morphTargetDictionary?: Record<string, number> }).morphTargetDictionary;
          if (dict && mesh.morphTargetInfluences) {
            Object.entries(dict).forEach(([name, idx]) => {
              const nm = name.toLowerCase();
              if (!mouthMorph && /jawopen|mouthopen|aa|ah|open/i.test(nm)) mouthMorph = { mesh, index: idx };
              if (/blink|eyelid|eye.*close/i.test(nm)) blinkMorphs.push({ mesh, index: idx });
              // Multi-viseme morphs for realistic speech
              if (/mouthsmile|smile/i.test(nm) && !visemes.smile) visemes.smile = { mesh, index: idx };
              if (/mouthfunnel|funnel|oo|oh/i.test(nm) && !visemes.funnel) visemes.funnel = { mesh, index: idx };
              if (/mouthpucker|pucker/i.test(nm) && !visemes.pucker) visemes.pucker = { mesh, index: idx };
              if (/mouthstretch|stretch/i.test(nm) && !visemes.stretch) visemes.stretch = { mesh, index: idx };
              if (/mouthclose|mouthpress|press/i.test(nm) && !visemes.press) visemes.press = { mesh, index: idx };
              if (/mouthlower|lowerlip/i.test(nm) && !visemes.lowerLip) visemes.lowerLip = { mesh, index: idx };
              if (/mouthshrugup|shrug/i.test(nm) && !visemes.shrug) visemes.shrug = { mesh, index: idx };
              if (/jawforward|jawleft|jawright/i.test(nm) && !visemes.jawShift) visemes.jawShift = { mesh, index: idx };
              if (/cheekpuff|puff/i.test(nm) && !visemes.cheekPuff) visemes.cheekPuff = { mesh, index: idx };
            });
          }
        });
        console.log('[FridayModel3D] visemes found:', Object.keys(visemes));

        // Kuch na mile to poore model ko head mano (procedural motion ke liye)
        if (!headBone) headBone = model;

        // ── iPhone 14 Pro load + fallback agar fail ho ──
        const attachPhone = (phoneFbx: THREE.Object3D) => {
          if (disposed) return;
          const phoneBox = new THREE.Box3().setFromObject(phoneFbx);
          const phoneH = phoneBox.max.y - phoneBox.min.y;
          const targetPhoneH = 0.18; // thoda bada — 18cm in model units
          const phoneScale = targetPhoneH / Math.max(phoneH, 0.001);
          phoneFbx.scale.setScalar(phoneScale);
          phoneBox.setFromObject(phoneFbx);
          const phoneCenter = phoneBox.getCenter(new THREE.Vector3());
          phoneFbx.position.sub(phoneCenter);
          phoneFbx.rotation.set(0, 0, 0); // reset rotation
          if (handR) {
            handR.add(phoneFbx);
            phoneFbx.position.set(0, 0.08, 0.02); // palm me, thoda aage
          } else {
            scene.add(phoneFbx);
          }
          phoneModel = phoneFbx;
          phoneModel.visible = false;
          console.log('[FridayModel3D] phone attached to hand');
        };

        // Try loading iPhone FBX — space encoded as %20, + encoded as %2B
        const phoneUrl = '/iPhone%2B14%2BPro.fbx';
        try {
          new FBXLoader().load(phoneUrl, (phoneFbx) => {
            attachPhone(phoneFbx);
          }, undefined, (err) => {
            console.warn('[FridayModel3D] iPhone FBX failed, using fallback box phone:', err);
            // Fallback: simple sleek black box (phone shaped)
            const phoneGeo = new THREE.BoxGeometry(0.07, 0.14, 0.008);
            const phoneMat = new THREE.MeshStandardMaterial({
              color: 0x111111, metalness: 0.9, roughness: 0.1,
            });
            const phoneBox = new THREE.Mesh(phoneGeo, phoneMat);
            // Screen: blue glow
            const screenGeo = new THREE.BoxGeometry(0.063, 0.126, 0.001);
            const screenMat = new THREE.MeshStandardMaterial({
              color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 0.8,
            });
            const screen = new THREE.Mesh(screenGeo, screenMat);
            screen.position.set(0, 0, 0.005);
            phoneBox.add(screen);
            const group = new THREE.Group();
            group.add(phoneBox);
            attachPhone(group);
          });
        } catch (e) {
          console.warn('[FridayModel3D] phone load error:', e);
        }
    };

    const tryLoad = (i: number) => {
      if (disposed) return;
      if (i >= MODEL_URLS.length) { setModelMissing(true); return; }
      const url = MODEL_URLS[i];
      const onError = () => tryLoad(i + 1);
      if (url.endsWith('.fbx')) {
        new FBXLoader().load(url,
          (model) => handleLoaded(model, (model as THREE.Group & { animations: THREE.AnimationClip[] }).animations ?? []),
          undefined, onError);
      } else {
        new GLTFLoader().load(url,
          (gltf) => handleLoaded(gltf.scene, gltf.animations),
          undefined, onError);
      }
    };
    tryLoad(0);

    const onMouse = (e: MouseEvent) => {
      // BUG FIX: poori window par mouse track hota hai — canvas se bahar mouse jaane par
      // value 10x tak jump karke model ko profile/back me ghuma deti thi! Clamp zaroori.
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
    const tmpQ = new THREE.Quaternion();
    const X_AXIS = new THREE.Vector3(1, 0, 0);
    let actionWarned = false;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const { status, volume, reaction } = stateRef.current;
      const speaking = status === 'Speaking...';
      const listening = status === 'Listening...';
      const thinking = status === 'Thinking...';
      const happy = reaction === 'happy' || reaction === 'success' || reaction === 'photo' || reaction === 'winking';

      mixer?.update(dt);

      // ── Lip-sync: multi-viseme realistic speech ──
      // Volume peaks track karo for emphasis moments
      if (speaking && volume > lastVolPeak) lastVolPeak = volume;
      lastVolPeak = lerp(lastVolPeak, 0, 1 - Math.pow(0.05, dt));

      // Phoneme-like oscillation: multiple frequencies mix karke natural speech feel
      const v = speaking ? Math.max(volume, 0.05) : 0;
      const emphasis = Math.min(v * 3, 1); // 0-1 energy
      // Fast syllable rhythm (har syllable par munh khulta-bandh hota)
      const syllable = Math.abs(Math.sin(t * 11.5)) * 0.6 + Math.abs(Math.sin(t * 7.3)) * 0.25 + Math.abs(Math.sin(t * 18.7)) * 0.15;
      // Slow phrase envelope (bolte time energy wax/wane hota hai)
      const phrase = 0.5 + 0.5 * Math.sin(t * 1.8);

      const openTarget = speaking
        ? (0.15 + emphasis * 0.55) * syllable * (0.6 + phrase * 0.4)
        : happy ? 0.25 : 0.02;
      jawOpen = lerp(jawOpen, openTarget, 1 - Math.pow(0.001, dt));

      // Jaw bone rotation
      if (jawBone && jawBone !== modelRoot) jawBone.rotation.x = jawOpen * 0.55;
      // Primary mouth morph
      if (mouthMorph && mouthMorph.mesh.morphTargetInfluences) {
        mouthMorph.mesh.morphTargetInfluences[mouthMorph.index] = Math.min(jawOpen, 1);
      }

      // Multi-viseme blending: har viseme alag phase par fire karta hai — speech natural lagti hai
      if (speaking) {
        visemePhase += dt * (8 + emphasis * 6); // speed up with energy
        const vp = visemePhase;
        // Each viseme fires at different phase offsets (like real phonemes cycling)
        const setV = (key: string, val: number) => {
          const v = visemes[key];
          if (v && v.mesh.morphTargetInfluences) {
            v.mesh.morphTargetInfluences[v.index] = lerp(
              v.mesh.morphTargetInfluences[v.index] ?? 0, Math.max(0, Math.min(val, 1)),
              1 - Math.pow(0.005, dt)
            );
          }
        };
        // "aa" moments (jaw open wide) — main driver
        // "ee/smile" moments — lips stretch horizontally
        setV('smile', Math.max(0, Math.sin(vp * 1.3 + 1.5)) * emphasis * 0.4);
        // "oo/funnel" moments — lips round
        setV('funnel', Math.max(0, Math.sin(vp * 0.9 + 3.0)) * emphasis * 0.45);
        // "u/pucker" — lips purse
        setV('pucker', Math.max(0, Math.sin(vp * 1.1 + 4.5)) * emphasis * 0.3);
        // Mouth stretch (wide) — on emphasis
        setV('stretch', Math.max(0, Math.sin(vp * 0.7)) * emphasis * 0.25);
        // Press lips ("m", "b", "p" sounds) — brief closures
        setV('press', Math.max(0, Math.sin(vp * 2.1 + 2.0)) * 0.3 * (syllable < 0.3 ? 1 : 0));
        // Lower lip movement
        setV('lowerLip', Math.max(0, Math.sin(vp * 1.5 + 1.0)) * emphasis * 0.3);
        // Cheek puff on certain phrases
        setV('cheekPuff', Math.max(0, Math.sin(vp * 0.4 + 5.0)) * emphasis * 0.15);
        // Jaw micro-shift (natural jaw movement isn't perfectly centered)
        setV('jawShift', Math.sin(vp * 0.6) * emphasis * 0.12);
      } else {
        // Not speaking: smoothly return all visemes to 0
        Object.values(visemes).forEach(({ mesh, index }) => {
          if (mesh.morphTargetInfluences) {
            mesh.morphTargetInfluences[index] = lerp(
              mesh.morphTargetInfluences[index] ?? 0, 0, 1 - Math.pow(0.01, dt)
            );
          }
        });
      }

      // ── Blink (morph ho to wahi, nahi to head micro-nod se natural feel) ──
      blinkTimer -= dt;
      if (blinkTimer <= 0 && blinkT < 0) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt / 0.18;
        if (blinkT >= 1) { blinkT = -1; blinkTimer = 1.8 + Math.random() * 2.6; }
      }
      const blink = blinkT >= 0 ? Math.sin(Math.min(blinkT, 1) * Math.PI) : 0;
      blinkMorphs.forEach(({ mesh, index }) => {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = blink;
      });

      // ── Body language ──
      const m = mouseRef.current;
      modelRoot.rotation.y = Math.sin(t * 0.4) * 0.06 + m.x * 0.3;
      modelRoot.position.y = (happy
        ? Math.abs(Math.sin(t * 2.6)) * 0.04
        : Math.sin(t * 1.5) * 0.015) + LOCKED_POS.y;
      if (headBone && headBone !== modelRoot.children[0]) {
        headBone.rotation.y = lerp(headBone.rotation.y, m.x * 0.35 + (thinking ? Math.sin(t * 1.6) * 0.2 : 0), 0.08);
        headBone.rotation.x = lerp(headBone.rotation.x, m.y * 0.18 + (listening ? -0.1 : 0) + (speaking ? Math.sin(t * 13) * 0.03 * Math.min(1, volume * 4) : 0), 0.08);
        headBone.rotation.z = lerp(headBone.rotation.z, thinking ? 0.12 : 0, 0.06);
        // Safety clamp: sir kabhi profile/exorcist mode me na jaaye
        headBone.rotation.x = THREE.MathUtils.clamp(headBone.rotation.x, -0.35, 0.35);
        headBone.rotation.y = THREE.MathUtils.clamp(headBone.rotation.y, -0.45, 0.45);
        headBone.rotation.z = THREE.MathUtils.clamp(headBone.rotation.z, -0.3, 0.3);
      } else {
        // Bones na mile to poore model par subtle motion
        modelRoot.rotation.x = m.y * 0.06;
      }

      // ── Avatar body actions: dance / namaste / think / wave / bow / nod ──
      try {
      const rawAct: AvatarAction = stateRef.current.action ?? localRef.current;
      const act = rawAct === 'stop' ? null : rawAct;
      if (act !== prevAction) {
        // purana pose wapas, auto-clear timer reset
        baseQ.forEach((q, b) => b.quaternion.copy(q));
        modelRoot.rotation.x = 0;
        if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
        // Phone action se bahar aate hi phone hide karo
        if (prevAction === 'phone' && phoneModel) {
          phoneModel.visible = false;
          phoneVisible = false;
        }
        if (act === 'namaste' || act === 'think') {
          // Static pose — smooth transition hoga animate loop me
          // IK targets set karo, animate me easing se blend hoga
        }
        prevAction = act;
        actionStart = t;
        if (act && act !== 'dance') {
          const dur = (ONE_SHOT_SECONDS[act] ?? 5) * 1000;
          clearTimer = setTimeout(() => {
            if (disposed) return;
            if (localRef.current) { localRef.current = null; setLocalAction(null); }
            else { try { doneRef.current?.(); } catch { /* noop */ } }
          }, dur);
        }
      }
      const actT = t - actionStart;
      // Smooth ease-in/out envelope for all actions
      const easeIn = Math.min(actT / 0.6, 1); // 0.6s ease in
      const easeInSmooth = easeIn * easeIn * (3 - 2 * easeIn); // smoothstep

      if (act === 'dance') {
        // ── Natural groove dance: slower, hip sway, head bob, alternating arms ──
        const d = t * 4.5; // slower than before (was 7)
        const bounce = Math.abs(Math.sin(d)) * easeInSmooth;
        // Body bounce (knees bend feel)
        modelRoot.position.y += bounce * 0.06;
        // Hip sway — weight transfer left-right
        modelRoot.rotation.z = Math.sin(d * 0.5) * 0.08 * easeInSmooth;
        modelRoot.rotation.y += Math.sin(d * 0.25) * 0.06 * easeInSmooth;
        // Slight forward lean (dancing posture)
        modelRoot.rotation.x = 0.04 * easeInSmooth;
        // Head groove — bob with body, slight look-around
        if (headBone && headBone !== modelRoot) {
          headBone.rotation.x += Math.sin(d * 2) * 0.06 * easeInSmooth;
          headBone.rotation.y += Math.sin(d * 0.7) * 0.08 * easeInSmooth;
          headBone.rotation.z += Math.sin(d * 1.3) * 0.04 * easeInSmooth;
        }
        // Arms: alternating raise-lower, elbows out, wrists loose
        const groove = (up: THREE.Object3D | null, fore: THREE.Object3D | null, hand: THREE.Object3D | null, out: 1 | -1, ph: number) => {
          if (!up || !fore) return;
          const sP = up.getWorldPosition(new THREE.Vector3());
          const eP = fore.getWorldPosition(new THREE.Vector3());
          const toElbow = eP.clone().sub(sP);
          if (toElbow.length() < 1e-4) return;
          // Arm lifts up on beat, stays forward
          const lift = 0.3 * Math.sin(ph) * easeInSmooth;
          aimBone(up, toElbow.normalize(), new THREE.Vector3(out * 0.35, -0.4 + lift, 0.5).normalize());
          fore.updateMatrixWorld(true);
          const eP2 = fore.getWorldPosition(new THREE.Vector3());
          const wrist = fore.children.find((c) => (c as THREE.Bone).isBone);
          const wP = wrist ? (wrist as THREE.Object3D).getWorldPosition(new THREE.Vector3()) : eP2.clone();
          const fDir = wP.sub(eP2);
          if (fDir.length() > 1e-4) {
            aimBone(fore, fDir.normalize(), new THREE.Vector3(out * 0.15, -0.15 + 0.3 * Math.cos(ph), 0.65).normalize());
          }
          // Wrist loose rotation
          if (hand && baseQ.has(hand)) {
            hand.quaternion.copy(baseQ.get(hand)!).multiply(tmpQ.setFromAxisAngle(X_AXIS, Math.sin(ph * 1.5) * 0.3 * easeInSmooth));
          }
        };
        groove(upL, foreL, handL, 1, d);
        groove(upR, foreR, handR, -1, d + Math.PI * 0.7);

        // Legs: alternating weight shift + knee tap + foot lift on beat
        const legBeat = (thigh: THREE.Object3D | null, shin: THREE.Object3D | null, foot: THREE.Object3D | null, ph: number) => {
          if (!thigh) return;
          const liftAmt = Math.max(0, Math.sin(ph)) * easeInSmooth;
          // Thigh lifts forward (knee raise)
          if (baseQ.has(thigh)) {
            thigh.quaternion.copy(baseQ.get(thigh)!).multiply(tmpQ.setFromAxisAngle(X_AXIS, -liftAmt * 0.35));
          }
          // Shin bends back when thigh lifts (natural knee bend)
          if (shin && baseQ.has(shin)) {
            shin.quaternion.copy(baseQ.get(shin)!).multiply(tmpQ.setFromAxisAngle(X_AXIS, liftAmt * 0.45));
          }
          // Foot tap: toe points down on lift
          if (foot && baseQ.has(foot)) {
            foot.quaternion.copy(baseQ.get(foot)!).multiply(tmpQ.setFromAxisAngle(X_AXIS, -liftAmt * 0.2));
          }
        };
        // Left and right legs alternate (opposite phase)
        legBeat(thighL, shinL, footL, d * 0.5);
        legBeat(thighR, shinR, footR, d * 0.5 + Math.PI);

      } else if (act === 'wave' && upR && foreR && baseQ.has(upR) && baseQ.has(foreR)) {
        // ── Natural friendly wave: smooth arm raise, wrist pivot, body lean ──
        // Smooth raise: arm goes up over 0.5s, then waves
        const raiseP = Math.min(actT / 0.5, 1);
        const raiseSmooth = raiseP * raiseP * (3 - 2 * raiseP);
        const Z_WAVE = new THREE.Vector3(0, 0, 1);
        const Y_WAVE = new THREE.Vector3(0, 1, 0);

        // ── Upper arm: -X axis = arm raises OUTWARD to the side (abduction) ──
        // In this FBX rig, local -X = arm goes sideways/up (not Z!)
        // -1.4 rad = ~80° outward raise (elbow at ear height)
        upR.quaternion.copy(baseQ.get(upR)!)
          .multiply(tmpQ.setFromAxisAngle(X_AXIS, -1.4 * raiseSmooth)); // sideways OUT

        // ── Forearm: 90° elbow bend + palm faces FRONT (+Z) ──
        // X-axis: elbow bend (arm comes up)
        // Y-axis: supination — rotates palm from -X to face +Z (toward viewer)
        foreR.quaternion.copy(baseQ.get(foreR)!)
          .multiply(tmpQ.setFromAxisAngle(X_AXIS, -1.4 * raiseSmooth))   // elbow bend up
          .multiply(tmpQ.setFromAxisAngle(Y_WAVE, 1.57 * raiseSmooth));  // palm → +Z front (corrected sign)

        // ── Forearm waves: Y-axis left-right oscillation ──
        const waveOsc = Math.sin(t * 5.5) * 0.55 * raiseSmooth;
        foreR.quaternion.multiply(tmpQ.setFromAxisAngle(Y_WAVE, waveOsc));

        // ── Wrist: Z-axis adds extra wave personality ──
        if (handR && baseQ.has(handR)) {
          handR.quaternion.copy(baseQ.get(handR)!)
            .multiply(tmpQ.setFromAxisAngle(Z_WAVE, Math.sin(t * 5.5 + 0.5) * 0.3 * raiseSmooth));
        }

        // Body lean slightly toward wave side
        modelRoot.rotation.z = -0.04 * raiseSmooth;
        // Head: look forward, friendly nod
        if (headBone && headBone !== modelRoot) {
          headBone.rotation.y += 0.07 * raiseSmooth;
          headBone.rotation.x += Math.sin(t * 2.5) * 0.03 * raiseSmooth;
        }

      } else if (act === 'namaste') {
        // ── NAMASTE: Bone-by-bone direct local rotation (NO IK) ──
        // Direct quaternion on each bone's LOCAL axis — predictable, anatomically correct
        const poseP = Math.min(actT / 0.9, 1);
        const ps = poseP * poseP * (3 - 2 * poseP); // smoothstep

        // Body: slight respectful forward bow
        modelRoot.rotation.x = 0.08 * ps;

        // Helper: slerp from base to target quaternion
        const applyRot = (bone: THREE.Object3D | null, axis: THREE.Vector3, angleRad: number) => {
          if (!bone || !baseQ.has(bone)) return;
          const target = baseQ.get(bone)!.clone()
            .multiply(tmpQ.setFromAxisAngle(axis, angleRad));
          bone.quaternion.copy(baseQ.get(bone)!).slerp(target, ps);
        };

        // ── Local axis constants ──
        const LX = new THREE.Vector3(1, 0, 0);
        const LY = new THREE.Vector3(0, 1, 0);
        const LZ = new THREE.Vector3(0, 0, 1);

        // ── RIGHT ARM (mirror of left) ──
        // RIGHT UpperArm:
        //   Z-axis: adduction — arm moves INWARD toward center chest (negative Z = right arm toward center)
        //   X-axis: slight forward raise so elbow doesn't go backward
        //   Result: upper arm ~45° inward, ~30° forward
        if (upR && baseQ.has(upR)) {
          const target = baseQ.get(upR)!.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(LZ, -0.72)) // ~-41° inward adduction
            .multiply(new THREE.Quaternion().setFromAxisAngle(LX, -0.52)) // ~-30° forward raise
            .multiply(new THREE.Quaternion().setFromAxisAngle(LY,  0.20)); // slight inward roll
          upR.quaternion.copy(baseQ.get(upR)!).slerp(target, ps);
        }

        // RIGHT ForeArm:
        //   X-axis: elbow flexion ~95° (forearm bends toward chest)
        //   Y-axis: slight supination so palm faces partner's palm
        if (foreR && baseQ.has(foreR)) {
          const target = baseQ.get(foreR)!.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(LX, -1.65)) // ~-95° elbow flex
            .multiply(new THREE.Quaternion().setFromAxisAngle(LY, -0.25)); // palm faces inward
          foreR.quaternion.copy(baseQ.get(foreR)!).slerp(target, ps);
        }

        // RIGHT Hand/Wrist:
        //   X-axis: wrist slight extension (fingers point upward)
        //   Z-axis: slight inward tilt so palms face perfectly together
        if (handR && baseQ.has(handR)) {
          const target = baseQ.get(handR)!.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(LX, -0.20)) // wrist slight up
            .multiply(new THREE.Quaternion().setFromAxisAngle(LZ,  0.12)); // palm face correction
          handR.quaternion.copy(baseQ.get(handR)!).slerp(target, ps);
        }

        // ── LEFT ARM (symmetric — all Z signs flipped) ──
        // LEFT UpperArm:
        //   Z-axis: adduction inward (positive Z = left arm toward center)
        //   X-axis: same forward raise
        if (upL && baseQ.has(upL)) {
          const target = baseQ.get(upL)!.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(LZ,  0.72)) // +41° inward adduction
            .multiply(new THREE.Quaternion().setFromAxisAngle(LX, -0.52)) // -30° forward raise
            .multiply(new THREE.Quaternion().setFromAxisAngle(LY, -0.20)); // mirror roll
          upL.quaternion.copy(baseQ.get(upL)!).slerp(target, ps);
        }

        // LEFT ForeArm:
        if (foreL && baseQ.has(foreL)) {
          const target = baseQ.get(foreL)!.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(LX, -1.65)) // ~-95° elbow flex
            .multiply(new THREE.Quaternion().setFromAxisAngle(LY,  0.25)); // mirror supination
          foreL.quaternion.copy(baseQ.get(foreL)!).slerp(target, ps);
        }

        // LEFT Hand/Wrist:
        if (handL && baseQ.has(handL)) {
          const target = baseQ.get(handL)!.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(LX, -0.20))
            .multiply(new THREE.Quaternion().setFromAxisAngle(LZ, -0.12)); // mirror
          handL.quaternion.copy(baseQ.get(handL)!).slerp(target, ps);
        }

        // ── FINGERS: extended with very slight curl (natural, not rigid) ──
        // Find and apply to all finger bones
        try {
          const fingerPat = /^(left|right)(index|middle|ring|pinky|thumb)(\d|proximal|intermediate|distal)/i;
          modelRoot.traverse((o) => {
            if (!(o as THREE.Bone).isBone || !baseQ.has(o)) return;
            if (!fingerPat.test(o.name)) return;
            if (/metacarpal/i.test(o.name)) return;
            const isThumb = /thumb/i.test(o.name);
            const isDistal = /distal|3$/i.test(o.name);
            // Namaste: fingers mostly extended (less curl than resting pose)
            // but slight natural curve — not perfectly flat
            const extendAmt = isThumb ? -0.05 : isDistal ? -0.08 : -0.06;
            const target = baseQ.get(o)!.clone()
              .multiply(new THREE.Quaternion().setFromAxisAngle(LX, extendAmt));
            o.quaternion.copy(baseQ.get(o)!).slerp(target, ps);
          });
        } catch (_) { /* finger extension optional */ }

        // Head: respectful bow — look slightly downward, gentle sway
        if (headBone && headBone !== modelRoot) {
          headBone.rotation.x += 0.18 * ps;
          headBone.rotation.y += Math.sin(t * 0.7) * 0.025 * ps;
        }

      } else if (act === 'think') {
        // ── Natural thinking pose: hand on chin, body lean, slow head sway ──
        const poseP = Math.min(actT / 0.7, 1);
        const poseSmooth = poseP * poseP * (3 - 2 * poseP);
        // Body lean: slight tilt (thinking posture)
        modelRoot.rotation.z = 0.03 * poseSmooth;
        modelRoot.rotation.x = 0.03 * poseSmooth;
        try {
          modelRoot.updateMatrixWorld(true);
          const chinP = modelRoot.localToWorld(new THREE.Vector3(0.02, 1.68, 0.15));
          const thinkUpR = modelRoot.localToWorld(new THREE.Vector3(-0.13, 1.25, 0.22));
          const aimArm = (up: THREE.Object3D | null, fore: THREE.Object3D | null, hand: THREE.Object3D | null, upTarget: THREE.Vector3, foreTarget: THREE.Vector3) => {
            if (!up || !fore) return;
            const sP = up.getWorldPosition(new THREE.Vector3());
            const eP = fore.getWorldPosition(new THREE.Vector3());
            const toElbow = eP.clone().sub(sP);
            if (toElbow.length() < 1e-4) return;
            aimBone(up, toElbow.normalize(), upTarget.sub(sP).normalize());
            fore.updateMatrixWorld(true);
            const eP2 = fore.getWorldPosition(new THREE.Vector3());
            const hP = hand ? hand.getWorldPosition(new THREE.Vector3()) : eP2.clone().add(new THREE.Vector3(0, -0.25, 0));
            const fDir = hP.sub(eP2);
            if (fDir.length() > 1e-4) aimBone(fore, fDir.normalize(), foreTarget.clone().sub(eP2).normalize());
          };
          if (poseSmooth > 0.1) {
            aimArm(upR, foreR, handR, thinkUpR, chinP);
          }
          // Left arm: cross slightly (natural thinking — left hand rests on right elbow area)
          if (upL && foreL && poseSmooth > 0.2) {
            const crossTarget = modelRoot.localToWorld(new THREE.Vector3(0.05, 1.1, 0.2));
            const crossElbow = modelRoot.localToWorld(new THREE.Vector3(0.2, 0.85, 0.15));
            aimArm(upL, foreL, handL, crossElbow, crossTarget);
          }
        } catch (e) { console.warn('[FridayModel3D] think pose failed', e); }
        // Head: tilted, slow contemplative sway
        if (headBone && headBone !== modelRoot) {
          headBone.rotation.z += 0.12 * poseSmooth;
          headBone.rotation.x += (0.06 + Math.sin(t * 0.7) * 0.04) * poseSmooth;
          headBone.rotation.y += Math.sin(t * 0.5) * 0.06 * poseSmooth;
        }

      } else if (act === 'bow') {
        const p = Math.min(actT / (ONE_SHOT_SECONDS.bow ?? 3.2), 1);
        const bowSmooth = Math.sin(p * Math.PI);
        modelRoot.rotation.x = bowSmooth * 0.45;
        // Head follows bow
        if (headBone && headBone !== modelRoot) {
          headBone.rotation.x += bowSmooth * 0.15;
        }
      } else if (act === 'nod-yes' && headBone && headBone !== modelRoot) {
        headBone.rotation.x += Math.sin(actT * 10) * 0.12 * Math.max(0, 1 - actT / 2.5);
      } else if (act === 'nod-no' && headBone && headBone !== modelRoot) {
        headBone.rotation.y += Math.sin(actT * 9) * 0.25 * Math.max(0, 1 - actT / 2.5);

      } else if (act === 'phone') {
        // ── Phone action: pocket se nikalo, dekhte hue tap karo ──
        // Phase 1 (0-1s): haath niche jaata hai (pocket reach)
        // Phase 2 (1-2s): phone uthake chest level par laata hai
        // Phase 3 (2-7s): phone dekhte hue tap karta hai
        // Phase 4 (7-8s): phone wapas niche (put away)
        const totalDur = ONE_SHOT_SECONDS.phone ?? 8;

        // Show phone when action starts
        if (phoneModel && !phoneModel.visible && actT > 0.3) {
          phoneModel.visible = true;
          phoneVisible = true;
        }
        // Hide phone near end
        if (phoneModel && actT > totalDur - 1.5) {
          phoneModel.visible = false;
          phoneVisible = false;
        }

        // Smooth phase transitions
        const reachDown = Math.min(actT / 0.8, 1); // 0-0.8s reach pocket
        const bringUp = actT > 0.8 ? Math.min((actT - 0.8) / 0.7, 1) : 0; // 0.8-1.5s bring up
        const holdPhase = actT > 1.5 && actT < totalDur - 1.5 ? 1 : 0; // holding & tapping
        const putAway = actT > totalDur - 1.5 ? Math.min((actT - (totalDur - 1.5)) / 1, 1) : 0;
        const reachSmooth = reachDown * reachDown * (3 - 2 * reachDown);
        const upSmooth = bringUp * bringUp * (3 - 2 * bringUp);
        const awaySmooth = putAway * putAway * (3 - 2 * putAway);

        // Combined arm position blend
        const armProg = actT < 0.8
          ? reachSmooth * 0.3 // reaching down
          : actT < 1.5
            ? 0.3 + upSmooth * 0.7 // bringing up
            : actT < totalDur - 1.5
              ? 1.0 // holding at chest
              : 1.0 - awaySmooth; // putting away

        if (upR && foreR && baseQ.has(upR) && baseQ.has(foreR)) {
          // Upper arm: STRONGLY forward + inward (haath seedha saamne aaye)
          const armX = -1.4 * armProg;  // -1.4 rad = arm well forward (chest level)
          upR.quaternion.copy(baseQ.get(upR)!)
            .multiply(tmpQ.setFromAxisAngle(X_AXIS, armX));
          // Also rotate inward (Z axis) so arm comes to center
          const Z_AXIS = new THREE.Vector3(0, 0, 1);
          upR.quaternion.multiply(tmpQ.setFromAxisAngle(Z_AXIS, 0.4 * armProg));

          // Forearm: bends so haath saamne ho (elbow 90deg jaisi position)
          const foreX = -1.1 * armProg;
          foreR.quaternion.copy(baseQ.get(foreR)!).multiply(tmpQ.setFromAxisAngle(X_AXIS, foreX));

          // Tapping: thumb flick on screen
          if (handR && baseQ.has(handR) && holdPhase > 0) {
            const tap = Math.abs(Math.sin(t * 3.5)) > 0.75 ? Math.sin(t * 8) * 0.2 : 0;
            handR.quaternion.copy(baseQ.get(handR)!).multiply(tmpQ.setFromAxisAngle(X_AXIS, tap));
          }
        }

        // Left arm: supports phone from below
        if (upL && foreL && baseQ.has(upL) && baseQ.has(foreL) && armProg > 0.4) {
          const supportP = Math.min((armProg - 0.4) / 0.6, 1);
          const supportSmooth = supportP * supportP * (3 - 2 * supportP);
          const Z_AXIS2 = new THREE.Vector3(0, 0, 1);
          upL.quaternion.copy(baseQ.get(upL)!)
            .multiply(tmpQ.setFromAxisAngle(X_AXIS, -1.0 * supportSmooth));
          upL.quaternion.multiply(tmpQ.setFromAxisAngle(Z_AXIS2, -0.35 * supportSmooth));
          foreL.quaternion.copy(baseQ.get(foreL)!)
            .multiply(tmpQ.setFromAxisAngle(X_AXIS, -0.9 * supportSmooth));
        }

        // Head: look down at phone screen
        if (headBone && headBone !== modelRoot) {
          headBone.rotation.x += 0.35 * armProg;  // more pronounced look-down
          headBone.rotation.y += Math.sin(t * 0.9) * 0.05 * holdPhase; // reading scan
        }

        // Body: phone posture lean
        modelRoot.rotation.x = 0.08 * armProg;
      }
      // Final safety: action overlays ke baad bhi sir limit me rahe
      if (headBone && headBone !== modelRoot) {
        headBone.rotation.x = THREE.MathUtils.clamp(headBone.rotation.x, -0.4, 0.4);
        headBone.rotation.y = THREE.MathUtils.clamp(headBone.rotation.y, -0.5, 0.5);
        headBone.rotation.z = THREE.MathUtils.clamp(headBone.rotation.z, -0.32, 0.32);
      }

      // ── Zinda raho: saans + aankhein + nazar (labarish look khatm!) ──
      const breath = Math.sin(t * 1.6);
      if (spine) {
        const s = 1 + breath * 0.012;
        spine.scale.set(s, s, s);
      }
      // Aankhein idhar-udhar dart (saccade) — hamesha, action ke beech bhi
      sacT -= dt;
      if (sacT <= 0) {
        sacT = 1.8 + Math.random() * 2.5;
        sacTX = (Math.random() - 0.5) * 0.24;
        sacTY = (Math.random() - 0.5) * 0.14;
      }
      sacX = lerp(sacX, sacTX, 1 - Math.pow(0.0001, dt));
      sacY = lerp(sacY, sacTY, 1 - Math.pow(0.0001, dt));
      if (eyeL) { eyeL.rotation.y = sacX; eyeL.rotation.x = sacY; }
      if (eyeR) { eyeR.rotation.y = sacX; eyeR.rotation.x = sacY; }
      if (!act) {
        // Saans ke saath kandhe halke hilo
        if (upL && baseQ.has(upL)) upL.quaternion.copy(baseQ.get(upL)!).multiply(tmpQ.setFromAxisAngle(X_AXIS, breath * 0.035));
        if (upR && baseQ.has(upR)) upR.quaternion.copy(baseQ.get(upR)!).multiply(tmpQ.setFromAxisAngle(X_AXIS, -breath * 0.035));
        // Wazan ek pair se doosre par — zinda khada!
        modelRoot.rotation.z = Math.sin(t * 0.33) * 0.022;
        modelRoot.position.x = Math.sin(t * 0.23) * 0.02 + LOCKED_POS.x;
        // Kabhi-kabhi khud gardan ghuma kar dekho (mouse ke alava)
        glanceT -= dt;
        if (glanceT <= 0) {
          glanceT = 4 + Math.random() * 4;
          glanceTX = (Math.random() - 0.5) * 0.5;
          glanceTY = (Math.random() - 0.5) * 0.2;
          setTimeout(() => { glanceTX = 0; glanceTY = 0; }, 1400);
        }
        glanceX = lerp(glanceX, glanceTX, 1 - Math.pow(0.001, dt));
        glanceY = lerp(glanceY, glanceTY, 1 - Math.pow(0.001, dt));
        if (headBone && headBone !== modelRoot) {
          headBone.rotation.y = THREE.MathUtils.clamp(headBone.rotation.y + glanceX, -0.5, 0.5);
          headBone.rotation.x = THREE.MathUtils.clamp(headBone.rotation.x + glanceY, -0.4, 0.4);
        }
      }

      // ── Co-speech gestures: baat + haath/sir/body ek saath ──
      const energyTarget = speaking ? THREE.MathUtils.clamp(volume * 3, 0.18, 1) : 0;
      speakEnergy = lerp(speakEnergy, energyTarget, 1 - Math.pow(0.01, dt));
      if (speaking && !wasSpeaking) { phraseT = 99; } // bolna shuru = turant naya gesture
      const justStopped = wasSpeaking && !speaking;
      wasSpeaking = speaking;
      if (speaking) {
        phraseT += dt;
        if (phraseT >= phraseDur) {
          // Naya phrase: pichla wala repeat nahi, haath base par wapas
          let next = speakPhrase;
          while (next === speakPhrase) next = PHRASES[Math.floor(Math.random() * PHRASES.length)];
          speakPhrase = next;
          phraseT = 0;
          phraseDur = 1.6 + Math.random() * 1.4;
          if (!act) baseQ.forEach((q, b) => { if (b === upL || b === upR || b === foreL || b === foreR) b.quaternion.copy(q); });
        }
        const p = Math.min(phraseT / phraseDur, 1);
        const env = Math.sin(p * Math.PI); // smooth in-out
        const beat = Math.abs(Math.sin(t * 9)) * 0.6 + Math.abs(Math.sin(t * 5.3)) * 0.4;
        const amp = env * speakEnergy;
        // Sir: baat ke saath nod + halka storytelling sway (hamesha, action me bhi thoda)
        if (headBone && headBone !== modelRoot) {
          const nodAmp = (speakPhrase === 'nod' ? 0.10 : 0.045) + volume * 0.22;
          headBone.rotation.x += Math.sin(t * 6.5) * nodAmp * Math.max(env, 0.35) * speakEnergy;
          headBone.rotation.y += Math.sin(t * 0.8) * 0.05 * speakEnergy;
          if (speakPhrase === 'tilt') headBone.rotation.z += 0.07 * amp;
        }
        // Haath: sirf jab koi action pose na chal raha ho (world-space, hamesha saamne)
        if (!act && baseHandsSaved) {
          const liftHand = (up: THREE.Object3D | null, fore: THREE.Object3D | null, hand: THREE.Object3D | null, base: THREE.Vector3, lift: number) => {
            if (!up || !fore || !hand || lift <= 0.01) return;
            const target = modelRoot.localToWorld(base.clone().add(new THREE.Vector3(0, lift * 0.35, lift * 0.45)));
            const sP = up.getWorldPosition(new THREE.Vector3());
            const eP = fore.getWorldPosition(new THREE.Vector3());
            const toElbow = eP.clone().sub(sP);
            if (toElbow.length() < 1e-4) return;
            // Kohni thodi bahar, haath target ki taraf
            const eDir = target.clone().sub(sP).normalize();
            eDir.x += (sP.x >= 0 ? 0.25 : -0.25);
            aimBone(up, toElbow.normalize(), eDir.normalize());
            fore.updateMatrixWorld(true);
            const eP2 = fore.getWorldPosition(new THREE.Vector3());
            const hP = hand.getWorldPosition(new THREE.Vector3());
            const fDir = hP.sub(eP2);
            if (fDir.length() > 1e-4) aimBone(fore, fDir.normalize(), target.sub(eP2).normalize());
          };
          const e = amp * (0.35 + beat * 0.65);
          if (speakPhrase === 'handR') liftHand(upR, foreR, handR, baseHandR, e * 0.55);
          else if (speakPhrase === 'handL') liftHand(upL, foreL, handL, baseHandL, e * 0.55);
          else if (speakPhrase === 'both') {
            liftHand(upR, foreR, handR, baseHandR, e * 0.4);
            liftHand(upL, foreL, handL, baseHandL, e * 0.4);
          } else {
            // nod/tilt/lean me haath halke saath me (beat par)
            liftHand(upR, foreR, handR, baseHandR, e * 0.12);
          }
        }
        // Body lean-in on emphasis (bow action me nahi)
        if (act !== 'bow') modelRoot.rotation.x = (speakPhrase === 'lean' ? amp * 0.07 : amp * 0.02);
      } else if (!act && justStopped) {
        // Bolna band hua ABHI = haath wapas + seedha khada (ek baar, taaki saans wala sway chalta rahe)
        baseQ.forEach((q, b) => {
          if (b === upL || b === upR || b === foreL || b === foreR) b.quaternion.copy(q);
        });
        modelRoot.rotation.x = 0;
      }
      // Gesture ke baad bhi sir limit me
      if (headBone && headBone !== modelRoot) {
        headBone.rotation.x = THREE.MathUtils.clamp(headBone.rotation.x, -0.42, 0.42);
        headBone.rotation.y = THREE.MathUtils.clamp(headBone.rotation.y, -0.5, 0.5);
      }
      } catch (e) {
        // Ek action fail = poora avatar freeze NAHO — bas base pose par wapas
        if (!actionWarned) { actionWarned = true; console.warn('[FridayModel3D] action overlay failed, holding base pose', e); }
        baseQ.forEach((q, b) => { try { b.quaternion.copy(q); } catch { /* noop */ } });
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
      if (clearTimer) clearTimeout(clearTimer);
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
    return <FridayAvatar status={status} volume={volume} reaction={reaction} height={height} onTap={onTap} />;
  }

  return (
    <div
      className={`relative flex flex-col items-center ${fluid ? 'w-full h-full' : ''}`}
      style={{ perspective: 900 }}
      onDoubleClick={onTap}
    >
      <div
        ref={mountRef}
        style={fluid
          ? { width: '100%', height: '100%' }
          : { width: Math.round(height * 0.75), height }}
      />
      {isSpeaking && (
        <div className={`absolute flex items-end gap-1 pointer-events-none ${fluid ? 'bottom-28' : '-bottom-1'}`}>
          {[0.5, 0.9, 0.65, 1, 0.75, 0.55, 0.85].map((b, i) => (
            <motion.span
              key={i}
              style={{ width: 4, borderRadius: 3, background: '#38bdf8', boxShadow: '0 0 8px #38bdf8' }}
              animate={{ height: [4, 5 + Math.min(volume * 70, 22) * b, 4] }}
              transition={{ duration: 0.3 + i * 0.03, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default FridayModel3D;
