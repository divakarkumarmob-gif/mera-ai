import React, { useState } from "react";
import { Play, Sparkles, MessageSquare, Clock, BookOpen, ExternalLink, X, Search, ChevronRight } from "lucide-react";

interface YouTubeChapter {
  title: string;
  start: number;
  startFormatted: string;
  summary: string;
  timestampUrl: string;
}

interface YouTubeVideoAnalysis {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  summary: string;
  keyTakeaways: string[];
  chapters: YouTubeChapter[];
  hasTranscript: boolean;
  totalCues: number;
}

interface YouTubeStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const YouTubeStudioModal: React.FC<YouTubeStudioModalProps> = ({ isOpen, onClose }) => {
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<YouTubeVideoAnalysis | null>(null);
  const [questionInput, setQuestionInput] = useState("");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaHistory, setQaHistory] = useState<Array<{ q: string; a: string; timestamp?: string; timestampUrl?: string }>>([]);
  const [currentSeconds, setCurrentSeconds] = useState<number>(0);

  if (!isOpen) return null;

  const handleAnalyze = async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/youtube/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to analyze YouTube video");
      }
      setAnalysis(data.analysis);
    } catch (e: any) {
      setError(e?.message || "Analysis error");
    } finally {
      setLoading(false);
    }
  };

  const handleAskQuestion = async () => {
    if (!questionInput.trim() || !analysis) return;
    setQaLoading(true);
    try {
      const res = await fetch("/api/youtube/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: analysis.videoId, question: questionInput }),
      });
      const data = await res.json();
      setQaHistory((prev) => [
        ...prev,
        {
          q: questionInput,
          a: data.answer,
          timestamp: data.exactTimestamp,
          timestampUrl: data.timestampUrl,
        },
      ]);
      setQuestionInput("");
    } catch (e: any) {
      alert("Error asking question: " + (e?.message || e));
    } finally {
      setQaLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-red-600 to-rose-500 shadow-lg shadow-red-500/20 text-white">
              <Play className="w-5 h-5 fill-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                YouTube Intelligence & "Ask Gemini" Studio
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                  Multimodal Timed Engine
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Extract millisecond transcripts, chapter timeline & ask exact timestamp questions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* URL Input Bar */}
        <div className="p-4 bg-slate-950/40 border-b border-slate-800 flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Paste any YouTube URL (e.g. https://www.youtube.com/watch?v=... or youtu.be/...)"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              className="w-full pl-4 pr-10 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
            />
          </div>
          <button
            onClick={handleAnalyze}
            disabled={loading || !urlInput.trim()}
            className="px-5 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 text-white font-medium text-sm rounded-xl flex items-center gap-2 shadow-lg shadow-red-600/20 transition cursor-pointer"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <span>Analyzing Timestamps...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Analyze Video</span>
              </>
            )}
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          {!analysis && !loading && (
            <div className="text-center py-16 text-slate-400 space-y-3">
              <Play className="w-12 h-12 mx-auto text-slate-600" />
              <p className="text-base font-medium text-slate-300">Paste any YouTube URL above to begin</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Friday will parse subtitles, generate chapter timelines with clickable links, and allow you to ask "At what minute was X discussed?"
              </p>
            </div>
          )}

          {analysis && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Video Player & "Ask Gemini" Interactive Q&A */}
              <div className="lg:col-span-7 space-y-6">
                {/* Embedded Player */}
                <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-xl">
                  <iframe
                    src={`https://www.youtube.com/embed/${analysis.videoId}?start=${currentSeconds}&autoplay=1`}
                    title={analysis.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full h-full border-0"
                  />
                </div>

                {/* Video Title & Channel */}
                <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
                  <h3 className="font-bold text-white text-base leading-snug">{analysis.title}</h3>
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                    <span className="font-medium text-slate-300">{analysis.channelName}</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-medium">
                      {analysis.hasTranscript ? `✅ ${analysis.totalCues} Cues Extracted` : "Auto-generated"}
                    </span>
                  </div>
                </div>

                {/* "Ask Gemini" Video Q&A Box */}
                <div className="p-4 rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/60 border border-slate-700 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <MessageSquare className="w-4 h-4 text-red-400" />
                    <span>Ask Gemini about this Video</span>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. 'At what time is JWT auth explained?', 'What code was shown at 04:20?'"
                      value={questionInput}
                      onChange={(e) => setQuestionInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAskQuestion()}
                      className="flex-1 bg-slate-950/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
                    />
                    <button
                      onClick={handleAskQuestion}
                      disabled={qaLoading || !questionInput.trim()}
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer transition"
                    >
                      {qaLoading ? "Searching..." : "Ask"}
                    </button>
                  </div>

                  {qaHistory.length > 0 && (
                    <div className="space-y-3 pt-2 max-h-60 overflow-y-auto">
                      {qaHistory.map((item, idx) => (
                        <div key={idx} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5 text-xs">
                          <p className="font-semibold text-slate-300">❓ {item.q}</p>
                          {item.timestamp && (
                            <button
                              onClick={() => {
                                const match = item.timestamp?.match(/(\d+):(\d+)/);
                                if (match) {
                                  const s = parseInt(match[1]) * 60 + parseInt(match[2]);
                                  setCurrentSeconds(s);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-mono text-[11px] hover:bg-red-500/30 transition cursor-pointer"
                            >
                              <Clock className="w-3 h-3" />
                              <span>Jump to {item.timestamp}</span>
                            </button>
                          )}
                          <p className="text-slate-300 whitespace-pre-wrap">{item.a}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Executive Summary, Key Takeaways & Chapter Timelines */}
              <div className="lg:col-span-5 space-y-6">
                
                {/* Executive Summary */}
                <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/60 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <BookOpen className="w-4 h-4 text-red-400" />
                    <span>Executive Summary</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {analysis.summary}
                  </p>
                </div>

                {/* Key Takeaways */}
                {analysis.keyTakeaways.length > 0 && (
                  <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/60 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-white">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span>Key Takeaways & Lessons</span>
                    </div>
                    <ul className="space-y-2 text-xs text-slate-300">
                      {analysis.keyTakeaways.map((t, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-amber-400 font-bold">•</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Chapters & Timestamps */}
                {analysis.chapters.length > 0 && (
                  <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/60 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-white">
                      <Clock className="w-4 h-4 text-cyan-400" />
                      <span>Interactive Chapters & Timeline</span>
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {analysis.chapters.map((ch, idx) => (
                        <button
                          key={idx}
                          onClick={() => setCurrentSeconds(ch.start)}
                          className="w-full text-left p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between group cursor-pointer"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-mono text-[11px] font-bold">
                                {ch.startFormatted}
                              </span>
                              <span className="font-semibold text-slate-200 text-xs group-hover:text-white">
                                {ch.title}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-1">{ch.summary}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 transition" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
