import React, { useEffect, useRef } from 'react';

// Web Audio API Firecracker Sound Synthesizer
let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioCtx && typeof window !== 'undefined') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        sharedAudioCtx = new AudioCtxClass();
      }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Realistic Firecracker / Diwali Patakha Sound Generator
 * Generates: Initial Sharp Pop + Deep Sub Bass Boom + Sizzling Multi-Spark Crackles
 */
function playFirecrackerSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Sharp Explosive Noise Crack (Main Boom)
    const bufferSize = Math.floor(ctx.sampleRate * 0.22);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.04));
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1400, now);
    noiseFilter.Q.setValueAtTime(1.2, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSource.start(now);

    // 2. Sub-bass kinetic thump (Punchy explosion feel)
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(160, now);
    subOsc.frequency.exponentialRampToValueAtTime(32, now + 0.16);

    subGain.gain.setValueAtTime(0.4, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.18);

    // 3. Trailing Sizzle & Micro Spark Crackles (Like sparkling firecracker burst)
    const sparkCount = Math.floor(Math.random() * 5) + 4;
    for (let s = 0; s < sparkCount; s++) {
      const delay = Math.random() * 0.25 + 0.04;
      const sparkTime = now + delay;

      const sparkOsc = ctx.createOscillator();
      const sparkGain = ctx.createGain();
      sparkOsc.type = 'triangle';
      sparkOsc.frequency.setValueAtTime(Math.random() * 800 + 1200, sparkTime);
      sparkOsc.frequency.exponentialRampToValueAtTime(300, sparkTime + 0.03);

      sparkGain.gain.setValueAtTime(0.08, sparkTime);
      sparkGain.gain.exponentialRampToValueAtTime(0.001, sparkTime + 0.03);

      sparkOsc.connect(sparkGain);
      sparkGain.connect(ctx.destination);
      sparkOsc.start(sparkTime);
      sparkOsc.stop(sparkTime + 0.035);
    }
  } catch (err) {
    console.warn('[StarryBackground] Sound synthesis notice:', err);
  }
}

interface Star {
  x: number;
  y: number;
  radius: number;
  baseAlpha: number;
  alpha: number;
  twinkleSpeed: number;
  color: string;
  vx: number;
  vy: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  color: string;
}

interface FireworkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
  twinkleRate: number;
  trail: { x: number; y: number }[];
}

interface ExplosionBurst {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
}

interface MeteorTheme {
  name: string;
  flameCore: string;
  flameMid: string;
  flameOuter: string;
  tailGrad: [string, string, string];
  sparkColor: string;
  fireworkColors: string[];
}

const METEOR_THEMES: MeteorTheme[] = [
  // 1. 🔥 Solar Magma Inferno
  {
    name: 'Solar Magma',
    flameCore: '#ffffff',
    flameMid: '#ff7700',
    flameOuter: '#ff2200',
    tailGrad: ['rgba(255, 119, 0, ', 'rgba(255, 34, 0, ', 'rgba(255, 200, 0, '],
    sparkColor: '#ffaa00',
    fireworkColors: ['#ff3b00', '#ff9100', '#ffd700', '#ffffff', '#ff4500'],
  },
  // 2. ⚡ Hyper Cyber Cyan
  {
    name: 'Cyber Cyan',
    flameCore: '#ffffff',
    flameMid: '#00f0ff',
    flameOuter: '#0077ff',
    tailGrad: ['rgba(0, 240, 255, ', 'rgba(0, 119, 255, ', 'rgba(200, 250, 255, '],
    sparkColor: '#00f0ff',
    fireworkColors: ['#00f0ff', '#38bdf8', '#7dd3fc', '#ffffff', '#0284c7'],
  },
  // 3. 💜 Deep Plasma Violet
  {
    name: 'Plasma Violet',
    flameCore: '#ffffff',
    flameMid: '#c084fc',
    flameOuter: '#9333ea',
    tailGrad: ['rgba(192, 132, 252, ', 'rgba(147, 51, 234, ', 'rgba(243, 232, 255, '],
    sparkColor: '#d8b4fe',
    fireworkColors: ['#c084fc', '#a855f7', '#e879f9', '#ffffff', '#7e22ce'],
  },
  // 4. 🟢 Radioactive Neon Emerald
  {
    name: 'Neon Emerald',
    flameCore: '#ffffff',
    flameMid: '#34d399',
    flameOuter: '#059669',
    tailGrad: ['rgba(52, 211, 153, ', 'rgba(5, 150, 105, ', 'rgba(209, 250, 229, '],
    sparkColor: '#6ee7b7',
    fireworkColors: ['#34d399', '#10b981', '#a7f3d0', '#ffffff', '#047857'],
  },
  // 5. 🔴 Ruby Blood Laser
  {
    name: 'Ruby Crimson',
    flameCore: '#ffffff',
    flameMid: '#fb7185',
    flameOuter: '#e11d48',
    tailGrad: ['rgba(251, 113, 133, ', 'rgba(225, 29, 72, ', 'rgba(255, 228, 230, '],
    sparkColor: '#f43f5e',
    fireworkColors: ['#f43f5e', '#fb7185', '#fda4af', '#ffffff', '#be123c'],
  },
  // 6. 🟡 Supernova Sunfire
  {
    name: 'Supernova Gold',
    flameCore: '#ffffff',
    flameMid: '#fde047',
    flameOuter: '#d97706',
    tailGrad: ['rgba(253, 224, 71, ', 'rgba(217, 119, 6, ', 'rgba(254, 249, 195, '],
    sparkColor: '#fbbf24',
    fireworkColors: ['#fde047', '#facc15', '#fef08a', '#ffffff', '#ca8a04'],
  },
  // 7. 🌌 Electric Cosmic Indigo
  {
    name: 'Cosmic Indigo',
    flameCore: '#ffffff',
    flameMid: '#818cf8',
    flameOuter: '#4338ca',
    tailGrad: ['rgba(129, 140, 248, ', 'rgba(67, 56, 202, ', 'rgba(224, 231, 255, '],
    sparkColor: '#a5b4fc',
    fireworkColors: ['#818cf8', '#6366f1', '#c7d2fe', '#ffffff', '#4338ca'],
  },
  // 8. 🌸 Cyberpunk Hot Magenta
  {
    name: 'Hot Magenta',
    flameCore: '#ffffff',
    flameMid: '#f472b6',
    flameOuter: '#db2777',
    tailGrad: ['rgba(244, 114, 182, ', 'rgba(219, 39, 119, ', 'rgba(253, 242, 248, '],
    sparkColor: '#f472b6',
    fireworkColors: ['#f472b6', '#ec4899', '#fbcfe8', '#ffffff', '#be185d'],
  },
  // 9. 🧪 Toxic Acid Lime
  {
    name: 'Acid Lime',
    flameCore: '#ffffff',
    flameMid: '#a3e635',
    flameOuter: '#65a30d',
    tailGrad: ['rgba(163, 230, 53, ', 'rgba(101, 163, 13, ', 'rgba(247, 254, 231, '],
    sparkColor: '#bef264',
    fireworkColors: ['#a3e635', '#84cc16', '#d9f99d', '#ffffff', '#4d7c0f'],
  },
  // 10. 🌊 Deep Sea Aquamarine
  {
    name: 'Aquamarine',
    flameCore: '#ffffff',
    flameMid: '#22d3ee',
    flameOuter: '#0891b2',
    tailGrad: ['rgba(34, 211, 238, ', 'rgba(8, 145, 178, ', 'rgba(207, 250, 254, '],
    sparkColor: '#67e8f9',
    fireworkColors: ['#22d3ee', '#06b6d4', '#a5f3fc', '#ffffff', '#0e7490'],
  },
  // 11. ❄️ Arctic Sapphire Blaze
  {
    name: 'Arctic Sapphire',
    flameCore: '#ffffff',
    flameMid: '#60a5fa',
    flameOuter: '#1d4ed8',
    tailGrad: ['rgba(96, 165, 250, ', 'rgba(29, 78, 216, ', 'rgba(239, 246, 255, '],
    sparkColor: '#93c5fd',
    fireworkColors: ['#60a5fa', '#3b82f6', '#bfdbfe', '#ffffff', '#1e40af'],
  },
  // 12. 🌋 Volcanic Molten Ember
  {
    name: 'Volcanic Lava',
    flameCore: '#ffffff',
    flameMid: '#fb923c',
    flameOuter: '#c2410c',
    tailGrad: ['rgba(251, 146, 60, ', 'rgba(194, 65, 12, ', 'rgba(255, 237, 213, '],
    sparkColor: '#f97316',
    fireworkColors: ['#fb923c', '#f97316', '#fed7aa', '#ffffff', '#9a3412'],
  },
];

interface ShootingStar {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  speed: number;
  opacity: number;
  active: boolean;
  theme: MeteorTheme;
  headRadius: number;
  sparks: Spark[];
  targetType?: 'floating_capsule' | 'hanging_capsule' | 'pair' | 'ambient';
}

export const StarryBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      initStars();
    };

    window.addEventListener('resize', handleResize);

    const starColors = [
      '#ffffff',
      '#e0f2fe',
      '#bae6fd',
      '#c4b5fd',
      '#fef08a',
      '#a5f3fc',
      '#fed7aa',
      '#f472b6',
    ];

    let stars: Star[] = [];
    let shootingStars: ShootingStar[] = [];
    let fireworkParticles: FireworkParticle[] = [];
    let explosionBursts: ExplosionBurst[] = [];
    let nextMeteorId = 1;

    const STAR_COUNT = Math.min(Math.floor((width * height) / 3800), 300);

    const initStars = () => {
      stars = [];
      for (let i = 0; i < STAR_COUNT; i++) {
        const radius = Math.random() < 0.75 ? Math.random() * 1.3 + 0.4 : Math.random() * 2.2 + 1.2;
        const baseAlpha = Math.random() * 0.7 + 0.3;
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius,
          baseAlpha,
          alpha: baseAlpha,
          twinkleSpeed: (Math.random() * 0.02 + 0.006) * (Math.random() > 0.5 ? 1 : -1),
          color: starColors[Math.floor(Math.random() * starColors.length)],
          vx: (Math.random() - 0.5) * 0.08,
          vy: (Math.random() - 0.5) * 0.08,
        });
      }
    };

    initStars();

    let themeCounter = 0;

    // Trigger big fireworks burst when meteors collide
    const triggerFirecrackerExplosion = (x: number, y: number, colors: string[]) => {
      playFirecrackerSound();

      explosionBursts.push({
        x,
        y,
        radius: 4,
        maxRadius: Math.random() * 35 + 45,
        alpha: 1,
        color: colors[0] || '#ffd700',
      });

      // 60-85 sparkling firecracker particles (Diwali patakha style)
      const particleCount = Math.floor(Math.random() * 25) + 60;
      for (let p = 0; p < particleCount; p++) {
        const speed = Math.random() * 5.5 + 2.0;
        const angle = Math.random() * Math.PI * 2;
        const pColor = colors[Math.floor(Math.random() * colors.length)] || '#ffffff';

        fireworkParticles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: Math.random() * 2.8 + 1.2,
          color: pColor,
          alpha: 1,
          decay: Math.random() * 0.02 + 0.012,
          twinkleRate: Math.random() * 0.3 + 0.1,
          trail: [],
        });
      }
    };

    // 🌟 1. Routine Shooting Star — STRICTLY SIDES & BOTTOM (1 every 2s)
    const createSideOrBottomShootingStar = (): ShootingStar => {
      const spawnSide = Math.floor(Math.random() * 3);
      let startX = 0;
      let startY = 0;
      let targetX = 0;
      let targetY = 0;

      if (spawnSide === 0) {
        // Bottom edge -> traveling up across sky
        startX = Math.random() * width;
        startY = height + 30;
        targetX = Math.random() * width;
        targetY = Math.random() * (height * 0.5) + 50;
      } else if (spawnSide === 1) {
        // Left edge
        startX = -30;
        startY = Math.random() * (height * 0.7) + height * 0.25;
        targetX = width + 30;
        targetY = Math.random() * (height * 0.6);
      } else {
        // Right edge
        startX = width + 30;
        startY = Math.random() * (height * 0.7) + height * 0.25;
        targetX = -30;
        targetY = Math.random() * (height * 0.6);
      }

      const dx = targetX - startX;
      const dy = targetY - startY;
      const dist = Math.hypot(dx, dy) || 1;
      const vx = dx / dist;
      const vy = dy / dist;

      const theme = METEOR_THEMES[themeCounter % METEOR_THEMES.length];
      themeCounter++;

      return {
        id: nextMeteorId++,
        x: startX,
        y: startY,
        vx,
        vy,
        length: Math.random() * 65 + 75,
        speed: Math.random() * 1.2 + 2.8,
        opacity: 1,
        active: true,
        theme,
        headRadius: Math.random() * 1.5 + 3.2,
        sparks: [],
        targetType: 'ambient',
      };
    };

    // 🌟 2. Mid-Air Collision Pair (2 colliding stars every 5s)
    const spawnCollisionPair = () => {
      const meetX = Math.random() * (width * 0.5) + width * 0.25;
      const meetY = Math.random() * (height * 0.4) + height * 0.35;
      const travelDist = Math.random() * 200 + 260;
      const baseSpeed = Math.random() * 0.6 + 3.2;

      const pattern = Math.random() > 0.5 ? 0 : 1;
      let s1X = 0;
      let s1Y = 0;
      let s2X = 0;
      let s2Y = 0;

      if (pattern === 0) {
        s1X = meetX - travelDist;
        s1Y = meetY + (Math.random() - 0.5) * 40;
        s2X = meetX + travelDist;
        s2Y = meetY + (Math.random() - 0.5) * 40;
      } else {
        s1X = meetX - travelDist * 0.75;
        s1Y = meetY + travelDist * 0.75;
        s2X = meetX + travelDist * 0.75;
        s2Y = meetY + travelDist * 0.75;
      }

      const d1 = Math.hypot(meetX - s1X, meetY - s1Y) || 1;
      const d2 = Math.hypot(meetX - s2X, meetY - s2Y) || 1;

      const theme1 = METEOR_THEMES[themeCounter % METEOR_THEMES.length];
      themeCounter++;
      const theme2 = METEOR_THEMES[themeCounter % METEOR_THEMES.length];
      themeCounter++;

      shootingStars.push({
        id: nextMeteorId++,
        x: s1X,
        y: s1Y,
        vx: (meetX - s1X) / d1,
        vy: (meetY - s1Y) / d1,
        length: 80,
        speed: baseSpeed,
        opacity: 1,
        active: true,
        theme: theme1,
        headRadius: 3.8,
        sparks: [],
        targetType: 'pair',
      });

      shootingStars.push({
        id: nextMeteorId++,
        x: s2X,
        y: s2Y,
        vx: (meetX - s2X) / d2,
        vy: (meetY - s2Y) / d2,
        length: 80,
        speed: baseSpeed,
        opacity: 1,
        active: true,
        theme: theme2,
        headRadius: 3.8,
        sparks: [],
        targetType: 'pair',
      });
    };

    // 🌟 3. Dedicated Floating Cognition Capsule Target Spawner (Flies ALL the way without disappearing!)
    const spawnFloatingCapsuleTargetMeteor = () => {
      try {
        const floatCap = document.querySelector('[data-floating-capsule="true"]');
        if (!floatCap) return;

        const rect = floatCap.getBoundingClientRect();
        // Target exact live center of the floating capsule
        const targetX = rect.left + rect.width / 2;
        const targetY = rect.top + rect.height / 2;

        const spawnSide = Math.floor(Math.random() * 3);
        let startX = 0;
        let startY = 0;

        if (spawnSide === 0) {
          // Bottom edge flying straight up across screen
          startX = Math.random() * (width * 0.6) + width * 0.2;
          startY = height + 35;
        } else if (spawnSide === 1) {
          // Left edge flying across to upper-right capsule
          startX = -35;
          startY = Math.random() * (height * 0.5) + height * 0.35;
        } else {
          // Right edge flying in
          startX = width + 35;
          startY = Math.random() * (height * 0.4) + height * 0.4;
        }

        const dx = targetX - startX;
        const dy = targetY - startY;
        const dist = Math.hypot(dx, dy) || 1;

        const theme = METEOR_THEMES[themeCounter % METEOR_THEMES.length];
        themeCounter++;

        shootingStars.push({
          id: nextMeteorId++,
          x: startX,
          y: startY,
          vx: dx / dist,
          vy: dy / dist,
          length: Math.random() * 20 + 80,
          speed: Math.random() * 0.6 + 3.4,
          opacity: 1, // Will stay 1.0 full brightness until impact!
          active: true,
          theme,
          headRadius: 4.2,
          sparks: [],
          targetType: 'floating_capsule',
        });
      } catch {}
    };

    // 🌟 4. Hanging Header Capsules Target Spawner
    const spawnHangingCapsuleTargetMeteor = () => {
      try {
        const hangingCaps = Array.from(document.querySelectorAll('[data-hanging-capsule="true"]'));
        if (hangingCaps.length === 0) return;

        const targetEl = hangingCaps[Math.floor(Math.random() * hangingCaps.length)];
        const rect = targetEl.getBoundingClientRect();
        const targetX = rect.left + rect.width / 2;
        const targetY = rect.top + rect.height / 2;

        const spawnSide = Math.random() > 0.5 ? 0 : 1;
        let startX = 0;
        let startY = 0;

        if (spawnSide === 0) {
          startX = Math.random() * (width * 0.8) + width * 0.1;
          startY = height + 35;
        } else {
          startX = Math.random() > 0.5 ? -35 : width + 35;
          startY = Math.random() * (height * 0.4) + height * 0.4;
        }

        const dx = targetX - startX;
        const dy = targetY - startY;
        const dist = Math.hypot(dx, dy) || 1;

        const theme = METEOR_THEMES[themeCounter % METEOR_THEMES.length];
        themeCounter++;

        shootingStars.push({
          id: nextMeteorId++,
          x: startX,
          y: startY,
          vx: dx / dist,
          vy: dy / dist,
          length: 70,
          speed: Math.random() * 0.6 + 3.0,
          opacity: 1,
          active: true,
          theme,
          headRadius: 3.4,
          sparks: [],
          targetType: 'hanging_capsule',
        });
      } catch {}
    };

    let lastMeteorTime = Date.now();
    let lastPairTime = Date.now();
    let lastFloatingTargetTime = Date.now();
    let lastHangingTargetTime = Date.now();

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const now = Date.now();

      // 1. Ambient shooting star: EXACTLY 1 every 2 seconds (user requested: "har do 2 sec me 1")
      if (now - lastMeteorTime > 2000) {
        if (shootingStars.filter((s) => s.targetType === 'ambient').length < 2) {
          shootingStars.push(createSideOrBottomShootingStar());
        }
        lastMeteorTime = now;
      }

      // 2. Colliding pair: EXACTLY 2 stars every 5 seconds (user requested: "jo takrne bali hogi har 5 sec me 2")
      if (now - lastPairTime > 5000) {
        spawnCollisionPair();
        lastPairTime = now;
      }

      // 3. Dedicated floating cognition capsule targeted meteor: every ~5 seconds
      if (now - lastFloatingTargetTime > 5000) {
        spawnFloatingCapsuleTargetMeteor();
        lastFloatingTargetTime = now;
      }

      // 4. Hanging header capsules targeted meteor: every ~8 seconds
      if (now - lastHangingTargetTime > 8000) {
        spawnHangingCapsuleTargetMeteor();
        lastHangingTargetTime = now;
      }

      // 1. Draw static & twinkling stars
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];

        star.alpha += star.twinkleSpeed;
        if (star.alpha > 1 || star.alpha < star.baseAlpha * 0.3) {
          star.twinkleSpeed = -star.twinkleSpeed;
        }

        star.x += star.vx;
        star.y += star.vy;

        if (star.x < 0) star.x = width;
        if (star.x > width) star.x = 0;
        if (star.y < 0) star.y = height;
        if (star.y > height) star.y = 0;

        ctx.save();
        ctx.globalAlpha = Math.max(0.1, Math.min(1, star.alpha));

        if (star.radius > 1.4) {
          const glowGradient = ctx.createRadialGradient(
            star.x,
            star.y,
            0,
            star.x,
            star.y,
            star.radius * 3.5
          );
          glowGradient.addColorStop(0, star.color);
          glowGradient.addColorStop(1, 'transparent');
          ctx.fillStyle = glowGradient;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.radius * 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = star.color;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();

        if (star.radius > 2.0 && star.alpha > 0.7) {
          ctx.strokeStyle = star.color;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(star.x - star.radius * 2.5, star.y);
          ctx.lineTo(star.x + star.radius * 2.5, star.y);
          ctx.moveTo(star.x, star.y - star.radius * 2.5);
          ctx.lineTo(star.x, star.y + star.radius * 2.5);
          ctx.stroke();
        }

        ctx.restore();
      }

      // ── CHECK 1: Meteor-on-Meteor Mid-Air Collisions ─────────
      for (let i = 0; i < shootingStars.length; i++) {
        for (let j = i + 1; j < shootingStars.length; j++) {
          const m1 = shootingStars[i];
          const m2 = shootingStars[j];
          if (!m1.active || !m2.active) continue;

          const dx = m1.x - m2.x;
          const dy = m1.y - m2.y;
          const distSq = dx * dx + dy * dy;
          const hitRadius = m1.headRadius + m2.headRadius + 24;

          if (distSq < hitRadius * hitRadius) {
            m1.active = false;
            m2.active = false;
            const collisionX = (m1.x + m2.x) / 2;
            const collisionY = (m1.y + m2.y) / 2;
            const blendedColors = [...m1.theme.fireworkColors, ...m2.theme.fireworkColors];
            triggerFirecrackerExplosion(collisionX, collisionY, blendedColors);
          }
        }
      }

      // ── CHECK 2: Meteor vs Floating Cognition Capsule Collisions ─────────
      try {
        const floatCapEl = document.querySelector('[data-floating-capsule="true"]');
        if (floatCapEl) {
          const rect = floatCapEl.getBoundingClientRect();
          const capCenterX = rect.left + rect.width / 2;
          const capCenterY = rect.top + rect.height / 2;
          const hitRadius = Math.max(rect.width, rect.height) / 2 + 18;

          const capLeft = rect.left - 24;
          const capRight = rect.right + 24;
          const capTop = rect.top - 24;
          const capBottom = rect.bottom + 24;

          for (let i = 0; i < shootingStars.length; i++) {
            const meteor = shootingStars[i];
            if (!meteor.active) continue;

            const distToCenter = Math.hypot(meteor.x - capCenterX, meteor.y - capCenterY);
            const isInsideBox =
              meteor.x >= capLeft &&
              meteor.x <= capRight &&
              meteor.y >= capTop &&
              meteor.y <= capBottom;

            if (distToCenter <= hitRadius || isInsideBox) {
              meteor.active = false;

              // Fire crack event to Cognition Capsule
              window.dispatchEvent(
                new CustomEvent('capsule_meteor_hit', {
                  detail: { x: meteor.x, y: meteor.y, theme: meteor.theme.name },
                })
              );

              triggerFirecrackerExplosion(meteor.x, meteor.y, meteor.theme.fireworkColors);
            }
          }
        }
      } catch {}

      // ── CHECK 3: Meteor vs Hanging Rope Capsules Collisions ─────────
      try {
        const hangingCaps = Array.from(document.querySelectorAll('[data-hanging-capsule="true"]'));
        for (const hangEl of hangingCaps) {
          const rect = hangEl.getBoundingClientRect();
          const capCenterX = rect.left + rect.width / 2;
          const capCenterY = rect.top + rect.height / 2;
          const hitRadius = Math.max(rect.width, rect.height) / 2 + 16;

          const capLeft = rect.left - 20;
          const capRight = rect.right + 20;
          const capTop = rect.top - 20;
          const capBottom = rect.bottom + 20;

          for (let i = 0; i < shootingStars.length; i++) {
            const meteor = shootingStars[i];
            if (!meteor.active) continue;

            const distToCenter = Math.hypot(meteor.x - capCenterX, meteor.y - capCenterY);
            const isInsideBox =
              meteor.x >= capLeft &&
              meteor.x <= capRight &&
              meteor.y >= capTop &&
              meteor.y <= capBottom;

            if (distToCenter <= hitRadius || isInsideBox) {
              meteor.active = false;

              // Fire crack event to this specific hanging capsule element!
              hangEl.dispatchEvent(
                new CustomEvent('capsule_crack_hit', {
                  bubbles: true,
                  detail: { x: meteor.x, y: meteor.y, theme: meteor.theme.name },
                })
              );

              triggerFirecrackerExplosion(meteor.x, meteor.y, meteor.theme.fireworkColors);
            }
          }
        }
      } catch {}

      // 2. Draw Shooting Stars with Fiery Burning Heads & Sparks
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const meteor = shootingStars[i];
        if (!meteor.active) {
          shootingStars.splice(i, 1);
          continue;
        }

        meteor.x += meteor.vx * meteor.speed;
        meteor.y += meteor.vy * meteor.speed;

        // Targeted & Pair meteors maintain 100% full opacity (NEVER vanish mid-flight!)
        if (
          meteor.targetType === 'floating_capsule' ||
          meteor.targetType === 'hanging_capsule' ||
          meteor.targetType === 'pair'
        ) {
          meteor.opacity = 1.0;
        } else {
          // Ambient stars fade very slowly across hundreds of frames
          meteor.opacity -= 0.002;
        }

        if (
          meteor.opacity <= 0 ||
          meteor.x < -200 ||
          meteor.x > width + 200 ||
          meteor.y > height + 200 ||
          meteor.y < -200
        ) {
          meteor.active = false;
          continue;
        }

        // Spawn burning flame sparks from the head
        if (Math.random() < 0.75 && meteor.opacity > 0.2) {
          meteor.sparks.push({
            x: meteor.x + (Math.random() - 0.5) * 4,
            y: meteor.y + (Math.random() - 0.5) * 4,
            vx: -meteor.vx * (Math.random() * 1.5 + 0.5) + (Math.random() - 0.5) * 1.5,
            vy: -meteor.vy * (Math.random() * 1.5 + 0.5) + (Math.random() - 0.5) * 1.5,
            size: Math.random() * 2.2 + 1.0,
            alpha: meteor.opacity * (Math.random() * 0.4 + 0.6),
            decay: Math.random() * 0.03 + 0.015,
            color: meteor.theme.sparkColor,
          });
        }

        // Draw sparks / ember trail
        for (let s = meteor.sparks.length - 1; s >= 0; s--) {
          const sp = meteor.sparks[s];
          sp.x += sp.vx;
          sp.y += sp.vy;
          sp.alpha -= sp.decay;

          if (sp.alpha <= 0) {
            meteor.sparks.splice(s, 1);
            continue;
          }

          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, sp.alpha));
          ctx.fillStyle = sp.color;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Calculate tail coordinate behind the head
        const tailX = meteor.x - meteor.vx * meteor.length;
        const tailY = meteor.y - meteor.vy * meteor.length;

        // A. Draw Luminous Burning Tail
        const tailGrad = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
        tailGrad.addColorStop(0, `${meteor.theme.tailGrad[0]}${meteor.opacity})`);
        tailGrad.addColorStop(0.25, `${meteor.theme.tailGrad[1]}${meteor.opacity * 0.8})`);
        tailGrad.addColorStop(0.65, `${meteor.theme.tailGrad[2]}${meteor.opacity * 0.35})`);
        tailGrad.addColorStop(1, 'transparent');

        ctx.save();
        ctx.strokeStyle = tailGrad;
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(meteor.x, meteor.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        // Inner white-hot laser core of the tail
        const innerTailGrad = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
        innerTailGrad.addColorStop(0, `rgba(255, 255, 255, ${meteor.opacity * 0.9})`);
        innerTailGrad.addColorStop(0.3, `rgba(255, 255, 255, ${meteor.opacity * 0.4})`);
        innerTailGrad.addColorStop(0.7, 'transparent');

        ctx.strokeStyle = innerTailGrad;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(meteor.x, meteor.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.restore();

        // B. Draw FIERY BURNING FIREBALL HEAD ("aisa ho jaisa aag lagi ho")
        ctx.save();
        const headX = meteor.x;
        const headY = meteor.y;
        const baseR = meteor.headRadius;

        const flameCorona = ctx.createRadialGradient(
          headX,
          headY,
          0,
          headX,
          headY,
          baseR * 5.2
        );
        flameCorona.addColorStop(0, `${meteor.theme.flameMid}`);
        flameCorona.addColorStop(0.4, `${meteor.theme.flameOuter}`);
        flameCorona.addColorStop(1, 'transparent');

        ctx.globalAlpha = Math.max(0, Math.min(1, meteor.opacity * 0.85));
        ctx.fillStyle = flameCorona;
        ctx.beginPath();
        ctx.arc(headX, headY, baseR * 5.2, 0, Math.PI * 2);
        ctx.fill();

        const flameMidBall = ctx.createRadialGradient(
          headX,
          headY,
          0,
          headX,
          headY,
          baseR * 2.6
        );
        flameMidBall.addColorStop(0, '#ffffff');
        flameMidBall.addColorStop(0.3, meteor.theme.flameMid);
        flameMidBall.addColorStop(0.8, meteor.theme.flameOuter);
        flameMidBall.addColorStop(1, 'transparent');

        ctx.globalAlpha = Math.max(0, Math.min(1, meteor.opacity * 0.95));
        ctx.fillStyle = flameMidBall;
        ctx.beginPath();
        ctx.arc(headX, headY, baseR * 2.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = Math.max(0, Math.min(1, meteor.opacity));
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(headX, headY, baseR * 0.9, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(255, 255, 255, ${meteor.opacity * 0.8})`;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(headX - baseR * 3, headY);
        ctx.lineTo(headX + baseR * 3, headY);
        ctx.moveTo(headX, headY - baseR * 3);
        ctx.lineTo(headX, headY + baseR * 3);
        ctx.stroke();

        ctx.restore();
      }

      // 3. Draw Expanding Firecracker Shockwave Bursts
      for (let b = explosionBursts.length - 1; b >= 0; b--) {
        const burst = explosionBursts[b];
        burst.radius += 2.0;
        burst.alpha -= 0.035;

        if (burst.alpha <= 0 || burst.radius >= burst.maxRadius) {
          explosionBursts.splice(b, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, burst.alpha);
        ctx.strokeStyle = burst.color;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(burst.x, burst.y, burst.radius, 0, Math.PI * 2);
        ctx.stroke();

        const flashGrad = ctx.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, burst.radius * 0.8);
        flashGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        flashGrad.addColorStop(0.4, burst.color);
        flashGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = flashGrad;
        ctx.beginPath();
        ctx.arc(burst.x, burst.y, burst.radius * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 4. Draw Scattered Sparkling Firecracker Particles
      for (let p = fireworkParticles.length - 1; p >= 0; p--) {
        const pt = fireworkParticles[p];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.vy += 0.07;
        pt.vx *= 0.97;
        pt.vy *= 0.97;
        pt.alpha -= pt.decay;

        if (pt.alpha <= 0 || pt.y > height + 20) {
          fireworkParticles.splice(p, 1);
          continue;
        }

        pt.trail.push({ x: pt.x, y: pt.y });
        if (pt.trail.length > 4) pt.trail.shift();

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, pt.alpha));

        if (pt.trail.length > 1) {
          ctx.strokeStyle = pt.color;
          ctx.lineWidth = pt.size * 0.5;
          ctx.beginPath();
          ctx.moveTo(pt.trail[0].x, pt.trail[0].y);
          for (let t = 1; t < pt.trail.length; t++) {
            ctx.lineTo(pt.trail[t].x, pt.trail[t].y);
          }
          ctx.stroke();
        }

        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();

        if (pt.size > 1.8 && pt.alpha > 0.4) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(pt.x - pt.size * 2, pt.y);
          ctx.lineTo(pt.x + pt.size * 2, pt.y);
          ctx.moveTo(pt.x, pt.y - pt.size * 2);
          ctx.lineTo(pt.x, pt.y + pt.size * 2);
          ctx.stroke();
        }

        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 select-none">
      {/* Dynamic Deep Cosmic Nebulae */}
      <div
        className="absolute top-[-15%] left-[-10%] w-[55vw] h-[55vw] max-w-[650px] max-h-[650px] rounded-full bg-gradient-to-tr from-cyan-600/10 via-blue-500/8 to-transparent blur-[120px] pointer-events-none animate-pulse"
        style={{ animationDuration: '9s' }}
      />
      <div
        className="absolute top-[35%] right-[-15%] w-[60vw] h-[60vw] max-w-[700px] max-h-[700px] rounded-full bg-gradient-to-bl from-purple-600/12 via-indigo-500/8 to-transparent blur-[140px] pointer-events-none animate-pulse"
        style={{ animationDuration: '12s' }}
      />
      <div className="absolute bottom-[-10%] left-[20%] w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] rounded-full bg-gradient-to-t from-emerald-500/6 via-cyan-500/5 to-transparent blur-[130px] pointer-events-none" />

      {/* HTML5 Canvas with high density twinkling stars, 12-theme fiery meteors, mid-air firecracker collisions, & capsule hit detection */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
    </div>
  );
};

export default StarryBackground;
