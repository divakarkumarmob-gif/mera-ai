import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';

export type AgentFaceReaction = 'success' | 'photo' | 'happy' | 'winking' | null;

interface AgentFaceProps {
  status: string;
  volume: number;
  size?: number;
  colorIndex: number;
  reaction?: AgentFaceReaction;
  onDoubleClick?: () => void;
}

// Photo-real avatar sources (priority order):
// 1. friday-avatar-face.png — 1st wali sheet ke "Close Up" se face crop (circle ke liye best)
// 2. friday-avatar.png — 2nd wali full-body photo (face-focus crop ke saath)
const AVATAR_SOURCES = ['/friday-avatar-face.png', '/friday-avatar-face.jpg', '/friday-avatar.png', '/friday-avatar.jpg', '/friday-avatar.webp'];

const AgentFace: React.FC<AgentFaceProps> = ({ status, volume, size = 120, colorIndex, reaction, onDoubleClick }) => {
  const isSpeaking = status === 'Speaking...';
  const isListening = status === 'Listening...';
  const isThinking = status === 'Thinking...';

  const colors = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#d946ef", "#14b8a6", "#e11d48"];
  const baseColor = colors[colorIndex % colors.length];
  const glowColor = reaction === 'success' ? '#10b981' : reaction === 'photo' ? '#c084fc' : baseColor;

  const lastTapRef = useRef<number>(0);
  const [imgSrc, setImgSrc] = useState(AVATAR_SOURCES[0]);
  const [imgFailed, setImgFailed] = useState(false);
  const [imgIndex, setImgIndex] = useState(0);

  // ── 3D tilt (mouse parallax) ──
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [10, -10]), { stiffness: 150, damping: 18 });
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-12, 12]), { stiffness: 150, damping: 18 });

  const handleMouse = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };

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

  const handleImgError = () => {
    if (imgIndex < AVATAR_SOURCES.length - 1) {
      const next = imgIndex + 1;
      setImgIndex(next);
      setImgSrc(AVATAR_SOURCES[next]);
    } else {
      setImgFailed(true);
    }
  };

  // Speaking bounce: volume se scale pulse
  const speakBoost = isSpeaking ? Math.min(volume * 1.8, 0.35) : 0;
  const listenBoost = isListening ? 0.06 : 0;

  // Equalizer bars (speaking ke time)
  const bars = [0.5, 0.9, 0.65, 1, 0.75, 0.55, 0.85];

  return (
    <motion.div
      className="relative flex items-center justify-center agent-face"
      style={{ width: size, height: size, perspective: 800 }}
      onMouseMove={handleMouse}
      onMouseLeave={() => { mx.set(0); my.set(0); }}
    >
      {/* Reaction flash */}
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

      {/* Volume-reactive neon halo */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: size * 1.32,
          height: size * 1.32,
          background: `radial-gradient(circle, ${glowColor}44 0%, rgba(139,92,246,0.18) 50%, transparent 70%)`,
          boxShadow: `0 0 ${30 + volume * 120}px ${glowColor}${isSpeaking ? 'aa' : '66'}, inset 0 0 20px ${glowColor}33`
        }}
        animate={{
          scale: [1, 1 + Math.min(volume * 1.2, 0.22) + (isListening ? 0.05 : 0), 1],
          opacity: [0.7, 1, 0.7]
        }}
        transition={{ duration: isSpeaking ? 0.25 : 1.6, repeat: Infinity }}
      />

      {/* Rotating dashed ring while thinking */}
      {isThinking ? (
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: size * 1.12, height: size * 1.12,
            border: `2px dashed ${glowColor}88`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
        />
      ) : (
        <motion.div
          className="absolute rounded-full border border-purple-400/30 pointer-events-none"
          style={{ width: size * 1.1, height: size * 1.1 }}
          animate={{ scale: [0.95, 1.05, 0.95], opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* ── Photo-real face circle ── */}
      <motion.div
        onDoubleClick={onDoubleClick}
        onTouchEnd={handleTouchEnd}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        title="Double-click / double-tap to interrupt and start listening!"
        className="relative z-10 cursor-pointer select-none overflow-hidden rounded-full bg-slate-950/80 backdrop-blur-xl border-2"
        style={{
          width: size * 0.92,
          height: size * 0.92,
          borderColor: glowColor,
          boxShadow: `0 0 30px ${glowColor}80, inset 0 0 15px ${glowColor}4d`,
          transformStyle: 'preserve-3d',
        }}
      >
        <motion.div
          style={{ rotateX, rotateY, width: '100%', height: '100%', transformStyle: 'preserve-3d' }}
        >
          {/* Breathing + speaking motion */}
          <motion.div
            style={{ width: '100%', height: '100%' }}
            animate={{
              scale: 1 + speakBoost + listenBoost,
              y: isSpeaking ? [0, -2, 0, 1, 0] : [0, -1.5, 0],
            }}
            transition={isSpeaking
              ? { duration: 0.4, repeat: Infinity }
              : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }
            }
          >
            {!imgFailed ? (
              <img
                src={imgSrc}
                onError={handleImgError}
                alt="Friday AI"
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  // Face focus: full-body photo me chehra upar hota hai
                  objectPosition: '50% 12%',
                  transform: 'scale(1.35)',
                  filter: isSpeaking
                    ? `saturate(1.15) brightness(1.06)`
                    : `saturate(1.05)`,
                }}
              />
            ) : (
              // Fallback jab tak photo save nahi ki
              <div
                className="flex flex-col items-center justify-center w-full h-full text-center px-2"
                style={{ background: `linear-gradient(140deg, #0b1020, ${glowColor}44)` }}
              >
                <span className="text-3xl">🤖</span>
                <span className="text-[10px] text-white/80 mt-1 leading-tight">
                  friday-avatar.png<br />public/ me save karo
                </span>
              </div>
            )}

            {/* Cinematic light sweep */}
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.22) 50%, transparent 60%)' }}
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 2 }}
            />
            {/* Bottom gradient for equalizer readability */}
            <div
              className="absolute bottom-0 left-0 right-0 pointer-events-none"
              style={{ height: '32%', background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent)' }}
            />
          </motion.div>
        </motion.div>

        {/* Speaking equalizer */}
        {isSpeaking && (
          <div className="absolute bottom-[8%] left-0 right-0 flex items-end justify-center gap-[3px] pointer-events-none">
            {bars.map((b, i) => (
              <motion.span
                key={i}
                style={{ width: 3, borderRadius: 2, background: glowColor }}
                animate={{ height: [3, 4 + Math.min(volume * 60, 18) * b, 3] }}
                transition={{ duration: 0.32 + i * 0.03, repeat: Infinity, ease: 'easeInOut' }}
              />
            ))}
          </div>
        )}

        {/* Listening pulse dot */}
        {isListening && (
          <motion.span
            className="absolute top-[10%] right-[12%] rounded-full"
            style={{ width: 8, height: 8, background: '#22c55e', boxShadow: '0 0 8px #22c55e' }}
            animate={{ scale: [1, 1.6, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        )}
      </motion.div>
    </motion.div>
  );
};

export default AgentFace;
