from __future__ import annotations

import json
from typing import Any

import httpx


DIRECTOR_SYSTEM_PROMPT = """
你是通用中文音乐视频的视觉导演。必须从整首歌词和时间窗口理解歌曲，而不是逐句直译。
你需要识别歌曲类型、段落结构、情绪曲线、人物关系、人生阶段、地点、关键道具、时间跳转和反复意象。
手动风格是最高优先级；style=auto 时才可以选择最合适的风格。
默认使用诗意隐喻表达敏感意象，禁止血腥、猎奇、文字、水印、畸形肢体和无意义的重复人物。
主要角色要拆分“身份不变量”和“人生阶段变量”。同一角色的年龄、发式和服装可以随阶段变化，骨相和辨识特征必须一致。
所有镜头最终都会由同一个云端图生视频模型生成，因此动作应明确、克制、可执行，避免大幅变形和复杂群体动作。
只返回 JSON object，不要 Markdown，不得改变窗口数量或 group_index。
""".strip()


def build_director_payload(
    lyrics: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    style: str,
    song_name: str,
    visual_lock: dict[str, Any] | None,
) -> str:
    style_mode = "auto" if style == "auto" else "manual"
    return json.dumps(
        {
            "task": "为时间已固定的窗口制作连贯、可执行的全云端动画 MV 分镜",
            "song_name": song_name,
            "style_mode": style_mode,
            "requested_style": style,
            "visual_lock": visual_lock or {},
            "full_lyrics": lyrics,
            "groups": groups,
            "requirements": {
                "song_types": ["narrative", "lyrical", "imagery", "performance", "duet", "hybrid"],
                "character_stages": "每个主要角色识别 1-5 个人生阶段，阶段可非线性出现",
                "safe_metaphor": "啼血、死亡、伤痛等默认用花瓣、墨色、落日等诗意意象表现",
                "cloud_motion": "动作幅度克制，人物、服装、道具和画风不得在镜头内突变",
                "continuity": "同一视觉圣经、同一角色阶段、同一地点和关键道具保持一致",
            },
            "output_schema": {
                "summary": "整曲导演叙事概要",
                "song_type": "六种歌曲类型之一",
                "selected_style": "自动选择或原样返回手动风格 ID",
                "sections": [
                    {"name": "段落名", "start_time": 0, "end_time": 10, "mood": "情绪"}
                ],
                "emotion_curve": [{"time": 0, "value": 0.5, "label": "情绪"}],
                "visual_bible": {
                    "media": "绘画媒介",
                    "linework": "线条规则",
                    "character_rendering": "人物画法与比例",
                    "palette": ["主色"],
                    "lighting": "光照规则",
                    "era": "时代与世界观",
                    "texture": "材质纹理",
                    "negative_prompt": "全局负面提示词",
                },
                "characters": {
                    "角色ID": {
                        "name": "角色名",
                        "description": "身份、体型与气质",
                        "immutable_traits": ["骨相与辨识特征"],
                        "identity_prompt": "无剧情背景的身份母版提示词",
                        "stages": {
                            "阶段ID": {
                                "name": "阶段名",
                                "age_range": "年龄范围",
                                "appearance": "年龄和生活状态变化",
                                "hairstyle": "发式",
                                "wardrobe": "服装",
                                "temperament": "气质",
                                "anchor_prompt": "从身份母版派生阶段定妆的提示词",
                            }
                        },
                    }
                },
                "locations": {"地点ID": {"name": "名称", "description": "固定结构与环境特征"}},
                "hero_props": {"道具ID": {"name": "名称", "description": "固定结构与允许变化"}},
                "scenes": [
                    {
                        "group_index": 0,
                        "summary": "一句话画面概述",
                        "mood": "情绪",
                        "imagery": ["具体意象"],
                        "character_id": "角色ID或空字符串",
                        "character_stage_id": "阶段ID或空字符串",
                        "location_id": "地点ID或空字符串",
                        "hero_prop_ids": ["道具ID"],
                        "shot_type": "establishing/wide/medium/close_up/detail/insert",
                        "image_prompt": "可直接生成首帧的完整中文提示词",
                        "video_prompt": "克制、连续、避免变形的二维动画动作提示词",
                        "camera_motion": "static/slow dolly in/slow pull back/gentle lateral tracking",
                        "transition": "cut/soft dissolve/match cut",
                        "reuse_from": None,
                    }
                ],
            },
        },
        ensure_ascii=False,
    )


def normalize_director_result(result: dict[str, Any], groups: list[dict[str, Any]], style: str) -> dict[str, Any]:
    scenes = result.get("scenes")
    if not isinstance(scenes, list) or len(scenes) != len(groups):
        raise RuntimeError("DeepSeek 返回的分镜数量与时间窗口不一致")
    by_index = {int(item.get("group_index", -1)): item for item in scenes if isinstance(item, dict)}
    if set(by_index) != set(range(len(groups))):
        raise RuntimeError("DeepSeek 返回的 group_index 不完整")
    result["scenes"] = [by_index[index] for index in range(len(groups))]

    selected_style = str(result.get("selected_style") or ("cinematic" if style == "auto" else style))
    if style != "auto":
        selected_style = style
    result["selected_style"] = selected_style
    result["song_type"] = str(result.get("song_type") or "hybrid")
    if result["song_type"] not in {"narrative", "lyrical", "imagery", "performance", "duet", "hybrid"}:
        result["song_type"] = "hybrid"

    visual_bible = result.get("visual_bible")
    if not isinstance(visual_bible, dict):
        visual_bible = {}
    visual_bible.setdefault("palette", result.get("palette") if isinstance(result.get("palette"), list) else [])
    visual_bible.setdefault("negative_prompt", str(result.get("negative_prompt") or ""))
    result["visual_bible"] = visual_bible

    characters = result.get("characters")
    if not isinstance(characters, dict):
        characters = {}
    for character_id, character in list(characters.items()):
        if not isinstance(character, dict):
            characters.pop(character_id, None)
            continue
        character.setdefault("identity_prompt", character.get("anchor_prompt") or character.get("description") or "")
        character.setdefault("immutable_traits", [])
        stages = character.get("stages")
        if not isinstance(stages, dict) or not stages:
            stages = {
                "default": {
                    "id": "default",
                    "name": "默认阶段",
                    "age_range": "",
                    "appearance": character.get("description") or "",
                    "hairstyle": "",
                    "wardrobe": character.get("wardrobe") or "",
                    "temperament": "",
                    "anchor_prompt": character.get("anchor_prompt") or character.get("identity_prompt") or "",
                }
            }
        normalized_stages: dict[str, Any] = {}
        for stage_id, stage in list(stages.items())[:5]:
            if not isinstance(stage, dict):
                continue
            normalized_stage_id = str(stage_id)
            normalized_stages[normalized_stage_id] = {
                **stage,
                "id": normalized_stage_id,
                "name": str(stage.get("name") or normalized_stage_id),
                "anchor_prompt": str(stage.get("anchor_prompt") or character.get("identity_prompt") or ""),
                "version": 1,
            }
        character["stages"] = normalized_stages or stages
    result["characters"] = characters
    result.setdefault("locations", {})
    result.setdefault("hero_props", {})
    result.setdefault("sections", [])
    result.setdefault("emotion_curve", [])
    return result


async def analyze_with_deepseek(
    *,
    lyrics: list[dict[str, Any]],
    groups: list[dict[str, Any]],
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
        "temperature": 0.35,
    }
    async with httpx.AsyncClient(timeout=240, follow_redirects=True) as client:
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
    return normalize_director_result(json.loads(content), groups, style)
