"""Security, rate-limiting, input sanitization, and cost-protection guards for public AI endpoints."""

from __future__ import annotations

import hmac
import os
import re
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request

SAFE_INTERACTION_ID_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,128}$")
GEMINI_KEY_LEAK_RE = re.compile(r"AIza[0-9A-Za-z_\-]{10,}")
ALLOWED_AGE_VALUES = {"pre_1981", "1982_2000", "post_2001", "unknown"}
ALLOWED_HAZARD_VALUES = {"very_high", "elevated", "moderate", "low", "unknown"}
ALLOWED_USAGE_GROUPS = {"all", "residential", "non_residential"}


def _parse_bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _parse_int_env(name: str, default: int, minimum: int = 0) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return max(minimum, int(raw.strip()))
    except ValueError:
        return default


def get_cors_allow_origins() -> list[str]:
    """Return explicit CORS origins from env (never defaults to wildcard '*')."""
    raw = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if raw:
        origins = [o.strip() for o in raw.split(",") if o.strip()]
        if origins:
            return origins
    return ["http://localhost:3000", "http://127.0.0.1:3000"]


def redact_secrets(text: str) -> str:
    """Mask any accidental Gemini API key material from error strings."""
    return GEMINI_KEY_LEAK_RE.sub("AIza***REDACTED***", text)


def extract_client_ip(request: Request | None) -> str:
    """Resolve client IP safely, honoring proxy headers ONLY when explicitly enabled."""
    if request is None:
        return "local-test"
    peer_ip = request.client.host if request.client else "unknown"
    trust_proxy = _parse_bool_env("AI_TRUST_PROXY_HEADERS", False)
    if trust_proxy and peer_ip in {"127.0.0.1", "::1", "testclient"}:
        xff = request.headers.get("x-forwarded-for", "").strip()
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            if parts:
                # Take the right-most proxy-appended entry rather than client-spoofable left-most entry
                return parts[-1][:64]
        xri = request.headers.get("x-real-ip", "").strip()
        if xri:
            return xri[:64]
    return peer_ip


def _sanitize_context_assets(raw_assets: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_assets, list):
        return []
    cleaned_assets: list[dict[str, Any]] = []
    allowed_types = {"server_room", "datacenter", "bcp_hq", "vault", "warehouse"}
    allowed_conf = {"enterprise_only", "gov_emergency_share"}
    for item in raw_assets[:30]:
        if not isinstance(item, dict):
            continue
        try:
            lat_v = float(item.get("lat"))
            lon_v = float(item.get("lon"))
        except (TypeError, ValueError):
            continue
        if not (34.5 <= lat_v <= 35.5 and 135.0 <= lon_v <= 136.5):
            continue
        asset_type = str(item.get("assetType") or item.get("asset_type") or "server_room").strip()
        if asset_type not in allowed_types:
            asset_type = "server_room"
        conf = str(
            item.get("confidentialityLevel") or item.get("confidentiality_level") or "enterprise_only"
        ).strip()
        if conf not in allowed_conf:
            conf = "enterprise_only"
        backup_raw = item.get("backupHours") if "backupHours" in item else item.get("backup_hours")
        backup_val: float | None = None
        if isinstance(backup_raw, (int, float)) and 0 <= float(backup_raw) <= 8760:
            backup_val = float(backup_raw)
        cleaned_assets.append({
            "id": str(item.get("id") or "")[:64],
            "ownerUid": str(item.get("ownerUid") or item.get("owner_uid") or "")[:128],
            "organizationName": str(
                item.get("organizationName") or item.get("organization_name") or ""
            ).strip()[:80],
            "name": str(item.get("name") or "登録拠点").strip()[:80],
            "assetType": asset_type,
            "confidentialityLevel": conf,
            "wardName": str(item.get("wardName") or item.get("ward_name") or "京都市").strip()[:32],
            "lat": lat_v,
            "lon": lon_v,
            "floorInfo": str(item.get("floorInfo") or item.get("floor_info") or "").strip()[:48],
            "backupHours": backup_val,
            "notes": str(item.get("notes") or "").strip()[:160],
        })
    return cleaned_assets


def sanitize_chat_context(context: dict[str, Any] | None) -> dict[str, Any] | None:
    """Whitelist and bound chat context fields to prevent prompt bloat or injection."""
    if not context or not isinstance(context, dict):
        return None
    cleaned: dict[str, Any] = {}
    ward = context.get("ward")
    if isinstance(ward, str) and ward.strip():
        cleaned["ward"] = ward.strip()[:32]
    usage_group = context.get("usage_group")
    if isinstance(usage_group, str) and usage_group in ALLOWED_USAGE_GROUPS:
        cleaned["usage_group"] = usage_group
    ages = context.get("age_categories")
    if isinstance(ages, list):
        valid_ages = [str(a) for a in ages if str(a) in ALLOWED_AGE_VALUES][:4]
        if valid_ages:
            cleaned["age_categories"] = valid_ages
    hazards = context.get("hazard_tiers")
    if isinstance(hazards, list):
        valid_hazards = [str(h) for h in hazards if str(h) in ALLOWED_HAZARD_VALUES][:5]
        if valid_hazards:
            cleaned["hazard_tiers"] = valid_hazards
    meshcode = context.get("selected_meshcode")
    if isinstance(meshcode, str) and meshcode.strip():
        cleaned["selected_meshcode"] = meshcode.strip()[:20]
    bldg_id = context.get("selected_building_id")
    if isinstance(bldg_id, str) and bldg_id.strip():
        cleaned["selected_building_id"] = bldg_id.strip()[:64]
    if isinstance(context.get("is_3d"), bool):
        cleaned["is_3d"] = context["is_3d"]
    assets = _sanitize_context_assets(context.get("my_enterprise_assets"))
    if assets:
        cleaned["my_enterprise_assets"] = assets
    return cleaned or None


def validate_chat_inputs(
    message: str,
    previous_interaction_id: str | None,
    context: dict[str, Any] | None,
) -> tuple[str, str | None, dict[str, Any] | None]:
    """Validate and bound chat message length, interaction ID, and context payload."""
    cleaned_msg = message.strip()
    if not cleaned_msg:
        raise HTTPException(status_code=400, detail="質問メッセージを入力してください。")

    max_chars = _parse_int_env("AI_MAX_MESSAGE_CHARS", 1200, minimum=100)
    if len(cleaned_msg) > max_chars:
        raise HTTPException(
            status_code=413,
            detail=f"質問文が長すぎます（上限 {max_chars} 文字、現在 {len(cleaned_msg)} 文字）。",
        )

    cleaned_prev_id: str | None = None
    if previous_interaction_id:
        pid = previous_interaction_id.strip()
        if pid:
            if not SAFE_INTERACTION_ID_RE.match(pid):
                raise HTTPException(status_code=400, detail="previous_interaction_id の形式が不正です。")
            cleaned_prev_id = pid

    return cleaned_msg, cleaned_prev_id, sanitize_chat_context(context)


@dataclass(frozen=True)
class GuardTicket:
    client_ip: str
    using_server_key: bool
    subject_key: str = ""


class AICostGuard:
    """In-memory per-subject (UID/IP) rate limiter, concurrency limiter, access gate, and daily budget cap."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._minute_hits: dict[str, deque[float]] = defaultdict(deque)
        self._hour_hits: dict[str, deque[float]] = defaultdict(deque)
        self._active_by_subject: dict[str, int] = defaultdict(int)
        self._active_global = 0
        self._daily_date = self._today_key()
        self._daily_server_requests = 0

    @staticmethod
    def _today_key() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def reset(self) -> None:
        """Reset all in-memory counters (intended for unit tests)."""
        with self._lock:
            self._minute_hits.clear()
            self._hour_hits.clear()
            self._active_by_subject.clear()
            self._active_global = 0
            self._daily_date = self._today_key()
            self._daily_server_requests = 0

    @staticmethod
    def _has_server_env_key() -> bool:
        env_key = os.getenv("GEMINI_API_KEY", "").strip()
        return bool(env_key and env_key != "your_gemini_api_key_here")

    @staticmethod
    def server_key_public_enabled() -> bool:
        return _parse_bool_env("AI_PUBLIC_SERVER_KEY_ENABLED", True)

    @staticmethod
    def access_code_configured() -> str:
        return os.getenv("AI_ACCESS_CODE", "").strip()

    @staticmethod
    def premium_models_allowed() -> bool:
        return _parse_bool_env("AI_ALLOW_PREMIUM_MODELS", False)

    def get_protection_status(self) -> dict[str, Any]:
        """Return non-secret AI protection policy and remaining daily quota for /api/health."""
        today = self._today_key()
        daily_limit = _parse_int_env("AI_DAILY_BUDGET_REQUESTS", 300, minimum=1)
        per_min = _parse_int_env("AI_RATE_LIMIT_PER_MIN", 8, minimum=1)
        max_chars = _parse_int_env("AI_MAX_MESSAGE_CHARS", 1200, minimum=100)
        with self._lock:
            if self._daily_date != today:
                self._daily_date = today
                self._daily_server_requests = 0
            used = self._daily_server_requests
        return {
            "server_key_enabled": self.server_key_public_enabled(),
            "access_code_required": bool(self.access_code_configured()),
            "premium_models_allowed": self.premium_models_allowed(),
            "daily_limit": daily_limit,
            "daily_used": used,
            "daily_remaining": max(0, daily_limit - used),
            "per_minute_limit": per_min,
            "max_message_chars": max_chars,
        }

    def authorize_and_acquire(
        self,
        *,
        client_ip: str,
        requested_model: str | None,
        api_key_override: str | None,
        access_code: str | None,
        user_uid: str | None = None,
    ) -> GuardTicket:
        """Validate access controls, model policy, rate limits, and acquire a concurrency slot."""
        using_byok = bool(api_key_override and api_key_override.strip())
        has_env_key = self._has_server_env_key()
        using_server_key = (not using_byok) and has_env_key

        # Key rate limits primarily by authenticated Firebase UID so spoofed proxy headers
        # cannot bypass limits and distinct users behind localhost Next.js proxy do not collide.
        clean_uid = (user_uid or "").strip()[:128]
        subject_key = f"uid:{clean_uid}" if clean_uid else f"ip:{client_ip}"

        # If server key is disabled for public visitors and user supplied no BYOK key,
        # enforce BYOK-only unless no server key exists at all (fallback data preview stays available).
        if not using_byok and has_env_key and not self.server_key_public_enabled():
            raise HTTPException(
                status_code=403,
                detail="公開サーバー側のAPIキー利用は制限されています。画面右上の「APIキー設定」からご自身の Gemini API キーを入力してご利用ください。",
            )

        # Access code check applies when using the server's GEMINI_API_KEY
        expected_code = self.access_code_configured()
        if using_server_key and expected_code:
            provided = (access_code or "").strip()
            if not provided or not hmac.compare_digest(provided, expected_code):
                raise HTTPException(
                    status_code=401,
                    detail="AI機能のアクセスコードが必要です（または「APIキー設定」からご自身の Gemini API キーを入力してください）。",
                )

        # Model cost guard: prevent anonymous visitors from invoking expensive frontier models on server key
        if using_server_key and requested_model in {"gemini-4-hydrogen", "gemini-4-argon"}:
            if not self.premium_models_allowed():
                raise HTTPException(
                    status_code=403,
                    detail=f"公開環境では共用APIキーでの `{requested_model}` 利用を制限しています。`gemini-3.5-flash-lite` を選択するか、ご自身の API キーを入力してください。",
                )

        now = time.monotonic()
        today = self._today_key()

        per_min = _parse_int_env("AI_RATE_LIMIT_PER_MIN", 8 if using_server_key else 30, minimum=1)
        per_hour = _parse_int_env("AI_RATE_LIMIT_PER_HOUR", 40 if using_server_key else 180, minimum=1)
        daily_limit = _parse_int_env("AI_DAILY_BUDGET_REQUESTS", 300, minimum=1)
        max_conc_subject = _parse_int_env("AI_MAX_CONCURRENT_PER_IP", 2, minimum=1)
        max_conc_global = _parse_int_env("AI_MAX_CONCURRENT_GLOBAL", 15, minimum=1)

        with self._lock:
            if self._daily_date != today:
                self._daily_date = today
                self._daily_server_requests = 0

            if self._active_global >= max_conc_global:
                raise HTTPException(
                    status_code=429,
                    detail="現在AIリクエストが混み合っています。少し待ってから再試行してください。",
                    headers={"Retry-After": "10"},
                )

            if self._active_by_subject[subject_key] >= max_conc_subject:
                raise HTTPException(
                    status_code=429,
                    detail="同一ユーザーからの同時実行数の上限に達しました。現在の応答完了をお待ちください。",
                    headers={"Retry-After": "5"},
                )

            if using_server_key and self._daily_server_requests >= daily_limit:
                raise HTTPException(
                    status_code=429,
                    detail="本日の共用AI利用上限に達しました。ご自身の Gemini API キーを「APIキー設定」から入力すると引き続き利用できます。",
                    headers={"Retry-After": "3600"},
                )

            m_key = f"srv:{subject_key}" if using_server_key else f"byok:{subject_key}"
            m_q = self._minute_hits[m_key]
            while m_q and now - m_q[0] > 60.0:
                m_q.popleft()
            if len(m_q) >= per_min:
                retry_after = max(1, int(60.0 - (now - m_q[0])))
                raise HTTPException(
                    status_code=429,
                    detail=f"リクエスト頻度の上限（1分あたり{per_min}回）に達しました。約{retry_after}秒後に再試行してください。",
                    headers={"Retry-After": str(retry_after)},
                )

            h_q = self._hour_hits[m_key]
            while h_q and now - h_q[0] > 3600.0:
                h_q.popleft()
            if len(h_q) >= per_hour:
                raise HTTPException(
                    status_code=429,
                    detail=f"1時間あたりの利用上限（{per_hour}回）に達しました。時間をおくか、ご自身のAPIキーをご利用ください。",
                    headers={"Retry-After": "600"},
                )

            m_q.append(now)
            h_q.append(now)
            if using_server_key:
                self._daily_server_requests += 1
            self._active_by_subject[subject_key] += 1
            self._active_global += 1

        return GuardTicket(
            client_ip=client_ip,
            using_server_key=using_server_key,
            subject_key=subject_key,
        )

    def release_slot(self, ticket: GuardTicket) -> None:
        key = ticket.subject_key or f"ip:{ticket.client_ip}"
        with self._lock:
            if self._active_by_subject[key] > 0:
                self._active_by_subject[key] -= 1
            if self._active_by_subject[key] == 0:
                self._active_by_subject.pop(key, None)
            if self._active_global > 0:
                self._active_global -= 1


class GovCodeBruteForceGuard:
    """Rate-limit failed GOV_REGISTRATION_CODE attempts per UID and IP to prevent brute-forcing."""

    def __init__(self, *, max_failures: int = 5, window_sec: float = 900.0) -> None:
        self._max_failures = max_failures
        self._window_sec = window_sec
        self._lock = threading.Lock()
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()

    def _prune(self, key: str, now: float) -> deque[float]:
        q = self._failures[key]
        while q and now - q[0] > self._window_sec:
            q.popleft()
        if not q:
            self._failures.pop(key, None)
        return q

    def check_allowed(self, *, uid: str, client_ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in (f"uid:{uid}", f"ip:{client_ip}"):
                q = self._prune(key, now)
                if len(q) >= self._max_failures:
                    retry_after = max(1, int(self._window_sec - (now - q[0])))
                    raise HTTPException(
                        status_code=429,
                        detail=(
                            f"政府関連機関コードの認証失敗回数が上限に達しました。"
                            f"約{max(1, retry_after // 60)}分後に再試行してください。"
                        ),
                        headers={"Retry-After": str(retry_after)},
                    )

    def record_failure(self, *, uid: str, client_ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in (f"uid:{uid}", f"ip:{client_ip}"):
                q = self._failures[key]
                while q and now - q[0] > self._window_sec:
                    q.popleft()
                q.append(now)

    def record_success(self, *, uid: str, client_ip: str) -> None:
        with self._lock:
            self._failures.pop(f"uid:{uid}", None)
            self._failures.pop(f"ip:{client_ip}", None)


class SlidingWindowRateLimiter:
    """Bounded in-memory per-key sliding-window rate limiter for sensitive lookup endpoints."""

    def __init__(self, *, max_hits: int, window_sec: float, max_keys: int = 4096) -> None:
        self._max_hits = max_hits
        self._window_sec = window_sec
        self._max_keys = max_keys
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = {}

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def consume(self, key: str, *, detail: str) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                if len(self._hits) >= self._max_keys:
                    # Evict oldest key cleanly
                    self._hits.pop(next(iter(self._hits)))
                q = deque()
                self._hits[key] = q
            while q and now - q[0] > self._window_sec:
                q.popleft()
            if len(q) >= self._max_hits:
                retry_after = max(1, int(self._window_sec - (now - q[0])))
                raise HTTPException(
                    status_code=429,
                    detail=detail,
                    headers={"Retry-After": str(retry_after)},
                )
            q.append(now)


ai_guard = AICostGuard()
gov_code_guard = GovCodeBruteForceGuard()
board_phone_lookup_guard = SlidingWindowRateLimiter(max_hits=20, window_sec=60.0)
