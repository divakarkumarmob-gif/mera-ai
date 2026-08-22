import React, { useState } from 'react';
import { motion } from 'motion/react';
import LiveAIInterface from './components/LiveAIInterface';
import AgentFace from './components/AgentFace';

export default function App() {
    // The AI Live Agent page opens directly when the app loads. Closing it
    // (X button) minimizes to a small floating bubble instead of a blank
    // screen — tap the bubble to reopen full screen.
    const [isOpen, setIsOpen] = useState(true);

    if (isOpen) {
        return <LiveAIInterface onClose={() => setIsOpen(false)} />;
    }

    return (
        <div className="fixed inset-0 bg-[#0a0f24] flex items-center justify-center">
            <motion.button
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.05 }}
                onClick={() => setIsOpen(true)}
                className="cursor-pointer"
            >
                <AgentFace status="" volume={0} size={90} colorIndex={0} />
            </motion.button>
        </div>
    );
}
