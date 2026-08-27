import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Download, Upload, ShieldAlert, ShieldCheck, Unlock, Loader2, Key, AlertCircle, FileText, CheckCircle2 } from 'lucide-react';
import { getAppToken } from '@/utils/appSecurityClient';

interface MemoryBackupModalProps {
  onClose: () => void;
}

interface BlockedClient {
  ip: string;
  userAgent: string;
  blockedAt: number;
  reason?: string;
  attempts?: number;
}

export default function MemoryBackupModal({ onClose }: MemoryBackupModalProps) {
  const [activeTab, setActiveTab] = useState<'download' | 'restore' | 'shield'>('download');
  const [masterKey, setMasterKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Restore tab state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Security Shield tab state
  const [blockedClients, setBlockedClients] = useState<BlockedClient[]>([]);
  const [shieldLoading, setShieldLoading] = useState(false);

  const fetchBlockedList = async () => {
    setShieldLoading(true);
    try {
      const token = getAppToken() || '';
      const res = await fetch('/api/security/blocked-clients', {
        headers: {
          'x-app-key-token': token,
        },
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.blockedList)) {
        setBlockedClients(data.blockedList);
      }
    } catch {
      // Ignored
    } finally {
      setShieldLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'shield') {
      fetchBlockedList();
    }
  }, [activeTab]);

  const handleDownload = async () => {
    if (!masterKey.trim()) {
      setStatusMsg({ type: 'error', text: 'Kripya Master App Key enter karein!' });
      return;
    }

    setIsLoading(true);
    setStatusMsg(null);

    try {
      const token = getAppToken() || '';
      const res = await fetch(`/api/memory/export/decrypted-backup?key=${encodeURIComponent(masterKey.trim())}`, {
        headers: {
          'x-app-key-token': token,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Authorization failed. Master Key galat hai ya access blocked hai.');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `friday_memory_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      setStatusMsg({ type: 'success', text: '✅ Decrypted plain-text backup file download ho gayi hai!' });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Download me dikkat aayi.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedFile) {
      setStatusMsg({ type: 'error', text: 'Kripya backup .json file select karein.' });
      return;
    }
    if (!masterKey.trim()) {
      setStatusMsg({ type: 'error', text: 'Kripya Master App Key enter karein.' });
      return;
    }

    setIsLoading(true);
    setStatusMsg(null);

    try {
      const fileText = await selectedFile.text();
      const backupJson = JSON.parse(fileText);

      const token = getAppToken() || '';
      const res = await fetch('/api/memory/import/restore-backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-key-token': token,
          'x-master-app-key': masterKey.trim(),
        },
        body: JSON.stringify({
          ...backupJson,
          masterKey: masterKey.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Restore failed. Master Key verify nahi hui.');
      }

      const c = data.restoredCounts;
      setStatusMsg({
        type: 'success',
        text: `🎉 Successfully Re-Encrypted & Restored! (Vault: ${c.vault}, Pinned: ${c.pinned}, Updates: ${c.dailyUpdates}, Vectors: ${c.vectors})`,
      });
      setSelectedFile(null);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Restore karne me error aaya.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnblock = async (ip: string) => {
    if (!masterKey.trim()) {
      setStatusMsg({ type: 'error', text: 'Unblock karne ke liye Master App Key enter karein!' });
      return;
    }

    setIsLoading(true);
    try {
      const token = getAppToken() || '';
      const res = await fetch('/api/security/unblock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-key-token': token,
        },
        body: JSON.stringify({
          ip,
          masterKey: masterKey.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Unblock failed.');
      }

      setStatusMsg({ type: 'success', text: `✅ IP ${ip} successfully unblock ho gaya!` });
      fetchBlockedList();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Unblock error.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[3000] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-lg bg-[#0d1330] border border-purple-500/30 rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(139,92,246,0.3)] flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-purple-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-white font-bold text-base">Memory Vault & Security Hub</h2>
              <p className="text-slate-400 text-xs">Plain-text export, key rotation & intrusion control</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/10 p-2 gap-2 bg-slate-950/40">
          <button
            onClick={() => { setActiveTab('download'); setStatusMsg(null); }}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'download'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Backup</span>
          </button>
          <button
            onClick={() => { setActiveTab('restore'); setStatusMsg(null); }}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'restore'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Restore / Re-Encrypt</span>
          </button>
          <button
            onClick={() => { setActiveTab('shield'); setStatusMsg(null); }}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'shield'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Blocked Clients ({blockedClients.length})</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Master Key Input */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-2">
            <label className="text-slate-300 text-xs font-semibold flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>Boss's Master App Key (Double Lock)</span>
            </label>
            <input
              type="password"
              value={masterKey}
              onChange={(e) => setMasterKey(e.target.value)}
              placeholder="Apna Master App Key / PIN enter karein"
              className="w-full bg-slate-950/80 border border-slate-700 focus:border-amber-400 rounded-xl px-4 py-2.5 text-white text-sm outline-none transition-colors"
            />
            <p className="text-[11px] text-slate-400">
              Double-lock verification: Bina Master Key ke koi bhi data download ya unblock nahi ho sakta.
            </p>
          </div>

          {/* Status Message */}
          {statusMsg && (
            <div
              className={`p-3 rounded-xl text-xs flex items-start gap-2.5 leading-relaxed ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/20 border border-rose-500/40 text-rose-300'
              }`}
            >
              {statusMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}

          {activeTab === 'download' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2">
                <p className="font-semibold flex items-center gap-1.5">
                  <span>📄 Decrypted Plain-Text JSON File</span>
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Yeh file aapki saari yaadon (Personal Vault, Daily Updates, Recent Sessions, Vector Memories) ko <b>100% human-readable JSON</b> format me save karegi. Aap ise apne phone ya PC me aasaani se padh sakte hain.
                </p>
              </div>

              <button
                onClick={handleDownload}
                disabled={isLoading || !masterKey.trim()}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-white font-bold text-sm shadow-[0_0_25px_rgba(245,158,11,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Decrypting & Generating File...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download Memory Backup (.json)</span>
                  </>
                )}
              </button>
            </div>
          )}

          {activeTab === 'restore' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-purple-200 text-xs space-y-2">
                <p className="font-semibold flex items-center gap-1.5">
                  <span>🔄 Re-Encrypt With Active Key (Key Rotation)</span>
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Agar aapne apni <code className="text-purple-300 bg-purple-950/60 px-1 py-0.5 rounded">ENCRYPTION_KEY</code> badli hai, toh purani backup JSON file select karein. System sabhi memories ko <b>nayi key se re-encrypt</b> karke Firestore me wapis restore kar dega!
                </p>
              </div>

              <div className="border-2 border-dashed border-slate-700 hover:border-purple-500/60 rounded-2xl p-6 text-center transition-colors">
                <input
                  type="file"
                  id="backup-file-input"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
                <label htmlFor="backup-file-input" className="cursor-pointer space-y-2 block">
                  <FileText className="w-8 h-8 text-purple-400 mx-auto" />
                  <span className="text-xs text-slate-300 block font-medium">
                    {selectedFile ? selectedFile.name : 'Select friday_memory_backup.json'}
                  </span>
                  <span className="text-[10px] text-slate-500 block">Tap here to choose JSON file</span>
                </label>
              </div>

              <button
                onClick={handleRestore}
                disabled={isLoading || !selectedFile || !masterKey.trim()}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold text-sm shadow-[0_0_25px_rgba(139,92,246,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Re-Encrypting & Restoring...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>Restore & Re-Encrypt Memories</span>
                  </>
                )}
              </button>
            </div>
          )}

          {activeTab === 'shield' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300 font-semibold">Blocked IPs & Unauthorized Devices</span>
                <button
                  onClick={() => handleUnblock('all')}
                  disabled={isLoading || blockedClients.length === 0 || !masterKey.trim()}
                  className="text-xs text-rose-400 hover:text-rose-300 font-medium disabled:opacity-40 transition-colors cursor-pointer"
                >
                  Unblock All
                </button>
              </div>

              {shieldLoading ? (
                <div className="text-center py-8 text-slate-400 text-xs flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                  <span>Loading blocked clients...</span>
                </div>
              ) : blockedClients.length === 0 ? (
                <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-2">
                  <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto" />
                  <p className="text-emerald-300 text-xs font-semibold">Security Shield Green ✅</p>
                  <p className="text-slate-400 text-[11px]">Abhi koi bhi IP ya device blocked nahi hai. Sabhi clients safe state me hain.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {blockedClients.map((client) => (
                    <div
                      key={client.ip}
                      className="p-3 rounded-2xl bg-slate-950/60 border border-rose-500/30 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-rose-300">{client.ip}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-400 font-medium">
                            Blocked
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {client.reason || 'Failed authentication or direct attack'}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {new Date(client.blockedAt).toLocaleDateString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <button
                        onClick={() => handleUnblock(client.ip)}
                        disabled={isLoading || !masterKey.trim()}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/50 text-rose-200 text-xs font-semibold transition-all disabled:opacity-40 flex items-center gap-1 cursor-pointer active:scale-95"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Unblock</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
