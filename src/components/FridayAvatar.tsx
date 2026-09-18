import React, { useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import type { AgentFaceReaction } from './AgentFace';

interface FridayAvatarProps {
  status: string;
  volume: number;
  reaction?: AgentFaceReaction;
  height?: number;
  onTap?: () => void;
}

// Tumhari bheji hui 2nd wali full-body photo ko public/friday-avatar-full.png me save karo.
// (1st wali character-sheet se face closeup crop karke public/friday-avatar-face.png me save karo — circle avatar ke liye)
const FULL_SOURCES = ['/friday-avatar-full.png', '/friday-avatar-full.jpg', '/friday-avatar.png'];

const FridayAvatar: React.FC<FridayAvatarProps> = ({ status, volume, reaction, height = 340, onTap }) => {
  const isSpeaking = status === 'Speaking...';
  const isListening = status === 'Listening...';
  const isThinking = status === 'Thinking...';
  const isHappy = reaction === 'happy' || reaction === 'success' || reaction === 'photo' || reaction === 'winking';

  const [srcIndex, setSrcIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  // ── 3D parallax tilt ──
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [7, -7]), { stiffness: 120, damping: 16 });
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-10, 10]), { stiffness: 120, damping: 16 });
  const glowX = useTransform(mx, [-0.5, 0.5], ['30%', '70%']);

  const handleMouse = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };

  const speakBoost = isSpeaking ? Math.min(volume * 1.2, 0.2) : 0;

  return (
    <div
      className="relative flex flex-col items-center"
      style={{ perspective: 900 }}
      onMouseMove={handleMouse}
      onMouseLeave={() => { mx.set(0); my.set(0); }}
      onClick={onTap}
    >
      {/* Neon halo behind */}
      <motion.div
        className="absolute pointer-events-none rounded-full"
        style={{
          width: height * 0.85,
          height: height * 0.85,
          top: -height * 0.06,
          background: 'radial-gradient(circle, rgba(59,130,246,0.35) 0%, rgba(168,85,247,0.18) 45%, transparent 70%)',
          filter: 'blur(6px)',
        }}
        animate={{
          scale: [1, 1 + Math.min(volume * 1.5, 0.25) + (isListening ? 0.06 : 0), 1],
          opacity: [0.75, 1, 0.75],
        }}
        transition={{ duration: isSpeaking ? 0.3 : 2, repeat: Infinity }}
      />

      {/* Thinking orbit ring */}
      {isThinking && (
        <motion.div
          className="absolute pointer-events-none rounded-full"
          style={{
            width: height * 0.7, height: height * 0.7, top: -height * 0.02,
            border: '2px dashed rgba(96,165,250,0.6)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 7, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {/* ── Girl ── */}
      <motion.div style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}>
        <motion.div
          animate={
            isSpeaking
              ? { scale: 1 + speakBoost, y: [0, -4, 0, 2, 0] }
              : isHappy
                ? { scale: [1, 1.03, 1], y: [0, -6, 0] }
                : { scale: 1, y: [0, -7, 0] }
          }
          transition={
            isSpeaking
              ? { duration: 0.45, repeat: Infinity }
              : { duration: 3.4, repeat: Infinity, ease: 'easeInOut' }
          }
          style={{ position: 'relative' }}
        >
          {!failed ? (
            <img
              src={FULL_SOURCES[srcIndex]}
              onError={() => {
                if (srcIndex < FULL_SOURCES.length - 1) setSrcIndex(srcIndex + 1);
                else setFailed(true);
              }}
              alt="Friday — Your AI Assistant"
              draggable={false}
              style={{
                height,
                width: 'auto',
                maxWidth: '80vw',
                objectFit: 'contain',
                // Black background ko starry theme me gholo
                mixBlendMode: 'screen',
                maskImage: 'radial-gradient(ellipse 78% 88% at 50% 42%, black 62%, transparent 98%)',
                WebkitMaskImage: 'radial-gradient(ellipse 78% 88% at 50% 42%, black 62%, transparent 98%)',
                filter: isSpeaking
                  ? 'saturate(1.18) brightness(1.07)'
                  : isHappy
                    ? 'saturate(1.22) brightness(1.08)'
                    : 'saturate(1.06)',
              }}
            />
          ) : (
            <div
              className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-cyan-500/40 text-cyan-200/80 text-xs px-6"
              style={{ height, width: 240 }}
            >
              <span className="text-4xl mb-2">🤖</span>
              2nd wali photo ko<br />
              <b>public/friday-avatar-full.png</b><br />
              naam se save karo
            </div>
          )}

          {/* Cinematic shine sweep */}
          {!failed && (
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.16) 50%, transparent 58%)',
                mixBlendMode: 'screen',
              }}
              animate={{ x: ['-60%', '60%'] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 2.5 }}
            />
          )}
        </motion.div>
      </motion.div>

      {/* Floor glow shadow */}
      <motion.div
        className="pointer-events-none rounded-[100%]"
        style={{
          width: height * 0.5,
          height: 22,
          marginTop: -14,
          background: 'radial-gradient(ellipse, rgba(59,130,246,0.5), transparent 70%)',
          filter: 'blur(4px)',
          x: glowX,
        }}
        animate={{ scaleX: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: isSpeaking ? 0.4 : 2.4, repeat: Infinity }}
      />

      {/* Speaking equalizer */}
      {isSpeaking && (
        <div className="absolute -bottom-7 flex items-end gap-1 pointer-events-none">
          {[0.5, 0.9, 0.65, 1, 0.75, 0.55, 0.85].map((b, i) => (
            <motion.span
              key={i}
              style={{ width: 4, borderRadius: 3, background: '#38bdf8', boxShadow: '0 0 8px #38bdf8' }}
              animate={{ height: [4, 5 + Math.min(volume * 70, 22) * b, 4] }}
              transition={{ duration: 0.3 + i * 0.03, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}
        </div>
      )}

      {/* Listening dot */}
      {isListening && (
        <motion.span
          className="absolute top-2 right-6 rounded-full"
          style={{ width: 10, height: 10, background: '#22c55e', boxShadow: '0 0 10px #22c55e' }}
          animate={{ scale: [1, 1.6, 1], opacity: [1, 0.5, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
      )}
    </div>
  );
};

export default FridayAvatar;
