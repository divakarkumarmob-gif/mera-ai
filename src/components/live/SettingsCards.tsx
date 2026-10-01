import React, { useState, useEffect } from 'react';
import { Send, ShieldCheck } from 'lucide-react';

export interface ToggleSwitchProps {
  label: string;
  description?: string;
  active: boolean;
  onToggle: () => void;
  activeColor?: string;
  disabled?: boolean;
}

export function ToggleSwitch({ label, description, active, onToggle, activeColor = 'bg-[#10b981]', disabled }: ToggleSwitchProps) {
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
        <span
          className={`inline-block w-6 h-6 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] transform transition-transform duration-300 ease-in-out pointer-events-none ${
            active ? 'translate-x-8' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export function BaileysToggle({ onOpenPairModal }: { onOpenPairModal?: () => void }) {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [baileysLinked, setBaileysLinked] = useState(false);
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);

  const checkStatus = () => {
    fetch('/api/whatsapp/status')
      .then(r => r.json())
      .then(d => {
        if (typeof d.baileysEnabled === 'boolean') {
          setEnabled(d.baileysEnabled);
        }
        setBaileysLinked(!!(d.isBaileysConnected ?? d.baileys?.isConnected));
        setLinkedPhone(d.dedicatedPhone || d.baileys?.dedicatedPhone || null);
      })
      .catch(() => {});
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
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
      if (typeof data.baileysEnabled === 'boolean') {
        setEnabled(data.baileysEnabled);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  return (
    <div className="flex flex-col gap-2.5 p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800">
      <ToggleSwitch
        label="WhatsApp 2 (Baileys Multi-Device Bot)"
        description={enabled ? '⚡ ON: Primary Priority Active (Saare messages default WhatsApp 2 se directly dispatch honge)' : '🛡️ OFF: WhatsApp 2 disabled (Only WhatsApp 1 Active)'}
        active={enabled}
        onToggle={toggle}
        activeColor="bg-cyan-500"
        disabled={loading}
      />
      <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-xs">
        <span className="text-[11px] text-slate-400">
          Status: {baileysLinked ? (
            <span className="text-cyan-400 font-semibold ml-1">🟢 WhatsApp 2 Linked {linkedPhone ? `(+${linkedPhone})` : ''}</span>
          ) : (
            <span className="text-amber-400 font-semibold ml-1">🟡 WhatsApp 2 Not Linked</span>
          )}
        </span>
        {onOpenPairModal && (
          <button
            onClick={onOpenPairModal}
            className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 font-semibold text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span>📲</span>
            <span>{baileysLinked ? 'Manage / Re-link' : 'Link QR / Code'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function TelegramBotCard() {
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

export function CyberSecurityCard() {
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
