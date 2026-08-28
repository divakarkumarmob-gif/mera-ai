import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Mic, Plus, Loader2, Settings, ChevronDown, Captions, MessageSquare, Square, Code2, Terminal, Shield, ShieldCheck, Trash2, Key, Check, AlertCircle, Send, Instagram, Download, Radio, Music, Sparkles, Sliders, Volume2, Bot, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AgentFace from './AgentFace';
import ChatHistoryModal from './ChatHistoryModal';
import WhatsAppPairModal from './WhatsAppPairModal';
import CodeAgentPage from './CodeAgentPage';
import WebCrawlerStudioModal from './WebCrawlerStudioModal';
import { YouTubeStudioModal } from './YouTubeStudioModal';
import MemoryBackupModal from './MemoryBackupModal';
import WifiRadarModal from './WifiRadarModal';
import { getWsUrl, getApiUrl } from '@/utils/api';
import { wakeWordManager } from '@/utils/wakeWord';
import { getAppToken, clearAppSession } from '@/utils/appSecurityClient';
import { screenWakeLock } from '@/utils/screenWakeLock';
import { mobileNotificationService } from '@/utils/mobileNotificationService';
import { MusicCapsule } from './MusicCapsule';
import { MusicStudioModal } from './MusicStudioModal';
import { SongPreviewModal, PreviewCandidate } from './SongPreviewModal';
import AppAccessSection from './AppAccessSection';

interface LiveAIInterfaceProps {
    onClose: () => void;
}

const VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'];
const THINKING_LEVELS = ['low', 'medium', 'high'];

// ── Reusable Toggle Switch with Clear "ON" / "OFF" Visual Badge ───────────────
interface ToggleSwitchProps {
    label: string;
    description?: string;
    active: boolean;
    onToggle: () => void;
    activeColor?: string;
    disabled?: boolean;
}

function ToggleSwitch({ label, description, active, onToggle, activeColor = 'bg-[#10b981]', disabled }: ToggleSwitchProps) {
    return (
        <div className="flex items-center justify-between gap-4 py-2.5 border-b border-white/5 last:border-0">
            <div className="min-w-0 flex-1">
                <span className="text-white text-sm block font-medium leading-tight">{label}</span>
                {description && <span className="text-slate-400 text-xs block mt-0.5 leading-normal">{description}</span>}
            </div>
            <button
                type="button"
                onClick={onToggle}
                disabled={disabled}
                className={`relative inline-flex items-center w-16 h-8 shrink-0 rounded-full transition-colors duration-300 ease-in-out cursor-pointer p-1 select-none active:scale-95 shadow-inner ${
                    active ? (activeColor.startsWith('bg-') ? activeColor : 'bg-[#10b981]') : 'bg-slate-500'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={active ? "Switch OFF" : "Switch ON"}
            >
                {/* Text Label Inside Switch (ON on left, OFF on right) */}
                <span
                    className={`absolute text-[11px] font-black tracking-wider text-white select-none transition-opacity duration-200 ${
                        active ? 'left-2.5 opacity-100' : 'opacity-0'
                    }`}
                >
                    ON
                </span>
                <span
                    className={`absolute text-[10px] font-black tracking-wider text-white select-none transition-opacity duration-200 ${
                        !active ? 'right-2.5 opacity-100' : 'opacity-0'
                    }`}
                >
                    OFF
                </span>

                {/* Sliding Round Knob Button (Zero overflow, perfect alignment) */}
                <span
                    className={`inline-block w-6 h-6 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] transform transition-transform duration-300 ease-in-out pointer-events-none ${
                        active ? 'translate-x-8' : 'translate-x-0'
                    }`}
                />
            </button>
        </div>
    );
}

// ── Baileys Backup WhatsApp Toggle (inline mini-component) ────────────────────
function BaileysToggle() {
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetch('/api/whatsapp/baileys/status')
            .then(r => r.json())
            .then(d => setEnabled(!!d.baileysEnabled))
            .catch(() => {});
    }, []);

    const toggle = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/whatsapp/baileys/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !enabled }),
            });
            const data = await res.json();
            setEnabled(!!data.baileysEnabled);
        } catch { /* ignore */ }
        setLoading(false);
    };

    return (
        <ToggleSwitch
            label="Baileys Backup WhatsApp"
            description={enabled ? '⚡ Backup Active — Baileys fallback ON' : '🛡️ Cloud API Only (Safe)'}
            active={enabled}
            onToggle={toggle}
            activeColor="bg-amber-500"
            disabled={loading}
        />
    );
}

// ── Boss Voice Biometrics & Recognition Manager (Firestore PIN Protected) ────────
function VoiceBiometricsManager() {
    const [profiles, setProfiles] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [pinModal, setPinModal] = useState<{ mode: 'enroll' | 'delete'; targetId?: string } | null>(null);
    const [pinInput, setPinInput] = useState('');
    const [nameInput, setNameInput] = useState('Boss (Divakar)');
    const [relationInput, setRelationInput] = useState('Boss (Self)');
    const [actionStatus, setActionStatus] = useState<{ success?: boolean; message?: string } | null>(null);

    const loadStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/voice-biometrics/status');
            const data = await res.json();
            if (data.ok) setProfiles(data.profiles || []);
        } catch (e) {
            console.error('Failed to fetch voice biometrics status:', e);
        }
    }, []);

    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    const handleConfirmAction = async () => {
        if (!pinInput.trim()) return;
        setLoading(true);
        setActionStatus(null);
        try {
            if (pinModal?.mode === 'enroll') {
                const res = await fetch('/api/voice-biometrics/enroll', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pin: pinInput.trim(),
                        name: nameInput.trim() || 'Boss (Divakar)',
                        relationWithDivakar: relationInput.trim() || 'Boss (Self)',
                        spokenPhrase: `Friday main ${nameInput.trim() || 'Divakar'} hoon, meri aawaz pehchano`,
                    }),
                });
                const data = await res.json();
                if (data.success) {
                    setActionStatus({ success: true, message: data.message });
                    setPinModal(null);
                    setPinInput('');
                    await loadStatus();
                } else {
                    setActionStatus({ success: false, message: data.message || 'Enrollment failed.' });
                }
            } else if (pinModal?.mode === 'delete') {
                const res = await fetch('/api/voice-biometrics/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pin: pinInput.trim(),
                        profileId: pinModal.targetId,
                    }),
                });
                const data = await res.json();
                if (data.success) {
                    setActionStatus({ success: true, message: data.message });
                    setPinModal(null);
                    setPinInput('');
                    await loadStatus();
                } else {
                    setActionStatus({ success: false, message: data.message || 'Delete failed.' });
                }
            }
        } catch (err: any) {
            setActionStatus({ success: false, message: err?.message || 'Error occurred.' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0c1435] to-[#070b1e] border border-cyan-500/20 shadow-lg mb-4">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-cyan-400" />
                    <span className="text-white font-bold text-sm">Voice Calibration & Recognition</span>
                </div>
                <span
                    className={`text-[10px] font-black tracking-wider px-2 py-0.5 rounded-full uppercase ${
                        profiles.length > 0
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                >
                    {profiles.length}/5 Profiles
                </span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
                Strict Voice Shield: Friday sirf calibrated voices se baat karegi. New voice add karne ke liye Firestore PIN aur calibration zaroori hai.
            </p>

            {actionStatus && (
                <div
                    className={`mb-3 p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                        actionStatus.success
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    }`}
                >
                    {actionStatus.success ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span>{actionStatus.message}</span>
                </div>
            )}

            {/* Enrolled Profiles List */}
            {profiles.length > 0 ? (
                <div className="space-y-2 mb-3">
                    {profiles.map((p, idx) => (
                        <div
                            key={p.id || idx}
                            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/80 border border-white/5"
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-white text-xs font-semibold truncate">{p.name}</span>
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                                            {p.relationWithDivakar || 'Boss (DK)'}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 block">
                                        Enrolled: {new Date(p.createdAt).toLocaleDateString('en-IN')}
                                    </span>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    setPinInput('');
                                    setActionStatus(null);
                                    setPinModal({ mode: 'delete', targetId: p.id });
                                }}
                                className="p-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/30 transition-colors"
                                title="Delete this voice profile (requires PIN)"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="p-3 rounded-xl bg-slate-900/60 border border-dashed border-white/10 text-center mb-3">
                    <span className="text-xs text-slate-400">No calibrated voice enrolled yet. Click below to setup.</span>
                </div>
            )}

            {/* Enroll Button (if < 5 profiles) */}
            {profiles.length < 5 && (
                <button
                    onClick={() => {
                        setPinInput('');
                        setNameInput('Boss (Divakar)');
                        setRelationInput('Boss (Self)');
                        setActionStatus(null);
                        setPinModal({ mode: 'enroll' });
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 active:scale-98"
                >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Calibrate New Voice ({profiles.length}/5)</span>
                </button>
            )}

            {/* PIN Authorization Modal */}
            <AnimatePresence>
                {pinModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[3000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
                        onClick={() => setPinModal(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="bg-[#0e1638] border border-cyan-500/40 rounded-3xl w-full max-w-sm p-5 shadow-[0_0_40px_rgba(6,182,212,0.3)] flex flex-col gap-3"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Key className="w-5 h-5 text-cyan-400" />
                                    <h4 className="text-white font-bold text-sm">
                                        {pinModal.mode === 'enroll' ? 'Voice Calibration Enrollment' : 'Delete Voice Profile'}
                                    </h4>
                                </div>
                                <button onClick={() => setPinModal(null)} className="text-slate-400 hover:text-white">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <p className="text-xs text-slate-300">
                                {pinModal.mode === 'enroll'
                                    ? 'Setup authorization ke liye apna saved Voice PIN daalein:'
                                    : 'Voice profile delete karne ke liye apna saved Voice PIN daalein:'}
                            </p>

                            {pinModal.mode === 'enroll' && (
                                <div className="space-y-2">
                                    <div>
                                        <label className="text-[11px] text-slate-400 block mb-1">Speaker Name:</label>
                                        <input
                                            type="text"
                                            value={nameInput}
                                            onChange={(e) => setNameInput(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-cyan-500 outline-none"
                                            placeholder="Boss (Divakar)"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] text-slate-400 block mb-1">Relation with Divakar (DK):</label>
                                        <input
                                            type="text"
                                            value={relationInput}
                                            onChange={(e) => setRelationInput(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-cyan-500 outline-none"
                                            placeholder="Boss (Self), Dost, Bhai, Mummy, etc."
                                        />
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="text-[11px] text-slate-400 block mb-1">Authorization Password (PIN):</label>
                                <input
                                    type="password"
                                    maxLength={8}
                                    value={pinInput}
                                    onChange={(e) => setPinInput(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-cyan-500/50 text-cyan-300 font-mono tracking-widest text-center text-lg focus:border-cyan-400 outline-none"
                                    placeholder="••••••"
                                    autoFocus
                                />
                            </div>

                            <div className="flex gap-2 mt-2">
                                <button
                                    onClick={() => setPinModal(null)}
                                    className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirmAction}
                                    disabled={loading || !pinInput.trim()}
                                    className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                                >
                                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    <span>{pinModal.mode === 'enroll' ? 'Calibrate & Save' : 'Confirm Delete'}</span>
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Telegram Bot Card (Status & Quick Launch) ─────────────────────────────────
function TelegramBotCard() {
    const [status, setStatus] = useState<{ isConfigured: boolean; botUsername: string | null; pollingActive: boolean } | null>(null);

    useEffect(() => {
        fetch('/api/telegram/status')
            .then((r) => r.json())
            .then((d) => setStatus(d))
            .catch(() => {});
    }, []);

    return (
        <div className="pt-3 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-sky-400" />
                    <span className="text-white font-bold text-sm">Friday Telegram Bot</span>
                </div>
                <span
                    className={`text-[10px] font-black tracking-wider px-2 py-0.5 rounded-full uppercase ${
                        status?.isConfigured
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-[0_0_8px_rgba(56,189,248,0.3)]'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                >
                    {status?.isConfigured ? 'Connected' : 'Offline'}
                </span>
            </div>
            <p className="text-xs text-slate-400 mb-2.5">
                AI Smart Chat, Vision OCR, Coding Agent Buttons, Song Finder & PIN Sync via Telegram.
            </p>

            {status?.isConfigured && status?.botUsername ? (
                <a
                    href={`https://t.me/${status.botUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 active:scale-98"
                >
                    <Send className="w-3.5 h-3.5" />
                    <span>Open @{status.botUsername} on Telegram</span>
                </a>
            ) : (
                <div className="p-2.5 rounded-xl bg-slate-900/70 border border-white/10 text-center">
                    <span className="text-[11px] text-slate-400">
                        Add <code>TELEGRAM_BOT_TOKEN</code> in your <code>.env</code> to activate.
                    </span>
                </div>
            )}
        </div>
    );
}

// ── Instagram Direct Bot Card (Meta Graph API) ────────────────────────────────
function InstagramBotCard() {
    const [status, setStatus] = useState<{ isConfigured: boolean; accountId: string | null } | null>(null);

    useEffect(() => {
        fetch('/api/instagram/status')
            .then((r) => r.json())
            .then((d) => setStatus(d))
            .catch(() => {});
    }, []);

    return (
        <div className="pt-3 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Instagram className="w-4 h-4 text-pink-400" />
                    <span className="text-white font-bold text-sm">Instagram Direct Bot</span>
                </div>
                <span
                    className={`text-[10px] font-black tracking-wider px-2 py-0.5 rounded-full uppercase ${
                        status?.isConfigured
                            ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40 shadow-[0_0_8px_rgba(244,114,182,0.3)]'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                >
                    {status?.isConfigured ? 'Meta Active' : 'Offline'}
                </span>
            </div>
            <p className="text-xs text-slate-400 mb-2">
                AI DM Reader & Auto-Reply. 🛡️ <i>Sensitive actions strictly blocked from IG.</i>
            </p>

            {status?.isConfigured ? (
                <div className="p-2.5 rounded-xl bg-pink-950/40 border border-pink-500/30 text-xs text-pink-200 flex items-center justify-between">
                    <span>Account: <b>{status.accountId || 'Connected'}</b></span>
                    <span className="text-[10px] text-pink-300/80">Webhook: <code>/api/instagram/webhook</code></span>
                </div>
            ) : (
                <div className="p-2.5 rounded-xl bg-slate-900/70 border border-white/10 text-center">
                    <span className="text-[11px] text-slate-400">
                        Add <code>INSTAGRAM_PAGE_ACCESS_TOKEN</code> in <code>.env</code> to activate.
                    </span>
                </div>
            )}
        </div>
    );
}

// ── Cyber Security & OSINT Recon Suite Card ──────────────────────────────────
function CyberSecurityCard() {
    return (
        <div className="pt-3 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-white font-bold text-sm">Cyber Defense & OSINT Suite</span>
                </div>
                <span className="text-[10px] font-black tracking-wider px-2 py-0.5 rounded-full uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                    Active Armed
                </span>
            </div>
            <p className="text-xs text-slate-400 mb-2.5">
                Ethical hacker recon tools: Phishing link inspector, data breach leak hunter, website security audits, and IP intelligence.
            </p>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="p-2 rounded-xl bg-slate-900/80 border border-white/5 text-slate-300 flex items-center gap-1.5">
                    <span>🔍</span> <span>Link Phish Scan</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/80 border border-white/5 text-slate-300 flex items-center gap-1.5">
                    <span>🕵️</span> <span>Data Breach Check</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/80 border border-white/5 text-slate-300 flex items-center gap-1.5">
                    <span>🌐</span> <span>Domain SSL Audit</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/80 border border-white/5 text-slate-300 flex items-center gap-1.5">
                    <span>📍</span> <span>IP Trace & Recon</span>
                </div>
            </div>
        </div>
    );
}

function pcmToBase64(pcm: Float32Array): string {
    if (!pcm || pcm.length === 0) return "";
    const buffer = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
        buffer[i] = Math.max(-1, Math.min(1, pcm[i])) * 32767;
    }
    const binary = new Uint8Array(buffer.buffer);
    let base64 = "";
    for (let i = 0; i < binary.length; i++) {
        base64 += String.fromCharCode(binary[i]);
    }
    return btoa(base64);
}

function createAudioContext(sampleRate?: number): AudioContext {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (sampleRate) {
        try {
            return new AudioCtx({ sampleRate });
        } catch (e) {
            console.warn(`AudioContext with sampleRate ${sampleRate} failed, falling back`, e);
        }
    }
    return new AudioCtx();
}

async function playAudioChunk(
    audioCtx: AudioContext,
    base64Audio: string,
    nextStartTime: { current: number },
    isAiSpeaking: { current: boolean },
    speakingCooldownUntilRef?: { current: number }
) {
    try {
        if (!base64Audio || !audioCtx || audioCtx.state === 'closed') return;
        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const sampleCount = Math.floor(bytes.length / 2);
        if (sampleCount <= 0) return;

        const buffer = audioCtx.createBuffer(1, sampleCount, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < sampleCount; i++) {
            const sample = (bytes[i * 2 + 1] << 8) | bytes[i * 2];
            channelData[i] = ((sample << 16) >> 16) / 32768;
        }

        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);

        const startTime = Math.max(audioCtx.currentTime, nextStartTime.current);
        source.start(startTime);
        nextStartTime.current = startTime + buffer.duration;
        isAiSpeaking.current = true;

        source.onended = () => {
            if (audioCtx.currentTime >= nextStartTime.current - 0.08) {
                isAiSpeaking.current = false;
                if (speakingCooldownUntilRef) {
                    speakingCooldownUntilRef.current = Date.now() + 500; // 500ms safety cooldown
                }
            }
        };
    } catch (e) {
        console.error("Error playing audio chunk:", e);
    }
}

export default function LiveAIInterface({ onClose }: LiveAIInterfaceProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [status, setStatus] = useState("Idle");
    const statusRef = useRef("Idle");
    const [volume, setVolume] = useState(0);
    const [colorIndex, setColorIndex] = useState(0);
    const [selectedImages, setSelectedImages] = useState<{ id: string; file: File; status: 'uploading' | 'uploaded' }[]>([]);
    const [showSettings, setShowSettings] = useState(false);
    const [openSettingsSection, setOpenSettingsSection] = useState<string | null>(null);
    const [musicYtEnabled, setMusicYtEnabled] = useState<boolean>(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem('music_yt_enabled');
            return saved !== null ? saved === 'true' : true;
        }
        return true;
    });
    const [musicSaavnEnabled, setMusicSaavnEnabled] = useState<boolean>(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem('music_saavn_enabled');
            return saved !== null ? saved === 'true' : true;
        }
        return true;
    });

    const toggleSettingsSection = useCallback((sectionId: string) => {
        setOpenSettingsSection(prev => prev === sectionId ? null : sectionId);
    }, []);

    const toggleMusicYtEngine = useCallback(() => {
        setMusicYtEnabled(prev => {
            const next = !prev;
            localStorage.setItem('music_yt_enabled', String(next));
            return next;
        });
    }, []);

    const toggleMusicSaavnEngine = useCallback(() => {
        setMusicSaavnEnabled(prev => {
            const next = !prev;
            localStorage.setItem('music_saavn_enabled', String(next));
            return next;
        });
    }, []);

    const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('selectedVoice') || 'Aoede');
    const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
    const [thinkingLevel, setThinkingLevel] = useState('low');
    const [accurateMode, setAccurateMode] = useState(false);
    const [answerLength, setAnswerLength] = useState(() => localStorage.getItem('answerLength') || 'short');
    const [googleSearchMode, setGoogleSearchMode] = useState(false);
    const [wakeWordActive, setWakeWordActive] = useState(() => localStorage.getItem('wakeWordActive') !== 'false');
    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [dueReminder, setDueReminder] = useState<{ title: string; timeString: string } | null>(null);
    const [whatsappNotif, setWhatsappNotif] = useState<{ sender: string; text: string; isGroup: boolean; groupName?: string | null } | null>(null);
    const whatsappNotifTimerRef = useRef<any>(null);
    const [activeBgTask, setActiveBgTask] = useState<{ id: string; name: string; type: string; progressStep: string } | null>(null);
    const [completedBgTask, setCompletedBgTask] = useState<{ id: string; name: string; resultSummary: string } | null>(null);
    const completedBgTaskTimerRef = useRef<any>(null);
    const [identifiedSong, setIdentifiedSong] = useState<any | null>(null);
    const identifiedSongTimerRef = useRef<any>(null);
    const [researchReport, setResearchReport] = useState<any | null>(null);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const [inactivityCountdown, setInactivityCountdown] = useState<number | null>(null);
    const [showCaptions, setShowCaptions] = useState(true);
    const [captionText, setCaptionText] = useState('');
    const [showChatHistory, setShowChatHistory] = useState(false);
    const [showCodeAgent, setShowCodeAgent] = useState(false);
    const [showWebCrawler, setShowWebCrawler] = useState(false);
    const [showYouTubeStudio, setShowYouTubeStudio] = useState(false);
    const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [showWifiRadar, setShowWifiRadar] = useState(false);
    const [showMusicStudio, setShowMusicStudio] = useState(false);
    const [showSongPreviewModal, setShowSongPreviewModal] = useState(false);
    const [previewQuery, setPreviewQuery] = useState('');
    const [previewCandidates, setPreviewCandidates] = useState<PreviewCandidate[]>([]);
    const [activePreviewIndex, setActivePreviewIndex] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const captionBoxRef = useRef<HTMLDivElement>(null);
    const userScrolledUpRef = useRef(false);
    const captionTurnStartedRef = useRef(false);

    // Keep screen awake while in Friday Live AI Interface / Web URL
    useEffect(() => {
        screenWakeLock.requestLock().catch(() => {});
    }, []);

    // ── Music Player State & References ─────────────────────────────────────
    const [nowPlayingMusic, setNowPlayingMusic] = useState<{
        trackName: string;
        artistName?: string;
        albumName?: string;
        albumArt?: string;
        spotifyUrl?: string;
        youtubeMusicUrl?: string;
        embedUrl?: string;
        videoId?: string;
        isYouTubeMusic?: boolean;
        isYouTube?: boolean;
        isJioSaavn?: boolean;
        isFullSong?: boolean;
        quality?: string;
        durationSec?: number;
        audioUrl?: string;
        fallbackAudioUrl?: string;
        isPlaying?: boolean;
        hasError?: boolean;
        errorMessage?: string;
        songId?: string;
        hasLyrics?: boolean;
    } | null>(null);
    const musicAudioRef = useRef<HTMLAudioElement | null>(null);
    const [musicCurrentTime, setMusicCurrentTime] = useState(0);
    const [musicDuration, setMusicDuration] = useState(0);
    const [musicQueue, setMusicQueue] = useState<any[]>([]);
    const [musicHistory, setMusicHistory] = useState<any[]>([]);
    const [musicEqPreset, setMusicEqPreset] = useState("flat");
    const [isMusicPlayerExpanded, setIsMusicPlayerExpanded] = useState(false);
    const musicDspAudioCtxRef = useRef<AudioContext | null>(null);
    const musicBassFilterRef = useRef<BiquadFilterNode | null>(null);
    const musicMidFilterRef = useRef<BiquadFilterNode | null>(null);
    const musicTrebleFilterRef = useRef<BiquadFilterNode | null>(null);
    const musicPannerRef = useRef<StereoPannerNode | null>(null);
    const music8dIntervalRef = useRef<any>(null);

    // ── Web Audio DSP Equalizer & 8D Spatial Setup ────────────────────────────
    const setupAudioDsp = useCallback((audio: HTMLAudioElement) => {
        try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const source = ctx.createMediaElementSource(audio);

            const bassFilter = ctx.createBiquadFilter();
            bassFilter.type = 'lowshelf';
            bassFilter.frequency.value = 120;
            bassFilter.gain.value = 0;

            const midFilter = ctx.createBiquadFilter();
            midFilter.type = 'peaking';
            midFilter.frequency.value = 1000;
            midFilter.gain.value = 0;

            const trebleFilter = ctx.createBiquadFilter();
            trebleFilter.type = 'highshelf';
            trebleFilter.frequency.value = 4000;
            trebleFilter.gain.value = 0;

            let panner: StereoPannerNode | null = null;
            if (ctx.createStereoPanner) {
                panner = ctx.createStereoPanner();
                panner.pan.value = 0;
            }

            source.connect(bassFilter);
            bassFilter.connect(midFilter);
            midFilter.connect(trebleFilter);
            if (panner) {
                trebleFilter.connect(panner);
                panner.connect(ctx.destination);
            } else {
                trebleFilter.connect(ctx.destination);
            }

            musicDspAudioCtxRef.current = ctx;
            musicBassFilterRef.current = bassFilter;
            musicMidFilterRef.current = midFilter;
            musicTrebleFilterRef.current = trebleFilter;
            musicPannerRef.current = panner;
        } catch (err) {
            console.warn('[Music DSP] AudioContext setup notice:', err);
        }
    }, []);

    const applyEqPreset = useCallback((preset: string) => {
        setMusicEqPreset(preset);
        clearInterval(music8dIntervalRef.current);
        const bass = musicBassFilterRef.current;
        const mid = musicMidFilterRef.current;
        const treble = musicTrebleFilterRef.current;
        const panner = musicPannerRef.current;
        if (!bass || !mid || !treble) return;

        if (preset === 'bass_boost') {
            bass.gain.value = 14; // +14dB Bass Punch
            mid.gain.value = 0;
            treble.gain.value = 2;
            if (panner) panner.pan.value = 0;
        } else if (preset === '8d_spatial') {
            bass.gain.value = 6;
            mid.gain.value = 2;
            treble.gain.value = 4;
            if (panner) {
                let panVal = -1;
                let direction = 1;
                music8dIntervalRef.current = setInterval(() => {
                    panVal += direction * 0.05;
                    if (panVal >= 1) { panVal = 1; direction = -1; }
                    if (panVal <= -1) { panVal = -1; direction = 1; }
                    try { panner.pan.value = panVal; } catch {}
                }, 80);
            }
        } else if (preset === 'vocal_clarity') {
            bass.gain.value = -3;
            mid.gain.value = 8;
            treble.gain.value = 5;
            if (panner) panner.pan.value = 0;
        } else if (preset === 'party_punch') {
            bass.gain.value = 10;
            mid.gain.value = 2;
            treble.gain.value = 7;
            if (panner) panner.pan.value = 0;
        } else {
            // Flat / Studio
            bass.gain.value = 0;
            mid.gain.value = 0;
            treble.gain.value = 0;
            if (panner) panner.pan.value = 0;
        }
    }, []);

    // ── Smart Auto-Queue Radio Engine ─────────────────────────────────────────
    const fetchSmartQueue = useCallback(async (songName: string, artistName: string, albumName?: string) => {
        try {
            const url = getApiUrl(`/api/music/queue?songName=${encodeURIComponent(songName)}&artistName=${encodeURIComponent(artistName)}&albumName=${encodeURIComponent(albumName || '')}`);
            const res = await fetch(url);
            const data = await res.json();
            if (data.success && Array.isArray(data.queue)) {
                setMusicQueue(data.queue);
            }
        } catch {}
    }, []);

    const stopMusicPlayback = useCallback(() => {
        clearInterval(music8dIntervalRef.current);
        if (musicAudioRef.current) {
            musicAudioRef.current.pause();
            musicAudioRef.current.src = '';
            musicAudioRef.current = null;
        }
        try {
            const iframe = document.getElementById('youtube-iframe') as HTMLIFrameElement;
            iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'stopVideo', args: [] }), '*');
        } catch { /* ignore */ }
        setNowPlayingMusic(null);
        setMusicCurrentTime(0);
        setMusicDuration(0);
        mobileNotificationService.clearMusicNotification();
    }, []);

    const playDirectSong = useCallback((song: {
        trackName: string;
        artistName: string;
        albumName?: string;
        albumArt?: string;
        audioUrl?: string;
        isJioSaavn?: boolean;
        isYouTube?: boolean;
        isYouTubeMusic?: boolean;
        isFullSong?: boolean;
        quality?: string;
        songId?: string;
        hasLyrics?: boolean;
    }) => {
        // Push current song to history before starting new one
        setNowPlayingMusic(current => {
            if (current && current.trackName && current.trackName !== song.trackName) {
                setMusicHistory(prevHist => [...prevHist.slice(-19), current]);
            }
            return current;
        });

        stopMusicPlayback();
        const directUrl = song.audioUrl || '';

        const audio = new Audio();
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';
        if (directUrl) audio.src = directUrl;
        audio.volume = 0.85;

        audio.onplay = () => {
            setNowPlayingMusic(prev => prev ? { ...prev, isPlaying: true } : null);
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
            }
        };

        audio.onpause = () => {
            setNowPlayingMusic(prev => prev ? { ...prev, isPlaying: false } : null);
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'paused';
            }
        };

        audio.ontimeupdate = () => {
            setMusicCurrentTime(audio.currentTime);
            if ('mediaSession' in navigator && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: audio.duration,
                        playbackRate: audio.playbackRate || 1,
                        position: Math.min(audio.currentTime, audio.duration),
                    });
                } catch {}
            }
        };

        audio.ondurationchange = () => {
            const dur = audio.duration || 0;
            setMusicDuration(dur);
            if ('mediaSession' in navigator && dur > 0 && !isNaN(dur) && isFinite(dur)) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: dur,
                        playbackRate: audio.playbackRate || 1,
                        position: audio.currentTime || 0,
                    });
                } catch {}
            }
        };

        audio.onseeked = () => {
            if ('mediaSession' in navigator && audio.duration && !isNaN(audio.duration)) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: audio.duration,
                        playbackRate: audio.playbackRate || 1,
                        position: audio.currentTime,
                    });
                } catch {}
            }
        };

        audio.onended = () => {
            setNowPlayingMusic(prev => prev ? { ...prev, isPlaying: false } : null);
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'none';
            }
            // Auto advance smart queue on song end
            setMusicQueue(prev => {
                if (prev.length > 0) {
                    const nextSong = prev[0];
                    const remaining = prev.slice(1);
                    setTimeout(() => {
                        playDirectSong({
                            trackName: nextSong.songName,
                            artistName: nextSong.artistName,
                            albumName: nextSong.albumName,
                            albumArt: nextSong.albumArt500 || nextSong.albumArt150,
                            audioUrl: nextSong.audio320kbps || nextSong.audio160kbps,
                            isJioSaavn: true,
                            isFullSong: true,
                            quality: "JioSaavn 320kbps Ultra-HD",
                            songId: nextSong.id,
                            hasLyrics: nextSong.hasLyrics,
                        });
                    }, 300);
                    return remaining;
                }
                return [];
            });
        };

        audio.onerror = (e) => {
            console.warn('[Music] Error playing direct CDN song on URL:', directUrl, e);
            if (directUrl.startsWith('http') && !directUrl.includes('/api/music/proxy-stream')) {
                const proxied = getApiUrl(`/api/music/proxy-stream?url=${encodeURIComponent(directUrl)}`);
                audio.src = proxied;
                audio.play().catch(err => console.warn('[Music] Proxy fallback catch:', err));
            }
        };

        musicAudioRef.current = audio;
        setupAudioDsp(audio);
        fetchSmartQueue(song.trackName, song.artistName, song.albumName);

        // Acquire Screen/Background WakeLock to prevent app/music sleep
        screenWakeLock.requestLock().catch(() => {});

        audio.play().then(() => {
            setNowPlayingMusic({
                trackName: song.trackName,
                artistName: song.artistName,
                albumName: song.albumName,
                albumArt: song.albumArt,
                audioUrl: directUrl,
                isJioSaavn: song.isJioSaavn !== false && !song.isYouTube,
                isYouTube: !!song.isYouTube,
                isYouTubeMusic: !!song.isYouTube,
                isFullSong: true,
                quality: song.quality || (song.isYouTube ? "YouTube Pro Safe Audio" : "JioSaavn 320kbps Ultra-HD"),
                isPlaying: true,
                songId: song.songId,
                hasLyrics: song.hasLyrics,
            });
        }).catch(err => {
            console.warn('[Music] Direct play catch:', err);
            setNowPlayingMusic({
                trackName: song.trackName,
                artistName: song.artistName,
                albumArt: song.albumArt,
                audioUrl: directUrl,
                isJioSaavn: song.isJioSaavn !== false && !song.isYouTube,
                isYouTube: !!song.isYouTube,
                isYouTubeMusic: !!song.isYouTube,
                isPlaying: false,
                songId: song.songId,
                hasLyrics: song.hasLyrics,
            });
        });
    }, [stopMusicPlayback, setupAudioDsp, fetchSmartQueue]);

    const playConfirmedCandidate = useCallback(async (chosen: PreviewCandidate) => {
        setShowSongPreviewModal(false);
        if (chosen.audio320kbps && chosen.source === 'jiosaavn') {
            playDirectSong({
                trackName: chosen.songName,
                artistName: chosen.artistName,
                albumName: chosen.albumName,
                albumArt: chosen.albumArt,
                audioUrl: chosen.audio320kbps,
                isJioSaavn: true,
                isFullSong: true,
                quality: "JioSaavn 320kbps Ultra-HD",
                songId: chosen.id,
            });
            return;
        }

        // Resolve 320kbps stream on JioSaavn for Spotify chosen track
        try {
            const query = `${chosen.songName} ${chosen.artistName}`.trim();
            const res = await fetch(getApiUrl(`/api/music/search?q=${encodeURIComponent(query)}&limit=1`));
            const data = await res.json();
            if (data.success && data.songs && data.songs.length > 0) {
                const jio = data.songs[0];
                playDirectSong({
                    trackName: jio.songName,
                    artistName: jio.artistName,
                    albumName: jio.albumName,
                    albumArt: jio.albumArt500 || chosen.albumArt,
                    audioUrl: jio.audio320kbps || jio.audio160kbps,
                    isJioSaavn: true,
                    isFullSong: true,
                    quality: "JioSaavn 320kbps Ultra-HD",
                    songId: jio.id,
                    hasLyrics: jio.hasLyrics,
                });
                return;
            }
        } catch (err) {
            console.warn("[Music Preview] JioSaavn 320k resolve warning:", err);
        }

        // Fallback to preview stream if resolution fails
        playDirectSong({
            trackName: chosen.songName,
            artistName: chosen.artistName,
            albumName: chosen.albumName,
            albumArt: chosen.albumArt,
            audioUrl: chosen.audio320kbps || chosen.fullAudioUrl || chosen.previewUrl,
            isJioSaavn: true,
            isFullSong: true,
            quality: "HD Audio",
            songId: chosen.id,
        });
    }, [playDirectSong]);

    const pauseMusicPlayback = useCallback(() => {
        if (musicAudioRef.current) {
            musicAudioRef.current.pause();
        }
        try {
            const iframe = document.getElementById('youtube-iframe') as HTMLIFrameElement;
            iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
        } catch { /* ignore */ }
        setNowPlayingMusic(prev => prev ? { ...prev, isPlaying: false } : null);
    }, []);

    const resumeMusicPlayback = useCallback(() => {
        if (musicAudioRef.current) {
            musicAudioRef.current.play().catch(() => {});
        }
        try {
            const iframe = document.getElementById('youtube-iframe') as HTMLIFrameElement;
            iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
        } catch { /* ignore */ }
        setNowPlayingMusic(prev => prev ? { ...prev, isPlaying: true } : null);
    }, []);

    const toggleMusicPlayPause = useCallback(() => {
        if (nowPlayingMusic?.isPlaying) {
            pauseMusicPlayback();
        } else {
            resumeMusicPlayback();
        }
    }, [nowPlayingMusic?.isPlaying, pauseMusicPlayback, resumeMusicPlayback]);

    const seekRelativeMusic = useCallback((deltaSeconds: number) => {
        if (musicAudioRef.current) {
            const newTime = Math.max(0, Math.min(musicAudioRef.current.duration || 9999, musicAudioRef.current.currentTime + deltaSeconds));
            musicAudioRef.current.currentTime = newTime;
            setMusicCurrentTime(newTime);
        }
    }, []);

    const seekToMusic = useCallback((timeSeconds: number) => {
        if (musicAudioRef.current) {
            musicAudioRef.current.currentTime = timeSeconds;
            setMusicCurrentTime(timeSeconds);
        }
    }, []);

    const restartMusic = useCallback(() => {
        if (musicAudioRef.current) {
            musicAudioRef.current.currentTime = 0;
            musicAudioRef.current.play().catch(() => {});
            setMusicCurrentTime(0);
            setNowPlayingMusic(prev => prev ? { ...prev, isPlaying: true } : null);
        }
    }, []);

    const playNextQueueSong = useCallback(() => {
        if (musicQueue.length > 0) {
            const nextSong = musicQueue[0];
            setMusicQueue(prev => prev.slice(1));
            playDirectSong({
                trackName: nextSong.songName,
                artistName: nextSong.artistName,
                albumName: nextSong.albumName,
                albumArt: nextSong.albumArt500 || nextSong.albumArt150,
                audioUrl: nextSong.audio320kbps || nextSong.audio160kbps,
                isJioSaavn: true,
                isFullSong: true,
                quality: "JioSaavn 320kbps Ultra-HD",
                songId: nextSong.id,
                hasLyrics: nextSong.hasLyrics,
            });
        }
    }, [musicQueue, playDirectSong]);

    const playPrevQueueSong = useCallback(() => {
        if (musicAudioRef.current && musicAudioRef.current.currentTime > 3) {
            restartMusic();
            return;
        }
        if (musicHistory.length > 0) {
            const prevSong = musicHistory[musicHistory.length - 1];
            setMusicHistory(prev => prev.slice(0, -1));
            playDirectSong({
                trackName: prevSong.trackName,
                artistName: prevSong.artistName,
                albumName: prevSong.albumName,
                albumArt: prevSong.albumArt,
                audioUrl: prevSong.audioUrl,
                isJioSaavn: prevSong.isJioSaavn,
                isYouTube: prevSong.isYouTube,
                isFullSong: true,
                quality: prevSong.quality || "Ultra-HD Audio",
                songId: prevSong.songId,
                hasLyrics: prevSong.hasLyrics,
            });
        } else {
            restartMusic();
        }
    }, [musicHistory, restartMusic, playDirectSong]);

    // ── MediaSession API for Background, Lock-Screen & System Notification Player ──
    useEffect(() => {
        if (!nowPlayingMusic) {
            if ('mediaSession' in navigator) {
                try {
                    navigator.mediaSession.playbackState = 'none';
                } catch {}
            }
            return;
        }

        if ('mediaSession' in navigator) {
            try {
                const coverArt = nowPlayingMusic.albumArt || 'https://img.youtube.com/vi/default/hqdefault.jpg';
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: nowPlayingMusic.trackName || 'FRIDAY Music',
                    artist: nowPlayingMusic.artistName || 'FRIDAY AI Assistant',
                    album: nowPlayingMusic.albumName || (nowPlayingMusic.isYouTube ? 'YouTube Pro Safe' : 'JioSaavn 320kbps HD'),
                    artwork: [
                        { src: coverArt, sizes: '96x96', type: 'image/jpeg' },
                        { src: coverArt, sizes: '128x128', type: 'image/jpeg' },
                        { src: coverArt, sizes: '192x192', type: 'image/jpeg' },
                        { src: coverArt, sizes: '256x256', type: 'image/jpeg' },
                        { src: coverArt, sizes: '384x384', type: 'image/jpeg' },
                        { src: coverArt, sizes: '512x512', type: 'image/jpeg' },
                    ],
                });

                navigator.mediaSession.playbackState = nowPlayingMusic.isPlaying ? 'playing' : 'paused';

                const registerAction = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
                    try {
                        navigator.mediaSession.setActionHandler(action, handler);
                    } catch (e) {
                        console.warn(`[MediaSession] Action "${action}" registration skipped:`, e);
                    }
                };

                registerAction('play', () => resumeMusicPlayback());
                registerAction('pause', () => pauseMusicPlayback());
                registerAction('stop', () => stopMusicPlayback());
                registerAction('previoustrack', () => playPrevQueueSong());
                registerAction('nexttrack', () => playNextQueueSong());
                registerAction('seekbackward', (details) => {
                    seekRelativeMusic(-(details.seekOffset || 10));
                });
                registerAction('seekforward', (details) => {
                    seekRelativeMusic(details.seekOffset || 10);
                });
                registerAction('seekto', (details) => {
                    if (details.seekTime !== undefined && details.seekTime !== null) {
                        seekToMusic(details.seekTime);
                    }
                });

                if (musicAudioRef.current && musicAudioRef.current.duration && !isNaN(musicAudioRef.current.duration) && isFinite(musicAudioRef.current.duration)) {
                    try {
                        navigator.mediaSession.setPositionState({
                            duration: musicAudioRef.current.duration,
                            playbackRate: musicAudioRef.current.playbackRate || 1,
                            position: Math.min(musicAudioRef.current.currentTime, musicAudioRef.current.duration),
                        });
                    } catch {}
                }
            } catch (e) {
                console.warn('[MediaSession] Setup error:', e);
            }
        }
    }, [nowPlayingMusic, stopMusicPlayback, resumeMusicPlayback, pauseMusicPlayback, seekRelativeMusic, seekToMusic, playNextQueueSong, playPrevQueueSong]);

    // ── Native Mobile Notification & Lock-Screen Player Bridge (Capacitor Android / iOS) ──
    useEffect(() => {
        mobileNotificationService.initialize({
            onPlayPause: () => toggleMusicPlayPause(),
            onNext: () => playNextQueueSong(),
            onPrev: () => playPrevQueueSong(),
            onStop: () => stopMusicPlayback(),
        });
    }, [toggleMusicPlayPause, playNextQueueSong, playPrevQueueSong, stopMusicPlayback]);

    useEffect(() => {
        if (nowPlayingMusic) {
            mobileNotificationService.showMusicNotification({
                trackName: nowPlayingMusic.trackName,
                artistName: nowPlayingMusic.artistName,
                albumArt: nowPlayingMusic.albumArt,
                isPlaying: !!nowPlayingMusic.isPlaying,
                isYouTube: !!nowPlayingMusic.isYouTube,
                quality: nowPlayingMusic.quality,
            });
        } else {
            mobileNotificationService.clearMusicNotification();
        }
    }, [nowPlayingMusic?.trackName, nowPlayingMusic?.isPlaying, nowPlayingMusic?.isYouTube, nowPlayingMusic?.artistName]);

    // ── Smooth Audio Ducking when Friday is speaking ──────────────────────────
    useEffect(() => {
        if (!musicAudioRef.current) return;
        try {
            if (status === 'Speaking...') {
                musicAudioRef.current.volume = 0.2; // Duck music volume to 20% while Friday talks
            } else {
                musicAudioRef.current.volume = 0.85; // Full volume when listening or idle
            }
        } catch {}
    }, [status]);

    const toggleScreenShare = useCallback(async () => {
        if (isScreenSharing) {
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach((track) => track.stop());
                screenStreamRef.current = null;
            }
            setIsScreenSharing(false);
        } else {
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                screenStreamRef.current = stream;
                setIsScreenSharing(true);
                stream.getVideoTracks()[0].onended = () => {
                    setIsScreenSharing(false);
                    screenStreamRef.current = null;
                };
            } catch (err) {
                console.warn("[ScreenShare] User cancelled or error:", err);
            }
        }
    }, [isScreenSharing]);

    const [isTyping, setIsTyping] = useState(false);
    const targetCaptionTextRef = useRef('');
    const displayedLengthRef = useRef(0);
    const typewriterTimeoutRef = useRef<any>(null);

    const resetTypewriter = useCallback(() => {
        if (typewriterTimeoutRef.current) {
            clearTimeout(typewriterTimeoutRef.current);
            typewriterTimeoutRef.current = null;
        }
        targetCaptionTextRef.current = '';
        displayedLengthRef.current = 0;
        setIsTyping(false);
        setCaptionText('');
    }, []);

    const scheduleNextTypewriterTick = useCallback(() => {
        if (typewriterTimeoutRef.current) return;
        const tick = () => {
            const target = targetCaptionTextRef.current;
            const currentLen = displayedLengthRef.current;
            if (currentLen < target.length) {
                const remaining = target.length - currentLen;
                const charsToAdvance = remaining > 50 ? 3 : remaining > 25 ? 2 : 1;
                const nextLen = Math.min(currentLen + charsToAdvance, target.length);
                displayedLengthRef.current = nextLen;
                const newText = target.slice(0, nextLen);
                setCaptionText(newText);
                setIsTyping(true);
                if (captionBoxRef.current && !userScrolledUpRef.current) {
                    captionBoxRef.current.scrollTop = captionBoxRef.current.scrollHeight;
                }
                const lastChar = newText[newText.length - 1];
                let delay = 18;
                if (['.', '!', '?', '\n'].includes(lastChar)) delay = 75;
                else if ([',', ';', ':'].includes(lastChar)) delay = 45;
                else if (lastChar === ' ') delay = 24;
                typewriterTimeoutRef.current = setTimeout(() => {
                    typewriterTimeoutRef.current = null;
                    tick();
                }, delay);
            } else {
                typewriterTimeoutRef.current = null;
                setIsTyping(false);
            }
        };
        tick();
    }, []);

    const enqueueTextChunk = useCallback((chunk: string, isNewTurn: boolean) => {
        if (isNewTurn) {
            if (typewriterTimeoutRef.current) {
                clearTimeout(typewriterTimeoutRef.current);
                typewriterTimeoutRef.current = null;
            }
            targetCaptionTextRef.current = chunk;
            displayedLengthRef.current = 0;
            setCaptionText('');
        } else {
            targetCaptionTextRef.current += chunk;
        }
        setIsTyping(true);
        scheduleNextTypewriterTick();
    }, [scheduleNextTypewriterTick]);

    useEffect(() => {
        localStorage.setItem('selectedVoice', selectedVoice);
        localStorage.setItem('thinkingLevel', thinkingLevel);
        localStorage.setItem('accurateMode', accurateMode.toString());
        localStorage.setItem('answerLength', answerLength);
        localStorage.setItem('googleSearchMode', googleSearchMode.toString());
    }, [selectedVoice, thinkingLevel, accurateMode, answerLength, googleSearchMode]);

    useEffect(() => {
        const box = captionBoxRef.current;
        if (!box) return;
        if (!userScrolledUpRef.current) box.scrollTop = box.scrollHeight;
    }, [captionText]);

    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    useEffect(() => {
        const interval = setInterval(() => {
            const outCtx = outputAudioCtx.current;
            const audioDrained = !outCtx || outCtx.currentTime >= nextStartTime.current - 0.05;

            if (turnCompletePendingRef.current && audioDrained) {
                turnCompletePendingRef.current = false;
                aiTurnActiveRef.current = false;
                isAiSpeaking.current = false;
            }

            if (!aiTurnActiveRef.current && Date.now() > speakingCooldownUntilRef.current && status === "Speaking...") {
                setStatus("Listening...");
            }
        }, 200);
        return () => clearInterval(interval);
    }, [status]);

    useEffect(() => {
        if (!isRecording) return;
        const interval = setInterval(() => {
            if (inputAudioCtx.current && inputAudioCtx.current.state === 'suspended') {
                inputAudioCtx.current.resume();
            }
            if (outputAudioCtx.current && outputAudioCtx.current.state === 'suspended') {
                outputAudioCtx.current.resume().catch(() => {});
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [isRecording]);

    useEffect(() => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            isInitializedRef.current = false;
            ws.current.send(JSON.stringify({
                type: 'init',
                voice: selectedVoice,
                thinkingLevel,
                accurateMode,
                answerLength,
                googleSearchMode,
            }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedVoice, thinkingLevel, accurateMode, answerLength, googleSearchMode]);

    const ws = useRef<WebSocket | null>(null);
    const inputAudioCtx = useRef<AudioContext | null>(null);
    const outputAudioCtx = useRef<AudioContext | null>(null);
    const processor = useRef<ScriptProcessorNode | null>(null);
    const nextStartTime = useRef<number>(0);
    const isAiSpeaking = useRef<boolean>(false);
    const isAiThinkingRef = useRef<boolean>(false);
    const isInitializedRef = useRef<boolean>(false);
    const initAckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const shouldCloseAfterTurnRef = useRef<boolean>(false);
    const lastActivityTimeRef = useRef<number>(Date.now());
    const isWarningSpokenRef = useRef<boolean>(false);
    const speakingCooldownUntilRef = useRef<number>(0);
    const aiTurnActiveRef = useRef<boolean>(false);
    const turnCompletePendingRef = useRef<boolean>(false);
    const isConnectingRef = useRef<boolean>(false);
    const pendingImagePayloadsRef = useRef<{ id: string; file: File; caption?: string }[]>([]);
    const selectedImagesRef = useRef(selectedImages);
    useEffect(() => { selectedImagesRef.current = selectedImages; }, [selectedImages]);

    const compressImageFile = (file: File, maxDim = 1280, quality = 0.8): Promise<{ base64: string; mimeType: string }> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let width = img.width, height = img.height;
                    if (width > maxDim || height > maxDim) {
                        if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
                        else { width = Math.round((width * maxDim) / height); height = maxDim; }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        const rawBase64 = (e.target?.result as string).split(',')[1];
                        return resolve({ base64: rawBase64, mimeType: file.type || 'image/jpeg' });
                    }
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
                };
                img.onerror = () => {
                    const rawBase64 = (e.target?.result as string).split(',')[1];
                    resolve({ base64: rawBase64, mimeType: file.type || 'image/jpeg' });
                };
                img.src = e.target?.result as string;
            };
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(file);
        });
    };

    const sendImageToWebSocket = async (image: { id: string; file: File; caption?: string }) => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN && isInitializedRef.current) {
            try {
                const compressed = await compressImageFile(image.file);
                ws.current.send(JSON.stringify({
                    image: compressed.base64,
                    mimeType: compressed.mimeType,
                    imageId: image.id,
                    caption: image.caption || ''
                }));
            } catch (err) {
                console.error("Failed to compress/send image:", err);
            }
        } else {
            if (!pendingImagePayloadsRef.current.some(p => p.id === image.id)) {
                pendingImagePayloadsRef.current.push(image);
            }
            ensureConnection(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files);
            const newImages = files.map(file => ({
                id: Math.random().toString(36).substr(2, 9),
                file,
                status: 'uploading' as const
            }));
            setSelectedImages(prev => [...prev, ...newImages]);
            ensureConnection(false).then(() => {
                newImages.forEach(image => sendImageToWebSocket(image));
            });
            e.target.value = '';
        }
    };

    const handleRemoveImage = (id: string) => {
        setSelectedImages(prev => prev.filter(img => img.id !== id));
    };

    const stopAudio = () => {
        if (outputAudioCtx.current && outputAudioCtx.current.state !== 'closed') {
            try { outputAudioCtx.current.close(); } catch {}
            outputAudioCtx.current = createAudioContext(24000);
        }
    };

    const stopRecording = () => {
        if (initAckTimeoutRef.current) { clearTimeout(initAckTimeoutRef.current); initAckTimeoutRef.current = null; }
        ws.current?.close();
        processor.current?.disconnect();
        processor.current = null;
        if (inputAudioCtx.current && inputAudioCtx.current.state !== 'closed') inputAudioCtx.current.close();
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
        stopAudio();
        aiTurnActiveRef.current = false;
        turnCompletePendingRef.current = false;
        isConnectingRef.current = false;
        setIsRecording(false);
        setStatus("Idle");
    };

    const handleInterrupt = () => {
        ws.current?.send(JSON.stringify({ interrupt: true }));
        stopAudio();
        resetTypewriter();
        aiTurnActiveRef.current = false;
        turnCompletePendingRef.current = false;
        setStatus("Listening...");
    };

    const handleFaceDoubleTap = useCallback(() => {
        console.log("[LiveAIInterface] 🎯 Double clicked face -> Force immediate Listening Mode!");
        handleInterrupt();
        stopAudio();
        if (!isRecording) {
            setStatus("Connecting AI...");
            ensureConnection(true);
        } else {
            setStatus("Listening...");
        }
    }, [isRecording]);

    useEffect(() => {
        return () => { stopRecording(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!isRecording && wakeWordActive) {
            const unregister = wakeWordManager.register(() => {
                setStatus("Connecting AI...");
                ensureConnection(true);
            });
            return () => unregister();
        } else {
            wakeWordManager.stop();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isRecording, wakeWordActive]);

    // 75-second Inactivity Detection -> 15s warning -> Auto Shutdown (Paused during Thinking & Speaking)
    useEffect(() => {
        if (!isRecording) {
            setInactivityCountdown(null);
            isWarningSpokenRef.current = false;
            return;
        }

        lastActivityTimeRef.current = Date.now();
        isWarningSpokenRef.current = false;

        const interval = setInterval(() => {
            const isAudioStillPlaying = !!(outputAudioCtx.current && outputAudioCtx.current.currentTime < (nextStartTime.current - 0.05));
            const isAiBusy = aiTurnActiveRef.current || isAiSpeaking.current || isAiThinkingRef.current || statusRef.current === "Thinking..." || statusRef.current === "Speaking..." || isAudioStillPlaying;
            if (isAiBusy) {
                lastActivityTimeRef.current = Date.now();
                if (isWarningSpokenRef.current) {
                    isWarningSpokenRef.current = false;
                    setInactivityCountdown(null);
                }
                return;
            }

            const elapsed = Date.now() - lastActivityTimeRef.current;

            if (elapsed >= 75000 && !isWarningSpokenRef.current) {
                isWarningSpokenRef.current = true;
                setInactivityCountdown(15);
            } else if (isWarningSpokenRef.current) {
                const remaining = Math.max(0, 90 - Math.floor(elapsed / 1000));
                setInactivityCountdown(remaining);

                if (remaining <= 0) {
                    clearInterval(interval);
                    isWarningSpokenRef.current = false;
                    setInactivityCountdown(null);
                    stopRecording();
                    setStatus("Session band ho gaya. Say 'Hello Friday' to wake.");
                }
            }
        }, 1000);

        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isRecording]);

    const attachMicPipeline = async (stream: MediaStream) => {
        if (processor.current) {
            try { processor.current.onaudioprocess = null; processor.current.disconnect(); } catch {}
            processor.current = null;
        }
        if (inputAudioCtx.current && inputAudioCtx.current.state !== 'closed') {
            try { await inputAudioCtx.current.close(); } catch {}
        }

        inputAudioCtx.current = createAudioContext(16000);
        outputAudioCtx.current = createAudioContext(24000);
        try {
            await inputAudioCtx.current.resume();
            await outputAudioCtx.current.resume();
        } catch (e) {
            console.error("Failed to resume AudioContext:", e);
        }

        // 1. Source from Microphone MediaStream
        const source = inputAudioCtx.current.createMediaStreamSource(stream);

        // 2. High-pass filter at 100 Hz (Cuts traffic hum, wind, fans, sub-bass desk thumps)
        const highpass = inputAudioCtx.current.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 100;
        highpass.Q.value = 0.707;

        // 3. Low-pass filter at 6000 Hz (Cuts high-frequency shrieks, hiss, cutlery/street screech)
        const lowpass = inputAudioCtx.current.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 6000;
        lowpass.Q.value = 0.707;

        // 4. Studio Dynamics Compressor (Boosts soft whispers, evens out dynamics, prevents loud clipping)
        const compressor = inputAudioCtx.current.createDynamicsCompressor();
        compressor.threshold.value = -36; // Catches soft whispers down to -36 dB
        compressor.knee.value = 12;
        compressor.ratio.value = 4.0;
        compressor.attack.value = 0.003; // 3ms fast response
        compressor.release.value = 0.25;

        // 5. Connect DSP Chain: source -> highpass -> lowpass -> compressor -> processor
        source.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(compressor);

        processor.current = inputAudioCtx.current.createScriptProcessor(4096, 1, 1);
        compressor.connect(processor.current);
        processor.current.connect(inputAudioCtx.current.destination);

        processor.current.onaudioprocess = (e) => {
            const isAudioStillPlaying = !!(outputAudioCtx.current && outputAudioCtx.current.currentTime < (nextStartTime.current - 0.05));
            const isAiBusy = aiTurnActiveRef.current || isAiSpeaking.current || isAiThinkingRef.current || statusRef.current === "Thinking..." || statusRef.current === "Speaking..." || isAudioStillPlaying;
            if (isAiBusy || Date.now() < speakingCooldownUntilRef.current || !isInitializedRef.current) {
                setVolume(0);
                return;
            }

            const pcm = e.inputBuffer.getChannelData(0);

            let sumSquares = 0;
            for (let i = 0; i < pcm.length; i++) {
                sumSquares += pcm[i] * pcm[i];
            }
            const rms = Math.sqrt(sumSquares / pcm.length) * 1000;
            const isHumanSpeaking = rms >= 8; // Sensitive threshold supported by AGC & Compressor
            if (isHumanSpeaking) {
                lastActivityTimeRef.current = Date.now();
                if (isWarningSpokenRef.current) {
                    isWarningSpokenRef.current = false;
                    setInactivityCountdown(null);
                }
            }

            ws.current?.send(JSON.stringify({ audio: pcmToBase64(pcm) }));
            setVolume(Math.min(100, rms * 2.5));
        };
    };

    const requestMicStream = async (): Promise<MediaStream> => {
        return navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: { ideal: true },
                noiseSuppression: { ideal: true },
                autoGainControl: { ideal: true },
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 16000 },
                // Chrome & Chromium WebRTC advanced DSP flags
                googEchoCancellation: true,
                googAutoGainControl: true,
                googNoiseSuppression: true,
                googHighpassFilter: true,
                googTypingNoiseDetection: true,
                googAudioMirroring: false,
            } as any,
        });
    };

    const ensureConnection = async (withMic: boolean) => {
        if (withMic && isConnectingRef.current) return;

        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            if (withMic && !isRecording) {
                isConnectingRef.current = true;
                setStatus("Requesting Microphone...");
                try {
                    const stream = await requestMicStream();
                    setIsRecording(true);
                    setStatus("Listening...");
                    mediaStreamRef.current = stream;
                    await attachMicPipeline(stream);
                } catch (err) {
                    console.error("Error accessing audio", err);
                    setStatus("Error: Mic Access Failed");
                } finally {
                    isConnectingRef.current = false;
                }
            }
            return;
        }

        if (withMic) isConnectingRef.current = true;
        setStatus("Connecting...");
        let stream: MediaStream | undefined;
        if (withMic) {
            setStatus("Requesting Microphone...");
            try {
                stream = await requestMicStream();
                setStatus("Connecting...");
            } catch (err) {
                console.error("Error accessing audio", err);
                setStatus("Error: Mic Access Failed");
                isConnectingRef.current = false;
                return;
            }
        }

        const appToken = getAppToken();
        const baseWs = getWsUrl();
        const wsUrl = appToken ? `${baseWs}${baseWs.includes('?') ? '&' : '?'}token=${encodeURIComponent(appToken)}` : baseWs;
        const socket = new WebSocket(wsUrl);
        ws.current = socket;

        socket.onopen = async () => {
            if (appToken) {
                socket.send(JSON.stringify({ type: 'auth', token: appToken }));
            }
            setIsRecording(withMic);
            setStatus(withMic ? "Connecting AI..." : "Connected");
            nextStartTime.current = 0;
            isInitializedRef.current = false;
            socket.send(JSON.stringify({
                type: 'init',
                voice: selectedVoice,
                thinkingLevel,
                accurateMode,
                answerLength,
                googleSearchMode,
            }));

            const initAckTimeout = setTimeout(() => {
                if (!isInitializedRef.current) setStatus("Starting up, please wait...");
            }, 6000);
            initAckTimeoutRef.current = initAckTimeout;

            const imageMessages = selectedImagesRef.current.filter(img => img.status === 'uploading');
            imageMessages.forEach(image => sendImageToWebSocket(image));

            if (withMic && stream) {
                mediaStreamRef.current = stream;
                await attachMicPipeline(stream);
            }
            isConnectingRef.current = false;
        };

        socket.onmessage = (event) => {
            try {
                if (typeof event.data !== 'string') return;
                const msg = JSON.parse(event.data);
                if (msg.audio) {
                    if (outputAudioCtx.current) {
                        aiTurnActiveRef.current = true;
                        turnCompletePendingRef.current = false;
                        setStatus("Speaking...");
                        playAudioChunk(outputAudioCtx.current, msg.audio, nextStartTime, isAiSpeaking, speakingCooldownUntilRef);
                    }
                } else if (msg.type === 'thinking') {
                    aiTurnActiveRef.current = true;
                    turnCompletePendingRef.current = false;
                    isAiThinkingRef.current = true;
                    setStatus("Thinking...");
                    clearTimeout((window as any).__thinkingTimeout);
                    (window as any).__thinkingTimeout = setTimeout(() => {
                        if (isAiThinkingRef.current) {
                            console.warn('[Friday] Thinking timeout — forcing Listening state');
                            isAiThinkingRef.current = false;
                            aiTurnActiveRef.current = false;
                            turnCompletePendingRef.current = false;
                            setStatus('Listening...');
                        }
                    }, 30000);
                } else if (msg.type === 'speaking') {
                    aiTurnActiveRef.current = true;
                    turnCompletePendingRef.current = false;
                    isAiThinkingRef.current = false;
                    clearTimeout((window as any).__thinkingTimeout);
                } else if (msg.text) {
                    if (!captionTurnStartedRef.current) {
                        captionTurnStartedRef.current = true;
                        enqueueTextChunk(msg.text, true);
                    } else {
                        enqueueTextChunk(msg.text, false);
                    }

                    if (/(chup ho rahi hoon|chup ho jata|session band|alvida|standby par ja rahi|bye dk|main chup ho)/i.test(msg.text)) {
                        shouldCloseAfterTurnRef.current = true;
                    }
                } else if (msg.turnComplete) {
                    captionTurnStartedRef.current = false;
                    isAiThinkingRef.current = false;
                    turnCompletePendingRef.current = true;
                    if (shouldCloseAfterTurnRef.current) {
                        shouldCloseAfterTurnRef.current = false;
                        const delay = Math.max(1200, ((nextStartTime.current - (outputAudioCtx.current?.currentTime || 0)) * 1000) + 600);
                        setTimeout(() => {
                            stopRecording();
                            setStatus("Session band ho gaya. Say 'Hello Friday' to wake.");
                        }, delay);
                    }
                } else if (msg.type === 'init_ack') {
                    isInitializedRef.current = true;
                    isAiSpeaking.current = false;
                    isAiThinkingRef.current = false;
                    aiTurnActiveRef.current = false;
                    turnCompletePendingRef.current = false;
                    speakingCooldownUntilRef.current = 0;
                    if (initAckTimeoutRef.current) { clearTimeout(initAckTimeoutRef.current); initAckTimeoutRef.current = null; }
                    setStatus("Listening...");
                    if (pendingImagePayloadsRef.current.length > 0) {
                        const queued = [...pendingImagePayloadsRef.current];
                        pendingImagePayloadsRef.current = [];
                        queued.forEach(img => sendImageToWebSocket(img));
                    }
                } else if (msg.type === 'ui_toggle_command') {
                    const { setting, state } = msg;
                    if (setting === 'captions') {
                        setShowCaptions((prev) => (typeof state === 'boolean' ? state : !prev));
                    } else if (setting === 'accurate_mode') {
                        setAccurateMode((prev) => (typeof state === 'boolean' ? state : !prev));
                    } else if (setting === 'google_search') {
                        setGoogleSearchMode((prev) => (typeof state === 'boolean' ? state : !prev));
                    } else if (setting === 'wake_word') {
                        setWakeWordActive((prev) => {
                            const next = typeof state === 'boolean' ? state : !prev;
                            localStorage.setItem('wakeWordActive', String(next));
                            return next;
                        });
                    } else if (setting === 'chat_history') {
                        setShowChatHistory((prev) => (typeof state === 'boolean' ? state : !prev));
                    } else if (setting === 'code_agent') {
                        setShowCodeAgent((prev) => (typeof state === 'boolean' ? state : !prev));
                    } else if (setting === 'whatsapp_modal') {
                        setShowWhatsAppModal((prev) => (typeof state === 'boolean' ? state : !prev));
                    } else if (setting === 'settings') {
                        setShowSettings((prev) => (typeof state === 'boolean' ? state : !prev));
                    } else if (setting === 'music') {
                        if (state === false) stopMusicPlayback();
                    }
                } else if (msg.type === 'session_reconnecting') {
                    isInitializedRef.current = false;
                    isAiSpeaking.current = false;
                    isAiThinkingRef.current = false;
                    aiTurnActiveRef.current = false;
                    clearTimeout((window as any).__thinkingTimeout);
                    resetTypewriter();
                    setStatus("⚡ AI reconnecting...");
                } else if (msg.type === 'session_reconnected') {
                    isInitializedRef.current = true;
                    isAiSpeaking.current = false;
                    isAiThinkingRef.current = false;
                    aiTurnActiveRef.current = false;
                    turnCompletePendingRef.current = false;
                    speakingCooldownUntilRef.current = 0;
                    setStatus("Listening...");
                } else if (msg.error === 'session_reconnect_failed') {
                    setStatus("Connection lost. Please refresh the page.");
                    setIsRecording(false);
                    isAiThinkingRef.current = false;
                    aiTurnActiveRef.current = false;
                } else if (msg.interrupted) {
                    isAiSpeaking.current = false;
                    isAiThinkingRef.current = false;
                    aiTurnActiveRef.current = false;
                    turnCompletePendingRef.current = false;
                    nextStartTime.current = outputAudioCtx.current?.currentTime || 0;
                    resetTypewriter();
                    setStatus("Listening...");
                } else if (msg.error === "session_init_failed") {
                    aiTurnActiveRef.current = false;
                    turnCompletePendingRef.current = false;
                    setStatus("Error: AI session failed to start");
                } else if (msg.imageAck) {
                    setSelectedImages(prev => prev.map(img => img.id === msg.imageId ? { ...img, status: 'uploaded' } : img));
                    if (status !== "Speaking...") isAiSpeaking.current = false;
                } else if (msg.type === 'pairing_code_ready' && msg.pairingCode) {
                    setPairingCode(msg.pairingCode);
                } else if (msg.type === 'reminder_due' && msg.reminder) {
                    setDueReminder({ title: msg.reminder.title, timeString: msg.reminder.timeString });
                    setTimeout(() => setDueReminder(null), 15000);
                } else if (msg.type === 'whatsapp_incoming') {
                    setWhatsappNotif({
                        sender: msg.sender || 'Unknown',
                        text: msg.text || '',
                        isGroup: !!msg.isGroup,
                        groupName: msg.groupName,
                    });
                    clearTimeout(whatsappNotifTimerRef.current);
                    whatsappNotifTimerRef.current = setTimeout(
                        () => setWhatsappNotif(null),
                        msg.isGroup ? 8000 : 12000
                    );
                } else if (msg.type === 'background_task_event' || msg.type === 'background_task_started' || msg.type === 'background_task_completed') {
                    const task = msg.task;
                    if (task) {
                        if (task.status === 'running' || task.status === 'pending') {
                            setActiveBgTask({
                                id: task.id,
                                name: task.name,
                                type: task.type,
                                progressStep: task.progressStep || 'Processing...',
                            });
                        } else if (task.status === 'completed') {
                            setActiveBgTask((prev) => (prev?.id === task.id ? null : prev));
                            setCompletedBgTask({
                                id: task.id,
                                name: task.name,
                                resultSummary: task.resultSummary || 'Completed successfully',
                            });
                            clearTimeout(completedBgTaskTimerRef.current);
                            completedBgTaskTimerRef.current = setTimeout(() => {
                                setCompletedBgTask(null);
                            }, 12000);
                        } else if (task.status === 'cancelled' || task.status === 'failed') {
                            setActiveBgTask((prev) => (prev?.id === task.id ? null : prev));
                        }
                    }
                } else if (msg.type === 'song_identified') {
                    if (msg.song) {
                        setIdentifiedSong({
                            ...msg.song,
                            mode: msg.mode,
                        });
                        clearTimeout(identifiedSongTimerRef.current);
                        identifiedSongTimerRef.current = setTimeout(() => setIdentifiedSong(null), 20000);
                    }
                } else if (msg.type === 'deep_research_result') {
                    if (msg.report) {
                        setResearchReport(msg.report);
                    }
                } else if (msg.type === 'play_music') {
                    // Stop any ongoing native audio
                    stopMusicPlayback();
                    const trackInfo = {
                        trackName: msg.trackName || 'Music Track',
                        artistName: msg.artistName || 'YouTube Music',
                        albumArt: msg.albumArt || (msg.videoId ? `https://img.youtube.com/vi/${msg.videoId}/hqdefault.jpg` : undefined),
                        spotifyUrl: msg.spotifyUrl,
                        youtubeMusicUrl: msg.youtubeMusicUrl || (msg.videoId ? `https://music.youtube.com/watch?v=${msg.videoId}` : undefined),
                        embedUrl: msg.embedUrl || (msg.videoId ? `https://www.youtube-nocookie.com/embed/${msg.videoId}?autoplay=1&enablejsapi=1&controls=1&modestbranding=1&playsinline=1&rel=0` : undefined),
                        videoId: msg.videoId,
                        isFullSong: true,
                        isYouTubeMusic: true,
                        quality: msg.quality || 'YouTube Music HD',
                        durationSec: msg.durationSec,
                        audioUrl: msg.audioUrl,
                        fallbackAudioUrl: msg.fallbackAudioUrl,
                        isPlaying: true,
                        hasError: false,
                    };

                    // If YouTube video / embed is present (Primary & 100% reliable)
                    if (trackInfo.embedUrl || trackInfo.videoId) {
                        setNowPlayingMusic({
                            ...trackInfo,
                            isYouTubeMusic: true,
                            isPlaying: true,
                            hasError: false,
                        });
                        return;
                    }

                    const primaryAudioUrl = msg.audioUrl || msg.streamUrl;
                    const fallbackAudioUrl = msg.fallbackAudioUrl || msg.fallbackUrl;

                    const attemptPlayback = (srcUrl: string, isFallbackAttempt = false, isProxyAttempt = false) => {
                        try {
                            if (musicAudioRef.current) {
                                musicAudioRef.current.pause();
                                musicAudioRef.current = null;
                            }
                            const audio = new Audio();
                            // Do NOT set audio.crossOrigin = 'anonymous' because it causes CDNs to reject CORS!
                            audio.src = srcUrl;
                            audio.volume = 0.85;

                            audio.onended = () => {
                                setNowPlayingMusic(prev => prev ? { ...prev, isPlaying: false } : null);
                            };

                            audio.onerror = (e) => {
                                console.warn('[Music] Audio stream error on source:', srcUrl, e);
                                if (!isProxyAttempt && srcUrl.startsWith('http')) {
                                    console.log('[Music] Attempting server audio proxy stream...');
                                    const proxyUrl = getApiUrl(`/api/music/proxy-stream?url=${encodeURIComponent(srcUrl)}`);
                                    attemptPlayback(proxyUrl, isFallbackAttempt, true);
                                } else if (!isFallbackAttempt && fallbackAudioUrl && fallbackAudioUrl !== srcUrl) {
                                    console.log('[Music] Attempting fallback audio stream URL...');
                                    attemptPlayback(fallbackAudioUrl, true, false);
                                } else if (msg.videoId || msg.embedUrl || trackInfo.embedUrl) {
                                    console.log('[Music] Direct stream failed, falling back to YouTube Music embed');
                                    if (musicAudioRef.current) {
                                        musicAudioRef.current.pause();
                                        musicAudioRef.current = null;
                                    }
                                    setNowPlayingMusic({
                                        ...trackInfo,
                                        isYouTubeMusic: true,
                                        isPlaying: true,
                                        hasError: false,
                                    });
                                } else {
                                    setNowPlayingMusic(prev => prev ? {
                                        ...prev,
                                        hasError: true,
                                        isPlaying: false,
                                        errorMessage: 'Audio stream failed to load. Use Spotify or YouTube link below.'
                                    } : null);
                                }
                            };

                            musicAudioRef.current = audio;

                            const playPromise = audio.play();
                            if (playPromise !== undefined) {
                                playPromise.then(() => {
                                    setNowPlayingMusic(prev => prev ? { ...prev, isPlaying: true, hasError: false } : null);
                                }).catch((err) => {
                                    console.warn('[Music] Autoplay prevented or start failed:', err);
                                    setNowPlayingMusic(prev => prev ? {
                                        ...prev,
                                        isPlaying: false,
                                        hasError: false,
                                        errorMessage: 'Click ▶ Play to start audio'
                                    } : null);
                                });
                            }

                            setNowPlayingMusic({
                                ...trackInfo,
                                isPlaying: true,
                            });
                        } catch (e) {
                            console.warn('[Music] Error initializing Audio player:', e);
                            setNowPlayingMusic({
                                ...trackInfo,
                                hasError: true,
                                errorMessage: 'Failed to initialize audio player',
                            });
                        }
                    };

                    if (primaryAudioUrl) {
                        attemptPlayback(primaryAudioUrl);
                    } else if (msg.videoId || msg.embedUrl) {
                        setNowPlayingMusic({
                            ...trackInfo,
                            isYouTubeMusic: true,
                            isPlaying: true,
                        });
                    } else {
                        setNowPlayingMusic(trackInfo);
                    }
                } else if (msg.type === 'play_youtube_music' && msg.track) {
                    const track = msg.track;
                    const directAudio = track.audioUrl || (track.streamUrl && !track.streamUrl.includes('youtube-nocookie.com') ? track.streamUrl : undefined);

                    playDirectSong({
                        trackName: track.trackName || 'YouTube Music Track',
                        artistName: track.artistName || 'YouTube Music',
                        albumName: track.albumName || 'YouTube Pro Safe',
                        albumArt: track.albumArtHighRes || track.albumArt || (track.videoId ? `https://img.youtube.com/vi/${track.videoId}/hqdefault.jpg` : undefined),
                        audioUrl: directAudio,
                        isYouTube: true,
                        isFullSong: true,
                        quality: track.quality || (directAudio ? 'YouTube Pro 320kbps HD Audio' : 'YouTube Music HD'),
                        songId: track.id || track.videoId,
                    });
                } else if (msg.type === 'stop_music') {
                    stopMusicPlayback();
                } else if (msg.type === 'pause_music') {
                    pauseMusicPlayback();
                } else if (msg.type === 'resume_music') {
                    resumeMusicPlayback();
                } else if (msg.type === 'control_music') {
                    const act = String(msg.action || '').toLowerCase().trim();
                    const val = msg.value;
                    if (act === 'seek_forward') {
                        seekRelativeMusic(Number(val) || 10);
                    } else if (act === 'seek_backward') {
                        seekRelativeMusic(-(Number(val) || 10));
                    } else if (act === 'restart') {
                        restartMusic();
                    } else if (act === 'volume_up') {
                        if (musicAudioRef.current) {
                            musicAudioRef.current.volume = Math.min(1, musicAudioRef.current.volume + 0.15);
                        }
                    } else if (act === 'volume_down') {
                        if (musicAudioRef.current) {
                            musicAudioRef.current.volume = Math.max(0, musicAudioRef.current.volume - 0.15);
                        }
                    } else if (act === 'set_volume') {
                        if (musicAudioRef.current && val !== undefined) {
                            musicAudioRef.current.volume = Math.max(0, Math.min(1, Number(val) / 100));
                        }
                    } else if (act === 'next_song') {
                        playNextQueueSong();
                    } else if (act === 'prev_song') {
                        playPrevQueueSong();
                    } else if (act === 'set_bass') {
                        applyEqPreset('bass_boost');
                    } else if (act === 'set_equalizer') {
                        applyEqPreset(val || 'bass_boost');
                    }
                } else if (msg.type === 'song_preview_options') {
                    pauseMusicPlayback();
                    setPreviewQuery(msg.query || '');
                    setPreviewCandidates(msg.candidates || []);
                    setActivePreviewIndex(0);
                    setShowSongPreviewModal(true);
                } else if (msg.type === 'control_preview_option') {
                    const act = String(msg.action || '').toLowerCase().trim();
                    if (act === 'next') {
                        setActivePreviewIndex(prev => (previewCandidates.length > 0 ? (prev + 1) % previewCandidates.length : 0));
                    } else if (act === 'prev') {
                        setActivePreviewIndex(prev => (previewCandidates.length > 0 ? (prev - 1 + previewCandidates.length) % previewCandidates.length : 0));
                    } else if (act === 'confirm' || act === 'select') {
                        const chosen = previewCandidates[activePreviewIndex] || (msg.songName ? previewCandidates.find(c => c.songName.toLowerCase().includes(msg.songName.toLowerCase())) : null) || previewCandidates[0];
                        if (chosen) {
                            playConfirmedCandidate(chosen);
                        }
                    } else if (act === 'cancel') {
                        setShowSongPreviewModal(false);
                    }
                }
            } catch (err) {
                console.warn("[LiveAIInterface] Error processing socket message:", err);
            }
        };

        socket.onclose = (event: CloseEvent) => {
            if (event.code === 4001) {
                console.warn("[LiveAIInterface] 🚫 WebSocket closed: 4001 UNAUTHORIZED_APP_KEY. Forcing app lock.");
                clearAppSession();
                return;
            }
            isInitializedRef.current = false;
            isConnectingRef.current = false;
            const wasActive = isRecording || isAiSpeaking.current || aiTurnActiveRef.current;
            setIsRecording(false);
            isAiThinkingRef.current = false;
            aiTurnActiveRef.current = false;
            clearTimeout((window as any).__thinkingTimeout);
            if (wasActive) {
                setStatus("⚡ Reconnecting...");
            } else {
                setStatus("Idle");
            }
            stream?.getTracks().forEach(track => track.stop());
        };

        socket.onerror = (error) => {
            console.error("WebSocket error", error);
            isConnectingRef.current = false;
            setStatus("⚡ Connection issue, retrying...");
            setTimeout(() => {
                if (!isInitializedRef.current && isRecording) {
                    setStatus("Error: Connection lost. Refresh if needed.");
                    setIsRecording(false);
                }
            }, 4000);
            stream?.getTracks().forEach(track => track.stop());
        };
    };

    const handleToggleRecording = async () => {
        if (isRecording) stopRecording();
        else await ensureConnection(true);
    };

    const handleClose = () => {
        if (isRecording) stopRecording();
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[1000] bg-gradient-to-b from-[#0a0f24] via-[#0a0f24] via-60% to-black text-white flex flex-col items-center pt-[env(safe-area-inset-top,0px)] px-6 pb-[max(env(safe-area-inset-bottom,0px),12px)] overflow-hidden"
        >
            <div className="w-full h-full flex flex-col flex-1 overflow-hidden">
                {/* ── Top Dashboard Header & Horizontally Slideable Capsule Buttons ── */}
                <div className="w-full flex flex-col gap-2 mb-4 pt-2 shrink-0">
                    <div className="flex items-center justify-between px-1">
                        <h1 className="text-base sm:text-lg font-bold flex items-center gap-2">
                            <span>🤖</span>
                            <span>FRIDAY</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono font-medium border border-blue-500/40">Live Agent</span>
                        </h1>
                        <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 bg-slate-900/60 px-2.5 py-1 rounded-full border border-white/5">
                            <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-ping' : 'bg-emerald-400'}`} />
                            <span>{isRecording ? 'Listening...' : 'Ready'}</span>
                        </span>
                    </div>

                    {/* ── Horizontally Slideable Capsule Pills (Swipe Left/Right on Mobile & Desktop) ── */}
                    <div className="w-full overflow-x-auto no-scrollbar scroll-smooth flex items-center gap-2 py-1 px-1 touch-pan-x select-none">
                        {/* 1. Wi-Fi Radar Capsule */}
                        <button
                            onClick={() => setShowWifiRadar(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-300 text-xs font-semibold shadow-[0_0_15px_rgba(6,182,212,0.25)] transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="Wi-Fi Radar & Connected Devices"
                        >
                            <Radio className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Wi-Fi Radar</span>
                        </button>

                        {/* 2. Memory Backup & Download Capsule */}
                        <button
                            onClick={() => setShowBackupModal(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-xs font-semibold shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="Memory Backup Download & Security Hub"
                        >
                            <Download className="w-3.5 h-3.5" />
                            <span>Backup & Vault</span>
                        </button>

                        {/* 2. Security Shield Capsule */}
                        <button
                            onClick={() => setShowBackupModal(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/50 text-rose-300 text-xs font-semibold shadow-[0_0_15px_rgba(244,63,94,0.25)] transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="Intrusion Shield & Blocked Devices"
                        >
                            <Shield className="w-3.5 h-3.5" />
                            <span>Security Shield</span>
                        </button>

                        {/* 3. Link WhatsApp Capsule */}
                        <button
                            onClick={() => setShowWhatsAppModal(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 text-xs font-semibold shadow-[0_0_15px_rgba(16,185,129,0.25)] transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="WhatsApp Link Assistant"
                        >
                            <span>📲</span>
                            <span>WhatsApp</span>
                        </button>

                        {/* 4. Web Crawler Capsule */}
                        <button
                            onClick={() => setShowWebCrawler(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-300 text-xs font-semibold shadow-[0_0_15px_rgba(6,182,212,0.25)] transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="Web Crawler & AI Research Studio"
                        >
                            <span>🕷️</span>
                            <span>Crawler</span>
                        </button>

                        {/* 4.5 Music Studio Capsule */}
                        <button
                            onClick={() => setShowMusicStudio(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-cyan-500/20 to-fuchsia-500/20 hover:from-cyan-500/30 hover:to-fuchsia-500/30 border border-cyan-400/50 text-cyan-300 text-xs font-semibold shadow-[0_0_15px_rgba(6,182,212,0.25)] transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="JioSaavn 320kbps HD Music Studio"
                        >
                            <span>🎵</span>
                            <span>Music Studio</span>
                        </button>

                        {/* 5. YouTube AI Capsule */}
                        <button
                            onClick={() => setShowYouTubeStudio(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 text-xs font-semibold shadow-[0_0_15px_rgba(239,68,68,0.25)] transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="YouTube Intelligence & Ask Gemini Studio"
                        >
                            <span>🎬</span>
                            <span>YouTube AI</span>
                        </button>

                        {/* 6. Screen Vision Capsule */}
                        <button
                            onClick={toggleScreenShare}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold shrink-0 whitespace-nowrap transition-all cursor-pointer active:scale-95 hover:scale-105 ${
                                isScreenSharing
                                    ? 'bg-red-500/20 border border-red-500/60 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse'
                                    : 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.25)] hover:bg-indigo-500/30'
                            }`}
                            title={isScreenSharing ? 'Stop Screen Sharing' : 'Share Screen with Friday for Vision AI'}
                        >
                            <span>{isScreenSharing ? '🔴 Vision ON' : '🖥️ Vision'}</span>
                        </button>

                        {/* 7. Chat History Capsule */}
                        <button
                            onClick={() => setShowChatHistory(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/50 text-blue-300 text-xs font-semibold shadow-[0_0_15px_rgba(59,130,246,0.25)] transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="Encrypted Chat History"
                        >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Chat History</span>
                        </button>

                        {/* 8. Captions Capsule */}
                        <button
                            onClick={() => setShowCaptions(!showCaptions)}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold shrink-0 whitespace-nowrap transition-all cursor-pointer active:scale-95 hover:scale-105 ${
                                showCaptions
                                    ? 'bg-emerald-500/25 border border-emerald-500/60 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                                    : 'bg-slate-800/80 border border-slate-700 text-slate-300 hover:bg-slate-700'
                            }`}
                            title={showCaptions ? 'Captions ON' : 'Captions OFF'}
                        >
                            <Captions className="w-3.5 h-3.5" />
                            <span>Captions</span>
                        </button>

                        {/* 9. Code Agent Capsule */}
                        <button
                            onClick={() => setShowCodeAgent(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/50 text-purple-300 text-xs font-semibold shadow-[0_0_15px_rgba(168,85,247,0.25)] transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="Coding Agent & Diagnostics Logs"
                        >
                            <Code2 className="w-3.5 h-3.5" />
                            <span>Code Agent</span>
                        </button>

                        {/* 10. Settings Capsule */}
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="Settings"
                        >
                            <Settings className="w-3.5 h-3.5" />
                            <span>Settings</span>
                        </button>

                        {/* 11. Minimize / Close Capsule */}
                        <button
                            onClick={handleClose}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-rose-300 text-xs font-semibold transition-all cursor-pointer shrink-0 whitespace-nowrap active:scale-95 hover:scale-105"
                            title="Close / Minimize"
                        >
                            <X className="w-3.5 h-3.5" />
                            <span>Close</span>
                        </button>
                    </div>
                </div>

                <AnimatePresence>
                    {dueReminder && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-amber-500/15 border border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <span>⏰</span>
                                <span className="text-amber-200 text-sm font-medium truncate">{dueReminder.title}</span>
                            </div>
                            <button onClick={() => setDueReminder(null)} className="text-amber-300/70 hover:text-amber-200 shrink-0">
                                <X className="h-4 w-4" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {whatsappNotif && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className={`w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl ${
                                whatsappNotif.isGroup
                                    ? 'bg-blue-500/15 border border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
                                    : 'bg-emerald-500/15 border border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                            }`}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <span>{whatsappNotif.isGroup ? '👥' : '💬'}</span>
                                <div className="min-w-0">
                                    <p className={`text-xs font-bold ${
                                        whatsappNotif.isGroup ? 'text-blue-300' : 'text-emerald-300'
                                    }`}>
                                        {whatsappNotif.isGroup
                                            ? `${whatsappNotif.sender} (${whatsappNotif.groupName || 'Group'})`
                                            : whatsappNotif.sender}
                                    </p>
                                    <p className="text-slate-200 text-xs truncate max-w-[220px]">{whatsappNotif.text}</p>
                                </div>
                            </div>
                            <button onClick={() => setWhatsappNotif(null)} className="text-slate-400 hover:text-white shrink-0">
                                <X className="h-4 w-4" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ── Active Background Task Live Banner ── */}
                <AnimatePresence>
                    {activeBgTask && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="w-full mb-3 flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.2)] backdrop-blur-sm"
                        >
                            <div className="flex items-center gap-2.5 min-w-0">
                                <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-cyan-300 text-xs font-bold truncate">⚡ Background: {activeBgTask.name}</span>
                                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/30 text-cyan-200 uppercase font-mono tracking-wider">Running</span>
                                    </div>
                                    <p className="text-slate-300 text-[11px] truncate">{activeBgTask.progressStep}</p>
                                </div>
                            </div>
                            <button onClick={() => setActiveBgTask(null)} className="text-cyan-300/70 hover:text-cyan-200 shrink-0">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ── Completed Background Task Notification Banner ── */}
                <AnimatePresence>
                    {completedBgTask && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="w-full mb-3 flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.25)] backdrop-blur-sm"
                        >
                            <div className="flex items-center gap-2.5 min-w-0">
                                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-emerald-300 text-xs font-bold truncate">✅ Done: {completedBgTask.name}</span>
                                    </div>
                                    <p className="text-slate-200 text-[11px] truncate max-w-[280px]">{completedBgTask.resultSummary}</p>
                                </div>
                            </div>
                            <button onClick={() => setCompletedBgTask(null)} className="text-emerald-300/70 hover:text-emerald-200 shrink-0">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ── Shazam / Google Humming Identified Song Card ── */}
                <AnimatePresence>
                    {identifiedSong && (
                        <motion.div
                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                            className="w-full mb-3 p-3 rounded-2xl bg-gradient-to-r from-violet-950/90 via-purple-900/80 to-slate-900/90 border border-violet-500/50 shadow-[0_0_25px_rgba(168,85,247,0.3)] backdrop-blur-md flex items-center justify-between gap-3"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                {identifiedSong.albumArt ? (
                                    <img
                                        src={identifiedSong.albumArt}
                                        alt={identifiedSong.trackName}
                                        className="w-11 h-11 rounded-xl object-cover border border-white/20 shadow-md shrink-0"
                                    />
                                ) : (
                                    <div className="w-11 h-11 rounded-xl bg-violet-600/30 border border-violet-500/40 flex items-center justify-center shrink-0">
                                        <span className="text-xl">🎵</span>
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span className="text-violet-300 text-xs font-bold truncate">
                                            {identifiedSong.trackName}
                                        </span>
                                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-violet-500/30 text-violet-200 uppercase font-mono tracking-wider">
                                            {identifiedSong.mode === 'live_playing_song' ? '🎧 Live Audio' : '🎵 Hum-Matched'}
                                        </span>
                                    </div>
                                    <p className="text-slate-300 text-[11px] truncate">
                                        {identifiedSong.artistName} {identifiedSong.albumName ? `• ${identifiedSong.albumName}` : ''}
                                    </p>
                                    {identifiedSong.matchedPatternOrLyrics && (
                                        <p className="text-violet-400/90 text-[10px] truncate italic mt-0.5">
                                            "{identifiedSong.matchedPatternOrLyrics}"
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {identifiedSong.previewUrl && (
                                    <button
                                        onClick={() => {
                                            stopMusicPlayback();
                                            const audio = new Audio();
                                            audio.crossOrigin = 'anonymous';
                                            audio.src = identifiedSong.previewUrl;
                                            audio.volume = 0.85;
                                            audio.onended = () => setNowPlayingMusic(prev => prev ? { ...prev, isPlaying: false } : null);
                                            audio.onerror = () => setNowPlayingMusic(prev => prev ? { ...prev, hasError: true, isPlaying: false, errorMessage: 'Preview audio error' } : null);
                                            musicAudioRef.current = audio;
                                            audio.play().catch(() => {});
                                            setNowPlayingMusic({
                                                trackName: identifiedSong.trackName,
                                                artistName: identifiedSong.artistName,
                                                spotifyUrl: identifiedSong.spotifyUrl,
                                                audioUrl: identifiedSong.previewUrl,
                                                isPlaying: true,
                                            });
                                        }}
                                        className="px-2.5 py-1 rounded-xl bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/50 text-violet-200 text-xs font-semibold flex items-center gap-1 transition-all"
                                        title="Play 30s preview"
                                    >
                                        ▶ Play
                                    </button>
                                )}
                                <a
                                    href={identifiedSong.spotifyUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2.5 py-1 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/50 text-emerald-200 text-xs font-semibold flex items-center gap-1 transition-all"
                                >
                                    Spotify ↗
                                </a>
                                <button
                                    onClick={() => setIdentifiedSong(null)}
                                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 shrink-0"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="flex-1 flex flex-col items-center justify-center gap-6 overflow-hidden">
                    <div className="text-center">
                        <span className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent tracking-wide">
                            Welcome
                        </span>
                    </div>
                    <AgentFace status={status} volume={volume} size={160} colorIndex={colorIndex} onDoubleClick={handleFaceDoubleTap} />
                    <p className="text-slate-300 text-sm font-medium">{status}</p>

                    {!isRecording && wakeWordActive && (
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-xs text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)] animate-pulse">
                            <span className="w-2 h-2 rounded-full bg-cyan-400" />
                            <span>Say <b>"Hello Friday"</b> to start session</span>
                        </div>
                    )}

                    {/* ── Mini Music Title Pill (Below Agent Face: Hidden big player by default) ── */}
                    <AnimatePresence>
                        {nowPlayingMusic && !isMusicPlayerExpanded && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.92, y: 8 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.92, y: 8 }}
                                className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-red-950/80 via-purple-950/70 to-slate-900/90 border border-red-500/40 text-xs shadow-[0_0_20px_rgba(239,68,68,0.25)] backdrop-blur-md max-w-sm w-full cursor-pointer hover:border-red-400 transition-all select-none"
                                onClick={() => setIsMusicPlayerExpanded(true)}
                                title="Click title to open full music player"
                            >
                                {/* Animated Equalizer or Mini Album Art */}
                                {nowPlayingMusic.albumArt ? (
                                    <img
                                        src={nowPlayingMusic.albumArt}
                                        alt={nowPlayingMusic.trackName}
                                        className="w-6 h-6 rounded-full object-cover border border-white/20 shrink-0"
                                    />
                                ) : (
                                    <span className="flex gap-0.5 items-end h-3 shrink-0">
                                        <span className={`w-0.5 bg-red-400 rounded-full ${nowPlayingMusic.isPlaying ? 'animate-[bounce_0.8s_infinite]' : 'h-2'}`} />
                                        <span className={`w-0.5 bg-red-400 rounded-full ${nowPlayingMusic.isPlaying ? 'animate-[bounce_0.6s_infinite_0.2s]' : 'h-3'}`} />
                                        <span className={`w-0.5 bg-red-400 rounded-full ${nowPlayingMusic.isPlaying ? 'animate-[bounce_0.9s_infinite_0.4s]' : 'h-2'}`} />
                                    </span>
                                )}

                                {/* Song Name & Artist (Click to expand) */}
                                <div className="min-w-0 flex-1 flex items-center gap-1.5 overflow-hidden">
                                    <span className="font-bold text-white truncate text-[11px] hover:text-red-300 transition-colors">
                                        {nowPlayingMusic.trackName}
                                    </span>
                                    {nowPlayingMusic.artistName && (
                                        <span className="text-slate-400 text-[10px] truncate hidden sm:inline">
                                            • {nowPlayingMusic.artistName}
                                        </span>
                                    )}
                                    <span className="text-[9px] px-1 py-0.2 rounded-full bg-red-500/20 text-red-300 font-mono shrink-0">
                                        {nowPlayingMusic.isYouTube ? '🔴 YT Pro' : '⚡ HD'}
                                    </span>
                                </div>

                                {/* Play / Pause button right next to title */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleMusicPlayPause();
                                    }}
                                    className="p-1.5 rounded-full bg-red-600/40 hover:bg-red-600/80 text-white font-semibold text-[11px] transition-all shadow-sm cursor-pointer shrink-0 active:scale-95"
                                    title={nowPlayingMusic.isPlaying ? "Pause" : "Play"}
                                >
                                    {nowPlayingMusic.isPlaying ? '⏸' : '▶'}
                                </button>

                                {/* Chevron Up Indicator */}
                                <span className="text-slate-400 text-[10px] shrink-0 font-bold">▲</span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <AnimatePresence>
                        {pairingCode && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="w-full max-w-sm p-4 rounded-3xl bg-emerald-950/90 border border-emerald-500/50 shadow-[0_0_35px_rgba(16,185,129,0.35)] backdrop-blur-xl text-center flex flex-col items-center gap-2"
                            >
                                <span className="text-emerald-400 font-bold text-sm">📲 WhatsApp Pairing Code</span>
                                <span className="text-slate-300 text-xs">WhatsApp &gt; Linked Devices &gt; Link with phone number:</span>
                                <div className="px-4 py-2 rounded-2xl bg-black/60 border border-emerald-400/60 text-emerald-300 font-mono font-black text-2xl tracking-widest select-all">
                                    {pairingCode}
                                </div>
                                <div className="flex gap-2 w-full mt-1">
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(pairingCode);
                                            alert("Pairing code copied!");
                                        }}
                                        className="flex-1 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors"
                                    >
                                        Copy Code
                                    </button>
                                    <button
                                        onClick={() => setPairingCode(null)}
                                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <AnimatePresence>
                        {isRecording && inactivityCountdown !== null && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, y: -10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: -10 }}
                                className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-amber-500/20 border border-amber-500/60 text-amber-300 text-xs shadow-[0_0_25px_rgba(245,158,11,0.3)] backdrop-blur-md animate-bounce"
                            >
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                                <span><b>DK</b>, main <b>{inactivityCountdown}s</b> mein band ho jaungi! Kuch poochna hai?</span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {showCaptions && captionText && (
                        <div
                            ref={captionBoxRef}
                            onScroll={() => {
                                const box = captionBoxRef.current;
                                if (!box) return;
                                userScrolledUpRef.current = box.scrollTop + box.clientHeight < box.scrollHeight - 20;
                            }}
                            className="w-full max-h-40 overflow-y-auto bg-slate-950/60 border border-purple-500/20 rounded-2xl p-4 text-sm text-slate-100 leading-relaxed"
                        >
                            {captionText}
                        </div>
                    )}

                    {selectedImages.length > 0 && (
                        <div className="flex gap-2 flex-wrap justify-center">
                            {selectedImages.map(img => (
                                <div key={img.id} className="relative">
                                    <img
                                        src={URL.createObjectURL(img.file)}
                                        className={`w-16 h-16 object-cover rounded-lg border ${img.status === 'uploaded' ? 'border-green-500' : 'border-slate-600 opacity-60'}`}
                                    />
                                    <button
                                        onClick={() => handleRemoveImage(img.id)}
                                        className="absolute -top-1 -right-1 bg-red-600 rounded-full w-5 h-5 flex items-center justify-center text-xs"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-center gap-4 w-full pb-6">
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="p-3 rounded-full bg-slate-800/80 border border-slate-600 text-white hover:bg-slate-700 transition-colors"
                        title="Upload Image"
                    >
                        <Plus className="w-5 h-5" />
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />

                    <button
                        onClick={handleToggleRecording}
                        className={`p-5 rounded-full text-white shadow-lg transition-all ${isRecording ? 'bg-red-600 shadow-red-500/40 hover:bg-red-500' : 'gradient-btn-primary shadow-purple-500/40 hover:scale-105'}`}
                        title={isRecording ? "Stop Session" : "Start Session"}
                    >
                        {isRecording ? <Square className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
                    </button>

                    {isRecording && (
                        <button
                            onClick={() => {
                                if (ws.current && ws.current.readyState === WebSocket.OPEN) {
                                    setStatus("Thinking...");
                                    ws.current.send(JSON.stringify({ type: 'trigger_reply' }));
                                }
                            }}
                            className="px-4 py-3 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold text-xs shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all flex items-center gap-1.5 active:scale-95 animate-pulse cursor-pointer"
                            title="Friday ko turant bolne ke liye kahein"
                        >
                            <span>⚡</span>
                            <span>Jawab Do</span>
                        </button>
                    )}

                    <button
                        onClick={handleInterrupt}
                        disabled={!isRecording}
                        className="p-3 rounded-full bg-slate-800/80 border border-slate-600 text-white disabled:opacity-30 hover:bg-slate-700 transition-colors"
                        title="Interrupt AI"
                    >
                        <Loader2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <AnimatePresence>
                {showSettings && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="absolute bottom-0 left-0 right-0 z-[2500] bg-[#0d1330]/95 backdrop-blur-2xl border-t border-purple-500/40 rounded-t-3xl p-5 sm:p-6 max-h-[78vh] overflow-y-auto shadow-[0_-10px_40px_rgba(0,0,0,0.8)]"
                    >
                        {/* Settings Header */}
                        <div className="flex justify-between items-center mb-5 pb-3 border-b border-slate-800">
                            <div className="flex items-center gap-2.5">
                                <div className="p-2 rounded-xl bg-purple-600/20 border border-purple-500/40 text-purple-400">
                                    <Settings className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-white font-bold text-lg tracking-wide">Friday System Settings</h3>
                                    <p className="text-xs text-slate-400">Manage Voice, Music Engines, Bots & Security</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowSettings(false)}
                                className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Accordion Categories Container */}
                        <div className="space-y-3">

                            {/* ── 1. 🗣️ AI Voice & Response Style ── */}
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden transition-all">
                                <button
                                    onClick={() => toggleSettingsSection('ai_voice')}
                                    className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/40 transition-colors select-none"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
                                            <Radio className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-white">AI Voice & Response Style</h4>
                                            <p className="text-[11px] text-slate-400">Voice personality, speed, length & intelligence</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono">
                                            {selectedVoice}
                                        </span>
                                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openSettingsSection === 'ai_voice' ? 'rotate-180 text-purple-400' : 'text-slate-400'}`} />
                                    </div>
                                </button>

                                <AnimatePresence>
                                    {openSettingsSection === 'ai_voice' && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="px-4 pb-4 pt-1 space-y-4 border-t border-slate-800/60"
                                        >
                                            {/* Voice Selector */}
                                            <div>
                                                <label className="text-slate-400 text-xs uppercase tracking-wide font-medium">Voice Model</label>
                                                <div className="relative mt-1">
                                                    <button
                                                        onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}
                                                        className="w-full flex items-center justify-between bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                                                    >
                                                        <span>{selectedVoice}</span> <ChevronDown className="w-4 h-4" />
                                                    </button>
                                                    {showVoiceDropdown && (
                                                        <div className="absolute top-full mt-1 w-full bg-slate-800 border border-slate-600 rounded-xl overflow-hidden z-20 shadow-2xl">
                                                            {VOICES.map(v => (
                                                                <button
                                                                    key={v}
                                                                    onClick={() => { setSelectedVoice(v); setShowVoiceDropdown(false); }}
                                                                    className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-700 ${v === selectedVoice ? 'text-purple-400 font-bold bg-purple-500/10' : 'text-white'}`}
                                                                >
                                                                    {v}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Thinking Level */}
                                            <div>
                                                <label className="text-slate-400 text-xs uppercase tracking-wide font-medium">Thinking Depth</label>
                                                <div className="flex gap-2 mt-1">
                                                    {THINKING_LEVELS.map(level => (
                                                        <button
                                                            key={level}
                                                            onClick={() => setThinkingLevel(level)}
                                                            className={`flex-1 py-2 rounded-xl text-xs font-semibold border capitalize transition-all ${thinkingLevel === level ? 'bg-purple-600 border-purple-500 text-white shadow-[0_0_15px_rgba(147,51,234,0.4)]' : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                                                        >
                                                            {level}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Answer Length */}
                                            <div>
                                                <label className="text-slate-400 text-xs uppercase tracking-wide font-medium">Answer Length</label>
                                                <div className="flex gap-2 mt-1">
                                                    {['short', 'detailed'].map(len => (
                                                        <button
                                                            key={len}
                                                            onClick={() => setAnswerLength(len)}
                                                            className={`flex-1 py-2 rounded-xl text-xs font-semibold border capitalize transition-all ${answerLength === len ? 'bg-purple-600 border-purple-500 text-white shadow-[0_0_15px_rgba(147,51,234,0.4)]' : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                                                        >
                                                            {len}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <ToggleSwitch
                                                label="Careful / Accurate Mode"
                                                description="Double-checks facts and calculations before speaking"
                                                active={accurateMode}
                                                onToggle={() => setAccurateMode(!accurateMode)}
                                                activeColor="bg-purple-600"
                                            />

                                            <ToggleSwitch
                                                label="Google Search Grounding"
                                                description="Live web search integration for real-time information"
                                                active={googleSearchMode}
                                                onToggle={() => setGoogleSearchMode(!googleSearchMode)}
                                                activeColor="bg-blue-600"
                                            />

                                            <ToggleSwitch
                                                label="Live Subtitles (Captions)"
                                                description="Display real-time speech-to-text subtitles on screen"
                                                active={showCaptions}
                                                onToggle={() => setShowCaptions(!showCaptions)}
                                                activeColor="bg-emerald-600"
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* ── 2. 🎵 Music & Streaming Engine (NEW) ── */}
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden transition-all">
                                <button
                                    onClick={() => toggleSettingsSection('music_engine')}
                                    className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/40 transition-colors select-none"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
                                            <Music className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-white">Music & Streaming Engine</h4>
                                            <p className="text-[11px] text-slate-400">Configure YouTube Pro & JioSaavn 320k providers</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 font-mono">
                                            {musicYtEnabled && musicSaavnEnabled ? 'YT Pro (Default)' : musicYtEnabled ? 'YT Only' : musicSaavnEnabled ? 'JioSaavn Only' : 'Auto'}
                                        </span>
                                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openSettingsSection === 'music_engine' ? 'rotate-180 text-red-400' : 'text-slate-400'}`} />
                                    </div>
                                </button>

                                <AnimatePresence>
                                    {openSettingsSection === 'music_engine' && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="px-4 pb-4 pt-1 space-y-3.5 border-t border-slate-800/60"
                                        >
                                            {/* YouTube Pro Toggle */}
                                            <ToggleSwitch
                                                label="🔴 YouTube Pro Safe Audio Stream"
                                                description="Ad-free pure background stream, HD thumbnails & multi-resolution artwork"
                                                active={musicYtEnabled}
                                                onToggle={toggleMusicYtEngine}
                                                activeColor="bg-red-600"
                                            />

                                            {/* JioSaavn 320k Toggle */}
                                            <ToggleSwitch
                                                label="⚡ JioSaavn 320kbps Ultra-HD Stream"
                                                description="Lossless 320kbps pure studio audio stream & high-speed CDN delivery"
                                                active={musicSaavnEnabled}
                                                onToggle={toggleMusicSaavnEngine}
                                                activeColor="bg-emerald-600"
                                            />

                                            {/* Engine Priority Status Notice */}
                                            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70 text-xs text-slate-300 space-y-1">
                                                <div className="flex items-center gap-1.5 font-bold text-white text-[11px]">
                                                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                                    <span>Streaming Priority Rule:</span>
                                                </div>
                                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                                    {musicYtEnabled && musicSaavnEnabled && "• Dono engines ON hain: By default YouTube Pro se song fetch hoga, aur 'JioSaavn' bolne par JioSaavn se chalega."}
                                                    {musicYtEnabled && !musicSaavnEnabled && "• Sirf YouTube Pro ON hai: Sabhi songs YouTube Pro se fetch honge."}
                                                    {!musicYtEnabled && musicSaavnEnabled && "• Sirf JioSaavn ON hai: Sabhi songs direct JioSaavn 320kbps se fetch honge."}
                                                    {!musicYtEnabled && !musicSaavnEnabled && "• Dono OFF nahi ho sakte — system auto fallback to YouTube Pro karega."}
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* ── 3. 🎙️ Audio & Voice Biometrics ── */}
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden transition-all">
                                <button
                                    onClick={() => toggleSettingsSection('audio_biometrics')}
                                    className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/40 transition-colors select-none"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                                            <Mic className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-white">Audio & Voice Biometrics</h4>
                                            <p className="text-[11px] text-slate-400">Wake word & Boss voice recognition security</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono">
                                            {wakeWordActive ? 'Wake Word ON' : 'Manual'}
                                        </span>
                                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openSettingsSection === 'audio_biometrics' ? 'rotate-180 text-cyan-400' : 'text-slate-400'}`} />
                                    </div>
                                </button>

                                <AnimatePresence>
                                    {openSettingsSection === 'audio_biometrics' && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="px-4 pb-4 pt-1 space-y-4 border-t border-slate-800/60"
                                        >
                                            <ToggleSwitch
                                                label="Wake Word ('Hello Friday')"
                                                description="Say 'Hello Friday' anytime to instantly wake assistant without touching screen"
                                                active={wakeWordActive}
                                                onToggle={() => {
                                                    const next = !wakeWordActive;
                                                    setWakeWordActive(next);
                                                    localStorage.setItem('wakeWordActive', String(next));
                                                }}
                                                activeColor="bg-cyan-500"
                                            />

                                            {/* Boss Voice Biometrics & Recognition Manager */}
                                            <VoiceBiometricsManager />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* ── 4. 💬 Messaging & Social Bots ── */}
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden transition-all">
                                <button
                                    onClick={() => toggleSettingsSection('messaging_bots')}
                                    className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/40 transition-colors select-none"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                                            <MessageSquare className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-white">Messaging & Social Bots</h4>
                                            <p className="text-[11px] text-slate-400">WhatsApp Baileys bridge, Telegram & Instagram</p>
                                        </div>
                                    </div>
                                    <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openSettingsSection === 'messaging_bots' ? 'rotate-180 text-emerald-400' : 'text-slate-400'}`} />
                                </button>

                                <AnimatePresence>
                                    {openSettingsSection === 'messaging_bots' && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="px-4 pb-4 pt-1 space-y-4 border-t border-slate-800/60"
                                        >
                                            {/* Baileys Backup WhatsApp Toggle */}
                                            <BaileysToggle />

                                            {/* Friday Telegram Bot Card */}
                                            <TelegramBotCard />

                                            {/* Friday Instagram Direct Bot Card */}
                                            <InstagramBotCard />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* ── 5. 🛡️ Security, OSINT & Permissions ── */}
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden transition-all">
                                <button
                                    onClick={() => toggleSettingsSection('security_osint')}
                                    className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/40 transition-colors select-none"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
                                            <ShieldCheck className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-white">Security, OSINT & Permissions</h4>
                                            <p className="text-[11px] text-slate-400">Device permissions, system access & network radar</p>
                                        </div>
                                    </div>
                                    <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${openSettingsSection === 'security_osint' ? 'rotate-180 text-blue-400' : 'text-slate-400'}`} />
                                </button>

                                <AnimatePresence>
                                    {openSettingsSection === 'security_osint' && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="px-4 pb-4 pt-1 space-y-4 border-t border-slate-800/60"
                                        >
                                            {/* Friday App Access & Device Permissions Manager */}
                                            <AppAccessSection />

                                            {/* Friday Cyber Security & OSINT Suite Card */}
                                            <CyberSecurityCard />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {showChatHistory && <ChatHistoryModal onClose={() => setShowChatHistory(false)} />}
            {showCodeAgent && <CodeAgentPage onClose={() => setShowCodeAgent(false)} />}
            {showWebCrawler && <WebCrawlerStudioModal onClose={() => setShowWebCrawler(false)} />}
            <YouTubeStudioModal isOpen={showYouTubeStudio} onClose={() => setShowYouTubeStudio(false)} />
            <WhatsAppPairModal isOpen={showWhatsAppModal} onClose={() => setShowWhatsAppModal(false)} />
            {showBackupModal && <MemoryBackupModal onClose={() => setShowBackupModal(false)} />}
            {showWifiRadar && <WifiRadarModal onClose={() => setShowWifiRadar(false)} />}

            {/* Deep Research Report Modal */}
            <AnimatePresence>
                {researchReport && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.95, y: 20 }}
                            className="w-full max-w-3xl max-h-[85vh] bg-slate-900 border border-purple-500/50 rounded-3xl p-6 shadow-[0_0_50px_rgba(168,85,247,0.35)] flex flex-col gap-4 overflow-hidden"
                        >
                            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">🧠</span>
                                    <h3 className="text-lg font-bold text-white">Deep Research Report: {researchReport.topic}</h3>
                                </div>
                                <button
                                    onClick={() => setResearchReport(null)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto pr-2 space-y-4 text-sm text-slate-200 leading-relaxed">
                                <div className="p-4 rounded-2xl bg-purple-950/40 border border-purple-500/30 text-purple-200">
                                    <p className="font-bold text-xs uppercase text-purple-400 mb-1">📌 Executive Summary</p>
                                    <p>{researchReport.executiveSummary}</p>
                                </div>
                                {researchReport.sections?.map((sec: any, idx: number) => (
                                    <div key={idx} className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700/50">
                                        <h4 className="font-bold text-white mb-2">{sec.title}</h4>
                                        <p className="text-slate-300 mb-2">{sec.content}</p>
                                        {sec.bulletPoints && (
                                            <ul className="list-disc list-inside space-y-1 text-slate-400 text-xs pl-2">
                                                {sec.bulletPoints.map((bp: string, i: number) => (
                                                    <li key={i}>{bp}</li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                ))}
                                {researchReport.keyTakeaways && (
                                    <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-200">
                                        <p className="font-bold text-xs uppercase text-emerald-400 mb-1">🎯 Key Takeaways</p>
                                        <ul className="list-disc list-inside space-y-1 text-xs">
                                            {researchReport.keyTakeaways.map((kt: string, i: number) => (
                                                <li key={i}>{kt}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Floating Futuristic Music Capsule Widget (Only shown when expanded by user) */}
            {isMusicPlayerExpanded && (
                <MusicCapsule
                    nowPlaying={nowPlayingMusic ? {
                        trackName: nowPlayingMusic.trackName,
                        artistName: nowPlayingMusic.artistName || 'Artist',
                        albumName: nowPlayingMusic.albumName,
                        albumArt: nowPlayingMusic.albumArt,
                        isPlaying: !!nowPlayingMusic.isPlaying,
                        quality: nowPlayingMusic.quality,
                        audioUrl: nowPlayingMusic.audioUrl,
                        songId: nowPlayingMusic.songId,
                        hasLyrics: nowPlayingMusic.hasLyrics,
                    } : null}
                    currentTime={musicCurrentTime}
                    duration={musicDuration}
                    queue={musicQueue}
                    eqPreset={musicEqPreset}
                    onPlayPause={toggleMusicPlayPause}
                    onStop={stopMusicPlayback}
                    onMinimize={() => setIsMusicPlayerExpanded(false)}
                    onSeek={seekToMusic}
                    onSeekRelative={seekRelativeMusic}
                    onRestart={restartMusic}
                    onNextTrack={playNextQueueSong}
                    onPreviousTrack={playPrevQueueSong}
                    onSelectEqPreset={applyEqPreset}
                    onPlayQueueSong={(qSong) => {
                        playDirectSong({
                            trackName: qSong.songName,
                            artistName: qSong.artistName,
                            albumName: qSong.albumName,
                            albumArt: qSong.albumArt500,
                            audioUrl: qSong.audio320kbps,
                            isJioSaavn: true,
                            isFullSong: true,
                            quality: "JioSaavn 320kbps Ultra-HD",
                            songId: qSong.id,
                        });
                    }}
                    onVolumeChange={(vol) => {
                        if (musicAudioRef.current) {
                            musicAudioRef.current.volume = vol;
                        }
                    }}
                />
            )}
            {/* Music Studio Modal (JioSaavn 320kbps Search & Play) */}
            <MusicStudioModal
                isOpen={showMusicStudio}
                onClose={() => setShowMusicStudio(false)}
                onPlaySong={playDirectSong}
                currentPlayingSongName={nowPlayingMusic?.trackName}
                isPlaying={nowPlayingMusic?.isPlaying}
            />

            {/* Song Disambiguation 30s Audio Preview Modal */}
            <SongPreviewModal
                isOpen={showSongPreviewModal}
                query={previewQuery}
                candidates={previewCandidates}
                currentIndex={activePreviewIndex}
                onClose={() => setShowSongPreviewModal(false)}
                onNextPreview={() => setActivePreviewIndex(prev => (previewCandidates.length > 0 ? (prev + 1) % previewCandidates.length : 0))}
                onPrevPreview={() => setActivePreviewIndex(prev => (previewCandidates.length > 0 ? (prev - 1 + previewCandidates.length) % previewCandidates.length : 0))}
                onSelectCandidate={playConfirmedCandidate}
            />
        </div>
    );
}