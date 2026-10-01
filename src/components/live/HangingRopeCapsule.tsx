import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';

export interface HangingRopeCapsuleProps {
    ropeHeight?: number;
    swayIndex?: number;
    ropeColor?: string;
    glowColor?: string;
    rowTier?: 'upper' | 'lower';
    children: React.ReactNode;
}

// ── Suspended Aerial Rope Capsule Component with Meteor Impact Fracture & 5s Nano-Repair ──
export function HangingRopeCapsule({
    ropeHeight = 36,
    swayIndex = 0,
    ropeColor = 'from-amber-400/90 via-amber-300 to-amber-500/90',
    glowColor = 'rgba(251,191,36,0.4)',
    rowTier = 'upper',
    children,
}: HangingRopeCapsuleProps) {
    // Stagger natural sway frequency and angle so each capsule sways naturally in the air
    const delay = (swayIndex * 0.28) % 2.4;
    const duration = 3.6 + (swayIndex % 3) * 0.4;
    const maxAngle = 1.3 + (swayIndex % 2) * 0.5;

    const [isCracked, setIsCracked] = useState(false);
    const [healProgress, setHealProgress] = useState(0); // 0.0 to 1.0 continuous healing
    const healAnimFrameRef = useRef<number | null>(null);
    const capsuleRef = useRef<HTMLDivElement>(null);

    const playGlassCrackSound = useCallback(() => {
        try {
            if (typeof window !== 'undefined' && (window as any).__FRIDAY_SFX_MUTED__ !== false) return;
            const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtxClass) return;
            const ctx = new AudioCtxClass();
            if (ctx.state === 'suspended') ctx.resume();

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(3400, now);
            osc.frequency.exponentialRampToValueAtTime(400, now + 0.12);

            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.15);
        } catch {}
    }, []);

    const triggerCrack = useCallback(() => {
        setIsCracked(true);
        setHealProgress(0);
        playGlassCrackSound();
        if (healAnimFrameRef.current) cancelAnimationFrame(healAnimFrameRef.current);
    }, [playGlassCrackSound]);

    const startMonkeyRepair = useCallback(() => {
        if (healAnimFrameRef.current) cancelAnimationFrame(healAnimFrameRef.current);

        const startTime = performance.now();
        const animDuration = 5000; // 5.0 seconds monkey repair duration

        const step = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(1, elapsed / animDuration);
            setHealProgress(progress);

            if (progress < 1) {
                healAnimFrameRef.current = requestAnimationFrame(step);
            } else {
                setIsCracked(false);
                setHealProgress(0);
            }
        };

        healAnimFrameRef.current = requestAnimationFrame(step);
    }, []);

    useEffect(() => {
        const el = capsuleRef.current;
        if (!el) return;

        const handleHit = () => {
            triggerCrack();
        };

        const handleRepair = () => {
            startMonkeyRepair();
        };

        el.addEventListener('capsule_crack_hit', handleHit);
        el.addEventListener('monkey_repair_start', handleRepair);
        return () => {
            el.removeEventListener('capsule_crack_hit', handleHit);
            el.removeEventListener('monkey_repair_start', handleRepair);
            if (healAnimFrameRef.current) cancelAnimationFrame(healAnimFrameRef.current);
        };
    }, [triggerCrack, startMonkeyRepair]);

    return (
        <motion.div
            ref={capsuleRef}
            data-hanging-capsule="true"
            data-capsule-row={rowTier}
            className="relative flex flex-col items-center shrink-0 group/hanging select-none pt-7"
            initial={{ opacity: 1 }}
            animate={
                isCracked
                    ? {
                          opacity: 1,
                          x: [-7, 7, -5, 5, -2, 2, 0],
                          y: [-3, 3, -1, 1, 0],
                          rotate: [-3.5, 3.5, -2, 2, 0],
                          scale: [0.95, 1.05, 0.98, 1],
                      }
                    : {
                          opacity: 1,
                          rotate: [-maxAngle, maxAngle, -maxAngle],
                          y: [0, -3, 0],
                      }
            }
            transition={
                isCracked
                    ? { duration: 0.5, ease: 'easeOut' }
                    : {
                          duration,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay,
                      }
            }
            whileHover={{
                scale: 1.06,
                rotate: [0, -2.5, 2.5, 0],
                transition: { duration: 0.35 },
            }}
            style={{ transformOrigin: 'top center' }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                triggerCrack();
            }}
        >
            {/* ── Solid Continuous Glowing Rope extending from the top ceiling straight down to the capsule ── */}
            <div
                className="absolute left-1/2 -translate-x-1/2 pointer-events-none z-0"
                style={{
                    bottom: 'calc(100% - 10px)',
                    top: '-150vh',
                    width: '2.5px',
                }}
            >
                {/* Main Braided Cable */}
                <div
                    className={`w-full h-full bg-gradient-to-b ${ropeColor}`}
                    style={{
                        backgroundImage: `repeating-linear-gradient(45deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 2.5px, rgba(255,255,255,0.3) 2.5px, rgba(255,255,255,0.3) 5px)`,
                    }}
                />
                {/* Full Neon Radiance Glow — NO clipping or fading */}
                <div
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{
                        boxShadow: isCracked
                            ? `0 0 12px 3px rgba(239,68,68,0.7), 0 0 20px 6px rgba(245,158,11,0.5)`
                            : `0 0 8px 2px ${glowColor}, 0 0 16px 4px ${glowColor}`,
                    }}
                />
            </div>

            {/* Glowing Attachment Node right on top of the capsule */}
            <div className="relative z-10 flex flex-col items-center -mb-1">
                <div
                    className="w-2.5 h-2.5 rounded-full bg-slate-950 border-[1.5px] flex items-center justify-center pointer-events-none transition-colors duration-300 shadow-[0_0_10px_rgba(255,255,255,0.4)]"
                    style={{
                        borderColor: isCracked ? (healProgress > 0.5 ? '#10b981' : '#ef4444') : glowColor,
                        boxShadow: isCracked ? (healProgress > 0.5 ? `0 0 12px #10b981` : `0 0 12px #ef4444`) : `0 0 10px ${glowColor}`,
                    }}
                >
                    <div className={`w-1 h-1 rounded-full ${isCracked && healProgress < 0.6 ? 'bg-red-400' : 'bg-white'} animate-pulse`} />
                </div>
            </div>

            {/* The Suspended Capsule Button with Dynamic Progressive Crack Overlay */}
            <div className="relative z-20">
                {/* Fiery warning aura when cracked (smoothly fades away over 5s) */}
                {isCracked && (
                    <div
                        className="absolute -inset-1 rounded-full bg-gradient-to-r from-red-600 via-amber-500 to-orange-600 blur-sm pointer-events-none transition-opacity duration-300"
                        style={{ opacity: Math.max(0, 0.9 * (1 - healProgress)) }}
                    />
                )}

                {children}

                {/* 💥 Center Glass-Fracture Crack Overlay (Progressively heals over 5s) */}
                {isCracked && (
                    <div
                        className="absolute inset-0 pointer-events-none z-30 overflow-hidden rounded-full flex items-center justify-center transition-opacity duration-300"
                        style={{ opacity: Math.max(0, 1 - healProgress) }}
                    >
                        <svg className="w-full h-full absolute inset-0" viewBox="0 0 140 36" preserveAspectRatio="none">
                            {/* Outer glowing fissure outline - narrows and shifts color from red to emerald */}
                            <path
                                d="M 70 0 L 64 9 L 76 17 L 63 25 L 74 32 L 70 36"
                                fill="none"
                                stroke={healProgress > 0.4 ? '#10b981' : '#ff2200'}
                                strokeWidth={Math.max(0.8, 4.2 * (1 - healProgress * 0.75))}
                                strokeLinecap="round"
                                style={{
                                    filter: healProgress > 0.4 ? 'drop-shadow(0 0 5px #10b981)' : 'drop-shadow(0 0 6px #ff4500)',
                                    transition: 'stroke 0.4s ease',
                                }}
                            />
                            {/* Sharp white-hot molten core line */}
                            <path
                                d="M 70 0 L 64 9 L 76 17 L 63 25 L 74 32 L 70 36"
                                fill="none"
                                stroke="#ffffff"
                                strokeWidth={Math.max(0.4, 1.6 * (1 - healProgress * 0.75))}
                                strokeLinecap="round"
                            />
                            {/* Lateral branch micro-cracks (fades away by 55% progress) */}
                            {healProgress < 0.55 && (
                                <path
                                    d="M 64 9 L 52 13 M 63 25 L 50 22 M 76 17 L 88 14 M 74 32 L 86 34"
                                    fill="none"
                                    stroke="#fbbf24"
                                    strokeWidth={Math.max(0.4, 1.2 * (1 - healProgress * 1.5))}
                                    strokeLinecap="round"
                                    opacity={Math.max(0, 1 - healProgress * 1.8)}
                                />
                            )}
                        </svg>

                        {/* Hot glowing impact spark point */}
                        <div
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full animate-ping pointer-events-none"
                            style={{
                                width: `${Math.max(4, 16 * (1 - healProgress))}px`,
                                height: `${Math.max(4, 16 * (1 - healProgress))}px`,
                                backgroundColor: healProgress > 0.5 ? 'rgba(52, 211, 153, 0.8)' : 'rgba(251, 191, 36, 0.9)',
                            }}
                        />

                        {/* 5-Second Continuous Nano-Repair Welding Beam (Sweeps smoothly across the crack) */}
                        <motion.div
                            animate={{
                                x: ['-120%', '120%'],
                                opacity: [0.3, 0.9, 0.3],
                            }}
                            transition={{
                                repeat: Infinity,
                                duration: 1.1,
                                ease: 'easeInOut',
                            }}
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-300 to-transparent w-full h-full shadow-[0_0_20px_#10b981] pointer-events-none"
                        />
                    </div>
                )}
            </div>
        </motion.div>
    );
}

export default HangingRopeCapsule;
