import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Phone, PhoneOff, PhoneCall, Mic, Volume2, ShieldCheck, Sparkles } from 'lucide-react';
import AgentFace from './AgentFace';

interface IncomingCallScreenProps {
    callerName?: string;
    onAccept: () => void;
    onDecline: () => void;
}

export default function IncomingCallScreen({
    callerName = 'FRIDAY AI',
    onAccept,
    onDecline,
}: IncomingCallScreenProps) {
    const [ringCount, setRingCount] = useState(0);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const ringIntervalRef = useRef<any>(null);

    // ── High-Tech Futuristic Polyphonic Ringtone Synthesizer (Web Audio API) ──
    const playPhoneRing = () => {
        try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;

            if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
                audioCtxRef.current = new AudioCtx();
            }

            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }

            const now = ctx.currentTime;

            // Harmonized Chimes: 852Hz & 1046Hz (Classic Marimba/Sci-Fi Ringtone)
            const frequencies = [852, 1046, 1280];
            frequencies.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.1);

                gain.gain.setValueAtTime(0.001, now + idx * 0.1);
                gain.gain.exponentialRampToValueAtTime(0.25, now + idx * 0.1 + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.1 + 0.6);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(now + idx * 0.1);
                osc.stop(now + idx * 0.1 + 0.65);
            });

            // Second pulse in the double-ring sequence (after 0.8s)
            frequencies.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq * 1.05, now + 0.7 + idx * 0.1);

                gain.gain.setValueAtTime(0.001, now + 0.7 + idx * 0.1);
                gain.gain.exponentialRampToValueAtTime(0.28, now + 0.7 + idx * 0.1 + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7 + idx * 0.1 + 0.7);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(now + 0.7 + idx * 0.1);
                osc.stop(now + 0.7 + idx * 0.1 + 0.75);
            });

            // Phone Vibration Pattern
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate([400, 200, 400, 200, 800]);
            }
        } catch (e) {
            console.warn('[IncomingCallScreen] Ringtone audio notice:', e);
        }
    };

    useEffect(() => {
        // Play ring immediately
        playPhoneRing();
        setRingCount((c) => c + 1);

        // Repeat every 2.8 seconds
        ringIntervalRef.current = setInterval(() => {
            playPhoneRing();
            setRingCount((c) => c + 1);
        }, 2800);

        return () => {
            if (ringIntervalRef.current) {
                clearInterval(ringIntervalRef.current);
                ringIntervalRef.current = null;
            }
            if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
                try {
                    audioCtxRef.current.close();
                } catch {}
            }
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(0);
            }
        };
    }, []);

    const handleAccept = () => {
        if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(0);
        onAccept();
    };

    const handleDecline = () => {
        if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(0);
        onDecline();
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-[#050814] flex flex-col items-center justify-between p-6 sm:p-10 select-none overflow-hidden text-white font-sans">
            {/* Background Cyber Glow & Animated Pulsing Waves */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-center justify-center">
                <div className="absolute w-[500px] h-[500px] rounded-full bg-cyan-500/10 blur-[120px] animate-pulse" />
                <div className="absolute w-[350px] h-[350px] rounded-full bg-blue-600/15 blur-[90px]" />

                {/* Animated concentric call waves */}
                {[0, 1, 2].map((i) => (
                    <motion.div
                        key={i}
                        initial={{ scale: 0.8, opacity: 0.6 }}
                        animate={{ scale: [1, 2.2, 3], opacity: [0.6, 0.2, 0] }}
                        transition={{
                            duration: 2.8,
                            repeat: Infinity,
                            delay: i * 0.9,
                            ease: 'easeOut',
                        }}
                        className="absolute w-44 h-44 rounded-full border border-cyan-400/30"
                    />
                ))}
            </div>

            {/* Top Header Badge */}
            <div className="relative z-10 flex flex-col items-center gap-2 pt-6">
                <motion.div
                    initial={{ y: -20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-xs text-cyan-300 shadow-[0_0_25px_rgba(6,182,212,0.3)] backdrop-blur-md"
                >
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                    <span className="font-semibold tracking-wide uppercase">Incoming Voice Call</span>
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 ml-1" />
                </motion.div>
                <p className="text-[11px] text-slate-400 font-mono">0-Latency Encrypted WebRTC Stream</p>
            </div>

            {/* Center Caller Hologram & Name */}
            <div className="relative z-10 flex flex-col items-center gap-5 my-auto">
                <motion.div
                    animate={{ scale: [1, 1.04, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                    className="relative cursor-pointer"
                >
                    <div className="p-4 rounded-full bg-gradient-to-b from-cyan-500/20 to-blue-600/10 border border-cyan-400/40 shadow-[0_0_50px_rgba(6,182,212,0.35)] backdrop-blur-lg">
                        <AgentFace status="Connecting AI..." volume={0.6} size={150} colorIndex={0} />
                    </div>
                </motion.div>

                <div className="text-center space-y-1">
                    <motion.h1
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center justify-center gap-2"
                    >
                        <span>🤖</span>
                        <span>{callerName}</span>
                    </motion.h1>
                    <p className="text-sm text-cyan-400/90 font-medium animate-pulse flex items-center justify-center gap-1.5">
                        <Volume2 className="w-4 h-4" />
                        <span>Ringing (Call #{ringCount})...</span>
                    </p>
                    <p className="text-xs text-slate-400 max-w-xs mx-auto">
                        Friday is calling you for live conversational assistance.
                    </p>
                </div>
            </div>

            {/* Bottom Call Controls (Decline & Accept Buttons) */}
            <div className="relative z-10 w-full max-w-sm pb-8 flex flex-col items-center gap-6">
                <div className="w-full flex items-center justify-around px-4">
                    {/* 🔴 Decline Button */}
                    <div className="flex flex-col items-center gap-2">
                        <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={handleDecline}
                            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-tr from-red-600 to-rose-500 text-white flex items-center justify-center shadow-[0_0_35px_rgba(239,68,68,0.5)] border border-red-400/50 cursor-pointer active:scale-95 transition-transform"
                            title="Decline Call"
                        >
                            <PhoneOff className="w-7 h-7 sm:w-9 sm:h-9" />
                        </motion.button>
                        <span className="text-xs font-semibold text-red-300">Decline</span>
                    </div>

                    {/* 🟢 Accept Button */}
                    <div className="flex flex-col items-center gap-2">
                        <motion.button
                            whileHover={{ scale: 1.15 }}
                            whileTap={{ scale: 0.9 }}
                            animate={{ scale: [1, 1.08, 1], rotate: [0, -3, 3, 0] }}
                            transition={{ duration: 1.2, repeat: Infinity }}
                            onClick={handleAccept}
                            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-tr from-emerald-500 via-teal-400 to-cyan-400 text-slate-950 flex items-center justify-center shadow-[0_0_45px_rgba(16,185,129,0.7)] border-2 border-white/60 cursor-pointer active:scale-95 transition-transform font-bold"
                            title="Accept & Talk"
                        >
                            <Phone className="w-7 h-7 sm:w-9 sm:h-9 text-slate-950" />
                        </motion.button>
                        <span className="text-xs font-bold text-emerald-400 tracking-wide">Swipe to Answer</span>
                    </div>
                </div>

                {/* Subtitle helper */}
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5 font-mono">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Powered by Gemini Live Neural Voice</span>
                </div>
            </div>
        </div>
    );
}
