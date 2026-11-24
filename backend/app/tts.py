"""Gemini Text-to-Speech (response_modalities=['AUDIO']) helper for Mochimamo."""

from __future__ import annotations

import base64
import io
import re
import wave

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

DEFAULT_TTS_MODEL = "gemini-3.8-flash-tts"
ALLOWED_TTS_MODELS = ("gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts")
DEFAULT_TTS_VOICE = "Leda"
ALLOWED_TTS_VOICES = {"Leda", "Kore", "Aoede", "Zephyr", "Puck"}


class TtsQuotaExhaustedError(RuntimeError):
    """Raised when Gemini TTS requests fail due to API rate/daily quota limits."""

_CODE_BLOCK_RE = re.compile(r"```[\s\S]*?```")
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_URL_RE = re.compile(r"https?://\S+")
_TABLE_LINE_RE = re.compile(r"^\s*\|.*\|\s*$", re.MULTILINE)
_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+", re.MULTILINE)
_BULLET_RE = re.compile(r"^\s*[-*•・]\s+", re.MULTILINE)
_NUM_BULLET_RE = re.compile(r"^\s*\d+\.\s+", re.MULTILINE)
_INLINE_FMT_RE = re.compile(r"[`*_~>|]")
_MULTI_SPACE_RE = re.compile(r"\s+")


def prepare_spoken_text(raw_text: str, max_chars: int = 220) -> str:
    """Convert Markdown chat output into concise, natural Japanese speech text."""
    text = (raw_text or "").strip()
    if not text:
        return ""

    text = _CODE_BLOCK_RE.sub(" ", text)
    text = _TABLE_LINE_RE.sub(" ", text)
    text = _MD_LINK_RE.sub(r"\1", text)
    text = _URL_RE.sub("", text)
    text = _HEADING_RE.sub("", text)
    text = _BULLET_RE.sub("", text)
    text = _NUM_BULLET_RE.sub("", text)
    text = _INLINE_FMT_RE.sub("", text)

    replacements = {
        "⚠️": "ご注意です。",
        "※": "なお、",
        "T30_I55_PS": "今後30年震度6弱以上確率",
        "ARV": "表層地盤増幅率",
        "×": "かける",
        "／": "、",
        "/": "、",
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)

    # Collapse line breaks into sentence pauses
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    joined = "。".join(
        ln if ln.endswith(("。", "！", "？", "!", "?", "、")) else ln
        for ln in lines
    )
    joined = _MULTI_SPACE_RE.sub(" ", joined).replace("。。", "。").strip()

    if len(joined) <= max_chars:
        return joined

    # Trim cleanly at the last Japanese sentence boundary inside max_chars
    cutoff = joined[:max_chars]
    last_end = max(cutoff.rfind("。"), cutoff.rfind("！"), cutoff.rfind("？"))
    if last_end >= max_chars // 3:
        trimmed = cutoff[: last_end + 1]
    else:
        trimmed = cutoff.rstrip("、 ") + "。"
    return f"{trimmed} 詳しくは画面のテキストもご覧ください。"


def _ensure_wav_bytes(audio_bytes: bytes, mime_type: str | None) -> tuple[bytes, str]:
    """Return browser-ready WAV bytes, wrapping raw L16 PCM if needed."""
    if audio_bytes.startswith(b"RIFF"):
        return audio_bytes, "audio/wav"

    mt = (mime_type or "").lower()
    if "wav" in mt:
        return audio_bytes, "audio/wav"

    # Extract sample rate from e.g. "audio/L16;codec=pcm;rate=24000"
    rate = 24000
    m = re.search(r"rate=(\d+)", mt)
    if m:
        rate = int(m.group(1))

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(audio_bytes)
    return buf.getvalue(), "audio/wav"


def _is_quota_error(exc: Exception) -> bool:
    code = getattr(exc, "code", None)
    if code == 429:
        return True
    msg = str(exc)
    return "429" in msg or "RESOURCE_EXHAUSTED" in msg or "Quota exceeded" in msg


def _is_model_fallback_eligible(exc: Exception) -> bool:
    if _is_quota_error(exc):
        return True
    code = getattr(exc, "code", None)
    if code == 404:
        return True
    msg = str(exc)
    return "NOT_FOUND" in msg or "is not found" in msg


def _format_quota_error_message(exc: Exception, attempted_models: list[str]) -> str:
    msg = str(exc)
    is_free_tier = "FreeTier" in msg or "free_tier" in msg
    retry_hint = ""
    m_sec = re.search(r"retryDelay['\"]?\s*[:=]\s*['\"]?(\d+)s", msg)
    if m_sec:
        total_sec = int(m_sec.group(1))
        hours, rem = divmod(total_sec, 3600)
        mins = rem // 60
        if hours > 0:
            retry_hint = f"（再試行目安: 約{hours}時間{mins}分後）"
        elif mins > 0:
            retry_hint = f"（再試行目安: 約{mins}分後）"
        else:
            retry_hint = f"（再試行目安: 約{total_sec}秒後）"

    models_label = " / ".join(attempted_models)
    if is_free_tier:
        return (
            f"音声モデルの無料枠上限（{models_label} / Free Tier）に達しました{retry_hint}。"
            "APIキー側のプロジェクトで課金設定（Pay-as-you-go）を有効にすると上限が引き上がります。"
        )
    return f"音声モデル（{models_label}）が利用上限（429）に達しました{retry_hint}。少し待ってから再度お試しください。"


def _extract_audio_part(response: object) -> tuple[bytes, str] | None:
    candidates = getattr(response, "candidates", None) or []
    for cand in candidates:
        content = getattr(cand, "content", None)
        for part in getattr(content, "parts", None) or []:
            inline = getattr(part, "inline_data", None)
            raw_data = getattr(inline, "data", None) if inline else None
            if raw_data:
                audio_bytes = (
                    base64.b64decode(raw_data) if isinstance(raw_data, str) else bytes(raw_data)
                )
                mime_type = getattr(inline, "mime_type", None)
                return _ensure_wav_bytes(audio_bytes, mime_type)
    return None


def synthesize_speech(
    *,
    text: str,
    api_key: str,
    voice: str | None = None,
    model: str = DEFAULT_TTS_MODEL,
) -> tuple[bytes, str, str]:
    """Synthesize Japanese speech via google-genai response_modalities=['AUDIO'] with model fallback."""
    spoken_text = prepare_spoken_text(text)
    if not spoken_text:
        raise ValueError("読み上げ可能なテキストがありません。")

    chosen_voice = voice if voice in ALLOWED_TTS_VOICES else DEFAULT_TTS_VOICE
    primary = (model or DEFAULT_TTS_MODEL).strip() or DEFAULT_TTS_MODEL
    candidate_models = [primary, *(m for m in ALLOWED_TTS_MODELS if m != primary)]

    client = genai.Client(
        api_key=api_key,
        http_options={"api_version": "v1beta", "timeout": 60000},
    )
    gen_config = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=chosen_voice)
            )
        ),
    )

    attempted: list[str] = []
    last_exc: Exception | None = None
    for candidate_model in candidate_models:
        attempted.append(candidate_model)
        try:
            response = client.models.generate_content(
                model=candidate_model,
                contents=spoken_text,
                config=gen_config,
            )
        except Exception as exc:
            last_exc = exc
            if _is_model_fallback_eligible(exc):
                continue
            if isinstance(exc, genai_errors.APIError):
                raise RuntimeError(str(exc)) from exc
            raise

        extracted = _extract_audio_part(response)
        if extracted:
            audio_bytes, mime_type = extracted
            return audio_bytes, mime_type, candidate_model
        last_exc = RuntimeError(f"Gemini TTS（{candidate_model}）から音声データが返却されませんでした。")

    if last_exc and _is_quota_error(last_exc):
        raise TtsQuotaExhaustedError(_format_quota_error_message(last_exc, attempted)) from last_exc
    if last_exc:
        raise last_exc
    raise RuntimeError("Gemini TTS から音声データが返却されませんでした。")
