import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Settings,
  ShieldCheck,
  Radio,
  Clock,
  Volume2,
  Copy,
  Check,
  X,
  Play,
  RefreshCw,
  Trash2,
  FileText,
  Sparkles,
  ExternalLink,
  MessageSquare,
  Key,
} from 'lucide-react';

interface ExotelTelephonyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExotelTelephonyModal: React.FC<ExotelTelephonyModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'dialer' | 'logs' | 'settings'>('dialer');

  // Config State
  const [config, setConfig] = useState({
    accountSid: '',
    apiKey: '',
    apiToken: '',
    subdomain: 'api.exotel.com',
    virtualNumber: '',
    bossNotificationNumber: '',
    isLive: false,
  });
  const [configLoading, setConfigLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Dialer State
  const [dialNumber, setDialNumber] = useState('');
  const [dialMsg, setDialMsg] = useState('');
  const [isDialing, setIsDialing] = useState(false);
  const [dialResult, setDialResult] = useState<{ success: boolean; message: string; callSid?: string } | null>(null);

  // Call Logs State
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  // Webhook copy
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // Load config & logs on open
  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadLogs();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await fetch('/api/exotel/config');
      const data = await res.json();
      if (data.ok && data.config) {
        setConfig(data.config);
      }
    } catch {}
    setConfigLoading(false);
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await fetch('/api/exotel/call-logs?limit=50');
      const data = await res.json();
      if (data.ok && data.logs) {
        setLogs(data.logs);
      }
    } catch {}
    setLogsLoading(false);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus('Saving...');
    try {
      const res = await fetch('/api/exotel/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.ok) {
        setConfig(data.config);
        setSaveStatus('✅ Settings saved & Live Telephony ready!');
        setTimeout(() => setSaveStatus(null), 3500);
      } else {
        setSaveStatus('❌ Error saving: ' + (data.error || 'Failed'));
      }
    } catch (err: any) {
      setSaveStatus('❌ Network error: ' + err.message);
    }
  };

  const handleMakeCall = async () => {
    const clean = dialNumber.replace(/\D/g, '');
    if (!clean || clean.length < 10) {
      setDialResult({ success: false, message: 'Kripya valid 10-digit phone number dalein.' });
      return;
    }
    setIsDialing(true);
    setDialResult(null);

    try {
      const res = await fetch('/api/exotel/make-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: clean, customMessage: dialMsg }),
      });
      const data = await res.json();
      setDialResult(data);
      if (data.success) {
        setTimeout(loadLogs, 3000);
      }
    } catch (err: any) {
      setDialResult({ success: false, message: err?.message || 'Call trigger failed' });
    } finally {
      setIsDialing(false);
    }
  };

  const getWebhookUrl = () => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/api/exotel/incoming-call`;
    }
    return 'http://localhost:3000/api/exotel/incoming-call';
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(getWebhookUrl());
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-4xl bg-[#090d16] border border-cyan-500/30 rounded-3xl shadow-[0_0_50px_rgba(6,182,212,0.2)] overflow-hidden text-slate-200 flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/40 via-slate-900 to-indigo-950/40">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                <PhoneCall className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg sm:text-xl font-black tracking-wide text-white flex items-center gap-2">
                    FRIDAY <span className="text-cyan-400">Indian Telephony Gateway</span>
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-orange-500/20 border border-orange-500/40 text-orange-400">
                    🇮🇳 Exotel +91
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Real-time Inbound & Outbound AI Voice Receptionist for Boss Divakar
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 px-5 pt-3 border-b border-slate-800/80 bg-slate-950/40">
            <button
              onClick={() => setActiveTab('dialer')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-bold transition-all border-b-2 ${
                activeTab === 'dialer'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <PhoneOutgoing className="w-4 h-4" />
              Live Phone Dialer
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-bold transition-all border-b-2 ${
                activeTab === 'logs'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-4 h-4" />
              Call Logs & Transcripts
              {logs.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px]">
                  {logs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-bold transition-all border-b-2 ${
                activeTab === 'settings'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Settings className="w-4 h-4" />
              Exotel API Credentials
              {config.isLive && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              )}
            </button>
          </div>

          {/* Tab Contents */}
          <div className="p-5 overflow-y-auto flex-1 space-y-5">
            {/* ───────────────── TAB 1: DIALER ───────────────── */}
            {activeTab === 'dialer' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Left: Outbound Call Trigger */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-cyan-300 flex items-center gap-2 mb-3">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      Make Outbound Phone Call via Friday
                    </h3>
                    <p className="text-xs text-slate-400 mb-4">
                      Type any 10-digit Indian phone number. Friday will immediately call from your Exotel Virtual Number and speak directly to them in Hindi/English.
                    </p>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Target Phone Number (+91)
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-2.5 text-xs text-slate-500 font-bold">
                            +91
                          </span>
                          <input
                            type="tel"
                            value={dialNumber}
                            onChange={(e) => setDialNumber(e.target.value)}
                            placeholder="9876543210"
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 pl-12 pr-4 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono tracking-wider"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Custom Message / Purpose (Optional)
                        </label>
                        <textarea
                          rows={2}
                          value={dialMsg}
                          onChange={(e) => setDialMsg(e.target.value)}
                          placeholder="e.g. Boss Divakar ne bola hai ki meeting kal subah 11 baje hogi..."
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-slate-800">
                    <button
                      onClick={handleMakeCall}
                      disabled={isDialing || !dialNumber}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-sm shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {isDialing ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Initiating Cellular Call...
                        </>
                      ) : (
                        <>
                          <PhoneCall className="w-4 h-4" />
                          Call Now via Friday AI
                        </>
                      )}
                    </button>

                    {dialResult && (
                      <div
                        className={`mt-3 p-3 rounded-xl text-xs ${
                          dialResult.success
                            ? 'bg-emerald-950/40 border border-emerald-500/40 text-emerald-300'
                            : 'bg-rose-950/40 border border-rose-500/40 text-rose-300'
                        }`}
                      >
                        {dialResult.message}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Inbound Setup & Status */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-4">
                  <h3 className="text-sm font-bold text-indigo-300 flex items-center gap-2">
                    <Radio className="w-4 h-4 text-indigo-400 animate-pulse" />
                    Inbound Calling Gateway Setup
                  </h3>

                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Virtual Number (ExoPhone):</span>
                      <span className="font-mono font-bold text-cyan-400">
                        {config.virtualNumber || 'Not Configured (Go to Settings)'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Live Telephony Status:</span>
                      <span
                        className={`font-bold flex items-center gap-1.5 ${
                          config.isLive ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            config.isLive ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400'
                          }`}
                        />
                        {config.isLive ? 'Active & Ready' : 'Setup Credentials'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Post-Call WhatsApp Alerts:</span>
                      <span className="font-mono text-slate-300">
                        +{config.bossNotificationNumber || '919315570187'}
                      </span>
                    </div>
                  </div>

                  {/* Webhook Configuration Box */}
                  <div className="p-3 bg-cyan-950/20 border border-cyan-500/30 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-cyan-300">Exotel Passthru Webhook URL:</span>
                      <button
                        onClick={copyWebhook}
                        className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-300 text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        {copiedWebhook ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copiedWebhook ? 'Copied!' : 'Copy URL'}
                      </button>
                    </div>
                    <p className="font-mono text-[11px] text-slate-300 bg-black/40 p-2 rounded border border-cyan-500/20 break-all select-all">
                      {getWebhookUrl()}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      💡 Paste this URL into your Exotel Dashboard's <b>"Applet Flow ➔ Passthru Applet"</b>. Any call to your Exotel Number will automatically route directly to Friday!
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ───────────────── TAB 2: CALL LOGS ───────────────── */}
            {activeTab === 'logs' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    Showing recent incoming and outgoing calls handled by Friday AI.
                  </div>
                  <button
                    onClick={loadLogs}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
                    Refresh Logs
                  </button>
                </div>

                {logs.length === 0 ? (
                  <div className="p-10 text-center bg-slate-900/40 rounded-2xl border border-slate-800">
                    <PhoneIncoming className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-400 font-bold">No calls recorded yet.</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Dial your Exotel number or make a test call from the dialer tab!
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Log List */}
                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                      {logs.map((log, idx) => (
                        <div
                          key={log.callSid || idx}
                          onClick={() => setSelectedLog(log)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer ${
                            selectedLog?.callSid === log.callSid
                              ? 'bg-cyan-950/40 border-cyan-500/60 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono font-bold text-sm text-white flex items-center gap-1.5">
                              {log.direction === 'inbound' ? (
                                <PhoneIncoming className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <PhoneOutgoing className="w-3.5 h-3.5 text-indigo-400" />
                              )}
                              +{log.from}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                              {log.durationSecs ? `${log.durationSecs}s` : 'Call ended'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center justify-between">
                            <span>{new Date(log.startTime).toLocaleString('en-IN')}</span>
                            <span className="text-cyan-400 font-medium">
                              {log.turns?.length || 0} dialogue turns
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Transcript Details Viewer */}
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col max-h-[400px]">
                      {selectedLog ? (
                        <div className="space-y-3 flex-1 overflow-y-auto">
                          <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
                            <h4 className="text-xs font-bold text-white flex items-center gap-2">
                              <FileText className="w-4 h-4 text-cyan-400" />
                              Call Transcript: +{selectedLog.from}
                            </h4>
                            {selectedLog.recordingUrl && (
                              <a
                                href={selectedLog.recordingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                              >
                                <Play className="w-3 h-3" />
                                Audio Recording
                              </a>
                            )}
                          </div>

                          <div className="space-y-2 text-xs">
                            {selectedLog.turns?.map((turn: any, tIdx: number) => (
                              <div
                                key={tIdx}
                                className={`p-2.5 rounded-xl ${
                                  turn.speaker === 'friday'
                                    ? 'bg-cyan-950/30 border border-cyan-500/20 text-cyan-200'
                                    : 'bg-slate-900 border border-slate-800 text-slate-200'
                                }`}
                              >
                                <div className="font-bold text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                                  {turn.speaker === 'friday' ? '🤖 Friday' : '👤 Caller'}:
                                </div>
                                <p>{turn.text}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs">
                          <FileText className="w-8 h-8 mb-2 opacity-50" />
                          Select a call from the left to read its full transcript
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ───────────────── TAB 3: SETTINGS ───────────────── */}
            {activeTab === 'settings' && (
              <form onSubmit={handleSaveConfig} className="space-y-4 max-w-xl mx-auto">
                <div className="p-3 bg-cyan-950/30 border border-cyan-500/30 rounded-xl text-xs text-cyan-300">
                  Enter your Exotel Account details from <b>my.exotel.com ➔ API Settings</b>. All fields are stored securely on your local Mera-AI server.
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">Account SID</label>
                    <input
                      type="text"
                      value={config.accountSid}
                      onChange={(e) => setConfig({ ...config, accountSid: e.target.value })}
                      placeholder="e.g. mycompany123"
                      required
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">API Key</label>
                      <input
                        type="text"
                        value={config.apiKey}
                        onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                        placeholder="e.g. 5a1b2c3d4e..."
                        required
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">API Token</label>
                      <input
                        type="password"
                        value={config.apiToken}
                        onChange={(e) => setConfig({ ...config, apiToken: e.target.value })}
                        placeholder="••••••••••••"
                        required
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        Exotel Virtual Number (ExoPhone)
                        <span className="text-[10px] text-slate-500 font-normal ml-1">(Optional in Trial)</span>
                      </label>
                      <input
                        type="text"
                        value={config.virtualNumber}
                        onChange={(e) => setConfig({ ...config, virtualNumber: e.target.value })}
                        placeholder="08047123456 (or leave empty in Trial)"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        Applet Flow App ID
                        <span className="text-[10px] text-slate-500 font-normal ml-1">(Optional Flow ID)</span>
                      </label>
                      <input
                        type="text"
                        value={(config as any).appId || ''}
                        onChange={(e) => setConfig({ ...config, appId: e.target.value } as any)}
                        placeholder="e.g. 123456"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">API Subdomain</label>
                      <input
                        type="text"
                        value={config.subdomain}
                        onChange={(e) => setConfig({ ...config, subdomain: e.target.value })}
                        placeholder="api.exotel.com"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">Boss Mobile / Alert Number</label>
                      <input
                        type="text"
                        value={config.bossNotificationNumber}
                        onChange={(e) => setConfig({ ...config, bossNotificationNumber: e.target.value })}
                        placeholder="919315570187"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">Boss WhatsApp Notification Number</label>
                    <input
                      type="text"
                      value={config.bossNotificationNumber}
                      onChange={(e) => setConfig({ ...config, bossNotificationNumber: e.target.value })}
                      placeholder="919315570187"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Friday sends instant post-call summaries and transcripts to this number after every call.
                    </p>
                  </div>
                </div>

                <div className="pt-3">
                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all cursor-pointer"
                  >
                    Save & Activate Telephony Gateway
                  </button>

                  {saveStatus && (
                    <div className="mt-2 text-center text-xs font-bold text-slate-200">
                      {saveStatus}
                    </div>
                  )}
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
