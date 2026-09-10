import React, { useState, useEffect } from "react";
import {
  Gamepad2,
  X,
  Smartphone,
  Wifi,
  Eye,
  Crosshair,
  Shield,
  Zap,
  Activity,
  Sliders,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  Play,
  Upload,
} from "lucide-react";

interface FreeFireCoachModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FreeFireCoachModal: React.FC<FreeFireCoachModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<"connect" | "custom_room" | "actions" | "analysis">("connect");
  const [phoneIp, setPhoneIp] = useState("192.168.1.");
  const [phonePort, setPhonePort] = useState("5555");
  const [connecting, setConnecting] = useState(false);
  const [devices, setDevices] = useState<any[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Custom Room State
  const [roomId, setRoomId] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [roomRole, setRoomRole] = useState<"spectate" | "player">("spectate");
  const [joiningRoom, setJoiningRoom] = useState(false);

  // Analysis State
  const [playerTag, setPlayerTag] = useState("DK Boss");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisReport, setAnalysisReport] = useState<any>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchDevices();
    }
  }, [isOpen]);

  const fetchDevices = async () => {
    try {
      const res = await fetch("/api/gaming/freefire/devices");
      const data = await res.json();
      if (data.ok && data.devices) {
        setDevices(data.devices);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleConnectWireless = async () => {
    if (!phoneIp.trim()) return;
    setConnecting(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/gaming/freefire/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: phoneIp.trim(), port: Number(phonePort) || 5555 }),
      });
      const data = await res.json();
      setStatusMsg(data.message || (data.ok ? "Connected successfully!" : "Connection failed"));
      fetchDevices();
    } catch (err: any) {
      setStatusMsg("Error connecting: " + err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleJoinCustomRoom = async () => {
    if (!roomId.trim()) return;
    setJoiningRoom(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/gaming/freefire/custom-room/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: roomId.trim(),
          password: roomPassword.trim() || undefined,
          role: roomRole,
        }),
      });
      const data = await res.json();
      setStatusMsg(data.message || "Custom Room command sent!");
    } catch (err: any) {
      setStatusMsg("Error: " + err.message);
    } finally {
      setJoiningRoom(false);
    }
  };

  const handleExecuteAction = async (action: string, gunType?: string) => {
    try {
      const res = await fetch("/api/gaming/freefire/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, gunType }),
      });
      const data = await res.json();
      setStatusMsg(data.details || `Action ${action} executed!`);
    } catch (err: any) {
      setStatusMsg("Action failed: " + err.message);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRunAnalysis = async () => {
    setAnalyzing(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/gaming/freefire/post-match-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerTag,
          customRoomId: roomId || "Custom 4v4",
          gameplayNotes: "Competitive custom match review",
          matchFramesBase64: selectedImage ? [selectedImage] : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok && data.report) {
        setAnalysisReport(data.report);
      }
    } catch (err: any) {
      setStatusMsg("Analysis failed: " + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-slate-900/95 border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-amber-950/40 via-slate-900 to-amber-950/40 border-b border-amber-500/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/20 rounded-xl border border-amber-500/40 text-amber-400">
              <Gamepad2 className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-black text-amber-300 tracking-wider flex items-center gap-2 uppercase">
                FRIDAY Esports AI Coach & Bot Engine
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  FREE FIRE SPECIAL EDITION
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                WiFi ADB Auto-Player • Live Spectator • Multimodal Weakness & Sensitivity Analyzer
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-800 bg-slate-950/60 px-6 gap-2 pt-2">
          {[
            { id: "connect", label: "1. Phone / ADB Connect", icon: Smartphone },
            { id: "custom_room", label: "2. Custom Room Join", icon: Eye },
            { id: "actions", label: "3. Fast Combat Macros", icon: Crosshair },
            { id: "analysis", label: "4. AI Match Analysis & Settings", icon: Sparkles },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition ${
                  isActive
                    ? "border-amber-400 text-amber-300 bg-amber-500/10 rounded-t-lg"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200">
          {statusMsg && (
            <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl text-amber-300 text-xs flex items-center gap-2">
              <Activity className="w-4 h-4 shrink-0" />
              <span>{statusMsg}</span>
            </div>
          )}

          {/* TAB 1: CONNECT */}
          {activeTab === "connect" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Wireless ADB Box */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-5 space-y-4">
                  <h3 className="text-base font-bold text-amber-300 flex items-center gap-2">
                    <Wifi className="w-5 h-5 text-amber-400" />
                    Jugaad 1: Wireless WiFi ADB Connect
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Apne phone me <b>Developer Options → Wireless Debugging</b> ON karein aur IP & Port enter karein.
                    Game phone par chalega, FRIDAY laptop se wirelessly touch control karegi!
                  </p>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-xs text-slate-400 block mb-1">Phone IP Address</label>
                      <input
                        type="text"
                        value={phoneIp}
                        onChange={(e) => setPhoneIp(e.target.value)}
                        placeholder="e.g. 192.168.1.15"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div className="w-24">
                      <label className="text-xs text-slate-400 block mb-1">Port</label>
                      <input
                        type="text"
                        value={phonePort}
                        onChange={(e) => setPhonePort(e.target.value)}
                        placeholder="5555"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleConnectWireless}
                    disabled={connecting}
                    className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-sm transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                  >
                    {connecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {connecting ? "Connecting..." : "Pair & Connect Device"}
                  </button>
                </div>

                {/* Connected Devices List */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
                      <Smartphone className="w-5 h-5 text-emerald-400" />
                      Active Devices ({devices.length})
                    </h3>
                    <button
                      onClick={fetchDevices}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
                      title="Refresh Devices"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {devices.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No ADB devices detected yet. Connect via USB or WiFi.</p>
                    ) : (
                      devices.map((dev, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 bg-slate-900/90 border border-slate-800 rounded-xl"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                            <div>
                              <div className="text-sm font-semibold text-slate-200">{dev.model || dev.id}</div>
                              <div className="text-xs text-slate-400 uppercase">
                                Type: {dev.type} • Status: {dev.status}
                              </div>
                            </div>
                          </div>
                          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            ONLINE
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CUSTOM ROOM */}
          {activeTab === "custom_room" && (
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-6 space-y-5 max-w-xl mx-auto">
              <h3 className="text-base font-bold text-amber-300 flex items-center gap-2">
                <Eye className="w-5 h-5 text-amber-400" />
                Custom Match Spectator / Player Automation
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Room ID aur Password enter karein. FRIDAY game me automatically custom room find karegi aur Spectate slot me baith kar match monitor karegi.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Custom Room ID</label>
                  <input
                    type="text"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    placeholder="e.g. 8839219"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Room Password (Optional)</label>
                  <input
                    type="text"
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value)}
                    placeholder="e.g. 1234"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Role in Custom</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setRoomRole("spectate")}
                      className={`p-3 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition ${
                        roomRole === "spectate"
                          ? "bg-amber-500/20 border-amber-400 text-amber-300"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      <Eye className="w-4 h-4" />
                      Spectate (Coach Mode)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoomRole("player")}
                      className={`p-3 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition ${
                        roomRole === "player"
                          ? "bg-amber-500/20 border-amber-400 text-amber-300"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      <Crosshair className="w-4 h-4" />
                      Player (Autonomous Bot)
                    </button>
                  </div>
                </div>
              </div>

              <button
                onClick={handleJoinCustomRoom}
                disabled={joiningRoom || !roomId.trim()}
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-sm transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
              >
                {joiningRoom ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {joiningRoom ? "Entering Custom Room..." : "Join Custom Room Now"}
              </button>
            </div>
          )}

          {/* TAB 3: FAST COMBAT MACROS */}
          {activeTab === "actions" && (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Direct in-game touch synthesized actions with humanized non-linear bezier curves:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <button
                  onClick={() => handleExecuteAction("drag_headshot", "shotgun")}
                  className="p-4 bg-slate-950/80 border border-slate-800 hover:border-amber-500 rounded-xl text-left space-y-2 group transition"
                >
                  <div className="p-2 bg-red-500/20 text-red-400 w-fit rounded-lg group-hover:scale-110 transition">
                    <Crosshair className="w-5 h-5" />
                  </div>
                  <div className="text-sm font-bold text-slate-200">M1887 / Shotgun Drag</div>
                  <div className="text-xs text-slate-400">Fast 420px J-curve upward drag (70ms)</div>
                </button>

                <button
                  onClick={() => handleExecuteAction("drag_headshot", "smg")}
                  className="p-4 bg-slate-950/80 border border-slate-800 hover:border-amber-500 rounded-xl text-left space-y-2 group transition"
                >
                  <div className="p-2 bg-amber-500/20 text-amber-400 w-fit rounded-lg group-hover:scale-110 transition">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div className="text-sm font-bold text-slate-200">MP40 / SMG Red Dot Drag</div>
                  <div className="text-xs text-slate-400">Smooth 320px vertical tracking (110ms)</div>
                </button>

                <button
                  onClick={() => handleExecuteAction("quick_gloo")}
                  className="p-4 bg-slate-950/80 border border-slate-800 hover:border-amber-500 rounded-xl text-left space-y-2 group transition"
                >
                  <div className="p-2 bg-blue-500/20 text-blue-400 w-fit rounded-lg group-hover:scale-110 transition">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div className="text-sm font-bold text-slate-200">360 Sit-up Gloo Wall</div>
                  <div className="text-xs text-slate-400">Gloo + Crouch + Ground Drag (95ms)</div>
                </button>

                <button
                  onClick={() => handleExecuteAction("jump_shot")}
                  className="p-4 bg-slate-950/80 border border-slate-800 hover:border-amber-500 rounded-xl text-left space-y-2 group transition"
                >
                  <div className="p-2 bg-emerald-500/20 text-emerald-400 w-fit rounded-lg group-hover:scale-110 transition">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div className="text-sm font-bold text-slate-200">Jump Drag Shot</div>
                  <div className="text-xs text-slate-400">Jump apex synchronization headshot</div>
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: MATCH ANALYSIS & WEAKNESS BREAKDOWN */}
          {activeTab === "analysis" && (
            <div className="space-y-6">
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-amber-300 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-amber-400" />
                      Multimodal Gemini Vision Coach Report
                    </h3>
                    <p className="text-xs text-slate-400">
                      Upload screenshot or click analyze for instant weakness detection & sensitivity tuning.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold cursor-pointer flex items-center gap-2 transition">
                      <Upload className="w-4 h-4" />
                      Upload Frame
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                    </label>
                    <button
                      onClick={handleRunAnalysis}
                      disabled={analyzing}
                      className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs transition flex items-center gap-2 disabled:opacity-50"
                    >
                      {analyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
                      {analyzing ? "Analyzing..." : "Generate AI Breakdown"}
                    </button>
                  </div>
                </div>

                {selectedImage && (
                  <div className="flex items-center gap-3 p-2 bg-slate-900 rounded-lg border border-slate-800">
                    <img src={selectedImage} alt="Match Frame" className="h-14 w-24 object-cover rounded-md" />
                    <span className="text-xs text-emerald-400">Screenshot staged for AI Vision Inspection</span>
                  </div>
                )}
              </div>

              {analysisReport && (
                <div className="space-y-6 animate-fade-in">
                  {/* Coach Audio Speech Box */}
                  <div className="p-4 bg-gradient-to-r from-amber-950/50 to-slate-900 border border-amber-500/40 rounded-xl space-y-2">
                    <div className="text-xs font-bold text-amber-400 flex items-center gap-2 uppercase tracking-wider">
                      <Sparkles className="w-4 h-4" />
                      FRIDAY Coach Voice Briefing (Hinglish)
                    </div>
                    <p className="text-sm text-slate-200 italic leading-relaxed">
                      "{analysisReport.coachAudioSummaryHinglish}"
                    </p>
                  </div>

                  {/* Weaknesses List */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
                    <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      Detected Mistakes & Weaknesses
                    </h4>
                    <div className="space-y-3">
                      {analysisReport.weaknesses?.map((w: any, idx: number) => (
                        <div
                          key={idx}
                          className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-amber-300">{w.category}</span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                w.severity === "High"
                                  ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                  : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              }`}
                            >
                              {w.severity} Severity
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{w.description}</p>
                          <div className="text-xs text-emerald-400 flex items-center gap-1.5 pt-1">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span><b>Fix:</b> {w.actionableFix}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sensitivity & HUD Settings */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Sensitivity */}
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3">
                      <h4 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                        <Sliders className="w-4 h-4 text-amber-400" />
                        Recommended Sensitivity (Settings)
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2.5 bg-slate-900 rounded-lg flex justify-between">
                          <span className="text-slate-400">General:</span>
                          <span className="font-bold text-amber-300">
                            {analysisReport.sensitivityRecommendations?.general}
                          </span>
                        </div>
                        <div className="p-2.5 bg-slate-900 rounded-lg flex justify-between">
                          <span className="text-slate-400">Red Dot:</span>
                          <span className="font-bold text-amber-300">
                            {analysisReport.sensitivityRecommendations?.redDot}
                          </span>
                        </div>
                        <div className="p-2.5 bg-slate-900 rounded-lg flex justify-between">
                          <span className="text-slate-400">2x Scope:</span>
                          <span className="font-bold text-amber-300">
                            {analysisReport.sensitivityRecommendations?.scope2x}
                          </span>
                        </div>
                        <div className="p-2.5 bg-slate-900 rounded-lg flex justify-between">
                          <span className="text-slate-400">4x Scope:</span>
                          <span className="font-bold text-amber-300">
                            {analysisReport.sensitivityRecommendations?.scope4x}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 italic pt-1">
                        {analysisReport.sensitivityRecommendations?.reasoning}
                      </p>
                    </div>

                    {/* HUD & Button Setup */}
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-3">
                      <h4 className="text-sm font-bold text-emerald-300 flex items-center gap-2">
                        <Crosshair className="w-4 h-4 text-emerald-400" />
                        Custom HUD & Button Size Advice
                      </h4>
                      <div className="space-y-2 text-xs">
                        <div className="p-2.5 bg-slate-900 rounded-lg flex justify-between">
                          <span className="text-slate-400">Fire Button Size:</span>
                          <span className="font-bold text-emerald-300">
                            {analysisReport.hudAdvice?.fireButtonSize}
                          </span>
                        </div>
                        <div className="p-2.5 bg-slate-900 rounded-lg flex justify-between">
                          <span className="text-slate-400">Gloo Wall Slot:</span>
                          <span className="font-bold text-emerald-300">
                            {analysisReport.hudAdvice?.glooWallPlacement}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
