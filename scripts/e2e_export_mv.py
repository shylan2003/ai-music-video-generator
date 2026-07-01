from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
BASE_URL = os.environ.get("MUSIC_VIDEO_TEST_BACKEND", "http://127.0.0.1:8000").rstrip("/")
FFMPEG_CANDIDATES = [
    ROOT_DIR / "node_modules" / "@ffmpeg-installer" / "win32-x64" / "ffmpeg.exe",
    ROOT_DIR / "node_modules" / "ffmpeg-static" / "ffmpeg.exe",
]
FFMPEG_PATH = next((path for path in FFMPEG_CANDIDATES if path.exists()), FFMPEG_CANDIDATES[-1])
ARTIFACT_DIR = ROOT_DIR / "artifacts" / "e2e"
OUTPUT_PATH = ARTIFACT_DIR / "sample_mv.mp4"


class ExportFailure(AssertionError):
    pass


def post_json(path: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def backend_is_ready() -> bool:
    try:
        return get_json("/health").get("status") == "ok"
    except (OSError, urllib.error.URLError, TimeoutError):
        return False


def start_backend_if_needed() -> subprocess.Popen[str] | None:
    if backend_is_ready():
        return None

    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=BACKEND_DIR,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    deadline = time.time() + 30
    while time.time() < deadline:
        if backend_is_ready():
            return process
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise ExportFailure(f"后端启动失败：\n{output}")
        time.sleep(0.5)

    process.terminate()
    raise ExportFailure("后端 30 秒内未就绪")


def parse_lrc_file(file_path: Path) -> list[dict]:
    lyrics: list[dict] = []
    line_pattern = re.compile(r"\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\](.*)")

    for raw_line in file_path.read_text(encoding="utf-8-sig").splitlines():
        for match in line_pattern.finditer(raw_line):
            text = match.group(3).strip()
            if not text:
                continue
            lyrics.append({
                "id": f"{file_path.stem}-{len(lyrics) + 1}",
                "time": round(int(match.group(1)) * 60 + float(match.group(2)), 3),
                "text": text,
            })

    return lyrics


def ass_time(seconds: float) -> str:
    safe_seconds = max(0.0, seconds)
    hours = int(safe_seconds // 3600)
    minutes = int((safe_seconds % 3600) // 60)
    secs = int(safe_seconds % 60)
    centiseconds = int((safe_seconds - int(safe_seconds)) * 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{centiseconds:02d}"


def escape_ass(text: str) -> str:
    return text.replace("{", "").replace("}", "").replace("\n", "\\N")


def write_subtitles(path: Path, lyrics: list[dict], total_duration: float) -> None:
    valid = sorted((line for line in lyrics if not line.get("skip") and line.get("text", "").strip()), key=lambda item: item["time"])
    header = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1920",
        "PlayResY: 1080",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Microsoft YaHei,52,&H00FFFFFF,&H00FFFFFF,&HA0000000,&H30000000,0,0,0,0,100,100,1,0,1,2,1,2,100,100,78,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    events = []
    for index, line in enumerate(valid):
        next_time = valid[index + 1]["time"] if index + 1 < len(valid) else min(line["time"] + 4, total_duration)
        end_time = max(line["time"] + 0.8, min(next_time, total_duration))
        events.append(f"Dialogue: 0,{ass_time(line['time'])},{ass_time(end_time)},Default,,0,0,0,,{escape_ass(line['text'])}")
    path.write_text("\n".join(header + events), encoding="utf-8")


def run_ffmpeg(args: list[str]) -> str:
    result = subprocess.run(
        [str(FFMPEG_PATH), *args],
        cwd=ROOT_DIR,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if result.returncode != 0:
        raise ExportFailure(result.stdout[-4000:])
    return result.stdout


def build_scene_clip(scene: dict, index: int, temp_dir: Path, subtitle_path: Path) -> Path:
    duration = max(0.5, float(scene["end_time"]) - float(scene["start_time"]))
    color_seed = (index * 47 + 80) % 255
    color = f"0x{color_seed:02x}{(160 - index * 9) % 255:02x}{(210 + index * 13) % 255:02x}"
    output = temp_dir / f"scene-{index:04d}.mp4"
    subtitle_filter_path = str(subtitle_path).replace("\\", "/").replace(":", "\\:")
    run_ffmpeg([
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c={color}:s=1920x1080:d={duration:.3f}:r=30",
        "-vf",
        f"subtitles='{subtitle_filter_path}',format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "26",
        "-t",
        f"{duration:.3f}",
        str(output),
    ])
    return output


def concat_with_audio(clips: list[Path], audio_path: Path, output_path: Path) -> None:
    concat_file = output_path.parent / "concat.txt"
    concat_file.write_text(
        "\n".join(f"file '{str(clip).replace(chr(92), '/')}'" for clip in clips),
        encoding="utf-8",
    )
    run_ffmpeg([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_file),
        "-i",
        str(audio_path),
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(output_path),
    ])


def inspect_duration(path: Path) -> float:
    output = run_ffmpeg(["-i", str(path), "-f", "null", "-"])
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", output)
    if not match:
        return 0.0
    return int(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3))


def main() -> int:
    process = None
    try:
        if not FFMPEG_PATH.exists():
            raise ExportFailure(f"未找到 ffmpeg-static：{FFMPEG_PATH}")
        lrc_files = sorted(ROOT_DIR.glob("*.lrc"))
        audio_files = sorted(list(ROOT_DIR.glob("*.mp3")) + list(ROOT_DIR.glob("*.wav")) + list(ROOT_DIR.glob("*.m4a")))
        if not lrc_files or not audio_files:
            raise ExportFailure("根目录需要至少一个 LRC 和一个音频文件")

        lyrics = parse_lrc_file(lrc_files[0])
        if len(lyrics) < 10:
            raise ExportFailure("真实 LRC 歌词过少，无法做样片测试")

        process = start_backend_if_needed()
        filter_result = post_json("/api/lyrics/filter", {"lyrics": lyrics})
        filtered_lyrics = filter_result["lyrics"]
        duration = max(line["time"] for line in filtered_lyrics) + 8
        storyboard = post_json("/api/generate/smart-storyboard", {
            "lyrics": filtered_lyrics,
            "style": "ornate_gufeng",
            "duration": duration,
            "song_name": lrc_files[0].stem,
            "image_provider": {"provider": "placeholder", "model": "placeholder", "size": "1920x1080"},
            "visual_lock": {
                "enabled": True,
                "main_subject": "white hanfu pipa player",
                "setting": "moonlit ancient river and boat",
                "palette": "ink blue, cold moon white, muted gold",
                "symbols": "pipa, river moon, maple leaves",
                "negative_prompt": "modern city, text, watermark",
            },
        })
        scenes = storyboard.get("scenes", [])
        if not scenes:
            raise ExportFailure("后端未生成分镜")

        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        temp_dir = ARTIFACT_DIR / "clips"
        temp_dir.mkdir(parents=True, exist_ok=True)
        subtitle_path = ARTIFACT_DIR / "lyrics.ass"
        write_subtitles(subtitle_path, filtered_lyrics, duration)
        clips = [build_scene_clip(scene, index, temp_dir, subtitle_path) for index, scene in enumerate(scenes)]
        concat_with_audio(clips, audio_files[0], OUTPUT_PATH)

        if not OUTPUT_PATH.exists() or OUTPUT_PATH.stat().st_size < 200_000:
            raise ExportFailure("输出 MP4 文件不存在或体积异常")
        output_duration = inspect_duration(OUTPUT_PATH)
        expected_duration = float(scenes[-1]["end_time"])
        if output_duration < expected_duration - 3:
            raise ExportFailure(f"输出时长异常：{output_duration:.2f}s < 预期 {expected_duration:.2f}s")

        print(json.dumps({
            "ok": True,
            "audio": audio_files[0].name,
            "lyrics": lrc_files[0].name,
            "scenes": len(scenes),
            "output": str(OUTPUT_PATH),
            "duration_seconds": round(output_duration, 2),
            "size_bytes": OUTPUT_PATH.stat().st_size,
        }, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False, indent=2))
        return 1
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
