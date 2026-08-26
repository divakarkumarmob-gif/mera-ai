import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
    Square,
    Eye,
    Undo2,
    Sparkles,
    FileCode,
    Copy,
    Send,
    Trash2,
    CheckSquare
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

export interface GeneratedFileChange {
    path: string;
    action: 'modify' | 'create';
    originalContent?: string;
    content: string;
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
    generatedChanges?: GeneratedFileChange[];
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

// ── Line Diff Computations ──────────────────────────────────────────────────
interface DiffLine {
    type: 'add' | 'del' | 'same';
    oldLineNo?: number;
    newLineNo?: number;
    content: string;
}

function computeSimpleDiff(oldText: string = '', newText: string = ''): { lines: DiffLine[]; additions: number; deletions: number } {
    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newText ? newText.split('\n') : [];
    const lines: DiffLine[] = [];
    let additions = 0;
    let deletions = 0;

    let i = 0;
    let j = 0;
    let oldNum = 1;
    let newNum = 1;

    while (i < oldLines.length || j < newLines.length) {
        if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
            lines.push({ type: 'same', oldLineNo: oldNum++, newLineNo: newNum++, content: oldLines[i] });
            i++;
            j++;
        } else {
            if (i < oldLines.length && (!newLines.includes(oldLines[i]) || newLines.indexOf(oldLines[i]) > j + 4)) {
                lines.push({ type: 'del', oldLineNo: oldNum++, content: oldLines[i] });
                deletions++;
                i++;
            } else if (j < newLines.length) {
                lines.push({ type: 'add', newLineNo: newNum++, content: newLines[j] });
                additions++;
                j++;
            } else if (i < oldLines.length) {
                lines.push({ type: 'del', oldLineNo: oldNum++, content: oldLines[i] });
                deletions++;
                i++;
            }
        }
    }

    return { lines, additions, deletions };
}

export default function CodeAgentPage({ onClose }: { onClose: () => void }) {
    const [requests, setRequests] = useState<CodeAgentRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [instruction, setInstruction] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [actingOn, setActingOn] = useState<string | null>(null);
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const [selectedLogReqId, setSelectedLogReqId] = useState<string | null>(null);

    // Visual Diff Preview State
    const [viewingDiffReq, setViewingDiffReq] = useState<CodeAgentRequest | null>(null);
    const [activeDiffFileIdx, setActiveDiffFileIdx] = useState<number>(0);
    const [loadingDiff, setLoadingDiff] = useState<boolean>(false);
    const [copiedFile, setCopiedFile] = useState<boolean>(false);

    // Multi-turn Plan Refinement State
    const [refiningReqId, setRefiningReqId] = useState<string | null>(null);
    const [refineText, setRefineText] = useState<string>('');
    const [isRefining, setIsRefining] = useState<boolean>(false);

    // 1-Click Rollback State
    const [isRollingBack, setIsRollingBack] = useState<boolean>(false);
    const [rollbackMsg, setRollbackMsg] = useState<string | null>(null);

    // Task History Management & Selection State
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState<boolean>(false);

    // Derived active log request - cleanly updates on every poll, never gets stuck in closures
    const viewingLogReq = requests.find((r) => r.id === selectedLogReqId) || null;

    const load = useCallback(async () => {
        try {
            const res = await fetch(getApiUrl('/api/code-agent/requests'));
            const data = await res.json();
            const list: CodeAgentRequest[] = data.requests || [];
            setRequests(list);

            // Keep viewingDiffReq synced with live data
            if (viewingDiffReq) {
                const found = list.find((item) => item.id === viewingDiffReq.id);
                if (found && found.generatedChanges) {
                    setViewingDiffReq(found);
                }
            }
        } catch (e) {
            console.error('Failed to load code agent requests:', e);
        } finally {
            setLoading(false);
        }
    }, [viewingDiffReq]);

    useEffect(() => {
        load();
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
            if (viewingDiffReq && viewingDiffReq.id === id && action === 'deny') {
                setViewingDiffReq(null);
            }
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
            await fetch(getApiUrl(`/api/code-agent/requests/${id}/push-to-main`), { method: 'POST' });
            await load();
        } catch (e) {
            console.error('Failed to push to main origin:', e);
        } finally {
            setActingOn(null);
        }
    };

    // ── Feature 2: View Changes / Visual Diff Viewer ────────────────────────
    const handleOpenDiff = async (r: CodeAgentRequest, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setViewingDiffReq(r);
        setActiveDiffFileIdx(0);

        if (!r.generatedChanges || r.generatedChanges.length === 0) {
            setLoadingDiff(true);
            try {
                const res = await fetch(getApiUrl(`/api/code-agent/requests/${r.id}/diff`));
                const data = await res.json();
                if (data.changes) {
                    setViewingDiffReq({ ...r, generatedChanges: data.changes });
                }
                await load();
            } catch (err) {
                console.error('Failed to fetch diff:', err);
            } finally {
                setLoadingDiff(false);
            }
        }
    };

    // ── Feature 3: 1-Click Rollback ─────────────────────────────────────────
    const handleRollback = async () => {
        if (!window.confirm('Are you sure you want to rollback the last commit on origin/main?')) return;
        setIsRollingBack(true);
        setRollbackMsg(null);
        try {
            const res = await fetch(getApiUrl('/api/code-agent/rollback'), { method: 'POST' });
            const data = await res.json();
            if (data.ok) {
                setRollbackMsg(`✅ ${data.message || 'Rollback successful!'}`);
            } else {
                setRollbackMsg(`❌ Rollback failed: ${data.error || 'Unknown error'}`);
            }
            await load();
        } catch (err: any) {
            setRollbackMsg(`❌ Rollback error: ${err?.message || err}`);
        } finally {
            setIsRollingBack(false);
            setTimeout(() => setRollbackMsg(null), 5000);
        }
    };

    // ── Feature 4: Multi-Turn Plan Refinement ────────────────────────────────
    const handleRefinePlan = async (id: string) => {
        if (!refineText.trim() || isRefining) return;
        setIsRefining(true);
        try {
            await fetch(getApiUrl(`/api/code-agent/requests/${id}/refine`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ additionalInstruction: refineText.trim() }),
            });
            setRefineText('');
            setRefiningReqId(null);
            await load();
        } catch (err) {
            console.error('Failed to refine plan:', err);
        } finally {
            setIsRefining(false);
        }
    };

    // ── Feature: Task History Deletion Handlers ─────────────────────────────
    const toggleSelectTask = (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setSelectedTaskIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedTaskIds.size === requests.length && requests.length > 0) {
            setSelectedTaskIds(new Set());
        } else {
            setSelectedTaskIds(new Set(requests.map((r) => r.id)));
        }
    };

    const handleDeleteSingle = async (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (!window.confirm('Kya aap is task ko history se delete karna chahte hain?')) return;
        setIsDeleting(true);
        try {
            await fetch(getApiUrl(`/api/code-agent/history/${id}`), { method: 'DELETE' });
            setSelectedTaskIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            await load();
        } catch (err) {
            console.error('Failed to delete task:', err);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleBatchDelete = async () => {
        const ids = Array.from(selectedTaskIds);
        if (ids.length === 0) return;
        if (!window.confirm(`Kya aap selected ${ids.length} tasks ko delete karna chahte hain?`)) return;
        setIsDeleting(true);
        try {
            await fetch(getApiUrl('/api/code-agent/history/batch-delete'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
            });
            setSelectedTaskIds(new Set());
            await load();
        } catch (err) {
            console.error('Failed to batch delete tasks:', err);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleClearAllHistory = async (onlyInactive = false) => {
        const msg = onlyInactive
            ? 'Kya aap saare completed/cancelled tasks clean karna chahte hain?'
            : 'Kya aap poori task history delete karna chahte hain?';
        if (!window.confirm(msg)) return;
        setIsDeleting(true);
        try {
            await fetch(getApiUrl(`/api/code-agent/history?onlyInactive=${onlyInactive}`), { method: 'DELETE' });
            setSelectedTaskIds(new Set());
            await load();
        } catch (err) {
            console.error('Failed to clear history:', err);
        } finally {
            setIsDeleting(false);
        }
    };

    // Active file diff calculation for modal
    const activeFileDiff = useMemo(() => {
        if (!viewingDiffReq?.generatedChanges || viewingDiffReq.generatedChanges.length === 0) return null;
        const currentFile = viewingDiffReq.generatedChanges[activeDiffFileIdx] || viewingDiffReq.generatedChanges[0];
        if (!currentFile) return null;
        return {
            file: currentFile,
            ...computeSimpleDiff(currentFile.originalContent || '', currentFile.content || ''),
        };
    }, [viewingDiffReq, activeDiffFileIdx]);

    const handleCopyContent = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedFile(true);
        setTimeout(() => setCopiedFile(false), 2000);
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-6"
                onClick={onClose}
            >
                <motion.div
                    initial={{ y: 40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 40, opacity: 0 }}
                    className="relative bg-[#0a0f24] border border-cyan-500/30 rounded-3xl w-full max-w-2xl h-[88vh] flex flex-col overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.25)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-slate-900/60">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                                <Code2 className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-white font-bold text-base leading-tight">Friday Coding Agent</h2>
                                <p className="text-[11px] text-slate-400">Autonomous codebase assistant & self-healing engine</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Autonomous Codebase Clean Action */}
                            <button
                                onClick={async () => {
                                    try {
                                        await fetch(getApiUrl('/api/code-agent/clean'), { method: 'POST' });
                                        await load();
                                    } catch (e) {
                                        console.error('Failed to start cleanup:', e);
                                    }
                                }}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-semibold transition-all active:scale-95"
                                title="Run autonomous codebase cleanup (remove dead code & optimize imports)"
                            >
                                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="hidden sm:inline">Clean</span>
                            </button>

                            {/* 1-Click Rollback Header Action */}
                            <button
                                onClick={handleRollback}
                                disabled={isRollingBack}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-300 hover:bg-purple-500/25 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                                title="Rollback / Undo latest commit on origin/main"
                            >
                                {isRollingBack ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                                <span>Rollback</span>
                            </button>

                            <button
                                onClick={onClose}
                                className="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Rollback notification banner if fired */}
                    {rollbackMsg && (
                        <div className="px-5 py-2 text-xs font-medium bg-purple-500/20 border-b border-purple-500/30 text-purple-200 flex items-center gap-2 animate-in fade-in">
                            <Info className="w-4 h-4 text-purple-300 shrink-0" />
                            <span>{rollbackMsg}</span>
                        </div>
                    )}

                    {/* Input box */}
                    <div className="px-5 py-3 border-b border-white/10 flex gap-2 bg-slate-950/40">
                        <input
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                            placeholder="e.g. Add dark mode toggle or fix YouTube audio stream timeout"
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                        />
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !instruction.trim()}
                            className="px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-semibold disabled:opacity-40 hover:bg-cyan-500/30 active:scale-95 transition-all flex items-center gap-1.5"
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
                            <div className="space-y-3">
                                {/* Task Management Toolbar */}
                                <div className="flex items-center justify-between pb-1 border-b border-white/5 text-xs text-slate-400">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={toggleSelectAll}
                                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-medium transition-colors"
                                        >
                                            <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                                            <span>{selectedTaskIds.size === requests.length ? 'Deselect All' : 'Select All'}</span>
                                        </button>
                                        <span className="text-[11px] text-slate-500">
                                            {requests.length} task{requests.length > 1 ? 's' : ''}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        {selectedTaskIds.size > 0 && (
                                            <button
                                                onClick={handleBatchDelete}
                                                disabled={isDeleting}
                                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 text-[11px] font-semibold transition-all"
                                            >
                                                <Trash2 className="w-3 h-3 text-red-400" />
                                                <span>Delete Selected ({selectedTaskIds.size})</span>
                                            </button>
                                        )}

                                        <button
                                            onClick={() => handleClearAllHistory(true)}
                                            disabled={isDeleting}
                                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/60 border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-[11px] transition-colors"
                                            title="Clear completed and cancelled tasks"
                                        >
                                            <Trash2 className="w-3 h-3 text-slate-400" />
                                            <span>Clean Inactive</span>
                                        </button>

                                        <button
                                            onClick={() => handleClearAllHistory(false)}
                                            disabled={isDeleting}
                                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-[11px] transition-colors"
                                            title="Clear all task history"
                                        >
                                            <span>Clear All</span>
                                        </button>
                                    </div>
                                </div>

                                {requests.map((r) => {
                                    const isSelected = selectedTaskIds.has(r.id);
                                    return (
                                        <div
                                            key={r.id}
                                            className={`rounded-2xl border p-4 space-y-3 shadow-sm transition-colors ${
                                                isSelected
                                                    ? 'border-cyan-500/50 bg-cyan-500/10'
                                                    : 'border-white/10 bg-white/5 hover:border-white/20'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                                                    {/* Selection Checkbox */}
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleSelectTask(r.id)}
                                                        className="mt-1 rounded bg-black/40 border-white/20 text-cyan-500 focus:ring-cyan-500/30 cursor-pointer"
                                                    />
                                                    <span className="text-sm text-white font-medium line-clamp-2">{r.instruction}</span>
                                                </div>

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

                                                    {/* Anticlockwise Retry Button */}
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

                                                    {/* Individual Delete Button */}
                                                    <button
                                                        onClick={(e) => handleDeleteSingle(r.id, e)}
                                                        disabled={isDeleting}
                                                        title="Delete task from history"
                                                        className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-red-400 hover:bg-red-500/15 hover:border-red-500/30 transition-colors"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
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
                                                <div className="flex items-center justify-between">
                                                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Affected Files:</p>
                                                    {/* FEATURE 2: VIEW CHANGES BUTTON */}
                                                    <button
                                                        onClick={(e) => handleOpenDiff(r, e)}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30 text-[11px] font-bold transition-all shadow-[0_0_10px_rgba(6,182,212,0.2)]"
                                                    >
                                                        <Eye className="w-3.5 h-3.5 text-cyan-400" />
                                                        <span>View Changes (Diff)</span>
                                                    </button>
                                                </div>
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

                                    {/* Multi-Turn Plan Refine Accordion (Feature 4) */}
                                    {r.status === 'pending_approval' && (
                                        <div className="pt-1">
                                            {refiningReqId === r.id ? (
                                                <div className="bg-slate-900/70 border border-purple-500/30 p-3 rounded-xl space-y-2 animate-in fade-in">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
                                                            <Sparkles className="w-3.5 h-3.5 text-purple-400" /> Refine Plan / Add Instruction
                                                        </span>
                                                        <button
                                                            onClick={() => setRefiningReqId(null)}
                                                            className="text-slate-400 hover:text-white text-[11px]"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <input
                                                            value={refineText}
                                                            onChange={(e) => setRefineText(e.target.value)}
                                                            onKeyDown={(e) => e.key === 'Enter' && handleRefinePlan(r.id)}
                                                            placeholder="e.g. Button ka color purple karo aur corner rounded rakho..."
                                                            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-purple-500/50"
                                                        />
                                                        <button
                                                            onClick={() => handleRefinePlan(r.id)}
                                                            disabled={isRefining || !refineText.trim()}
                                                            className="px-3 py-1.5 rounded-lg bg-purple-500/25 border border-purple-500/40 text-purple-200 text-xs font-semibold hover:bg-purple-500/35 disabled:opacity-40 flex items-center gap-1"
                                                        >
                                                            {isRefining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                                            Update
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setRefiningReqId(r.id)}
                                                    className="inline-flex items-center gap-1 text-[11px] text-purple-300 hover:text-purple-200 underline underline-offset-2"
                                                >
                                                    <Sparkles className="w-3 h-3" /> Plan me thoda aur change karna hai? (Refine)
                                                </button>
                                            )}
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
                                );
                            })}
                        </div>
                    )}
                </div>

                    {/* FEATURE 2: VISUAL CODE DIFF VIEWER MODAL */}
                    {viewingDiffReq && (
                        <div className="absolute inset-0 bg-[#070b19]/98 backdrop-blur-xl z-50 flex flex-col p-4 sm:p-5 animate-in fade-in zoom-in-95 duration-150">
                            {/* Diff Viewer Header */}
                            <div className="flex items-center justify-between pb-3 border-b border-white/10 gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <button
                                        onClick={() => setViewingDiffReq(null)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 hover:text-white text-xs font-semibold transition-all shrink-0 active:scale-95"
                                    >
                                        <ArrowLeft className="w-4 h-4 text-cyan-400" />
                                        <span>Back</span>
                                    </button>
                                    <div className="min-w-0">
                                        <h3 className="text-white font-bold text-sm flex items-center gap-2">
                                            <span>Visual Code Diff</span>
                                            {activeFileDiff && (
                                                <span className="text-[11px] font-mono font-normal text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                                    +{activeFileDiff.additions} / -{activeFileDiff.deletions} lines
                                                </span>
                                            )}
                                        </h3>
                                        <p className="text-[11px] text-slate-400 font-mono truncate">{viewingDiffReq.instruction}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {activeFileDiff && (
                                        <button
                                            onClick={() => handleCopyContent(activeFileDiff.file.content)}
                                            className="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white text-xs flex items-center gap-1"
                                            title="Copy full new file content"
                                        >
                                            {copiedFile ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                            <span className="text-[10px] hidden sm:inline">{copiedFile ? 'Copied' : 'Copy'}</span>
                                        </button>
                                    )}

                                    {/* Direct Approve from Diff View */}
                                    {viewingDiffReq.status === 'pending_approval' && (
                                        <button
                                            onClick={() => act(viewingDiffReq.id, 'approve')}
                                            disabled={actingOn === viewingDiffReq.id}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/30 transition-colors shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                                        >
                                            {actingOn === viewingDiffReq.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                            Approve & Apply
                                        </button>
                                    )}

                                    <button
                                        onClick={() => setViewingDiffReq(null)}
                                        className="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* File Switcher Tabs */}
                            {viewingDiffReq.generatedChanges && viewingDiffReq.generatedChanges.length > 0 && (
                                <div className="flex gap-2 py-2 overflow-x-auto border-b border-white/10">
                                    {viewingDiffReq.generatedChanges.map((file, idx) => (
                                        <button
                                            key={file.path}
                                            onClick={() => setActiveDiffFileIdx(idx)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-mono flex items-center gap-1.5 shrink-0 transition-all ${
                                                activeDiffFileIdx === idx
                                                    ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-200 font-bold'
                                                    : 'bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200'
                                            }`}
                                        >
                                            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                                            <span>{file.path.split('/').pop()}</span>
                                            <span className="text-[10px] text-slate-500">({file.path})</span>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Diff Code Container */}
                            <div className="flex-1 bg-black/60 border border-white/10 rounded-2xl mt-3 overflow-hidden flex flex-col font-mono text-xs">
                                {loadingDiff ? (
                                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
                                        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                                        <p>Generating visual diff preview...</p>
                                    </div>
                                ) : !activeFileDiff ? (
                                    <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-2">
                                        <FileCode className="w-8 h-8 text-slate-600" />
                                        <p>No preview generated yet. Click approve to apply changes.</p>
                                    </div>
                                ) : (
                                    <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-0.5 select-text">
                                        {activeFileDiff.lines.map((line, lIdx) => {
                                            const isAdd = line.type === 'add';
                                            const isDel = line.type === 'del';

                                            return (
                                                <div
                                                    key={lIdx}
                                                    className={`flex items-start gap-2 py-0.5 px-2 rounded ${
                                                        isAdd
                                                            ? 'bg-emerald-500/15 text-emerald-200 border-l-2 border-emerald-400'
                                                            : isDel
                                                            ? 'bg-red-500/15 text-red-300 border-l-2 border-red-400 opacity-80'
                                                            : 'text-slate-300 hover:bg-white/5'
                                                    }`}
                                                >
                                                    <span className="text-[10px] text-slate-600 select-none w-8 text-right shrink-0">
                                                        {isDel ? line.oldLineNo : isAdd ? line.newLineNo : line.newLineNo}
                                                    </span>
                                                    <span className="text-[11px] font-bold select-none w-3 text-center shrink-0">
                                                        {isAdd ? '+' : isDel ? '-' : ' '}
                                                    </span>
                                                    <pre className="flex-1 whitespace-pre-wrap break-all font-mono leading-tight">
                                                        {line.content || ' '}
                                                    </pre>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

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
