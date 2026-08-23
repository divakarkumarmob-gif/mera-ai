import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trash2, Loader2 } from 'lucide-react';
import { getApiUrl } from '@/utils/api';

interface HistoryMessage {
    id: number;
    sender: 'user' | 'ai';
    text: string;
    timestamp: number;
}

export default function ChatHistoryModal({ onClose }: { onClose: () => void }) {
    const [messages, setMessages] = useState<HistoryMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [clearing, setClearing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    const PAGE_SIZE = 50;

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch(getApiUrl(`/api/history?limit=${PAGE_SIZE}`));
            const data = await res.json();
            const batch = data.messages || [];
            setMessages(batch);
            setHasMore(batch.length === PAGE_SIZE);
        } catch (e) {
            console.error('Failed to load history:', e);
        } finally {
            setLoading(false);
        }
    };

    // Fetches only the next older batch (oldest currently-loaded message's
    // timestamp as the cursor) — not the whole history — so this stays fast
    // even as chat history grows.
    const loadMore = async () => {
        if (messages.length === 0 || loadingMore) return;
        setLoadingMore(true);
        try {
            const oldestTimestamp = messages[0].timestamp;
            const res = await fetch(getApiUrl(`/api/history?limit=${PAGE_SIZE}&before=${oldestTimestamp}`));
            const data = await res.json();
            const olderBatch: HistoryMessage[] = data.messages || [];
            setMessages((prev) => [...olderBatch, ...prev]);
            setHasMore(olderBatch.length === PAGE_SIZE);
        } catch (e) {
            console.error('Failed to load older history:', e);
        } finally {
            setLoadingMore(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const handleClear = async () => {
        setClearing(true);
        try {
            await fetch(getApiUrl('/api/history/clear'), { method: 'POST' });
            setMessages([]);
            setHasMore(false);
        } catch (e) {
            console.error('Failed to clear history:', e);
        } finally {
            setClearing(false);
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
                    className="relative bg-[#0a0f24] border border-purple-500/30 rounded-3xl w-full max-w-md h-[70vh] flex flex-col overflow-hidden shadow-[0_0_50px_rgba(139,92,246,0.3)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                        <h2 className="text-white font-bold text-lg">Chat History</h2>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleClear}
                                disabled={clearing || messages.length === 0}
                                className="text-slate-400 hover:text-red-400 transition-colors disabled:opacity-30"
                                title="Clear history"
                            >
                                {clearing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                            </button>
                            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                        {loading ? (
                            <div className="flex items-center justify-center h-full text-slate-500">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                        ) : messages.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-slate-500 text-sm text-center px-6">
                                No conversation yet. Start talking to the AI and it'll show up here.
                            </div>
                        ) : (
                            <>
                                {hasMore && (
                                    <div className="flex justify-center pb-2">
                                        <button
                                            onClick={loadMore}
                                            disabled={loadingMore}
                                            className="text-xs text-purple-300 hover:text-purple-200 disabled:opacity-40 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-purple-500/20 hover:border-purple-500/40 transition-colors"
                                        >
                                            {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                            {loadingMore ? 'Loading...' : 'Load older messages'}
                                        </button>
                                    </div>
                                )}
                                {messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm leading-relaxed ${
                                        msg.sender === 'ai'
                                            ? 'bg-purple-500/15 border border-purple-500/20 text-slate-100 mr-auto'
                                            : 'bg-blue-500/15 border border-blue-500/20 text-slate-100 ml-auto'
                                    }`}
                                >
                                    {msg.text}
                                    <div className="text-[10px] text-slate-500 mt-1">
                                        {new Date(msg.timestamp).toLocaleString()}
                                    </div>
                                </div>
                                ))}
                            </>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
