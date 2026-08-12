"""Optional AI providers for rewrite previews and manuscript questions."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from .errors import APIError

PROVIDER_ALIASES = {
    "mock": "mock",
    "offline": "mock",
    "off": "off",
    "disabled": "off",
    "none": "off",
    "openai": "openai-compatible",
    "openai_compatible": "openai-compatible",
    "openai-compatible": "openai-compatible",
}


def normalize_provider_name(value: object) -> str:
    raw = str(value or "mock").strip().lower()
    try:
        return PROVIDER_ALIASES[raw]
    except KeyError as error:
        raise APIError(
            "AI provider 必须是 mock、off 或 openai-compatible",
            500,
            "invalid_provider_configuration",
        ) from error


class AIProvider:
    name = "unknown"

    def rewrite(self, *, text: str, instruction: str, context: str) -> str:
        raise NotImplementedError

    def ask(self, *, question: str, context: str, history: list[dict[str, str]]) -> str:
        raise NotImplementedError


class OffProvider(AIProvider):
    name = "off"

    @staticmethod
    def _disabled() -> None:
        raise APIError(
            "AI 功能已关闭。请启用 mock 或配置 openai-compatible provider。",
            503,
            "ai_provider_disabled",
        )

    def rewrite(self, *, text: str, instruction: str, context: str) -> str:
        self._disabled()
        return ""  # pragma: no cover - keeps static type checkers satisfied

    def ask(self, *, question: str, context: str, history: list[dict[str, str]]) -> str:
        self._disabled()
        return ""  # pragma: no cover


class MockProvider(AIProvider):
    """A deterministic, network-free provider suitable for the demo."""

    name = "mock"

    @staticmethod
    def _tidy(text: str) -> str:
        lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.strip().splitlines()]
        return "\n".join(lines).strip()

    def rewrite(self, *, text: str, instruction: str, context: str) -> str:
        result = self._tidy(text)
        lowered = instruction.casefold()
        if any(marker in lowered for marker in ("精简", "简洁", "压缩", "concise", "shorter")):
            result = re.sub(r"\b(very|really|actually|basically)\b\s*", "", result, flags=re.I)
            for filler in ("其实，", "事实上，", "实际上，", "非常", "十分"):
                result = result.replace(filler, "")
        elif any(marker in lowered for marker in ("正式", "formal")):
            result = result.replace("!", ".").replace("！", "。")
        result = result.strip()
        if not result:
            raise APIError("选中文本不能为空", 400, "text_required")
        return result

    def ask(self, *, question: str, context: str, history: list[dict[str, str]]) -> str:
        focus = question.strip().rstrip("？?")
        context_note = (
            f"我已基于你提供的约 {len(context)} 个字符的上下文进行梳理。"
            if context.strip()
            else "当前没有附带书稿上下文。"
        )
        history_note = f"并参考了最近 {len(history)} 条对话。" if history else ""
        return (
            f"离线演示建议：围绕“{focus}”，先确认人物此刻的目标，再设置一个可见阻力，"
            f"最后让本段产生会影响下一场戏的选择。{context_note}{history_note}"
        )


@dataclass(frozen=True)
class OpenAICompatibleProvider(AIProvider):
    base_url: str
    api_key: str
    model: str
    timeout: float = 30.0
    name = "openai-compatible"

    def rewrite(self, *, text: str, instruction: str, context: str) -> str:
        system = (
            "You are a careful fiction editor. Return only the rewritten passage, "
            "without analysis or Markdown fences. Preserve facts, viewpoint, names, and tone."
        )
        user = (
            f"Instruction:\n{instruction or 'Improve clarity and flow.'}\n\n"
            f"Nearby context:\n{context or '(none provided)'}\n\n"
            f"Passage to rewrite:\n{text}"
        )
        return self._complete(system=system, messages=[{"role": "user", "content": user}])

    def ask(self, *, question: str, context: str, history: list[dict[str, str]]) -> str:
        system = (
            "You are a manuscript assistant. Answer from the supplied context, distinguish "
            "facts from suggestions, and do not claim to have read text that was not supplied."
        )
        messages: list[dict[str, str]] = []
        if context:
            messages.append({"role": "user", "content": f"Manuscript context:\n{context}"})
            messages.append({"role": "assistant", "content": "I will use that context."})
        messages.extend(history)
        messages.append({"role": "user", "content": question})
        return self._complete(system=system, messages=messages)

    def _complete(self, *, system: str, messages: list[dict[str, str]]) -> str:
        endpoint = f"{self.base_url.rstrip('/')}/chat/completions"
        payload = json.dumps(
            {
                "model": self.model,
                "messages": [{"role": "system", "content": system}, *messages],
                "temperature": 0.7,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib_request.Request(
            endpoint,
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib_request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib_error.HTTPError as error:
            raise APIError(
                "远程 AI provider 拒绝了请求",
                502,
                "ai_provider_error",
                provider_status=error.code,
            ) from error
        except (urllib_error.URLError, TimeoutError, OSError) as error:
            raise APIError(
                "无法连接远程 AI provider",
                502,
                "ai_provider_unavailable",
            ) from error
        try:
            body: dict[str, Any] = json.loads(raw.decode("utf-8"))
            content = body["choices"][0]["message"]["content"]
        except (UnicodeDecodeError, json.JSONDecodeError, KeyError, IndexError, TypeError) as error:
            raise APIError(
                "远程 AI provider 返回了无法解析的响应",
                502,
                "invalid_ai_response",
            ) from error
        if not isinstance(content, str) or not content.strip():
            raise APIError("远程 AI provider 返回空内容", 502, "empty_ai_response")
        return content.strip()


def build_provider(name: object) -> AIProvider:
    normalized = normalize_provider_name(name)
    if normalized == "off":
        return OffProvider()
    if normalized == "mock":
        return MockProvider()

    # Credentials are deliberately read only from the process environment.
    # They are never copied into Flask config or serialized in API responses.
    base_url = os.environ.get("WRITING_WORKBENCH_OPENAI_BASE_URL") or os.environ.get(
        "OPENAI_BASE_URL", "https://api.openai.com/v1"
    )
    api_key = os.environ.get("WRITING_WORKBENCH_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    model = os.environ.get("WRITING_WORKBENCH_OPENAI_MODEL") or os.environ.get("OPENAI_MODEL")
    if not api_key or not model:
        raise APIError(
            "openai-compatible provider 缺少环境变量中的 API key 或 model",
            503,
            "ai_provider_not_configured",
        )
    try:
        timeout = float(os.environ.get("WRITING_WORKBENCH_AI_TIMEOUT", "30"))
    except ValueError:
        timeout = 30.0
    return OpenAICompatibleProvider(
        base_url=base_url,
        api_key=api_key,
        model=model,
        timeout=max(1.0, min(timeout, 300.0)),
    )
