from __future__ import annotations

import json
from typing import Any

import httpx


DIRECTOR_SYSTEM_PROMPT = """你是中文音乐视频的视觉导演。你必须基于整首歌词建立连贯叙事、固定角色设定和统一色彩。
只返回 JSON object，不要 Markdown。不得改变分镜数量或 group_index。
""".strip()


def build_director_payload(
    lyrics: list[dict[str, Any]],
    groups: list[list[dict[str, Any]]],
    style: str,
    song_name: str,
    visual_lock: dict[str, Any] | None,
) -> str:
    group_payload = [
        {
            "group_index": index,
            "start_time": group[0]["time"],
            "lyric_ids": [item["id"] for item in group],
            "lyrics": [item["text"] for item in group],
        }
        for index, group in enumerate(groups)
    ]
    return json.dumps(
        {
            "task": "为已分好的歌词段落制作连贯 MV 分镜",
            "song_name": song_name,
            "style": style,
            "visual_lock": visual_lock or {},
            "full_lyrics": lyrics,
            "groups": group_payload,
            "output_schema": {
                "summary": "整曲叙事概要",
                "palette": ["主色"],
                "negative_prompt": "全局负面提示词",
                "characters": {
                    "角色ID": {
                        "name": "角色名",
                        "description": "性别年龄体型与气质",
                        "wardrobe": "固定服饰发型与配饰",
                        "anchor_prompt": "半身中景定妆照提示词",
                    }
                },
                "scenes": [
                    {
                        "group_index": 0,
                        "summary": "一句话画面概述",
                        "mood": "情绪",
                        "imagery": ["具体意象"],
                        "character_id": "角色ID或空字符串",
                        "image_prompt": "直接用于文生图的中文提示词，无文字无水印",
                        "video_prompt": "轻微运镜与环境动作",
                        "camera_motion": "slow dolly in/slow pull back/gentle lateral tracking 之一",
                        "transition": "soft dissolve/match cut/fade 之一",
                        "reuse_from": None,
                    }
                ],
            },
        },
        ensure_ascii=False,
    )


async def analyze_with_deepseek(
    *,
    lyrics: list[dict[str, Any]],
    groups: list[list[dict[str, Any]]],
    style: str,
    song_name: str,
    visual_lock: dict[str, Any] | None,
    api_key: str,
    base_url: str = "https://api.deepseek.com/v1",
    model: str = "deepseek-chat",
) -> dict[str, Any]:
    if not api_key.strip():
        raise ValueError("DeepSeek API Key 未配置")
    payload = {
        "model": model or "deepseek-chat",
        "messages": [
            {"role": "system", "content": DIRECTOR_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": build_director_payload(lyrics, groups, style, song_name, visual_lock),
            },
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.55,
    }
    async with httpx.AsyncClient(timeout=180, follow_redirects=True) as client:
        response = await client.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise RuntimeError("DeepSeek 未返回导演分析")
    result = json.loads(content)
    scenes = result.get("scenes")
    if not isinstance(scenes, list) or len(scenes) != len(groups):
        raise RuntimeError("DeepSeek 返回的分镜数量与歌词分组不一致")
    by_index = {int(item.get("group_index", -1)): item for item in scenes if isinstance(item, dict)}
    if set(by_index) != set(range(len(groups))):
        raise RuntimeError("DeepSeek 返回的 group_index 不完整")
    result["scenes"] = [by_index[index] for index in range(len(groups))]
    if not isinstance(result.get("characters"), dict):
        result["characters"] = {}
    return result

