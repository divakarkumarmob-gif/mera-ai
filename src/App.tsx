import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import LiveAIInterface from './components/LiveAIInterface';
import AgentFace from './components/AgentFace';
import { wakeWordManager } from '@/utils/wakeWord';

export default function App() {
    // The AI Live Agent page opens directly when the app loads. Closing it
    // (X button) minimizes to a small floating bubble instead of a blank
    // screen — tap the bubble or say "Hello Friday" to reopen full screen.
    const [isOpen, setIsOpen] = useState(true);

    useEffect(() => {
        if (!isOpen) {
            const unregister = wakeWordManager.register(() => {
                setIsOpen(true);
            });
            return () => unregister();
        }
    }, [isOpen]);

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
