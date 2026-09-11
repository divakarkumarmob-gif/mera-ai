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
} from 'lucide-react';
import { PhoneIntelligenceReport } from '../services/phoneIntelligenceService';

interface PhoneIntelligenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialNumber?: string;
}

export const PhoneIntelligenceModal: React.FC<PhoneIntelligenceModalProps> = ({
  isOpen,
  onClose,
  initialNumber = '',
}) => {
  const [phoneNumber, setPhoneNumber] = useState(initialNumber);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<PhoneIntelligenceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative w-full max-w-2xl rounded-3xl bg-slate-950/95 border border-cyan-500/30 shadow-[0_0_80px_rgba(6,182,212,0.2)] overflow-hidden text-slate-100 flex flex-col my-auto"
      >
        {/* Glow Flares */}
        <div className="absolute top-0 left-1/4 w-80 h-28 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-0 right-1/4 w-80 h-28 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* ── Top Header ── */}
        <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500/30 to-blue-500/20 border border-cyan-400/40 flex items-center justify-center text-xl shadow-[0_0_20px_rgba(6,182,212,0.3)]">
              📱
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold bg-gradient-to-r from-cyan-300 via-blue-200 to-white bg-clip-text text-transparent">
                  Friday Phone Radar & Truecaller OSINT
                </h2>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-[11px] font-mono text-cyan-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  LIVE RADAR
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Deep Carrier extraction, Telecom circle, WhatsApp identity, and Spam Risk verification.
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
        <div className="p-5 flex flex-col gap-4 border-b border-white/5 bg-slate-900/30">
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
                placeholder="Enter 10-digit number (e.g. 9835012345 or +91...)"
                className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 text-sm font-mono text-slate-100 placeholder-slate-500"
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
                  <span>Scan Number</span>
                </>
              )}
            </button>
          </form>

          {/* Quick presets */}
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400">
            <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-cyan-400" /> Quick Tests:
            </span>
            <button
              type="button"
              onClick={() => {
                setPhoneNumber('7004123456');
                handleLookup('7004123456');
              }}
              className="px-2.5 py-1 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-slate-300 border border-white/5 font-mono cursor-pointer transition"
            >
              Jio (Bihar/JH)
            </button>
            <button
              type="button"
              onClick={() => {
                setPhoneNumber('9810123456');
                handleLookup('9810123456');
              }}
              className="px-2.5 py-1 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-slate-300 border border-white/5 font-mono cursor-pointer transition"
            >
              Airtel (Delhi)
            </button>
            <button
              type="button"
              onClick={() => {
                setPhoneNumber('1409999999');
                handleLookup('1409999999');
              }}
              className="px-2.5 py-1 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-rose-300 border border-rose-500/20 font-mono cursor-pointer transition"
            >
              Telemarketer (140)
            </button>
          </div>
        </div>

        {/* ── Main Report Display ── */}
        <div className="p-5 flex-1 overflow-y-auto max-h-[60vh] flex flex-col gap-4">
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
              <div className="text-sm font-bold text-cyan-300">Scanning Telecom & OSINT Nodes...</div>
              <div className="text-xs text-slate-400">Verifying HLR Routing, Operator, Circle and Spam databases</div>
            </div>
          )}

          {!loading && !report && !error && (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-center text-slate-400">
              <div className="w-12 h-12 rounded-full bg-slate-900 border border-white/10 flex items-center justify-center text-xl text-cyan-400">
                📡
              </div>
              <div className="text-sm font-semibold text-slate-300">No Number Scanned Yet</div>
              <div className="text-xs text-slate-500 max-w-sm">
                Enter any mobile or phone number above to extract Carrier, Circle, WhatsApp identity, and Safety Risk.
              </div>
            </div>
          )}

          {!loading && report && (
            <div className="flex flex-col gap-4">
              {/* Primary Identity Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950 border border-cyan-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(6,182,212,0.25)]">
                    {report.savedContact ? '👤' : '📱'}
                  </div>
                  <div>
                    <div className="text-xs text-cyan-400 font-mono flex items-center gap-1.5">
                      <span>{report.country}</span>
                      <span>•</span>
                      <span className="text-slate-400">{report.numberType.toUpperCase()}</span>
                    </div>
                    <div className="text-xl font-bold font-mono text-white tracking-wide">
                      {report.internationalFormat}
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

              {/* Grid of Telecom & OSINT Highlights */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Operator Card */}
                <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-lg text-blue-400">
                    📡
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Telecom Carrier / Operator</div>
                    <div className="text-sm font-bold text-slate-100">{report.operator}</div>
                  </div>
                </div>

                {/* Telecom Circle Card */}
                <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-lg text-emerald-400">
                    <MapPin className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Telecom Circle / State</div>
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
                      <span>{report.whatsappProfile?.isRegistered ? 'Registered on WhatsApp' : 'Standard Mobile'}</span>
                    </div>
                  </div>
                </div>

                {/* Number Format Validity */}
                <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-lg text-cyan-400">
                    ⚡
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">National Dial Format</div>
                    <div className="text-sm font-mono font-bold text-slate-100">{report.nationalFormat}</div>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Message, Call, Web Search */}
              <div className="flex items-center gap-2 pt-2 border-t border-white/5 flex-wrap">
                <a
                  href={report.osintFootprints.whatsappDirectUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-xs font-semibold shadow-md transition cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Open WhatsApp Chat</span>
                </a>

                <a
                  href={`tel:${report.normalizedNumber}`}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 text-xs font-semibold shadow-md transition cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Call Number</span>
                </a>

                <a
                  href={report.osintFootprints.googleSearchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-white/10 text-xs font-medium transition cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Google OSINT Search</span>
                </a>

                <a
                  href={report.osintFootprints.truecallerWebUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-white/10 text-xs font-medium transition cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Truecaller Web</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default PhoneIntelligenceModal;
