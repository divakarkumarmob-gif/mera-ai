import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, Key, X, Check, AlertCircle, Trash2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function VoiceBiometricsManager() {
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
          className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
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
                  className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmAction}
                  disabled={loading || !pinInput.trim()}
                  className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 cursor-pointer"
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
