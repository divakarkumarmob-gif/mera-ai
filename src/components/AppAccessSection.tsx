import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
    Shield,
    FolderKanban,
    PhoneCall,
    Camera,
    Users,
    Mic,
    Radio,
    Bell,
    BellRing,
    Phone,
    Image as ImageIcon,
    MessageSquare,
    MapPin,
    Settings as SettingsIcon,
    ChevronDown,
    CheckCircle2,
    XCircle,
    Info,
    ExternalLink,
    X,
    Sparkles
} from 'lucide-react';
import {
    APP_ACCESS_ITEMS,
    PermissionItemConfig,
    getAppAccessPreferences,
    saveAppAccessPreference,
    openPermissionSettings
} from '@/utils/appAccessManager';

const ICON_MAP: Record<string, React.ElementType> = {
    all_files: FolderKanban,
    call_logs: PhoneCall,
    camera: Camera,
    contacts: Users,
    microphone: Mic,
    nearby_devices: Radio,
    notifications: Bell,
    notifications_access: BellRing,
    phone: Phone,
    photos_videos: ImageIcon,
    sms: MessageSquare,
    device_location: MapPin,
};

export default function AppAccessSection() {
    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const [preferences, setPreferences] = useState<Record<string, boolean>>(() => getAppAccessPreferences());
    const [guideModal, setGuideModal] = useState<{ item: PermissionItemConfig; message: string } | null>(null);
    const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

    useEffect(() => {
        setPreferences(getAppAccessPreferences());
    }, []);

    const handleToggle = (id: string) => {
        const next = !preferences[id];
        const updated = saveAppAccessPreference(id, next);
        setPreferences({ ...updated });
        showToast(`${APP_ACCESS_ITEMS.find(i => i.id === id)?.title} set to ${next ? 'Allowed' : 'Not allowed'}`);
    };

    const handleOpenSettings = async (item: PermissionItemConfig) => {
        const result = await openPermissionSettings(item);
        if (result.status === 'prompted') {
            setPreferences(getAppAccessPreferences());
            showToast(result.message || 'Permission updated!');
        } else {
            setGuideModal({ item, message: result.message || 'Opening device settings...' });
        }
    };

    const showToast = (msg: string) => {
        setFeedbackToast(msg);
        setTimeout(() => {
            setFeedbackToast(prev => prev === msg ? null : prev);
        }, 3000);
    };

    const allowedCount = Object.values(preferences).filter(Boolean).length;
    const totalCount = APP_ACCESS_ITEMS.length;

    return (
        <div className="w-full rounded-2xl bg-gradient-to-b from-slate-900/90 to-[#0b1126]/95 border border-cyan-500/30 shadow-[0_0_25px_rgba(6,182,212,0.15)] overflow-hidden transition-all">
            {/* Header Accordion Trigger */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between p-4 bg-slate-900/60 hover:bg-slate-850 transition-colors text-left group cursor-pointer"
            >
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform shadow-[0_0_15px_rgba(6,182,212,0.25)]">
                        <Shield className="w-5 h-5" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h4 className="text-white font-bold text-sm tracking-wide group-hover:text-cyan-300 transition-colors">
                                App Access & Permissions
                            </h4>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                                {allowedCount} / {totalCount} Allowed
                            </span>
                        </div>
                        <p className="text-slate-400 text-xs mt-0.5 truncate max-w-[280px] sm:max-w-md">
                            Manage device features, phone link, and Friday AI access
                        </p>
                    </div>
                </div>

                <motion.div
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-slate-400 group-hover:text-cyan-300 p-1"
                >
                    <ChevronDown className="w-5 h-5" />
                </motion.div>
            </button>

            {/* Expandable Vertical Options List */}
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: 'easeInOut' }}
                        className="border-t border-cyan-500/20 divide-y divide-white/5"
                    >
                        {/* Quick Controls Info Banner */}
                        <div className="px-4 py-2.5 bg-cyan-950/20 flex items-center justify-between text-xs text-cyan-300 border-b border-cyan-500/15">
                            <div className="flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                                <span>Friday uses these permissions to sync and manage your mobile device</span>
                            </div>
                            <button
                                onClick={() => {
                                    const allOn: Record<string, boolean> = {};
                                    APP_ACCESS_ITEMS.forEach(i => { allOn[i.id] = true; saveAppAccessPreference(i.id, true); });
                                    setPreferences(allOn);
                                    showToast('All permissions marked as Allowed');
                                }}
                                className="text-[11px] font-bold text-cyan-400 hover:text-cyan-200 underline decoration-cyan-500/50"
                            >
                                Allow All
                            </button>
                        </div>

                        <div className="p-3 space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
                            {APP_ACCESS_ITEMS.map((item) => {
                                const isAllowed = !!preferences[item.id];
                                const IconComponent = ICON_MAP[item.id] || Shield;

                                return (
                                    <div
                                        key={item.id}
                                        className="p-3.5 rounded-xl bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/50 hover:border-cyan-500/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group/card shadow-sm"
                                    >
                                        {/* Left Side: Icon & Title & Description */}
                                        <div className="flex items-start gap-3 min-w-0 flex-1">
                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                                                isAllowed
                                                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                                    : 'bg-slate-700/40 text-slate-400 border border-slate-600/40'
                                            }`}>
                                                <IconComponent className="w-4 h-4" />
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h5 className="text-white text-sm font-semibold leading-snug">
                                                        {item.title}
                                                    </h5>
                                                    {/* Allowed / Not Allowed Status Badge */}
                                                    <span
                                                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1 transition-all ${
                                                            isAllowed
                                                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                                                                : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                                        }`}
                                                    >
                                                        {isAllowed ? (
                                                            <>
                                                                <CheckCircle2 className="w-3 h-3" />
                                                                Allowed
                                                            </>
                                                        ) : (
                                                            <>
                                                                <XCircle className="w-3 h-3" />
                                                                Not allowed
                                                            </>
                                                        )}
                                                    </span>
                                                </div>
                                                <p className="text-slate-400 text-xs leading-relaxed mt-1">
                                                    {item.description}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Right Side: Toggle Switch & Settings Button */}
                                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5">
                                            {/* Preference Toggle */}
                                            <button
                                                onClick={() => handleToggle(item.id)}
                                                className={`w-11 h-6 rounded-full transition-all relative cursor-pointer active:scale-95 flex items-center px-0.5 ${
                                                    isAllowed ? 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.4)]' : 'bg-slate-700'
                                                }`}
                                                title={isAllowed ? 'Click to revoke preference' : 'Click to allow preference'}
                                            >
                                                <motion.span
                                                    layout
                                                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                                    className={`w-5 h-5 rounded-full bg-white shadow-md block ${
                                                        isAllowed ? 'translate-x-5' : 'translate-x-0'
                                                    }`}
                                                />
                                            </button>

                                            {/* Settings Button */}
                                            <button
                                                onClick={() => handleOpenSettings(item)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-600/80 hover:border-cyan-400/60 text-slate-200 hover:text-white text-xs font-semibold shadow-sm transition-all cursor-pointer active:scale-95 group/btn"
                                                title={`Open Settings for ${item.title}`}
                                            >
                                                <SettingsIcon className="w-3.5 h-3.5 text-slate-400 group-hover/btn:text-cyan-300 group-hover/btn:rotate-45 transition-transform" />
                                                <span>Settings</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Quick Toast Feedback */}
            <AnimatePresence>
                {feedbackToast && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="fixed bottom-6 right-6 z-[3000] px-4 py-2.5 rounded-xl bg-slate-900/95 border border-cyan-500/50 text-cyan-300 text-xs font-medium shadow-[0_0_25px_rgba(6,182,212,0.3)] backdrop-blur-md flex items-center gap-2"
                    >
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>{feedbackToast}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Interactive Settings Guidance Modal */}
            <AnimatePresence>
                {guideModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[3500] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.92, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.92, y: 20 }}
                            className="w-full max-w-md bg-[#0d1330] border border-cyan-500/50 rounded-3xl p-6 shadow-[0_0_40px_rgba(6,182,212,0.35)] flex flex-col gap-4 text-white"
                        >
                            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                                        <SettingsIcon className="w-4 h-4" />
                                    </div>
                                    <h4 className="text-base font-bold text-white">
                                        {guideModal.item.title} Settings
                                    </h4>
                                </div>
                                <button
                                    onClick={() => setGuideModal(null)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="space-y-3 text-xs text-slate-300">
                                <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-500/30 text-cyan-200">
                                    <p className="font-semibold text-cyan-300 mb-1 flex items-center gap-1.5">
                                        <Info className="w-4 h-4 text-cyan-400" />
                                        <span>How to configure {guideModal.item.title}:</span>
                                    </p>
                                    <p className="leading-relaxed">
                                        {guideModal.message}
                                    </p>
                                </div>

                                <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-2">
                                    <p className="font-bold text-slate-200 text-[11px] uppercase tracking-wider">
                                        📱 Mobile / Android Device Steps:
                                    </p>
                                    <ol className="list-decimal list-inside space-y-1 text-slate-400 text-xs pl-1">
                                        <li>Open phone <b>Settings &gt; Apps &gt; Friday AI</b></li>
                                        <li>Tap <b>Permissions</b></li>
                                        <li>Find <b>{guideModal.item.title}</b> and set to <b>Allow</b></li>
                                    </ol>
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-2">
                                <button
                                    onClick={() => {
                                        saveAppAccessPreference(guideModal.item.id, true);
                                        setPreferences(getAppAccessPreferences());
                                        setGuideModal(null);
                                        showToast(`Marked ${guideModal.item.title} as Allowed`);
                                    }}
                                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all cursor-pointer"
                                >
                                    Confirm & Mark as Allowed
                                </button>
                                <button
                                    onClick={() => setGuideModal(null)}
                                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
