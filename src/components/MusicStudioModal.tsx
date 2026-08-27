import React, { useState, useEffect } from "react";
import { X, Search, Play, Pause, Music2, Sparkles, Loader2, Disc3, Mic2, Flame, Heart, FileText } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SongItem {
  id: string;
  songName: string;
  albumName: string;
  artistName: string;
  year?: string;
  durationSec?: number;
  albumArt500: string;
  albumArt150: string;
  audio320kbps: string;
  audio160kbps: string;
  audio96kbps: string;
  hasLyrics: boolean;
}

interface MusicStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlaySong: (song: {
    trackName: string;
    artistName: string;
    albumName?: string;
    albumArt?: string;
    audioUrl?: string;
    isJioSaavn?: boolean;
    isFullSong?: boolean;
    quality?: string;
    songId?: string;
    hasLyrics?: boolean;
  }) => void;
  currentPlayingSongName?: string;
  isPlaying?: boolean;
}

const QUICK_TRENDING_CHIPS = [
  "Raanjhanaa",
  "Kesariya",
  "Arijit Singh",
  "Sidhu Moosewala",
  "Tum Hi Ho",
  "Lofi Flip",
  "Pritam Hits",
  "Romantic Hindi",
  "Shreya Ghoshal",
  "Apna Bana Le",
];

export const MusicStudioModal: React.FC<MusicStudioModalProps> = ({
  isOpen,
  onClose,
  onPlaySong,
  currentPlayingSongName,
  isPlaying,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Auto search on initial open if empty
  useEffect(() => {
    if (isOpen && results.length === 0 && !hasSearched) {
      handleSearch("Raanjhanaa");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSearch = async (queryToSearch?: string) => {
    const q = (queryToSearch !== undefined ? queryToSearch : searchQuery).trim();
    if (!q) return;
    setLoading(true);
    setHasSearched(true);
    if (queryToSearch) setSearchQuery(queryToSearch);

    try {
      const res = await fetch(`/api/music/search?query=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.songs)) {
        setResults(data.songs);
      } else {
        setResults([]);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSongSelect = (song: SongItem) => {
    const rawAudio = song.audio320kbps || song.audio160kbps || song.audio96kbps;
    onPlaySong({
      trackName: song.songName,
      artistName: song.artistName,
      albumName: song.albumName,
      albumArt: song.albumArt500 || song.albumArt150,
      audioUrl: rawAudio,
      isJioSaavn: true,
      isFullSong: true,
      quality: "JioSaavn 320kbps Ultra-HD",
      songId: song.id,
      hasLyrics: song.hasLyrics,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="relative w-full max-w-2xl max-h-[88vh] bg-zinc-950/95 border border-cyan-500/40 rounded-3xl p-5 shadow-[0_0_50px_rgba(6,182,212,0.25)] text-white flex flex-col overflow-hidden"
      >
        {/* Background Glowing Orb */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-60 h-60 bg-fuchsia-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-fuchsia-600 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.4)]">
              <Disc3 className="w-5 h-5 text-white animate-spin" style={{ animationDuration: "10s" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">JioSaavn 320kbps HD Music Studio</h2>
                <span className="px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-400/40 text-[10px] font-semibold text-cyan-300">
                  Pure Audio
                </span>
              </div>
              <p className="text-xs text-zinc-400">Search millions of songs, direct background audio & lyrics</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar Input */}
        <div className="mt-4 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            className="relative flex items-center"
          >
            <Search className="absolute left-4 w-4 h-4 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search any song, artist, album (e.g. Raanjhanaa, Kesariya, Arijit Singh)..."
              className="w-full pl-11 pr-24 py-3 bg-zinc-900/90 border border-white/15 focus:border-cyan-400/60 rounded-2xl text-sm text-white placeholder-zinc-500 outline-none transition-all shadow-inner focus:shadow-[0_0_20px_rgba(6,182,212,0.2)]"
            />
            <button
              type="submit"
              disabled={loading}
              className="absolute right-2 px-4 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Search"}
            </button>
          </form>

          {/* Quick Trending Filter Chips */}
          <div className="flex items-center gap-1.5 mt-3 overflow-x-auto pb-1 scrollbar-none">
            <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1 shrink-0 mr-1">
              <Flame className="w-3 h-3 text-orange-400" /> Trending:
            </span>
            {QUICK_TRENDING_CHIPS.map((chip, i) => (
              <button
                key={i}
                onClick={() => handleSearch(chip)}
                className="px-2.5 py-1 rounded-full bg-zinc-900 border border-white/10 hover:border-cyan-400/40 text-[11px] text-zinc-300 hover:text-cyan-300 whitespace-nowrap transition-all active:scale-95"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        {/* Results Container */}
        <div className="flex-1 overflow-y-auto mt-4 pr-1 space-y-2.5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              <p className="text-sm">JioSaavn se 320kbps HD streams fetch ho rahe hain...</p>
            </div>
          ) : results.length > 0 ? (
            results.map((song) => {
              const isCurrentSong = currentPlayingSongName && currentPlayingSongName.toLowerCase().includes(song.songName.toLowerCase());
              return (
                <div
                  key={song.id}
                  onClick={() => handleSongSelect(song)}
                  className={`group flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${
                    isCurrentSong
                      ? "bg-cyan-950/50 border-cyan-500/60 shadow-[0_0_20px_rgba(6,182,212,0.2)]"
                      : "bg-zinc-900/60 border-white/5 hover:bg-zinc-800/80 hover:border-cyan-500/30"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Album Art */}
                    <div className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-white/10 shadow-md">
                      <img
                        src={song.albumArt500 || song.albumArt150}
                        alt={song.songName}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      {isCurrentSong && isPlaying && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-white truncate group-hover:text-cyan-300 transition-colors flex items-center gap-2">
                        <span>{song.songName}</span>
                        {song.hasLyrics && (
                          <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-[9px] text-zinc-400 font-normal">
                            Lyrics
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-400 truncate mt-0.5">
                        {song.artistName} {song.albumName ? `• ${song.albumName}` : ""}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500">
                        <span className="text-cyan-400 font-semibold">⚡ 320kbps HD</span>
                        {song.durationSec ? <span>• {Math.floor(song.durationSec / 60)}:{(song.durationSec % 60).toString().padStart(2, '0')}</span> : null}
                      </div>
                    </div>
                  </div>

                  {/* Play Action Button */}
                  <div className="shrink-0 ml-3">
                    <button
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                        isCurrentSong && isPlaying
                          ? "bg-cyan-400 text-black shadow-[0_0_15px_rgba(6,182,212,0.6)]"
                          : "bg-white/10 group-hover:bg-cyan-500 group-hover:text-black text-white"
                      }`}
                    >
                      {isCurrentSong && isPlaying ? (
                        <Pause className="w-4 h-4 fill-current" />
                      ) : (
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          ) : hasSearched ? (
            <div className="text-center py-16 text-zinc-500">
              <Music2 className="w-12 h-12 mx-auto mb-2 opacity-30 text-cyan-400" />
              <p className="text-sm">Koi song nahi mila. Dusra keyword search karein.</p>
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
};
