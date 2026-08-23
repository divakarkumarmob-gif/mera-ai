import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Check, Ban, ExternalLink, Code2 } from 'lucide-react';
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
    error?: string;
}

const STATUS_LABEL: Record<CodeAgentRequest['status'], string> = {
    analyzing: 'Analyzing repo...',
    pending_approval: 'Waiting for your approval',
    approved: 'Approved — applying...',
    denied: 'Denied',
    applying: 'Writing changes...',
    completed: 'PR ready for review',
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
        // Poll every 5s — most requests involve background LLM calls, so a
        // live push isn't worth the complexity here.
        const interval = setInterval(load, 5000);
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
                    className="relative bg-[#0a0f24] border border-cyan-500/30 rounded-3xl w-full max-w-lg h-[80vh] flex flex-col overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.25)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                        <h2 className="text-white font-bold text-lg flex items-center gap-2">
                            <Code2 className="w-5 h-5 text-cyan-400" /> Coding Agent
                        </h2>
                        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="px-5 py-3 border-b border-white/10 flex gap-2">
                        <input
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                            placeholder="e.g. Add dark mode toggle to settings"
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500/50"
                        />
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !instruction.trim()}
                            className="px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-semibold disabled:opacity-40 hover:bg-cyan-500/30 transition-colors"
                        >
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send'}
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                        {loading ? (
                            <div className="flex items-center justify-center h-full text-slate-500">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                        ) : requests.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-slate-500 text-sm text-center px-6">
                                No code change requests yet. Ask Friday to add a feature or fix a bug, or type one above.
                            </div>
                        ) : (
                            requests.map((r) => (
                                <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm text-white font-medium line-clamp-2">{r.instruction}</span>
                                        <span className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full border ${STATUS_COLOR[r.status]}`}>
                                            {STATUS_LABEL[r.status]}
                                        </span>
                                    </div>

                                    {r.plan && (
                                        <div className="text-xs text-slate-300 space-y-1.5">
                                            {r.plan.diagnosis && (
                                                <p><span className="text-slate-500">Root cause:</span> {r.plan.diagnosis}</p>
                                            )}
                                            <p>{r.plan.summary}</p>
                                            <ul className="space-y-1 pl-1">
                                                {r.plan.files.map((f) => (
                                                    <li key={f.path} className="text-slate-400">
                                                        <span className="text-cyan-400 font-mono">[{f.action}]</span> {f.path} — {f.changeSummary}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {r.error && <p className="text-xs text-red-400">{r.error}</p>}

                                    {r.status === 'pending_approval' && (
                                        <div className="flex gap-2 pt-1">
                                            <button
                                                onClick={() => act(r.id, 'approve')}
                                                disabled={actingOn === r.id}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold disabled:opacity-40 hover:bg-emerald-500/30 transition-colors"
                                            >
                                                <Check className="w-3.5 h-3.5" /> Approve
                                            </button>
                                            <button
                                                onClick={() => act(r.id, 'deny')}
                                                disabled={actingOn === r.id}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-semibold disabled:opacity-40 hover:bg-red-500/30 transition-colors"
                                            >
                                                <Ban className="w-3.5 h-3.5" /> Deny
                                            </button>
                                        </div>
                                    )}

                                    {r.prUrl && (
                                        <a
                                            href={r.prUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 pt-1"
                                        >
                                            View Pull Request <ExternalLink className="w-3 h-3" />
                                        </a>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
