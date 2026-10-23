#!/usr/bin/env python3
"""Start and supervise the SNOR Node.js server."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MIN_NODE_MAJOR = 20


def project_setting(name: str, fallback: str) -> str:
    value = os.environ.get(name)
    if value:
        return value

    env_file = ROOT / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8-sig").splitlines():
            match = re.match(rf"^\s*{re.escape(name)}\s*=\s*(.*?)\s*$", line)
            if match:
                return match.group(1).strip("\"'")
    return fallback


def parse_port(value: str) -> int:
    try:
        port = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("port must be an integer") from error
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1 and 65535")
    return port


def available_node() -> str:
    node = os.environ.get("NODE_BINARY") or shutil.which("node")
    if not node:
        candidates = (
            Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
            / "nodejs"
            / "node.exe",
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
            / "nodejs"
            / "node.exe",
            Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
            / "Programs"
            / "nodejs"
            / "node.exe",
        )
        node = next((str(candidate) for candidate in candidates if candidate.is_file()), None)
    if not node:
        raise RuntimeError("Node.js 20 or newer is required. Install Node.js and try again.")

    result = subprocess.run(
        [node, "--version"],
        check=True,
        capture_output=True,
        text=True,
    )
    match = re.fullmatch(r"v?(\d+)\.\d+\.\d+", result.stdout.strip())
    if not match or int(match.group(1)) < MIN_NODE_MAJOR:
        raise RuntimeError(
            f"Node.js {MIN_NODE_MAJOR} or newer is required; found {result.stdout.strip()!r}."
        )
    return node


def wait_until_ready(process: subprocess.Popen[bytes], url: str) -> bool:
    deadline = time.monotonic() + 20
    health_url = f"{url}/api/status"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(health_url, timeout=1) as response:
                if response.status == 200:
                    return True
        except (OSError, urllib.error.URLError):
            time.sleep(0.25)
    return False


def stop_process(process: subprocess.Popen[bytes]) -> int:
    if process.poll() is None:
        print("\nStopping SNOR…", flush=True)
        process.terminate()
        try:
            return process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            print("SNOR did not stop in time; forcing shutdown.", flush=True)
            process.kill()
    return process.wait()


def main() -> int:
    parser = argparse.ArgumentParser(description="Launch and manage the SNOR study tutor.")
    parser.add_argument("--host", help="Bind address (default: HOST from .env or 127.0.0.1).")
    parser.add_argument("--port", type=parse_port, help="Port (default: PORT from .env or 4173).")
    parser.add_argument(
        "--open-browser",
        action="store_true",
        help="Open the local SNOR page after the server is ready.",
    )
    args = parser.parse_args()

    try:
        node = available_node()
        host = args.host or project_setting("HOST", "127.0.0.1")
        port = args.port or parse_port(project_setting("PORT", "4173"))
        env = os.environ.copy()
        env["HOST"] = host
        env["PORT"] = str(port)

        process = subprocess.Popen(
            [node, "server.mjs"],
            cwd=ROOT,
            env=env,
        )
        browser_host = "127.0.0.1" if host in {"0.0.0.0", "::", "[::]"} else host
        url = f"http://{browser_host}:{port}"

        if not wait_until_ready(process, url):
            exit_code = process.poll()
            if exit_code is None:
                stop_process(process)
                raise RuntimeError("SNOR did not become ready within 20 seconds.")
            raise RuntimeError(
                f"SNOR exited during startup with exit code {exit_code}. "
                "Check the server output and confirm the port is available."
            )

        print(f"SNOR is ready at {url}. Press Ctrl+C to stop it.", flush=True)
        if args.open_browser:
            webbrowser.open(url)

        try:
            return process.wait()
        except KeyboardInterrupt:
            stop_process(process)
            return 130
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"SNOR launcher: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
