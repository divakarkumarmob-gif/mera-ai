import React, { useState, useEffect } from "react";
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Music2,
  Sparkles,
  FileText,
  X,
  RotateCcw,
  SkipForward,
  SkipBack,
  FastForward,
  Rewind,
  Sliders,
  Radio,
  Disc3,
  Layers
} from "lucide-react";
import { getApiUrl } from "@/utils/api";

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
  currentTime?: number;
  duration?: number;
  eqPreset?: string;
  bassLevel?: number;
}

export interface QueueSong {
  id: string;
  songName: string;
  artistName: string;
  albumName?: string;
  albumArt500?: string;
  audio320kbps?: string;
}

interface MusicCapsuleProps {
  nowPlaying: NowPlayingTrack | null;
  currentTime?: number;
  duration?: number;
  queue?: QueueSong[];
  eqPreset?: string;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek?: (timeSeconds: number) => void;
  onSeekRelative?: (deltaSeconds: number) => void;
  onRestart?: () => void;
  onNextTrack?: () => void;
  onPreviousTrack?: () => void;
  onVolumeChange?: (volume: number) => void;
  onSelectEqPreset?: (preset: string) => void;
  onPlayQueueSong?: (song: QueueSong) => void;
}

export const EQ_PRESETS = [
  { id: "bass_boost", label: "🔥 Ultra Bass (+12dB)", desc: "Deep sub-bass punch" },
  { id: "8d_spatial", label: "🌀 8D Spatial Surround", desc: "Rotational 360° audio" },
  { id: "vocal_clarity", label: "🎤 Vocal Boost", desc: "Crisp voice & lyrics" },
  { id: "party_punch", label: "🎉 Party Electronic", desc: "High energy bass & treble" },
  { id: "flat", label: "🎧 Studio Flat", desc: "Original master balanced" },
];

export const MusicCapsule: React.FC<MusicCapsuleProps> = ({
  nowPlaying,
  currentTime = 0,
  duration = 0,
  queue = [],
  eqPreset = "flat",
  onPlayPause,
  onStop,
  onSeek,
  onSeekRelative,
  onRestart,
  onNextTrack,
  onPreviousTrack,
  onVolumeChange,
  onSelectEqPreset,
  onPlayQueueSong,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [volume, setVolume] = useState(85);
  const [isMuted, setIsMuted] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showEqModal, setShowEqModal] = useState(false);
  const [showQueueModal, setShowQueueModal] = useState(false);
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

  const formatTime = (secs: number) => {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const remSecs = s % 60;
    return `${m}:${remSecs.toString().padStart(2, "0")}`;
  };

  const fetchLyrics = async () => {
    if (!nowPlaying.songId && !nowPlaying.trackName) return;
    setLoadingLyrics(true);
    setShowLyrics(true);
    try {
      const res = await fetch(
        getApiUrl(`/api/music/lyrics?query=${encodeURIComponent(nowPlaying.trackName + " " + nowPlaying.artistName)}`)
      );
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
          className={`relative backdrop-blur-2xl bg-black/85 border border-cyan-500/40 rounded-3xl shadow-[0_10px_40px_-5px_rgba(6,182,212,0.4)] p-3.5 text-white overflow-hidden transition-all duration-300 ${
            isExpanded ? "w-84 sm:w-96" : "w-76 sm:w-84"
          }`}
        >
          {/* Glowing animated background ambient mesh */}
          <div className="absolute -top-12 -left-12 w-36 h-36 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none animate-pulse" />
          <div className="absolute -bottom-12 -right-12 w-36 h-36 bg-fuchsia-500/20 rounded-full blur-3xl pointer-events-none animate-pulse delay-700" />

          {/* Top Bar: Live Quality Badge & Tool Icons */}
          <div className="flex items-center justify-between mb-2 text-xs">
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-950/90 border border-cyan-400/50 text-cyan-300 font-semibold shadow-inner">
              <Sparkles className="w-3 h-3 text-cyan-400 animate-spin" style={{ animationDuration: "4s" }} />
              <span>{nowPlaying.quality || "320kbps HD Audio"}</span>
            </div>

            <div className="flex items-center gap-1">
              {/* Equalizer Button */}
              <button
                onClick={() => setShowEqModal(true)}
                title="Equalizer & Bass Boost"
                className={`p-1 rounded-lg transition-colors ${
                  eqPreset !== "flat"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40"
                    : "hover:bg-white/10 text-zinc-400 hover:text-cyan-300"
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
              </button>

              {/* Queue Button */}
              {queue.length > 0 && (
                <button
                  onClick={() => setShowQueueModal(true)}
                  title={`Up Next (${queue.length} songs)`}
                  className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-cyan-300 transition-colors relative"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-cyan-400" />
                </button>
              )}

              {/* Lyrics Button */}
              {nowPlaying.hasLyrics && (
                <button
                  onClick={fetchLyrics}
                  title="Show Lyrics"
                  className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-cyan-300 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Expand / Collapse */}
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? "Collapse" : "Expand"}
                className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
              >
                {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>

              {/* Stop & Close */}
              <button
                onClick={onStop}
                title="Close Player"
                className="p-1 rounded-lg hover:bg-red-500/20 text-zinc-400 hover:text-red-400 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Main Track Info Area */}
          <div className="flex items-center gap-3">
            {/* Rotating Vinyl Album Art */}
            <div className="relative flex-shrink-0 group">
              <div
                className={`w-14 h-14 rounded-2xl overflow-hidden border-2 border-cyan-400/60 shadow-lg relative ${
                  nowPlaying.isPlaying ? "animate-[spin_8s_linear_infinite]" : ""
                }`}
                style={{ borderRadius: "50%" }}
              >
                {nowPlaying.albumArt ? (
                  <img src={nowPlaying.albumArt} alt={nowPlaying.trackName} className="w-full h-full object-cover" />
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

            {/* Track Info & Equalizer Waves */}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm text-white truncate tracking-wide flex items-center gap-1.5">
                <span>{nowPlaying.trackName}</span>
              </div>
              <div className="text-xs text-zinc-400 truncate mt-0.5">{nowPlaying.artistName}</div>

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
            <div className="flex items-center gap-1">
              <button
                onClick={onPlayPause}
                className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.6)] transition-transform hover:scale-105 active:scale-95 cursor-pointer"
              >
                {nowPlaying.isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
            </div>
          </div>

          {/* Interactive Scrub Timeline Bar */}
          {duration > 0 && (
            <div className="mt-2.5 pt-1">
              <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <input
                type="range"
                min="0"
                max={Math.floor(duration)}
                value={Math.floor(currentTime)}
                onChange={(e) => onSeek?.(Number(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          )}

          {/* Quick Voice & Touch Seek Buttons (-10s, Prev, Restart, Next, +10s) */}
          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-white/10 text-zinc-300">
            {/* Rewind 10s */}
            <button
              onClick={() => onSeekRelative?.(-10)}
              title="Rewind 10s (Voice: 10 sec peeche karo)"
              className="p-1.5 rounded-lg hover:bg-white/10 hover:text-cyan-300 transition-colors flex items-center gap-0.5 text-[10px]"
            >
              <Rewind className="w-3.5 h-3.5" />
              <span>-10s</span>
            </button>

            {/* Previous Track */}
            <button
              onClick={onPreviousTrack}
              title="Previous Track (Voice: Pichhla gana chalao)"
              className="p-1.5 rounded-lg hover:bg-white/10 hover:text-cyan-300 transition-colors"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {/* Restart From Beginning */}
            <button
              onClick={onRestart}
              title="Restart Song (Voice: Shuru se bajao)"
              className="p-1.5 rounded-lg hover:bg-white/10 hover:text-cyan-300 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Next Track */}
            <button
              onClick={onNextTrack}
              title="Next Track (Voice: Agla gana chalao)"
              className="p-1.5 rounded-lg hover:bg-white/10 hover:text-cyan-300 transition-colors"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            {/* Forward 10s */}
            <button
              onClick={() => onSeekRelative?.(10)}
              title="Forward 10s (Voice: 10 sec aage karo)"
              className="p-1.5 rounded-lg hover:bg-white/10 hover:text-cyan-300 transition-colors flex items-center gap-0.5 text-[10px]"
            >
              <span>+10s</span>
              <FastForward className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Expanded Bottom Controls (Volume Slider & Extra Buttons) */}
          {isExpanded && (
            <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between gap-3 text-xs">
              {/* Volume Slider */}
              <div className="flex items-center gap-2 flex-1">
                <button onClick={toggleMute} className="text-zinc-400 hover:text-white transition-colors">
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolume(Number(e.target.value))}
                  className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
                <span className="text-[10px] text-zinc-400 w-6 text-right">{isMuted ? "0%" : `${volume}%`}</span>
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

      {/* Equalizer & Bass Boost Modal */}
      {showEqModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <div className="relative w-full max-w-sm bg-zinc-950 border border-cyan-500/40 rounded-3xl p-5 shadow-2xl text-white flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-base text-white">DSP Audio Equalizer & Bass</h3>
              </div>
              <button
                onClick={() => setShowEqModal(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-zinc-400 mt-2">
              Select an industry DSP audio filter. Voice: <em>"Friday, bass badhao"</em> ya <em>"8D audio lagao"</em>.
            </p>

            <div className="space-y-2 mt-4">
              {EQ_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => {
                    onSelectEqPreset?.(preset.id);
                    setShowEqModal(false);
                  }}
                  className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-all text-left ${
                    eqPreset === preset.id
                      ? "bg-cyan-950/60 border-cyan-400/80 shadow-[0_0_15px_rgba(6,182,212,0.3)] text-cyan-200"
                      : "bg-zinc-900/60 border-white/5 hover:bg-zinc-800/70 hover:border-cyan-500/30 text-zinc-300"
                  }`}
                >
                  <div>
                    <div className="font-bold text-sm">{preset.label}</div>
                    <div className="text-xs text-zinc-400 mt-0.5">{preset.desc}</div>
                  </div>
                  {eqPreset === preset.id && <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-md" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Up Next Smart Queue Modal */}
      {showQueueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-zinc-950 border border-cyan-500/40 rounded-3xl p-5 shadow-2xl text-white max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
                <h3 className="font-bold text-base text-white">Smart Radio Queue ({queue.length})</h3>
              </div>
              <button
                onClick={() => setShowQueueModal(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-zinc-400 mt-2">
              JioSaavn AI Auto-Queue automatically plays these songs seamlessly after the current track.
            </p>

            <div className="flex-1 overflow-y-auto mt-3 pr-1 space-y-2">
              {queue.map((song, idx) => (
                <div
                  key={song.id || idx}
                  onClick={() => {
                    onPlayQueueSong?.(song);
                    setShowQueueModal(false);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-2xl bg-zinc-900/60 border border-white/5 hover:bg-zinc-800 hover:border-cyan-500/30 transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 border border-white/10">
                      {song.albumArt500 ? (
                        <img src={song.albumArt500} alt={song.songName} className="w-full h-full object-cover" />
                      ) : (
                        <Music2 className="w-4 h-4 m-2 text-zinc-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-white truncate group-hover:text-cyan-300">
                        {song.songName}
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate">{song.artistName}</div>
                    </div>
                  </div>
                  <Play className="w-4 h-4 text-zinc-500 group-hover:text-cyan-400 shrink-0 fill-current" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lyrics Modal */}
      {showLyrics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-zinc-950 border border-cyan-500/40 rounded-3xl p-6 shadow-2xl text-white max-h-[80vh] flex flex-col">
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
