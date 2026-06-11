"""
Async HTTP client for LM Studio API.

Compatible with the OpenAI chat/completions endpoint.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

import httpx

from orchiday.core.constants import DEFAULT_LM_STUDIO_URL, DEFAULT_LLM_TIMEOUT_S

log = logging.getLogger(__name__)


class LMStudioClient:
    """
    Client for communicating with the LM Studio local API.

    Supports:
    - Text queries (LLM chat completions)
    - Multimodal queries (VLM with images)
    - Model listing
    - Health checks
    """

    def __init__(self, base_url: str = DEFAULT_LM_STUDIO_URL, timeout_s: float = DEFAULT_LLM_TIMEOUT_S):
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_s

    @property
    def base_url(self) -> str:
        return self._base_url

    @base_url.setter
    def base_url(self, url: str) -> None:
        self._base_url = url.rstrip("/")

    async def health_check(self) -> bool:
        """Check if the LM Studio server is reachable."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._base_url}/models")
                return resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    async def test_connection(self) -> tuple[bool, str]:
        """Test connection to the server and return (ok, message)."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._base_url}/models")
                if resp.status_code == 200:
                    return True, "Reachable"
                else:
                    return False, f"Server returned status {resp.status_code}"
        except Exception as e:
            return False, str(e)

    async def list_models(self) -> list[dict[str, Any]]:
        """Return the list of models loaded in LM Studio."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self._base_url}/models")
            resp.raise_for_status()
            return resp.json().get("data", [])

    async def chat(self, model: str, messages: list[dict[str, Any]],
                   temperature: float = 0.1, max_tokens: int = 1024) -> str:
        """Send a text chat request and return the model's response."""
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base_url}/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()
        content = data["choices"][0]["message"]["content"]
        log.debug("LLM response (%s): %s", model, content[:200])
        return content

    async def chat_with_image(self, model: str, prompt: str, image_base64: str,
                              system_prompt: str | None = None, temperature: float = 0.1) -> str:
        """Send a multimodal query (text + image) to a VLM."""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
            ],
        })
        payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": 256}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base_url}/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()
        content = data["choices"][0]["message"]["content"]
        log.debug("VLM response (%s): %s", model, content[:200])
        return content

    @staticmethod
    def encode_image_file(image_path: str) -> str:
        """Encode an image file to base64."""
        with open(image_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")

    @staticmethod
    def encode_image_bytes(image_bytes: bytes) -> str:
        """Encode raw bytes to base64."""
        return base64.b64encode(image_bytes).decode("utf-8")

    async def parse_json_response(self, text: str) -> Any:
        """Try to parse JSON from a model response (strips markdown code fences)."""
        cleaned = text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            cleaned = "\n".join(lines)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            log.error("Cannot parse JSON from LLM response: %s", e)
            return None
