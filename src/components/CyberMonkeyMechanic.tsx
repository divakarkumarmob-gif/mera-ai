import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';

// Web Audio API Sound Synthesizer for Cyber Monkey
let monkeyAudioCtx: AudioContext | null = null;

function getMonkeyAudioCtx(): AudioContext | null {
  try {
    if (!monkeyAudioCtx && typeof window !== 'undefined') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) monkeyAudioCtx = new AudioCtxClass();
    }
    if (monkeyAudioCtx && monkeyAudioCtx.state === 'suspended') {
      monkeyAudioCtx.resume().catch(() => {});
    }
    return monkeyAudioCtx;
  } catch {
    return null;
  }
}

// 🐵 Cute Cyber Monkey Jump Chirp
function playMonkeyJumpSound() {
  try {
    const ctx = getMonkeyAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.22);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  } catch {}
}

// ⚡ Laser Welding Sizzle Sound
function playWeldingSound() {
  try {
    const ctx = getMonkeyAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400 + Math.random() * 400, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch {}
}

interface MonkeyPosition {
  x: number;
  y: number;
  capsuleId?: string;
}

export const CyberMonkeyMechanic: React.FC = () => {
  const [pos, setPos] = useState<MonkeyPosition>({ x: -999, y: -999 });
  const [isJumping, setIsJumping] = useState(false);
  const [isWelding, setIsWelding] = useState(false);
  const [facingLeft, setFacingLeft] = useState(false);
  const [weldingSparks, setWeldingSparks] = useState<{ id: number; x: number; y: number; vx: number; vy: number; color: string }[]>([]);
  const targetQueueRef = useRef<HTMLElement[]>([]);
  const isBusyRef = useRef(false);
  const currentCapRef = useRef<HTMLElement | null>(null);
  const sparkIdCounter = useRef(1);

  // Find a valid starting capsule on mount
  useEffect(() => {
    const findInitialCapsule = () => {
      const capsules = Array.from(document.querySelectorAll('[data-hanging-capsule="true"]'));
      if (capsules.length > 0) {
        const first = capsules[0] as HTMLElement;
        const rect = first.getBoundingClientRect();
        currentCapRef.current = first;
        setPos({
          x: rect.left + rect.width / 2,
          y: rect.top - 8,
        });
      }
    };

    const timer = setTimeout(findInitialCapsule, 600);
    return () => clearTimeout(timer);
  }, []);

  // Acrobatic Leap & Repair Execution Engine
  const leapToCapsule = useCallback((targetEl: HTMLElement) => {
    if (!targetEl) return;
    isBusyRef.current = true;
    currentCapRef.current = targetEl;

    const targetRect = targetEl.getBoundingClientRect();
    const targetX = targetRect.left + targetRect.width / 2;
    const targetY = targetRect.top - 8;

    setFacingLeft(targetX < pos.x);
    setIsJumping(true);
    setIsWelding(false);
    playMonkeyJumpSound();

    // Perform smooth parabolic jump
    setPos({ x: targetX, y: targetY });

    // After jump landing (700ms)
    setTimeout(() => {
      setIsJumping(false);
      setIsWelding(true);

      // Start 5-second active welding animation
      const weldingInterval = setInterval(() => {
        playWeldingSound();
        // Spawn lively welding spark particles
        const newSparks = Array.from({ length: 4 }).map(() => ({
          id: sparkIdCounter.current++,
          x: (Math.random() - 0.5) * 16,
          y: (Math.random() - 0.5) * 10 + 12,
          vx: (Math.random() - 0.5) * 4,
          vy: -Math.random() * 4 - 1,
          color: Math.random() > 0.4 ? '#34d399' : '#fbbf24',
        }));
        setWeldingSparks((prev) => [...prev.slice(-16), ...newSparks]);
      }, 250);

      // Finish welding after 4.8s (just before full 5s seal)
      setTimeout(() => {
        clearInterval(weldingInterval);
        setIsWelding(false);
        setWeldingSparks([]);
        isBusyRef.current = false;

        // Check if another cracked capsule is queued up
        if (targetQueueRef.current.length > 0) {
          const nextTarget = targetQueueRef.current.shift();
          if (nextTarget) {
            setTimeout(() => leapToCapsule(nextTarget), 300);
          }
        }
      }, 4800);
    }, 700);
  }, [pos.x]);

  // Listen to custom capsule crack events
  useEffect(() => {
    const handleCrackHit = (e: any) => {
      const targetEl = e.target as HTMLElement;
      if (!targetEl) return;

      const capsuleTarget = targetEl.closest('[data-hanging-capsule="true"], [data-floating-capsule="true"]') as HTMLElement;
      if (!capsuleTarget) return;

      if (!isBusyRef.current) {
        leapToCapsule(capsuleTarget);
      } else {
        // Queue target if monkey is currently in middle of welding another
        if (!targetQueueRef.current.includes(capsuleTarget)) {
          targetQueueRef.current.push(capsuleTarget);
        }
      }
    };

    const handleFloatingCrack = () => {
      const floatCap = document.querySelector('[data-floating-capsule="true"]') as HTMLElement;
      if (floatCap) {
        if (!isBusyRef.current) {
          leapToCapsule(floatCap);
        } else {
          if (!targetQueueRef.current.includes(floatCap)) {
            targetQueueRef.current.push(floatCap);
          }
        }
      }
    };

    window.addEventListener('capsule_crack_hit', handleCrackHit);
    window.addEventListener('capsule_meteor_hit', handleFloatingCrack);

    return () => {
      window.removeEventListener('capsule_crack_hit', handleCrackHit);
      window.removeEventListener('capsule_meteor_hit', handleFloatingCrack);
    };
  }, [leapToCapsule]);

  if (pos.x < 0) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-50 overflow-visible"
      style={{ perspective: 1000 }}
    >
      <motion.div
        animate={{
          x: pos.x - 22,
          y: pos.y - 28,
        }}
        transition={
          isJumping
            ? {
                x: { duration: 0.68, ease: [0.25, 1, 0.5, 1] },
                y: {
                  duration: 0.68,
                  times: [0, 0.45, 1],
                  ease: 'easeInOut',
                },
              }
            : { duration: 0.2 }
        }
        className="absolute top-0 left-0 w-11 h-11 pointer-events-auto cursor-grab select-none"
        style={{
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Acrobatic Jump Somersault & Parabolic Arc */}
        <motion.div
          animate={
            isJumping
              ? {
                  y: [-35, -55, 0],
                  rotate: facingLeft ? [-40, -360] : [40, 360],
                  scale: [1, 1.25, 0.95, 1],
                }
              : isWelding
              ? {
                  y: [-1, 2, -1],
                  rotate: [0, facingLeft ? -4 : 4, 0],
                }
              : {
                  y: [0, -3, 0],
                  rotate: [0, -1.5, 1.5, 0],
                }
          }
          transition={
            isJumping
              ? { duration: 0.68, ease: 'easeInOut' }
              : isWelding
              ? { repeat: Infinity, duration: 0.35, ease: 'easeInOut' }
              : { repeat: Infinity, duration: 3.2, ease: 'easeInOut' }
          }
          className="relative w-full h-full flex items-center justify-center"
          style={{ transform: facingLeft ? 'scaleX(-1)' : 'scaleX(1)' }}
        >
          {/* ⚡ Alert Emote Exclamation (Pops when crack happens) */}
          {isJumping && (
            <motion.div
              initial={{ scale: 0, opacity: 0, y: 0 }}
              animate={{ scale: [0, 1.4, 1], opacity: [0, 1, 0], y: -24 }}
              transition={{ duration: 0.65 }}
              className="absolute -top-4 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-amber-400 text-black text-[10px] font-black shadow-[0_0_12px_#fbbf24] flex items-center gap-0.5"
            >
              <span>⚡</span>
              <span>FIX!</span>
            </motion.div>
          )}

          {/* 🐵 3D High-Tech Cyber Monkey SVG Model */}
          <svg className="w-10 h-10 drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)]" viewBox="0 0 100 100" fill="none">
            {/* Cybernetic Animated Tail */}
            <motion.path
              d="M 28 65 Q 12 55 10 38 Q 9 24 20 22 Q 28 22 25 32"
              stroke="#64748b"
              strokeWidth="5"
              strokeLinecap="round"
              fill="none"
              animate={
                isWelding
                  ? { d: 'M 28 65 Q 14 58 12 42 Q 10 30 18 26 Q 24 26 22 34' }
                  : { d: 'M 28 65 Q 10 52 8 36 Q 7 20 18 18 Q 26 18 24 28' }
              }
              transition={{ repeat: Infinity, repeatType: 'reverse', duration: 0.8 }}
            />
            {/* Tail glowing tip node */}
            <circle cx="23" cy="28" r="3.5" fill="#38bdf8" className="animate-pulse" />

            {/* Cyber Space Suit Body */}
            <ellipse cx="50" cy="65" rx="18" ry="16" fill="#1e293b" stroke="#0ea5e9" strokeWidth="2.2" />
            {/* Chest Core Power Reactor */}
            <circle cx="50" cy="65" r="5" fill="#06b6d4" />
            <circle cx="50" cy="65" r="2.5" fill="#ffffff" className="animate-ping" />

            {/* Monkey Ears */}
            <circle cx="27" cy="40" r="10" fill="#334155" stroke="#0ea5e9" strokeWidth="1.8" />
            <circle cx="27" cy="40" r="5.5" fill="#0284c7" />
            <circle cx="73" cy="40" r="10" fill="#334155" stroke="#0ea5e9" strokeWidth="1.8" />
            <circle cx="73" cy="40" r="5.5" fill="#0284c7" />

            {/* Cyber Monkey Head / Helmet */}
            <ellipse cx="50" cy="42" rx="22" ry="20" fill="#0f172a" stroke="#38bdf8" strokeWidth="2.5" />

            {/* Glowing Cyber Visor Eyes */}
            <rect x="34" y="34" width="32" height="12" rx="6" fill="#0284c7" stroke="#38bdf8" strokeWidth="1.5" />
            <motion.path
              d="M 38 40 L 46 40 M 54 40 L 62 40"
              stroke="#ffffff"
              strokeWidth="2.8"
              strokeLinecap="round"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ repeat: Infinity, duration: 1.6 }}
            />

            {/* Cute Monkey Snout & Smile */}
            <ellipse cx="50" cy="51" rx="10" ry="7" fill="#334155" />
            <circle cx="47" cy="49" r="1.2" fill="#0f172a" />
            <circle cx="53" cy="49" r="1.2" fill="#0f172a" />
            <path d="M 46 53 Q 50 56 54 53" stroke="#38bdf8" strokeWidth="1.4" strokeLinecap="round" fill="none" />

            {/* Monkey Mechanic Arms */}
            {isWelding ? (
              // Active Nanotech Welding Pose with Torch
              <g>
                <path d="M 34 65 L 42 78 L 52 82" stroke="#64748b" strokeWidth="4.5" strokeLinecap="round" />
                {/* Holographic Laser Torch */}
                <rect x="50" y="78" width="14" height="6" rx="2" fill="#e11d48" stroke="#f43f5e" strokeWidth="1.2" />
                <polygon points="64,81 76,76 76,86" fill="url(#weldingLaserGrad)" />
              </g>
            ) : (
              // Relaxed Idle Holding Tiny Wrench
              <g>
                <path d="M 34 65 L 30 76 L 36 80" stroke="#64748b" strokeWidth="4" strokeLinecap="round" />
                <path d="M 66 65 L 70 76 L 64 80" stroke="#64748b" strokeWidth="4" strokeLinecap="round" />
                {/* Nano Wrench in hand */}
                <path d="M 68 76 L 76 70 M 74 68 L 78 72" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
              </g>
            )}

            {/* Laser Gradient */}
            <defs>
              <linearGradient id="weldingLaserGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="30%" stopColor="#38bdf8" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>

          {/* 🌟 Active Welding Laser Sparks & Core Glow */}
          {isWelding && (
            <div className="absolute top-7 right-[-4px] pointer-events-none">
              <div className="w-3.5 h-3.5 rounded-full bg-cyan-300 animate-ping shadow-[0_0_15px_#00f0ff]" />
              {weldingSparks.map((sp) => (
                <motion.div
                  key={sp.id}
                  initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                  animate={{
                    opacity: 0,
                    x: sp.vx * 7,
                    y: sp.vy * 7,
                    scale: 0.3,
                  }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="absolute w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: sp.color, boxShadow: `0 0 6px ${sp.color}` }}
                />
              ))}
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
};

export default CyberMonkeyMechanic;
