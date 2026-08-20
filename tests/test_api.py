from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest

from writing_workbench import create_app, providers
from writing_workbench.cli import build_parser


@pytest.fixture()
def manuscript_dir(tmp_path: Path) -> Path:
    return tmp_path / "manuscripts"


@pytest.fixture()
def app(manuscript_dir: Path):
    return create_app(
        {
            "TESTING": True,
            "MANUSCRIPTS_DIR": str(manuscript_dir),
            "CREATE_EXAMPLES": False,
            "AI_PROVIDER": "mock",
            "BACKUP_LIMIT": 2,
            "MAX_CONTENT_LENGTH": 4_096,
            "MAX_FILE_BYTES": 2_048,
        }
    )


@pytest.fixture()
def client(app):
    return app.test_client()


def error_code(response) -> str:
    return response.get_json()["error"]["code"]


def test_cli_host_and_port_environment_defaults(monkeypatch) -> None:
    monkeypatch.setenv("WRITING_WORKBENCH_HOST", "127.0.0.2")
    monkeypatch.setenv("WRITING_WORKBENCH_PORT", "9191")

    args = build_parser().parse_args([])
    override = build_parser().parse_args(["--host", "127.0.0.1", "--port", "9292"])

    assert (args.host, args.port) == ("127.0.0.2", 9191)
    assert (override.host, override.port) == ("127.0.0.1", 9292)


def create_chapter(client, filename: str = "第一章_风声.md", content: str = "风从桥上来。"):
    return client.post("/api/chapters", json={"filename": filename, "content": content})


def test_first_start_creates_neutral_examples(tmp_path: Path) -> None:
    directory = tmp_path / "fresh"
    app = create_app(
        {
            "TESTING": True,
            "MANUSCRIPTS_DIR": str(directory),
            "CREATE_EXAMPLES": True,
            "AI_PROVIDER": "mock",
        }
    )

    response = app.test_client().get("/api/chapters")

    assert response.status_code == 200
    chapter_items = response.get_json()["chapters"]
    names = {item["filename"] for item in chapter_items}
    assert names == {"第一章_灯塔来信.md", "第二章_清晨渡口.txt"}
    assert [item["chapter_number"] for item in chapter_items] == [1, 2]
    examples = [path for path in directory.glob("*.*") if path.is_file()]
    combined = "\n".join(path.read_text() for path in examples)
    assert "Alan" not in combined
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in examples)


def test_health_and_metadata_use_book_config_and_prose_only(tmp_path: Path) -> None:
    directory = tmp_path / "chapters"
    directory.mkdir()
    (directory / "第001章_来信.md").write_text(
        "---\nproject: test\nstatus: draft\n---\n\n# 第一章 来信\n\n林遥收到一封信。\n",
        encoding="utf-8",
    )
    configured = create_app(
        {
            "TESTING": True,
            "MANUSCRIPTS_DIR": str(directory),
            "CREATE_EXAMPLES": False,
            "AI_PROVIDER": "mock",
            "BOOK_TITLE": "测试书稿",
            "TARGET_WORDS": 120_000,
        }
    )

    client = configured.test_client()
    health = client.get("/api/health").get_json()
    chapter = client.get("/api/chapters").get_json()["chapters"][0]

    assert health["book_title"] == "测试书稿"
    assert health["target_words"] == 120_000
    assert health["total_words"] == 7
    assert chapter["title"] == "第一章 来信"
    assert chapter["word_count"] == 7
    assert chapter["character_count"] == 9


def test_security_headers_cover_html_and_api(client) -> None:
    for endpoint in ("/", "/api/health"):
        response = client.get(endpoint)
        assert response.status_code == 200
        assert "default-src 'self'" in response.headers["Content-Security-Policy"]
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
        assert response.headers["X-Frame-Options"] == "DENY"
        assert "camera=()" in response.headers["Permissions-Policy"]

    html = client.get("/").get_data(as_text=True)
    assert "i18n.js" in html
    assert 'id="analysisTab"' in html
    assert 'data-i18n="assistant.analysis"' in html


@pytest.mark.parametrize(
    "path",
    [
        "/api/chapters/..%2Foutside.md",
        "/api/chapters/%2E%2E%2Foutside.txt",
        "/api/chapters/folder%2Fchapter.md",
        "/api/chapters/folder%5Cchapter.md",
        "/api/chapters/.hidden.md",
        "/api/chapters/chapter.pdf",
    ],
)
def test_path_traversal_and_unsafe_names_are_rejected(client, path: str) -> None:
    response = client.get(path)

    assert response.status_code == 400
    assert response.is_json
    assert error_code(response) in {"invalid_filename", "invalid_extension"}


def test_create_list_search_sort_read_update_and_delete(client, manuscript_dir: Path) -> None:
    first = create_chapter(client, "第2章_树影.md", "旧内容")
    second = create_chapter(client, "第10章_渡口.txt", "another chapter")
    assert first.status_code == 201
    assert second.status_code == 201
    assert (manuscript_dir / "第2章_树影.md").stat().st_mode & 0o777 == 0o600

    listed = client.get("/api/chapters?sort=name&order=asc")
    assert listed.status_code == 200
    assert [item["filename"] for item in listed.get_json()["chapters"]] == [
        "第2章_树影.md",
        "第10章_渡口.txt",
    ]

    searched = client.get("/api/chapters?q=%E6%A0%91%E5%BD%B1")
    assert [item["filename"] for item in searched.get_json()["chapters"]] == ["第2章_树影.md"]

    read = client.get("/api/chapters/%E7%AC%AC2%E7%AB%A0_%E6%A0%91%E5%BD%B1.md")
    payload = read.get_json()
    assert read.status_code == 200
    assert payload["content"] == "旧内容"
    assert payload["chapter"]["sha256"] == hashlib.sha256("旧内容".encode()).hexdigest()
    assert payload["chapter"]["character_count"] == 3
    assert payload["chapter"]["word_count"] == 3

    saved = client.put(
        "/api/chapters/%E7%AC%AC2%E7%AB%A0_%E6%A0%91%E5%BD%B1.md",
        json={"content": "新内容", "expected_sha256": payload["chapter"]["sha256"]},
    )
    assert saved.status_code == 200
    saved_payload = saved.get_json()
    assert saved_payload["saved"] is True
    assert (manuscript_dir / "第2章_树影.md").read_text() == "新内容"
    backup = manuscript_dir / saved_payload["backup"]
    assert backup.read_text() == "旧内容"

    deleted = client.delete(
        "/api/chapters/%E7%AC%AC2%E7%AB%A0_%E6%A0%91%E5%BD%B1.md",
        json={"expected_sha256": saved_payload["chapter"]["sha256"]},
    )
    assert deleted.status_code == 200
    assert deleted.get_json()["deleted"] is True
    assert not (manuscript_dir / "第2章_树影.md").exists()
    assert (manuscript_dir / deleted.get_json()["backup"]).read_text() == "新内容"


def test_duplicate_create_and_missing_chapter_are_structured(client) -> None:
    assert create_chapter(client).status_code == 201
    duplicate = create_chapter(client)
    missing = client.get("/api/chapters/not-here.md")

    assert duplicate.status_code == 409
    assert error_code(duplicate) == "chapter_exists"
    assert missing.status_code == 404
    assert error_code(missing) == "chapter_not_found"


def test_optimistic_concurrency_requires_current_sha(client) -> None:
    created = create_chapter(client)
    current_sha = created.get_json()["chapter"]["sha256"]

    missing_precondition = client.put(
        "/api/chapters/%E7%AC%AC%E4%B8%80%E7%AB%A0_%E9%A3%8E%E5%A3%B0.md",
        json={"content": "第一次保存"},
    )
    assert missing_precondition.status_code == 428
    assert error_code(missing_precondition) == "expected_sha256_required"

    first_save = client.put(
        "/api/chapters/%E7%AC%AC%E4%B8%80%E7%AB%A0_%E9%A3%8E%E5%A3%B0.md",
        json={"content": "第一次保存", "expected_sha256": current_sha},
    )
    assert first_save.status_code == 200

    conflict = client.put(
        "/api/chapters/%E7%AC%AC%E4%B8%80%E7%AB%A0_%E9%A3%8E%E5%A3%B0.md",
        json={"content": "过期写入", "expected_sha256": current_sha},
    )
    assert conflict.status_code == 409
    assert error_code(conflict) == "chapter_conflict"
    assert (
        conflict.get_json()["error"]["details"]["current_sha256"]
        == first_save.get_json()["chapter"]["sha256"]
    )


def test_if_match_header_is_supported(client) -> None:
    created = create_chapter(client)
    current_sha = created.get_json()["chapter"]["sha256"]

    response = client.put(
        "/api/chapters/%E7%AC%AC%E4%B8%80%E7%AB%A0_%E9%A3%8E%E5%A3%B0.md",
        json={"content": "header save"},
        headers={"If-Match": f'"{current_sha}"'},
    )

    assert response.status_code == 200


def test_backups_are_rotated_per_chapter(client, manuscript_dir: Path) -> None:
    created = create_chapter(client, content="v0")
    sha = created.get_json()["chapter"]["sha256"]
    for content in ("v1", "v2", "v3"):
        response = client.put(
            "/api/chapters/%E7%AC%AC%E4%B8%80%E7%AB%A0_%E9%A3%8E%E5%A3%B0.md",
            json={"content": content, "expected_sha256": sha},
        )
        assert response.status_code == 200
        sha = response.get_json()["chapter"]["sha256"]

    backups = list((manuscript_dir / ".backups" / "第一章_风声.md").glob("*.bak"))
    assert len(backups) == 2
    assert {path.read_text() for path in backups} == {"v1", "v2"}


def test_mock_provider_rewrite_and_ask_are_network_free(client) -> None:
    rewrite = client.post(
        "/api/ai/rewrite",
        json={"text": "其实，  风很大。", "instruction": "请精简"},
    )
    ask = client.post(
        "/api/ai/ask",
        json={
            "question": "下一场戏如何推进？",
            "context": "主人公刚刚收到一封信。",
            "history": [{"role": "user", "content": "先梳理人物目标"}],
        },
    )

    assert rewrite.status_code == 200
    assert rewrite.get_json()["provider"] == "mock"
    assert rewrite.get_json()["result"] == "风很大。"
    assert rewrite.get_json()["saved"] is False
    assert ask.status_code == 200
    assert ask.get_json()["provider"] == "mock"
    assert "下一场戏如何推进" in ask.get_json()["answer"]


def test_mock_provider_analyzes_all_saved_chapters(client) -> None:
    create_chapter(client, "第一章_来信.md", "# 第一章 来信\n林遥收到一封没有署名的信。")
    create_chapter(client, "第二章_灯塔.md", "# 第二章 灯塔\n她决定在日出前点亮旧灯。")

    response = client.post("/api/ai/analyze", json={"language": "zh-CN"})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["provider"] == "mock"
    assert payload["analyzed_chapters"] == 2
    assert payload["saved_only"] is True
    assert "人物关系" in payload["report"]
    assert "下一章建议" in payload["report"]


def test_analysis_requires_a_saved_chapter(client) -> None:
    response = client.post("/api/ai/analyze", json={"language": "en"})

    assert response.status_code == 400
    assert error_code(response) == "chapters_required"


def test_off_provider_returns_structured_503(manuscript_dir: Path) -> None:
    app = create_app(
        {
            "TESTING": True,
            "MANUSCRIPTS_DIR": str(manuscript_dir),
            "CREATE_EXAMPLES": False,
            "AI_PROVIDER": "off",
        }
    )
    response = app.test_client().post("/api/ai/rewrite", json={"text": "一段文字"})

    assert response.status_code == 503
    assert error_code(response) == "ai_provider_disabled"


def test_hermes_provider_uses_local_profile_without_api_key(
    monkeypatch, manuscript_dir: Path
) -> None:
    captured: dict[str, object] = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return SimpleNamespace(returncode=0, stdout="Local Hermes reply\n", stderr="")

    monkeypatch.setattr(providers.subprocess, "run", fake_run)
    monkeypatch.setenv("WRITING_WORKBENCH_HERMES_COMMAND", "/opt/local/bin/hermes")
    monkeypatch.setenv("WRITING_WORKBENCH_HERMES_PROFILE", "workbench-test")
    app = create_app(
        {
            "TESTING": True,
            "MANUSCRIPTS_DIR": str(manuscript_dir),
            "CREATE_EXAMPLES": False,
            "AI_PROVIDER": "hermes",
        }
    )

    response = app.test_client().post(
        "/api/ai/ask",
        json={"question": "What comes next?", "context": "A letter arrives.", "language": "en"},
    )
    command = captured["command"]

    assert response.status_code == 200
    assert response.get_json()["answer"] == "Local Hermes reply"
    assert command[:3] == ["/opt/local/bin/hermes", "--profile", "workbench-test"]
    assert "--ignore-rules" in command
    assert command[command.index("--toolsets") + 1] == "vision"
    assert "--oneshot" in command


def test_hermes_provider_uses_current_profile_by_default(monkeypatch) -> None:
    monkeypatch.delenv("WRITING_WORKBENCH_HERMES_PROFILE", raising=False)

    provider = providers.build_provider("hermes")

    assert provider.profile == ""


def test_request_body_limit_returns_structured_413(tmp_path: Path) -> None:
    app = create_app(
        {
            "TESTING": True,
            "MANUSCRIPTS_DIR": str(tmp_path / "limited"),
            "CREATE_EXAMPLES": False,
            "AI_PROVIDER": "mock",
            "MAX_CONTENT_LENGTH": 128,
            "MAX_FILE_BYTES": 1_024,
        }
    )

    response = app.test_client().post(
        "/api/chapters",
        json={"filename": "large.md", "content": "x" * 500},
    )

    assert response.status_code == 413
    assert error_code(response) == "request_too_large"


def test_file_size_limit_is_independent_from_request_limit(tmp_path: Path) -> None:
    app = create_app(
        {
            "TESTING": True,
            "MANUSCRIPTS_DIR": str(tmp_path / "file-limited"),
            "CREATE_EXAMPLES": False,
            "AI_PROVIDER": "mock",
            "MAX_CONTENT_LENGTH": 2_048,
            "MAX_FILE_BYTES": 16,
        }
    )

    response = app.test_client().post(
        "/api/chapters",
        json={"filename": "large.md", "content": "超" * 10},
    )

    assert response.status_code == 413
    assert error_code(response) == "chapter_too_large"
