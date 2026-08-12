from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from writing_workbench import create_app
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
    names = {item["filename"] for item in response.get_json()["chapters"]}
    assert names == {"第一章_灯塔来信.md", "第二章_清晨渡口.txt"}
    examples = [path for path in directory.glob("*.*") if path.is_file()]
    combined = "\n".join(path.read_text() for path in examples)
    assert "Alan" not in combined
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in examples)


def test_security_headers_cover_html_and_api(client) -> None:
    for endpoint in ("/", "/api/health"):
        response = client.get(endpoint)
        assert response.status_code == 200
        assert "default-src 'self'" in response.headers["Content-Security-Policy"]
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
        assert response.headers["X-Frame-Options"] == "DENY"
        assert "camera=()" in response.headers["Permissions-Policy"]


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


def test_openai_credentials_are_not_returned(monkeypatch, manuscript_dir: Path) -> None:
    secret = "test-secret-that-must-not-leak"
    monkeypatch.setenv("WRITING_WORKBENCH_OPENAI_API_KEY", secret)
    monkeypatch.setenv("WRITING_WORKBENCH_OPENAI_MODEL", "example-model")
    app = create_app(
        {
            "TESTING": True,
            "MANUSCRIPTS_DIR": str(manuscript_dir),
            "CREATE_EXAMPLES": False,
            "AI_PROVIDER": "openai-compatible",
        }
    )

    raw = app.test_client().get("/api/health").get_data(as_text=True)

    assert secret not in raw
    assert "example-model" not in raw


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
