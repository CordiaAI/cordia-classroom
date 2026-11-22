"""Tutor voice mode's cloud voice (POST /tutor/speak in routers/tutor.py): ElevenLabs text-to-speech.

- The key is the Fly secret ELEVENLABS_API_KEY, read from the environment on every call. It goes only in the
  request header to ElevenLabs: never into a response, an error or a log line. Without it, voice mode uses the
  browser's own voice (the endpoint answers 503 voice_unavailable and the web app falls back).
- ElevenLabs' low-latency model, one sentence per request, streamed straight through. Nothing is cached: the
  text is the student's own Tutor reply.
- Only the Tutor's own words are spoken: a sentence must come from one of the latest replies in the student's
  own Tutor session (spoken_from_replies), so the endpoint is never a general text-to-speech service.
"""
import logging
import os
import re
from typing import Iterator, Optional

import httpx

logger = logging.getLogger(__name__)

URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
MODEL = "eleven_flash_v2_5"  # ElevenLabs' low-latency model
OUTPUT_FORMAT = "mp3_44100_64"
MAX_CHARS = 600  # one sentence, with room for a long one
REPLIES_CHECKED = 3  # the latest Tutor replies a sentence may come from

# The voices a student can pick in Settings › Tutor (web/lib/tutorPrefs.js has the same keys). The browser
# sends a key, never a voice id. ElevenLabs' premade voices.
VOICES = {
    "matilda": "XrExE9yKIg1WjnnlVkGX",
    "eric": "cjVigY5qzO86Huf0OWal",
    "alice": "Xb7hH8MSUJpSbSDYk0k2",
    "george": "JBFqnCBsd6RMkjVDRZzb",
}
DEFAULT_VOICE = "matilda"  # calm and warm
VOICE_SETTINGS = {"stability": 0.55, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True}

# What Settings › Tutor plays for "Hear this voice": fixed words, nothing from the student.
SAMPLE_TEXT = "Hi, I'm your Cordia Tutor. Ask me about anything in your classes, and we can talk it through."
# The web app says this in place of a link or code it leaves out of the spoken reply (web/lib/voiceMode.mjs).
PUT_IN_CHAT = re.compile(r"i['’]ve put (?:that|it|them|those|the \w+) in the chat\.?", re.IGNORECASE)
WORD = re.compile(r"[^\W_]+")


class SpeechUnavailable(Exception):
    """ElevenLabs can't speak right now (no key, unreachable, refused). The browser voice takes over."""


def api_key() -> str:
    return os.getenv("ELEVENLABS_API_KEY", "").strip()


def voice_id(key: Optional[str]) -> str:
    return VOICES.get((key or "").strip().lower(), VOICES[DEFAULT_VOICE])


def spoken_text(text: str) -> str:
    """One sentence as it will be spoken: single spaces, nothing that can't be heard."""
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", text or "")).strip()[:MAX_CHARS]


def _words(text: str) -> list[str]:
    return WORD.findall((text or "").casefold())


def spoken_from_replies(text: str, messages: list) -> bool:
    """Whether every word of `text`, in order, comes from one of the latest Tutor replies. The web app drops
    markdown, diagrams, links and code before speaking, so words may be missing in between, never added or
    moved. "I've put that in the chat" (said in place of a link or code) is allowed anywhere."""
    words = _words(PUT_IN_CHAT.sub(" ", text or ""))
    if not words:
        return bool(PUT_IN_CHAT.search(text or ""))
    replies = [message.get("text") or "" for message in reversed(messages or [])
               if isinstance(message, dict) and message.get("role") in {"ai", "assistant"}][:REPLIES_CHECKED]
    for reply in replies:
        remaining = iter(_words(reply))
        if all(word in remaining for word in words):  # an in-order subsequence
            return True
    return False


def open_stream(text: str, voice: Optional[str]) -> "Audio":
    """Start speaking `text` and return the audio as it arrives (mp3). Raises SpeechUnavailable before any
    audio when ElevenLabs can't speak it. Logs say what failed, never the key or the text."""
    key = api_key()
    if not key:
        raise SpeechUnavailable()
    client = httpx.Client(timeout=httpx.Timeout(20.0, connect=5.0))
    try:
        request = client.build_request(
            "POST", URL.format(voice_id=voice_id(voice)),
            params={"output_format": OUTPUT_FORMAT},
            headers={"xi-api-key": key, "accept": "audio/mpeg"},
            json={"text": text, "model_id": MODEL, "voice_settings": VOICE_SETTINGS},
        )
        response = client.send(request, stream=True)
    except httpx.HTTPError as error:
        client.close()
        logger.warning("tutor_voice: ElevenLabs unreachable (%s)", type(error).__name__)
        raise SpeechUnavailable() from None
    if response.status_code != 200:
        status = response.status_code
        response.close()
        client.close()
        logger.warning("tutor_voice: ElevenLabs answered %s", status)
        raise SpeechUnavailable()

    return Audio(client, response)


class Audio:
    """The audio as ElevenLabs sends it. Iterate it once; close() lets go of the connection either way."""

    def __init__(self, client: httpx.Client, response: httpx.Response):
        self.client, self.response = client, response

    def __iter__(self) -> Iterator[bytes]:
        try:
            yield from self.response.iter_bytes()
        except httpx.HTTPError as error:
            logger.warning("tutor_voice: ElevenLabs stream stopped (%s)", type(error).__name__)
        finally:
            self.close()

    def close(self) -> None:
        self.response.close()
        self.client.close()
