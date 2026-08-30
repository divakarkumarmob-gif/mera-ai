import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ExternalLink,
  Star,
  Sparkles,
  Volume2,
  ShoppingBag,
  Tag,
  ChevronRight,
  ChevronLeft,
  Zap,
  CreditCard,
  Banknote,
  CheckCircle2,
  QrCode,
  Smartphone
} from 'lucide-react';
import { EcomProduct } from '@/services/productPriceService';

interface ProductDeckCarouselProps {
  products: EcomProduct[];
  activeIndex: number;
  query?: string;
  onClose: () => void;
  onSelectProduct?: (index: number) => void;
}

export const ProductDeckCarousel: React.FC<ProductDeckCarouselProps> = ({
  products,
  activeIndex,
  query,
  onClose,
  onSelectProduct
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // State for interactive order & payment modal
  const [selectedOrderProduct, setSelectedOrderProduct] = useState<EcomProduct | null>(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderSuccessData, setOrderSuccessData] = useState<any | null>(null);

  // Automatically scroll the currently spoken/active product card into center view
  useEffect(() => {
    if (activeIndex >= 0 && activeIndex < products.length) {
      const activeCard = cardRefs.current[activeIndex];
      if (activeCard && scrollContainerRef.current) {
        activeCard.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest'
        });
      }
    }
  }, [activeIndex, products.length]);

  if (!products || products.length === 0) return null;

  const getStoreBadge = (store: string) => {
    switch (store.toLowerCase()) {
      case 'flipkart':
        return {
          name: 'Flipkart',
          bg: 'bg-blue-600/25 border-blue-500/60 text-blue-300',
          dot: 'bg-yellow-400',
          gradient: 'from-blue-600/30 to-yellow-500/10'
        };
      case 'amazon':
        return {
          name: 'Amazon India',
          bg: 'bg-amber-500/25 border-amber-500/60 text-amber-300',
          dot: 'bg-amber-400',
          gradient: 'from-amber-600/30 to-orange-500/10'
        };
      case 'meesho':
        return {
          name: 'Meesho',
          bg: 'bg-pink-600/25 border-pink-500/60 text-pink-300',
          dot: 'bg-pink-400',
          gradient: 'from-pink-600/30 to-purple-500/10'
        };
      default:
        return {
          name: store,
          bg: 'bg-emerald-600/25 border-emerald-500/60 text-emerald-300',
          dot: 'bg-emerald-400',
          gradient: 'from-emerald-600/30 to-teal-500/10'
        };
    }
  };

  const handleScrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -280, behavior: 'smooth' });
    }
  };

  const handleScrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 280, behavior: 'smooth' });
    }
  };

  const handlePlaceOrder = async (method: 'COD' | 'ONLINE_UPI') => {
    if (!selectedOrderProduct) return;
    setOrderSubmitting(true);
    try {
      const res = await fetch('/api/ecommerce/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: selectedOrderProduct.title,
          price: selectedOrderProduct.price,
          paymentMethod: method,
          store: selectedOrderProduct.store,
          productUrl: selectedOrderProduct.productUrl,
          imageUrl: selectedOrderProduct.imageUrl,
        }),
      });
      const data = await res.json();
      if (data.success && data.order) {
        setOrderSuccessData(data.order);
      }
    } catch (err) {
      console.error('Order creation failed:', err);
    } finally {
      setOrderSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.95 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-24 md:bottom-28 left-0 right-0 z-50 px-3 md:px-6 max-w-5xl mx-auto pointer-events-auto"
      >
        <div className="relative rounded-3xl bg-slate-950/85 backdrop-blur-2xl border border-cyan-500/30 shadow-[0_10px_40px_rgba(0,0,0,0.7),0_0_30px_rgba(6,182,212,0.15)] p-4 pt-6 overflow-hidden">
          {/* Subtle Ambient Background Glow */}
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-24 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 right-10 w-48 h-24 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

          {/* ── TOP-CENTER CLOSE / DISMISS BUTTON ─────────────────────────────────── */}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 z-20">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-cyan-500/40 hover:border-cyan-400 shadow-[0_4px_12px_rgba(0,0,0,0.5)] transition-all cursor-pointer group active:scale-95 text-xs font-semibold"
              title="Close Product Deck"
            >
              <X className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform text-cyan-400" />
              <span>Close Deck</span>
            </button>
          </div>

          {/* Header Row: Query Title & Navigation Arrows */}
          <div className="flex items-center justify-between mb-3 px-2 pt-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
              </span>
              <span className="text-white text-xs md:text-sm font-bold truncate">
                Live Price Results {query ? `for "${query}"` : ''}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                {products.length} Products Found
              </span>
            </div>

            {/* Scroll Navigation Arrows */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleScrollLeft}
                className="p-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/10 transition-all cursor-pointer active:scale-90"
                title="Scroll Left"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleScrollRight}
                className="p-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/10 transition-all cursor-pointer active:scale-90"
                title="Scroll Right"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── HORIZONTAL SCROLLABLE DECK (LEFT TO RIGHT) ────────────────────────── */}
          <div
            ref={scrollContainerRef}
            className="flex items-stretch gap-3.5 overflow-x-auto pb-2 pt-1 px-1 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-transparent snap-x snap-mandatory"
            style={{ scrollBehavior: 'smooth' }}
          >
            {products.map((item, idx) => {
              const isActive = idx === activeIndex;
              const storeBadge = getStoreBadge(item.store);

              return (
                <motion.div
                  key={idx}
                  ref={(el) => {
                    cardRefs.current[idx] = el;
                  }}
                  onClick={() => onSelectProduct?.(idx)}
                  whileHover={{ scale: 1.02 }}
                  className={`relative flex flex-col justify-between shrink-0 w-[240px] md:w-[260px] rounded-2xl p-3.5 transition-all duration-300 snap-center cursor-pointer select-none ${
                    isActive
                      ? 'bg-gradient-to-b from-cyan-950/60 via-slate-900/90 to-slate-950/95 border-2 border-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.45)] ring-2 ring-cyan-400/30 scale-[1.03]'
                      : 'bg-slate-900/70 hover:bg-slate-800/80 border border-white/10 hover:border-white/20'
                  }`}
                >
                  {/* Active Voice Speaking Pulse Badge */}
                  {isActive && (
                    <div className="absolute -top-2.5 right-3 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-[10px] font-black text-white shadow-[0_0_12px_rgba(6,182,212,0.6)] flex items-center gap-1 animate-pulse z-10">
                      <Volume2 className="w-3 h-3 animate-bounce" />
                      <span>FRIDAY SPEAKING</span>
                    </div>
                  )}

                  <div>
                    {/* Store Badge & Rating Row */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${storeBadge.bg}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${storeBadge.dot}`} />
                        {storeBadge.name}
                      </span>

                      {item.rating ? (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded-md">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          {item.rating}
                        </span>
                      ) : null}
                    </div>

                    {/* Product Image */}
                    <div className="relative w-full h-32 rounded-xl bg-slate-950/80 border border-white/5 overflow-hidden flex items-center justify-center p-2 mb-2.5 group">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <ShoppingBag className="w-10 h-10 text-slate-600" />
                      )}

                      {/* Best Deal / Discount Overlay Badge */}
                      {item.discountPercentage && item.discountPercentage > 0 && (
                        <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-black shadow-md flex items-center gap-0.5">
                          <Tag className="w-2.5 h-2.5" />
                          {item.discountPercentage}% OFF
                        </span>
                      )}
                    </div>

                    {/* Product Title */}
                    <h4
                      className="text-xs font-semibold text-white line-clamp-2 leading-snug mb-2 hover:text-cyan-300 transition-colors"
                      title={item.title}
                    >
                      {item.title}
                    </h4>
                  </div>

                  {/* Bottom: Price and Action Buttons */}
                  <div className="pt-2 border-t border-white/10 mt-auto">
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-lg font-black text-cyan-300">
                        ₹{item.price.toLocaleString('en-IN')}
                      </span>
                      {item.originalPrice && item.originalPrice > item.price && (
                        <span className="text-xs text-slate-400 line-through">
                          ₹{item.originalPrice.toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      {/* Direct Store Link Button */}
                      <a
                        href={item.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="py-1.5 px-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition-all duration-200 cursor-pointer bg-slate-800 hover:bg-slate-700 text-white border border-white/10"
                      >
                        <span>View</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>

                      {/* Autonomous Order Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedOrderProduct(item);
                          setOrderSuccessData(null);
                        }}
                        className={`py-1.5 px-2 rounded-xl text-[11px] font-black flex items-center justify-center gap-1 transition-all duration-200 cursor-pointer shadow-md ${
                          isActive
                            ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                            : 'bg-emerald-600/90 hover:bg-emerald-500 text-white border border-emerald-400/40'
                        }`}
                      >
                        <Zap className="w-3 h-3 fill-current" />
                        <span>Order Now</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* ── INTERACTIVE ORDER & PAYMENT MODAL ─────────────────────────────────── */}
          <AnimatePresence>
            {selectedOrderProduct && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-950/95 backdrop-blur-xl z-30 flex flex-col justify-center items-center p-4 text-center"
              >
                <button
                  onClick={() => {
                    setSelectedOrderProduct(null);
                    setOrderSuccessData(null);
                  }}
                  className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>

                {!orderSuccessData ? (
                  <div className="w-full max-w-sm">
                    <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 flex items-center justify-center mx-auto mb-2">
                      <Zap className="w-5 h-5" />
                    </div>

                    <h3 className="text-base font-black text-white mb-1">
                      Choose Payment Method
                    </h3>
                    <p className="text-xs text-slate-400 mb-1 line-clamp-1">
                      {selectedOrderProduct.title}
                    </p>
                    <p className="text-xl font-black text-cyan-300 mb-4">
                      Total: ₹{selectedOrderProduct.price.toLocaleString('en-IN')}
                    </p>

                    <div className="space-y-2.5">
                      {/* Option 1: Cash on Delivery (COD) */}
                      <button
                        disabled={orderSubmitting}
                        onClick={() => handlePlaceOrder('COD')}
                        className="w-full p-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white font-bold text-xs flex items-center justify-between border border-emerald-400/40 shadow-lg cursor-pointer transition-all active:scale-98 disabled:opacity-50"
                      >
                        <div className="flex items-center gap-2.5">
                          <Banknote className="w-5 h-5 text-emerald-300" />
                          <div className="text-left">
                            <div className="font-extrabold text-white">Cash on Delivery (COD)</div>
                            <div className="text-[10px] text-emerald-200">Pay cash or UPI at delivery time</div>
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-400/40 font-mono font-black">
                          100% AUTO
                        </span>
                      </button>

                      {/* Option 2: Online UPI Payment (PhonePe / GPay / Paytm) */}
                      <button
                        disabled={orderSubmitting}
                        onClick={() => handlePlaceOrder('ONLINE_UPI')}
                        className="w-full p-3 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-500 hover:to-blue-600 text-white font-bold text-xs flex items-center justify-between border border-cyan-400/40 shadow-lg cursor-pointer transition-all active:scale-98 disabled:opacity-50"
                      >
                        <div className="flex items-center gap-2.5">
                          <CreditCard className="w-5 h-5 text-cyan-300" />
                          <div className="text-left">
                            <div className="font-extrabold text-white">Online UPI (PhonePe / GPay)</div>
                            <div className="text-[10px] text-cyan-200">Instant links to WhatsApp & Telegram</div>
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-400/40 font-mono font-black">
                          FAST
                        </span>
                      </button>
                    </div>

                    <p className="text-[10px] text-slate-500 mt-3">
                      ⚡ WhatsApp & Telegram alerts will be sent automatically to Boss.
                    </p>
                  </div>
                ) : (
                  <div className="w-full max-w-sm">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto mb-2 animate-bounce">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>

                    <h3 className="text-base font-black text-white mb-1">
                      {orderSuccessData.paymentMethod === 'COD' ? 'Order Confirmed!' : 'Payment Links Dispatched!'}
                    </h3>
                    <p className="text-xs text-slate-300 mb-2">
                      Order ID: <b className="text-cyan-300 font-mono">#{orderSuccessData.id}</b>
                    </p>

                    {orderSuccessData.paymentMethod === 'ONLINE_UPI' && orderSuccessData.paymentLinks ? (
                      <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-2.5 mb-3 text-left space-y-1.5">
                        <p className="text-[11px] font-bold text-cyan-300 flex items-center gap-1">
                          <Smartphone className="w-3.5 h-3.5" /> 1-Tap UPI Links:
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          <a
                            href={orderSuccessData.paymentLinks.phonepe}
                            className="py-1 px-2 rounded-lg bg-purple-900/80 hover:bg-purple-800 text-white text-[10px] font-bold text-center block"
                          >
                            🟣 PhonePe
                          </a>
                          <a
                            href={orderSuccessData.paymentLinks.gpay}
                            className="py-1 px-2 rounded-lg bg-blue-900/80 hover:bg-blue-800 text-white text-[10px] font-bold text-center block"
                          >
                            🔵 Google Pay
                          </a>
                        </div>
                        <a
                          href={orderSuccessData.paymentLinks.webPayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-1 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[10px] font-bold text-center flex items-center justify-center gap-1"
                        >
                          <QrCode className="w-3 h-3" />
                          <span>Open Web Pay & QR Portal</span>
                        </a>
                      </div>
                    ) : (
                      <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-2.5 mb-3 text-xs text-emerald-300">
                        📦 Delivery Expected: <b>{orderSuccessData.expectedDeliveryDate}</b>
                        <br />
                        <span className="text-[10px] text-slate-400">Cash on Delivery receipt sent to WhatsApp & Telegram.</span>
                      </div>
                    )}

                    <button
                      onClick={() => {
                        setSelectedOrderProduct(null);
                        setOrderSuccessData(null);
                      }}
                      className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold"
                    >
                      Done
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
