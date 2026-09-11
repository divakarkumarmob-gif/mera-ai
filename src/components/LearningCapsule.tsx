import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export interface LearningStats {
  totalLessons: number;
  totalDrills: number;
  totalGolden: number;
  totalRlhf: number;
  approvalRate: number;
  observedSamples: number;
  currentMood: string;
  activeGroups: number;
  activeDirectives: number;
  cognitionTier: string;
  lastUpdated: number;
}

export interface GymDrill {
  id: string;
  lessonId?: string;
  sourceLessonTitle?: string;
  sourceRule?: string;
  scenarioTitle: string;
  category: 'boss_taught_lesson' | 'emotional_empathy' | 'crisis_rescue' | 'coding_architecture' | 'diplomatic_handling' | string;
  simulatedBossQuery: string;
  trialResponse: string;
  selfCriticScore?: number;
  selfCritique?: string;
  criticScore: number;
  bossVerdict?: 'good' | 'bad' | 'unreviewed';
  bossFeedback?: string;
  keyTakeaway: string;
  timestamp: number;
}

export interface GoldenStandard {
  id: string;
  userPrompt: string;
  idealResponse: string;
  praiseTrigger: string;
  category: string;
  score: number;
  timestamp: number;
}

export interface RlhfEntry {
  id: string;
  emoji: string;
  sentiment: 'positive' | 'negative' | 'humor';
  targetMessageText: string;
  targetSender: string;
  bossFeedbackAnalysis: string;
  timestamp: number;
}

export interface TrainingLesson {
  id: string;
  situationTrigger: string;
  taughtReaction: string;
  idealSampleResponse?: string;
  forbiddenBehaviors?: string[];
  category: string;
  practiceScore?: number;
  isAnchor?: boolean;
  anchorPriority?: number;
  updatedAt: number;
}

export interface BossStyleProfile {
  slangTokens: string[];
  favoriteEmojis: string[];
  averageSentenceLength: number;
  toneCharacteristics: string[];
  observedSampleCount: number;
  updatedAt: number;
}

export interface GroupProfile {
  groupId: string;
  groupTitle: string;
  platform: 'whatsapp' | 'telegram';
  slangTokens: string[];
  activeTopics: string[];
  lastSummary?: string;
  updatedAt: number;
}

export interface DreamLedger {
  id: string;
  dateStr: string;
  coreLearnings: string[];
  mistakesFixed: string[];
  personalityEvolutionSummary: string;
  timestamp: number;
}

interface LearningCapsuleProps {
  isOpen?: boolean;
  onClose?: () => void;
  isFloatingWidgetOnly?: boolean;
  onExpandToStudio?: () => void;
}

export const LearningCapsule: React.FC<LearningCapsuleProps> = ({
  isOpen = true,
  onClose,
  isFloatingWidgetOnly = false,
  onExpandToStudio,
}) => {
  if (isOpen === false) return null;

  const [isExpanded, setIsExpanded] = useState(!isFloatingWidgetOnly);
  const [activeTab, setActiveTab] = useState<'drills' | 'golden' | 'lessons' | 'rlhf' | 'style' | 'groups' | 'dreams'>('drills');
  const [loading, setLoading] = useState(false);
  const [drillingNow, setDrillingNow] = useState(false);
  const [dreamingNow, setDreamingNow] = useState(false);

  const [stats, setStats] = useState<LearningStats | null>(null);
  const [drills, setDrills] = useState<GymDrill[]>([]);
  const [goldenStandards, setGoldenStandards] = useState<GoldenStandard[]>([]);
  const [rlhfHistory, setRlhfHistory] = useState<RlhfEntry[]>([]);
  const [lessons, setLessons] = useState<TrainingLesson[]>([]);
  const [bossStyle, setBossStyle] = useState<BossStyleProfile | null>(null);
  const [groupProfiles, setGroupProfiles] = useState<GroupProfile[]>([]);
  const [realizations, setRealizations] = useState<string[]>([]);
  const [dreamLogs, setDreamLogs] = useState<DreamLedger[]>([]);

  // Boss verdict & retry states
  const [markingVerdict, setMarkingVerdict] = useState<Record<string, boolean>>({});
  const [retryingDrill, setRetryingDrill] = useState<Record<string, boolean>>({});
  const [retryInstruction, setRetryInstruction] = useState<Record<string, string>>({});
  const [showRetryInput, setShowRetryInput] = useState<Record<string, boolean>>({});
  const [verdictToast, setVerdictToast] = useState<{ msg: string; type: 'good' | 'bad' | 'error' } | null>(null);

  // Teach modal form
  const [showTeachModal, setShowTeachModal] = useState(false);
  const [teachSituation, setTeachSituation] = useState('');
  const [teachReaction, setTeachReaction] = useState('');
  const [teachCategory, setTeachCategory] = useState<'emotional_comfort' | 'task_execution' | 'relationship_advice' | 'voice_tone'>('emotional_comfort');
  const [teachingLoading, setTeachingLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 💥 Meteor Impact & 5-Second Auto Nano-Repair States
  const [isCracked, setIsCracked] = useState(false);
  const [isHealing, setIsHealing] = useState(false);
  const [crackCountdown, setCrackCountdown] = useState(5);
  const crackTimerRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);

  // Synthesize realistic glass crack / energy fracture sound
  const playCrackSound = useCallback(() => {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      // High-pitched crystal shatter transient
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(3200, now);
      osc.frequency.exponentialRampToValueAtTime(450, now + 0.12);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);

      // Sizzling electric zap
      const zapOsc = ctx.createOscillator();
      const zapGain = ctx.createGain();
      zapOsc.type = 'square';
      zapOsc.frequency.setValueAtTime(1800, now + 0.04);
      zapOsc.frequency.exponentialRampToValueAtTime(200, now + 0.2);

      zapGain.gain.setValueAtTime(0.15, now + 0.04);
      zapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      zapOsc.connect(zapGain);
      zapGain.connect(ctx.destination);
      zapOsc.start(now + 0.04);
      zapOsc.stop(now + 0.23);
    } catch {}
  }, []);

  const triggerCrackEffect = useCallback(() => {
    setIsCracked(true);
    setIsHealing(false);
    setCrackCountdown(5);
    playCrackSound();

    if (crackTimerRef.current) clearTimeout(crackTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    // 1-second countdown updates
    let timeLeft = 5;
    countdownIntervalRef.current = setInterval(() => {
      timeLeft -= 1;
      setCrackCountdown(Math.max(0, timeLeft));
      if (timeLeft <= 0) {
        clearInterval(countdownIntervalRef.current);
      }
    }, 1000);

    // At 4.2s start nanotech laser seal, fully heal at 5.0s
    crackTimerRef.current = setTimeout(() => {
      setIsHealing(true);
      setTimeout(() => {
        setIsCracked(false);
        setIsHealing(false);
        clearInterval(countdownIntervalRef.current);
      }, 800);
    }, 4200);
  }, [playCrackSound]);

  useEffect(() => {
    const handleMeteorHit = (e: any) => {
      console.log('💥 [Cognition Capsule] Hit by Meteor!', e?.detail);
      triggerCrackEffect();
    };

    window.addEventListener('capsule_meteor_hit', handleMeteorHit);
    (window as any).triggerCapsuleCrack = triggerCrackEffect;

    return () => {
      window.removeEventListener('capsule_meteor_hit', handleMeteorHit);
      if (crackTimerRef.current) clearTimeout(crackTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [triggerCrackEffect]);

  // Fetch all learning data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/learning/dashboard-stats');
      const data = await res.json();
      if (data.ok) {
        setStats(data.stats);
        setDrills(data.drills || []);
        setGoldenStandards(data.goldenStandards || []);
        setRlhfHistory(data.rlhfHistory || []);
        setLessons(data.lessons || []);
        setBossStyle(data.bossStyle);
        setGroupProfiles(data.groupProfiles || []);
        setRealizations(data.realizations || []);
        setDreamLogs(data.dreamLogs || []);
      }
    } catch (e) {
      console.warn('Failed to load learning capsule data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 12000); // 12s live polling
    return () => clearInterval(interval);
  }, [fetchData]);

  // Run autonomous practice drill on-demand (from taught lessons)
  const handleRunPracticeDrill = async (lessonParam?: { lessonId?: string; trigger?: string; rule?: string }) => {
    if (drillingNow) return;
    setDrillingNow(true);
    try {
      const res = await fetch('/api/learning/practice-drill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lessonParam || {}),
      });
      const data = await res.json();
      if (data.ok && data.drill) {
        setDrills((prev) => [data.drill, ...prev]);
        setStats((prev) => (prev ? { ...prev, totalDrills: prev.totalDrills + 1 } : prev));
        setActiveTab('drills');
      }
    } catch (e) {
      console.error('Failed to run practice drill:', e);
    } finally {
      setDrillingNow(false);
    }
  };

  // Boss marks response with Good (👍) or Bad (👎) reaction
  const handleMarkVerdict = async (drillId: string, verdict: 'good' | 'bad', feedback?: string) => {
    setMarkingVerdict((prev) => ({ ...prev, [drillId]: true }));
    try {
      const res = await fetch(`/api/learning/drills/${drillId}/verdict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, feedback }),
      });
      const data = await res.json();
      if (data.ok && data.drill) {
        setDrills((prev) => prev.map((d) => (d.id === drillId ? data.drill : d)));
        // Show toast feedback so Boss knows it worked
        setVerdictToast({ msg: data.message || (verdict === 'good' ? '👍 Good mark ho gaya!' : '👎 Bad mark ho gaya!'), type: verdict });
        setTimeout(() => setVerdictToast(null), 4000);
        if (verdict === 'good') {
          fetchData(); // Refresh golden standards list & approval stats
        } else {
          setShowRetryInput((prev) => ({ ...prev, [drillId]: true }));
        }
      } else {
        // Show error toast
        setVerdictToast({ msg: data.message || 'Kuch error aa gayi, dobara try karo!', type: 'error' });
        setTimeout(() => setVerdictToast(null), 4000);
      }
    } catch (e) {
      console.error('Failed to mark verdict:', e);
      setVerdictToast({ msg: 'Network error! Server se connect nahi ho pa raha.', type: 'error' });
      setTimeout(() => setVerdictToast(null), 4000);
    } finally {
      setMarkingVerdict((prev) => ({ ...prev, [drillId]: false }));
    }
  };

  // Re-generate response when Boss marks bad or wants correction
  const handleRetryDrill = async (drillId: string) => {
    setRetryingDrill((prev) => ({ ...prev, [drillId]: true }));
    try {
      const customInstruction = retryInstruction[drillId] || '';
      const res = await fetch(`/api/learning/drills/${drillId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customInstruction }),
      });
      const data = await res.json();
      if (data.ok && data.drill) {
        setDrills((prev) => prev.map((d) => (d.id === drillId ? data.drill : d)));
        setShowRetryInput((prev) => ({ ...prev, [drillId]: false }));
        setRetryInstruction((prev) => ({ ...prev, [drillId]: '' }));
      }
    } catch (e) {
      console.error('Failed to retry drill:', e);
    } finally {
      setRetryingDrill((prev) => ({ ...prev, [drillId]: false }));
    }
  };

  // Run drill from a specific lesson taught by Boss
  const handlePracticeSpecificLesson = async (lesson: TrainingLesson) => {
    await handleRunPracticeDrill({
      lessonId: lesson.id,
      trigger: lesson.situationTrigger,
      rule: lesson.taughtReaction,
    });
  };

  // Run dream consolidation
  const handleRunDreamConsolidation = async () => {
    if (dreamingNow) return;
    setDreamingNow(true);
    try {
      const res = await fetch('/api/learning/dream-consolidate', { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.ledger) {
        setDreamLogs((prev) => [data.ledger, ...prev]);
        setActiveTab('dreams');
      }
    } catch (e) {
      console.error('Failed to run dream consolidation:', e);
    } finally {
      setDreamingNow(false);
    }
  };

  // Teach Friday new lesson
  const handleTeachSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teachSituation.trim() || !teachReaction.trim() || teachingLoading) return;
    setTeachingLoading(true);
    try {
      const res = await fetch('/api/learning/teach-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          situationTrigger: teachSituation.trim(),
          taughtReaction: teachReaction.trim(),
          category: teachCategory,
          isAnchor: true,
          anchorPriority: 100,
        }),
      });
      const data = await res.json();
      if (data.ok && data.lesson) {
        setLessons((prev) => [data.lesson, ...prev]);
        setStats((prev) => (prev ? { ...prev, totalLessons: prev.totalLessons + 1 } : prev));
        setShowTeachModal(false);
        setTeachSituation('');
        setTeachReaction('');
        setActiveTab('lessons');
      }
    } catch (err) {
      console.error('Failed to teach lesson:', err);
    } finally {
      setTeachingLoading(false);
    }
  };

  // If used purely as the floating pill / capsule widget on the dashboard
  if (isFloatingWidgetOnly && !isExpanded) {
    return (
      <motion.div
        data-floating-capsule="true"
        drag
        dragMomentum={false}
        whileDrag={{ scale: 1.08, cursor: 'grabbing' }}
        initial={{ y: 0, opacity: 0, scale: 0.9 }}
        animate={
          isCracked
            ? {
                x: [-10, 10, -8, 8, -4, 4, 0],
                y: [-4, 4, -2, 2, 0],
                rotate: [-4, 4, -2, 2, 0],
                scale: [0.94, 1.06, 0.97, 1],
              }
            : {
                opacity: 1,
                scale: 1,
                y: [-6, 6, -6],
                x: [-2, 2, -2],
                rotate: [-1.8, 1.8, -1.8],
              }
        }
        transition={
          isCracked
            ? { duration: 0.5, ease: 'easeOut' }
            : {
                y: { repeat: Infinity, duration: 3.8, ease: 'easeInOut' },
                x: { repeat: Infinity, duration: 4.6, ease: 'easeInOut' },
                rotate: { repeat: Infinity, duration: 4.2, ease: 'easeInOut' },
                opacity: { duration: 0.3 },
                scale: { duration: 0.3 },
              }
        }
        className="fixed top-20 sm:top-24 right-4 sm:right-8 z-40 select-none cursor-grab active:cursor-grabbing touch-none flex flex-col items-center"
        style={{ transformOrigin: 'top center' }}
      >
        {/* ── Solid Continuous Glowing Rope extending straight down from the ceiling to the capsule ── */}
        <div
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none z-0"
          style={{
            bottom: 'calc(100% - 10px)',
            top: '-150vh',
            width: '2.5px',
          }}
        >
          {/* Main Braided Cable */}
          <div
            className="w-full h-full bg-gradient-to-b from-emerald-400/90 via-teal-300 to-emerald-500/90"
            style={{
              backgroundImage: `repeating-linear-gradient(45deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 2.5px, rgba(255,255,255,0.3) 2.5px, rgba(255,255,255,0.3) 5px)`,
            }}
          />
          {/* Full Neon Radiance Glow */}
          <div
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              boxShadow: `0 0 8px 2px rgba(16,185,129,0.5), 0 0 16px 4px rgba(16,185,129,0.35)`,
            }}
          />
        </div>

        {/* Glowing Attachment Node right on top of the capsule */}
        <div className="relative z-10 flex flex-col items-center -mb-1">
          <div
            className="w-2.5 h-2.5 rounded-full bg-slate-950 border-[1.5px] border-emerald-400 flex items-center justify-center pointer-events-none shadow-[0_0_10px_rgba(16,185,129,0.8)]"
          >
            <div className="w-1 h-1 rounded-full bg-white animate-pulse" />
          </div>
        </div>

        <div
          className="relative group z-20"
          onDoubleClick={(e) => {
            e.stopPropagation();
            triggerCrackEffect();
          }}
          title={isCracked ? `⚡ Training Capsule Cracked! Auto-repairing in ${crackCountdown}s...` : 'Training Capsule (Suspended from ceiling • Double-click to test crack)'}
        >
          {/* Dynamic Antigravity Aura (Fiery burning amber/red warning when cracked, glowing emerald normally) */}
          <div
            className={`absolute -inset-2 rounded-full blur-lg transition-all duration-500 animate-pulse ${
              isCracked
                ? 'bg-gradient-to-r from-red-600 via-amber-500 to-orange-600 opacity-100 shadow-[0_0_35px_rgba(239,68,68,0.9)]'
                : 'bg-gradient-to-r from-emerald-500/80 via-teal-400/60 to-cyan-500/80 opacity-70 group-hover:opacity-100'
            }`}
          />

          {/* Compact Antigravity Floating Pill */}
          <div
            className={`relative flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-950/95 backdrop-blur-xl text-slate-100 transition-colors duration-300 border ${
              isCracked
                ? 'border-amber-400 shadow-[0_0_35px_rgba(245,158,11,0.7)] ring-2 ring-red-500/60'
                : 'border-emerald-400/50 shadow-[0_0_25px_rgba(16,185,129,0.35)]'
            }`}
          >
            {/* Live Pulsing Brain Dot */}
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isCracked ? 'bg-red-400' : 'bg-emerald-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isCracked ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]'
                }`}
              />
            </span>

            {/* Click to open full Training Studio */}
            <div
              onClick={() => {
                if (onExpandToStudio) onExpandToStudio();
                else setIsExpanded(true);
              }}
              className="cursor-pointer flex items-center gap-1.5"
            >
              <span
                className={`text-xs sm:text-sm font-bold bg-clip-text text-transparent whitespace-nowrap ${
                  isCracked
                    ? 'bg-gradient-to-r from-amber-300 via-red-300 to-yellow-300 animate-pulse'
                    : 'bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-200'
                }`}
              >
                {isCracked ? `💥 CRACKED (${crackCountdown}s)` : '🧠 Training'}
              </span>
              <span
                className={`text-[10px] sm:text-xs px-1.5 py-0.2 rounded-full font-mono font-semibold whitespace-nowrap border ${
                  isCracked
                    ? 'bg-red-500/30 text-amber-200 border-red-500/60'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                }`}
              >
                {stats?.totalLessons || 0}L
              </span>
            </div>

            {/* Quick Practice Drill Trigger */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRunPracticeDrill();
              }}
              disabled={drillingNow}
              title="Run instant AI practice drill"
              className="p-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 transition active:scale-90 cursor-pointer"
            >
              {drillingNow ? (
                <span className="animate-spin text-[10px] block">⚡</span>
              ) : (
                <span className="text-[11px] block">🏋️</span>
              )}
            </button>

            {/* 💥 Center Glass-Fracture Crack Overlay (Appears when meteor hits, auto-heals in 5s) */}
            {isCracked && (
              <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden rounded-full flex items-center justify-center">
                <svg className="w-full h-full absolute inset-0" viewBox="0 0 160 40" preserveAspectRatio="none">
                  {/* Outer glowing fissure outline */}
                  <path
                    d="M 80 0 L 74 10 L 86 19 L 73 28 L 84 35 L 80 40"
                    fill="none"
                    stroke="#ff2200"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                    style={{ filter: 'drop-shadow(0 0 8px #ff4500)' }}
                  />
                  {/* Sharp white-hot molten core line */}
                  <path
                    d="M 80 0 L 74 10 L 86 19 L 73 28 L 84 35 L 80 40"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  {/* Lateral branch micro-cracks */}
                  <path
                    d="M 74 10 L 60 14 M 73 28 L 58 25 M 86 19 L 100 16 M 84 35 L 98 37"
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    opacity="0.95"
                  />
                </svg>

                {/* Hot glowing impact sparks point */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-amber-300/80 animate-ping" />

                {/* 5-Second Nano-Repair Holographic Laser Beam (Sweeps at 4.2s - 5.0s to seal the crack) */}
                {isHealing && (
                  <motion.div
                    initial={{ x: '-100%', opacity: 0 }}
                    animate={{ x: '100%', opacity: [0, 1, 1, 0] }}
                    transition={{ duration: 0.8, ease: 'easeInOut' }}
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-300 to-transparent w-full h-full shadow-[0_0_25px_#10b981]"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  // Full Expanded Modal View / Interactive Learning Studio
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-hidden">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-3xl bg-slate-950/95 border border-emerald-500/30 shadow-[0_0_80px_rgba(16,185,129,0.2)] overflow-hidden text-slate-100"
      >
        {/* Glow Effects */}
        <div className="absolute top-0 left-1/4 w-96 h-32 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-0 right-1/4 w-96 h-32 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* ── Verdict Toast Notification ── */}
        <AnimatePresence>
          {verdictToast && (
            <motion.div
              key="verdict-toast"
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-2xl text-sm font-bold shadow-xl backdrop-blur-xl flex items-center gap-2 border pointer-events-none ${
                verdictToast.type === 'good'
                  ? 'bg-emerald-600/90 text-white border-emerald-400/50 shadow-emerald-900/50'
                  : verdictToast.type === 'bad'
                  ? 'bg-rose-600/90 text-white border-rose-400/50 shadow-rose-900/50'
                  : 'bg-slate-700/90 text-white border-white/20'
              }`}
            >
              <span>{verdictToast.type === 'good' ? '🏆' : verdictToast.type === 'bad' ? '👎' : '⚠️'}</span>
              <span>{verdictToast.msg}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Top Capsule Header ── */}
        <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500/30 to-cyan-500/20 border border-emerald-400/40 flex items-center justify-center text-xl shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              🧠
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold bg-gradient-to-r from-emerald-300 via-cyan-200 to-white bg-clip-text text-transparent">
                  Friday Autonomous Training Capsule
                </h2>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-mono text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE LEARNING
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Self-play drills, continuous behavioral training, golden answers & real-time style assimilation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleRunPracticeDrill()}
              disabled={drillingNow}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-xs font-semibold text-white shadow-lg shadow-emerald-900/30 transition disabled:opacity-50"
            >
              {drillingNow ? (
                <>
                  <span className="animate-spin">⚡</span>
                  <span>Simulating Drill...</span>
                </>
              ) : (
                <>
                  <span>🏋️</span>
                  <span>Practice Now</span>
                </>
              )}
            </button>

            <button
              onClick={() => setShowTeachModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-white/10 text-xs font-medium text-slate-200 transition"
            >
              <span>➕</span>
              <span className="hidden sm:inline">Teach Lesson</span>
            </button>

            <button
              onClick={fetchData}
              disabled={loading}
              title="Refresh Data"
              className="p-2 rounded-xl bg-slate-850 hover:bg-slate-800 border border-white/10 text-slate-300 transition"
            >
              <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="p-2 rounded-xl bg-slate-800/60 hover:bg-red-500/20 text-slate-400 hover:text-red-300 transition border border-white/5"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* ── Key Metrics Overview Strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 bg-slate-900/40 border-b border-white/5">
          <div className="p-3 rounded-2xl bg-slate-900/70 border border-emerald-500/20">
            <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <span>📚</span> Total Lessons
            </div>
            <div className="text-xl font-bold text-emerald-300 mt-1 font-mono">
              {stats?.totalLessons || lessons.length}
            </div>
            <div className="text-[10px] text-emerald-400/80 mt-0.5">Behavioral anchors locked</div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900/70 border border-cyan-500/20">
            <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <span>🏋️</span> Self-Play Drills
            </div>
            <div className="text-xl font-bold text-cyan-300 mt-1 font-mono">
              {stats?.totalDrills || drills.length}
            </div>
            <div className="text-[10px] text-cyan-400/80 mt-0.5">Avg Score: 10/10</div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900/70 border border-amber-500/20">
            <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <span>🏆</span> Golden Answers
            </div>
            <div className="text-xl font-bold text-amber-300 mt-1 font-mono">
              {stats?.totalGolden || goldenStandards.length}
            </div>
            <div className="text-[10px] text-amber-400/80 mt-0.5">Boss praised (100% ideal)</div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900/70 border border-pink-500/20">
            <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <span>💖</span> Boss RLHF Approval
            </div>
            <div className="text-xl font-bold text-pink-300 mt-1 font-mono">
              {stats?.approvalRate || 100}%
            </div>
            <div className="text-[10px] text-pink-400/80 mt-0.5">{stats?.totalRlhf || rlhfHistory.length} reaction signals</div>
          </div>

          <div className="col-span-2 sm:col-span-1 p-3 rounded-2xl bg-slate-900/70 border border-indigo-500/20">
            <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <span>👁️</span> Style Samples
            </div>
            <div className="text-xl font-bold text-indigo-300 mt-1 font-mono">
              {stats?.observedSamples || bossStyle?.observedSampleCount || 0}
            </div>
            <div className="text-[10px] text-indigo-400/80 mt-0.5">Mirroring Boss Hinglish</div>
          </div>
        </div>

        {/* ── Navigation Tabs ── */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-white/10 bg-slate-950/60 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('drills')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'drills'
                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <span>🏋️</span>
            <span>Khud Se Practice ({drills.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('golden')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'golden'
                ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <span>🏆</span>
            <span>Best Answers ({goldenStandards.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('lessons')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'lessons'
                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <span>📚</span>
            <span>Lessons & Rules ({lessons.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('rlhf')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'rlhf'
                ? 'bg-pink-500/20 text-pink-200 border border-pink-500/40 shadow-[0_0_15px_rgba(236,72,153,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <span>🎯</span>
            <span>RLHF Reactions ({rlhfHistory.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('style')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'style'
                ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <span>👁️</span>
            <span>Shadow Mode Style</span>
          </button>

          <button
            onClick={() => setActiveTab('groups')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'groups'
                ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40 shadow-[0_0_15px_rgba(139,92,246,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <span>👥</span>
            <span>Group Intelligence ({groupProfiles.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('dreams')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
              activeTab === 'dreams'
                ? 'bg-teal-500/20 text-teal-200 border border-teal-500/40 shadow-[0_0_15px_rgba(20,184,166,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <span>🌙</span>
            <span>Night Consolidation</span>
          </button>
        </div>

        {/* ── Search & Filter Bar ── */}
        <div className="px-6 py-2.5 bg-slate-900/30 border-b border-white/5 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <span className="text-slate-400">🔍</span>
            <input
              type="text"
              placeholder="Search drills, lessons, keywords, or takeaways..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-slate-200 placeholder:text-slate-500 text-xs w-full"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-white">
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>Mood: <b className="text-emerald-400">{stats?.currentMood || 'caring_supportive'}</b></span>
            <span>•</span>
            <span>Tier: <b className="text-cyan-400">Cognitive Tier 5</b></span>
          </div>
        </div>

        {/* ── Tab Content Area ── */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* TAB 1: KHUD SE PRACTICE (SELF-PLAY GYM) */}
          {activeTab === 'drills' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-cyan-200 flex items-center gap-2">
                    <span>🏋️</span> Autonomous Self-Play Practice Drills (OpenAI / DeepMind Gym)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Friday continuously runs simulated high-difficulty scenarios in the background to practice empathy, crisis rescue, and diplomacy.
                  </p>
                </div>
                <button
                  onClick={() => handleRunPracticeDrill()}
                  disabled={drillingNow}
                  className="px-3 py-1.5 rounded-xl bg-cyan-600/30 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  {drillingNow ? <span className="animate-spin">⚡</span> : <span>+</span>}
                  <span>Practice New Scenario</span>
                </button>
              </div>

              {drills.length === 0 ? (
                <div className="p-12 text-center text-slate-400 bg-slate-900/30 rounded-2xl border border-white/5">
                  <div className="text-3xl mb-2">🏋️</div>
                  <p>Abhi tak koi drill record nahi hui hai.</p>
                  <button
                    onClick={() => handleRunPracticeDrill()}
                    className="mt-3 px-4 py-1.5 rounded-xl bg-cyan-600 text-white text-xs font-semibold hover:bg-cyan-500 transition"
                  >
                    Run First Practice Drill
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {drills
                    .filter((d) =>
                      !searchQuery ||
                      d.scenarioTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      d.keyTakeaway.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      d.trialResponse.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (d.sourceLessonTitle && d.sourceLessonTitle.toLowerCase().includes(searchQuery.toLowerCase()))
                    )
                    .map((drill) => (
                      <div
                        key={drill.id}
                        className="p-4 rounded-2xl bg-slate-900/80 border border-cyan-500/20 hover:border-cyan-500/40 transition shadow-sm space-y-3"
                      >
                        {/* Source Lesson Badge if drill was synthesized from Boss's lesson */}
                        {drill.sourceLessonTitle && (
                          <div className="flex items-center gap-1.5 text-xs text-amber-300 font-semibold bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                            <span>🎯 Based on Boss's Lesson:</span>
                            <span className="truncate italic">"{drill.sourceLessonTitle}"</span>
                          </div>
                        )}

                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono uppercase bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                              {drill.category.replace('_', ' ')}
                            </span>
                            <h4 className="text-sm font-bold text-slate-100 mt-1">{drill.scenarioTitle}</h4>
                          </div>

                          {/* Friday's Self-Critic Rating */}
                          <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold font-mono">
                            ★ {drill.selfCriticScore || drill.criticScore}/10
                          </div>
                        </div>

                        {/* Situation Created by Friday */}
                        <div className="p-3 rounded-xl bg-slate-950/80 border border-cyan-500/20 space-y-1">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1">
                            <span>⚡</span> Situation Created by Friday (Autonomous Test)
                          </div>
                          <p className="text-xs text-slate-200 font-medium leading-relaxed">
                            "{drill.simulatedBossQuery}"
                          </p>
                        </div>

                        {/* Friday's Trial Response */}
                        <div className="p-3 rounded-xl bg-slate-950/80 border border-indigo-500/20 space-y-1">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1">
                            <span>🤖</span> Friday's Trial Response
                          </div>
                          <p className="text-xs text-slate-200 italic leading-relaxed">
                            "{drill.trialResponse}"
                          </p>
                        </div>

                        {/* Friday's Self Critique */}
                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-white/10 space-y-1">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                            <span>🔍</span> Friday's Self-Evaluation & Critique
                          </div>
                          <p className="text-xs text-slate-300">
                            {drill.selfCritique || drill.keyTakeaway}
                          </p>
                        </div>

                        {/* Key Lesson Internalized */}
                        <div className="p-2 rounded-xl bg-gradient-to-r from-emerald-950/40 to-cyan-950/40 border border-emerald-500/20 text-xs text-emerald-200">
                          <span className="font-semibold text-emerald-400">💡 Internalized Takeaway:</span> {drill.keyTakeaway}
                        </div>

                        {/* Boss Review & Reaction Marking (Good / Bad) */}
                        <div className="pt-2 border-t border-white/5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="text-slate-400 font-medium text-[11px]">👑 Boss Verdict:</span>
                              {drill.bossVerdict === 'good' ? (
                                <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-[11px] flex items-center gap-1">
                                  <span>👍 Passed (Curated 10/10)</span>
                                </span>
                              ) : drill.bossVerdict === 'bad' ? (
                                <span className="px-2 py-0.5 rounded-md bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold text-[11px] flex items-center gap-1">
                                  <span>👎 Needs Fix</span>
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-500 italic">Unreviewed</span>
                              )}
                            </div>

                            {/* Good / Bad Reaction Action Buttons */}
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleMarkVerdict(drill.id, 'good')}
                                disabled={markingVerdict[drill.id]}
                                title="Mark Good: Approves response and saves to Best Answers"
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                                  drill.bossVerdict === 'good'
                                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40 ring-1 ring-emerald-400'
                                    : 'bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30'
                                }`}
                              >
                                <span>👍 Good</span>
                              </button>

                              <button
                                onClick={() => handleMarkVerdict(drill.id, 'bad')}
                                disabled={markingVerdict[drill.id]}
                                title="Mark Bad: Downvote and prompt Friday to retry & correct"
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                                  drill.bossVerdict === 'bad'
                                    ? 'bg-rose-600 text-white shadow-md shadow-rose-900/40 ring-1 ring-rose-400'
                                    : 'bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                <span>👎 Bad</span>
                              </button>
                            </div>
                          </div>

                          {/* Inline Retry & Fix Box (shown on Bad or when Boss wants to adjust) */}
                          {(showRetryInput[drill.id] || drill.bossVerdict === 'bad') && (
                            <div className="p-2.5 rounded-xl bg-rose-950/30 border border-rose-500/30 space-y-2 text-xs">
                              <div className="text-[11px] font-semibold text-rose-300 flex items-center gap-1">
                                <span>✍️</span> Boss Correction Feedback:
                              </div>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={retryInstruction[drill.id] || ''}
                                  onChange={(e) =>
                                    setRetryInstruction((prev) => ({ ...prev, [drill.id]: e.target.value }))
                                  }
                                  placeholder="e.g. Zyada polite bolo, direct answer do..."
                                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500"
                                />
                                <button
                                  onClick={() => handleRetryDrill(drill.id)}
                                  disabled={retryingDrill[drill.id]}
                                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition disabled:opacity-50 flex items-center gap-1"
                                >
                                  {retryingDrill[drill.id] ? (
                                    <span className="animate-spin">⚡</span>
                                  ) : (
                                    <span>⚡ Retry & Fix</span>
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="text-[10px] text-slate-500 flex justify-between items-center pt-1">
                          <span>Autonomous Simulation</span>
                          <span>
                            {new Date(drill.timestamp).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: BEST ANSWERS (GOLDEN BENCHMARKS) */}
          {activeTab === 'golden' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                  <span>🏆</span> Golden Standard Benchmarks (Boss Praised Responses)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Whenever Boss DK praises Friday (e.g. <i>"shabash"</i>, <i>"perfect"</i>, <i>"proud of you"</i>), the dialogue pair is permanently curated here as a 10/10 ideal few-shot benchmark.
                </p>
              </div>

              {goldenStandards.length === 0 ? (
                <div className="p-12 text-center text-slate-400 bg-slate-900/30 rounded-2xl border border-white/5">
                  <div className="text-3xl mb-2">🏆</div>
                  <p>Abhi tak koi Golden Standard curate nahi hua hai.</p>
                  <p className="text-xs text-slate-500 mt-1">Jab bhi aap WhatsApp/Telegram par Friday ko "shabash" ya "perfect" bolenge, wo response yaha automatically 10/10 benchmark ban jayega!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {goldenStandards
                    .filter((g) =>
                      !searchQuery ||
                      g.userPrompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      g.idealResponse.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      g.praiseTrigger.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((item) => (
                      <div
                        key={item.id}
                        className="p-4 rounded-2xl bg-slate-900/70 border border-amber-500/20 hover:border-amber-500/40 transition space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold flex items-center gap-1">
                            <span>💬 Boss Praise Trigger:</span> "{item.praiseTrigger}"
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-xs font-bold font-mono">
                            Score: 10/10 Perfect
                          </span>
                        </div>

                        <div className="space-y-2 text-xs">
                          <div className="p-3 rounded-xl bg-slate-950/80 border border-white/5 text-slate-300">
                            <b className="text-slate-400">Boss Query / Context:</b> {item.userPrompt}
                          </div>
                          <div className="p-3 rounded-xl bg-gradient-to-r from-amber-950/30 to-slate-900/80 border border-amber-500/30 text-amber-100">
                            <b className="text-amber-400">Friday's Ideal Response:</b> {item.idealResponse}
                          </div>
                        </div>

                        <div className="text-[10px] text-slate-500 flex justify-between items-center">
                          <span>Auto-curated via Boss Praise Feedback</span>
                          <span>{new Date(item.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: LESSONS & PLAYBOOK */}
          {activeTab === 'lessons' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-emerald-200 flex items-center gap-2">
                    <span>📚</span> Behavioral Playbook & Elastic Anchor Lessons
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Permanent life lessons taught to Friday. Anchor lessons (Priority 100) are immune to catastrophic forgetting.
                  </p>
                </div>
                <button
                  onClick={() => setShowTeachModal(true)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <span>➕</span>
                  <span>Teach New Lesson</span>
                </button>
              </div>

              {lessons.length === 0 ? (
                <div className="p-12 text-center text-slate-400 bg-slate-900/30 rounded-2xl border border-white/5">
                  <div className="text-3xl mb-2">📚</div>
                  <p>Koi lesson load nahi hua.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {lessons
                    .filter((l) =>
                      !searchQuery ||
                      l.situationTrigger.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      l.taughtReaction.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((lesson) => (
                      <div
                        key={lesson.id}
                        className="p-4 rounded-2xl bg-slate-900/70 border border-emerald-500/20 hover:border-emerald-500/40 transition space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            {lesson.category.replace('_', ' ')}
                          </span>
                          {lesson.isAnchor && (
                            <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30">
                              ⚓ Anchor Priority {lesson.anchorPriority || 100}
                            </span>
                          )}
                        </div>

                        <div className="space-y-1.5 text-xs">
                          <div>
                            <span className="font-semibold text-slate-400">Situation:</span>{' '}
                            <span className="text-slate-200 font-medium">{lesson.situationTrigger}</span>
                          </div>
                          <div>
                            <span className="font-semibold text-emerald-400">Taught Reaction:</span>{' '}
                            <span className="text-emerald-200">{lesson.taughtReaction}</span>
                          </div>
                          {lesson.idealSampleResponse && (
                            <div className="p-2 rounded-lg bg-slate-950/60 text-slate-300 italic border border-white/5">
                              "{lesson.idealSampleResponse}"
                            </div>
                          )}
                        </div>

                        <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                          <span className="text-[10px] text-slate-500">
                            {new Date(lesson.updatedAt || Date.now()).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                          </span>
                          <button
                            onClick={() => handlePracticeSpecificLesson(lesson)}
                            disabled={drillingNow}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold flex items-center gap-1 transition disabled:opacity-50"
                            title="Ask Friday to create a situation and practice this exact lesson"
                          >
                            <span>🏋️</span>
                            <span>Practice This Lesson</span>
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: RLHF REACTIONS */}
          {activeTab === 'rlhf' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-pink-200 flex items-center gap-2">
                  <span>🎯</span> RLHF Reaction Rewards & Feedback Signals
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Real-time emoji reactions from WhatsApp and Telegram logged for Reinforcement Learning (❤️, 👍, 🔥 vs 👎, 😡).
                </p>
              </div>

              {rlhfHistory.length === 0 ? (
                <div className="p-12 text-center text-slate-400 bg-slate-900/30 rounded-2xl border border-white/5">
                  <div className="text-3xl mb-2">🎯</div>
                  <p>Abhi tak koi RLHF reaction record nahi hui hai.</p>
                  <p className="text-xs text-slate-500 mt-1">WhatsApp ya Telegram par kisi message par ❤️ ya 👍 react karke dekhein!</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {rlhfHistory
                    .filter((r) =>
                      !searchQuery ||
                      r.targetMessageText.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      r.bossFeedbackAnalysis.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((item) => (
                      <div
                        key={item.id}
                        className="p-3.5 rounded-2xl bg-slate-900/70 border border-pink-500/20 flex items-start justify-between gap-3 text-xs"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-pink-500/15 border border-pink-500/30 flex items-center justify-center text-2xl">
                            {item.emoji}
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold font-mono uppercase ${
                                  item.sentiment === 'positive'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : item.sentiment === 'negative'
                                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                    : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                                }`}
                              >
                                {item.sentiment} reward
                              </span>
                              <span className="text-slate-400 text-[11px]">From: {item.targetSender}</span>
                            </div>
                            <div className="text-slate-200">
                              <b>Message:</b> "{item.targetMessageText}"
                            </div>
                            <div className="text-pink-300 text-[11px]">
                              <b>Analysis:</b> {item.bossFeedbackAnalysis}
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">
                          {new Date(item.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: SHADOW MODE STYLE */}
          {activeTab === 'style' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-indigo-200 flex items-center gap-2">
                  <span>👁️</span> Shadow Mode Style Assimilation (Tesla FSD-Style Imitation Learning)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Friday passively analyzes Boss DK's authentic messages to mirror your unique cadence, slangs, vocabulary shortcuts, and favorite emojis.
                </p>
              </div>

              {bossStyle ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-slate-900/70 border border-indigo-500/20 space-y-3">
                    <h4 className="text-xs font-bold text-indigo-300 uppercase tracking-wider">
                      Boss's Natural Slangs & Keywords Learned
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {bossStyle.slangTokens.map((slang, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 text-xs font-mono font-semibold"
                        >
                          "{slang}"
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-900/70 border border-indigo-500/20 space-y-3">
                    <h4 className="text-xs font-bold text-indigo-300 uppercase tracking-wider">
                      Favorite Emojis & Cadence
                    </h4>
                    <div className="flex items-center gap-2">
                      {bossStyle.favoriteEmojis.map((emoji, idx) => (
                        <span key={idx} className="text-2xl p-1.5 rounded-xl bg-slate-950 border border-white/5">
                          {emoji}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-slate-400 space-y-1 pt-1">
                      <p>• Observed Samples: <b className="text-slate-200">{bossStyle.observedSampleCount} messages</b></p>
                      <p>• Preferred Tone: <b className="text-slate-200">{bossStyle.toneCharacteristics?.join(', ') || 'confident, witty'}</b></p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-12 text-center text-slate-400 bg-slate-900/30 rounded-2xl border border-white/5">
                  <p>Shadow style profile initializing...</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: GROUP COLLECTIVE INTELLIGENCE */}
          {activeTab === 'groups' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-violet-200 flex items-center gap-2">
                  <span>👥</span> Group Collective Intelligence & Dynamic Slangs
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Friday observes group discussions on WhatsApp and Telegram, tracking member culture, active topics, and group inside jokes without leaking secrets.
                </p>
              </div>

              {groupProfiles.length === 0 ? (
                <div className="p-12 text-center text-slate-400 bg-slate-900/30 rounded-2xl border border-white/5">
                  <div className="text-3xl mb-2">👥</div>
                  <p>Abhi tak koi group profile create nahi hui hai.</p>
                  <p className="text-xs text-slate-500 mt-1">Jab WhatsApp ya Telegram groups me baatein hoti hain, Friday context capture kar leti hai.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {groupProfiles.map((grp) => (
                    <div
                      key={grp.groupId}
                      className="p-4 rounded-2xl bg-slate-900/70 border border-violet-500/20 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-violet-200">{grp.groupTitle}</h4>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono uppercase bg-violet-500/20 text-violet-300 border border-violet-500/30">
                          {grp.platform}
                        </span>
                      </div>

                      {grp.slangTokens?.length > 0 && (
                        <div>
                          <div className="text-[11px] text-slate-400 mb-1">Group Slangs & Inside Jokes:</div>
                          <div className="flex flex-wrap gap-1.5">
                            {grp.slangTokens.map((s, i) => (
                              <span key={i} className="px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-300 text-[11px] font-mono">
                                #{s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {grp.lastSummary && (
                        <div className="p-2.5 rounded-xl bg-slate-950/70 border border-white/5 text-xs text-slate-300">
                          <b className="text-violet-300">Latest Digest:</b> {grp.lastSummary.slice(0, 160)}...
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 7: NIGHT CONSOLIDATION & STREAM */}
          {activeTab === 'dreams' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-teal-200 flex items-center gap-2">
                    <span>🌙</span> Night Dream Consolidation & Stream of Consciousness
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    DeepMind hippocampal memory replay: Reconciles daily interactions and synthesizes meta-realizations.
                  </p>
                </div>
                <button
                  onClick={handleRunDreamConsolidation}
                  disabled={dreamingNow}
                  className="px-3 py-1.5 rounded-xl bg-teal-600/30 border border-teal-500/40 text-teal-200 hover:bg-teal-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  {dreamingNow ? <span className="animate-spin">🌙</span> : <span>✨</span>}
                  <span>Consolidate Dreams Now</span>
                </button>
              </div>

              {/* Active Realizations */}
              <div className="p-4 rounded-2xl bg-teal-950/30 border border-teal-500/30 space-y-2">
                <h4 className="text-xs font-bold text-teal-300 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🧠</span> Active Generative Realizations About Boss DK
                </h4>
                <ul className="space-y-1.5 text-xs text-teal-100">
                  {realizations.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-teal-400 font-bold">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Dream Logs */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Consolidated Memory Ledgers
                </h4>
                {dreamLogs.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 bg-slate-900/30 rounded-xl border border-white/5 text-xs">
                    Abhi tak koi dream ledger generate nahi hua hai. Tap "Consolidate Dreams Now" to trigger.
                  </div>
                ) : (
                  dreamLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3.5 rounded-2xl bg-slate-900/60 border border-teal-500/20 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between text-teal-300 font-bold">
                        <span>🌙 {log.dateStr}</span>
                        <span className="text-[11px] text-slate-400 font-normal">
                          {new Date(log.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        </span>
                      </div>
                      <p className="text-slate-300">{log.personalityEvolutionSummary}</p>
                      {log.coreLearnings?.length > 0 && (
                        <div className="p-2 rounded-xl bg-slate-950/60 text-[11px] text-teal-200">
                          <b>Core Learnings:</b> {log.coreLearnings.join(' • ')}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Teach Lesson Modal Overlay ── */}
        <AnimatePresence>
          {showTeachModal && (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full max-w-lg p-6 rounded-3xl bg-slate-900 border border-emerald-500/40 shadow-2xl space-y-4 text-slate-100"
              >
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">👩‍🏫</span>
                    <h3 className="text-sm font-bold text-emerald-300">Teach Friday a New Behavioral Rule</h3>
                  </div>
                  <button onClick={() => setShowTeachModal(false)} className="text-slate-400 hover:text-white">
                    ✕
                  </button>
                </div>

                <form onSubmit={handleTeachSubmit} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Situation / Trigger Context (Jab aisa ho...):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Jab Boss bohot thake hue hon ya sar dard ho"
                      value={teachSituation}
                      onChange={(e) => setTeachSituation(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-slate-100 focus:border-emerald-500 outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Taught Reaction (Toh tumhe aisa behave karna hai):
                    </label>
                    <textarea
                      rows={3}
                      placeholder="e.g. Bohot softly baat karna, koi dry advice mat dena, bas comfort dena aur chai/paani lene bolna"
                      value={teachReaction}
                      onChange={(e) => setTeachReaction(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-slate-100 focus:border-emerald-500 outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Category:</label>
                    <select
                      value={teachCategory}
                      onChange={(e) => setTeachCategory(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-slate-100 focus:border-emerald-500 outline-none"
                    >
                      <option value="emotional_comfort">❤️ Emotional Comfort & Empathy</option>
                      <option value="relationship_advice">🤝 Relationship & Social Etiquette</option>
                      <option value="task_execution">⚡ Task Execution & Speed</option>
                      <option value="voice_tone">🎙️ Voice Tone & Softness</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowTeachModal(false)}
                      className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={teachingLoading}
                      className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-semibold shadow transition disabled:opacity-50"
                    >
                      {teachingLoading ? 'Locking In...' : 'Lock In Lesson ⚓'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
