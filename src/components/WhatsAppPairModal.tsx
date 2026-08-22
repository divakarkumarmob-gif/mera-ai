import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Phone, Copy, Check, Loader2, Smartphone, ShieldCheck, RefreshCw } from 'lucide-react';

interface WhatsAppPairModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function WhatsAppPairModal({ isOpen, onClose }: WhatsAppPairModalProps) {
    const [phone, setPhone] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [activePhone, setActivePhone] = useState<string | null>(null);

    // Poll status when modal is open
    useEffect(() => {
        if (!isOpen) return;

        const checkStatus = async () => {
            try {
                const res = await fetch('/api/whatsapp/status');
                const data = await res.json();
                setIsConnected(data.isConnected);
                if (data.dedicatedPhone) setActivePhone(data.dedicatedPhone);
                if (data.pairingCode && !pairingCode) setPairingCode(data.pairingCode);
            } catch {}
        };

        checkStatus();
        const interval = setInterval(checkStatus, 3000);
        return () => clearInterval(interval);
    }, [isOpen, pairingCode]);

    const handleGenerateCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setPairingCode(null);

        const cleanPhone = phone.replace(/[\s\-\(\)\+]/g, '').trim();
        if (cleanPhone.length < 10) {
            setError("Kripya valid 10-digit phone number enter karein.");
            return;
        }

        setIsLoading(true);
        try {
            const res = await fetch('/api/whatsapp/pair', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: cleanPhone }),
            });
            const data = await res.json();

            if (data.ok && data.pairingCode) {
                if (data.pairingCode === "ALREADY_CONNECTED") {
                    setIsConnected(true);
                } else {
                    setPairingCode(data.pairingCode);
                }
            } else {
                setError(data.error || "Pairing code generate karne mein error aaya. Kripya number check karein.");
            }
        } catch (err: any) {
            setError(err?.message || "Server se connect nahi ho paya.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = () => {
        if (!pairingCode) return;
        navigator.clipboard.writeText(pairingCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    className="relative w-full max-w-md rounded-3xl bg-slate-900/95 border border-emerald-500/40 p-6 shadow-[0_0_50px_rgba(16,185,129,0.25)] text-white flex flex-col gap-5 overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xl shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                                📲
                            </div>
                            <div>
                                <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                                    WhatsApp Link Assistant
                                    {isConnected && (
                                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 px-2 py-0.5 rounded-full font-medium">
                                            Connected
                                        </span>
                                    )}
                                </h2>
                                <p className="text-xs text-slate-400">Apna spare number link karein (Zero QR Needed)</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Connected State Banner */}
                    {isConnected ? (
                        <div className="p-4 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 flex flex-col items-center gap-2 text-center">
                            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                                <ShieldCheck className="w-6 h-6" />
                            </div>
                            <span className="font-bold text-emerald-300 text-sm">WhatsApp Successfully Connected! 🎉</span>
                            <span className="text-xs text-slate-300">
                                Friday aapke number {activePhone ? `(+${activePhone})` : ''} se background mein WhatsApp messages bhej sakti hai!
                            </span>
                            <button
                                onClick={onClose}
                                className="w-full mt-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors"
                            >
                                Done & Close
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Step 1: Input Form */}
                            {!pairingCode ? (
                                <form onSubmit={handleGenerateCode} className="flex flex-col gap-4">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-medium text-slate-300">
                                            Spare Phone Number (10 Digits):
                                        </label>
                                        <div className="relative flex items-center">
                                            <div className="absolute left-3.5 flex items-center gap-1.5 text-slate-400 font-mono text-sm pointer-events-none">
                                                <Phone className="w-4 h-4 text-emerald-400" />
                                                <span>+91</span>
                                            </div>
                                            <input
                                                type="tel"
                                                required
                                                placeholder="9876543210"
                                                value={phone}
                                                onChange={(e) => setPhone(e.target.value)}
                                                className="w-full pl-20 pr-4 py-3 rounded-2xl bg-slate-950/80 border border-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-100 text-sm font-mono tracking-wider outline-none transition-all"
                                            />
                                        </div>
                                        <span className="text-[11px] text-slate-400 leading-tight">
                                            Yeh number Friday AI Assistant ke liye dedicated WhatsApp session banayega. Aapka personal WhatsApp 100% safe rahega.
                                        </span>
                                    </div>

                                    {error && (
                                        <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/50 text-red-300 text-xs">
                                            {error}
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-[0_0_25px_rgba(16,185,129,0.35)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer active:scale-[0.98]"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                <span>Connecting & Generating Code...</span>
                                            </>
                                        ) : (
                                            <>
                                                <span>Get 8-Digit Pairing Code</span>
                                                <span>→</span>
                                            </>
                                        )}
                                    </button>
                                </form>
                            ) : (
                                /* Step 2: Display Pairing Code */
                                <div className="flex flex-col items-center gap-4">
                                    <div className="w-full p-4 rounded-2xl bg-emerald-950/50 border border-emerald-500/40 flex flex-col items-center gap-2">
                                        <span className="text-xs text-emerald-400 font-semibold tracking-wide uppercase">
                                            Your 8-Character Pairing Code
                                        </span>
                                        <div className="px-6 py-3 rounded-2xl bg-black/70 border border-emerald-400/60 text-emerald-300 font-mono font-black text-3xl tracking-widest select-all shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                                            {pairingCode}
                                        </div>
                                        <button
                                            onClick={handleCopy}
                                            className="w-full mt-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors flex items-center justify-center gap-1.5"
                                        >
                                            {copied ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4" />}
                                            <span>{copied ? "Copied to Clipboard!" : "Copy Code"}</span>
                                        </button>
                                    </div>

                                    {/* How to enter guide */}
                                    <div className="w-full p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex flex-col gap-2">
                                        <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                                            <Smartphone className="w-4 h-4 text-emerald-400" />
                                            Apne phone mein WhatsApp kholein:
                                        </span>
                                        <ol className="text-xs text-slate-300 space-y-1 pl-4 list-decimal">
                                            <li>WhatsApp <b>Settings</b> ➡️ <b>Linked Devices</b> par jayein.</li>
                                            <li><b>Link a device</b> dabayein, fir neeche <b>"Link with phone number instead"</b> par tap karein.</li>
                                            <li>Upar diya gaya <b>8-Character Code</b> enter karein!</li>
                                        </ol>
                                    </div>

                                    <div className="flex items-center gap-2 w-full">
                                        <button
                                            onClick={() => setPairingCode(null)}
                                            className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                                        >
                                            Change Number
                                        </button>
                                        <button
                                            onClick={onClose}
                                            className="flex-1 py-2 rounded-xl bg-emerald-700/60 hover:bg-emerald-600/70 text-white text-xs font-medium transition-colors"
                                        >
                                            Close
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
