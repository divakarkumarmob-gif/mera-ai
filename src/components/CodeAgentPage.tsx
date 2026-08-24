import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
    X,
    Loader2,
    Check,
    Ban,
    ExternalLink,
    Code2,
    GitBranch,
    UploadCloud,
    CheckCheck,
    RotateCcw,
    Terminal,
    AlertCircle,
    Info,
    CheckCircle2,
    Clock,
    ArrowLeft,
    Square
} from 'lucide-react';
import { getApiUrl } from '@/utils/api';

interface FilePlanItem {
    path: string;
    action: 'modify' | 'create';
    changeSummary: string;
}

interface CodeAgentPlan {
    diagnosis?: string;
    summary: string;
    files: FilePlanItem[];
}

export interface CodeAgentLog {
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
    stage?: string;
}

interface CodeAgentRequest {
    id: string;
    instruction: string;
    status: 'analyzing' | 'pending_approval' | 'approved' | 'denied' | 'applying' | 'completed' | 'failed';
    createdAt: number;
    plan?: CodeAgentPlan;
    branchUrl?: string;
    prUrl?: string;
    commitUrl?: string;
    pushedToMain?: boolean;
    error?: string;
    logs?: CodeAgentLog[];
}

const STATUS_LABEL: Record<CodeAgentRequest['status'], string> = {
    analyzing: 'Analyzing repo...',
    pending_approval: 'Waiting for your approval',
    approved: 'Approved — applying...',
    denied: 'Denied / Cancelled',
    applying: 'Writing changes...',
    completed: 'PR ready / Completed',
    failed: 'Failed',
};

const STATUS_COLOR: Record<CodeAgentRequest['status'], string> = {
    analyzing: 'text-blue-300 bg-blue-500/15 border-blue-500/30',
    pending_approval: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
    approved: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30',
    denied: 'text-slate-400 bg-slate-500/15 border-slate-500/30',
    applying: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30',
    completed: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
    failed: 'text-red-300 bg-red-500/15 border-red-500/30',
};

export default function CodeAgentPage({ onClose }: { onClose: () => void }) {
    const [requests, setRequests] = useState<CodeAgentRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [instruction, setInstruction] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [actingOn, setActingOn] = useState<string | null>(null);
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const [selectedLogReqId, setSelectedLogReqId] = useState<string | null>(null);

    // Derived active log request - cleanly updates on every poll, never gets stuck in closures
    const viewingLogReq = requests.find((r) => r.id === selectedLogReqId) || null;

    const load = useCallback(async () => {
        try {
            const res = await fetch(getApiUrl('/api/code-agent/requests'));
            const data = await res.json();
            setRequests(data.requests || []);
        } catch (e) {
            console.error('Failed to load code agent requests:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        // Poll every 3s for background status & live logs
        const interval = setInterval(load, 3000);
        return () => clearInterval(interval);
    }, [load]);

    const handleSubmit = async () => {
        if (!instruction.trim() || submitting) return;
        setSubmitting(true);
        try {
            await fetch(getApiUrl('/api/code-agent/requests'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instruction: instruction.trim() }),
            });
            setInstruction('');
            await load();
        } catch (e) {
            console.error('Failed to submit request:', e);
        } finally {
            setSubmitting(false);
        }
    };

    const handleRetry = async (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setRetryingId(id);
        try {
            await fetch(getApiUrl(`/api/code-agent/requests/${id}/retry`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            await load();
        } catch (err) {
            console.error('Failed to retry request:', err);
        } finally {
            setRetryingId(null);
        }
    };

    const handleStop = async (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setActingOn(`${id}_stop`);
        try {
            await fetch(getApiUrl(`/api/code-agent/requests/${id}/stop`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            await load();
        } catch (err) {
            console.error('Failed to stop request:', err);
        } finally {
            setActingOn(null);
        }
    };

    const act = async (id: string, action: 'approve' | 'deny') => {
        setActingOn(id);
        try {
            await fetch(getApiUrl(`/api/code-agent/requests/${id}/${action}`), { method: 'POST' });
            await load();
        } catch (e) {
            console.error(`Failed to ${action} request:`, e);
        } finally {
            setActingOn(null);
        }
    };

    const pushToMain = async (id: string) => {
        setActingOn(`${id}_push`);
        try {
            const res = await fetch(getApiUrl(`/api/code-agent/requests/${id}/push-to-main`), { method: 'POST' });
            const data = await res.json();
            if (!res.ok || data.error) {
                alert(`Push failed: ${data.error || 'Unknown error'}`);
            }
            await load();
        } catch (e: any) {
            console.error('Failed to push to main origin:', e);
            alert(`Push failed: ${e?.message || e}`);
        } finally {
            setActingOn(null);
        }
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/80 backdrop-blur-md z-[3000] flex items-end sm:items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ y: 40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 40, opacity: 0 }}
                    className="relative bg-[#0a0f24] border border-cyan-500/30 rounded-3xl w-full max-w-xl h-[85vh] flex flex-col overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.25)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-900/50">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                                <Code2 className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-white font-bold text-base leading-tight">Friday Coding Agent</h2>
                                <p className="text-[11px] text-slate-400">AI codebase assistant with diagnostics, live logs & retry</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Input box */}
                    <div className="px-5 py-3 border-b border-white/10 flex gap-2 bg-slate-950/40">
                        <input
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                            placeholder="e.g. Add dark mode toggle or fix WhatsApp timeout bug"
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                        />
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !instruction.trim()}
                            className="px-5 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-semibold disabled:opacity-40 hover:bg-cyan-500/30 active:scale-95 transition-all flex items-center gap-1.5"
                        >
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send'}
                        </button>
                    </div>

                    {/* Requests list */}
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                        {loading ? (
                            <div className="flex items-center justify-center h-full text-slate-500">
                                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                            </div>
                        ) : requests.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm text-center px-6 gap-2">
                                <Code2 className="w-10 h-10 text-slate-600" />
                                <p>No code change requests yet.</p>
                                <p className="text-xs text-slate-600">Ask Friday via voice or type your instructions above.</p>
                            </div>
                        ) : (
                            requests.map((r) => (
                                <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3 shadow-sm hover:border-white/20 transition-colors">
                                    <div className="flex items-start justify-between gap-3">
                                        <span className="text-sm text-white font-medium line-clamp-2">{r.instruction}</span>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {/* Status Badge */}
                                            <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${STATUS_COLOR[r.status]}`}>
                                                {STATUS_LABEL[r.status]}
                                            </span>

                                            {/* Stop Button (if task is active/running) */}
                                            {(r.status === 'analyzing' || r.status === 'applying' || r.status === 'pending_approval') && (
                                                <button
                                                    onClick={(e) => handleStop(r.id, e)}
                                                    disabled={actingOn === `${r.id}_stop`}
                                                    title="Stop / Cancel this task"
                                                    className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors flex items-center gap-1 text-[11px] font-medium"
                                                >
                                                    <Square className="w-3.5 h-3.5 text-red-400 fill-red-400/20" />
                                                    <span className="text-[10px]">Stop</span>
                                                </button>
                                            )}

                                            {/* Anticlockwise Retry Button (especially on Failed or anytime) */}
                                            <button
                                                onClick={(e) => handleRetry(r.id, e)}
                                                disabled={retryingId === r.id}
                                                title="Retry this coding task (Anticlockwise rerun)"
                                                className={`p-1.5 rounded-lg border transition-all ${
                                                    r.status === 'failed'
                                                        ? 'bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30 animate-pulse'
                                                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/15 hover:border-cyan-500/30'
                                                }`}
                                            >
                                                <RotateCcw className={`w-3.5 h-3.5 ${retryingId === r.id ? 'animate-spin' : ''}`} />
                                            </button>

                                            {/* Log Icon Button */}
                                            <button
                                                onClick={() => setSelectedLogReqId(r.id)}
                                                title="View Execution Steps & Live Diagnostics Log"
                                                className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition-colors flex items-center gap-1 text-[11px] font-medium"
                                            >
                                                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                                                <span className="text-[10px]">Log</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Plan / Root Cause */}
                                    {r.plan && (
                                        <div className="text-xs text-slate-300 space-y-2 bg-black/20 p-3 rounded-xl border border-white/5">
                                            {r.plan.diagnosis && (
                                                <p className="text-slate-300 leading-relaxed">
                                                    <span className="text-cyan-400 font-semibold">Diagnosis:</span> {r.plan.diagnosis}
                                                </p>
                                            )}
                                            <p className="text-slate-300 leading-relaxed">{r.plan.summary}</p>
                                            <div className="space-y-1.5 pt-1">
                                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Affected Files:</p>
                                                <ul className="space-y-1 pl-1">
                                                    {r.plan.files.map((f) => (
                                                        <li key={f.path} className="text-slate-300 text-xs flex items-start gap-1.5">
                                                            <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${f.action === 'create' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'}`}>
                                                                [{f.action}]
                                                            </span>
                                                            <span className="font-mono text-cyan-200">{f.path}</span>
                                                            <span className="text-slate-400">— {f.changeSummary}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    )}

                                    {/* Error Banner with Direct Retry Action */}
                                    {r.error && (
                                        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 p-3 rounded-xl flex items-start justify-between gap-2">
                                            <div className="flex items-start gap-2">
                                                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                                <div>
                                                    <span className="font-semibold text-red-200">Execution Error: </span>
                                                    <span>{r.error}</span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => handleRetry(r.id, e)}
                                                disabled={retryingId === r.id}
                                                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 text-[11px] font-semibold transition-colors"
                                            >
                                                <RotateCcw className={`w-3 h-3 ${retryingId === r.id ? 'animate-spin' : ''}`} />
                                                Retry
                                            </button>
                                        </div>
                                    )}

                                    {/* Action buttons */}
                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                        {/* Pending Approval -> Yes / No Buttons */}
                                        {r.status === 'pending_approval' && (
                                            <>
                                                <button
                                                    onClick={() => act(r.id, 'approve')}
                                                    disabled={actingOn === r.id}
                                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold disabled:opacity-40 hover:bg-emerald-500/30 active:scale-95 transition-all shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                                                >
                                                    {actingOn === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                                    Approve (Yes)
                                                </button>
                                                <button
                                                    onClick={() => act(r.id, 'deny')}
                                                    disabled={actingOn === r.id}
                                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-semibold disabled:opacity-40 hover:bg-red-500/30 active:scale-95 transition-all"
                                                >
                                                    <Ban className="w-3.5 h-3.5" /> Deny (No)
                                                </button>
                                            </>
                                        )}

                                        {/* Applying State Spinner & Stop */}
                                        {r.status === 'applying' && (
                                            <div className="flex items-center gap-2 text-xs text-cyan-300 bg-cyan-500/10 px-3 py-1.5 rounded-xl border border-cyan-500/20">
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Writing code & pushing to GitHub...
                                            </div>
                                        )}

                                        {/* Approved or Completed -> Direct Push to Main Button */}
                                        {(r.status === 'completed' || r.branchUrl) && (
                                            <>
                                                {r.pushedToMain ? (
                                                    <div className="flex items-center gap-2">
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
                                                            <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> Committed to Main Origin
                                                        </span>
                                                        {r.commitUrl && (
                                                            <a
                                                                href={r.commitUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                                                            >
                                                                View Commit <ExternalLink className="w-3 h-3" />
                                                            </a>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => pushToMain(r.id)}
                                                        disabled={actingOn === `${r.id}_push`}
                                                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600/30 to-blue-600/30 border border-cyan-500/50 text-cyan-200 text-xs font-bold hover:from-cyan-600/50 hover:to-blue-600/50 hover:border-cyan-400 active:scale-95 transition-all shadow-[0_0_20px_rgba(6,182,212,0.25)]"
                                                    >
                                                        {actingOn === `${r.id}_push` ? (
                                                            <>
                                                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pushing to Main Origin...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <UploadCloud className="w-3.5 h-3.5 text-cyan-400" /> Push to Main Origin
                                                            </>
                                                        )}
                                                    </button>
                                                )}
                                            </>
                                        )}

                                        {/* Pull Request Link */}
                                        {r.prUrl && (
                                            <a
                                                href={r.prUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-300 transition-colors ml-auto"
                                            >
                                                <GitBranch className="w-3 h-3" /> View PR <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Live Execution Logs & Diagnostics Modal */}
                    {viewingLogReq && (
                        <div className="absolute inset-0 bg-[#070b19]/95 backdrop-blur-lg z-50 flex flex-col p-5 animate-in fade-in zoom-in-95 duration-150">
                            {/* Modal Header */}
                            <div className="flex items-center justify-between pb-3 border-b border-white/10 gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    {/* Prominent Back Button to Return to Tasks List */}
                                    <button
                                        onClick={() => setSelectedLogReqId(null)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 hover:text-white text-xs font-semibold transition-all shrink-0 active:scale-95"
                                        title="Back to previous Tasks page"
                                    >
                                        <ArrowLeft className="w-4 h-4 text-cyan-400" />
                                        <span>Back to Tasks</span>
                                    </button>

                                    <div className="min-w-0">
                                        <h3 className="text-white font-bold text-sm leading-tight">Execution Log & Diagnostics</h3>
                                        <p className="text-[11px] text-slate-400 font-mono truncate">{viewingLogReq.instruction}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {/* Stop Task Button (when task is active) */}
                                    {(viewingLogReq.status === 'analyzing' || viewingLogReq.status === 'applying' || viewingLogReq.status === 'pending_approval') && (
                                        <button
                                            onClick={(e) => handleStop(viewingLogReq.id, e)}
                                            disabled={actingOn === `${viewingLogReq.id}_stop`}
                                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 text-xs font-semibold transition-colors"
                                            title="Stop / Cancel this running task"
                                        >
                                            <Square className="w-3.5 h-3.5 fill-red-400/20" />
                                            <span>Stop</span>
                                        </button>
                                    )}

                                    {/* Retry Button */}
                                    <button
                                        onClick={(e) => handleRetry(viewingLogReq.id, e)}
                                        disabled={retryingId === viewingLogReq.id}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30 transition-colors"
                                        title="Rerun this task from scratch"
                                    >
                                        <RotateCcw className={`w-3.5 h-3.5 ${retryingId === viewingLogReq.id ? 'animate-spin' : ''}`} />
                                        <span>Retry</span>
                                    </button>

                                    {/* Close Log Button */}
                                    <button
                                        onClick={() => setSelectedLogReqId(null)}
                                        className="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white"
                                        title="Close Log View"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Status & Error Overview */}
                            <div className="py-3 flex flex-wrap items-center gap-3">
                                <span className={`text-[11px] font-semibold px-3 py-1 rounded-full border ${STATUS_COLOR[viewingLogReq.status]}`}>
                                    Status: {STATUS_LABEL[viewingLogReq.status]}
                                </span>
                                <span className="text-[11px] text-slate-400 font-mono">
                                    ID: {viewingLogReq.id}
                                </span>
                            </div>

                            {viewingLogReq.error && (
                                <div className="mb-3 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-bold text-red-300">Failure Diagnostic:</p>
                                        <p className="font-mono text-[11px] mt-0.5">{viewingLogReq.error}</p>
                                    </div>
                                </div>
                            )}

                            {/* Log Stream Container */}
                            <div className="flex-1 bg-black/50 border border-white/10 rounded-2xl p-4 overflow-y-auto font-mono text-xs space-y-2.5">
                                {(!viewingLogReq.logs || viewingLogReq.logs.length === 0) ? (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
                                        <Clock className="w-6 h-6 animate-pulse text-slate-600" />
                                        <p>Listening for execution steps...</p>
                                    </div>
                                ) : (
                                    viewingLogReq.logs.map((log, idx) => {
                                        const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                        const isError = log.level === 'error';
                                        const isWarn = log.level === 'warn';
                                        const isSuccess = log.level === 'success';

                                        return (
                                            <div
                                                key={idx}
                                                className={`flex items-start gap-2.5 p-2 rounded-lg border ${
                                                    isError
                                                        ? 'bg-red-500/10 border-red-500/20 text-red-300'
                                                        : isWarn
                                                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                                                        : isSuccess
                                                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                                        : 'bg-white/5 border-white/5 text-slate-300'
                                                }`}
                                            >
                                                <span className="text-[10px] text-slate-500 shrink-0 mt-0.5">{timeStr}</span>
                                                {isError ? (
                                                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                                                ) : isSuccess ? (
                                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                                ) : isWarn ? (
                                                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                                                ) : (
                                                    <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                                                )}
                                                <div className="flex-1">
                                                    {log.stage && (
                                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/40 text-cyan-400 mr-2 border border-white/5">
                                                            [{log.stage}]
                                                        </span>
                                                    )}
                                                    <span className="leading-relaxed break-words">{log.message}</span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}


