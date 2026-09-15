#!/usr/bin/env python3
"""
Instagram Bridge Service powered by Instagrapi
Provides a lightweight local HTTP API for Node.js backend.
"""

import sys
import os
import json
import argparse
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from instagrapi import Client
from instagrapi.exceptions import (
    TwoFactorRequired,
    BadPassword,
    PleaseWaitFewMinutes,
    LoginRequired,
    ChallengeRequired,
    UserNotFound,
)

# Global client and state
cl = Client()
# Increase default timeout to prevent dropping slow requests
cl.request_timeout = 25

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

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path in ("/health", "/status"):
            self._send_json(200, get_status())
            return

        if path == "/inbox":
            if not current_status["isLoggedIn"]:
                self._send_json(200, {"ok": True, "threads": [], "message": "Not logged in"})
                return
            try:
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
            try:
                user = cl.user_info_by_username(username)
                self._send_json(200, {
                    "ok": True,
                    "user": {
                        "pk": str(user.pk),
                        "username": user.username,
                        "full_name": user.full_name,
                        "profile_pic_url": str(user.profile_pic_url) if user.profile_pic_url else None,
                        "is_private": user.is_private,
                        "is_verified": user.is_verified,
                        "media_count": user.media_count,
                        "follower_count": user.follower_count,
                        "following_count": user.following_count,
                        "biography": user.biography,
                    }
                })
            except Exception as e:
                self._send_json(404, {"ok": False, "error": str(e)})
            return

        if path == "/search":
            q = query.get("query", [""])[0].strip()
            if not q:
                self._send_json(400, {"ok": False, "error": "query parameter is required"})
                return
            try:
                users = cl.search_users(q)
                results = []
                for u in users[:15]:
                    results.append({
                        "pk": str(u.pk),
                        "username": u.username,
                        "full_name": u.full_name,
                        "profile_pic_url": str(u.profile_pic_url) if u.profile_pic_url else None,
                        "is_private": u.is_private,
                        "is_verified": u.is_verified,
                    })
                self._send_json(200, {"ok": True, "users": results})
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
                info = cl.account_info()
                update_logged_in_user(info)
                self._send_json(200, {"ok": True, "message": f"Session restored for @{info.username}", "status": get_status()})
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
                logged = cl.login_by_sessionid(session_id)
                info = cl.account_info()
                update_logged_in_user(info)
                self._send_json(200, {
                    "ok": True,
                    "message": f"Logged in via session ID as @{info.username}",
                    "username": info.username,
                    "fullName": info.full_name,
                    "profilePicUrl": str(info.profile_pic_url) if info.profile_pic_url else None,
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
                # If 2FA code is provided
                if verification_code:
                    cl.login(username, password, verification_code=verification_code)
                else:
                    cl.login(username, password)

                info = cl.account_info()
                update_logged_in_user(info)
                self._send_json(200, {
                    "ok": True,
                    "message": f"Logged in successfully as @{info.username}",
                    "username": info.username,
                    "fullName": info.full_name,
                    "profilePicUrl": str(info.profile_pic_url) if info.profile_pic_url else None,
                    "sessionSettings": cl.get_settings(),
                })
            except TwoFactorRequired as e:
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

            text = body.get("message", "").strip()
            thread_id = body.get("threadId")
            recipient = body.get("recipient", "").strip().replace("@", "")

            if not text:
                self._send_json(400, {"ok": False, "error": "message is required"})
                return

            try:
                res = None
                if thread_id:
                    res = cl.direct_send(text, thread_ids=[str(thread_id)])
                elif recipient:
                    if recipient.isdigit():
                        res = cl.direct_send(text, user_ids=[int(recipient)])
                    else:
                        u_info = cl.user_info_by_username(recipient)
                        res = cl.direct_send(text, user_ids=[int(u_info.pk)])
                else:
                    self._send_json(400, {"ok": False, "error": "Either threadId or recipient is required"})
                    return

                self._send_json(200, {"ok": True, "message": "Message sent successfully", "result": str(res)})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": f"Failed to send direct message: {str(e)}"})
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
