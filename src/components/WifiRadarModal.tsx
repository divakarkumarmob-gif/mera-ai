import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wifi,
  X,
  RefreshCw,
  Tv,
  Smartphone,
  Laptop,
  Router as RouterIcon,
  Speaker,
  Printer,
  Cpu,
  HelpCircle,
  Activity,
  Zap,
  Radio,
  Cast,
  Music,
  Copy,
  Check,
} from 'lucide-react';
import { getApiUrl } from '../utils/api';
import { getAppToken } from '../utils/appSecurityClient';

interface WifiRadarModalProps {
  onClose: () => void;
}

interface WifiHealth {
  connected: boolean;
  ssid: string | null;
  bssid: string | null;
  signalPercent: number;
  signalDbm: number;
  signalQuality: string;
  band: string;
  radioType: string | null;
  receiveRateMbps: number | null;
  transmitRateMbps: number | null;
  channel: number | null;
  gatewayIp: string | null;
  localIp: string | null;
}

interface RadarDevice {
  ip: string;
  mac: string;
  vendor: string;
  hostname?: string;
  modelName?: string;
  deviceType: 'router' | 'phone' | 'computer' | 'tv' | 'speaker' | 'printer' | 'iot' | 'unknown';
  isGateway: boolean;
  isSelf: boolean;
  signalStrength?: string;
  services: Array<'cast' | 'airplay' | 'spotify' | 'printer' | 'upnp' | 'web' | 'ssh' | 'smb'>;
  activeStream?: string;
}

interface RadarScanResponse {
  success: boolean;
  subnet: string;
  gatewayIp: string | null;
  selfIp: string | null;
  wifiHealth: WifiHealth;
  totalDevices: number;
  devices: RadarDevice[];
  summary: {
    routers: number;
    phones: number;
    computers: number;
    tvs: number;
    speakers: number;
    printers: number;
    iot: number;
    unknown: number;
  };
  scannedAt: string;
}

export default function WifiRadarModal({ onClose }: WifiRadarModalProps) {
  const [data, setData] = useState<RadarScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  const fetchRadar = async (force: boolean = false) => {
    setLoading(true);
    try {
      const token = getAppToken() || '';
      const url = getApiUrl(`/api/network/wifi-radar?refresh=${force}`);
      const res = await fetch(url, {
        headers: { 'x-app-key-token': token },
      });
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error('Failed to fetch Wi-Fi radar:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRadar(false);
  }, []);

  const handleCopyIp = (ip: string) => {
    navigator.clipboard.writeText(ip);
    setCopiedIp(ip);
    setTimeout(() => setCopiedIp(null), 2000);
  };

  const getDeviceIcon = (type: RadarDevice['deviceType']) => {
    switch (type) {
      case 'router':
        return <RouterIcon className="w-5 h-5 text-amber-400" />;
      case 'tv':
        return <Tv className="w-5 h-5 text-purple-400" />;
      case 'phone':
        return <Smartphone className="w-5 h-5 text-emerald-400" />;
      case 'computer':
        return <Laptop className="w-5 h-5 text-sky-400" />;
      case 'speaker':
        return <Speaker className="w-5 h-5 text-pink-400" />;
      case 'printer':
        return <Printer className="w-5 h-5 text-indigo-400" />;
      case 'iot':
        return <Cpu className="w-5 h-5 text-teal-400" />;
      default:
        return <HelpCircle className="w-5 h-5 text-slate-400" />;
    }
  };

  const filteredDevices = data?.devices.filter((dev) => {
    if (filterType === 'all') return true;
    return dev.deviceType === filterType;
  }) || [];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-2xl bg-gradient-to-b from-slate-900/95 via-slate-900/90 to-slate-950/95 border border-cyan-500/30 rounded-3xl shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col max-h-[90vh] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                <Radio className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                  Friday Wi-Fi Radar
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 uppercase tracking-widest font-black">
                    Level 2
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Multicast mDNS, SSDP & Signal Quality Inspector
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchRadar(true)}
                disabled={loading}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all disabled:opacity-50 border border-white/10 active:scale-95 cursor-pointer"
                title="Rescan Network"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-300 transition-all border border-white/10 active:scale-95 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 custom-scrollbar">
            {/* Wi-Fi Link Health Banner */}
            {data?.wifiHealth && (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-950/40 via-slate-900/60 to-indigo-950/40 border border-cyan-500/30 relative overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-cyan-400" />
                      <span className="text-sm font-bold text-white tracking-wide">
                        {data.wifiHealth.ssid || 'Wi-Fi Network'}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold">
                        {data.wifiHealth.band}
                      </span>
                      {data.wifiHealth.radioType && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-semibold">
                          {data.wifiHealth.radioType}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 flex items-center gap-3">
                      <span>Gateway: <strong className="text-slate-200">{data.wifiHealth.gatewayIp || '192.168.31.1'}</strong></span>
                      <span>•</span>
                      <span>Subnet: <strong className="text-slate-200">{data.subnet}</strong></span>
                    </div>
                  </div>

                  {/* Signal Meter */}
                  <div className="flex items-center gap-3 bg-slate-950/60 px-3.5 py-2 rounded-xl border border-white/10">
                    <div className="text-right">
                      <div className="text-sm font-black text-cyan-300 flex items-center gap-1 justify-end">
                        <Activity className="w-3.5 h-3.5 text-emerald-400" />
                        {data.wifiHealth.signalPercent}%
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {data.wifiHealth.signalQuality} ({data.wifiHealth.signalDbm} dBm)
                      </div>
                    </div>

                    <div className="h-7 w-[1px] bg-white/10" />

                    <div className="text-right">
                      <div className="text-sm font-black text-indigo-300 flex items-center gap-1 justify-end">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        {data.wifiHealth.receiveRateMbps || 866} Mbps
                      </div>
                      <div className="text-[10px] text-slate-400">Link Speed</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
              {[
                { id: 'all', label: `All (${data?.totalDevices || 0})` },
                { id: 'tv', label: `Smart TVs (${data?.summary.tvs || 0})` },
                { id: 'phone', label: `Phones (${data?.summary.phones || 0})` },
                { id: 'computer', label: `Computers (${data?.summary.computers || 0})` },
                { id: 'router', label: `Routers (${data?.summary.routers || 0})` },
                { id: 'speaker', label: `Speakers (${data?.summary.speakers || 0})` },
                { id: 'printer', label: `Printers (${data?.summary.printers || 0})` },
                { id: 'iot', label: `IoT (${data?.summary.iot || 0})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilterType(tab.id)}
                  className={`px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap cursor-pointer ${
                    filterType === tab.id
                      ? 'bg-cyan-500 text-black font-bold shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                      : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-white/5'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Devices List */}
            {loading && !data ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-3">
                <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                <p className="text-sm text-slate-400 animate-pulse">
                  Scanning local Wi-Fi, mDNS & SSDP Multicast...
                </p>
              </div>
            ) : filteredDevices.length === 0 ? (
              <div className="py-10 text-center text-slate-500 text-sm">
                No devices found under this filter.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {filteredDevices.map((dev, idx) => (
                  <motion.div
                    key={dev.ip || idx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="p-3.5 rounded-2xl bg-slate-900/70 hover:bg-slate-850/90 border border-white/10 hover:border-cyan-500/40 transition-all flex flex-wrap items-center justify-between gap-3 group"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="p-2.5 rounded-xl bg-slate-800 border border-white/10 group-hover:border-cyan-500/30 transition-all">
                        {getDeviceIcon(dev.deviceType)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white tracking-wide">
                            {dev.vendor}
                          </span>
                          {dev.hostname && (
                            <span className="text-xs text-slate-400 font-mono">
                              ({dev.hostname})
                            </span>
                          )}
                          {dev.isGateway && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold uppercase">
                              Main Gateway
                            </span>
                          )}
                          {dev.isSelf && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold uppercase">
                              Host Machine
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400 font-mono">
                          <span>{dev.ip}</span>
                          <span>•</span>
                          <span className="text-slate-500">{dev.mac}</span>
                        </div>

                        {/* Active Streaming or Services Badges */}
                        {dev.activeStream && (
                          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-cyan-300 font-semibold">
                            <Cast className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                            <span>{dev.activeStream}</span>
                          </div>
                        )}

                        {dev.services && dev.services.length > 0 && !dev.activeStream && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {dev.services.map((srv) => (
                              <span
                                key={srv}
                                className="text-[9px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-white/10 uppercase tracking-wider font-semibold"
                              >
                                {srv}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyIp(dev.ip)}
                        className="p-2 rounded-xl bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition-all border border-white/5 cursor-pointer text-xs flex items-center gap-1"
                        title="Copy IP Address"
                      >
                        {copiedIp === dev.ip ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400 font-bold">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>IP</span>
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Footer Info */}
          <div className="px-6 py-3 border-t border-white/10 bg-white/[0.02] flex items-center justify-between text-xs text-slate-400">
            <span>
              Scanned: {data?.scannedAt || new Date().toLocaleTimeString()}
            </span>
            <span className="text-cyan-400/80 font-medium">
              Subnet: {data?.subnet || '192.168.31.0/24'}
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
