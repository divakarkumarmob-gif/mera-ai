import React, { useState, useEffect } from "react";
import { X, Search, Play, Pause, Music2, Sparkles, Loader2, Disc3, Mic2, Flame, Heart, FileText } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getApiUrl } from "@/utils/api";

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
  isYouTube?: boolean;
  videoId?: string;
  streamUrl?: string;
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
    isYouTube?: boolean;
    isFullSong?: boolean;
    quality?: string;
    songId?: string;
    hasLyrics?: boolean;
  }) => void;
  currentPlayingSongName?: string;
  isPlaying?: boolean;
}

// User-specified exact genre categories + YouTube Pro Safe
const MUSIC_CATEGORY_TABS = [
  { id: "all", label: "✨ All", query: "Trending Bollywood Hits" },
  { id: "youtube_safe", label: "🔴 YouTube Pro", query: "Trending YouTube Hits" },
  { id: "hindi_new", label: "🔥 Hindi New", query: "Hindi Hits" },
  { id: "hindi_old", label: "📻 Hindi Old", query: "Kishore Kumar Lata Mangeshkar" },
  { id: "bhojpuri", label: "🌾 Bhojpuri", query: "Bhojpuri" },
  { id: "phonk", label: "⚡ Phonk", query: "Phonk" },
  { id: "haryanvi", label: "🚜 Haryanvi", query: "Haryanvi" },
  { id: "punjabi", label: "🕺 Punjabi", query: "Punjabi Hits" },
];

/**
 * Text highlighter component for matched search tokens
 */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!text) return null;
  if (!query || !query.trim()) return <span>{text}</span>;

  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (words.length === 0) return <span>{text}</span>;

  const regex = new RegExp(`(${words.join("|")})`, "gi");
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <span
            key={i}
            className="text-cyan-300 font-extrabold bg-cyan-500/25 px-1 py-0.5 rounded shadow-[0_0_8px_rgba(6,182,212,0.4)]"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

export const MusicStudioModal: React.FC<MusicStudioModalProps> = ({
  isOpen,
  onClose,
  onPlaySong,
  currentPlayingSongName,
  isPlaying,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTab, setSelectedTab] = useState("all");
  const [results, setResults] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Auto search on initial open if empty
  useEffect(() => {
    if (isOpen && results.length === 0 && !hasSearched) {
      handleSearch("Trending Bollywood Hits", "all");
    }
  }, [isOpen]);

  // Real-time live debounced search as user types
  useEffect(() => {
    if (!isOpen || !searchQuery.trim() || selectedTab !== "all") return;
    const timer = setTimeout(() => {
      handleSearch(searchQuery, "all");
    }, 380);
    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, selectedTab]);

  if (!isOpen) return null;

  const handleSearch = async (queryToSearch?: string, tabId?: string) => {
    const q = (queryToSearch !== undefined ? queryToSearch : searchQuery).trim();
    if (!q) return;
    setLoading(true);
    setHasSearched(true);
    if (queryToSearch) setSearchQuery(queryToSearch);
    const activeTab = tabId || selectedTab;
    if (tabId) setSelectedTab(tabId);

    try {
      if (activeTab === "youtube_safe") {
        const res = await fetch(getApiUrl(`/api/youtube/search-music?q=${encodeURIComponent(q)}`));
        const data = await res.json();
        if (data.success && Array.isArray(data.tracks)) {
          const mapped: SongItem[] = data.tracks.map((t: any) => ({
            id: t.id || t.videoId,
            songName: t.songName,
            albumName: t.albumName || "YouTube Music",
            artistName: t.artistName,
            durationSec: t.durationSec,
            albumArt500: t.albumArtHighRes || t.albumArt,
            albumArt150: t.albumArt,
            audio320kbps: t.streamUrl || "",
            audio160kbps: "",
            audio96kbps: "",
            hasLyrics: false,
            isYouTube: true,
            videoId: t.videoId,
            streamUrl: t.streamUrl,
          }));
          setResults(mapped);
        } else {
          setResults([]);
        }
      } else {
        const res = await fetch(getApiUrl(`/api/music/search?query=${encodeURIComponent(q)}`));
        const data = await res.json();
        if (data.success && Array.isArray(data.songs)) {
          setResults(data.songs);
        } else {
          setResults([]);
        }
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSongSelect = (song: SongItem) => {
    const rawAudio = song.audio320kbps || song.audio160kbps || song.audio96kbps || song.streamUrl;
    onPlaySong({
      trackName: song.songName,
      artistName: song.artistName,
      albumName: song.albumName,
      albumArt: song.albumArt500 || song.albumArt150,
      audioUrl: rawAudio,
      isJioSaavn: !song.isYouTube,
      isYouTube: !!song.isYouTube,
      isFullSong: true,
      quality: song.isYouTube ? "YouTube Pro Safe Audio" : "JioSaavn 320kbps Ultra-HD",
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
        <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-fuchsia-600 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.4)]">
              <Disc3 className="w-5 h-5 text-white animate-spin" style={{ animationDuration: "10s" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">JioSaavn 320kbps HD Music Studio</h2>
                <span className="px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-400/40 text-[10px] font-semibold text-cyan-300">
                  Priority Search
                </span>
              </div>
              <p className="text-xs text-zinc-400">Hindi New, Hindi Old, Bhojpuri, Phonk, Haryanvi & Punjabi in 320kbps HD</p>
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
        <div className="mt-3 shrink-0">
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
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedTab("all");
              }}
              placeholder="Search any song, artist, genre (e.g. Hindi Old, Bhojpuri, Phonk, Arijit)..."
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
        </div>

        {/* User-Requested Category Filter Tabs (Hindi New, Hindi Old, Bhojpuri, Phonk, Haryanvi, Punjabi) */}
        <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-1 scrollbar-none shrink-0">
          {MUSIC_CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleSearch(tab.query, tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all active:scale-95 cursor-pointer ${
                selectedTab === tab.id
                  ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-black shadow-[0_0_15px_rgba(6,182,212,0.5)] font-bold"
                  : "bg-zinc-900 border border-white/10 text-zinc-300 hover:border-cyan-400/40 hover:text-cyan-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Results Header */}
        <div className="flex items-center justify-between mt-3 text-xs text-zinc-400 shrink-0 px-1">
          <span>{results.length > 0 ? `${results.length} Songs Loaded` : "No Songs"}</span>
          <span className="text-[10px] text-cyan-400">⚡ 320kbps HD Audio Available</span>
        </div>

        {/* Results Container */}
        <div className="flex-1 overflow-y-auto mt-2 pr-1 space-y-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              <p className="text-sm">JioSaavn se 320kbps HD songs fetch ho rahe hain...</p>
            </div>
          ) : results.length > 0 ? (
            results.map((song) => {
              const isCurrentSong =
                currentPlayingSongName &&
                currentPlayingSongName.toLowerCase().includes(song.songName.toLowerCase());
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

                    {/* Details with Highlighted Matched Words */}
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-white truncate group-hover:text-cyan-300 transition-colors flex items-center gap-2">
                        <span>
                          <HighlightText text={song.songName} query={searchQuery} />
                        </span>
                        {song.hasLyrics && (
                          <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-[9px] text-zinc-400 font-normal">
                            Lyrics
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-400 truncate mt-0.5">
                        <HighlightText text={song.artistName} query={searchQuery} />{" "}
                        {song.albumName ? (
                          <>
                            • <HighlightText text={song.albumName} query={searchQuery} />
                          </>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500">
                        {song.isYouTube ? (
                          <span className="text-red-400 font-semibold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            YouTube Pro Audio
                          </span>
                        ) : (
                          <span className="text-cyan-400 font-semibold">⚡ 320kbps HD</span>
                        )}
                        {song.durationSec ? (
                          <span>
                            • {Math.floor(song.durationSec / 60)}:
                            {(song.durationSec % 60).toString().padStart(2, "0")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Play Action Button */}
                  <div className="shrink-0 ml-3">
                    <button
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
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
