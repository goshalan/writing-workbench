"""Safe local manuscript storage.

The storage layer deliberately accepts only single-component Markdown or text
filenames.  It never follows chapter symlinks, performs writes with
``os.replace``, and keeps recoverable snapshots outside the chapter listing.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import tempfile
import threading
import time
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .errors import APIError

ALLOWED_EXTENSIONS = frozenset({".md", ".txt"})
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
INVALID_FILENAME_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
CHAPTER_NUMBER_RE = re.compile(
    r"^\s*第\s*(\d+|[零〇一二三四五六七八九十百千两]+)\s*章(?:[_\-\s.]|$)",
    re.IGNORECASE,
)
TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|[\u3400-\u9fff]", re.UNICODE)
CHINESE_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
CHINESE_UNITS = {"十": 10, "百": 100, "千": 1_000}

DEFAULT_EXAMPLES = {
    "第一章_灯塔来信.md": """# 第一章 灯塔来信

傍晚的潮水漫过旧码头时，林遥在值班室门缝里发现了一封没有署名的信。

信纸只写着一句话：明天日出前，请把阁楼里那盏旧灯点亮。

她抬头望向山坡。停用多年的灯塔立在雾中，窗后仿佛闪过一道微光。
""",
    "第二章_清晨渡口.txt": """第二章 清晨渡口

天还没有亮，渡船已经靠岸。船夫带来一只落满盐霜的木箱，并说寄件人会在钟声响起时出现。

林遥没有立刻打开箱子。她先记下潮位，又把那封信压在航海图的一角。
""",
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def count_words(text: str) -> int:
    """Count CJK characters and alphanumeric word groups.

    There is no universally correct word boundary for mixed-language prose;
    this small, deterministic rule works without sending text elsewhere or
    adding a tokenizer dependency.
    """

    return len(TOKEN_RE.findall(text))


def chapter_number(value: str) -> int | None:
    if value.isdigit():
        return int(value)
    total = 0
    digit = 0
    for character in value:
        if character in CHINESE_DIGITS:
            digit = CHINESE_DIGITS[character]
        elif character in CHINESE_UNITS:
            total += (digit or 1) * CHINESE_UNITS[character]
            digit = 0
        else:
            return None
    result = total + digit
    return result or None


def validate_filename(value: object) -> str:
    if not isinstance(value, str):
        raise APIError("章节文件名必须是字符串", 400, "invalid_filename")
    name = value.strip()
    if not name:
        raise APIError("章节文件名不能为空", 400, "filename_required")
    if name in {".", ".."} or Path(name).name != name:
        raise APIError("只允许稿件目录内的单个文件名", 400, "invalid_filename")
    if name.startswith(".") or name.startswith("._"):
        raise APIError("隐藏文件不能作为章节", 400, "invalid_filename")
    if INVALID_FILENAME_CHARS_RE.search(name):
        raise APIError("章节文件名包含不允许的字符", 400, "invalid_filename")
    if name.endswith((" ", ".")):
        raise APIError("章节文件名不能以空格或句点结尾", 400, "invalid_filename")
    if len(name) > 180 or len(name.encode("utf-8")) > 240:
        raise APIError("章节文件名过长", 400, "invalid_filename")
    if Path(name).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise APIError("章节仅支持 .md 或 .txt 文件", 400, "invalid_extension")
    return name


def filename_from_payload(payload: dict[str, Any]) -> str:
    explicit = payload.get("filename", payload.get("name"))
    if explicit is not None and str(explicit).strip():
        return validate_filename(explicit)

    title = payload.get("title")
    if not isinstance(title, str) or not title.strip():
        raise APIError("请提供 filename 或 title", 400, "filename_required")
    title = title.strip()
    supplied_extension = Path(title).suffix.lower()
    if supplied_extension in ALLOWED_EXTENSIONS:
        return validate_filename(title)

    extension = str(payload.get("extension") or ".md").strip().lower()
    if not extension.startswith("."):
        extension = f".{extension}"
    if extension not in ALLOWED_EXTENSIONS:
        raise APIError("extension 仅支持 md 或 txt", 400, "invalid_extension")
    stem = INVALID_FILENAME_CHARS_RE.sub("_", title)
    stem = re.sub(r"\s+", "_", stem).strip(" ._")
    if not stem:
        raise APIError("标题无法生成有效的章节文件名", 400, "invalid_filename")
    return validate_filename(f"{stem}{extension}")


class ManuscriptStore:
    """Manage a flat directory of UTF-8 Markdown and text chapters."""

    def __init__(
        self,
        root: str | os.PathLike[str],
        *,
        max_file_bytes: int = 1_900_000,
        backup_limit: int = 10,
        create_examples: bool = True,
    ) -> None:
        self.root = Path(root).expanduser().resolve()
        self.max_file_bytes = max(1, int(max_file_bytes))
        self.backup_limit = max(1, int(backup_limit))
        self.create_examples = bool(create_examples)
        self._write_lock = threading.RLock()

    @property
    def backup_root(self) -> Path:
        return self.root / ".backups"

    def initialize(self) -> None:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise APIError(
                "无法创建稿件目录",
                503,
                "manuscript_directory_unavailable",
            ) from error
        if not self.root.is_dir() or self.root.is_symlink():
            raise APIError("稿件路径不是安全目录", 503, "manuscript_directory_unavailable")
        self._ensure_backup_root()
        if self.create_examples and not self._chapter_paths():
            self._create_examples()

    def _ensure_backup_root(self) -> Path:
        backup_root = self.backup_root
        try:
            backup_root.mkdir(mode=0o700, exist_ok=True)
        except OSError as error:
            raise APIError("无法创建备份目录", 503, "backup_directory_unavailable") from error
        if backup_root.is_symlink() or not backup_root.is_dir():
            raise APIError("备份路径不是安全目录", 503, "backup_directory_unavailable")
        return backup_root

    def _create_examples(self) -> None:
        with self._write_lock:
            if self._chapter_paths():
                return
            for filename, content in DEFAULT_EXAMPLES.items():
                path = self.root / validate_filename(filename)
                data = content.encode("utf-8")
                try:
                    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                except FileExistsError:
                    continue
                except OSError as error:
                    raise APIError("无法创建示例书稿", 503, "example_creation_failed") from error
                try:
                    with os.fdopen(descriptor, "wb") as handle:
                        handle.write(data)
                        handle.flush()
                        os.fsync(handle.fileno())
                except Exception:
                    with suppress(OSError):
                        path.unlink(missing_ok=True)
                    raise
            self._fsync_directory(self.root)

    def _chapter_paths(self) -> list[Path]:
        try:
            paths = [
                path
                for path in self.root.iterdir()
                if path.is_file()
                and not path.is_symlink()
                and not path.name.startswith(".")
                and path.suffix.lower() in ALLOWED_EXTENSIONS
            ]
        except OSError as error:
            raise APIError("无法读取稿件目录", 500, "list_failed") from error
        return paths

    def _path(self, filename: object, *, must_exist: bool) -> Path:
        name = validate_filename(filename)
        path = self.root / name
        if path.is_symlink():
            raise APIError("符号链接不能作为章节", 400, "invalid_filename")
        if must_exist and not path.is_file():
            raise APIError("章节不存在", 404, "chapter_not_found", filename=name)
        if not must_exist and path.exists() and not path.is_file():
            raise APIError("同名路径不能作为章节", 409, "chapter_exists", filename=name)
        return path

    def _read_bytes(self, path: Path) -> bytes:
        if path.is_symlink() or not path.is_file():
            raise APIError("章节不存在", 404, "chapter_not_found", filename=path.name)
        try:
            data = path.read_bytes()
        except OSError as error:
            raise APIError("无法读取章节", 500, "read_failed", filename=path.name) from error
        if len(data) > self.max_file_bytes:
            raise APIError(
                "章节超过允许的大小",
                413,
                "chapter_too_large",
                max_bytes=self.max_file_bytes,
            )
        return data

    @staticmethod
    def _decode(data: bytes, filename: str) -> str:
        try:
            return data.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise APIError(
                "章节不是有效的 UTF-8 文本",
                422,
                "invalid_encoding",
                filename=filename,
            ) from error

    def _metadata(self, path: Path, data: bytes | None = None) -> dict[str, Any]:
        if data is None:
            data = self._read_bytes(path)
        content = self._decode(data, path.name)
        try:
            stat = path.stat()
        except OSError as error:
            raise APIError("无法读取章节元数据", 500, "read_failed") from error
        modified_at = datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(timespec="seconds")
        match = CHAPTER_NUMBER_RE.match(path.stem)
        number = chapter_number(match.group(1)) if match else None
        return {
            "filename": path.name,
            "name": path.name,
            "title": re.sub(r"_+", " ", path.stem).strip(),
            "extension": path.suffix.lower(),
            "size_bytes": len(data),
            "character_count": len(content),
            "word_count": count_words(content),
            "sha256": sha256_bytes(data),
            "modified_at": modified_at,
            "chapter_number": number,
        }

    @staticmethod
    def _natural_name_key(item: dict[str, Any]) -> tuple[Any, ...]:
        number = item.get("chapter_number")
        return (
            number is None,
            number if number is not None else 10**12,
            item["filename"].casefold(),
        )

    def list(
        self,
        *,
        search: str = "",
        sort: str = "name",
        order: str = "asc",
    ) -> list[dict[str, Any]]:
        if sort not in {"name", "modified", "size", "words"}:
            raise APIError("不支持的排序字段", 400, "invalid_sort")
        if order not in {"asc", "desc"}:
            raise APIError("order 必须是 asc 或 desc", 400, "invalid_order")
        query = search.strip().casefold()
        items = [self._metadata(path) for path in self._chapter_paths()]
        if query:
            items = [
                item
                for item in items
                if query in item["filename"].casefold() or query in item["title"].casefold()
            ]
        key_functions = {
            "name": self._natural_name_key,
            "modified": lambda item: (item["modified_at"], item["filename"].casefold()),
            "size": lambda item: (item["size_bytes"], item["filename"].casefold()),
            "words": lambda item: (item["word_count"], item["filename"].casefold()),
        }
        items.sort(key=key_functions[sort], reverse=order == "desc")
        return items

    def count(self) -> int:
        """Return the number of visible chapters without reading manuscript text."""

        return len(self._chapter_paths())

    def read(self, filename: object) -> tuple[dict[str, Any], str]:
        path = self._path(filename, must_exist=True)
        data = self._read_bytes(path)
        return self._metadata(path, data), self._decode(data, path.name)

    def create(self, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
        filename = filename_from_payload(payload)
        content = payload.get("content", "")
        if not isinstance(content, str):
            raise APIError("content 必须是字符串", 400, "invalid_content")
        data = content.encode("utf-8")
        self._validate_content_size(data)
        with self._write_lock:
            path = self._path(filename, must_exist=False)
            self._create_exclusive(path, data, mode=0o600)
            return self._metadata(path, data), content

    def update(
        self,
        filename: object,
        *,
        content: object,
        expected_sha256: object,
    ) -> tuple[dict[str, Any], str, str]:
        if not isinstance(content, str):
            raise APIError("content 必须是字符串", 400, "invalid_content")
        data = content.encode("utf-8")
        self._validate_content_size(data)
        with self._write_lock:
            path = self._path(filename, must_exist=True)
            current = self._read_bytes(path)
            current_sha = sha256_bytes(current)
            self._check_expected_sha(expected_sha256, current_sha)
            try:
                mode = path.stat().st_mode & 0o777
            except OSError as error:
                raise APIError("无法读取章节元数据", 500, "read_failed") from error
            backup = self._backup(path, current)
            self._atomic_write(path, data, mode=mode)
            return self._metadata(path, data), content, backup

    def delete(self, filename: object, *, expected_sha256: object) -> tuple[dict[str, Any], str]:
        with self._write_lock:
            path = self._path(filename, must_exist=True)
            current = self._read_bytes(path)
            current_sha = sha256_bytes(current)
            self._check_expected_sha(expected_sha256, current_sha)
            metadata = self._metadata(path, current)
            backup = self._backup(path, current)
            try:
                path.unlink()
                self._fsync_directory(self.root)
            except OSError as error:
                raise APIError("无法删除章节", 500, "delete_failed", filename=path.name) from error
            return metadata, backup

    def _validate_content_size(self, data: bytes) -> None:
        if len(data) > self.max_file_bytes:
            raise APIError(
                "章节超过允许的大小",
                413,
                "chapter_too_large",
                max_bytes=self.max_file_bytes,
            )

    @staticmethod
    def _check_expected_sha(expected: object, current_sha: str) -> None:
        if not isinstance(expected, str) or not expected.strip():
            raise APIError(
                "更新或删除章节时必须提供 expected_sha256",
                428,
                "expected_sha256_required",
                current_sha256=current_sha,
            )
        normalized = expected.strip().lower().strip('"')
        if normalized.startswith("sha256:"):
            normalized = normalized[7:]
        if not SHA256_RE.fullmatch(normalized):
            raise APIError("expected_sha256 格式不正确", 400, "invalid_sha256")
        if normalized != current_sha:
            raise APIError(
                "章节已被其他操作更新，请重新读取后再试",
                409,
                "chapter_conflict",
                current_sha256=current_sha,
            )

    def _atomic_write(self, path: Path, data: bytes, *, mode: int) -> None:
        descriptor: int | None = None
        temporary: Path | None = None
        try:
            descriptor, temporary_name = tempfile.mkstemp(
                dir=self.root,
                prefix=f".{path.name}.",
                suffix=".tmp",
            )
            temporary = Path(temporary_name)
            with os.fdopen(descriptor, "wb") as handle:
                descriptor = None
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, mode)
            os.replace(temporary, path)
            temporary = None
            self._fsync_directory(self.root)
        except OSError as error:
            raise APIError("无法原子写入章节", 500, "write_failed", filename=path.name) from error
        finally:
            if descriptor is not None:
                os.close(descriptor)
            if temporary is not None:
                with suppress(OSError):
                    temporary.unlink()

    def _create_exclusive(self, path: Path, data: bytes, *, mode: int) -> None:
        """Create a new file without ever replacing an existing path.

        ``O_EXCL`` is used instead of hard-link publication so manuscript
        directories on common removable-drive filesystems remain supported.
        Subsequent saves use the temp-file-and-replace atomic write path.
        """

        descriptor: int | None = None
        created = False
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
            created = True
            with os.fdopen(descriptor, "wb") as handle:
                descriptor = None
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            self._fsync_directory(self.root)
        except FileExistsError as error:
            raise APIError(
                "同名章节已存在",
                409,
                "chapter_exists",
                filename=path.name,
            ) from error
        except OSError as error:
            if created:
                with suppress(OSError):
                    path.unlink()
            raise APIError("无法创建章节", 500, "write_failed", filename=path.name) from error
        finally:
            if descriptor is not None:
                os.close(descriptor)

    def _backup(self, path: Path, data: bytes) -> str:
        root = self._ensure_backup_root()
        chapter_dir = root / path.name
        try:
            chapter_dir.mkdir(mode=0o700, exist_ok=True)
        except OSError as error:
            raise APIError("无法创建章节备份目录", 500, "backup_failed") from error
        if chapter_dir.is_symlink() or not chapter_dir.is_dir():
            raise APIError("章节备份路径不安全", 500, "backup_failed")

        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S.%fZ")
        backup_name = f"{timestamp}-{time.time_ns()}-{sha256_bytes(data)[:12]}.bak"
        destination = chapter_dir / backup_name
        try:
            with destination.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            with suppress(OSError):
                shutil.copystat(path, destination, follow_symlinks=False)
            self._fsync_directory(chapter_dir)
        except OSError as error:
            with suppress(OSError):
                destination.unlink(missing_ok=True)
            raise APIError("无法创建保存前备份", 500, "backup_failed") from error
        self._rotate_backups(chapter_dir)
        return str(destination.relative_to(self.root))

    def _rotate_backups(self, chapter_dir: Path) -> None:
        try:
            backups = sorted(
                (
                    path
                    for path in chapter_dir.iterdir()
                    if path.is_file() and not path.is_symlink() and path.suffix == ".bak"
                ),
                key=lambda path: path.name,
                reverse=True,
            )
            for expired in backups[self.backup_limit :]:
                expired.unlink()
            self._fsync_directory(chapter_dir)
        except OSError as error:
            raise APIError("无法轮换章节备份", 500, "backup_rotation_failed") from error

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        try:
            descriptor = os.open(directory, flags)
        except OSError:
            return
        try:
            os.fsync(descriptor)
        except OSError:
            pass
        finally:
            os.close(descriptor)
