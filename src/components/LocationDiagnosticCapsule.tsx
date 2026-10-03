import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Satellite,
  Smartphone,
  MapPin,
  Server,
  Database,
  RefreshCw,
  Copy,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  X,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import {
  backgroundLocationService,
  DiagnosticReport,
} from '../utils/backgroundLocationService';

export default function LocationDiagnosticCapsule() {
  const [isNative, setIsNative] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [autoRunCountdown, setAutoRunCountdown] = useState<number | null>(null);

  // Initialize environment detection
  useEffect(() => {
    const native = backgroundLocationService.checkNative();
    setIsNative(native);

    // Show by default on Friday APK (native Capacitor), or if explicitly forced via query param or localStorage
    const params = new URLSearchParams(window.location.search);
    const forceShow =
      params.get('capsule') === 'true' ||
      params.get('debug') === 'location' ||
      localStorage.getItem('friday_show_location_capsule') === 'true';

    // Per user request: "sirf friday apk ke liya... ye bug pakrne ke liya temp h"
    if (native || forceShow) {
      setIsVisible(true);
    }
  }, []);

  // Listen to background location diagnostic broadcast events
  useEffect(() => {
    const handleDiagnosticEvent = (e: any) => {
      if (e?.detail) {
        setReport(e.detail);
      }
    };
    window.addEventListener('friday:location_diagnostic', handleDiagnosticEvent);
    return () => {
      window.removeEventListener('friday:location_diagnostic', handleDiagnosticEvent);
    };
  }, []);

  // Run full diagnostic
  const handleRunDiagnostic = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    try {
      const result = await backgroundLocationService.runFullDiagnostic((updated) => {
        setReport({ ...updated });
      });
      setReport(result);
    } catch (err: any) {
      console.error('[LocationCapsule] Diagnostic run error:', err);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning]);

  // Auto-run once on APK startup after 2.5s delay to verify all 4 layers
  useEffect(() => {
    if (!isVisible) return;
    const timer = setTimeout(() => {
      handleRunDiagnostic();
    }, 2500);
    return () => clearTimeout(timer);
  }, [isVisible, handleRunDiagnostic]);

  const copyReportToClipboard = () => {
    if (!report) return;
    const cleanLog = {
      timestamp: new Date(report.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      platform: report.platform,
      isNative: report.isNative,
      deviceId: report.deviceId,
      deviceLabel: report.deviceLabel,
      overallSuccess: report.overallSuccess,
      step1_registration: report.step1_registration,
      step2_coordinates: report.step2_coordinates,
      step3_serverPing: report.step3_serverPing,
      step4_firestoreVerify: report.step4_firestoreVerify,
    };
    navigator.clipboard?.writeText(JSON.stringify(cleanLog, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  if (!isVisible) return null;

  // Status indicators helper
  const getStatusIcon = (status: 'pending' | 'running' | 'success' | 'failed') => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'running':
        return <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />;
      default:
        return <div className="w-4 h-4 rounded-full border border-slate-600 shrink-0" />;
    }
  };

  const getStatusDot = (status: 'pending' | 'running' | 'success' | 'failed') => {
    switch (status) {
      case 'success':
        return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]';
      case 'failed':
        return 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]';
      case 'running':
        return 'bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]';
      default:
        return 'bg-slate-600';
    }
  };

  const step1 = report?.step1_registration?.status || 'pending';
  const step2 = report?.step2_coordinates?.status || 'pending';
  const step3 = report?.step3_serverPing?.status || 'pending';
  const step4 = report?.step4_firestoreVerify?.status || 'pending';

  return (
    <div className="fixed top-2 left-0 right-0 z-[9999] flex flex-col items-center pointer-events-none px-3 font-sans">
      {/* ── Collapsed Floating Capsule Pill ──────────────────────────────── */}
      <motion.div
        layout
        className="pointer-events-auto cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-slate-950/90 border border-cyan-500/50 shadow-[0_0_25px_rgba(6,182,212,0.35)] backdrop-blur-md text-xs text-slate-200 select-none transition-all hover:border-cyan-400">
          <div className="flex items-center gap-1.5 text-cyan-300 font-semibold tracking-wide">
            <Satellite className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin text-cyan-400' : 'text-cyan-400'}`} />
            <span>APK Location Capsule</span>
          </div>

          <div className="h-3 w-[1px] bg-slate-700/80" />

          {/* Mini 4-step status dots */}
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span className="flex items-center gap-1 text-slate-400" title="1. Phone Registration">
              <span className={`w-2 h-2 rounded-full ${getStatusDot(step1)}`} />
              <span>Reg</span>
            </span>
            <span className="flex items-center gap-1 text-slate-400" title="2. GPS Coordinates">
              <span className={`w-2 h-2 rounded-full ${getStatusDot(step2)}`} />
              <span>GPS</span>
            </span>
            <span className="flex items-center gap-1 text-slate-400" title="3. Server Ping">
              <span className={`w-2 h-2 rounded-full ${getStatusDot(step3)}`} />
              <span>Server</span>
            </span>
            <span className="flex items-center gap-1 text-slate-400" title="4. Firestore DB">
              <span className={`w-2 h-2 rounded-full ${getStatusDot(step4)}`} />
              <span>DB</span>
            </span>
          </div>

          <div className="h-3 w-[1px] bg-slate-700/80" />

          <button
            type="button"
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Toggle details"
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </motion.div>

      {/* ── Expanded Full Diagnostic HUD Modal ─────────────────────────────── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto mt-2 w-full max-w-md rounded-2xl bg-slate-950/95 border border-cyan-500/40 shadow-[0_0_40px_rgba(6,182,212,0.25)] backdrop-blur-xl p-4 text-slate-200 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                  <Satellite className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                    Friday APK Location Diagnostics
                    <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      TEMP
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Device: <span className="text-cyan-300">{report?.deviceId || 'Detecting...'}</span> •{' '}
                    Platform: <span className="text-amber-300">{isNative ? 'Android APK' : 'Web Browser'}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 4 Diagnostic Steps Cards */}
            <div className="my-3 space-y-2 text-xs">
              {/* ── STEP 1: Phone Registration ── */}
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-white/5 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
                    1. Phone Registration (Server)
                  </span>
                  {getStatusIcon(step1)}
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  {report?.step1_registration?.message || 'Ready to test device registration'}
                </p>
                {report?.step1_registration?.durationMs !== undefined && (
                  <span className="text-[9px] text-slate-500 font-mono">
                    Time: {report.step1_registration.durationMs}ms
                  </span>
                )}
              </div>

              {/* ── STEP 2: GPS Coordinates ── */}
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-white/5 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-amber-400" />
                    2. Location Coordinates (Device GPS)
                  </span>
                  {getStatusIcon(step2)}
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  {report?.step2_coordinates?.message || 'Ready to fetch device coordinates'}
                </p>
                {report?.step2_coordinates?.details?.lat && (
                  <div className="text-[10px] text-cyan-300/80 font-mono bg-black/40 px-2 py-1 rounded">
                    Lat: {report.step2_coordinates.details.lat?.toFixed(5)}, Lon:{' '}
                    {report.step2_coordinates.details.lon?.toFixed(5)} (±
                    {Math.round(report.step2_coordinates.details.accuracy || 0)}m)
                  </div>
                )}
                {step2 === 'failed' && isNative && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const nativeBridge = typeof window !== 'undefined' ? (window as any).FridayNativeBridge : null;
                        if (nativeBridge && typeof nativeBridge.requestLocationPermission === 'function') {
                          nativeBridge.requestLocationPermission();
                          setTimeout(() => handleRunDiagnostic(), 1500);
                          return;
                        }
                        const { Geolocation } = await import('@capacitor/geolocation');
                        await Geolocation.requestPermissions();
                        handleRunDiagnostic();
                      } catch (e: any) {
                        alert('Permission request: ' + e?.message);
                      }
                    }}
                    className="mt-1 self-start flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[10px] font-semibold transition-colors"
                  >
                    <MapPin className="w-3 h-3" />
                    <span>📍 Tap here to Grant Location Permission</span>
                  </button>
                )}
              </div>

              {/* ── STEP 3: Server Ping ── */}
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-white/5 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-purple-400" />
                    3. Server Transmission (/api/location/ping)
                  </span>
                  {getStatusIcon(step3)}
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  {report?.step3_serverPing?.message || 'Ready to transmit ping to server'}
                </p>
                {report?.step3_serverPing?.durationMs !== undefined && (
                  <span className="text-[9px] text-slate-500 font-mono">
                    Latency: {report.step3_serverPing.durationMs}ms
                  </span>
                )}
              </div>

              {/* ── STEP 4: Firestore Verification ── */}
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-white/5 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-emerald-400" />
                    4. Firestore Database Check (Server Verified)
                  </span>
                  {getStatusIcon(step4)}
                </div>
                <p
                  className={`text-[11px] font-medium leading-snug ${
                    step4 === 'success'
                      ? 'text-emerald-400'
                      : step4 === 'failed'
                      ? 'text-rose-400'
                      : 'text-slate-400'
                  }`}
                >
                  {report?.step4_firestoreVerify?.message || 'Ready to verify doc in Firestore'}
                </p>
                {report?.step4_firestoreVerify?.details && (
                  <div className="text-[10px] text-slate-400 font-mono bg-black/40 px-2 py-1 rounded space-y-0.5">
                    <div>Doc ID: {report.step4_firestoreVerify.details.deviceId || report?.deviceId}</div>
                    {report.step4_firestoreVerify.details.address && (
                      <div className="truncate">Address: {report.step4_firestoreVerify.details.address}</div>
                    )}
                    {report.step4_firestoreVerify.details.ageSeconds !== undefined && (
                      <div className="text-emerald-300 font-semibold">
                        Freshness: {report.step4_firestoreVerify.details.ageSeconds}s ago
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Overall Verdict Banner */}
            {report && (
              <div
                className={`p-2 rounded-xl text-center text-xs font-semibold mb-3 ${
                  report.overallSuccess
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                }`}
              >
                {report.overallSuccess
                  ? '🎉 All 4 Stages Passed! Phone is live & updated in Firestore!'
                  : '⚠️ Diagnostic incomplete or failed at highlighted step above.'}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1 border-t border-white/10">
              <button
                type="button"
                onClick={handleRunDiagnostic}
                disabled={isRunning}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)] disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
                <span>{isRunning ? 'Testing Steps...' : 'Re-Test / Force Ping'}</span>
              </button>

              <button
                type="button"
                onClick={copyReportToClipboard}
                disabled={!report}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-900 border border-white/10 hover:bg-slate-800 text-slate-300 text-xs transition-colors disabled:opacity-40"
                title="Copy Full Diagnostic JSON"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copied ? 'Copied! ✅' : 'Copy'}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="py-2 px-2.5 rounded-xl bg-slate-900 border border-white/10 hover:bg-slate-800 text-slate-400 text-xs transition-colors"
                title="Minimize Capsule"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
