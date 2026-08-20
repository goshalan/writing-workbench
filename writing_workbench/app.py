"""Flask application factory for Writing Workbench."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from .errors import APIError
from .providers import build_provider, normalize_provider_name
from .storage import ManuscriptStore, manuscript_body

VERSION = "0.1.0"
DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024
DEFAULT_MAX_FILE_BYTES = 1_900_000
DEFAULT_BACKUP_LIMIT = 10
DEFAULT_ANALYSIS_CONTEXT_CHARS = 100_000
MAX_REWRITE_TEXT_CHARS = 24_000
MAX_CONTEXT_CHARS = 80_000
MAX_QUESTION_CHARS = 12_000
MAX_HISTORY_ITEMS = 20
MAX_HISTORY_ITEM_CHARS = 4_000


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return max(minimum, int(raw))
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _default_manuscript_dir() -> Path:
    configured = os.environ.get("WRITING_WORKBENCH_DIR")
    return Path(configured).expanduser() if configured else Path.cwd() / "manuscripts"


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    package_root = Path(__file__).resolve().parent
    app = Flask(
        __name__,
        template_folder=str(package_root / "templates"),
        static_folder=str(package_root / "static"),
    )
    app.config.from_mapping(
        MAX_CONTENT_LENGTH=_env_int(
            "WRITING_WORKBENCH_MAX_REQUEST_BYTES", DEFAULT_MAX_REQUEST_BYTES
        ),
        MAX_FILE_BYTES=_env_int("WRITING_WORKBENCH_MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES),
        BACKUP_LIMIT=_env_int("WRITING_WORKBENCH_BACKUP_LIMIT", DEFAULT_BACKUP_LIMIT),
        MANUSCRIPTS_DIR=str(_default_manuscript_dir()),
        CREATE_EXAMPLES=_env_bool("WRITING_WORKBENCH_CREATE_EXAMPLES", True),
        BOOK_TITLE=os.environ.get("WRITING_WORKBENCH_BOOK_TITLE", "").strip(),
        TARGET_WORDS=_env_int("WRITING_WORKBENCH_TARGET_WORDS", 80_000),
        SUITE_HOME_URL=os.environ.get("WRITING_WORKBENCH_SUITE_HOME_URL", "").strip(),
        SUITE_HOME_LABEL=os.environ.get(
            "WRITING_WORKBENCH_SUITE_HOME_LABEL", "Back to local tools"
        ).strip(),
        SUITE_MARK=os.environ.get("WRITING_WORKBENCH_SUITE_MARK", "WW").strip(),
        AI_PROVIDER=os.environ.get("WRITING_WORKBENCH_AI_PROVIDER", "hermes"),
        ANALYSIS_CONTEXT_CHARS=_env_int(
            "WRITING_WORKBENCH_ANALYSIS_CONTEXT_CHARS",
            DEFAULT_ANALYSIS_CONTEXT_CHARS,
            minimum=4_000,
        ),
        JSON_AS_ASCII=False,
    )
    if test_config:
        app.config.update(test_config)

    store = ManuscriptStore(
        app.config["MANUSCRIPTS_DIR"],
        max_file_bytes=app.config["MAX_FILE_BYTES"],
        backup_limit=app.config["BACKUP_LIMIT"],
        create_examples=app.config["CREATE_EXAMPLES"],
    )
    store.initialize()
    app.extensions["manuscript_store"] = store
    if not app.config["BOOK_TITLE"]:
        root = Path(app.config["MANUSCRIPTS_DIR"]).expanduser()
        app.config["BOOK_TITLE"] = (
            root.parent.name if root.name.lower() in {"正文", "chapters"} else root.name
        ) or "Writing Workbench"

    register_error_handlers(app)
    register_routes(app)
    return app


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(APIError)
    def handle_api_error(error: APIError):
        return jsonify(error.as_dict()), error.status_code

    @app.errorhandler(RequestEntityTooLarge)
    def handle_too_large(_error: RequestEntityTooLarge):
        error = APIError(
            "请求体超过允许的大小",
            413,
            "request_too_large",
            max_bytes=app.config["MAX_CONTENT_LENGTH"],
        )
        return jsonify(error.as_dict()), 413

    @app.errorhandler(HTTPException)
    def handle_http_exception(error: HTTPException):
        if request.path.startswith("/api/"):
            safe = APIError(
                error.description or error.name,
                error.code or 500,
                error.name.lower().replace(" ", "_"),
            )
            return jsonify(safe.as_dict()), safe.status_code
        return error

    @app.errorhandler(Exception)
    def handle_unexpected(error: Exception):
        app.logger.exception("Unhandled request error", exc_info=error)
        if request.path.startswith("/api/"):
            safe = APIError("服务器内部错误", 500, "internal_error")
            return jsonify(safe.as_dict()), 500
        raise error


def _store(app: Flask) -> ManuscriptStore:
    return app.extensions["manuscript_store"]


def _json_object() -> dict[str, Any]:
    if not request.is_json:
        raise APIError("请求体必须使用 application/json", 415, "json_required")
    payload = request.get_json(silent=False)
    if not isinstance(payload, dict):
        raise APIError("请求体必须是 JSON 对象", 400, "invalid_json")
    return payload


def _optional_json_object() -> dict[str, Any]:
    if not request.data:
        return {}
    return _json_object()


def _expected_sha(payload: dict[str, Any]) -> object:
    supplied = payload.get("expected_sha256")
    if supplied is not None:
        return supplied
    header = request.headers.get("If-Match")
    return header


def _required_text(
    payload: dict[str, Any],
    names: tuple[str, ...],
    *,
    code: str,
    message: str,
    max_chars: int,
) -> str:
    value: object = None
    for name in names:
        if name in payload:
            value = payload[name]
            break
    if not isinstance(value, str) or not value.strip():
        raise APIError(message, 400, code)
    value = value.strip()
    if len(value) > max_chars:
        raise APIError(
            f"{message.rstrip('。')}，且不能超过 {max_chars} 个字符",
            413,
            f"{code.removesuffix('_required')}_too_large",
            max_chars=max_chars,
        )
    return value


def _optional_text(payload: dict[str, Any], name: str, *, max_chars: int) -> str:
    value = payload.get(name, "")
    if value is None:
        return ""
    if not isinstance(value, str):
        raise APIError(f"{name} 必须是字符串", 400, f"invalid_{name}")
    if len(value) > max_chars:
        raise APIError(
            f"{name} 不能超过 {max_chars} 个字符",
            413,
            f"{name}_too_large",
            max_chars=max_chars,
        )
    return value


def _history(payload: dict[str, Any]) -> list[dict[str, str]]:
    raw = payload.get("history", [])
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise APIError("history 必须是数组", 400, "invalid_history")
    result: list[dict[str, str]] = []
    for item in raw[-MAX_HISTORY_ITEMS:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip().lower()
        content = item.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        content = content.strip()
        if content:
            result.append({"role": role, "content": content[:MAX_HISTORY_ITEM_CHARS]})
    return result


def _language(payload: dict[str, Any]) -> str:
    requested = str(payload.get("language") or "zh-CN").strip().lower()
    return "en" if requested.startswith("en") else "zh-CN"


def _clip_chapter(content: str, budget: int) -> tuple[str, bool]:
    if len(content) <= budget:
        return content, False
    marker = "\n\n[… middle of this chapter omitted …]\n\n"
    available = max(0, budget - len(marker))
    head = available // 2
    return content[:head] + marker + content[-(available - head) :], True


def _analysis_manuscript(store: ManuscriptStore, max_chars: int) -> tuple[str, int, bool]:
    chapters = store.list(sort="name", order="asc")
    if not chapters:
        raise APIError("没有可分析的已保存章节", 400, "chapters_required")
    marker_budget = sum(len(item["title"]) + 16 for item in chapters)
    content_budget = max(1_000 * len(chapters), max_chars - marker_budget)
    per_chapter = max(1_000, content_budget // len(chapters))
    sections: list[str] = []
    truncated = False
    for item in chapters:
        _metadata, content = store.read(item["filename"])
        clipped, was_truncated = _clip_chapter(manuscript_body(content), per_chapter)
        truncated = truncated or was_truncated
        sections.append(f"=== {item['title']} ===\n{clipped.strip()}")
    manuscript = "\n\n".join(sections)
    if len(manuscript) > max_chars:
        manuscript = manuscript[:max_chars]
        truncated = True
    return manuscript, len(chapters), truncated


def register_routes(app: Flask) -> None:
    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault(
            "Content-Security-Policy",
            "; ".join(
                (
                    "default-src 'self'",
                    "base-uri 'none'",
                    "object-src 'none'",
                    "frame-ancestors 'none'",
                    "form-action 'self'",
                    "img-src 'self' data:",
                    "font-src 'self'",
                    "style-src 'self'",
                    "script-src 'self'",
                    "connect-src 'self'",
                )
            ),
        )
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        )
        if request.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        chapters = _store(app).list(sort="name", order="asc")
        chapter_count = len(chapters)
        provider_name = normalize_provider_name(app.config["AI_PROVIDER"])
        return jsonify(
            {
                "ok": True,
                "status": "healthy",
                "version": VERSION,
                "provider": provider_name,
                "chapter_count": chapter_count,
                "book_title": app.config["BOOK_TITLE"],
                "target_words": app.config["TARGET_WORDS"],
                "total_words": sum(item["word_count"] for item in chapters),
            }
        )

    @app.get("/api/chapters")
    def list_chapters():
        search = request.args.get("q", request.args.get("search", ""))
        sort = request.args.get("sort", "name").strip().lower()
        order = request.args.get("order", "asc").strip().lower()
        items = _store(app).list(search=search, sort=sort, order=order)
        return jsonify({"ok": True, "chapters": items, "count": len(items)})

    @app.post("/api/chapters")
    def create_chapter():
        metadata, content = _store(app).create(_json_object())
        return jsonify({"ok": True, "created": True, "chapter": metadata, "content": content}), 201

    @app.get("/api/chapters/<path:filename>")
    def get_chapter(filename: str):
        metadata, content = _store(app).read(filename)
        return jsonify({"ok": True, "chapter": metadata, "content": content})

    @app.put("/api/chapters/<path:filename>")
    def update_chapter(filename: str):
        payload = _json_object()
        metadata, content, backup = _store(app).update(
            filename,
            content=payload.get("content"),
            expected_sha256=_expected_sha(payload),
        )
        return jsonify(
            {
                "ok": True,
                "saved": True,
                "chapter": metadata,
                "content": content,
                "backup": backup,
            }
        )

    @app.delete("/api/chapters/<path:filename>")
    def delete_chapter(filename: str):
        payload = _optional_json_object()
        metadata, backup = _store(app).delete(
            filename,
            expected_sha256=_expected_sha(payload),
        )
        return jsonify(
            {
                "ok": True,
                "deleted": True,
                "chapter": metadata,
                "backup": backup,
            }
        )

    @app.post("/api/ai/rewrite")
    def rewrite():
        payload = _json_object()
        text = _required_text(
            payload,
            ("text", "selection", "selected_text"),
            code="text_required",
            message="请选择要改写的文本",
            max_chars=MAX_REWRITE_TEXT_CHARS,
        )
        instruction = _optional_text(payload, "instruction", max_chars=2_000).strip()
        context = _optional_text(payload, "context", max_chars=MAX_CONTEXT_CHARS)
        provider = build_provider(app.config["AI_PROVIDER"])
        result = provider.rewrite(
            text=text,
            instruction=instruction,
            context=context,
            language=_language(payload),
        )
        return jsonify(
            {
                "ok": True,
                "provider": provider.name,
                "preview": True,
                "saved": False,
                "result": result,
                "rewritten_text": result,
            }
        )

    @app.post("/api/ai/ask")
    def ask():
        payload = _json_object()
        question = _required_text(
            payload,
            ("question", "message"),
            code="question_required",
            message="问题不能为空",
            max_chars=MAX_QUESTION_CHARS,
        )
        context = _optional_text(payload, "context", max_chars=MAX_CONTEXT_CHARS)
        history = _history(payload)
        provider = build_provider(app.config["AI_PROVIDER"])
        answer = provider.ask(
            question=question,
            context=context,
            history=history,
            language=_language(payload),
        )
        return jsonify(
            {
                "ok": True,
                "provider": provider.name,
                "answer": answer,
                "reply": answer,
            }
        )

    @app.post("/api/ai/analyze")
    def analyze():
        payload = _optional_json_object()
        manuscript, chapter_count, truncated = _analysis_manuscript(
            _store(app),
            app.config["ANALYSIS_CONTEXT_CHARS"],
        )
        provider = build_provider(app.config["AI_PROVIDER"])
        report = provider.analyze(
            manuscript=manuscript,
            chapter_count=chapter_count,
            language=_language(payload),
        )
        return jsonify(
            {
                "ok": True,
                "provider": provider.name,
                "report": report,
                "analysis": report,
                "analyzed_chapters": chapter_count,
                "truncated": truncated,
                "saved_only": True,
            }
        )
