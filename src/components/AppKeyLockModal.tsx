import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, Lock, Unlock, Eye, EyeOff, KeyRound, AlertTriangle, Sparkles, MessageSquare, Settings, Globe, Check, RefreshCw } from 'lucide-react';
import { saveAppSession } from '../utils/appSecurityClient';
import { getApiUrl, getBackendBaseUrl, setCustomBackendUrl, DEFAULT_PRODUCTION_BACKEND_URL } from '../utils/api';

interface AppKeyLockModalProps {
    onUnlocked: () => void;
}

export default function AppKeyLockModal({ onUnlocked }: AppKeyLockModalProps) {
    const [keyInput, setKeyInput] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isShaking, setIsShaking] = useState(false);
    const [, setIsConfigured] = useState<boolean | null>(null);
    const [showServerConfig, setShowServerConfig] = useState(false);
    const [serverUrlInput, setServerUrlInput] = useState(getBackendBaseUrl() || DEFAULT_PRODUCTION_BACKEND_URL);
    const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
    const inputRef = useRef<HTMLInputElement>(null);

    // Check configuration status & server health on mount
    useEffect(() => {
        const checkStatus = async () => {
            setServerStatus('checking');
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const targetUrl = getApiUrl('/api/app-key/status');
                const res = await fetch(targetUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
                const data = await res.json();
                if (data.ok) {
                    setIsConfigured(data.isConfigured);
                    setServerStatus('online');
                } else {
                    setServerStatus('offline');
                }
            } catch (e) {
                console.warn('[AppKeyLock] Status check error:', e);
                setServerStatus('offline');
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
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s for waking Render server

            const verifyUrl = getApiUrl('/api/app-key/verify');
            const res = await fetch(verifyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: trimmed }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const data = await res.json();

            if (data.success && data.token) {
                setServerStatus('online');
                saveAppSession(data.token);
                onUnlocked();
            } else {
                setErrorMsg(data.message || 'Galat App Key! Access Denied ❌');
                triggerShake();
            }
        } catch (err: any) {
            console.error('[AppKeyLock] Verify network error:', err);
            setServerStatus('offline');
            setErrorMsg('Server connect karne me error. Agar Render server sleep mode me hai toh 15-20 second baad punah prayas karein.');
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

    const handleSaveServerUrl = () => {
        setCustomBackendUrl(serverUrlInput.trim());
        setShowServerConfig(false);
        setErrorMsg(null);
        // Retest connection
        fetch(getApiUrl('/api/app-key/status'))
            .then((r) => r.json())
            .then((d) => setServerStatus(d.ok ? 'online' : 'offline'))
            .catch(() => setServerStatus('offline'));
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.slice(0, 10);
        setKeyInput(val);
        if (errorMsg) setErrorMsg(null);
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-[#070b19]/95 backdrop-blur-2xl flex items-center justify-center p-4 select-none overflow-y-auto">
            {/* Background glowing ambient orbs */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none animate-pulse" />

            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={isShaking ? { x: [-10, 10, -8, 8, -4, 4, 0], scale: 1, opacity: 1, y: 0 } : { scale: 1, opacity: 1, y: 0 }}
                transition={{ duration: isShaking ? 0.5 : 0.3 }}
                className="relative w-full max-w-md bg-[#0c122b]/90 border border-cyan-500/30 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.25)] flex flex-col items-center gap-4 overflow-hidden"
            >
                {/* Top Header & Server Online/Offline Indicator */}
                <div className="w-full flex items-center justify-between">
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold tracking-wide shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                        <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Friday Security Shield</span>
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowServerConfig(!showServerConfig)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                            serverStatus === 'online'
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                : serverStatus === 'checking'
                                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 animate-pulse'
                                : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                        }`}
                        title="Click to view/change Server URL"
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${serverStatus === 'online' ? 'bg-emerald-400' : serverStatus === 'checking' ? 'bg-amber-400' : 'bg-rose-400'}`} />
                        <span>{serverStatus === 'online' ? 'Server Online' : serverStatus === 'checking' ? 'Connecting...' : 'Server Offline'}</span>
                        <Settings className="w-3 h-3 ml-0.5 opacity-70" />
                    </button>
                </div>

                {/* Server URL Config Accordion (if toggled or offline) */}
                <AnimatePresence>
                    {showServerConfig && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="w-full p-3 rounded-2xl bg-slate-900/90 border border-cyan-500/30 flex flex-col gap-2 text-xs"
                        >
                            <div className="flex items-center justify-between text-slate-300 font-semibold">
                                <div className="flex items-center gap-1.5 text-cyan-400">
                                    <Globe className="w-3.5 h-3.5" />
                                    <span>Backend Server URL:</span>
                                </div>
                                <button
                                    onClick={() => setServerUrlInput(DEFAULT_PRODUCTION_BACKEND_URL)}
                                    className="text-[10px] text-cyan-300 underline hover:text-cyan-200"
                                >
                                    Reset Default
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={serverUrlInput}
                                    onChange={(e) => setServerUrlInput(e.target.value)}
                                    placeholder="https://mera-ai-3496.onrender.com"
                                    className="flex-1 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-[11px] focus:border-cyan-400 outline-none"
                                />
                                <button
                                    onClick={handleSaveServerUrl}
                                    className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold flex items-center gap-1"
                                >
                                    <Check className="w-3 h-3" />
                                    <span>Save</span>
                                </button>
                            </div>
                            <p className="text-[10px] text-slate-400 leading-tight">
                                APK mobile app me server connect karne ke liye Render live URL zaroori hai.
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Animated Security Lock Icon */}
                <div className="relative my-0.5">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-blue-600/20 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.35)] relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                        <Lock className="w-7 h-7 text-cyan-400 drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
                    </div>
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500/90 border-2 border-[#0c122b] flex items-center justify-center">
                        <KeyRound className="w-2 h-2 text-white" />
                    </span>
                </div>

                {/* Title & Description */}
                <div className="text-center space-y-1">
                    <h2 className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center justify-center gap-2">
                        <span>Enter Your Key</span>
                        <Sparkles className="w-4 h-4 text-cyan-400" />
                    </h2>
                    <p className="text-xs text-slate-400 max-w-xs">
                        Kripya application unlock karne ke liye apna <b>App Access Key</b> enter karein.
                    </p>
                </div>

                {/* Form Field with Auto-detect Length & Max 10 Limit */}
                <form onSubmit={handleVerify} className="w-full space-y-3">
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
                                className="w-full pl-4 pr-20 py-3 rounded-2xl bg-slate-900/90 border border-cyan-500/40 text-white font-mono text-base sm:text-lg tracking-widest placeholder:text-slate-600 placeholder:text-xs placeholder:font-sans focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 transition-all shadow-inner"
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
                                <div className="flex-1 font-medium">{errorMsg}</div>
                                {serverStatus === 'offline' && (
                                    <button
                                        type="button"
                                        onClick={() => setShowServerConfig(true)}
                                        className="p-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[10px] font-bold flex items-center gap-1"
                                    >
                                        <RefreshCw className="w-3 h-3" />
                                        <span>Fix</span>
                                    </button>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Unlock / Enter Button */}
                    <button
                        type="submit"
                        disabled={loading || keyInput.length === 0}
                        className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-sm tracking-wide transition-all shadow-[0_0_25px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
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

                {/* Owner Key & Unblock Guide (WhatsApp / Telegram) */}
                <div className="w-full p-2.5 rounded-2xl bg-slate-900/60 border border-white/5 flex flex-col gap-1 text-[11px] text-slate-400">
                    <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Owner Security Commands (WhatsApp / Telegram):</span>
                    </div>
                    <p className="leading-relaxed text-[10px]">
                        Owner WhatsApp ya Telegram se key change aur block hone par IP unblock kar sakte hain:
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                        <code className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px] border border-cyan-500/20">
                            app key 123456
                        </code>
                        <code className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 font-mono text-[10px] border border-emerald-500/20">
                            unblock all
                        </code>
                        <code className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 font-mono text-[10px] border border-emerald-500/20">
                            unblock &lt;IP&gt;
                        </code>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
