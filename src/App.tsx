import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import LiveAIInterface from './components/LiveAIInterface';
import AgentFace from './components/AgentFace';
import AppKeyLockModal from './components/AppKeyLockModal';
import { getStoredAppSession, saveAppSession } from '@/utils/appSecurityClient';
import { wakeWordManager } from '@/utils/wakeWord';
import { screenWakeLock } from '@/utils/screenWakeLock';

export default function App() {
    // Keep device screen permanently ON (no screen sleep or auto-dimming)
    useEffect(() => {
        screenWakeLock.requestLock().catch(() => {});
    }, []);

    // Check URL parameters for direct call or token
    const [callParams] = useState(() => {
        if (typeof window === 'undefined') return { isCall: false, callId: null, caller: null };
        const params = new URLSearchParams(window.location.search);
        return {
            isCall: params.get('call') === 'true' || params.get('mode') === 'live',
            callId: params.get('callId'),
            caller: params.get('caller'),
        };
    });

    const [callValidation, setCallValidation] = useState<{
        checked: boolean;
        valid: boolean;
        session?: any;
        message?: string;
    }>({ checked: !callParams.isCall || !callParams.callId, valid: true });

    // Validate Call Token from server
    useEffect(() => {
        if (callParams.isCall && callParams.callId) {
            fetch(`/api/call/validate-session?callId=${encodeURIComponent(callParams.callId)}`)
                .then((r) => r.json())
                .then((data) => {
                    if (data?.valid) {
                        setCallValidation({ checked: true, valid: true, session: data.session });
                    } else {
                        setCallValidation({
                            checked: true,
                            valid: false,
                            message: data?.message || 'Ye Call Link expire ho chuka hai (20/30 min limit).',
                        });
                    }
                })
                .catch(() => {
                    setCallValidation({ checked: true, valid: true });
                });
        }
    }, [callParams.isCall, callParams.callId]);

    // Application Access Key Protection (Backed by Cryptographic Token or Valid 1-Click Call URL)
    const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const token = params.get('token') || params.get('auth');
            if (token) {
                saveAppSession(token);
                return true;
            }
            if (params.get('call') === 'true') {
                return true;
            }
        }
        return !!getStoredAppSession();
    });

    // Listen for anti-tamper security lock events
    useEffect(() => {
        const handleLock = () => {
            setIsUnlocked(false);
        };
        window.addEventListener('app:security_locked', handleLock);
        return () => window.removeEventListener('app:security_locked', handleLock);
    }, []);

    // The AI Live Agent page opens directly when the app loads. Closing it
    // (X button) minimizes to a small floating bubble instead of a blank
    // screen — tap the bubble or say "Hello Friday" to reopen full screen.
    const [isOpen, setIsOpen] = useState(true);

    useEffect(() => {
        if (!isOpen && isUnlocked) {
            const unregister = wakeWordManager.register(() => {
                setIsOpen(true);
            });
            return () => unregister();
        }
    }, [isOpen, isUnlocked]);

    // If call link is verified as expired or invalid
    if (callParams.isCall && callValidation.checked && !callValidation.valid) {
        return (
            <div className="fixed inset-0 bg-[#070b19] flex flex-col items-center justify-center p-6 text-center text-slate-200">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="max-w-md w-full p-8 rounded-3xl bg-slate-900/90 border border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.2)] flex flex-col items-center gap-4"
                >
                    <div className="w-16 h-16 rounded-2xl bg-red-500/15 border border-red-500/40 flex items-center justify-center text-3xl shadow-[0_0_20px_rgba(239,68,68,0.3)]">
                        ⏳
                    </div>
                    <h2 className="text-xl font-bold text-red-300">Voice Call Link Expired</h2>
                    <p className="text-sm text-slate-300 leading-relaxed">
                        {callValidation.message || "Ye Call link time-limit poori hone ki wajah se expire ho gaya hai."}
                    </p>
                    <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-white/5 w-full text-xs text-slate-400 space-y-1 text-left font-mono">
                        <p>• 1v1 / Group Call Expiry: <b>20 Minutes</b></p>
                        <p>• Boss DK Call Expiry: <b>30 Minutes</b></p>
                        <p>• Fresh Token Security: <b>Active</b></p>
                    </div>
                    <div className="pt-2 text-xs text-cyan-300 flex items-center gap-1.5">
                        <span>📲</span>
                        <span>WhatsApp par <b>"@call"</b> ya <b>"call me"</b> likh kar naya fresh link generate karein.</span>
                    </div>
                </motion.div>
            </div>
        );
    }

    if (!isUnlocked) {
        return <AppKeyLockModal onUnlocked={() => setIsUnlocked(true)} />;
    }

    if (isOpen) {
        return <LiveAIInterface onClose={() => setIsOpen(false)} isCallMode={callParams.isCall} callSession={callValidation.session} />;
    }

    return (
        <div className="fixed inset-0 bg-[#0a0f24] flex flex-col items-center justify-center gap-4">
            <motion.button
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.05 }}
                onClick={() => {
                    setIsOpen(true);
                }}
                className="cursor-pointer relative flex flex-col items-center group"
            >
                <AgentFace status="" volume={0} size={95} colorIndex={0} />
            </motion.button>
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-xs text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.2)] animate-pulse">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span>Say <b>"Hello Friday"</b> or tap to activate</span>
            </div>
        </div>
    );
}
