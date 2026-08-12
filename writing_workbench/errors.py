"""Structured application errors for Writing Workbench."""

from __future__ import annotations

from typing import Any


class APIError(Exception):
    """An error that is safe to return to an API client."""

    def __init__(
        self,
        message: str,
        status_code: int = 400,
        code: str = "bad_request",
        **details: Any,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details

    def as_dict(self) -> dict[str, Any]:
        error: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
        }
        if self.details:
            error["details"] = self.details
        return {"ok": False, "error": error}
