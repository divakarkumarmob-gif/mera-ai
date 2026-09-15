#!/usr/bin/env python3
"""
Instagram Bridge Service powered by Instagrapi
Provides a lightweight local HTTP API for Node.js backend.
"""

import sys
import os
import subprocess
import importlib

# ──────────────────────────────────────────────────────────────────────────
# SELF-HEALING IMPORT: Discover site-packages, auto-install if missing
# ──────────────────────────────────────────────────────────────────────────
def _ensure_site_packages_on_path():
    """Forcefully ensure all user/system site-packages are on sys.path."""
    import site
    paths_to_add = []

    # Standard site-packages
    if hasattr(site, "getsitepackages"):
        paths_to_add.extend(site.getsitepackages())
    if hasattr(site, "getusersitepackages"):
        paths_to_add.append(site.getusersitepackages())

    # Render-specific paths
    home = os.environ.get("HOME", "/root")
    render_home = "/opt/render" if os.environ.get("RENDER") else home
    for py_ver in ("3.11", "3.12", "3.10"):
        paths_to_add.append(f"{render_home}/.local/lib/python{py_ver}/site-packages")
        paths_to_add.append(f"{home}/.local/lib/python{py_ver}/site-packages")
        paths_to_add.append(f"/usr/local/lib/python{py_ver}/dist-packages")

    for p in paths_to_add:
        if p and os.path.isdir(p) and p not in sys.path:
            sys.path.insert(0, p)

def _auto_install_instagrapi():
    """Install instagrapi via pip with multiple fallback strategies."""
    sys.stderr.write("[InstagrapiBridge] Auto-installing instagrapi...\n")
    sys.stderr.flush()
    install_cmds = [
        [sys.executable, "-m", "pip", "install", "instagrapi", "--break-system-packages", "--user", "--no-warn-script-location"],
        [sys.executable, "-m", "pip", "install", "instagrapi", "--break-system-packages", "--no-warn-script-location"],
        [sys.executable, "-m", "pip", "install", "instagrapi", "--user", "--no-warn-script-location"],
    ]
    for cmd in install_cmds:
        try:
            subprocess.check_call(cmd, timeout=120)
            sys.stderr.write("[InstagrapiBridge] pip install succeeded.\n")
            sys.stderr.flush()
            break
        except Exception as e:
            sys.stderr.write(f"[InstagrapiBridge] pip attempt failed ({e}), trying next...\n")
            continue

    # Force refresh sys.path after install
    _ensure_site_packages_on_path()
    # Clear any cached import failures
    importlib.invalidate_caches()

# Step 1: Ensure site-packages are visible
_ensure_site_packages_on_path()

# Step 2: Try importing instagrapi
try:
    from instagrapi import Client
    from instagrapi.exceptions import (
        TwoFactorRequired,
        BadPassword,
        PleaseWaitFewMinutes,
        LoginRequired,
        ChallengeRequired,
        UserNotFound,
    )
except ImportError:
    # Step 3: Install and retry
    _auto_install_instagrapi()
    try:
        from instagrapi import Client
        from instagrapi.exceptions import (
            TwoFactorRequired,
            BadPassword,
            PleaseWaitFewMinutes,
            LoginRequired,
            ChallengeRequired,
            UserNotFound,
        )
    except ImportError as final_err:
        sys.stderr.write(f"[InstagrapiBridge] FATAL: Could not import instagrapi after install: {final_err}\n")
        sys.stderr.write(f"[InstagrapiBridge] sys.path = {sys.path}\n")
        sys.stderr.write(f"[InstagrapiBridge] sys.executable = {sys.executable}\n")
        sys.stderr.flush()
        sys.exit(1)

import json
import argparse
import tempfile
import traceback
import time
import random
import ssl
import urllib3
import requests
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# ──────────────────────────────────────────────────────────────────────────
# GLOBAL SSL & PROXY CERTIFICATE BYPASS (Fix CertificateVerifyError on proxies)
# ──────────────────────────────────────────────────────────────────────────
os.environ["PYTHONHTTPSVERIFY"] = "0"
os.environ["CURL_CA_BUNDLE"] = ""
os.environ["REQUESTS_CA_BUNDLE"] = ""

# 1. Force global Python SSL context to unverified (allows proxy MITM / residential proxy SSL)
try:
    ssl._create_default_https_context = ssl._create_unverified_context
    ssl.create_default_context = ssl._create_unverified_context
except Exception:
    pass

# 2. Suppress all InsecureRequestWarning / SSL warnings
try:
    urllib3.disable_warnings()
except Exception:
    pass

# 3. Globally monkeypatch requests.Session and HTTPAdapter to always force verify=False
try:
    _orig_session_send = requests.Session.send
    def _unverified_session_send(self, request, **kwargs):
        kwargs['verify'] = False
        return _orig_session_send(self, request, **kwargs)
    requests.Session.send = _unverified_session_send

    _orig_session_request = requests.Session.request
    def _unverified_session_request(self, method, url, **kwargs):
        kwargs['verify'] = False
        return _orig_session_request(self, method, url, **kwargs)
    requests.Session.request = _unverified_session_request

    import requests.adapters
    requests.adapters.HTTPAdapter.cert_verify = lambda self, conn, url, verify, cert: None
except Exception:
    pass

# 4. Also patch curl_cffi if present
try:
    import curl_cffi.requests as curl_requests
    _orig_curl_request = curl_requests.Session.request
    def _unverified_curl_request(self, method, url, **kwargs):
        kwargs['verify'] = False
        return _orig_curl_request(self, method, url, **kwargs)
    curl_requests.Session.request = _unverified_curl_request
except Exception:
    pass

# ──────────────────────────────────────────────────────────────────────────
# ANTI-DETECTION: Realistic device fingerprint & client configuration
# ──────────────────────────────────────────────────────────────────────────
DEVICE_SETTINGS = {
    "app_version": "269.0.0.18.75",
    "android_version": 31,
    "android_release": "12",
    "dpi": "440dpi",
    "resolution": "1080x2400",
    "manufacturer": "Samsung",
    "device": "SM-G991B",
    "model": "o1s",
    "cpu": "exynos2100",
    "version_code": "314665256",
}

# Realistic Indian locale/timezone pool — randomly pick one per session
LOCALE_POOL = [
    {"locale": "en_IN", "timezone_offset": 19800, "country_code": 91, "country": "IN"},
    {"locale": "hi_IN", "timezone_offset": 19800, "country_code": 91, "country": "IN"},
    {"locale": "mr_IN", "timezone_offset": 19800, "country_code": 91, "country": "IN"},
]

# Global client and state
cl = Client()
# Increase default timeout to prevent dropping slow requests
cl.request_timeout = 25

# Force requests transport and verify=False
try:
    cl.private_transport = "requests"
    cl.public_transport = "requests"
except Exception:
    pass

try:
    if hasattr(cl, "private"):
        cl.private.verify = False
    if hasattr(cl, "public"):
        cl.public.verify = False
except Exception:
    pass

# Apply device fingerprint for stealth
cl.set_device(DEVICE_SETTINGS)
_chosen_locale = random.choice(LOCALE_POOL)
cl.set_locale(_chosen_locale["locale"])
cl.set_timezone_offset(_chosen_locale["timezone_offset"])
cl.set_country_code(_chosen_locale["country_code"])
cl.set_country(_chosen_locale["country"])

# Generate a realistic User-Agent instead of default instagrapi one
try:
    ua = cl.set_user_agent()
    sys.stderr.write(f"[InstagrapiBridge] Device UA set: {ua[:60]}...\n")
except Exception:
    pass

# ──────────────────────────────────────────────────────────────────────────
# ANTI-DETECTION: Proxy Support (Residential proxy recommended)
# Priority: 1) INSTAGRAM_PROXY  2) Auto-detect from ZENROWS_API_KEY  3) Direct IP
# ──────────────────────────────────────────────────────────────────────────
_proxy_url = os.environ.get("INSTAGRAM_PROXY", "").strip()

# Auto-configure from ZenRows if no explicit proxy set
if not _proxy_url:
    _zenrows_key = (os.environ.get("ZENROWS_API_KEY") or os.environ.get("ZENROWS_KEY") or "").strip()
    if _zenrows_key:
        # ZenRows residential proxy endpoint with Indian IP for realistic geolocation
        _proxy_url = f"http://{_zenrows_key}:premium_proxy=true&proxy_country=in@proxy.zenrows.com:8001"
        sys.stderr.write("[InstagrapiBridge] 🌐 Auto-configured proxy from ZENROWS_API_KEY (Indian residential IP)\n")

if _proxy_url:
    try:
        cl.set_proxy(_proxy_url)
        # Ensure verify=False is preserved after proxy setup
        if hasattr(cl, "private"):
            cl.private.verify = False
        if hasattr(cl, "public"):
            cl.public.verify = False
        # Mask credentials in log
        _masked = _proxy_url[:20] + "..." if len(_proxy_url) > 20 else _proxy_url
        sys.stderr.write(f"[InstagrapiBridge] 🌐 Proxy active: {_masked}\n")
    except Exception as e:
        sys.stderr.write(f"[InstagrapiBridge] ⚠️ Proxy setup failed: {e}\n")
else:
    sys.stderr.write("[InstagrapiBridge] ⚠️ No proxy set. Using direct IP (risky for datacenter IPs).\n")
    sys.stderr.write("[InstagrapiBridge] 💡 Set ZENROWS_API_KEY or INSTAGRAM_PROXY in .env for stealth.\n")

# ──────────────────────────────────────────────────────────────────────────
# ANTI-DETECTION: Session Warm-Up — Browse feed after login to look organic
# ──────────────────────────────────────────────────────────────────────────
_session_warmed_up = False

def warm_up_session():
    """Browse timeline & reels after login to appear as normal user activity."""
    global _session_warmed_up
    if _session_warmed_up:
        return
    try:
        sys.stderr.write("[InstagrapiBridge] 🏋️ Session warm-up: Browsing timeline...\n")
        # 1. Fetch own profile info (like opening app)
        time.sleep(random.uniform(1.0, 2.5))
        cl.account_info()

        # 2. Browse timeline feed (like scrolling on home)
        time.sleep(random.uniform(2.0, 4.0))
        try:
            medias = cl.get_timeline_feed()
            sys.stderr.write(f"[InstagrapiBridge] 📱 Timeline loaded ({len(medias.get('feed_items', []))} items)\n")
        except Exception:
            pass

        # 3. Check direct inbox count (like tapping DM icon)
        time.sleep(random.uniform(1.5, 3.0))
        try:
            cl.direct_threads(amount=3)
            sys.stderr.write("[InstagrapiBridge] 💬 DM inbox peeked\n")
        except Exception:
            pass

        # 4. Small idle pause (like reading a post)
        time.sleep(random.uniform(2.0, 5.0))

        _session_warmed_up = True
        sys.stderr.write("[InstagrapiBridge] ✅ Session warm-up complete — organic activity recorded\n")
    except Exception as e:
        sys.stderr.write(f"[InstagrapiBridge] ⚠️ Warm-up notice: {e}\n")
        _session_warmed_up = True  # Don't retry endlessly

# ──────────────────────────────────────────────────────────────────────────
# ANTI-DETECTION: Sleep Schedule (12AM-5AM IST = No outgoing actions)
# Inbox polling still allowed (messages are queued, replied after wake-up)
# ──────────────────────────────────────────────────────────────────────────
def is_sleep_hours() -> bool:
    """Returns True if current IST time is between 12AM and 5AM (bot should sleep)."""
    try:
        from datetime import datetime, timezone, timedelta
        ist = timezone(timedelta(hours=5, minutes=30))
        now_ist = datetime.now(ist)
        hour = now_ist.hour
        return hour >= 0 and hour < 5
    except Exception:
        return False

def get_ist_hour() -> int:
    """Returns current hour in IST."""
    try:
        from datetime import datetime, timezone, timedelta
        ist = timezone(timedelta(hours=5, minutes=30))
        return datetime.now(ist).hour
    except Exception:
        return 12  # Safe default (daytime)

# ──────────────────────────────────────────────────────────────────────────
# ANTI-DETECTION: Daily Action Budget Tracker
# Tracks total daily searches, DMs, likes, follows across the day
# ──────────────────────────────────────────────────────────────────────────
_daily_action_counts: dict = {}  # action_type -> {"date": "YYYY-MM-DD", "count": int}
_last_dm_sent_time: float = 0.0      # Timestamp of last sent DM to enforce 30-60s inter-DM gap
_last_upload_time: float = 0.0       # Timestamp of last media upload (cooldown 5-10 min)
_last_follow_time: float = 0.0       # Timestamp of last follow (2-5 min gap to prevent mass-follow ban)
_last_unfollow_time: float = 0.0     # Timestamp of last unfollow (2-5 min gap)
_DAILY_LIMITS = {
    "search": 20,
    "dm_send": 30,
    "like": 50,
    "follow": 25,       # Max 20-30 follows/day
    "unfollow": 25,     # Max 20-30 unfollows/day
    "comment": 15,
    "user_info": 30,
    "hashtag_search": 15, # Max 15 hashtag searches/day
    "post_upload": 3,   # Max 2-3 posts/reels per day (anti-ban safety)
    "story_upload": 5,  # Max 5 stories per day
    "inbox_check": 500,  # generous for polling
}

def enforce_post_upload_cooldown(is_story: bool = False):
    """
    Enforce 5 to 10 minutes total silence/sleep after post/reel upload.
    For stories: 2 to 4 minutes silence.
    This simulates a human putting their phone away after posting.
    """
    global _last_upload_time
    _last_upload_time = time.time()
    sleep_sec = random.uniform(120.0, 240.0) if is_story else random.uniform(300.0, 600.0)
    mins = sleep_sec / 60.0
    label = "Story" if is_story else "Post/Reel"
    sys.stderr.write(f"[HumanSim] 🤫 {label} uploaded. Bot entering deep silence for {mins:.1f} min ({int(sleep_sec)}s) like a real human...\n")
    time.sleep(sleep_sec)

def _today_str() -> str:
    from datetime import datetime, timezone, timedelta
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).strftime("%Y-%m-%d")

def check_daily_budget(action: str) -> tuple:
    """Returns (allowed: bool, remaining: int, limit: int)."""
    limit = _DAILY_LIMITS.get(action, 100)
    today = _today_str()
    entry = _daily_action_counts.get(action)
    if not entry or entry["date"] != today:
        return (True, limit, limit)
    remaining = limit - entry["count"]
    return (remaining > 0, max(0, remaining), limit)

def record_daily_action(action: str):
    """Record that an action was performed today."""
    today = _today_str()
    entry = _daily_action_counts.get(action)
    if not entry or entry["date"] != today:
        _daily_action_counts[action] = {"date": today, "count": 1}
    else:
        entry["count"] += 1

# ──────────────────────────────────────────────────────────────────────────
# HUMAN SIMULATION ENGINE: Character-by-character typing, word gaps,
# action-specific delays — makes every API call feel human-operated
# ──────────────────────────────────────────────────────────────────────────

def simulate_typing(text: str, label: str = "message") -> float:
    """
    Simulate character-by-character typing with realistic delays.
    Returns total time spent 'typing' in seconds.
    - Per character: 70-150ms (average human typing speed)
    - Word gap pause: 200-500ms (thinking between words)
    - Comma/period pause: 300-700ms (natural punctuation pause)
    - Occasional 'thinking' pause: 800-2000ms (every 4-8 words)
    """
    if not text:
        return 0.0

    total_delay = 0.0
    word_count = 0
    chars = list(text)

    for i, ch in enumerate(chars):
        # Per-character delay: 70-150ms
        char_delay = random.uniform(0.07, 0.15)
        total_delay += char_delay

        # Word boundary: extra pause between words
        if ch == ' ':
            word_count += 1
            word_gap = random.uniform(0.2, 0.5)
            total_delay += word_gap

            # Every 4-8 words: longer "thinking" pause (like real human pausing to think)
            if word_count > 0 and word_count % random.randint(4, 8) == 0:
                think_pause = random.uniform(0.8, 2.0)
                total_delay += think_pause

        # Punctuation pause (comma, period, question mark)
        elif ch in (',', '.', '?', '!', ';', ':'):
            punct_pause = random.uniform(0.3, 0.7)
            total_delay += punct_pause

        # Emoji: slight pause (selecting from emoji keyboard)
        elif ord(ch) > 0x1F000:
            emoji_pause = random.uniform(0.5, 1.2)
            total_delay += emoji_pause

    # Cap total delay at reasonable bounds
    total_delay = min(total_delay, 25.0)  # Max 25 seconds for very long messages
    total_delay = max(total_delay, 0.5)   # Min 0.5 seconds

    sys.stderr.write(f"[HumanSim] ⌨️ Typing '{label}' ({len(text)} chars, {word_count} words): {total_delay:.1f}s\n")
    time.sleep(total_delay)
    return total_delay


def simulate_search_typing(query: str) -> float:
    """
    Simulate typing a search query character by character,
    like a human typing in the Instagram search bar.
    Slower than regular typing (each letter typed, results load, read, type more).
    """
    if not query:
        return 0.0

    total_delay = 0.0

    # Tap on search icon delay
    tap_delay = random.uniform(0.3, 0.8)
    total_delay += tap_delay
    time.sleep(tap_delay)

    # Type each character with pauses to "read" auto-complete results
    for i, ch in enumerate(query):
        # Per character: 90-200ms (slower than regular typing — reading results)
        char_delay = random.uniform(0.09, 0.20)
        total_delay += char_delay
        time.sleep(char_delay)

        # After every 2-3 characters: pause to scan autocomplete results (500-1500ms)
        if (i + 1) % random.randint(2, 3) == 0 and i < len(query) - 1:
            scan_delay = random.uniform(0.5, 1.5)
            total_delay += scan_delay
            time.sleep(scan_delay)

    # Final pause: reading the full results before selecting (1-3s)
    read_results = random.uniform(1.0, 3.0)
    total_delay += read_results
    time.sleep(read_results)

    sys.stderr.write(f"[HumanSim] 🔍 Search typed '{query}' ({len(query)} chars): {total_delay:.1f}s total\n")
    return total_delay


def simulate_action_delay(action: str, context: str = "") -> float:
    """
    Central human simulation delay for any Instagram action.
    Each action type has its own realistic timing pattern.
    """
    delays = {
        # DM: Open chat → read message → start typing (2-5s)
        "dm_read": (2.0, 5.0),
        # DM: After typing, tap send button (0.3-0.8s)
        "dm_send_tap": (0.3, 0.8),
        # Like: Scroll to post → look at it → double-tap (1.5-4s)
        "like": (1.5, 4.0),
        # Comment: Read post → tap comment → type (1-3s before typing)
        "comment_open": (1.0, 3.0),
        # Follow: Browse profile → read bio → tap follow (2-5s)
        "follow_browse": (2.0, 5.0),
        # Unfollow: Open profile → find button → tap (1.5-3.5s)
        "unfollow_browse": (1.5, 3.5),
        # Profile view: Tap username → wait for profile load (1-3s)
        "profile_load": (1.0, 3.0),
        # Profile scroll: Browse posts/bio (2-5s)
        "profile_scroll": (2.0, 5.0),
        # Feed browse: Scroll through feed items (1-3s per item)
        "feed_scroll": (1.0, 3.0),
        # Inbox open: Tap DM icon → wait for threads load (1-2.5s)
        "inbox_open": (1.0, 2.5),
        # Mark seen: Open thread → read message (1.5-4s)
        "mark_seen": (1.5, 4.0),
        # Search: Tap search → wait for UI (0.5-1.5s, before typing query)
        "search_open": (0.5, 1.5),
        # User feed: Scroll through posts grid (1.5-3s)
        "user_feed_browse": (1.5, 3.0),
        # Followers list: Tap followers → wait for load (1-2.5s)
        "followers_load": (1.0, 2.5),
    }

    min_d, max_d = delays.get(action, (1.0, 3.0))
    delay = random.uniform(min_d, max_d)

    ctx_str = f" ({context})" if context else ""
    sys.stderr.write(f"[HumanSim] 🧑 {action}{ctx_str}: {delay:.1f}s delay\n")
    time.sleep(delay)
    return delay

# ──────────────────────────────────────────────────────────────────────────
# HUMAN RESOLVE USER (Anti-Warning / Anti-Detection):
# Instead of calling user_id_from_username directly (triggers automation flag):
# 1. First search for the username via cl.search_users() like human typing
# 2. Wait 3 seconds (reading search results dropdown)
# 3. Extract pk from search match without direct query
# ──────────────────────────────────────────────────────────────────────────
def safe_resolve_user(username: str):
    clean = username.strip().replace("@", "")
    if clean.isdigit():
        return type("UserPk", (), {"pk": int(clean), "username": clean})()

    sys.stderr.write(f"[HumanSim] 🔍 Simulating search bar lookup for '@{clean}' before resolving ID...\n")
    # Step 1: Simulate search typing
    simulate_search_typing(clean)

    user_match = None
    try:
        results = cl.search_users(clean)
        for u in results:
            if getattr(u, "username", "").lower() == clean.lower():
                user_match = u
                break
        if not user_match and results:
            user_match = results[0]
    except Exception as e:
        sys.stderr.write(f"[HumanSim] ⚠️ Search pre-lookup notice: {e}\n")

    # Step 2: 3-second dwell pause (like real human viewing search results dropdown)
    dwell = random.uniform(2.5, 3.8)
    sys.stderr.write(f"[HumanSim] 👀 Reading search dropdown results for {dwell:.1f}s...\n")
    time.sleep(dwell)

    # Step 3: If found in search results, return match
    if user_match and hasattr(user_match, "pk"):
        return user_match

    # Step 4: Fallback to user_info_by_username if not in top results
    try:
        time.sleep(random.uniform(1.0, 2.0))
        return cl.user_info_by_username(clean)
    except Exception:
        pk = cl.user_id_from_username(clean)
        return type("UserPk", (), {"pk": int(pk), "username": clean})()

# ──────────────────────────────────────────────────────────────────────────
# SEARCH RATE LIMITER: Prevents rapid-fire search_users calls
# Max 6 searches per 5-minute window with mandatory human-like delays
# ──────────────────────────────────────────────────────────────────────────
_search_timestamps: list = []
_SEARCH_WINDOW_SEC = 300  # 5 minutes
_SEARCH_MAX_PER_WINDOW = 6
_search_cache: dict = {}       # query -> (timestamp, results)
_SEARCH_CACHE_TTL = 120        # Cache results for 2 minutes

current_status = {
    "isLoggedIn": False,
    "username": None,
    "fullName": None,
    "profilePicUrl": None,
    "pk": None,
    "requiresTwoFactor": False,
    "twoFactorInfo": None,
    "lastError": None,
}

def get_status():
    return {
        "ok": True,
        **current_status,
        "sessionSettings": cl.get_settings() if current_status["isLoggedIn"] else None,
    }

def update_logged_in_user(user_obj=None):
    current_status["isLoggedIn"] = True
    current_status["requiresTwoFactor"] = False
    current_status["twoFactorInfo"] = None
    current_status["lastError"] = None

    if user_obj:
        current_status["username"] = getattr(user_obj, "username", str(user_obj))
        current_status["fullName"] = getattr(user_obj, "full_name", current_status["username"])
        current_status["profilePicUrl"] = str(getattr(user_obj, "profile_pic_url", "")) or None
        current_status["pk"] = str(getattr(user_obj, "pk", "")) or None
    else:
        try:
            info = cl.account_info()
            current_status["username"] = info.username
            current_status["fullName"] = info.full_name or info.username
            current_status["profilePicUrl"] = str(info.profile_pic_url) if info.profile_pic_url else None
            current_status["pk"] = str(info.pk)
        except Exception:
            pass

class BridgeHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, data):
        response_bytes = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def _read_json(self):
        content_len = int(self.headers.get("Content-Length", 0))
        if content_len == 0:
            return {}
        body = self.rfile.read(content_len).decode("utf-8")
        try:
            return json.loads(body)
        except Exception:
            return {}

    def log_message(self, format, *args):
        sys.stderr.write(f"[InstagrapiBridge] {format % args}\n")

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()

    def _check_stealth_gate(self, action: str, allow_sleep_bypass: bool = False) -> dict | None:
        """Central stealth gate: sleep schedule + daily budget. Returns error dict if blocked, None if allowed."""
        # Sleep schedule check (12AM-5AM IST)
        if not allow_sleep_bypass and is_sleep_hours():
            hour = get_ist_hour()
            return {
                "ok": False,
                "error": f"🌙 Sleep mode active (IST {hour}:00). Bot is sleeping 12AM-5AM to avoid detection.",
                "sleepMode": True,
                "istHour": hour,
            }
        # Daily budget check
        allowed, remaining, limit = check_daily_budget(action)
        if not allowed:
            return {
                "ok": False,
                "error": f"📊 Daily {action} budget exhausted ({limit}/{limit} used today). Resets at midnight IST.",
                "budgetExhausted": True,
                "action": action,
                "limit": limit,
            }
        return None  # All clear

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path in ("/health", "/status"):
            # Include stealth status info
            status = get_status()
            status["stealthMode"] = {
                "sleepActive": is_sleep_hours(),
                "istHour": get_ist_hour(),
                "dailyBudgets": {k: check_daily_budget(k) for k in _DAILY_LIMITS},
                "proxyActive": bool(_proxy_url),
                "sessionWarmedUp": _session_warmed_up,
            }
            self._send_json(200, status)
            return

        if path == "/inbox":
            if not current_status["isLoggedIn"]:
                self._send_json(200, {"ok": True, "threads": [], "message": "Not logged in"})
                return
            # Inbox polling is allowed during sleep (to not miss messages) but budget-tracked
            gate = self._check_stealth_gate("inbox_check", allow_sleep_bypass=True)
            if gate:
                self._send_json(429, gate)
                return
            try:
                record_daily_action("inbox_check")
                simulate_action_delay("inbox_open")
                threads_raw = cl.direct_threads(amount=15)
                threads_data = []
                for t in threads_raw:
                    users_list = []
                    for u in getattr(t, "users", []):
                        users_list.append({
                            "pk": str(getattr(u, "pk", "")),
                            "username": getattr(u, "username", ""),
                            "full_name": getattr(u, "full_name", ""),
                            "profile_pic_url": str(getattr(u, "profile_pic_url", "")),
                        })

                    messages_list = []
                    for m in getattr(t, "messages", []):
                        messages_list.append({
                            "id": str(getattr(m, "id", "")),
                            "user_id": str(getattr(m, "user_id", "")),
                            "text": getattr(m, "text", "") or "",
                            "timestamp": int(getattr(m, "timestamp", 0).timestamp() * 1000) if hasattr(getattr(m, "timestamp", None), "timestamp") else int(getattr(m, "timestamp", 0)),
                            "item_type": getattr(m, "item_type", "text"),
                        })

                    threads_data.append({
                        "id": str(getattr(t, "id", "")),
                        "thread_id": str(getattr(t, "id", "")),
                        "title": getattr(t, "thread_title", "") or (users_list[0]["username"] if users_list else "Thread"),
                        "users": users_list,
                        "messages": messages_list,
                        "muted": getattr(t, "muted", False),
                        "is_group": getattr(t, "is_group", False),
                    })

                self._send_json(200, {"ok": True, "threads": threads_data})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e), "threads": []})
            return

        if path == "/pending_inbox":
            if not current_status["isLoggedIn"]:
                self._send_json(200, {"ok": True, "threads": []})
                return
            try:
                simulate_action_delay("inbox_open")
                threads_raw = cl.direct_pending_inbox(amount=10)
                threads_data = []
                for t in threads_raw:
                    threads_data.append({
                        "id": str(getattr(t, "id", "")),
                        "users": [{"pk": str(getattr(u, "pk", "")), "username": getattr(u, "username", "")} for u in getattr(t, "users", [])],
                    })
                self._send_json(200, {"ok": True, "threads": threads_data})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e), "threads": []})
            return

        if path == "/user-info":
            username = query.get("username", [""])[0].strip().replace("@", "")
            if not username:
                self._send_json(400, {"ok": False, "error": "username query parameter is required"})
                return
            gate = self._check_stealth_gate("user_info")
            if gate:
                self._send_json(429, gate)
                return
            try:
                record_daily_action("user_info")
                # ── HUMAN LOOKUP: Search users first → 3s dwell → extract profile ──
                user_obj = safe_resolve_user(username)
                user_pk = int(user_obj.pk)
                
                # Fetch complete profile info with organic delay
                time.sleep(random.uniform(1.0, 2.0))
                try:
                    user = cl.user_info(user_pk)
                except Exception:
                    user = user_obj

                self._send_json(200, {
                    "ok": True,
                    "user": {
                        "pk": str(getattr(user, "pk", user_pk)),
                        "username": getattr(user, "username", username),
                        "full_name": getattr(user, "full_name", getattr(user, "username", username)),
                        "profile_pic_url": str(getattr(user, "profile_pic_url", "")) if getattr(user, "profile_pic_url", None) else None,
                        "is_private": getattr(user, "is_private", False),
                        "is_verified": getattr(user, "is_verified", False),
                        "media_count": getattr(user, "media_count", 0),
                        "follower_count": getattr(user, "follower_count", 0),
                        "following_count": getattr(user, "following_count", 0),
                        "biography": getattr(user, "biography", ""),
                    }
                })
            except Exception as e:
                self._send_json(404, {"ok": False, "error": str(e)})
            return

        if path == "/user-feed":
            username = query.get("username", [""])[0].strip().replace("@", "")
            amount = int(query.get("amount", [6])[0])
            if not username:
                self._send_json(400, {"ok": False, "error": "username is required"})
                return
            try:
                user_obj = safe_resolve_user(username)
                user_pk = int(user_obj.pk)
                simulate_action_delay("user_feed_browse", username)
                medias = cl.user_medias(user_pk, amount=amount)
                posts = []
                for m in medias:
                    posts.append({
                        "id": str(m.id),
                        "code": getattr(m, "code", ""),
                        "caption": getattr(m, "caption_text", "") or "",
                        "likeCount": getattr(m, "like_count", 0),
                        "commentCount": getattr(m, "comment_count", 0),
                        "mediaType": "Video/Reel" if getattr(m, "media_type", 1) == 2 else "Photo",
                        "postUrl": f"https://www.instagram.com/p/{getattr(m, 'code', '')}/",
                    })
                self._send_json(200, {"ok": True, "posts": posts})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if path == "/user-followers":
            username = query.get("username", [""])[0].strip().replace("@", "")
            amount = int(query.get("amount", [15])[0])
            if not username:
                self._send_json(400, {"ok": False, "error": "username is required"})
                return
            try:
                user_obj = safe_resolve_user(username)
                user_pk = int(user_obj.pk)
                simulate_action_delay("followers_load", username)
                followers_dict = cl.user_followers(user_pk, amount=amount)
                followers = []
                for _, u in followers_dict.items():
                    followers.append({
                        "pk": str(getattr(u, "pk", "")),
                        "username": getattr(u, "username", ""),
                        "fullName": getattr(u, "full_name", ""),
                        "profilePicUrl": str(getattr(u, "profile_pic_url", "")),
                        "isVerified": getattr(u, "is_verified", False),
                    })
                self._send_json(200, {"ok": True, "followers": followers})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if path == "/search":
            q = query.get("query", [""])[0].strip()
            if not q:
                self._send_json(400, {"ok": False, "error": "query parameter is required"})
                return
            # ── STEALTH GATE: Sleep + daily budget ──
            gate = self._check_stealth_gate("search")
            if gate:
                self._send_json(429, gate)
                return

            # ── ANTI-DETECTION: Search rate-limiting ──
            global _search_timestamps, _search_cache
            now = time.time()

            # Clean old timestamps outside the window
            _search_timestamps = [t for t in _search_timestamps if now - t < _SEARCH_WINDOW_SEC]

            if len(_search_timestamps) >= _SEARCH_MAX_PER_WINDOW:
                wait_until = _search_timestamps[0] + _SEARCH_WINDOW_SEC
                wait_sec = int(wait_until - now) + 1
                self._send_json(429, {
                    "ok": False,
                    "error": f"Search rate limit: max {_SEARCH_MAX_PER_WINDOW} searches per {_SEARCH_WINDOW_SEC // 60} min. Retry in {wait_sec}s.",
                    "retryAfterSec": wait_sec,
                })
                return

            # ── ANTI-DETECTION: Check cache first (avoid duplicate API calls) ──
            q_lower = q.lower()
            if q_lower in _search_cache:
                cached_time, cached_results = _search_cache[q_lower]
                if now - cached_time < _SEARCH_CACHE_TTL:
                    sys.stderr.write(f"[InstagrapiBridge] Search cache hit for '{q}'\n")
                    self._send_json(200, {"ok": True, "users": cached_results, "cached": True})
                    return

            try:
                # ── HUMAN SIMULATION: Type query letter-by-letter with pauses ──
                simulate_search_typing(q)

                users = cl.search_users(q)
                results = []
                for u in users[:10]:
                    results.append({
                        "pk": str(u.pk),
                        "username": u.username,
                        "full_name": u.full_name,
                        "profile_pic_url": str(u.profile_pic_url) if u.profile_pic_url else None,
                        "is_private": u.is_private,
                        "is_verified": u.is_verified,
                    })

                # Record timestamp, cache results & daily budget
                _search_timestamps.append(now)
                _search_cache[q_lower] = (now, results)
                record_daily_action("search")

                self._send_json(200, {"ok": True, "users": results})
            except PleaseWaitFewMinutes as e:
                sys.stderr.write(f"[InstagrapiBridge] ⚠️ Instagram rate-limit hit on search: {e}\n")
                self._send_json(429, {
                    "ok": False,
                    "error": f"Instagram rate-limited: {str(e)}. Please wait a few minutes.",
                    "rateLimited": True,
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        # ── HASHTAG SEARCH (Rate limited: Amount strictly capped at 10-20, human search typing) ──
        if path == "/hashtag-medias":
            hashtag = query.get("hashtag", [""])[0].strip().replace("#", "")
            if not hashtag:
                self._send_json(400, {"ok": False, "error": "hashtag query parameter is required"})
                return

            gate = self._check_stealth_gate("hashtag_search")
            if gate:
                self._send_json(429, gate)
                return

            # Human solution: Cap amount at 10-20 to avoid sudden server load / bot detection
            req_amount = int(query.get("amount", [10])[0])
            amount = max(1, min(req_amount, 20))  # strictly capped between 1 and 20

            tab_type = query.get("tab", ["top"])[0].strip().lower()

            try:
                record_daily_action("hashtag_search")
                # ── HUMAN SIMULATION: Type hashtag in search bar letter-by-letter ──
                simulate_search_typing(f"#{hashtag}")

                # 2-4 second dwell pause scanning hashtag results
                dwell = random.uniform(2.0, 4.0)
                sys.stderr.write(f"[HumanSim] 🏷️ Viewing #{hashtag} posts grid for {dwell:.1f}s (amount={amount})...\n")
                time.sleep(dwell)

                if tab_type == "recent":
                    medias = cl.hashtag_medias_recent(hashtag, amount=amount)
                else:
                    medias = cl.hashtag_medias_top(hashtag, amount=amount)

                posts = []
                for m in medias:
                    posts.append({
                        "id": str(getattr(m, "id", "")),
                        "code": getattr(m, "code", ""),
                        "caption": getattr(m, "caption_text", "") or "",
                        "likeCount": getattr(m, "like_count", 0),
                        "commentCount": getattr(m, "comment_count", 0),
                        "mediaType": "Video/Reel" if getattr(m, "media_type", 1) == 2 else "Photo",
                        "postUrl": f"https://www.instagram.com/p/{getattr(m, 'code', '')}/",
                        "user": {
                            "pk": str(getattr(getattr(m, "user", None), "pk", "")),
                            "username": getattr(getattr(m, "user", None), "username", ""),
                            "fullName": getattr(getattr(m, "user", None), "full_name", ""),
                        }
                    })

                self._send_json(200, {"ok": True, "hashtag": hashtag, "amount": len(posts), "posts": posts})
            except PleaseWaitFewMinutes as e:
                self._send_json(429, {"ok": False, "error": f"Instagram rate-limited: {str(e)}", "rateLimited": True})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if path == "/hashtag-info":
            hashtag = query.get("hashtag", [""])[0].strip().replace("#", "")
            if not hashtag:
                self._send_json(400, {"ok": False, "error": "hashtag query parameter is required"})
                return
            try:
                simulate_action_delay("profile_load", f"#{hashtag}")
                h_info = cl.hashtag_info(hashtag)
                self._send_json(200, {
                    "ok": True,
                    "hashtag": {
                        "name": getattr(h_info, "name", hashtag),
                        "mediaCount": getattr(h_info, "media_count", 0),
                        "profilePicUrl": str(getattr(h_info, "profile_pic_url", "")),
                    }
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        self._send_json(404, {"ok": False, "error": f"Path not found: {path}"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json()

        if path == "/restore-session":
            session_data = body.get("session")
            if not session_data:
                self._send_json(400, {"ok": False, "error": "session data is required"})
                return
            try:
                if isinstance(session_data, str):
                    session_data = json.loads(session_data)
                cl.set_settings(session_data)
                try:
                    info = cl.account_info()
                    update_logged_in_user(info)
                    uname = info.username
                except Exception:
                    update_logged_in_user()
                    uname = current_status.get("username") or "user"
                # ── ANTI-DETECTION: Warm-up after session restore ──
                import threading
                threading.Thread(target=warm_up_session, daemon=True).start()
                self._send_json(200, {"ok": True, "message": f"Session restored for @{uname}", "status": get_status()})
            except Exception as e:
                current_status["isLoggedIn"] = False
                current_status["lastError"] = str(e)
                self._send_json(401, {"ok": False, "error": f"Session restore failed: {str(e)}"})
            return

        if path == "/login-session":
            session_id = body.get("sessionId", "").strip()
            if not session_id:
                self._send_json(400, {"ok": False, "error": "sessionId is required"})
                return
            if session_id.startswith("sessionid="):
                session_id = session_id[len("sessionid="):].strip()
            session_id = session_id.strip("\"'")

            try:
                # ── Direct Session Cookie & Authorization Injection (Bypasses fragile users/info endpoint) ──
                if "%3A" in session_id:
                    uid = session_id.split("%3A")[0]
                elif ":" in session_id:
                    uid = session_id.split(":")[0]
                else:
                    uid = session_id

                settings = cl.get_settings()
                if not isinstance(settings, dict):
                    settings = {}
                settings["authorization_data"] = {
                    "sessionid": session_id,
                    "ds_user_id": str(uid),
                }
                cl.set_settings(settings)
                cl.user_id = str(uid)

                # Inject cookies directly into requests sessions for all transports
                for session_obj in [getattr(cl, "private", None), getattr(cl, "public", None)]:
                    if session_obj and hasattr(session_obj, "cookies"):
                        try:
                            session_obj.cookies.set("sessionid", session_id, domain=".instagram.com", path="/")
                            session_obj.cookies.set("ds_user_id", str(uid), domain=".instagram.com", path="/")
                        except Exception:
                            pass

                # Fetch account information using standard accounts/current_user endpoint
                u_name = f"user_{uid}"
                f_name = u_name
                p_pic = None

                try:
                    info = cl.account_info()
                    update_logged_in_user(info)
                    u_name = info.username
                    f_name = info.full_name or u_name
                    p_pic = str(info.profile_pic_url) if info.profile_pic_url else None
                except Exception as acc_err:
                    sys.stderr.write(f"[InstagrapiBridge] Notice: account_info gentle warning ({acc_err}), using session ID user {uid}\n")
                    update_logged_in_user()
                    u_name = current_status.get("username") or u_name
                    f_name = current_status.get("fullName") or u_name
                    p_pic = current_status.get("profilePicUrl")

                current_status["isLoggedIn"] = True
                current_status["userId"] = str(uid)
                current_status["username"] = u_name
                current_status["fullName"] = f_name
                current_status["lastError"] = None

                # ── ANTI-DETECTION: Warm-up after session login ──
                import threading
                threading.Thread(target=warm_up_session, daemon=True).start()

                self._send_json(200, {
                    "ok": True,
                    "message": f"Logged in via session ID as @{u_name}",
                    "username": u_name,
                    "fullName": f_name,
                    "profilePicUrl": p_pic,
                    "sessionSettings": cl.get_settings(),
                })
            except Exception as e:
                current_status["isLoggedIn"] = False
                current_status["lastError"] = str(e)
                self._send_json(401, {"ok": False, "error": f"Login by session ID failed: {str(e)}"})
            return

        if path == "/login":
            username = body.get("username", "").strip().replace("@", "")
            password = body.get("password", "")
            verification_code = body.get("verificationCode", "").strip()

            if not username:
                self._send_json(400, {"ok": False, "error": "username is required"})
                return

            try:
                if verification_code:
                    cl.login(username, password, verification_code=verification_code)
                else:
                    cl.login(username, password)

                info = cl.account_info()
                update_logged_in_user(info)
                # ── ANTI-DETECTION: Warm-up after credential login ──
                import threading
                threading.Thread(target=warm_up_session, daemon=True).start()
                self._send_json(200, {
                    "ok": True,
                    "message": f"Logged in successfully as @{info.username}",
                    "username": info.username,
                    "fullName": info.full_name,
                    "profilePicUrl": str(info.profile_pic_url) if info.profile_pic_url else None,
                    "sessionSettings": cl.get_settings(),
                })
            except TwoFactorRequired:
                current_status["requiresTwoFactor"] = True
                current_status["twoFactorInfo"] = {
                    "username": username,
                    "message": "Two-factor authentication code required.",
                }
                self._send_json(200, {
                    "ok": False,
                    "requiresTwoFactor": True,
                    "message": "Two-factor authentication code required. Please submit OTP verification code.",
                })
            except BadPassword:
                current_status["lastError"] = "Invalid Instagram password."
                self._send_json(401, {"ok": False, "error": "Incorrect password. Please verify and try again."})
            except ChallengeRequired:
                current_status["lastError"] = "Instagram checkpoint / challenge required."
                self._send_json(403, {
                    "ok": False,
                    "error": "Instagram security challenge triggered. Please open Instagram on your phone to approve or use Session ID login."
                })
            except Exception as e:
                current_status["lastError"] = str(e)
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if path == "/logout":
            try:
                cl.logout()
            except Exception:
                pass
            current_status["isLoggedIn"] = False
            current_status["username"] = None
            current_status["fullName"] = None
            current_status["profilePicUrl"] = None
            current_status["pk"] = None
            current_status["requiresTwoFactor"] = False
            self._send_json(200, {"ok": True, "message": "Logged out successfully"})
            return

        if path == "/send-message":
            if not current_status["isLoggedIn"]:
                self._send_json(401, {"ok": False, "error": "Not logged in to Instagram"})
                return
            gate = self._check_stealth_gate("dm_send")
            if gate:
                self._send_json(429, gate)
                return

            text = body.get("message", "").strip()
            thread_id = body.get("threadId")
            recipient = body.get("recipient", "").strip().replace("@", "")

            if not text:
                self._send_json(400, {"ok": False, "error": "message is required"})
                return

            try:
                # ── ANTI-SPAM & DETECTION: Inter-DM Gap (30-60s delay rule) ──
                global _last_dm_sent_time
                now = time.time()
                if _last_dm_sent_time > 0:
                    elapsed = now - _last_dm_sent_time
                    min_gap = random.randint(30, 60)
                    if elapsed < min_gap:
                        wait_gap = min_gap - elapsed
                        sys.stderr.write(f"[HumanSim] ⏳ Inter-DM pause: sleeping {wait_gap:.1f}s (30-60s rule between DMs)...\n")
                        time.sleep(wait_gap)

                record_daily_action("dm_send")
                # ── HUMAN SIMULATION: Read chat → type message → tap send ──
                simulate_action_delay("dm_read")
                simulate_typing(text, "DM")
                simulate_action_delay("dm_send_tap")

                res = None
                if thread_id:
                    res = cl.direct_send(text, thread_ids=[str(thread_id)])
                elif recipient:
                    if recipient.isdigit():
                        res = cl.direct_send(text, user_ids=[int(recipient)])
                    else:
                        u_obj = safe_resolve_user(recipient)
                        res = cl.direct_send(text, user_ids=[int(u_obj.pk)])
                else:
                    self._send_json(400, {"ok": False, "error": "Either threadId or recipient is required"})
                    return

                _last_dm_sent_time = time.time()
                self._send_json(200, {"ok": True, "message": "Message sent successfully", "result": str(res)})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": f"Failed to send direct message: {str(e)}"})
            return

        if path == "/like":
            if not current_status["isLoggedIn"]:
                self._send_json(401, {"ok": False, "error": "Not logged in to Instagram"})
                return
            gate = self._check_stealth_gate("like")
            if gate:
                self._send_json(429, gate)
                return
            media_id = str(body.get("mediaId", "")).strip()
            if not media_id:
                self._send_json(400, {"ok": False, "error": "mediaId is required"})
                return
            try:
                record_daily_action("like")
                # ── HUMAN SIMULATION: Scroll feed → browse posts → stop on post (5-10s) → like ──
                try:
                    sys.stderr.write("[HumanSim] 📱 Browsing timeline feed before like...\n")
                    cl.get_timeline_feed()
                except Exception:
                    pass

                view_delay = random.uniform(5.0, 10.0)
                sys.stderr.write(f"[HumanSim] 👀 Viewing post for {view_delay:.1f}s before double-tap like...\n")
                time.sleep(view_delay)

                res = cl.media_like(media_id)
                self._send_json(200, {"ok": True, "message": f"Media {media_id} liked successfully", "result": res})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if path == "/comment":
            if not current_status["isLoggedIn"]:
                self._send_json(401, {"ok": False, "error": "Not logged in to Instagram"})
                return
            gate = self._check_stealth_gate("comment")
            if gate:
                self._send_json(429, gate)
                return
            media_id = str(body.get("mediaId", "")).strip()
            text = str(body.get("text", "")).strip()
            if not media_id or not text:
                self._send_json(400, {"ok": False, "error": "mediaId and text are required"})
                return
            try:
                record_daily_action("comment")
                # ── HUMAN SIMULATION: Browse feed → stop on post (5-10s) → open comment → type → post ──
                try:
                    sys.stderr.write("[HumanSim] 📱 Browsing feed before comment...\n")
                    cl.get_timeline_feed()
                except Exception:
                    pass

                view_delay = random.uniform(5.0, 10.0)
                sys.stderr.write(f"[HumanSim] 👀 Reading post for {view_delay:.1f}s before commenting...\n")
                time.sleep(view_delay)

                simulate_action_delay("comment_open")
                simulate_typing(text, "comment")
                simulate_action_delay("dm_send_tap")
                comment = cl.media_comment(media_id, text)
                self._send_json(200, {"ok": True, "message": "Comment posted successfully", "commentId": getattr(comment, "pk", "posted")})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if path == "/follow":
            if not current_status["isLoggedIn"]:
                self._send_json(401, {"ok": False, "error": "Not logged in to Instagram"})
                return
            gate = self._check_stealth_gate("follow")
            if gate:
                self._send_json(429, gate)
                return
            target = str(body.get("username", "")).strip().replace("@", "")
            if not target:
                self._send_json(400, {"ok": False, "error": "username is required"})
                return
            try:
                # ── ANTI-DETECTION: 2 to 5 Minutes Gap between Follows (Anti-Mass Follow Ban) ──
                global _last_follow_time
                now = time.time()
                if _last_follow_time > 0:
                    elapsed = now - _last_follow_time
                    min_gap = random.randint(120, 300) # 2 to 5 minutes gap
                    if elapsed < min_gap:
                        wait_gap = min_gap - elapsed
                        sys.stderr.write(f"[HumanSim] ⏳ Mass-follow safety: sleeping {wait_gap/60:.1f}m ({int(wait_gap)}s) before next follow (2-5 min rule)...\n")
                        time.sleep(wait_gap)

                record_daily_action("follow")
                # ── HUMAN SIMULATION: Search user → 3s dwell → browse profile → tap follow ──
                user_pk = int(target) if target.isdigit() else int(safe_resolve_user(target).pk)
                simulate_action_delay("follow_browse", target)
                res = cl.user_follow(user_pk)
                _last_follow_time = time.time()
                self._send_json(200, {"ok": True, "message": f"Successfully followed @{target} on Instagram", "result": res})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": f"Follow failed: {str(e)}"})
            return

        if path == "/unfollow":
            if not current_status["isLoggedIn"]:
                self._send_json(401, {"ok": False, "error": "Not logged in to Instagram"})
                return
            gate = self._check_stealth_gate("unfollow")
            if gate:
                self._send_json(429, gate)
                return
            target = str(body.get("username", "")).strip().replace("@", "")
            if not target:
                self._send_json(400, {"ok": False, "error": "username is required"})
                return
            try:
                # ── ANTI-DETECTION: 2 to 5 Minutes Gap between Unfollows ──
                global _last_unfollow_time
                now = time.time()
                if _last_unfollow_time > 0:
                    elapsed = now - _last_unfollow_time
                    min_gap = random.randint(120, 300) # 2 to 5 minutes gap
                    if elapsed < min_gap:
                        wait_gap = min_gap - elapsed
                        sys.stderr.write(f"[HumanSim] ⏳ Mass-unfollow safety: sleeping {wait_gap/60:.1f}m ({int(wait_gap)}s) before next unfollow (2-5 min rule)...\n")
                        time.sleep(wait_gap)

                record_daily_action("unfollow")
                # ── HUMAN SIMULATION: Search user → 3s dwell → open profile → tap unfollow ──
                user_pk = int(target) if target.isdigit() else int(safe_resolve_user(target).pk)
                simulate_action_delay("unfollow_browse", target)
                res = cl.user_unfollow(user_pk)
                _last_unfollow_time = time.time()
                self._send_json(200, {"ok": True, "message": f"Successfully unfollowed @{target} on Instagram", "result": res})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": f"Unfollow failed: {str(e)}"})
            return

        if path == "/mark-seen":
            if not current_status["isLoggedIn"]:
                self._send_json(401, {"ok": False, "error": "Not logged in to Instagram"})
                return
            thread_id = str(body.get("threadId", "")).strip()
            item_id = str(body.get("itemId", "")).strip()
            try:
                simulate_action_delay("mark_seen")
                if thread_id and item_id and thread_id.isdigit() and item_id.isdigit():
                    cl.direct_message_seen(int(thread_id), int(item_id))
                elif thread_id and thread_id.isdigit():
                    cl.direct_send_seen(int(thread_id))
                self._send_json(200, {"ok": True, "message": "Marked seen"})
            except Exception as e:
                self._send_json(200, {"ok": False, "error": str(e)})
            return

        # ── MEDIA UPLOADS (Rate limited: Max 2-3 posts/day, 5-10 min post-upload silence) ──
        if path == "/upload-photo":
            if not current_status["isLoggedIn"]:
                self._send_json(401, {"ok": False, "error": "Not logged in to Instagram"})
                return
            gate = self._check_stealth_gate("post_upload")
            if gate:
                self._send_json(429, gate)
                return
            file_path = body.get("path", "").strip()
            caption = body.get("caption", "").strip()
            if not file_path or not os.path.exists(file_path):
                self._send_json(400, {"ok": False, "error": f"Valid file path required. Found: {file_path}"})
                return
            try:
                record_daily_action("post_upload")
                if caption:
                    simulate_typing(caption, "photo caption")
                media = cl.photo_upload(file_path, caption=caption)
                import threading
                threading.Thread(target=enforce_post_upload_cooldown, args=(False,), daemon=True).start()
                self._send_json(200, {
                    "ok": True,
                    "message": "Photo uploaded successfully! Entering 5-10 min post-upload rest.",
                    "mediaId": str(getattr(media, "pk", "")),
                    "code": str(getattr(media, "code", "")),
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": f"Photo upload failed: {str(e)}"})
            return

        if path == "/upload-video":
            if not current_status["isLoggedIn"]:
                self._send_json(401, {"ok": False, "error": "Not logged in to Instagram"})
                return
            gate = self._check_stealth_gate("post_upload")
            if gate:
                self._send_json(429, gate)
                return
            file_path = body.get("path", "").strip()
            caption = body.get("caption", "").strip()
            thumbnail_path = body.get("thumbnail")
            if not file_path or not os.path.exists(file_path):
                self._send_json(400, {"ok": False, "error": f"Valid file path required. Found: {file_path}"})
                return
            try:
                record_daily_action("post_upload")
                if caption:
                    simulate_typing(caption, "video caption")
                media = cl.video_upload(file_path, caption=caption, thumbnail=thumbnail_path)
                import threading
                threading.Thread(target=enforce_post_upload_cooldown, args=(False,), daemon=True).start()
                self._send_json(200, {
                    "ok": True,
                    "message": "Video uploaded successfully! Entering 5-10 min post-upload rest.",
                    "mediaId": str(getattr(media, "pk", "")),
                    "code": str(getattr(media, "code", "")),
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": f"Video upload failed: {str(e)}"})
            return

        if path in ("/upload-reel", "/upload-clip"):
            if not current_status["isLoggedIn"]:
                self._send_json(401, {"ok": False, "error": "Not logged in to Instagram"})
                return
            gate = self._check_stealth_gate("post_upload")
            if gate:
                self._send_json(429, gate)
                return
            file_path = body.get("path", "").strip()
            caption = body.get("caption", "").strip()
            thumbnail_path = body.get("thumbnail")
            if not file_path or not os.path.exists(file_path):
                self._send_json(400, {"ok": False, "error": f"Valid file path required. Found: {file_path}"})
                return
            try:
                record_daily_action("post_upload")
                if caption:
                    simulate_typing(caption, "reel caption")
                media = cl.clip_upload(file_path, caption=caption, thumbnail=thumbnail_path)
                import threading
                threading.Thread(target=enforce_post_upload_cooldown, args=(False,), daemon=True).start()
                self._send_json(200, {
                    "ok": True,
                    "message": "Reel/Clip uploaded successfully! Entering 5-10 min post-upload rest.",
                    "mediaId": str(getattr(media, "pk", "")),
                    "code": str(getattr(media, "code", "")),
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": f"Reel upload failed: {str(e)}"})
            return

        if path == "/upload-story-photo":
            if not current_status["isLoggedIn"]:
                self._send_json(401, {"ok": False, "error": "Not logged in to Instagram"})
                return
            gate = self._check_stealth_gate("story_upload")
            if gate:
                self._send_json(429, gate)
                return
            file_path = body.get("path", "").strip()
            if not file_path or not os.path.exists(file_path):
                self._send_json(400, {"ok": False, "error": f"Valid file path required. Found: {file_path}"})
                return
            try:
                record_daily_action("story_upload")
                media = cl.photo_upload_to_story(file_path)
                import threading
                threading.Thread(target=enforce_post_upload_cooldown, args=(True,), daemon=True).start()
                self._send_json(200, {
                    "ok": True,
                    "message": "Story photo uploaded successfully! Entering 2-4 min rest.",
                    "mediaId": str(getattr(media, "pk", "")),
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": f"Story upload failed: {str(e)}"})
            return

        self._send_json(404, {"ok": False, "error": f"Path not found: {path}"})


def run_server(port=5185, host="127.0.0.1"):
    server_address = (host, port)
    httpd = HTTPServer(server_address, BridgeHandler)
    print(f"[InstagrapiBridge] Server running at http://{host}:{port}/", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        print("[InstagrapiBridge] Server stopped.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Instagrapi Bridge Server")
    parser.add_argument("--port", type=int, default=5185, help="Port to listen on (default 5185)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to listen on (default 127.0.0.1)")
    args = parser.parse_args()

    run_server(port=args.port, host=args.host)
