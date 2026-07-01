from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DIST_DIR = ROOT_DIR / "backend_dist"
WORK_DIR = ROOT_DIR / "build" / "backend-pyinstaller"
SPEC_DIR = ROOT_DIR / "build"


def run(args: list[str]) -> None:
    subprocess.run(args, cwd=ROOT_DIR, check=True)


def main() -> int:
    try:
        try:
            import PyInstaller  # noqa: F401
        except ImportError:
            run([sys.executable, "-m", "pip", "install", "pyinstaller>=6,<7"])

        run([
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--name",
            "music-video-backend",
            "--distpath",
            str(DIST_DIR),
            "--workpath",
            str(WORK_DIR),
            "--specpath",
            str(SPEC_DIR),
            "--collect-all",
            "uvicorn",
            "--collect-all",
            "fastapi",
            "--collect-all",
            "pydantic",
            "--collect-all",
            "httpx",
            "--hidden-import",
            "uvicorn.logging",
            "--hidden-import",
            "uvicorn.loops.auto",
            "--hidden-import",
            "uvicorn.protocols.http.auto",
            "--hidden-import",
            "uvicorn.protocols.websockets.auto",
            str(ROOT_DIR / "backend" / "main.py"),
        ])

        exe_path = DIST_DIR / ("music-video-backend.exe" if sys.platform.startswith("win") else "music-video-backend")
        if not exe_path.exists():
            raise FileNotFoundError(f"未生成后端可执行文件：{exe_path}")
        print(f"Backend executable built: {exe_path}")
        return 0
    except Exception as error:
        print(f"Backend executable build failed: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
