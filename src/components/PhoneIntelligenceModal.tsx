import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Phone,
  Search,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Radio,
  MapPin,
  ExternalLink,
  MessageSquare,
  UserCheck,
  X,
  Sparkles,
  Zap,
  Globe,
  Terminal,
  Copy,
  Check,
  Send,
  Layers,
  FileText,
  Lock,
  Share2,
} from 'lucide-react';
import { PhoneIntelligenceReport, GoogleDorkItem } from '../services/phoneIntelligenceService';

interface PhoneIntelligenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialNumber?: string;
}

type OsintTab = 'telecom' | 'dorks' | 'scanners' | 'security';

export const PhoneIntelligenceModal: React.FC<PhoneIntelligenceModalProps> = ({
  isOpen,
  onClose,
  initialNumber = '',
}) => {
  const [phoneNumber, setPhoneNumber] = useState(initialNumber);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<PhoneIntelligenceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OsintTab>('telecom');
  const [copiedDorkId, setCopiedDorkId] = useState<string | null>(null);
  const [copiedNumber, setCopiedNumber] = useState(false);

  const handleLookup = async (overrideNumber?: string) => {
    const target = (overrideNumber || phoneNumber).trim();
    if (!target) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/phone-intelligence/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: target }),
      });
      const data = await res.json();
      if (data.ok && data.report) {
        setReport(data.report);
      } else {
        setError(data.error || 'Failed to lookup phone intelligence report');
      }
    } catch (err: any) {
      setError(err?.message || 'Network error while connecting to Phone Radar');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyDork = (dork: GoogleDorkItem) => {
    navigator.clipboard.writeText(dork.dorkQuery);
    setCopiedDorkId(dork.id);
    setTimeout(() => setCopiedDorkId(null), 2000);
  };

  const handleCopyNumber = (num: string) => {
    navigator.clipboard.writeText(num);
    setCopiedNumber(true);
    setTimeout(() => setCopiedNumber(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative w-full max-w-3xl rounded-3xl bg-slate-950/95 border border-cyan-500/30 shadow-[0_0_90px_rgba(6,182,212,0.25)] overflow-hidden text-slate-100 flex flex-col my-auto max-h-[90vh]"
      >
        {/* Glow Flares */}
        <div className="absolute top-0 left-1/4 w-96 h-28 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-0 right-1/4 w-96 h-28 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* ── Top Header ── */}
        <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/70 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500/30 to-blue-500/20 border border-cyan-400/40 flex items-center justify-center text-xl shadow-[0_0_20px_rgba(6,182,212,0.3)]">
              🕵️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold bg-gradient-to-r from-cyan-300 via-blue-200 to-white bg-clip-text text-transparent">
                  Friday OSINT Intelligence Framework
                </h2>
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-[11px] font-mono text-cyan-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  PHONEINFOGA PRO
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Telecom HLR, Google Dork Recon Matrix, Truecaller & WhatsApp Handshake Intelligence.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800/60 hover:bg-red-500/20 text-slate-400 hover:text-red-300 transition border border-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Search Input & Quick Samples ── */}
        <div className="p-4 sm:p-5 flex flex-col gap-3.5 border-b border-white/5 bg-slate-900/40">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLookup();
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Phone className="w-4 h-4 text-cyan-400" />
              </div>
              <input
                type="text"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Enter 10-digit number or international (e.g. 9835012345 or +91...)"
                className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 text-sm font-mono text-slate-100 placeholder-slate-500 shadow-inner"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !phoneNumber.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-sm font-semibold text-white shadow-lg shadow-cyan-900/40 transition disabled:opacity-50 cursor-pointer active:scale-95"
            >
              {loading ? (
                <>
                  <span className="animate-spin text-sm">⚡</span>
                  <span>Scanning...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Execute OSINT</span>
                </>
              )}
            </button>
          </form>

          {/* Quick presets */}
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400">
            <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-cyan-400" /> Quick Demos:
            </span>
            <button
              type="button"
              onClick={() => {
                setPhoneNumber('7004123456');
                handleLookup('7004123456');
              }}
              className="px-2.5 py-1 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-cyan-300 border border-cyan-500/20 font-mono cursor-pointer transition text-xs"
            >
              Jio (Bihar/JH)
            </button>
            <button
              type="button"
              onClick={() => {
                setPhoneNumber('9810123456');
                handleLookup('9810123456');
              }}
              className="px-2.5 py-1 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-blue-300 border border-blue-500/20 font-mono cursor-pointer transition text-xs"
            >
              Airtel (Delhi)
            </button>
            <button
              type="button"
              onClick={() => {
                setPhoneNumber('9415123456');
                handleLookup('9415123456');
              }}
              className="px-2.5 py-1 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-emerald-300 border border-emerald-500/20 font-mono cursor-pointer transition text-xs"
            >
              BSNL (UP East)
            </button>
            <button
              type="button"
              onClick={() => {
                setPhoneNumber('1409999999');
                handleLookup('1409999999');
              }}
              className="px-2.5 py-1 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-rose-300 border border-rose-500/20 font-mono cursor-pointer transition text-xs"
            >
              Telemarketer (140)
            </button>
          </div>
        </div>

        {/* ── Navigation Tabs (When Report Loaded) ── */}
        {report && !loading && (
          <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-white/5 bg-slate-900/60 overflow-x-auto">
            <button
              onClick={() => setActiveTab('telecom')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                activeTab === 'telecom'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Identity & Carrier</span>
            </button>

            <button
              onClick={() => setActiveTab('dorks')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                activeTab === 'dorks'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Google Dork Matrix ({report.googleDorks?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('scanners')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                activeTab === 'scanners'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>OSINT Scanners ({report.osintScanners?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('security')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                activeTab === 'security'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Threat & Spam Score</span>
            </button>
          </div>
        )}

        {/* ── Main Report Display ── */}
        <div className="p-4 sm:p-5 flex-1 overflow-y-auto max-h-[58vh] flex flex-col gap-4">
          {error && (
            <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-cyan-400/20 animate-ping" />
                <div className="w-12 h-12 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                <Radio className="w-5 h-5 text-cyan-400 absolute inset-auto" />
              </div>
              <div className="text-sm font-bold text-cyan-300">Running OSINT Reconnaissance Scanners...</div>
              <div className="text-xs text-slate-400 font-mono">
                [1] E.164 Normalization ➔ [2] HLR Prefix Routing ➔ [3] Dork Recon Matrix ➔ [4] WhatsApp Handshake
              </div>
            </div>
          )}

          {!loading && !report && !error && (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-center text-slate-400">
              <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center text-2xl text-cyan-400 shadow-inner">
                📡
              </div>
              <div className="text-sm font-semibold text-slate-300">OSINT Scanner Ready</div>
              <div className="text-xs text-slate-500 max-w-md">
                Enter any 10-digit mobile number or international phone to extract Telecom Carrier, HLR Circle, Google Dorks, WhatsApp identity, and Threat Risk.
              </div>
            </div>
          )}

          {!loading && report && (
            <div className="flex flex-col gap-4">
              {/* Primary Identity Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950 border border-cyan-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(6,182,212,0.25)]">
                    {report.savedContact ? '👤' : '📱'}
                  </div>
                  <div>
                    <div className="text-xs text-cyan-400 font-mono flex items-center gap-1.5 flex-wrap">
                      <span>{report.country}</span>
                      <span>•</span>
                      <span className="text-slate-400">{report.numberType.toUpperCase()}</span>
                      <span>•</span>
                      <span className="text-slate-500">{report.timezone}</span>
                    </div>
                    <div className="text-xl font-bold font-mono text-white tracking-wide flex items-center gap-2">
                      <span>{report.internationalFormat}</span>
                      <button
                        onClick={() => handleCopyNumber(report.e164Format)}
                        title="Copy E.164 number"
                        className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 transition cursor-pointer"
                      >
                        {copiedNumber ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {report.savedContact && (
                      <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1 mt-0.5">
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Saved as: {report.savedContact.name}</span>
                        {report.savedContact.relationship && (
                          <span className="text-slate-400">({report.savedContact.relationship})</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Spam Risk Badge */}
                <div
                  className={`px-3.5 py-1.5 rounded-2xl border flex items-center gap-2 ${
                    report.spamRisk.level === 'safe'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : report.spamRisk.level === 'low_risk'
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                      : report.spamRisk.level === 'suspicious'
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'bg-rose-500/15 border-rose-500/40 text-rose-300 animate-pulse'
                  }`}
                >
                  {report.spamRisk.level === 'safe' ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  ) : report.spamRisk.level === 'high_spam' ? (
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Shield className="w-4 h-4 text-cyan-400" />
                  )}
                  <div className="text-right">
                    <div className="text-[10px] uppercase font-mono tracking-wider opacity-80">Safety Rating</div>
                    <div className="text-xs font-bold font-mono">{100 - report.spamRisk.score}% Safe</div>
                  </div>
                </div>
              </div>

              {/* ── TAB 1: Telecom & Identity ── */}
              {activeTab === 'telecom' && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Operator Card */}
                    <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/5 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-lg text-blue-400">
                        📡
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">Carrier / Telecom Operator</div>
                        <div className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                          <span>{report.operator}</span>
                          {report.operatorBrand !== 'Unknown' && (
                            <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-[10px] font-mono text-blue-300">
                              {report.operatorBrand}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Telecom Circle Card */}
                    <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/5 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-lg text-emerald-400">
                        <MapPin className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">Telecom Circle / Region</div>
                        <div className="text-sm font-bold text-slate-100">{report.telecomCircle}</div>
                      </div>
                    </div>

                    {/* WhatsApp Status */}
                    <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/5 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-lg text-emerald-400">
                        💬
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">WhatsApp Profile</div>
                        <div className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                          <span>{report.whatsappProfile?.isRegistered ? 'Active on WhatsApp' : 'Standard Mobile'}</span>
                        </div>
                      </div>
                    </div>

                    {/* E.164 Formats */}
                    <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/5 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-lg text-cyan-400">
                        ⚡
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">E.164 Global Format</div>
                        <div className="text-sm font-mono font-bold text-slate-100">{report.e164Format}</div>
                      </div>
                    </div>
                  </div>

                  {/* Predicted UPI VPAs */}
                  {report.upiFootprint && report.countryCode === '+91' && (
                    <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/5 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                        <span className="flex items-center gap-1.5">
                          💳 Predicted UPI Virtual Payment Addresses (VPAs)
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">GPay / PhonePe / Paytm</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {report.upiFootprint.vpaList.map((vpa, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-xl bg-slate-800/80 border border-white/5 text-[11px] font-mono text-cyan-300"
                          >
                            {vpa}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── TAB 2: Google Dork Matrix (PhoneInfoga Spec) ── */}
              {activeTab === 'dorks' && (
                <div className="flex flex-col gap-3">
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Terminal className="w-4 h-4 text-cyan-400" />
                    <span>Specialized Search Engine Dorking Queries (Click to Launch in Google or Copy):</span>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {report.googleDorks.map((dork) => (
                      <div
                        key={dork.id}
                        className="p-3.5 rounded-2xl bg-slate-900/80 border border-cyan-500/20 hover:border-cyan-500/40 transition flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{dork.icon}</span>
                            <span className="text-xs font-bold text-cyan-200">{dork.title}</span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-mono text-slate-400">
                              {dork.category}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleCopyDork(dork)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-300 border border-white/5 transition cursor-pointer"
                            >
                              {copiedDorkId === dork.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy Dork</span>
                                </>
                              )}
                            </button>

                            <a
                              href={dork.searchUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 px-3 py-1 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/50 text-[11px] font-semibold text-cyan-200 border border-cyan-500/30 transition cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Launch Dork</span>
                            </a>
                          </div>
                        </div>

                        <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[11px] text-slate-300 break-all select-all">
                          {dork.dorkQuery}
                        </div>
                        <p className="text-[11px] text-slate-400">{dork.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── TAB 3: OSINT Scanners Launchpad ── */}
              {activeTab === 'scanners' && (
                <div className="flex flex-col gap-3">
                  <div className="text-xs text-slate-400">
                    Direct OSINT database and reconnaissance gateways for <span className="font-mono text-cyan-300">{report.internationalFormat}</span>:
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {report.osintScanners.map((scan, i) => (
                      <a
                        key={i}
                        href={scan.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-4 rounded-2xl bg-slate-900/70 border border-white/5 hover:border-cyan-500/40 hover:bg-slate-900 transition flex flex-col justify-between gap-3 group cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className="text-xl">{scan.icon}</span>
                            <div>
                              <div className="text-sm font-bold text-slate-200 group-hover:text-cyan-300 transition">
                                {scan.name}
                              </div>
                              <span className="text-[10px] font-mono text-cyan-400">{scan.badge}</span>
                            </div>
                          </div>
                          <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 transition" />
                        </div>
                        <p className="text-xs text-slate-400">{scan.description}</p>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* ── TAB 4: Threat & Security Risk ── */}
              {activeTab === 'security' && (
                <div className="flex flex-col gap-3">
                  <div className="p-4 rounded-2xl bg-slate-900/80 border border-white/5 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-cyan-400" />
                        <span className="text-sm font-bold text-slate-200">Spam & Anomaly Assessment</span>
                      </div>
                      <span className="text-xs font-mono text-cyan-300 font-bold">
                        Threat Score: {report.spamRisk.score} / 100
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          report.spamRisk.score > 60
                            ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'
                            : report.spamRisk.score > 30
                            ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
                            : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                        }`}
                        style={{ width: `${report.spamRisk.score}%` }}
                      />
                    </div>

                    <div className="flex flex-col gap-1.5 mt-2">
                      <div className="text-xs font-semibold text-slate-300">Analysis Breakdown:</div>
                      {report.spamRisk.reasons.length > 0 ? (
                        report.spamRisk.reasons.map((r, i) => (
                          <div key={i} className="text-xs text-slate-400 flex items-center gap-2 font-mono">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                            <span>{r}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-emerald-400">No abnormal telecom spam indicators detected.</div>
                      )}
                    </div>
                  </div>

                  {/* VoIP & Virtual Warning */}
                  {report.spamRisk.isVoIPOrVirtual && (
                    <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>Virtual Number / VoIP Gateway indicator flagged. Use caution for 2FA or financial transactions.</span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Quick Action Toolbar ── */}
              <div className="flex items-center gap-2 pt-2 border-t border-white/5 flex-wrap">
                <a
                  href={report.whatsappProfile?.directChatUrl || `https://wa.me/${report.e164Format.replace('+', '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-xs font-semibold shadow-md transition cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Open WhatsApp</span>
                </a>

                <a
                  href={report.telegramProfile?.directChatUrl || `https://t.me/+${report.e164Format.replace('+', '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 border border-cyan-500/40 text-xs font-semibold shadow-md transition cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Open Telegram</span>
                </a>

                <a
                  href={`tel:${report.normalizedNumber}`}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 text-xs font-semibold shadow-md transition cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Call Number</span>
                </a>

                <button
                  type="button"
                  onClick={() => setActiveTab('dorks')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 text-xs font-medium transition cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  <span>View Dorks Matrix</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default PhoneIntelligenceModal;
