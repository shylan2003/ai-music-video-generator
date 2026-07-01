from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from main import LyricLine, detect_song_type  # noqa: E402
from services.director import normalize_director_result  # noqa: E402


def lines(*texts: str) -> list[LyricLine]:
    return [LyricLine(id=str(index), text=text, time=float(index * 4)) for index, text in enumerate(texts)]


class DirectorSongTypeTests(unittest.TestCase):
    def test_rule_fallback_recognizes_five_general_song_families(self):
        fixtures = {
            "narrative": lines("那年我从小城出发", "后来与你相逢", "最后告别回到故乡"),
            "lyrical": lines("想念落在心里", "温柔拥抱我的孤独", "爱与遗憾化作眼泪"),
            "imagery": lines("月照山海", "风吹花与云", "星落雾中的梦"),
            "performance": lines("舞台灯光亮起", "观众掌声穿过幕布", "乐队与演唱继续"),
            "duet": lines("男：你问远方在哪里", "女：我答就在心里", "合：我们一起歌唱"),
        }
        for expected, lyrics in fixtures.items():
            with self.subTest(expected=expected):
                self.assertEqual(detect_song_type(lyrics), expected)

    def test_manual_style_is_never_overridden_and_stages_are_capped(self):
        groups = [{"group_index": 0, "start_time": 0, "end_time": 8, "lyric_ids": ["1"]}]
        stages = {
            f"stage-{index}": {"name": f"阶段 {index}", "anchor_prompt": "same identity"}
            for index in range(7)
        }
        result = normalize_director_result(
            {
                "selected_style": "wrong-style",
                "song_type": "narrative",
                "characters": {
                    "lead": {
                        "description": "same protagonist",
                        "identity_prompt": "identity master",
                        "stages": stages,
                    }
                },
                "scenes": [{"group_index": 0}],
            },
            groups,
            "inkwash",
        )
        self.assertEqual(result["selected_style"], "inkwash")
        self.assertEqual(len(result["characters"]["lead"]["stages"]), 5)


if __name__ == "__main__":
    unittest.main()
