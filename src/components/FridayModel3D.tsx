import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { motion } from 'motion/react';
import FridayAvatar from './FridayAvatar';
import type { AgentFaceReaction } from './AgentFace';

interface FridayModel3DProps {
  status: string;
  volume: number;
  reaction?: AgentFaceReaction;
  height?: number;
  onTap?: () => void;
}

// Tumhara real 3D model: public/friday.glb (best) ya public/friday.fbx — pehle .glb, phir .fbx try hoga.
// Koi file na mile to photo wala avatar fallback rahega.
const MODEL_URLS = ['/friday.glb', '/friday.fbx'];

const FridayModel3D: React.FC<FridayModel3DProps> = ({ status, volume, reaction, height = 340, onTap }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ status, volume, reaction });
  stateRef.current = { status, volume, reaction };
  const mouseRef = useRef({ x: 0, y: 0 });
  const [modelMissing, setModelMissing] = useState(false);

  const isSpeaking = status === 'Speaking...';

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let raf = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let jawBone: THREE.Object3D | null = null;
    let headBone: THREE.Object3D | null = null;
    let mouthMorph: { mesh: THREE.Mesh; index: number } | null = null;
    let blinkMorphs: { mesh: THREE.Mesh; index: number }[] = [];

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

    // Soft floor glow disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 48),
      new THREE.MeshBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.35 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.01;
    scene.add(disc);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);

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
    const relaxArms = (model: THREE.Object3D) => {
      model.updateMatrixWorld(true);
      const bones: THREE.Bone[] = [];
      model.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
      if (!bones.length) return false;
      const uppers = bones.filter((b) => /upperarm|upper_arm|uparm|shoulder/i.test(b.name));
      const fores = bones.filter((b) => /forearm|fore_arm|lowerarm|lower_arm|elbow/i.test(b.name));
      if (!uppers.length) return false;
      let fixed = 0;
      uppers.forEach((up) => {
        // Elbow reference: forearm bone (same side) ya upper ka pehla bone-child
        const sideHint = /left|_l\b|\.l\b|l_/i.test(up.name) ? 1 : /right|_r\b|\.r\b|r_/i.test(up.name) ? -1 : 0;
        const fore = fores.find((f) => {
          const a = up.getWorldPosition(new THREE.Vector3());
          const b = f.getWorldPosition(new THREE.Vector3());
          return a.distanceTo(b) < 1.5;
        }) ?? up.children.find((c) => (c as THREE.Bone).isBone) as THREE.Object3D | undefined;
        if (!fore) return;
        up.updateMatrixWorld(true);
        const shoulderP = up.getWorldPosition(new THREE.Vector3());
        const elbowP = fore.getWorldPosition(new THREE.Vector3());
        const curDir = elbowP.sub(shoulderP);
        if (curDir.length() < 1e-4) return;
        curDir.normalize();
        // Sirf tab fix karo jab haath waqai faila ho (sideways), nahi to chhedo mat
        if (Math.abs(curDir.y) > 0.55) return;
        // Bahar ki taraf = haath abhi jis side faila hai usi ka sign (left/right naam par bharosa nahi)
        const out = Math.sign(curDir.x) || (sideHint !== 0 ? sideHint : 1);
        aimBone(up, curDir, new THREE.Vector3(out * 0.14, -1, 0.04));
        // Kohni me halka mod (natural look)
        const wristObj = (fore as THREE.Object3D).children.find((c) => (c as THREE.Bone).isBone);
        if (wristObj) {
          fore.updateMatrixWorld(true);
          const eP = fore.getWorldPosition(new THREE.Vector3());
          const wP = wristObj.getWorldPosition(new THREE.Vector3());
          const fDir = wP.sub(eP);
          if (fDir.length() > 1e-4) {
            fDir.normalize();
            aimBone(fore, fDir, new THREE.Vector3(out * 0.1, -1, 0.14));
          }
        }
        fixed++;
      });
      console.log(`[FridayModel3D] arms relaxed: ${fixed}`);
      return fixed > 0;
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

        // Portrait framing: sir se kamar tak closeup — chehra bada dikhe, faile haath frame se bahar
        modelRoot.updateMatrixWorld(true);
        const frame = new THREE.Box3().setFromObject(modelRoot);
        const fullH = Math.max(frame.max.y - frame.min.y, 0.001);
        const top = frame.max.y;
        const waistY = frame.min.y + fullH * 0.45; // neeche kamar tak
        const centerY = (top + waistY) / 2;
        const visH = top - waistY;
        const visW = Math.min(frame.max.x - frame.min.x, 1.2); // chaude T-pose haath ignore
        const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        const fitH = (visH / 2) / Math.tan(halfFov);
        const fitW = (visW / 2) / (Math.tan(halfFov) * Math.max(camera.aspect, 0.3));
        const fitDist = Math.max(fitH, fitW) * 1.18;
        camera.position.set(0, centerY + 0.05, fitDist);
        camera.lookAt(0, centerY, 0);

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
            });
          }
        });

        // Kuch na mile to poore model ko head mano (procedural motion ke liye)
        if (!headBone) headBone = model;
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
      const r = mount.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      mouseRef.current.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
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
      const happy = reaction === 'happy' || reaction === 'success' || reaction === 'photo' || reaction === 'winking';

      mixer?.update(dt);

      // ── Lip-sync: jaw bone ya mouth morph, nahi to head bob ──
      const openTarget = speaking
        ? 0.25 + Math.min(volume * 2.2, 0.75) + Math.abs(Math.sin(t * 15)) * 0.2 * Math.min(1, volume * 4 + 0.25)
        : happy ? 0.3 : 0.04;
      jawOpen = lerp(jawOpen, openTarget, 1 - Math.pow(0.0005, dt));
      if (jawBone && jawBone !== modelRoot) jawBone.rotation.x = jawOpen * 0.7;
      if (mouthMorph && mouthMorph.mesh.morphTargetInfluences) {
        mouthMorph.mesh.morphTargetInfluences[mouthMorph.index] = Math.min(jawOpen, 1);
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
      modelRoot.position.y = happy
        ? Math.abs(Math.sin(t * 2.6)) * 0.04
        : Math.sin(t * 1.5) * 0.015;
      if (headBone && headBone !== modelRoot.children[0]) {
        headBone.rotation.y = lerp(headBone.rotation.y, m.x * 0.35 + (thinking ? Math.sin(t * 1.6) * 0.2 : 0), 0.08);
        headBone.rotation.x = lerp(headBone.rotation.x, m.y * 0.18 + (listening ? -0.1 : 0) + (speaking ? Math.sin(t * 13) * 0.03 * Math.min(1, volume * 4) : 0), 0.08);
        headBone.rotation.z = lerp(headBone.rotation.z, thinking ? 0.12 : 0, 0.06);
      } else {
        // Bones na mile to poore model par subtle motion
        modelRoot.rotation.x = m.y * 0.06;
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
    return <FridayAvatar status={status} volume={volume} reaction={reaction} height={height} onTap={onTap} />;
  }

  return (
    <div className="relative flex flex-col items-center" style={{ perspective: 900 }} onClick={onTap}>
      <div
        ref={mountRef}
        style={{ width: Math.round(height * 0.75), height, cursor: onTap ? 'pointer' : 'default' }}
      />
      {isSpeaking && (
        <div className="absolute -bottom-1 flex items-end gap-1 pointer-events-none">
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
