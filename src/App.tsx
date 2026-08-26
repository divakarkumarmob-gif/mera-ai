import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import LiveAIInterface from './components/LiveAIInterface';
import AgentFace from './components/AgentFace';
import AppKeyLockModal from './components/AppKeyLockModal';
import { getStoredAppSession } from '@/utils/appSecurityClient';
import { wakeWordManager } from '@/utils/wakeWord';
import { screenWakeLock } from '@/utils/screenWakeLock';

export default function App() {
    // Keep device screen permanently ON (no screen sleep or auto-dimming)
    useEffect(() => {
        screenWakeLock.requestLock().catch(() => {});
    }, []);

    // Application Access Key Protection (Backed by Cryptographic Token)
    const [isUnlocked, setIsUnlocked] = useState<boolean>(() => !!getStoredAppSession());

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

    if (!isUnlocked) {
        return <AppKeyLockModal onUnlocked={() => setIsUnlocked(true)} />;
    }

    if (isOpen) {
        return <LiveAIInterface onClose={() => setIsOpen(false)} />;
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
