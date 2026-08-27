import React, { useState, useEffect } from "react";
import { Play, Pause, Square, Volume2, VolumeX, Maximize2, Minimize2, Music2, Sparkles, FileText, X } from "lucide-react";

export interface NowPlayingTrack {
  trackName: string;
  artistName: string;
  albumName?: string;
  albumArt?: string;
  audioUrl?: string;
  fallbackAudioUrl?: string;
  videoId?: string;
  embedUrl?: string;
  isYouTubeMusic?: boolean;
  isJioSaavn?: boolean;
  isFullSong?: boolean;
  isPlaying: boolean;
  quality?: string;
  youtubeMusicUrl?: string;
  hasError?: boolean;
  errorMessage?: string;
  songId?: string;
  hasLyrics?: boolean;
}

interface MusicCapsuleProps {
  nowPlaying: NowPlayingTrack | null;
  onPlayPause: () => void;
  onStop: () => void;
  onVolumeChange?: (volume: number) => void;
}

export const MusicCapsule: React.FC<MusicCapsuleProps> = ({
  nowPlaying,
  onPlayPause,
  onStop,
  onVolumeChange,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [volume, setVolume] = useState(85);
  const [isMuted, setIsMuted] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsText, setLyricsText] = useState<string | null>(null);
  const [loadingLyrics, setLoadingLyrics] = useState(false);

  if (!nowPlaying) return null;

  const handleVolume = (newVol: number) => {
    setVolume(newVol);
    setIsMuted(newVol === 0);
    onVolumeChange?.(newVol / 100);
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      onVolumeChange?.(volume / 100);
    } else {
      setIsMuted(true);
      onVolumeChange?.(0);
    }
  };

  const fetchLyrics = async () => {
    if (!nowPlaying.songId && !nowPlaying.trackName) return;
    setLoadingLyrics(true);
    setShowLyrics(true);
    try {
      const res = await fetch(`/api/music/lyrics?query=${encodeURIComponent(nowPlaying.trackName + " " + nowPlaying.artistName)}`);
      const data = await res.json();
      if (data.success && data.lyrics) {
        setLyricsText(data.lyrics);
      } else {
        setLyricsText("Lyrics is gaane ke liye filhaal uplabdh nahi hain.");
      }
    } catch {
      setLyricsText("Lyrics fetch karte samay error aaya.");
    } finally {
      setLoadingLyrics(false);
    }
  };

  return (
    <>
      {/* Floating Music Capsule */}
      <div className="fixed bottom-6 right-6 z-50 transition-all duration-300 ease-out select-none">
        <div
          className={`relative backdrop-blur-2xl bg-black/75 border border-cyan-500/30 rounded-3xl shadow-[0_10px_35px_-5px_rgba(6,182,212,0.35)] p-3 text-white overflow-hidden transition-all duration-300 ${
            isExpanded ? "w-80 sm:w-96" : "w-72 sm:w-80"
          }`}
        >
          {/* Glowing animated background ambient mesh */}
          <div className="absolute -top-12 -left-12 w-32 h-32 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none animate-pulse" />
          <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-fuchsia-500/20 rounded-full blur-3xl pointer-events-none animate-pulse delay-700" />

          {/* Top Bar: Live Quality Badge & Window Controls */}
          <div className="flex items-center justify-between mb-2 text-xs">
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-400/40 text-cyan-300 font-semibold shadow-inner">
              <Sparkles className="w-3 h-3 text-cyan-400 animate-spin" style={{ animationDuration: '4s' }} />
              <span>{nowPlaying.quality || "320kbps HD Audio"}</span>
            </div>

            <div className="flex items-center gap-1">
              {nowPlaying.hasLyrics && (
                <button
                  onClick={fetchLyrics}
                  title="Show Lyrics"
                  className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-cyan-300 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? "Collapse" : "Expand"}
                className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
              >
                {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={onStop}
                title="Close Player"
                className="p-1 rounded-lg hover:bg-red-500/20 text-zinc-400 hover:text-red-400 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex items-center gap-3">
            {/* Rotating Vinyl Album Art */}
            <div className="relative flex-shrink-0 group">
              <div
                className={`w-14 h-14 rounded-2xl overflow-hidden border-2 border-cyan-400/50 shadow-lg relative ${
                  nowPlaying.isPlaying ? "animate-[spin_8s_linear_infinite]" : ""
                }`}
                style={{ borderRadius: "50%" }}
              >
                {nowPlaying.albumArt ? (
                  <img
                    src={nowPlaying.albumArt}
                    alt={nowPlaying.trackName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center">
                    <Music2 className="w-6 h-6 text-cyan-400" />
                  </div>
                )}
                {/* Center Vinyl Spindle Hole */}
                <div className="absolute inset-0 m-auto w-3.5 h-3.5 bg-black border-2 border-cyan-300 rounded-full" />
              </div>

              {/* Glowing Pulse Ring when Playing */}
              {nowPlaying.isPlaying && (
                <div className="absolute inset-0 rounded-full border border-cyan-400/60 animate-ping pointer-events-none opacity-40" />
              )}
            </div>

            {/* Track Info & Equalizer */}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm text-white truncate tracking-wide flex items-center gap-1.5">
                <span>{nowPlaying.trackName}</span>
              </div>
              <div className="text-xs text-zinc-400 truncate mt-0.5">
                {nowPlaying.artistName}
              </div>

              {/* Animated Live Equalizer Waves */}
              <div className="flex items-center gap-0.5 mt-1.5 h-3">
                {[40, 75, 100, 60, 85, 45, 90, 50].map((h, idx) => (
                  <div
                    key={idx}
                    className={`w-1 bg-gradient-to-t from-cyan-500 to-fuchsia-400 rounded-full transition-all duration-150 ${
                      nowPlaying.isPlaying ? "animate-pulse" : "opacity-30 h-1"
                    }`}
                    style={{
                      height: nowPlaying.isPlaying ? `${(h * (idx % 2 === 0 ? 0.9 : 1.2)) % 100}%` : "3px",
                      animationDelay: `${idx * 120}ms`,
                      animationDuration: "600ms",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Quick Action Button: Play / Pause */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={onPlayPause}
                className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.6)] transition-transform hover:scale-105 active:scale-95"
              >
                {nowPlaying.isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>
            </div>
          </div>

          {/* Expanded Bottom Controls (Volume Slider & Extra Buttons) */}
          {isExpanded && (
            <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between gap-3 text-xs">
              {/* Volume Slider */}
              <div className="flex items-center gap-2 flex-1">
                <button
                  onClick={toggleMute}
                  className="text-zinc-400 hover:text-white transition-colors"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-cyan-400" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolume(Number(e.target.value))}
                  className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              {/* Stop Button */}
              <button
                onClick={onStop}
                className="px-2.5 py-1 rounded-lg bg-red-950/60 border border-red-500/40 text-red-300 hover:bg-red-900/80 flex items-center gap-1 transition-colors"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Lyrics Modal */}
      {showLyrics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-zinc-950 border border-cyan-500/30 rounded-3xl p-6 shadow-2xl text-white max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-base text-cyan-300">Lyrics: {nowPlaying.trackName}</h3>
              </div>
              <button
                onClick={() => setShowLyrics(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto mt-4 pr-2 text-sm leading-relaxed whitespace-pre-line text-zinc-300 font-sans">
              {loadingLyrics ? (
                <div className="py-12 text-center text-zinc-500 animate-pulse">
                  JioSaavn se lyrics fetch ho rahe hain... 🎶
                </div>
              ) : (
                lyricsText
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
