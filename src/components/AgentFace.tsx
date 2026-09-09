import React from 'react';
import { motion } from 'motion/react';

export type AgentFaceReaction = 'success' | 'photo' | 'happy' | 'winking' | null;

interface AgentFaceProps {
  status: string;
  volume: number;
  size?: number;
  colorIndex: number;
  reaction?: AgentFaceReaction;
  onDoubleClick?: () => void;
}

const AgentFace: React.FC<AgentFaceProps> = ({ status, volume, size = 120, colorIndex, reaction, onDoubleClick }) => {
  const isListening = status === "Listening...";
  const isSpeaking = status === "Speaking...";
  const isThinking = status === "Thinking...";
  const isHappy = reaction === 'happy' || reaction === 'success' || reaction === 'photo' || reaction === 'winking';
  const isWinking = reaction === 'winking' || reaction === 'photo';
  const lastTapRef = React.useRef<number>(0);

  const handleTouchEnd = (e: React.TouchEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      e.preventDefault();
      onDoubleClick?.();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };
  
  const colors = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#d946ef", "#14b8a6", "#e11d48"];
  const baseColor = colors[colorIndex % colors.length];
  const color = reaction === 'success' ? '#10b981' : reaction === 'photo' ? '#c084fc' : baseColor;

  // Face Expression Mapping: Thinking vs Winking vs Happy vs Speaking vs Idle
  const eyes = isThinking ? (
    <>
      <motion.ellipse cx="40" cy="40" rx="4" ry="6" fill={color} animate={{ scaleY: [1, 0.1, 1] }} transition={{ repeat: Infinity, duration: 0.2, repeatDelay: 1.1 }} />
      <motion.ellipse cx="80" cy="40" rx="4" ry="6" fill={color} animate={{ scaleY: [1, 0.1, 1] }} transition={{ repeat: Infinity, duration: 0.2, repeatDelay: 1.1 }} />
    </>
  ) : isWinking ? (
    <>
      {/* Left Eye: Joyful upward curve */}
      <motion.path
        d="M 32 42 Q 40 33 48 42"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="transparent"
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 0.6, repeat: Infinity }}
      />
      {/* Right Eye: Big open spark */}
      <motion.circle
        cx="80"
        cy="40"
        r="6"
        fill={color}
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 0.6, repeat: Infinity }}
      />
    </>
  ) : isHappy ? (
    <>
      {/* Both Eyes: Joyful smiling curves */}
      <motion.path
        d="M 32 42 Q 40 33 48 42"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="transparent"
      />
      <motion.path
        d="M 72 42 Q 80 33 88 42"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="transparent"
      />
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

  const eyebrows = isHappy ? (
    <motion.g
      animate={{ y: [-2, -5, -2] }}
      transition={{ repeat: Infinity, duration: 1 }}
    >
      <path d="M 28 22 L 46 25" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 74 25 L 92 22" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </motion.g>
  ) : (
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
    <path d="M 40 80 Q 60 70 80 80" stroke={color} strokeWidth="4" fill="transparent" />
  ) : isHappy ? (
    <motion.path
      d="M 35 68 Q 60 95 85 68"
      stroke={color}
      strokeWidth="4.5"
      strokeLinecap="round"
      fill="transparent"
      animate={{ scale: [1, 1.06, 1] }}
      transition={{ repeat: Infinity, duration: 0.8 }}
    />
  ) : isSpeaking ? (
    <motion.path
      d="M 40 80 Q 60 95 80 80"
      stroke={color}
      strokeWidth="4"
      fill="transparent"
      animate={{ scaleY: [1, 1.4, 0.8, 1.3, 1] }}
      transition={{ repeat: Infinity, duration: 0.35 }}
    />
  ) : (
    <path d="M 40 70 Q 60 90 80 70" stroke={color} strokeWidth="4" fill="transparent" />
  );

  return (
    <motion.div className="relative flex items-center justify-center agent-face" style={{ width: size, height: size, perspective: 1000 }}>
      {/* Dynamic Action Success Reaction Flare */}
      {reaction && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: [1, 1.5, 1.2], opacity: [0.9, 0.4, 0] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          className="absolute rounded-full pointer-events-none z-0"
          style={{
            width: size * 1.6,
            height: size * 1.6,
            background: reaction === 'success'
              ? 'radial-gradient(circle, rgba(16,185,129,0.5) 0%, rgba(16,185,129,0.15) 50%, transparent 75%)'
              : 'radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(168,85,247,0.15) 50%, transparent 75%)',
          }}
        />
      )}

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
        onDoubleClick={onDoubleClick}
        onTouchEnd={handleTouchEnd}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.94 }}
        title="Continuous double-click / double-tap to interrupt and start listening immediately!"
        className="rounded-full bg-slate-950/80 backdrop-blur-xl border-2 flex items-center justify-center agent-face-circle relative z-10 cursor-pointer select-none transition-transform"
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