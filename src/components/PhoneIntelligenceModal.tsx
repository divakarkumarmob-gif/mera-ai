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
import { PhoneIntelligenceReport, GoogleDorkItem, SmartUnmaskCandidate } from '../services/phoneIntelligenceService';

interface PhoneIntelligenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialNumber?: string;
}

type OsintTab = 'telecom' | 'sim_recon' | 'social' | 'dorks' | 'scanners' | 'github' | 'security';

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
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [copiedNumber, setCopiedNumber] = useState(false);

  // Smart Email Unmasker states
  const [unmaskName, setUnmaskName] = useState('');
  const [unmaskMask, setUnmaskMask] = useState('');
  const [customUnmaskList, setCustomUnmaskList] = useState<SmartUnmaskCandidate[] | null>(null);
  const [isUnmasking, setIsUnmasking] = useState(false);

  const handleLookup = async (overrideNumber?: string) => {
    const target = (overrideNumber || phoneNumber).trim();
    if (!target) return;

    setLoading(true);
    setError(null);
    setCustomUnmaskList(null);
    setUnmaskMask('');

    try {
      const res = await fetch('/api/phone-intelligence/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: target }),
      });
      const data = await res.json();
      if (data.ok && data.report) {
        setReport(data.report);
        setUnmaskName(data.report.savedContact?.name || '');
        setCustomUnmaskList(data.report.unmaskCandidates || null);
      } else {
        setError(data.error || 'Failed to lookup phone intelligence report');
      }
    } catch (err: any) {
      setError(err?.message || 'Network error while connecting to Phone Radar');
    } finally {
      setLoading(false);
    }
  };

  const handleRunUnmask = async () => {
    if (!report) return;
    setIsUnmasking(true);
    try {
      const res = await fetch('/api/phone-intelligence/unmask-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: report.normalizedNumber,
          name: unmaskName.trim() || report.savedContact?.name,
          nickname: report.savedContact?.nickname,
          maskPattern: unmaskMask.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok && data.candidates) {
        setCustomUnmaskList(data.candidates);
      }
    } catch {
    } finally {
      setIsUnmasking(false);
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
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Quick Demos:
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
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                activeTab === 'telecom'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Identity & Carrier</span>
            </button>

            <button
              onClick={() => setActiveTab('sim_recon')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                activeTab === 'sim_recon'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>SIM Owner & Other Numbers ({report.simOwnership?.associatedNumbersDorks?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('social')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                activeTab === 'social'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Social & Emails ({report.socialIntelligence?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('dorks')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                activeTab === 'dorks'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Google Dorks ({report.googleDorks?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('github')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                activeTab === 'github'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>GitHub OSINT Tools ({report.githubOsintTools?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('scanners')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
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
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                activeTab === 'security'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Threat Score</span>
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

              {/* ── TAB 2: SIM Registration & Associated Numbers (TAFCOP & Registry Dorks) ── */}
              {activeTab === 'sim_recon' && (
                <div className="flex flex-col gap-3.5">
                  {/* Subscriber Attribution Card */}
                  <div className="p-4 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950/40 border border-blue-500/30 shadow-xl flex flex-col gap-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-2xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-300 text-lg">
                          🆔
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white flex items-center gap-2">
                            <span>Subscriber Identity Attribution</span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                                report.simOwnership?.confidence === 'high'
                                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                  : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                              }`}
                            >
                              {report.simOwnership?.confidence === 'high' ? 'HIGH CONFIDENCE' : 'INFERRED MATCH'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-300 font-semibold mt-0.5">
                            Owner / Name Match:{' '}
                            <span className="text-cyan-300 font-mono font-bold">
                              {report.simOwnership?.inferredOwnerName || 'Unsaved Mobile Subscriber'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-white/5 text-[11px] text-slate-400">
                      <span className="text-slate-500 font-mono">Attribution Vectors:</span>
                      {report.simOwnership?.attributionSources.map((src, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-lg bg-slate-800/80 border border-white/5 text-slate-300 font-mono text-[10px]">
                          ✓ {src}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* DoT Official TAFCOP Portal Callout */}
                  <div className="p-4 rounded-3xl bg-gradient-to-br from-amber-950/30 via-slate-900 to-slate-950 border border-amber-500/30 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl text-amber-300 shrink-0">
                        🏛️
                      </div>
                      <div>
                        <div className="text-xs font-bold text-amber-200 flex items-center gap-2">
                          <span>DoT TAFCOP (Telecom Analytics for Fraud Management & Consumer Protection)</span>
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono">
                            GOVT OF INDIA
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Official Department of Telecommunications portal to check ALL mobile connections registered against an Aadhaar / KYC identity.
                        </p>
                      </div>
                    </div>

                    <a
                      href="https://tafcop.sancharsaathi.gov.in/"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                    >
                      <span>Open TAFCOP</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  {/* Associated Numbers Recon Matrix */}
                  <div className="flex flex-col gap-2.5">
                    <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Associated Numbers & Public Registry Investigation Vectors:</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {report.simOwnership?.associatedNumbersDorks.map((item) => (
                        <div
                          key={item.id}
                          className="p-3.5 rounded-2xl bg-slate-900/80 border border-cyan-500/20 hover:border-cyan-500/40 transition flex flex-col justify-between gap-2.5"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{item.icon}</span>
                                <div>
                                  <div className="text-xs font-bold text-white">{item.title}</div>
                                  <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] font-mono text-cyan-400">
                                    {item.badge}
                                  </span>
                                </div>
                              </div>

                              <a
                                href={item.actionUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2.5 py-1 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 text-[11px] font-semibold border border-cyan-500/30 transition cursor-pointer flex items-center gap-1"
                              >
                                <span>Recon</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>

                            <p className="text-[11px] text-slate-400 mt-2">{item.methodDescription}</p>
                          </div>

                          {item.dorkQuery && (
                            <div className="p-1.5 rounded-lg bg-black/40 border border-white/5 font-mono text-[10px] text-slate-300 break-all select-all flex items-center justify-between gap-2">
                              <span className="truncate">{item.dorkQuery}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(item.dorkQuery || '');
                                  setCopiedCmd(item.id);
                                  setTimeout(() => setCopiedCmd(null), 2000);
                                }}
                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 text-[10px] cursor-pointer shrink-0"
                              >
                                {copiedCmd === item.id ? '✓' : 'Copy'}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── TAB 3: Social Media & Emails Recon (Ignorant / GHunt Vector) ── */}
              {activeTab === 'social' && (
                <div className="flex flex-col gap-3.5">
                  <div className="p-3 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-200 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Direct Reverse Social Footprints & Recovery Identity Vectors</span>
                    </span>
                    <span className="text-[11px] font-mono text-cyan-400">Target: {report.internationalFormat}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {report.socialIntelligence?.map((soc) => (
                      <div
                        key={soc.id}
                        className="p-4 rounded-2xl bg-slate-900/80 border border-white/5 hover:border-cyan-500/40 transition flex flex-col justify-between gap-3 shadow-md"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <span className="text-2xl">{soc.icon}</span>
                              <div>
                                <div className="text-sm font-bold text-slate-100">{soc.platform}</div>
                                <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-mono text-cyan-300">
                                  {soc.badge}
                                </span>
                              </div>
                            </div>
                            <a
                              href={soc.actionUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/60 text-cyan-200 text-xs font-semibold border border-cyan-500/30 transition cursor-pointer"
                            >
                              <span>Recon</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>

                          <div className="mt-2.5 text-xs text-slate-400">
                            {soc.description}
                          </div>
                        </div>

                        <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[11px] text-cyan-300 flex items-center justify-between">
                          <span className="truncate">{soc.osintMethod}</span>
                          <span className="text-slate-500 text-[10px]">1-Click</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── Smart Email Unmasker & Pattern Decoder ── */}
                  <div className="mt-2 p-4 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-950 to-cyan-950/40 border border-cyan-500/30 shadow-xl flex flex-col gap-3.5">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 text-base">
                          🧩
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white flex items-center gap-2">
                            <span>Smart OSINT Email Unmasker</span>
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-mono text-emerald-300">
                              DECODER ACTIVE
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Unmasks patterns (e.g. <span className="text-cyan-300 font-mono">r***a@gmail.com</span>) by combining Name + UPI footprint + Permutations + Holehe.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Input Controls */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1">
                      <div className="sm:col-span-5">
                        <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                          Target Name / Alias:
                        </label>
                        <input
                          type="text"
                          value={unmaskName}
                          onChange={(e) => setUnmaskName(e.target.value)}
                          placeholder="e.g. Rahul Sharma"
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                        />
                      </div>

                      <div className="sm:col-span-5">
                        <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                          Masked Pattern (Instagram / Google):
                        </label>
                        <input
                          type="text"
                          value={unmaskMask}
                          onChange={(e) => setUnmaskMask(e.target.value)}
                          placeholder="e.g. r***a@gmail.com or r...m"
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-xs font-mono text-cyan-300 placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                        />
                      </div>

                      <div className="sm:col-span-2 flex items-end">
                        <button
                          type="button"
                          onClick={handleRunUnmask}
                          disabled={isUnmasking}
                          className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-bold text-white shadow-lg transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          {isUnmasking ? (
                            <span className="animate-spin text-xs">⚡</span>
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                          <span>Decode</span>
                        </button>
                      </div>
                    </div>

                    {/* Decoded Candidates Stream */}
                    <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                      <div className="flex items-center justify-between text-xs text-slate-300 font-semibold">
                        <span>Candidate Email Matches ({customUnmaskList?.length || 0}):</span>
                        <span className="text-[10px] text-cyan-400 font-mono">1-Click GHunt & Holehe Verification</span>
                      </div>

                      <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
                        {customUnmaskList && customUnmaskList.length > 0 ? (
                          customUnmaskList.map((cand, idx) => (
                            <div
                              key={idx}
                              className={`p-3 rounded-2xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 ${
                                cand.matchesMask
                                  ? 'bg-emerald-950/30 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                                  : 'bg-slate-900/60 border-white/5 hover:border-cyan-500/30'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="text-base">{cand.matchesMask ? '🎯' : '📧'}</span>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold font-mono text-white tracking-wide truncate flex items-center gap-1.5">
                                    <span>{cand.candidateEmail}</span>
                                    {cand.matchesMask && (
                                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                                        MATCH
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                                    <span>{cand.permutationType}</span>
                                    <span>•</span>
                                    <span className={cand.confidenceScore > 85 ? 'text-emerald-400 font-bold' : 'text-cyan-300'}>
                                      {cand.confidenceScore}% Confidence
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(cand.holeheCommand);
                                    setCopiedCmd(cand.holeheCommand);
                                    setTimeout(() => setCopiedCmd(null), 2000);
                                  }}
                                  title="Copy Holehe command"
                                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-300 border border-white/5 transition cursor-pointer"
                                >
                                  {copiedCmd === cand.holeheCommand ? '✓ Copied' : 'holehe'}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(cand.ghuntCommand);
                                    setCopiedCmd(cand.ghuntCommand);
                                    setTimeout(() => setCopiedCmd(null), 2000);
                                  }}
                                  title="Copy GHunt command"
                                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-cyan-300 border border-white/5 transition cursor-pointer"
                                >
                                  {copiedCmd === cand.ghuntCommand ? '✓ Copied' : 'ghunt'}
                                </button>

                                <a
                                  href={cand.googleDorkUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-2 py-1 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 text-[10px] font-semibold text-cyan-200 border border-cyan-500/30 transition cursor-pointer flex items-center gap-1"
                                >
                                  <span>Dork</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>

                                <a
                                  href={cand.pastebinDorkUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-2 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-[10px] font-semibold text-rose-200 border border-rose-500/30 transition cursor-pointer flex items-center gap-1"
                                >
                                  <span>Leaks</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="py-3 text-center text-xs text-slate-500">
                            Enter a name or mask above and click 'Decode' to generate and verify email candidates.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── TAB 3: GitHub OSINT Tools Matrix (Ignorant, Holehe, GHunt, Sherlock) ── */}
              {activeTab === 'github' && (
                <div className="flex flex-col gap-3.5">
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    <span>Top High-Standard Open Source Intelligence Repositories from GitHub:</span>
                  </div>

                  <div className="flex flex-col gap-3">
                    {report.githubOsintTools?.map((tool, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-2xl bg-slate-900/80 border border-cyan-500/20 hover:border-cyan-500/50 transition flex flex-col gap-3"
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center font-mono font-bold text-cyan-400 text-xs">
                              GH
                            </div>
                            <div>
                              <div className="text-sm font-bold text-white flex items-center gap-2">
                                <span>{tool.name}</span>
                                <span className="text-amber-300 text-xs font-mono font-normal">{tool.stars}</span>
                              </div>
                              <div className="text-[11px] text-cyan-300 font-mono">{tool.purpose}</div>
                            </div>
                          </div>

                          <a
                            href={tool.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-200 text-xs font-semibold border border-white/10 transition cursor-pointer shrink-0"
                          >
                            <span>Open GitHub</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <p className="text-xs text-slate-400">{tool.description}</p>

                        <div className="flex items-center justify-between p-2 rounded-xl bg-black/50 border border-white/5 font-mono text-xs text-slate-300 gap-2">
                          <span className="text-emerald-400 select-all">$ {tool.commandDemo}</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(tool.commandDemo);
                              setCopiedCmd(tool.commandDemo);
                              setTimeout(() => setCopiedCmd(null), 2000);
                            }}
                            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 transition cursor-pointer"
                            title="Copy command"
                          >
                            {copiedCmd === tool.commandDemo ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── TAB 4: Google Dork Matrix (PhoneInfoga Spec) ── */}
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
