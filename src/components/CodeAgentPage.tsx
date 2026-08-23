import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Check, Ban, ExternalLink, Code2, GitBranch, GitCommit, UploadCloud, CheckCheck } from 'lucide-react';
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
}

const STATUS_LABEL: Record<CodeAgentRequest['status'], string> = {
    analyzing: 'Analyzing repo...',
    pending_approval: 'Waiting for your approval',
    approved: 'Approved — applying...',
    denied: 'Denied',
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
        // Poll every 4s for background status updates
        const interval = setInterval(load, 4000);
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
                                <p className="text-[11px] text-slate-400">AI codebase assistant with approval & direct main push</p>
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
                                        <span className={`shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full border ${STATUS_COLOR[r.status]}`}>
                                            {STATUS_LABEL[r.status]}
                                        </span>
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

                                    {r.error && (
                                        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-2.5 rounded-xl">
                                            ⚠️ {r.error}
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

                                        {/* Applying State Spinner */}
                                        {r.status === 'applying' && (
                                            <div className="flex items-center gap-2 text-xs text-cyan-300 bg-cyan-500/10 px-3 py-1.5 rounded-xl border border-cyan-500/20">
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating code & creating branch...
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
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}

