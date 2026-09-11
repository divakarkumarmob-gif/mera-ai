import React, { useState, useEffect, useCallback } from 'react';
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
  scenarioTitle: string;
  category: 'emotional_empathy' | 'crisis_rescue' | 'coding_architecture' | 'diplomatic_handling';
  simulatedBossQuery: string;
  trialResponse: string;
  criticScore: number;
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
  onClose?: () => void;
  isFloatingWidgetOnly?: boolean;
  onExpandToStudio?: () => void;
}

export const LearningCapsule: React.FC<LearningCapsuleProps> = ({
  onClose,
  isFloatingWidgetOnly = false,
  onExpandToStudio,
}) => {
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

  // Teach modal form
  const [showTeachModal, setShowTeachModal] = useState(false);
  const [teachSituation, setTeachSituation] = useState('');
  const [teachReaction, setTeachReaction] = useState('');
  const [teachCategory, setTeachCategory] = useState<'emotional_comfort' | 'task_execution' | 'relationship_advice' | 'voice_tone'>('emotional_comfort');
  const [teachingLoading, setTeachingLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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

  // Run autonomous practice drill on-demand
  const handleRunPracticeDrill = async () => {
    if (drillingNow) return;
    setDrillingNow(true);
    try {
      const res = await fetch('/api/learning/practice-drill', { method: 'POST' });
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
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        className="fixed bottom-24 right-6 z-40"
      >
        <div className="relative group">
          <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-indigo-500 opacity-70 blur-md group-hover:opacity-100 transition duration-500 animate-pulse" />
          <div className="relative flex items-center gap-3 px-4 py-2.5 rounded-full bg-slate-950/90 border border-emerald-500/40 backdrop-blur-xl shadow-[0_0_30px_rgba(16,185,129,0.3)] text-slate-100">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>

            <div
              onClick={() => {
                if (onExpandToStudio) onExpandToStudio();
                else setIsExpanded(true);
              }}
              className="cursor-pointer flex items-center gap-2"
            >
              <span className="text-sm font-bold bg-gradient-to-r from-emerald-300 via-cyan-200 to-white bg-clip-text text-transparent">
                🧠 Cognition Capsule
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                {stats?.totalLessons || 0} Lessons
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono hidden sm:inline">
                {stats?.totalDrills || 0} Drills
              </span>
            </div>

            <button
              onClick={handleRunPracticeDrill}
              disabled={drillingNow}
              title="Trigger instant self-practice drill"
              className="p-1.5 rounded-full hover:bg-emerald-500/20 text-emerald-400 transition"
            >
              {drillingNow ? <span className="animate-spin text-xs">⚡</span> : <span className="text-xs">🏋️</span>}
            </button>

            <button
              onClick={() => {
                if (onExpandToStudio) onExpandToStudio();
                else setIsExpanded(true);
              }}
              className="px-2.5 py-1 rounded-full bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-xs font-semibold text-white shadow transition"
            >
              View All ↗
            </button>
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

        {/* ── Top Capsule Header ── */}
        <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500/30 to-cyan-500/20 border border-emerald-400/40 flex items-center justify-center text-xl shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              🧠
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold bg-gradient-to-r from-emerald-300 via-cyan-200 to-white bg-clip-text text-transparent">
                  Friday Autonomous Cognition Capsule
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
              onClick={handleRunPracticeDrill}
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
                  onClick={handleRunPracticeDrill}
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
                    onClick={handleRunPracticeDrill}
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
                      d.trialResponse.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((drill) => (
                      <div
                        key={drill.id}
                        className="p-4 rounded-2xl bg-slate-900/70 border border-cyan-500/20 hover:border-cyan-500/40 transition shadow-sm space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono uppercase bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                              {drill.category.replace('_', ' ')}
                            </span>
                            <h4 className="text-sm font-bold text-slate-100 mt-1">{drill.scenarioTitle}</h4>
                          </div>
                          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold font-mono">
                            ★ {drill.criticScore}/10
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-950/80 border border-white/5 space-y-1.5 text-xs">
                          <div className="text-slate-400">
                            <span className="font-semibold text-slate-300">Simulated Situation:</span> "{drill.simulatedBossQuery}"
                          </div>
                          <div className="text-cyan-200">
                            <span className="font-semibold text-cyan-400">Friday's Response:</span> "{drill.trialResponse}"
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-gradient-to-r from-emerald-950/40 to-cyan-950/40 border border-emerald-500/30 text-xs text-emerald-200">
                          <span className="font-semibold text-emerald-400">💡 Key Lesson Internalized:</span> {drill.keyTakeaway}
                        </div>

                        <div className="text-[10px] text-slate-500 flex justify-between items-center">
                          <span>Autonomous Simulation</span>
                          <span>{new Date(drill.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</span>
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

                        <div className="text-[10px] text-slate-500 text-right">
                          {new Date(lesson.updatedAt || Date.now()).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
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
