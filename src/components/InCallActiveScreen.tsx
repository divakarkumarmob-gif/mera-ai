import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
    Mic,
    MicOff,
    Volume2,
    VolumeX,
    PhoneOff,
    Grid,
    ShieldCheck,
    Sparkles,
    Radio,
    Clock,
    Activity,
    Lock
} from 'lucide-react';
import AgentFace from './AgentFace';

interface InCallActiveScreenProps {
    callerName?: string;
    onEndCall: (durationSecs: number) => void;
    isMicMuted: boolean;
    onToggleMute: () => void;
    volume: number; // 0 to 1 audio volume from AI speaker
    statusText?: string;
    aiTranscript?: string;
}

// Standard DTMF Tone Frequencies for realistic dialer beeps
const DTMF_FREQS: Record<string, [number, number]> = {
    '1': [697, 1209],
    '2': [697, 1336],
    '3': [697, 1477],
    '4': [770, 1209],
    '5': [770, 1336],
    '6': [770, 1477],
    '7': [852, 1209],
    '8': [852, 1336],
    '9': [852, 1477],
    '*': [941, 1209],
    '0': [941, 1336],
    '#': [941, 1477],
};

export default function InCallActiveScreen({
    callerName = 'FRIDAY AI',
    onEndCall,
    isMicMuted,
    onToggleMute,
    volume,
    statusText = 'Connected • HD Encrypted Voice',
    aiTranscript,
}: InCallActiveScreenProps) {
    const [secondsElapsed, setSecondsElapsed] = useState(0);
    const [isSpeakerOn, setIsSpeakerOn] = useState(true);
    const [showKeypad, setShowKeypad] = useState(false);
    const [dialedDigits, setDialedDigits] = useState('');
    const [isEnding, setIsEnding] = useState(false);
    const [isProximityDark, setIsProximityDark] = useState(false);

    const audioCtxRef = useRef<AudioContext | null>(null);

    // ── Live Stopwatch Timer ──────────────────────────────────────────────────
    useEffect(() => {
        const timer = setInterval(() => {
            setSecondsElapsed((prev) => prev + 1);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Format seconds into MM:SS or HH:MM:SS
    const formatTime = (totalSecs: number) => {
        const hrs = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;
        if (hrs > 0) {
            return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // ── Play DTMF Tone on Dialpad Press ───────────────────────────────────────
    const playDtmfTone = (digit: string) => {
        try {
            const freqs = DTMF_FREQS[digit];
            if (!freqs) return;

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
            const duration = 0.16;

            freqs.forEach((freq) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now);

                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(now);
                osc.stop(now + duration + 0.05);
            });

            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(25);
            }
        } catch (err) {
            console.warn('[DTMF] Audio playback notice:', err);
        }
    };

    // ── Realistic Call Disconnect Busy Tone (3-pulse 425Hz beep) ───────────────
    const playDisconnectToneAndEnd = () => {
        if (isEnding) return;
        setIsEnding(true);

        try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioCtx) {
                const ctx = audioCtxRef.current || new AudioCtx();
                const now = ctx.currentTime;

                // 3 pulses of 425Hz tone with 0.15s duration and 0.15s pause
                [0, 0.3, 0.6].forEach((offset) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(425, now + offset);

                    gain.gain.setValueAtTime(0.001, now + offset);
                    gain.gain.linearRampToValueAtTime(0.18, now + offset + 0.02);
                    gain.gain.setValueAtTime(0.18, now + offset + 0.14);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);

                    osc.connect(gain);
                    gain.connect(ctx.destination);

                    osc.start(now + offset);
                    osc.stop(now + offset + 0.2);
                });
            }
        } catch (e) {
            console.warn('[CallDisconnect] Tone playback error:', e);
        }

        // Trigger end call after disconnect tone
        setTimeout(() => {
            onEndCall(secondsElapsed);
        }, 900);
    };

    // ── Proximity Sensor Support (Screen Dims when near face) ──────────────────
    useEffect(() => {
        if (typeof window !== 'undefined' && 'onuserproximity' in window) {
            const handleProximity = (event: any) => {
                setIsProximityDark(event.near);
            };
            window.addEventListener('userproximity', handleProximity);
            return () => window.removeEventListener('userproximity', handleProximity);
        }
    }, []);

    if (isProximityDark) {
        return <div className="fixed inset-0 bg-black z-[99999]" />;
    }

    return (
        <div className="fixed inset-0 z-[9999] bg-[#050713] flex flex-col justify-between p-5 sm:p-8 select-none text-white font-sans overflow-hidden">
            {/* Ambient Background Aura */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-center justify-center">
                <div
                    className="absolute w-[450px] h-[450px] rounded-full bg-cyan-500/10 blur-[130px] transition-all duration-700"
                    style={{ transform: `scale(${1 + volume * 0.4})` }}
                />
                <div className="absolute w-[300px] h-[300px] rounded-full bg-blue-600/10 blur-[100px]" />
            </div>

            {/* Top Status & Live Timer Bar */}
            <div className="relative z-10 flex flex-col items-center gap-1.5 pt-4">
                <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.25)] backdrop-blur-md">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-semibold tracking-wider font-mono uppercase">{formatTime(secondsElapsed)}</span>
                    <span className="text-emerald-500/60">•</span>
                    <span className="text-[11px] font-medium text-emerald-200">HD Voice Encrypted</span>
                </div>

                <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                    <Lock className="w-3 h-3 text-cyan-400/80" />
                    <span>0-Latency Duplex • Neural AI Voice</span>
                </div>
            </div>

            {/* Center Area: Animated AI Face & Caller Hologram */}
            <div className="relative z-10 flex flex-col items-center gap-4 my-auto">
                <motion.div
                    animate={{ scale: [1, 1 + volume * 0.08, 1] }}
                    transition={{ duration: 0.3 }}
                    className="relative cursor-pointer"
                >
                    <div className="p-4 rounded-full bg-gradient-to-b from-cyan-500/20 via-blue-900/20 to-slate-950/80 border border-cyan-400/40 shadow-[0_0_60px_rgba(6,182,212,0.35)] backdrop-blur-xl">
                        <AgentFace status="" volume={volume} size={140} colorIndex={0} />
                    </div>

                    {/* Glowing audio waveform ring */}
                    {volume > 0.05 && (
                        <div className="absolute inset-0 rounded-full border border-cyan-400/60 animate-ping pointer-events-none" />
                    )}
                </motion.div>

                <div className="text-center space-y-1">
                    <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center justify-center gap-2">
                        <span>{callerName}</span>
                    </h2>

                    <p className="text-xs text-cyan-400/90 font-medium flex items-center justify-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 animate-pulse" />
                        <span>{statusText}</span>
                    </p>

                    {/* Mute Warning Banner */}
                    {isMicMuted && (
                        <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-[11px] text-rose-300 animate-pulse mt-1">
                            <MicOff className="w-3 h-3" />
                            <span>Microphone Muted</span>
                        </div>
                    )}
                </div>

                {/* Realtime Live Speech Caption Preview */}
                {aiTranscript && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-xs sm:max-w-sm px-4 py-2.5 rounded-2xl bg-slate-900/80 border border-white/10 text-xs text-slate-200 text-center leading-relaxed shadow-lg backdrop-blur-md line-clamp-3"
                    >
                        <span className="text-cyan-400 font-semibold mr-1">Friday:</span>
                        <span>"{aiTranscript}"</span>
                    </motion.div>
                )}
            </div>

            {/* Keypad Modal Overlay (if opened) */}
            <AnimatePresence>
                {showKeypad && (
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 50 }}
                        className="relative z-20 w-full max-w-xs mx-auto mb-4 p-5 rounded-3xl bg-slate-950/95 border border-cyan-500/30 shadow-[0_0_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl flex flex-col items-center gap-4"
                    >
                        <div className="w-full flex items-center justify-between border-b border-white/10 pb-2">
                            <span className="text-xs font-mono text-cyan-300 tracking-wider">DIALPAD</span>
                            <span className="text-base font-bold text-white tracking-widest min-h-[24px]">
                                {dialedDigits || '• • •'}
                            </span>
                            <button
                                onClick={() => setShowKeypad(false)}
                                className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded bg-white/5"
                            >
                                Close
                            </button>
                        </div>

                        <div className="grid grid-cols-3 gap-3 w-full">
                            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((d) => (
                                <button
                                    key={d}
                                    onClick={() => {
                                        playDtmfTone(d);
                                        setDialedDigits((prev) => (prev + d).slice(-12));
                                    }}
                                    className="h-12 rounded-2xl bg-slate-900/90 hover:bg-cyan-950/50 active:bg-cyan-500 active:text-black border border-white/10 text-lg font-bold text-slate-100 flex items-center justify-center transition-all shadow-sm"
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Bottom In-Call Action Controls Grid */}
            <div className="relative z-10 w-full max-w-sm mx-auto pb-4 flex flex-col items-center gap-6">
                <div className="w-full grid grid-cols-3 gap-4 px-2">
                    {/* 1. Mute Button */}
                    <div className="flex flex-col items-center gap-1.5">
                        <button
                            onClick={onToggleMute}
                            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all border ${
                                isMicMuted
                                    ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.3)]'
                                    : 'bg-slate-900/80 hover:bg-slate-800 border-white/10 text-slate-200'
                            }`}
                        >
                            {isMicMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                        </button>
                        <span className="text-[11px] text-slate-400 font-medium">
                            {isMicMuted ? 'Unmute' : 'Mute'}
                        </span>
                    </div>

                    {/* 2. Keypad Toggle */}
                    <div className="flex flex-col items-center gap-1.5">
                        <button
                            onClick={() => setShowKeypad(!showKeypad)}
                            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all border ${
                                showKeypad
                                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.3)]'
                                    : 'bg-slate-900/80 hover:bg-slate-800 border-white/10 text-slate-200'
                            }`}
                        >
                            <Grid className="w-6 h-6" />
                        </button>
                        <span className="text-[11px] text-slate-400 font-medium">Keypad</span>
                    </div>

                    {/* 3. Speaker Toggle */}
                    <div className="flex flex-col items-center gap-1.5">
                        <button
                            onClick={() => setIsSpeakerOn(!isSpeakerOn)}
                            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all border ${
                                isSpeakerOn
                                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                                    : 'bg-slate-900/80 hover:bg-slate-800 border-white/10 text-slate-400'
                            }`}
                        >
                            {isSpeakerOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                        </button>
                        <span className="text-[11px] text-slate-400 font-medium">
                            {isSpeakerOn ? 'Speaker' : 'Earpiece'}
                        </span>
                    </div>
                </div>

                {/* 🔴 Big Red End Call Button */}
                <div className="flex flex-col items-center gap-2">
                    <motion.button
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.92 }}
                        onClick={playDisconnectToneAndEnd}
                        disabled={isEnding}
                        className="w-18 h-18 sm:w-20 sm:h-20 rounded-full bg-gradient-to-tr from-red-600 via-rose-600 to-red-500 text-white flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.6)] border-2 border-red-400/60 cursor-pointer active:scale-95 transition-all disabled:opacity-50"
                        title="End Call"
                    >
                        <PhoneOff className="w-8 h-8 sm:w-9 sm:h-9" />
                    </motion.button>
                    <span className="text-xs font-semibold text-red-300 tracking-wide">
                        {isEnding ? 'Disconnecting...' : 'End Call'}
                    </span>
                </div>
            </div>
        </div>
    );
}
