"""Command-line entry point for Writing Workbench."""

from __future__ import annotations

import argparse
import os
from collections.abc import Sequence

from .app import create_app


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Writing Workbench / 写书工具台")
    default_host = os.environ.get("WRITING_WORKBENCH_HOST", "127.0.0.1")
    try:
        default_port = int(os.environ.get("WRITING_WORKBENCH_PORT", "8787"))
    except ValueError:
        default_port = 8787
    parser.add_argument(
        "--host",
        default=default_host,
        help=f"bind host (default: {default_host})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=default_port,
        help=f"bind port (default: {default_port})",
    )
    parser.add_argument(
        "--manuscripts-dir",
        help="directory containing local .md/.txt manuscripts (overrides WRITING_WORKBENCH_DIR)",
    )
    parser.add_argument("--debug", action="store_true", help="enable Flask debug mode")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = {}
    if args.manuscripts_dir:
        config["MANUSCRIPTS_DIR"] = args.manuscripts_dir
    app = create_app(config)
    # The development server is intentional for the small local-first app.  It
    # binds only to loopback unless the operator explicitly changes --host.
    app.run(host=args.host, port=args.port, debug=args.debug, use_reloader=args.debug)
    return os.EX_OK
