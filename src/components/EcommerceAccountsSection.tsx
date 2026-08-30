import React, { useState, useEffect } from 'react';
import { ShoppingBag, CheckCircle2, XCircle, LogIn, LogOut, RefreshCw, Loader2, Sparkles, ExternalLink, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface StoreSession {
  store: 'flipkart' | 'amazon' | 'meesho';
  isLoggedIn: boolean;
  userName?: string;
  lastChecked: string;
}

interface SessionStatusResponse {
  ok: boolean;
  sessions?: {
    flipkart: StoreSession;
    amazon: StoreSession;
    meesho: StoreSession;
  };
}

export default function EcommerceAccountsSection() {
  const [sessions, setSessions] = useState<{
    flipkart?: StoreSession;
    amazon?: StoreSession;
    meesho?: StoreSession;
  }>({});
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchSessionStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ecommerce/session-status');
      const data: SessionStatusResponse = await res.json();
      if (data.ok && data.sessions) {
        setSessions(data.sessions);
      }
    } catch (e) {
      console.warn('[EcommerceAccounts] Error checking session status:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessionStatus();
  }, []);

  const handleOpenLogin = async (store: 'flipkart' | 'amazon' | 'meesho') => {
    setActionLoading(`login_${store}`);
    setFeedbackMsg(null);

    const fallbackUrls = {
      flipkart: 'https://www.flipkart.com/account/login',
      amazon: 'https://www.amazon.in/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.in%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=inflex&openid.mode=checkid_setup&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0',
      meesho: 'https://www.meesho.com/auth?redirect=',
    };

    try {
      const res = await fetch('/api/ecommerce/browser-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store }),
      });
      const data = await res.json();
      const targetUrl = data.loginUrl || fallbackUrls[store];

      // Always open official login window on user's active device (mobile / desktop)
      if (typeof window !== 'undefined' && targetUrl) {
        window.open(targetUrl, '_blank');
      }

      setFeedbackMsg({
        type: 'success',
        text: `✨ ${store.toUpperCase()} login page open ho gaya hai! Mobile/OTP daal kar login karein.`,
      });
    } catch (e: any) {
      // Direct client fallback
      if (typeof window !== 'undefined') {
        window.open(fallbackUrls[store], '_blank');
      }
      setFeedbackMsg({
        type: 'success',
        text: `✨ ${store.toUpperCase()} login page open ho gaya hai.`,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogout = async (store: 'flipkart' | 'amazon' | 'meesho') => {
    setActionLoading(`logout_${store}`);
    setFeedbackMsg(null);
    try {
      const res = await fetch('/api/ecommerce/browser-logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedbackMsg({
          type: 'success',
          text: `🚪 ${store.toUpperCase()} session successfully logged out!`,
        });
        await fetchSessionStatus();
      } else {
        setFeedbackMsg({ type: 'error', text: data.message || 'Logout failed' });
      }
    } catch (e: any) {
      setFeedbackMsg({ type: 'error', text: 'Logout error: ' + (e?.message || e) });
    } finally {
      setActionLoading(null);
    }
  };

  const storeConfigs = [
    {
      id: 'flipkart' as const,
      name: 'Flipkart',
      icon: '🛍️',
      color: 'from-blue-600 to-indigo-700',
      badgeBorder: 'border-blue-500/50',
      badgeBg: 'bg-blue-500/15 text-blue-300',
      desc: 'Autonomous 1-Click Buy Now & COD orders with auto-captcha solving',
    },
    {
      id: 'amazon' as const,
      name: 'Amazon India',
      icon: '📦',
      color: 'from-amber-600 to-orange-700',
      badgeBorder: 'border-amber-500/50',
      badgeBg: 'bg-amber-500/15 text-amber-300',
      desc: '1-Click Prime checkout & Pay on Delivery order placement',
    },
    {
      id: 'meesho' as const,
      name: 'Meesho',
      icon: '🏷️',
      color: 'from-pink-600 to-rose-700',
      badgeBorder: 'border-pink-500/50',
      badgeBg: 'bg-pink-500/15 text-pink-300',
      desc: 'Direct supplier discounts & Cash on Delivery automation',
    },
  ];

  return (
    <div className="space-y-3">
      {/* Top Header & Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h5 className="text-xs font-bold text-white flex items-center gap-1.5">
            <span>🛒</span> Connected E-Commerce Accounts
          </h5>
          <p className="text-[11px] text-slate-400">
            One-time login se FRIDAY aapke liye voice se 1-click COD order karegi.
          </p>
        </div>
        <button
          onClick={fetchSessionStatus}
          disabled={loading}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all cursor-pointer disabled:opacity-50"
          title="Refresh Login Status"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
        </button>
      </div>

      {/* Feedback Banner */}
      <AnimatePresence>
        {feedbackMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
              feedbackMsg.type === 'success'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
            }`}
          >
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0 text-rose-400" />
            )}
            <span className="flex-1">{feedbackMsg.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Store Cards Grid */}
      <div className="space-y-2.5">
        {storeConfigs.map((cfg) => {
          const session = sessions[cfg.id];
          const isLoggedIn = session?.isLoggedIn || false;
          const isLoggingIn = actionLoading === `login_${cfg.id}`;
          const isLoggingOut = actionLoading === `logout_${cfg.id}`;

          return (
            <div
              key={cfg.id}
              className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/80 hover:border-slate-700/80 transition-all"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{cfg.icon}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-white">{cfg.name}</h4>
                      <span
                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                          isLoggedIn
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {isLoggedIn ? '● Logged In' : '○ Not Connected'}
                      </span>
                    </div>
                    {session?.userName && (
                      <p className="text-[10px] text-cyan-300 font-medium">
                        User: {session.userName}
                      </p>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {isLoggedIn ? (
                    <button
                      onClick={() => handleLogout(cfg.id)}
                      disabled={isLoggingOut}
                      className="px-2.5 py-1 rounded-xl bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                      title="Logout from Friday"
                    >
                      {isLoggingOut ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <LogOut className="w-3 h-3" />
                      )}
                      <span>Logout</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleOpenLogin(cfg.id)}
                      disabled={isLoggingIn}
                      className={`px-3 py-1 rounded-xl bg-gradient-to-r ${cfg.color} text-white font-bold text-[11px] flex items-center gap-1.5 shadow-md transition-all cursor-pointer active:scale-95 disabled:opacity-50`}
                      title="Open Login Helper Window"
                    >
                      {isLoggingIn ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <LogIn className="w-3 h-3" />
                      )}
                      <span>Login Helper</span>
                    </button>
                  )}
                </div>
              </div>

              <p className="text-[10px] text-slate-400 pl-8">
                {cfg.desc}
              </p>
            </div>
          );
        })}
      </div>

      <div className="p-2.5 rounded-xl bg-cyan-500/5 border border-cyan-500/20 text-[10px] text-slate-400 flex items-center gap-2">
        <Shield className="w-4 h-4 text-cyan-400 shrink-0" />
        <span>Session cookies local device par encrypted store hote hain. Password kabhi plain text me save nahi hota.</span>
      </div>
    </div>
  );
}
