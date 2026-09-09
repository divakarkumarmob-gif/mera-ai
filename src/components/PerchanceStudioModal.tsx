import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  Terminal,
  X,
  Play,
  Download,
  Copy,
  Check,
  RefreshCw,
  Cpu,
  Globe,
  AlertTriangle,
  Layers,
  Eye,
  Zap,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  Send,
  Sliders,
  ShieldCheck,
} from "lucide-react";
import { getApiUrl } from "@/utils/api";
import { getAppToken } from "@/utils/appSecurityClient";

interface StepLog {
  level: "info" | "warn" | "error" | "success";
  step: string;
  message: string;
  timestamp: string;
}

const PRESET_PROMPTS = [
  { label: "👑 Queen at Taj Mahal", text: "a queen standing front of tajmahal, highly detailed realistic photo, 8k resolution" },
  { label: "⚔️ Cyberpunk Samurai", text: "futuristic cyberpunk samurai in neon rainy tokyo street, cinematic lighting, ultra-detailed" },
  { label: "🐶 Golden Retriever", text: "a cute golden retriever puppy sitting on vibrant green grass, sharp focus, high definition" },
  { label: "🐅 Himalayan Snow Tiger", text: "majestic white tiger walking through snow blizzard in himalayan mountains, photorealistic" },
  { label: "🏎️ Crimson Supercar", text: "sleek crimson supercar racing along neon coastal highway at dusk, motion blur, 8k" },
  { label: "🧝 Fantasy Warrior", text: "ethereal fantasy elven princess in golden armor, mystical glowing forest, studio lighting" },
];

const STYLE_ENHANCERS = [
  "photorealistic 8k",
  "cinematic lighting",
  "masterpiece ultra-hd",
  "hyper-detailed portrait",
  "depth of field 35mm",
  "volumetric golden hour glow",
];

export default function PerchanceStudioModal({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState("a queen standing front of tajmahal");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationLogs, setGenerationLogs] = useState<StepLog[]>([]);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{ bytes: number; durationMs: number } | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [engineStatus, setEngineStatus] = useState<{ isAvailable: boolean; path: string | null } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<any>(null);

  // Check server Chrome engine status on mount
  useEffect(() => {
    fetch(getApiUrl("/api/perchance/status"))
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setEngineStatus({ isAvailable: !!d.isAvailable, path: d.executablePath });
        }
      })
      .catch(() => {
        setEngineStatus({ isAvailable: false, path: null });
      });
  }, []);

  // Auto-scroll terminal logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [generationLogs]);

  // Elapsed timer ticker
  useEffect(() => {
    if (isGenerating) {
      setTimerSeconds(0);
      timerRef.current = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isGenerating]);

  const addStyleTag = (tag: string) => {
    if (!prompt.toLowerCase().includes(tag.toLowerCase())) {
      setPrompt((prev) => `${prev.trim()}, ${tag}`);
    }
  };

  const handleStartGeneration = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isGenerating) return;

    setIsGenerating(true);
    setErrorMessage(null);
    setGeneratedImage(null);
    setImageMeta(null);
    setGenerationLogs([]);
    setCurrentStepIndex(1);

    const token = getAppToken() || "";

    try {
      const streamUrl = getApiUrl(
        `/api/perchance/generate-stream?prompt=${encodeURIComponent(cleanPrompt)}&timeoutMs=120000&token=${encodeURIComponent(token)}`
      );

      const res = await fetch(streamUrl, {
        headers: {
          "x-app-key-token": token,
        },
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let receivedComplete = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const rawEvent of events) {
          if (!rawEvent.trim() || rawEvent.startsWith(":")) continue;

          let eventName = "message";
          let dataStr = "";

          const lines = rawEvent.split("\n");
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.replace("event:", "").trim();
            } else if (line.startsWith("data:")) {
              dataStr += line.replace("data:", "").trim();
            }
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);
            if (eventName === "log" || data.level) {
              setGenerationLogs((prev) => [...prev, data]);
              const msg = (data.message || "").toLowerCase();
              const stepName = (data.step || "").toLowerCase();
              if (stepName.includes("browser") || msg.includes("chrome")) setCurrentStepIndex(1);
              else if (stepName.includes("navigation") || stepName.includes("dom")) setCurrentStepIndex(2);
              else if (stepName.includes("prompt") || stepName.includes("trigger") || stepName.includes("action")) setCurrentStepIndex(3);
              else if (stepName.includes("network") || stepName.includes("frame") || msg.includes("intercept")) setCurrentStepIndex(4);
              else if (stepName.includes("complete")) setCurrentStepIndex(5);
            } else if (eventName === "complete" || data.image) {
              receivedComplete = true;
              setGeneratedImage(data.image);
              setImageMeta({ bytes: data.bytes || 0, durationMs: data.durationMs || 0 });
              setCurrentStepIndex(5);
            } else if (eventName === "error" || data.error) {
              setErrorMessage(data.error || "Generation error on server");
            }
          } catch {}
        }
      }

      if (!receivedComplete) {
        // Direct REST fallback if stream closed without payload
        const restRes = await fetch(getApiUrl("/api/perchance/generate"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-app-key-token": token,
          },
          body: JSON.stringify({ prompt: cleanPrompt, timeoutMs: 120000 }),
        });
        const restData = await restRes.json();
        if (restData.ok && restData.image) {
          setGeneratedImage(restData.image);
          setImageMeta({ bytes: restData.bytes || 0, durationMs: restData.durationMs || 0 });
          if (restData.logs && restData.logs.length > 0) {
            setGenerationLogs(restData.logs);
          }
          setCurrentStepIndex(5);
        } else if (!generatedImage) {
          setErrorMessage(restData.error || "Generation failed on server");
        }
      }
    } catch (err: any) {
      // Direct REST fallback on network exception
      try {
        const restRes = await fetch(getApiUrl("/api/perchance/generate"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-app-key-token": token,
          },
          body: JSON.stringify({ prompt: cleanPrompt, timeoutMs: 120000 }),
        });
        const restData = await restRes.json();
        if (restData.ok && restData.image) {
          setGeneratedImage(restData.image);
          setImageMeta({ bytes: restData.bytes || 0, durationMs: restData.durationMs || 0 });
          if (restData.logs && restData.logs.length > 0) {
            setGenerationLogs(restData.logs);
          }
          setCurrentStepIndex(5);
          return;
        }
      } catch {}
      setErrorMessage(err?.message || "Failed to connect to generation stream");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!generatedImage) return;
    const a = document.createElement("a");
    a.href = generatedImage;
    a.download = `perchance_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const copyWhatsAppCmd = () => {
    navigator.clipboard.writeText(`@hot image ${prompt.trim()}`);
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  const stepsList = [
    { title: "Browser Init", desc: "Launch Headless Engine" },
    { title: "Page Navigation", desc: "Perchance DOM Ready" },
    { title: "Prompt & Action", desc: "Keyboard Typing & Click" },
    { title: "Stream Intercept", desc: "API Endpoint Capture" },
    { title: "HD Delivery", desc: "JPEG Image Output" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 md:p-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 15 }}
        className="w-full max-w-6xl max-h-[92vh] bg-slate-950 border border-pink-500/40 rounded-3xl shadow-[0_0_60px_rgba(244,63,94,0.25)] flex flex-col overflow-hidden text-slate-100"
      >
        {/* ── Top Modal Header ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-pink-500/20 bg-gradient-to-r from-pink-950/40 via-purple-950/30 to-slate-950 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-pink-500 to-amber-500 flex items-center justify-center shadow-[0_0_20px_rgba(244,63,94,0.4)]">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-wide bg-gradient-to-r from-pink-400 via-rose-300 to-amber-300 bg-clip-text text-transparent">
                  🔥 Perchance AI Photo Studio & Live Inspector
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30 font-mono font-semibold">
                  Realistic HD
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Automated Browser Engine with Real-Time Step Logs & Network Interception
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Engine Status Badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-white/10 text-xs font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  engineStatus?.isAvailable ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" : "bg-amber-400 animate-pulse"
                }`}
              />
              <span className="text-slate-300">
                {engineStatus?.isAvailable ? "Chrome Ready" : "Auto-Detecting"}
              </span>
            </div>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-900/80 hover:bg-red-500/20 text-slate-400 hover:text-red-300 border border-white/10 hover:border-red-500/30 transition-all cursor-pointer"
              title="Close Studio"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Studio Body (Split 2-Column Grid) ────────────────────────────── */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-y-auto p-4 md:p-6 gap-6">
          {/* ── LEFT COLUMN: Input Studio & Live Diagnostics (7 Cols) ───────── */}
          <div className="lg:col-span-7 flex flex-col gap-5">
            {/* 1. Prompt Input Card */}
            <div className="p-4 rounded-2xl bg-slate-900/70 border border-white/10 shadow-lg flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-pink-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Enter Photo Description (Prompt)</span>
                </label>
                <span className="text-[10px] text-slate-400 font-mono">{prompt.length} chars</span>
              </div>

              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      handleStartGeneration();
                    }
                  }}
                  placeholder="Describe your desired photo in detail (e.g. a queen standing in front of tajmahal, 8k resolution)..."
                  rows={3}
                  className="w-full p-3.5 rounded-xl bg-slate-950/90 border border-slate-700/80 focus:border-pink-500/80 focus:ring-1 focus:ring-pink-500/50 text-sm text-slate-100 placeholder-slate-500 resize-none outline-none transition-all font-sans leading-relaxed"
                />
              </div>

              {/* Style Enhancer Tags */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Enhancers:</span>
                {STYLE_ENHANCERS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => addStyleTag(tag)}
                    className="text-[10px] px-2 py-0.5 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 text-pink-300 border border-pink-500/25 transition-all cursor-pointer"
                  >
                    + {tag}
                  </button>
                ))}
              </div>

              {/* Preset Inspiration Pills */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {PRESET_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => setPrompt(item.text)}
                    className="text-[11px] px-2.5 py-1 rounded-xl bg-slate-800/80 hover:bg-slate-700/90 text-slate-300 hover:text-white border border-slate-700/50 hover:border-pink-500/40 transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95"
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <button
                  onClick={copyWhatsAppCmd}
                  className="text-xs px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Copy command to test on WhatsApp"
                >
                  {copiedCommand ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCommand ? "Copied @hot Command!" : "Copy @hot Command"}</span>
                </button>

                <button
                  onClick={handleStartGeneration}
                  disabled={isGenerating || !prompt.trim()}
                  className={`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all cursor-pointer ${
                    isGenerating
                      ? "bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700"
                      : "bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 hover:from-pink-400 hover:to-amber-400 text-white shadow-[0_0_25px_rgba(244,63,94,0.4)] active:scale-98"
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-pink-400" />
                      <span>Generating ({timerSeconds}s)...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-white" />
                      <span>✨ Generate Photo (Live Stream)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 2. Visual Step Progress Bar */}
            <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/5 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <Layers className="w-3.5 h-3.5 text-pink-400" />
                  <span>Pipeline Execution Step {currentStepIndex}/5</span>
                </span>
                {isGenerating && (
                  <span className="text-amber-300 font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3 animate-spin" />
                    <span>Elapsed: {timerSeconds}s</span>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {stepsList.map((step, idx) => {
                  const stepNum = idx + 1;
                  const isDone = currentStepIndex > stepNum || (!isGenerating && generatedImage);
                  const isCurrent = currentStepIndex === stepNum && isGenerating;

                  return (
                    <div
                      key={step.title}
                      className={`p-2 rounded-xl text-center flex flex-col items-center justify-center transition-all ${
                        isDone
                          ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300"
                          : isCurrent
                          ? "bg-pink-500/25 border border-pink-500/60 text-pink-200 shadow-[0_0_15px_rgba(244,63,94,0.3)] animate-pulse"
                          : "bg-slate-950/60 border border-slate-800 text-slate-500"
                      }`}
                    >
                      <div className="text-[10px] font-bold font-mono">
                        {isDone ? "✓ Step " + stepNum : "Step " + stepNum}
                      </div>
                      <div className="text-[9px] truncate max-w-full font-semibold">{step.title}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Live Diagnostic Terminal Console */}
            <div className="flex-1 min-h-[220px] max-h-[320px] rounded-2xl bg-black/90 border border-slate-800 shadow-inner flex flex-col overflow-hidden">
              <div className="px-4 py-2 bg-slate-950 border-b border-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-pink-400" />
                  <span className="text-xs font-mono font-bold text-slate-300">Live Step-by-Step Inspector</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const text = generationLogs.map((l) => `[${l.timestamp}] [${l.step}] ${l.message}`).join("\n");
                      navigator.clipboard.writeText(text);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 1500);
                    }}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-white/10 flex items-center gap-1 transition-all"
                  >
                    {copiedLink ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedLink ? "Copied" : "Copy Logs"}</span>
                  </button>
                  <button
                    onClick={() => setGenerationLogs([])}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-white/10"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-1.5 text-slate-300 select-text">
                {generationLogs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 text-[11px] italic gap-1">
                    <span>Terminal standby... Prompt daal kar 'Generate Photo' click karein.</span>
                    <span>Har browser action aur network packet live yaha render hoga.</span>
                  </div>
                ) : (
                  generationLogs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-2 leading-relaxed">
                      <span className="text-slate-500 shrink-0 select-none">[{log.timestamp}]</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase shrink-0 ${
                          log.level === "success"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : log.level === "error"
                            ? "bg-red-500/20 text-red-300 border border-red-500/30"
                            : log.level === "warn"
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                        }`}
                      >
                        {log.step}
                      </span>
                      <span
                        className={`break-all ${
                          log.level === "success"
                            ? "text-emerald-200"
                            : log.level === "error"
                            ? "text-red-300 font-semibold"
                            : log.level === "warn"
                            ? "text-amber-200"
                            : "text-slate-300"
                        }`}
                      >
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>

            {/* Error Diagnosis Banner if generation fails */}
            {errorMessage && (
              <div className="p-3.5 rounded-2xl bg-red-950/80 border border-red-500/50 text-red-200 text-xs flex items-start gap-2.5 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-red-300">Generation Notice / Issue:</div>
                  <div className="text-red-200/90 leading-relaxed">{errorMessage}</div>
                  <div className="text-[11px] text-red-400/80 font-mono">
                    💡 Tip: Server browser environment retry karein ya WhatsApp fallback engine check karein.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN: High-Definition Output Showcase (5 Cols) ─────── */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-pink-400" />
                <span>AI Photo Output Result</span>
              </span>
              {generatedImage && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Generated in {((imageMeta?.durationMs || 0) / 1000).toFixed(1)}s</span>
                </span>
              )}
            </div>

            {/* Photo Viewer Card */}
            <div className="flex-1 min-h-[360px] rounded-3xl bg-slate-900/90 border border-white/10 shadow-2xl flex flex-col items-center justify-center p-4 relative overflow-hidden group">
              {generatedImage ? (
                <div className="w-full h-full flex flex-col items-center justify-between gap-4">
                  <div className="relative w-full flex-1 flex items-center justify-center overflow-hidden rounded-2xl bg-black/50 border border-white/5">
                    <img
                      src={generatedImage}
                      alt="Perchance AI Generated"
                      className="max-h-[380px] w-auto object-contain rounded-xl shadow-2xl transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  </div>

                  {/* Image Metadata Strip */}
                  <div className="w-full grid grid-cols-3 gap-2 text-center text-xs font-mono">
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-white/5">
                      <div className="text-[10px] text-slate-400">File Size</div>
                      <div className="font-bold text-pink-300">
                        {imageMeta?.bytes ? `${(imageMeta.bytes / 1024).toFixed(1)} KB` : "HD JPEG"}
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-white/5">
                      <div className="text-[10px] text-slate-400">Gen Time</div>
                      <div className="font-bold text-emerald-300">
                        {imageMeta?.durationMs ? `${(imageMeta.durationMs / 1000).toFixed(1)}s` : "Fast"}
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-white/5">
                      <div className="text-[10px] text-slate-400">Engine</div>
                      <div className="font-bold text-amber-300">Perchance SD</div>
                    </div>
                  </div>

                  {/* Actions Buttons */}
                  <div className="w-full flex items-center gap-2">
                    <button
                      onClick={handleDownload}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-400 hover:to-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(244,63,94,0.35)] transition-all cursor-pointer active:scale-98"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download HD Photo</span>
                    </button>
                    <a
                      href={generatedImage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 border border-white/10 transition-all"
                    >
                      <Eye className="w-4 h-4" />
                      <span>View Full</span>
                    </a>
                  </div>
                </div>
              ) : isGenerating ? (
                /* Scanning Radar Animation while generating */
                <div className="flex flex-col items-center justify-center gap-4 text-center p-6">
                  <div className="relative w-24 h-24 rounded-full border-2 border-pink-500/30 flex items-center justify-center animate-pulse">
                    <div className="absolute inset-0 rounded-full border border-pink-400/60 animate-ping" />
                    <Sparkles className="w-10 h-10 text-pink-400 animate-spin" style={{ animationDuration: "6s" }} />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-pink-300">Synthesizing High-Definition Photo</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                      Headless Chrome browser Perchance engine par photo generate karke network stream capture kar raha hai...
                    </p>
                  </div>
                  <div className="px-3.5 py-1.5 rounded-full bg-pink-500/10 border border-pink-500/30 text-xs font-mono text-pink-300 animate-pulse">
                    ⏱️ Time Elapsed: {timerSeconds}s
                  </div>
                </div>
              ) : (
                /* Empty Placeholder */
                <div className="flex flex-col items-center justify-center gap-3 text-center p-6 text-slate-500">
                  <div className="w-16 h-16 rounded-3xl bg-slate-950/80 border border-white/5 flex items-center justify-center text-3xl shadow-inner">
                    🖼️
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-400">Ready to Generate</h4>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs">
                      Left side prompt fill karke <b>"Generate Photo"</b> click karein. Photo result yahan instant load hoga.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* WhatsApp Integration Help Card */}
            <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-200 space-y-1.5">
              <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                <span>📲 WhatsApp Bot Direct Trigger:</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                WhatsApp par kabhi bhi ye command bhej kar photo generate kar sakte hain:
              </p>
              <div className="p-2 rounded-xl bg-black/60 border border-emerald-500/30 font-mono text-[11px] text-emerald-300 flex items-center justify-between">
                <span>@hot image {prompt.substring(0, 30)}...</span>
                <button
                  onClick={copyWhatsAppCmd}
                  className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-colors"
                >
                  {copiedCommand ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
