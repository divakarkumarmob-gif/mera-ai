import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { motion } from 'motion/react';

export type AgentFaceReaction = 'success' | 'photo' | 'happy' | 'winking' | null;

interface AgentFaceProps {
  status: string;
  volume: number;
  size?: number;
  colorIndex: number;
  reaction?: AgentFaceReaction;
  onDoubleClick?: () => void;
}

const AgentFace: React.FC<AgentFaceProps> = ({ status, volume, size = 120, colorIndex, reaction, onDoubleClick }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ status, volume, reaction });
  stateRef.current = { status, volume, reaction };
  const mouseRef = useRef({ x: 0, y: 0 });
  const lastTapRef = useRef<number>(0);

  const colors = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#d946ef", "#14b8a6", "#e11d48"];
  const baseColor = colors[colorIndex % colors.length];
  const glowColor = reaction === 'success' ? '#10b981' : reaction === 'photo' ? '#c084fc' : baseColor;

  const handleTouchEnd = (e: React.TouchEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      e.preventDefault();
      onDoubleClick?.();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = mount.clientWidth || size;
    const H = mount.clientHeight || size;

    // ── Renderer / Scene / Camera ──
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 50);
    camera.position.set(0, 0.05, 4.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // ── Lights (studio portrait look) ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xfff2e0, 1.6);
    key.position.set(2, 3, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.55);
    fill.position.set(-3, 0.5, 3);
    scene.add(fill);
    const rim = new THREE.PointLight(new THREE.Color(glowColor), 12, 20);
    rim.position.set(0, 1.5, -2.5);
    scene.add(rim);
    const under = new THREE.PointLight(0xffffff, 2, 10);
    under.position.set(0, -2, 2.5);
    scene.add(under);

    // ── Materials ──
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe9b48c, roughness: 0.55, metalness: 0.04 });
    const skinDarkMat = new THREE.MeshStandardMaterial({ color: 0xc98a63, roughness: 0.7 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.85 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
    const irisMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(glowColor), roughness: 0.3,
      emissive: new THREE.Color(glowColor), emissiveIntensity: 0.35,
    });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 });
    const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const innerMouthMat = new THREE.MeshStandardMaterial({ color: 0x5b1f1f, roughness: 0.9 });
    const teethMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const browMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.8 });

    const head = new THREE.Group();
    scene.add(head);

    // ── Head ──
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), skinMat);
    headMesh.scale.set(0.92, 1.12, 0.94);
    head.add(headMesh);

    // Jaw taper illusion: slightly darker lower sphere
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.72, 32, 32), skinMat);
    jaw.position.set(0, -0.52, 0.12);
    jaw.scale.set(0.95, 0.8, 0.85);
    head.add(jaw);

    // ── Hair cap (top-back) ──
    const hair = new THREE.Mesh(new THREE.SphereGeometry(1.02, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.52), hairMat);
    hair.position.set(0, 0.12, -0.08);
    hair.rotation.x = -0.25;
    hair.scale.set(0.95, 1.05, 0.97);
    head.add(hair);
    // side hair
    const hairL = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 24), hairMat);
    hairL.position.set(-0.88, -0.15, -0.05);
    hairL.scale.set(0.7, 1.6, 0.9);
    head.add(hairL);
    const hairR = hairL.clone();
    hairR.position.x = 0.88;
    head.add(hairR);

    // ── Ears ──
    const earGeo = new THREE.SphereGeometry(0.16, 24, 24);
    const earL = new THREE.Mesh(earGeo, skinMat);
    earL.position.set(-0.92, -0.1, 0);
    earL.scale.set(0.5, 1, 0.7);
    head.add(earL);
    const earR = earL.clone();
    earR.position.x = 0.92;
    head.add(earR);

    // ── Eyes ──
    const makeEye = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.14, 0.78);
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.175, 32, 32), whiteMat);
      white.scale.set(1, 1.15, 0.55);
      g.add(white);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 24), irisMat);
      iris.position.set(0, 0, 0.1);
      iris.scale.set(1, 1, 0.4);
      g.add(iris);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 16), pupilMat);
      pupil.position.set(0, 0, 0.15);
      pupil.scale.set(1, 1, 0.4);
      g.add(pupil);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 12), shineMat);
      shine.position.set(0.025, 0.03, 0.17);
      g.add(shine);
      // upper eyelid (skin) for natural blink
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.185, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), skinMat);
      lid.position.set(0, 0.02, 0.02);
      lid.rotation.x = Math.PI;
      lid.scale.set(1, 1, 0.8);
      lid.visible = false;
      g.add(lid);
      head.add(g);
      return { g, iris, pupil, lid };
    };
    const eyeL = makeEye(-0.33);
    const eyeR = makeEye(0.33);

    // ── Eyebrows ──
    const browGeo = new THREE.BoxGeometry(0.34, 0.055, 0.07);
    const browL = new THREE.Mesh(browGeo, browMat);
    browL.position.set(-0.33, 0.46, 0.82);
    browL.rotation.z = 0.08;
    head.add(browL);
    const browR = new THREE.Mesh(browGeo, browMat);
    browR.position.set(0.33, 0.46, 0.82);
    browR.rotation.z = -0.08;
    head.add(browR);

    // ── Nose ──
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 24), skinDarkMat);
    nose.position.set(0, -0.12, 0.92);
    nose.rotation.x = Math.PI / 2.15;
    head.add(nose);
    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 16), skinMat);
    noseTip.position.set(0, -0.2, 1.0);
    head.add(noseTip);

    // ── Cheek blush ──
    const blushMat = new THREE.MeshBasicMaterial({ color: 0xf08a80, transparent: true, opacity: 0.28 });
    const blushGeo = new THREE.CircleGeometry(0.11, 24);
    const blushL = new THREE.Mesh(blushGeo, blushMat);
    blushL.position.set(-0.52, -0.28, 0.72);
    blushL.rotation.y = -0.5;
    head.add(blushL);
    const blushR = blushL.clone();
    blushR.position.x = 0.52;
    blushR.rotation.y = 0.5;
    head.add(blushR);

    // ── Mouth ──
    const mouth = new THREE.Group();
    mouth.position.set(0, -0.52, 0.78);
    head.add(mouth);
    const mouthInner = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), innerMouthMat);
    mouthInner.scale.set(1.35, 0.25, 0.4);
    mouth.add(mouthInner);
    const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.05), teethMat);
    teeth.position.set(0, 0.045, 0.05);
    mouth.add(teeth);
    const lipUpper = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 12, 32, Math.PI), skinDarkMat);
    lipUpper.position.set(0, 0.02, 0.04);
    lipUpper.rotation.z = 0;
    mouth.add(lipUpper);
    const lipLower = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.032, 12, 32, Math.PI), skinDarkMat);
    lipLower.position.set(0, -0.02, 0.04);
    lipLower.rotation.z = Math.PI;
    mouth.add(lipLower);

    // ── Neck hint ──
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.5, 24), skinDarkMat);
    neck.position.set(0, -1.25, -0.05);
    head.add(neck);

    // ── Animation state ──
    let raf = 0;
    const clock = new THREE.Clock();
    let blinkTimer = 1.5;
    let blinkT = -1;
    let smile = 0, mouthOpen = 0.12, lookX = 0, lookY = 0;
    let disposed = false;

    const onMouse = (e: MouseEvent) => {
      const r = mount.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      mouseRef.current.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    window.addEventListener('mousemove', onMouse);

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const { status, volume, reaction } = stateRef.current;

      const isSpeaking = status === 'Speaking...';
      const isListening = status === 'Listening...';
      const isThinking = status === 'Thinking...';
      const isHappy = reaction === 'happy' || reaction === 'success' || reaction === 'photo' || reaction === 'winking';
      const isWinking = reaction === 'winking' || reaction === 'photo';

      // ── Blink logic ──
      blinkTimer -= dt;
      if (blinkTimer <= 0 && blinkT < 0) { blinkT = 0; }
      if (blinkT >= 0) {
        blinkT += dt / 0.16;
        if (blinkT >= 1) { blinkT = -1; blinkTimer = 1.6 + Math.random() * 2.8; }
      }
      const blinkClose = blinkT >= 0 ? Math.sin(Math.min(blinkT, 1) * Math.PI) : 0;

      // ── Targets ──
      const smileTarget = isHappy ? 1 : isSpeaking ? 0.35 : isListening ? 0.25 : 0.12;
      smile = lerp(smile, smileTarget, 1 - Math.pow(0.001, dt));

      let openTarget = 0.12;
      if (isSpeaking) openTarget = 0.3 + Math.min(volume * 2.4, 0.9) + Math.abs(Math.sin(t * 16)) * 0.22 * Math.min(1, volume * 4 + 0.3);
      else if (isHappy) openTarget = 0.42;
      else if (isListening) openTarget = 0.08;
      else if (isThinking) openTarget = 0.1;
      else openTarget = 0.12 + Math.sin(t * 1.4) * 0.02;
      mouthOpen = lerp(mouthOpen, openTarget, 1 - Math.pow(0.0005, dt));

      // Eye look targets
      let tx = mouseRef.current.x * 0.06;
      let ty = -mouseRef.current.y * 0.04;
      if (isThinking) { tx = Math.sin(t * 1.8) * 0.07; ty = 0.04 + Math.cos(t * 1.3) * 0.02; }
      if (isListening) { tx *= 1.4; ty -= 0.01; }
      lookX = lerp(lookX, tx, 1 - Math.pow(0.01, dt));
      lookY = lerp(lookY, ty, 1 - Math.pow(0.01, dt));

      // ── Apply to eyes ──
      const eyeWide = isListening ? 1.18 : isThinking ? 0.9 : 1;
      const happySquint = smile * 0.22;
      const leftClose = Math.max(blinkClose, isWinking ? 0 : 0);
      const rightClose = Math.max(blinkClose, isWinking ? 1 : 0);
      eyeL.g.position.x = -0.33 + lookX;
      eyeR.g.position.x = 0.33 + lookX;
      eyeL.g.position.y = 0.14 + lookY;
      eyeR.g.position.y = 0.14 + lookY;
      eyeL.g.scale.y = Math.max(0.08, eyeWide - happySquint - leftClose * 0.95);
      eyeR.g.scale.y = Math.max(0.08, eyeWide - happySquint - rightClose * 0.95);
      eyeL.lid.visible = leftClose > 0.5;
      eyeR.lid.visible = rightClose > 0.5;

      // ── Brows ──
      const browUp = isHappy ? 0.07 : isListening ? 0.06 : isThinking ? -0.04 : Math.sin(t * 1.4) * 0.01;
      browL.position.y = lerp(browL.position.y, 0.46 + browUp, 0.15);
      browR.position.y = lerp(browR.position.y, 0.46 + browUp, 0.15);
      const furrow = isThinking ? 0.28 : isSpeaking ? 0.05 : 0;
      browL.rotation.z = lerp(browL.rotation.z, 0.08 - furrow * 0.5 + smile * 0.12, 0.12);
      browR.rotation.z = lerp(browR.rotation.z, -0.08 + furrow * 0.5 - smile * 0.12, 0.12);

      // ── Mouth ──
      mouthInner.scale.set(1.1 + smile * 0.7, Math.max(0.08, mouthOpen), 0.4);
      mouth.scale.x = 1 + smile * 0.18;
      teeth.visible = mouthOpen > 0.18;
      teeth.scale.y = Math.max(0.3, Math.min(1, (1 - mouthOpen) * 1.2));
      lipUpper.scale.set(1 + smile * 0.25, 1, 1);
      lipLower.scale.set(1 + smile * 0.2, 0.7 + mouthOpen * 1.1, 1);
      mouth.position.y = -0.52 + smile * 0.03;
      mouth.rotation.z = isThinking ? Math.sin(t * 2) * 0.06 : 0;
      blushMat.opacity = 0.2 + smile * 0.25;

      // ── Head motion ──
      const pulse = 1 + Math.min(volume * 0.25, 0.08) + (isSpeaking ? Math.sin(t * 14) * 0.006 * Math.min(1, volume * 5 + 0.2) : 0);
      head.scale.set(pulse, pulse, pulse);
      head.rotation.y = Math.sin(t * 0.5) * 0.1 + mouseRef.current.x * 0.28 + (isThinking ? Math.sin(t * 1.8) * 0.1 : 0);
      head.rotation.x = Math.sin(t * 0.7) * 0.05 + mouseRef.current.y * 0.16 + (isListening ? -0.06 : 0) + (isHappy ? Math.sin(t * 3) * 0.03 : 0);
      head.rotation.z = isThinking ? 0.1 + Math.sin(t * 0.9) * 0.03 : Math.sin(t * 0.4) * 0.02;
      head.position.y = isHappy ? Math.abs(Math.sin(t * 3)) * 0.05 : Math.sin(t * 1.2) * 0.02;
      if (isSpeaking) head.position.z = Math.sin(t * 14) * 0.02 * Math.min(1, volume * 4);

      // rim glow follows theme
      (rim.color as THREE.Color).set(glowColor);

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth || size;
      const h = mount.clientHeight || size;
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
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return (
    <motion.div className="relative flex items-center justify-center agent-face" style={{ width: size, height: size, perspective: 1000 }}>
      {reaction && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: [1, 1.5, 1.2], opacity: [0.9, 0.4, 0] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          className="absolute rounded-full pointer-events-none z-0"
          style={{
            width: size * 1.6,
            height: size * 1.6,
            background: reaction === 'success'
              ? 'radial-gradient(circle, rgba(16,185,129,0.5) 0%, rgba(16,185,129,0.15) 50%, transparent 75%)'
              : 'radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(168,85,247,0.15) 50%, transparent 75%)',
          }}
        />
      )}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: size * 1.3,
          height: size * 1.3,
          background: `radial-gradient(circle, ${glowColor}33 0%, rgba(139,92,246,0.15) 50%, transparent 70%)`,
          boxShadow: `0 0 40px ${glowColor}66, inset 0 0 20px ${glowColor}33`
        }}
        animate={{ scale: [1, 1 + Math.min(volume / 40, 0.25), 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 0.3, repeat: Infinity }}
      />
      <motion.div
        className="absolute rounded-full border border-purple-400/30 pointer-events-none"
        style={{ width: size * 1.1, height: size * 1.1 }}
        animate={{ scale: [0.95, 1.05, 0.95], opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        ref={mountRef}
        onDoubleClick={onDoubleClick}
        onTouchEnd={handleTouchEnd}
        title="Continuous double-click / double-tap to interrupt and start listening immediately!"
        className="rounded-full bg-slate-950/80 backdrop-blur-xl border-2 flex items-center justify-center agent-face-circle relative z-10 cursor-pointer select-none overflow-hidden"
        style={{
          width: size * 0.92,
          height: size * 0.92,
          borderColor: `${glowColor}`,
          boxShadow: `0 0 30px ${glowColor}80, inset 0 0 15px ${glowColor}4d`
        }}
      />
    </motion.div>
  );
};

export default AgentFace;
