import React, { useState, useEffect } from 'react';
import {
    Instagram,
    ShieldCheck,
    Sparkles,
    Key,
    Copy,
    EyeOff,
    Eye,
    Loader2,
    Trash2,
    RefreshCw,
    AlertCircle,
    Check,
} from 'lucide-react';

export function InstagramBotCard() {
    const [status, setStatus] = useState<{
        isLoggedIn: boolean;
        username: string | null;
        fullName: string | null;
        profilePicUrl?: string | null;
        totalMessagesProcessed: number;
        autoReplyEnabled: boolean;
        requiresTwoFactor?: boolean;
        lastError?: string | null;
        isEnvConfigured?: boolean;
    } | null>(null);

    const [sessionIdInput, setSessionIdInput] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [showChangeSession, setShowChangeSession] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

    const fetchStatus = async () => {
        try {
            const r = await fetch('/api/instagram/status');
            const d = await r.json();
            setStatus(d);
        } catch {}
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 8000);
        return () => clearInterval(interval);
    }, []);

    const handleConnectSessionId = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const cleanSession = sessionIdInput.trim();
        if (!cleanSession) {
            setFeedback({ type: 'error', message: 'Kripya valid Instagram Session ID enter karein.' });
            return;
        }

        setIsLoading(true);
        setFeedback({ type: 'info', message: 'Instagram session connect ho raha hai (Stealth & Proxy active)...' });

        try {
            const res = await fetch('/api/instagram/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: cleanSession }),
            });
            const data = await res.json();

            if (data.ok || data.success) {
                setFeedback({
                    type: 'success',
                    message: data.message || `Connected successfully as @${data.username || 'user'}!`,
                });
                setSessionIdInput('');
                setShowChangeSession(false);
                await fetchStatus();
            } else {
                setFeedback({
                    type: 'error',
                    message: data.error || data.message || 'Session ID login failed. Kripya check karein ki sessionid expired to nahi hai.',
                });
            }
        } catch (err: any) {
            setFeedback({ type: 'error', message: err?.message || 'Server error while connecting Instagram.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handlePurgeSessions = async () => {
        if (!window.confirm('Kya aap sach me sabhi purane Instagram sessions aur cookies delete karna chahte hain?')) {
            return;
        }

        setIsLoading(true);
        setFeedback({ type: 'info', message: 'Sessions & cache purge ho rahe hain...' });

        try {
            const res = await fetch('/api/instagram/purge-sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const data = await res.json();

            if (data.ok || data.success) {
                setFeedback({
                    type: 'success',
                    message: 'Sabhi purane sessions & storage delete ho gaye. Naya Session ID connect karein.',
                });
                setStatus(null);
                setShowChangeSession(false);
                await fetchStatus();
            } else {
                setFeedback({ type: 'error', message: data.error || 'Purge failed.' });
            }
        } catch (err: any) {
            setFeedback({ type: 'error', message: err?.message || 'Server error during purge.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleAutoReply = async () => {
        if (!status) return;
        setIsLoading(true);
        const nextState = !status.autoReplyEnabled;

        try {
            const res = await fetch('/api/instagram/toggle-autoreply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: nextState }),
            });
            const data = await res.json();
            if (data.ok || data.success) {
                setStatus((prev) => (prev ? { ...prev, autoReplyEnabled: nextState } : null));
                setFeedback({
                    type: 'success',
                    message: nextState ? 'Friday Auto-Reply chalu ho gaya!' : 'Friday Auto-Reply band kiya gaya.',
                });
            }
        } catch {
            setFeedback({ type: 'error', message: 'Auto-reply switch karne me error aaya.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogout = async () => {
        setIsLoading(true);
        try {
            await fetch('/api/instagram/logout', { method: 'POST' });
            setStatus(null);
            setFeedback({ type: 'info', message: 'Logged out successfully.' });
            await fetchStatus();
        } catch {
            setFeedback({ type: 'error', message: 'Logout failed.' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="pt-3 border-t border-white/10 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center p-0.5 shadow-md shadow-pink-500/20">
                        <Instagram className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-white font-bold text-sm">Instagram Direct Bot</span>
                            <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-300 border border-pink-500/30">
                                Stealth v2
                            </span>
                        </div>
                        <p className="text-[11px] text-slate-400">Friday AI Direct Message Auto-Responder</p>
                    </div>
                </div>

                {/* Status Badge */}
                {status?.isLoggedIn ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.2)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Connected
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-white/5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                        Not Connected
                    </span>
                )}
            </div>

            {/* Feedback notification banner */}
            {feedback && (
                <div
                    className={`p-2.5 rounded-xl text-xs flex items-start gap-2 border transition-all ${
                        feedback.type === 'success'
                            ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                            : feedback.type === 'error'
                            ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
                            : 'bg-blue-950/60 border-blue-500/40 text-blue-200'
                    }`}
                >
                    {feedback.type === 'success' && <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />}
                    {feedback.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />}
                    {feedback.type === 'info' && <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin text-blue-400" />}
                    <div className="flex-1 leading-snug">{feedback.message}</div>
                    <button
                        type="button"
                        onClick={() => setFeedback(null)}
                        className="text-slate-400 hover:text-white text-xs ml-1"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* If Logged In View */}
            {status?.isLoggedIn ? (
                <div className="p-3 rounded-2xl bg-gradient-to-b from-slate-900/90 to-purple-950/30 border border-purple-500/20 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            {status.profilePicUrl ? (
                                <img
                                    src={status.profilePicUrl}
                                    alt="Instagram Avatar"
                                    className="w-10 h-10 rounded-full border-2 border-pink-500/40 object-cover"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center font-bold text-white text-sm">
                                    {(status.username || 'IG')[0].toUpperCase()}
                                </div>
                            )}
                            <div>
                                <div className="font-bold text-white text-xs flex items-center gap-1.5">
                                    <span>@{status.username}</span>
                                    <ShieldCheck className="w-3.5 h-3.5 text-pink-400" />
                                </div>
                                <div className="text-[11px] text-slate-400">{status.fullName || 'Instagram Account'}</div>
                            </div>
                        </div>

                        {/* Logout & Change session actions */}
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setShowChangeSession(!showChangeSession)}
                                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-[11px] border border-white/10 transition-colors"
                            >
                                {showChangeSession ? 'Cancel' : 'Change ID'}
                            </button>
                            <button
                                type="button"
                                onClick={handleLogout}
                                disabled={isLoading}
                                className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 text-[11px] border border-rose-500/20 transition-colors"
                            >
                                Logout
                            </button>
                        </div>
                    </div>

                    {/* Stats & Auto Reply Switch */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5 text-xs">
                        <div className="p-2 rounded-xl bg-slate-950/60 border border-white/5">
                            <span className="text-[10px] text-slate-400 block">DMs Processed</span>
                            <span className="text-base font-bold text-white">{status.totalMessagesProcessed || 0}</span>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-950/60 border border-white/5 flex flex-col justify-between">
                            <span className="text-[10px] text-slate-400 block">AI Auto-Reply</span>
                            <div className="flex items-center justify-between">
                                <span className={`text-[11px] font-bold ${status.autoReplyEnabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                                    {status.autoReplyEnabled ? 'Active' : 'Paused'}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleToggleAutoReply}
                                    disabled={isLoading}
                                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                        status.autoReplyEnabled ? 'bg-pink-600' : 'bg-slate-700'
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                                            status.autoReplyEnabled ? 'translate-x-3' : 'translate-x-0'
                                        }`}
                                    />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Change Session Accordion if user clicked Change ID */}
                    {showChangeSession && (
                        <div className="pt-2 border-t border-white/5 space-y-2">
                            <label className="text-[11px] font-semibold text-slate-300 block">
                                Naya Instagram Session ID daalein:
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={sessionIdInput}
                                    onChange={(e) => setSessionIdInput(e.target.value)}
                                    placeholder="Naya sessionid yahan paste karein..."
                                    className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-pink-500"
                                />
                                <button
                                    type="button"
                                    onClick={() => handleConnectSessionId()}
                                    disabled={isLoading}
                                    className="px-3 py-1.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs shadow-md shadow-pink-500/20 cursor-pointer disabled:opacity-50"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                /* Session ID Input Card (Logged out / fresh state) */
                <div className="p-3 rounded-2xl bg-gradient-to-b from-slate-900/90 to-purple-950/20 border border-pink-500/20 space-y-3">
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-pink-400 font-semibold text-xs">
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>1-Click Session ID Connection (Safe & Zero 2FA Block)</span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            Instagram username/password dalne par checkpoint block lagta hai. Apne browser ki <code className="text-pink-300 font-mono">sessionid</code> cookie paste karein aur Friday turant connect ho jayega!
                        </p>
                    </div>

                    <form onSubmit={handleConnectSessionId} className="space-y-2.5">
                        <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                                <span className="flex items-center gap-1">
                                    <Key className="w-3 h-3 text-pink-400" />
                                    <span>Instagram Session ID</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                                >
                                    {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                    <span>{showPassword ? 'Hide' : 'Show'}</span>
                                </button>
                            </label>

                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={sessionIdInput}
                                    onChange={(e) => setSessionIdInput(e.target.value)}
                                    placeholder="Jaise: 6839201%3AAbCdEf123..."
                                    disabled={isLoading}
                                    className="w-full bg-slate-950/90 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500 font-mono tracking-tight transition-colors"
                                />
                                {sessionIdInput && (
                                    <button
                                        type="button"
                                        onClick={() => setSessionIdInput('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isLoading || !sessionIdInput.trim()}
                            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-pink-600 via-rose-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-pink-500/20 transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                                    <span>Connecting Instagram Session...</span>
                                </>
                            ) : (
                                <>
                                    <Instagram className="w-4 h-4 text-white" />
                                    <span>Connect Instagram ID</span>
                                </>
                            )}
                        </button>
                    </form>

                    {/* Delete Old Session Button */}
                    <button
                        type="button"
                        onClick={handlePurgeSessions}
                        disabled={isLoading}
                        className="w-full py-2 rounded-xl bg-amber-950/40 hover:bg-amber-900/50 text-amber-300 hover:text-amber-200 font-semibold text-xs border border-amber-500/25 hover:border-amber-400/40 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                        title="Sabhi purane sessions delete karo — Firestore, cache, bridge memory sab saaf"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>🗑️ Delete Old Session (Purge All Cache)</span>
                    </button>

                    {/* Step-by-step Help Accordion */}
                    <div className="pt-2 border-t border-white/5 flex flex-col gap-1.5">
                        <button
                            type="button"
                            onClick={() => setShowHelp(!showHelp)}
                            className="text-[11px] text-pink-400 hover:text-pink-300 font-semibold text-left flex items-center justify-between cursor-pointer"
                        >
                            <span>ℹ️ Session ID kaise milegi? (Click here)</span>
                            <span className="text-[10px]">{showHelp ? '▲ Hide' : '▼ View Steps'}</span>
                        </button>

                        {showHelp && (
                            <div className="p-3 rounded-xl bg-slate-950/90 border border-purple-500/20 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                                <p>1. Computer/Phone browser me <b>instagram.com</b> open karke login karein.</p>
                                <p>2. Keyboard par <b>F12</b> dabayein ya Right-click &rarr; <b>Inspect</b> karein.</p>
                                <p>3. <b>Application</b> tab par jaayein &rarr; Left menu me <b>Cookies</b> &rarr; <b>https://www.instagram.com</b> select karein.</p>
                                <p>4. <b>sessionid</b> naam ki cookie ki value copy karein aur upar wale box me paste karke <b>Connect Instagram ID</b> dabayein.</p>
                            </div>
                        )}
                    </div>

                    {/* Refresh Status button */}
                    <button
                        type="button"
                        onClick={fetchStatus}
                        disabled={isLoading}
                        className="w-full py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 font-medium text-[11px] border border-white/5 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                        <span>Check Status</span>
                    </button>
                </div>
            )}
        </div>
    );
}

export default InstagramBotCard;
