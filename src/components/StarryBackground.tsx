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

interface ShootingStar {
  x: number;
  y: number;
  length: number;
  speed: number;
  angle: number;
  opacity: number;
  active: boolean;
  trailColor: string;
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

    // Star color palette (rich celestial colors)
    const starColors = [
      '#ffffff', // Pure white
      '#e0f2fe', // Ice blue
      '#bae6fd', // Sky blue
      '#c4b5fd', // Soft violet
      '#fef08a', // Soft gold
      '#a5f3fc', // Cyan glow
      '#fed7aa', // Warm starlight
    ];

    let stars: Star[] = [];
    let shootingStars: ShootingStar[] = [];

    const STAR_COUNT = Math.min(Math.floor((width * height) / 4500), 280); // Responsive star density

    const initStars = () => {
      stars = [];
      for (let i = 0; i < STAR_COUNT; i++) {
        const radius = Math.random() < 0.8 ? Math.random() * 1.2 + 0.4 : Math.random() * 2.0 + 1.2;
        const baseAlpha = Math.random() * 0.7 + 0.3;
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius,
          baseAlpha,
          alpha: baseAlpha,
          twinkleSpeed: (Math.random() * 0.02 + 0.005) * (Math.random() > 0.5 ? 1 : -1),
          color: starColors[Math.floor(Math.random() * starColors.length)],
          vx: (Math.random() - 0.5) * 0.08,
          vy: (Math.random() - 0.5) * 0.08,
        });
      }
    };

    initStars();

    // Shooting star spawner
    const createShootingStar = (): ShootingStar => {
      const startX = Math.random() * width * 1.2;
      const startY = Math.random() * (height * 0.45);
      return {
        x: startX,
        y: startY,
        length: Math.random() * 80 + 70,
        speed: Math.random() * 7 + 9,
        angle: Math.PI / 4 + (Math.random() - 0.5) * 0.3, // ~45 degrees diagonal
        opacity: 1,
        active: true,
        trailColor: Math.random() > 0.5 ? 'rgba(186, 230, 253, ' : 'rgba(254, 240, 138, ',
      };
    };

    let lastShootingStarTime = Date.now();
    let nextShootingStarInterval = Math.random() * 3000 + 2500; // Shooting star every 2.5 - 5.5 seconds

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const now = Date.now();

      // Check if we should launch a new shooting star
      if (now - lastShootingStarTime > nextShootingStarInterval) {
        if (shootingStars.length < 2) {
          shootingStars.push(createShootingStar());
        }
        lastShootingStarTime = now;
        nextShootingStarInterval = Math.random() * 4000 + 2500;
      }

      // 1. Draw static & twinkling stars
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];

        // Twinkle update
        star.alpha += star.twinkleSpeed;
        if (star.alpha > 1 || star.alpha < star.baseAlpha * 0.3) {
          star.twinkleSpeed = -star.twinkleSpeed;
        }

        // Slight drift
        star.x += star.vx;
        star.y += star.vy;

        if (star.x < 0) star.x = width;
        if (star.x > width) star.x = 0;
        if (star.y < 0) star.y = height;
        if (star.y > height) star.y = 0;

        ctx.save();
        ctx.globalAlpha = Math.max(0.1, Math.min(1, star.alpha));

        // Draw star halo glow for brighter stars
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

        // Core star point
        ctx.fillStyle = star.color;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();

        // Cross sparkle for largest stars
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

      // 2. Draw Shooting Stars (Meteors)
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const meteor = shootingStars[i];
        if (!meteor.active) {
          shootingStars.splice(i, 1);
          continue;
        }

        meteor.x -= Math.cos(meteor.angle) * meteor.speed;
        meteor.y += Math.sin(meteor.angle) * meteor.speed;
        meteor.opacity -= 0.015;

        if (meteor.opacity <= 0 || meteor.x < -100 || meteor.y > height + 100) {
          meteor.active = false;
          continue;
        }

        const tailX = meteor.x + Math.cos(meteor.angle) * meteor.length;
        const tailY = meteor.y - Math.sin(meteor.angle) * meteor.length;

        const grad = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
        grad.addColorStop(0, `${meteor.trailColor}${meteor.opacity})`);
        grad.addColorStop(0.3, `${meteor.trailColor}${meteor.opacity * 0.6})`);
        grad.addColorStop(1, 'transparent');

        ctx.save();
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(meteor.x, meteor.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        // Meteor head bright point
        ctx.fillStyle = `rgba(255, 255, 255, ${meteor.opacity})`;
        ctx.beginPath();
        ctx.arc(meteor.x, meteor.y, 1.8, 0, Math.PI * 2);
        ctx.fill();

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
      <div className="absolute top-[-15%] left-[-10%] w-[55vw] h-[55vw] max-w-[650px] max-h-[650px] rounded-full bg-gradient-to-tr from-cyan-600/10 via-blue-500/8 to-transparent blur-[120px] pointer-events-none animate-pulse" style={{ animationDuration: '9s' }} />
      <div className="absolute top-[35%] right-[-15%] w-[60vw] h-[60vw] max-w-[700px] max-h-[700px] rounded-full bg-gradient-to-bl from-purple-600/12 via-indigo-500/8 to-transparent blur-[140px] pointer-events-none animate-pulse" style={{ animationDuration: '12s' }} />
      <div className="absolute bottom-[-10%] left-[20%] w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] rounded-full bg-gradient-to-t from-emerald-500/6 via-cyan-500/5 to-transparent blur-[130px] pointer-events-none" />

      {/* HTML5 Canvas with high density twinkling stars & meteors */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
    </div>
  );
};

export default StarryBackground;
