import React, { useState, useEffect, useRef } from "react";
import { X, Play, Pause, SkipForward, SkipBack, Check, Music2, Sparkles, Volume2, Disc3, Radio } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface PreviewCandidate {
  id: string;
  songName: string;
  artistName: string;
  albumName?: string;
  albumArt?: string;
  previewUrl?: string;
  fullAudioUrl?: string;
  audio320kbps?: string;
  durationSec?: number;
  source?: 'spotify' | 'jiosaavn' | 'youtube';
  videoId?: string;
  embedUrl?: string;
}

interface SongPreviewModalProps {
  isOpen: boolean;
  query: string;
  candidates: PreviewCandidate[];
  currentIndex: number;
  onClose: () => void;
  onSelectCandidate: (candidate: PreviewCandidate) => void;
  onNextPreview?: () => void;
  onPrevPreview?: () => void;
}

export const SongPreviewModal: React.FC<SongPreviewModalProps> = ({
  isOpen,
  query,
  candidates = [],
  currentIndex = 0,
  onClose,
  onSelectCandidate,
  onNextPreview,
  onPrevPreview,
}) => {
  const [isPlayingPreview, setIsPlayingPreview] = useState(true);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const activeCandidate = candidates[currentIndex] || candidates[0];

  // Initialize and play preview audio whenever active candidate changes
  useEffect(() => {
    if (!isOpen || !activeCandidate) return;

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = "";
      previewAudioRef.current = null;
    }

    const audioUrl = activeCandidate.previewUrl || activeCandidate.audio320kbps || activeCandidate.fullAudioUrl;
    if (audioUrl && activeCandidate.source !== 'youtube') {
      const audio = new Audio();
      audio.src = audioUrl;
      audio.volume = 0.85;

      audio.ontimeupdate = () => {
        setPreviewCurrentTime(audio.currentTime);
        const dur = audio.duration || 30;
        setPreviewProgress((audio.currentTime / Math.min(30, dur)) * 100);
        if (audio.currentTime >= 30) {
          audio.pause();
          setIsPlayingPreview(false);
        }
      };

      audio.onended = () => {
        setIsPlayingPreview(false);
        setPreviewProgress(100);
      };

      audio.onerror = () => {
        console.warn("[Preview] Preview audio failed to load on URL:", audioUrl);
        setIsPlayingPreview(false);
      };

      previewAudioRef.current = audio;
      audio.play().then(() => {
        setIsPlayingPreview(true);
      }).catch(err => {
        console.warn("[Preview] Autoplay preview catch:", err);
        setIsPlayingPreview(false);
      });
    } else {
      setIsPlayingPreview(true);
      setPreviewProgress(0);
    }

    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.src = "";
        previewAudioRef.current = null;
      }
    };
  }, [isOpen, currentIndex, activeCandidate]);

  const togglePreviewPlayPause = () => {
    if (activeCandidate?.source === 'youtube' || activeCandidate?.videoId) {
      try {
        const iframe = document.getElementById('youtube-preview-iframe') as HTMLIFrameElement;
        if (isPlayingPreview) {
          iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
          setIsPlayingPreview(false);
        } else {
          iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
          setIsPlayingPreview(true);
        }
      } catch {}
      return;
    }

    if (!previewAudioRef.current) return;
    if (isPlayingPreview) {
      previewAudioRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      previewAudioRef.current.play().catch(() => {});
      setIsPlayingPreview(true);
    }
  };

  const handleConfirm = () => {
    if (activeCandidate) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      onSelectCandidate(activeCandidate);
    }
  };

  if (!isOpen || !activeCandidate) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200">
      {/* Hidden YouTube Preview IFrame */}
      {activeCandidate.videoId && (
        <iframe
          id="youtube-preview-iframe"
          src={`https://www.youtube-nocookie.com/embed/${activeCandidate.videoId}?autoplay=1&enablejsapi=1&controls=0&playsinline=1`}
          className="fixed -top-[9999px] -left-[9999px] w-1 h-1 pointer-events-none"
          allow="autoplay; encrypted-media"
        />
      )}

      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="relative w-full max-w-lg bg-zinc-950/95 border border-cyan-500/40 rounded-3xl p-6 shadow-[0_0_50px_rgba(6,182,212,0.3)] text-white flex flex-col overflow-hidden"
      >
        {/* Background Ambient Glow */}
        <div className="absolute -top-20 -right-20 w-52 h-52 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none animate-pulse" />
        <div className="absolute -bottom-20 -left-20 w-52 h-52 bg-fuchsia-500/20 rounded-full blur-3xl pointer-events-none animate-pulse delay-500" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-fuchsia-500 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.5)]">
              <Radio className="w-4 h-4 text-white animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Song Disambiguation & 30s Previews</h3>
              <p className="text-[11px] text-zinc-400">
                Playing Candidate {currentIndex + 1} of {candidates.length}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Active Candidate Card */}
        <div className="mt-4 p-4 rounded-2xl bg-zinc-900/80 border border-white/10 shadow-lg relative overflow-hidden">
          <div className="flex items-center gap-4">
            {/* Spinning Vinyl Album Art */}
            <div className="relative flex-shrink-0">
              <div
                className={`w-20 h-20 rounded-2xl overflow-hidden border-2 border-cyan-400/60 shadow-xl ${
                  isPlayingPreview ? "animate-[spin_10s_linear_infinite]" : ""
                }`}
                style={{ borderRadius: "50%" }}
              >
                {activeCandidate.albumArt ? (
                  <img src={activeCandidate.albumArt} alt={activeCandidate.songName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                    <Music2 className="w-8 h-8 text-cyan-400" />
                  </div>
                )}
                {/* Vinyl Spindle Center */}
                <div className="absolute inset-0 m-auto w-4 h-4 bg-black border-2 border-cyan-300 rounded-full" />
              </div>
            </div>

            {/* Candidate Metadata */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                {activeCandidate.source === "youtube" ? (
                  <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-950/80 border border-rose-500/50 text-[10px] font-bold text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.3)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                    <span>🔴 YouTube Pro Preview</span>
                  </div>
                ) : activeCandidate.source === "spotify" ? (
                  <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#1DB954]/20 border border-[#1DB954]/50 text-[10px] font-bold text-[#1ed760] shadow-[0_0_10px_rgba(29,185,84,0.3)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1ed760] animate-ping" />
                    <span>🟢 Spotify 30s Master Preview</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-400/40 text-[10px] font-bold text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>🟡 JioSaavn 30s Preview</span>
                  </div>
                )}
              </div>
              <h4 className="font-bold text-base text-white truncate">{activeCandidate.songName}</h4>
              <p className="text-xs text-zinc-400 truncate mt-0.5">{activeCandidate.artistName}</p>
              {activeCandidate.albumName && (
                <p className="text-[11px] text-zinc-500 truncate mt-0.5">Album: {activeCandidate.albumName}</p>
              )}
            </div>
          </div>

          {/* 30-Second Preview Progress Bar */}
          <div className="mt-4 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
              <span>Preview: {Math.floor(previewCurrentTime)}s</span>
              <span>0:30 max</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 rounded-full transition-all duration-200"
                style={{ width: `${previewProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Candidate Switcher & Action Controls */}
        <div className="flex items-center justify-between gap-3 mt-4 pt-1">
          {/* Previous Preview */}
          <button
            onClick={onPrevPreview}
            disabled={candidates.length <= 1}
            className="flex-1 py-2.5 px-3 rounded-2xl bg-zinc-900 border border-white/10 hover:border-cyan-400/40 hover:text-cyan-300 text-zinc-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 active:scale-95"
          >
            <SkipBack className="w-3.5 h-3.5" />
            <span>Pichhla</span>
          </button>

          {/* Play / Pause Preview */}
          <button
            onClick={togglePreviewPlayPause}
            className="w-11 h-11 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-white flex items-center justify-center transition-transform active:scale-90 shadow-md"
          >
            {isPlayingPreview ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          {/* Next Preview */}
          <button
            onClick={onNextPreview}
            disabled={candidates.length <= 1}
            className="flex-1 py-2.5 px-3 rounded-2xl bg-zinc-900 border border-white/10 hover:border-cyan-400/40 hover:text-cyan-300 text-zinc-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 active:scale-95"
          >
            <span>Agla (Next)</span>
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Primary Confirmation Button: Launch full 320kbps on JioSaavn */}
        <button
          onClick={handleConfirm}
          className="w-full mt-3 py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(6,182,212,0.5)] transition-transform hover:scale-[1.02] active:scale-98 cursor-pointer"
        >
          <Check className="w-4 h-4 stroke-[3]" />
          <span>Haan, Yeh Wala JioSaavn 320kbps Par Bajao! 🎵</span>
        </button>

        {/* Voice Control Hints */}
        <div className="mt-3.5 flex items-center justify-center gap-2 text-[11px] text-zinc-400 flex-wrap">
          <span className="text-zinc-500">Friday Voice Commands:</span>
          <span className="px-2 py-0.5 rounded-lg bg-zinc-900 border border-white/5 text-zinc-300">
            "Agla wala / Next"
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-zinc-900 border border-white/5 text-zinc-300">
            "Pichhla / Prev"
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-cyan-950/70 border border-cyan-400/30 text-cyan-300 font-semibold">
            "Haan yeh wala bajao"
          </span>
        </div>
      </motion.div>
    </div>
  );
};
