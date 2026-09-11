import React, { useEffect, useRef } from 'react';

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

interface MeteorTheme {
  name: string;
  flameCore: string;
  flameMid: string;
  flameOuter: string;
  tailGrad: [string, string, string];
  sparkColor: string;
}

// 12 Deep, distinct cosmic & fiery color themes
const METEOR_THEMES: MeteorTheme[] = [
  // 1. 🔥 Solar Magma Inferno
  {
    name: 'Solar Magma',
    flameCore: '#ffffff',
    flameMid: '#ff7700',
    flameOuter: '#ff2200',
    tailGrad: ['rgba(255, 119, 0, ', 'rgba(255, 34, 0, ', 'rgba(255, 200, 0, '],
    sparkColor: '#ffaa00',
  },
  // 2. ⚡ Hyper Cyber Cyan
  {
    name: 'Cyber Cyan',
    flameCore: '#ffffff',
    flameMid: '#00f0ff',
    flameOuter: '#0077ff',
    tailGrad: ['rgba(0, 240, 255, ', 'rgba(0, 119, 255, ', 'rgba(200, 250, 255, '],
    sparkColor: '#00f0ff',
  },
  // 3. 💜 Deep Plasma Violet
  {
    name: 'Plasma Violet',
    flameCore: '#ffffff',
    flameMid: '#c084fc',
    flameOuter: '#9333ea',
    tailGrad: ['rgba(192, 132, 252, ', 'rgba(147, 51, 234, ', 'rgba(243, 232, 255, '],
    sparkColor: '#d8b4fe',
  },
  // 4. 🟢 Radioactive Neon Emerald
  {
    name: 'Neon Emerald',
    flameCore: '#ffffff',
    flameMid: '#34d399',
    flameOuter: '#059669',
    tailGrad: ['rgba(52, 211, 153, ', 'rgba(5, 150, 105, ', 'rgba(209, 250, 229, '],
    sparkColor: '#6ee7b7',
  },
  // 5. 🔴 Ruby Blood Laser
  {
    name: 'Ruby Crimson',
    flameCore: '#ffffff',
    flameMid: '#fb7185',
    flameOuter: '#e11d48',
    tailGrad: ['rgba(251, 113, 133, ', 'rgba(225, 29, 72, ', 'rgba(255, 228, 230, '],
    sparkColor: '#f43f5e',
  },
  // 6. 🟡 Supernova Sunfire
  {
    name: 'Supernova Gold',
    flameCore: '#ffffff',
    flameMid: '#fde047',
    flameOuter: '#d97706',
    tailGrad: ['rgba(253, 224, 71, ', 'rgba(217, 119, 6, ', 'rgba(254, 249, 195, '],
    sparkColor: '#fbbf24',
  },
  // 7. 🌌 Electric Cosmic Indigo
  {
    name: 'Cosmic Indigo',
    flameCore: '#ffffff',
    flameMid: '#818cf8',
    flameOuter: '#4338ca',
    tailGrad: ['rgba(129, 140, 248, ', 'rgba(67, 56, 202, ', 'rgba(224, 231, 255, '],
    sparkColor: '#a5b4fc',
  },
  // 8. 🌸 Cyberpunk Hot Magenta
  {
    name: 'Hot Magenta',
    flameCore: '#ffffff',
    flameMid: '#f472b6',
    flameOuter: '#db2777',
    tailGrad: ['rgba(244, 114, 182, ', 'rgba(219, 39, 119, ', 'rgba(253, 242, 248, '],
    sparkColor: '#f472b6',
  },
  // 9. 🧪 Toxic Acid Lime
  {
    name: 'Acid Lime',
    flameCore: '#ffffff',
    flameMid: '#a3e635',
    flameOuter: '#65a30d',
    tailGrad: ['rgba(163, 230, 53, ', 'rgba(101, 163, 13, ', 'rgba(247, 254, 231, '],
    sparkColor: '#bef264',
  },
  // 10. 🌊 Deep Sea Aquamarine
  {
    name: 'Aquamarine',
    flameCore: '#ffffff',
    flameMid: '#22d3ee',
    flameOuter: '#0891b2',
    tailGrad: ['rgba(34, 211, 238, ', 'rgba(8, 145, 178, ', 'rgba(207, 250, 254, '],
    sparkColor: '#67e8f9',
  },
  // 11. ❄️ Arctic Sapphire Blaze
  {
    name: 'Arctic Sapphire',
    flameCore: '#ffffff',
    flameMid: '#60a5fa',
    flameOuter: '#1d4ed8',
    tailGrad: ['rgba(96, 165, 250, ', 'rgba(29, 78, 216, ', 'rgba(239, 246, 255, '],
    sparkColor: '#93c5fd',
  },
  // 12. 🌋 Volcanic Molten Ember
  {
    name: 'Volcanic Lava',
    flameCore: '#ffffff',
    flameMid: '#fb923c',
    flameOuter: '#c2410c',
    tailGrad: ['rgba(251, 146, 60, ', 'rgba(194, 65, 12, ', 'rgba(255, 237, 213, '],
    sparkColor: '#f97316',
  },
];

interface ShootingStar {
  x: number;
  y: number;
  length: number;
  speed: number;
  angle: number;
  opacity: number;
  active: boolean;
  theme: MeteorTheme;
  headRadius: number;
  sparks: Spark[];
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

    // Deep space celestial stars
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

    const STAR_COUNT = Math.min(Math.floor((width * height) / 3800), 320);

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

    // Shooting star spawner with burning fire head & sparks
    const createShootingStar = (): ShootingStar => {
      const startX = Math.random() * (width * 1.15) + width * 0.05;
      const startY = Math.random() * (height * 0.55);
      const angle = Math.PI / 4 + (Math.random() - 0.5) * 0.35; // ~45 deg diagonal
      const theme = METEOR_THEMES[themeCounter % METEOR_THEMES.length];
      themeCounter++;

      return {
        x: startX,
        y: startY,
        length: Math.random() * 95 + 90,
        speed: Math.random() * 7 + 10,
        angle,
        opacity: 1,
        active: true,
        theme,
        headRadius: Math.random() * 2.0 + 3.2, // Big blazing fiery head
        sparks: [],
      };
    };

    let lastShootingStarTime = Date.now();
    // High frequency meteor shower (new meteor every 500ms - 1300ms)
    let nextShootingStarInterval = Math.random() * 800 + 500;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const now = Date.now();

      // Spawn new shooting stars (allow up to 6 concurrent meteors)
      if (now - lastShootingStarTime > nextShootingStarInterval) {
        if (shootingStars.length < 6) {
          shootingStars.push(createShootingStar());
        }
        lastShootingStarTime = now;
        nextShootingStarInterval = Math.random() * 800 + 450;
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

      // 2. Draw Shooting Stars with Fiery Burning Heads & Sparks
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const meteor = shootingStars[i];
        if (!meteor.active) {
          shootingStars.splice(i, 1);
          continue;
        }

        // Advance position
        meteor.x -= Math.cos(meteor.angle) * meteor.speed;
        meteor.y += Math.sin(meteor.angle) * meteor.speed;
        meteor.opacity -= 0.013;

        if (meteor.opacity <= 0 || meteor.x < -150 || meteor.y > height + 150) {
          meteor.active = false;
          continue;
        }

        // Spawn burning flame sparks from the head
        if (Math.random() < 0.85 && meteor.opacity > 0.2) {
          meteor.sparks.push({
            x: meteor.x + (Math.random() - 0.5) * 4,
            y: meteor.y + (Math.random() - 0.5) * 4,
            vx: Math.cos(meteor.angle) * (Math.random() * 2 + 1) + (Math.random() - 0.5) * 2,
            vy: -Math.sin(meteor.angle) * (Math.random() * 2 + 1) + (Math.random() - 0.5) * 2,
            size: Math.random() * 2.4 + 1.0,
            alpha: meteor.opacity * (Math.random() * 0.4 + 0.6),
            decay: Math.random() * 0.035 + 0.02,
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

        // Calculate tail coordinate
        const tailX = meteor.x + Math.cos(meteor.angle) * meteor.length;
        const tailY = meteor.y - Math.sin(meteor.angle) * meteor.length;

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

        // Layer 1: Outermost combustion flame corona (intense raging fire aura)
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

        // Layer 2: Mid burning flame ball (fire texture & brightness)
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

        // Layer 3: Blazing Thermonuclear White-Hot Fire Core
        ctx.globalAlpha = Math.max(0, Math.min(1, meteor.opacity));
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(headX, headY, baseR * 0.9, 0, Math.PI * 2);
        ctx.fill();

        // Cross-fire gleam
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

      {/* HTML5 Canvas with high density twinkling stars & 12-theme fiery meteors */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
    </div>
  );
};

export default StarryBackground;
