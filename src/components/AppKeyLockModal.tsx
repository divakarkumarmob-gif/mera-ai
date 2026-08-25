import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, Lock, Unlock, Eye, EyeOff, KeyRound, AlertTriangle, Sparkles, MessageSquare, Send } from 'lucide-react';
import { saveAppSession } from '../utils/appSecurityClient';

interface AppKeyLockModalProps {
    onUnlocked: () => void;
}

export default function AppKeyLockModal({ onUnlocked }: AppKeyLockModalProps) {
    const [keyInput, setKeyInput] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isShaking, setIsShaking] = useState(false);
    const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Check configuration status on mount
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const res = await fetch('/api/app-key/status');
                const data = await res.json();
                if (data.ok) {
                    setIsConfigured(data.isConfigured);
                }
            } catch (e) {
                console.warn('[AppKeyLock] Status check error:', e);
            }
        };
        checkStatus();
        setTimeout(() => inputRef.current?.focus(), 250);
    }, []);

    const handleVerify = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const trimmed = keyInput.trim();
        if (!trimmed) {
            setErrorMsg('Kripya App Access Key enter karein.');
            triggerShake();
            return;
        }

        setLoading(true);
        setErrorMsg(null);

        try {
            const res = await fetch('/api/app-key/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: trimmed }),
            });
            const data = await res.json();

            if (data.success && data.token) {
                // Save cryptographically signed unlock session
                saveAppSession(data.token);
                onUnlocked();
            } else {
                setErrorMsg(data.message || 'Galat App Key! Access Denied ❌');
                triggerShake();
            }
        } catch (err: any) {
            setErrorMsg('Server connect karne me error. Kripya punah prayas karein.');
            triggerShake();
        } finally {
            setLoading(false);
        }
    };

    const triggerShake = () => {
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 600);
        inputRef.current?.focus();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Enforce max 10 characters limit
        const val = e.target.value.slice(0, 10);
        setKeyInput(val);
        if (errorMsg) setErrorMsg(null);
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-[#070b19]/95 backdrop-blur-2xl flex items-center justify-center p-4 select-none">
            {/* Background glowing ambient orbs */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none animate-pulse" />

            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={isShaking ? { x: [-10, 10, -8, 8, -4, 4, 0], scale: 1, opacity: 1, y: 0 } : { scale: 1, opacity: 1, y: 0 }}
                transition={{ duration: isShaking ? 0.5 : 0.3 }}
                className="relative w-full max-w-md bg-[#0c122b]/90 border border-cyan-500/30 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.25)] flex flex-col items-center gap-5 overflow-hidden"
            >
                {/* Top Glowing Header Badge */}
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold tracking-wide shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Friday App Security Shield</span>
                </div>

                {/* Animated Security Lock Icon */}
                <div className="relative my-1">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-blue-600/20 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.35)] relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                        <Lock className="w-9 h-9 text-cyan-400 drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
                    </div>
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500/90 border-2 border-[#0c122b] flex items-center justify-center">
                        <KeyRound className="w-2.5 h-2.5 text-white" />
                    </span>
                </div>

                {/* Title & Description */}
                <div className="text-center space-y-1">
                    <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center justify-center gap-2">
                        <span>Enter Your Key</span>
                        <Sparkles className="w-4 h-4 text-cyan-400" />
                    </h2>
                    <p className="text-xs text-slate-400 max-w-xs">
                        Kripya application unlock karne ke liye apna <b>App Access Key</b> enter karein.
                    </p>
                </div>

                {/* Form Field with Auto-detect Length & Max 10 Limit */}
                <form onSubmit={handleVerify} className="w-full space-y-4">
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between px-1">
                            <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                                App Access Key
                            </label>
                            <span
                                className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full ${
                                    keyInput.length >= 3
                                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                        : 'bg-slate-800 text-slate-400'
                                }`}
                            >
                                {keyInput.length} / 10 Digits
                            </span>
                        </div>

                        <div className="relative flex items-center">
                            <input
                                ref={inputRef}
                                type={showKey ? 'text' : 'password'}
                                value={keyInput}
                                onChange={handleInputChange}
                                maxLength={10}
                                placeholder="Enter 3-10 digit key..."
                                autoFocus
                                autoComplete="off"
                                className="w-full pl-4 pr-20 py-3.5 rounded-2xl bg-slate-900/90 border border-cyan-500/40 text-white font-mono text-base sm:text-lg tracking-widest placeholder:text-slate-600 placeholder:text-xs placeholder:font-sans focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 transition-all shadow-inner"
                            />

                            <div className="absolute right-3 flex items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setShowKey(!showKey)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
                                    title={showKey ? 'Hide key' : 'Show key'}
                                >
                                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Error Notice */}
                    <AnimatePresence>
                        {errorMsg && (
                            <motion.div
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -5 }}
                                className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2"
                            >
                                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                                <span className="font-medium">{errorMsg}</span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Unlock / Enter Button */}
                    <button
                        type="submit"
                        disabled={loading || keyInput.length === 0}
                        className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-sm tracking-wide transition-all shadow-[0_0_25px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
                    >
                        {loading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                <Unlock className="w-4 h-4" />
                                <span>Unlock App / Enter</span>
                            </>
                        )}
                    </button>
                </form>

                {/* Owner Key Guide (WhatsApp / Telegram) */}
                <div className="w-full p-3 rounded-2xl bg-slate-900/60 border border-white/5 flex flex-col gap-1.5 text-[11px] text-slate-400">
                    <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Owner Access Key Commands:</span>
                    </div>
                    <p className="leading-relaxed">
                        App Key sirf <b>WhatsApp Owner</b> ya <b>Telegram Owner</b> change/create kar sakte hain.
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                        <code className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px] border border-cyan-500/20">
                            app key - 123456
                        </code>
                        <code className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px] border border-cyan-500/20">
                            app pass 987654
                        </code>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
