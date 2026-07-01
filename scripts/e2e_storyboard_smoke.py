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
TIMEOUT_SECONDS = 30


SAMPLE_LYRICS = [
    {"id": "meta-title", "time": 0.0, "text": "琵琶行 - 奇然/沈谧仁"},
    {"id": "meta-lyricist", "time": 0.1, "text": "词：白居易"},
    {"id": "meta-composer", "time": 0.2, "text": "曲：徒有琴"},
    {"id": "meta-arranger", "time": 0.3, "text": "编曲：徒有琴 奇然:"},
    {"id": "singer-1", "time": 0.5, "text": "奇然:"},
    {"id": "l1", "time": 1.0, "text": "浔阳江头夜送客枫叶荻花秋瑟瑟"},
    {"id": "l2", "time": 5.0, "text": "主人下马客在船"},
    {"id": "l3", "time": 8.0, "text": "举酒欲饮无管弦醉不成欢惨将别"},
    {"id": "l4", "time": 12.0, "text": "别时茫茫江浸月"},
    {"id": "l5", "time": 16.0, "text": "忽闻水上琵琶声主人忘归客不发"},
    {"id": "l6", "time": 20.0, "text": "寻声暗问弹者谁琵琶声停欲语迟"},
    {"id": "singer-2", "time": 24.0, "text": "沈谧仁:"},
    {"id": "l7", "time": 25.0, "text": "大弦嘈嘈如急雨小弦切切如私语"},
    {"id": "short-1", "time": 28.0, "text": "如私语"},
    {"id": "l8", "time": 31.0, "text": "嘈嘈切切错杂弹大珠小珠落玉盘"},
    {"id": "short-2", "time": 34.0, "text": "落玉盘"},
    {"id": "l9", "time": 38.0, "text": "间关莺语花底滑幽咽泉流冰下难"},
    {"id": "l10", "time": 42.0, "text": "冰泉冷涩弦凝绝凝绝不通声暂歇"},
    {"id": "l11", "time": 46.0, "text": "别有幽愁暗恨生此时无声胜有声"},
    {"id": "short-3", "time": 50.0, "text": "胜有声"},
    {"id": "l12", "time": 54.0, "text": "银瓶乍破水浆迸铁骑突出刀枪鸣"},
    {"id": "short-4", "time": 58.0, "text": "刀枪鸣"},
    {"id": "l13", "time": 62.0, "text": "曲终收拨当心画四弦一声如裂帛"},
    {"id": "short-5", "time": 65.0, "text": "如裂帛"},
    {"id": "l14", "time": 69.0, "text": "东船西舫悄无言唯见江心秋月白"},
    {"id": "l15", "time": 73.0, "text": "座中泣下谁最多江州司马青衫湿 奇然:"},
]


EXPECTED_SKIPPED_IDS = {
    "meta-title",
    "meta-lyricist",
    "meta-composer",
    "meta-arranger",
    "singer-1",
    "singer-2",
}
SHORT_IDS = {"short-1", "short-2", "short-3", "short-4", "short-5"}
FORBIDDEN_SCENE_TEXT = ["琵琶行 -", "词：", "曲：", "编曲：", "奇然:", "沈谧仁:", "奇然：", "沈谧仁："]


class SmokeFailure(AssertionError):
    pass


def post_json(path: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
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
            raise SmokeFailure(f"后端启动失败：\n{output}")
        time.sleep(0.5)

    process.terminate()
    raise SmokeFailure("后端 30 秒内未就绪")


def assert_condition(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def normalize_text(text: str) -> str:
    return re.sub(r"[\s，。！？、；：:,.!?;《》【】（）()·\-]+", "", text.strip())


def parse_lrc_file(file_path: Path) -> list[dict]:
    lyrics: list[dict] = []
    line_pattern = re.compile(r"\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\](.*)")

    for raw_line in file_path.read_text(encoding="utf-8-sig").splitlines():
        for match in line_pattern.finditer(raw_line):
            minutes = int(match.group(1))
            seconds = float(match.group(2))
            text = match.group(3).strip()
            if not text:
                continue
            lyrics.append({
                "id": f"{file_path.stem}-{len(lyrics) + 1}",
                "time": round(minutes * 60 + seconds, 3),
                "text": text,
            })

    return lyrics


def run_storyboard_probe(
    lyrics: list[dict],
    *,
    song_name: str,
    duration: float,
    expected_skipped_ids: set[str] | None = None,
    expected_short_ids: set[str] | None = None,
    min_valid_lyrics: int = 8,
) -> dict:
    filter_result = post_json("/api/lyrics/filter", {"lyrics": lyrics})
    filtered_lyrics = filter_result.get("lyrics", [])
    skipped_ids = {line["id"] for line in filtered_lyrics if line.get("skip")}
    valid_lyrics = [line for line in filtered_lyrics if not line.get("skip")]

    if expected_skipped_ids:
        missing_skips = expected_skipped_ids - skipped_ids
        assert_condition(not missing_skips, f"以下元信息/歌手标签没有被跳过：{sorted(missing_skips)}")
    assert_condition(len(valid_lyrics) >= min_valid_lyrics, f"有效歌词数量异常：{len(valid_lyrics)}")

    short_ids = expected_short_ids or {
        line["id"]
        for line in valid_lyrics
        if len(normalize_text(line.get("text", ""))) < 8
    }

    request_payload = {
        "lyrics": filtered_lyrics,
        "style": "gorgeous_ancient",
        "duration": duration,
        "song_name": song_name,
        "visual_lock": {
            "enabled": True,
            "main_subject": "silver-haired pipa player in white hanfu",
            "wardrobe": "white hanfu, jade hairpin, no modern clothing",
            "setting": "moonlit autumn river and ancient boat",
            "palette": "cold moon white, ink blue, muted gold",
            "symbols": "pipa, river moon, maple leaves, water ripples",
            "negative_prompt": "modern city, neon, text, watermark",
        },
        "image_provider": {
            "provider": "placeholder",
            "model": "placeholder",
            "size": "1280x720",
            "quality": "medium",
        },
    }
    storyboard_result = post_json("/api/generate/smart-storyboard", request_payload)
    scenes = storyboard_result.get("scenes", [])
    analysis = storyboard_result.get("analysis", {})

    assert_condition(scenes, "智能分镜没有生成任何场景")
    assert_condition(analysis.get("total_scenes") == len(scenes), "analysis.total_scenes 与实际场景数不一致")
    assert_condition(analysis.get("valid_lyrics") == len(valid_lyrics), "analysis.valid_lyrics 与过滤结果不一致")

    covered_ids = {lyric_id for scene in scenes for lyric_id in scene.get("lyric_ids", [])}
    expected_valid_ids = {line["id"] for line in valid_lyrics}
    assert_condition(covered_ids == expected_valid_ids, "智能分镜没有完整覆盖有效歌词")

    for scene in scenes:
        description = scene.get("description", "")
        prompt = scene.get("prompt", "")
        lyric_ids = scene.get("lyric_ids", [])
        assert_condition(scene.get("image_url"), f"场景 {scene.get('scene_index')} 缺少 image_url")
        assert_condition(scene.get("prompt"), f"场景 {scene.get('scene_index')} 缺少 prompt")
        assert_condition("silver-haired pipa player" in prompt, f"视觉锁定主角未进入 Prompt：{scene.get('scene_index')}")
        assert_condition("cold moon white" in prompt, f"视觉锁定色调未进入 Prompt：{scene.get('scene_index')}")
        assert_condition(len(description.strip()) >= 8, f"场景 {scene.get('scene_index')} 描述过短：{description}")
        assert_condition(
            not any(text in description for text in FORBIDDEN_SCENE_TEXT),
            f"场景 {scene.get('scene_index')} 混入了元信息或歌手标签：{description}",
        )
        if short_ids.intersection(lyric_ids):
            assert_condition(
                len(lyric_ids) > 1,
                f"短句没有合并到周围歌词中：场景 {scene.get('scene_index')} -> {description}",
            )

    video_probe = post_json(
        "/api/generate/video",
        {
            "prompt": scenes[0]["video_prompt"],
            "image_url": scenes[0]["image_url"],
            "scene_index": scenes[0]["scene_index"],
            "duration": 4,
            "camera_motion": scenes[0].get("camera_motion", ""),
            "video_provider": {
                "provider": "local_motion",
                "model": "ken-burns",
                "motion_strength": "standard",
                "clip_seconds": 4,
            },
        },
    )
    assert_condition(video_probe.get("video_url", "").startswith("local-motion://"), "本地动态视频占位返回异常")

    return {
        "valid_lyrics": len(valid_lyrics),
        "skipped_lyrics": len(skipped_ids),
        "scenes": len(scenes),
        "short_ids": sorted(short_ids),
        "analysis_summary": analysis.get("summary", ""),
        "first_scene": {
            "title": scenes[0].get("title"),
            "lyric_ids": scenes[0].get("lyric_ids"),
            "description": scenes[0].get("description"),
            "image_url": scenes[0].get("image_url"),
        },
    }


def run_smoke() -> dict:
    sample_summary = run_storyboard_probe(
        SAMPLE_LYRICS,
        song_name="琵琶行",
        duration=82,
        expected_skipped_ids=EXPECTED_SKIPPED_IDS,
        expected_short_ids=SHORT_IDS,
        min_valid_lyrics=15,
    )

    lrc_files = sorted(ROOT_DIR.glob("*.lrc"))
    real_lrc_summary = None
    if lrc_files:
        real_lrc_path = lrc_files[0]
        real_lyrics = parse_lrc_file(real_lrc_path)
        assert_condition(real_lyrics, f"真实 LRC 未解析出歌词：{real_lrc_path.name}")
        real_lrc_summary = {
            "file": real_lrc_path.name,
            **run_storyboard_probe(
                real_lyrics,
                song_name=real_lrc_path.stem,
                duration=max(line["time"] for line in real_lyrics) + 8,
                min_valid_lyrics=20,
            ),
        }

    return {
        "sample": sample_summary,
        "real_lrc": real_lrc_summary,
    }


def main() -> int:
    process = None
    try:
        process = start_backend_if_needed()
        summary = run_smoke()
        print(json.dumps({"ok": True, **summary}, ensure_ascii=False, indent=2))
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
