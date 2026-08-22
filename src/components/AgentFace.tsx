import React from 'react';
import { motion } from 'motion/react';

interface AgentFaceProps {
  status: string;
  volume: number;
  size?: number;
  colorIndex: number;
}

const AgentFace: React.FC<AgentFaceProps> = ({ status, volume, size = 120, colorIndex }) => {
  const isListening = status === "Recording...";
  const isSpeaking = status === "Speaking...";
  const isThinking = status === "Processing...";
  
  const colors = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#d946ef", "#14b8a6", "#e11d48"];
  const color = colors[colorIndex % colors.length];

  // Simple face expression mapping
  const eyes = isThinking ? (
    <>
      <motion.ellipse cx="40" cy="40" rx="4" ry="6" fill={color} animate={{ scaleY: [1, 0.1, 1] }} transition={{ repeat: Infinity, duration: 0.2, repeatDelay: 1.1 }} />
      <motion.ellipse cx="80" cy="40" rx="4" ry="6" fill={color} animate={{ scaleY: [1, 0.1, 1] }} transition={{ repeat: Infinity, duration: 0.2, repeatDelay: 1.1 }} />
    </>
  ) : (
    <>
      <motion.circle
        cx="40"
        cy="40"
        r="5"
        fill={color}
        animate={{
          scaleY: [1, 0.1, 1, 1, 1, 1]
        }}
        transition={{
          repeat: Infinity,
          duration: 1.3,
          times: [0, 0.1, 0.2, 0.5, 0.8, 0.95]
        }}
      />
      <motion.circle
        cx="80"
        cy="40"
        r="5"
        fill={color}
        animate={{
          scaleY: [1, 0.1, 1, 1, 1, 1]
        }}
        transition={{
          repeat: Infinity,
          duration: 1.3,
          times: [0, 0.1, 0.2, 0.5, 0.8, 0.95]
        }}
      />
    </>
  );

  const eyebrows = (
    <motion.g
        animate={{ y: [0, 0, 0, -5, -5, 0] }}
        transition={{
            repeat: Infinity,
            duration: 1.3,
            times: [0, 0.1, 0.2, 0.5, 0.8, 0.95]
        }}
    >
      <path d="M 30 25 L 45 25" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M 75 25 L 90 25" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </motion.g>
  );

  const mouth = isThinking ? (
    <motion.path d="M 40 80 Q 60 70 80 80" stroke={color} strokeWidth="4" fill="transparent" />
  ) : isSpeaking ? (
    <motion.path d="M 40 80 Q 60 90 80 80" stroke={color} strokeWidth="4" fill="transparent" animate={{ d: "M 40 80 Q 60 100 80 80" }} transition={{ repeat: Infinity, repeatType: "reverse", duration: 0.2 }} />
  ) : (
    <motion.path d="M 40 70 Q 60 90 80 70" stroke={color} strokeWidth="4" fill="transparent" />
  );

  return (
    <motion.div className="relative flex items-center justify-center agent-face" style={{ width: size, height: size, perspective: 1000 }}>
      {/* Outer Glowing Neon Ring 1 */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{ 
          width: size * 1.3, 
          height: size * 1.3, 
          background: `radial-gradient(circle, ${color}33 0%, rgba(139,92,246,0.15) 50%, transparent 70%)`,
          boxShadow: `0 0 40px ${color}66, inset 0 0 20px ${color}33`
        }}
        animate={{ scale: [1, 1 + volume / 40, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 0.3, repeat: Infinity }}
      />
      
      {/* Outer Glowing Pulsing Ring 2 */}
      <motion.div
        className="absolute rounded-full border border-purple-400/30 pointer-events-none"
        style={{ width: size * 1.1, height: size * 1.1 }}
        animate={{ scale: [0.95, 1.05, 0.95], opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Face Circle */}
      <motion.div
        className="rounded-full bg-slate-950/80 backdrop-blur-xl border-2 flex items-center justify-center agent-face-circle relative z-10"
        style={{ 
          width: size * 0.75, 
          height: size * 0.75, 
          borderColor: `${color}`, 
          boxShadow: `0 0 30px ${color}80, inset 0 0 15px ${color}4d` 
        }}
        animate={{ rotateY: [0, 0, 0, -20, 20, 0] }}
        transition={{
          repeat: Infinity,
          duration: 1.3,
          times: [0, 0.1, 0.2, 0.5, 0.8, 0.95]
        }}
      >
        <svg width={size} height={size} viewBox="0 0 120 120" className="agent-face-svg">
          {eyes}
          {eyebrows}
          {mouth}
        </svg>
      </motion.div>
    </motion.div>
  );
};

export default AgentFace;

