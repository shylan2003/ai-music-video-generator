from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services.lyrics_parser import parse_lyrics  # noqa: E402


class LyricsParserTests(unittest.TestCase):
    def test_lrc_multiple_timestamps(self):
        result = parse_lyrics("[00:01.00][00:02.50]同一句\n[00:04.00]下一句", "lrc")
        self.assertEqual([item.time for item in result], [1.0, 2.5, 4.0])
        self.assertEqual(result[0].text, "同一句")

    def test_srt_uses_real_timestamps_and_ignores_indexes(self):
        content = """1
00:00:01,250 --> 00:00:03,000
第一句

2
00:00:04.500 --> 00:00:07.000
<i>第二句</i>
"""
        result = parse_lyrics(content, "srt")
        self.assertEqual([item.time for item in result], [1.25, 4.5])
        self.assertEqual([item.text for item in result], ["第一句", "第二句"])

    def test_txt_requires_duration(self):
        with self.assertRaisesRegex(ValueError, "TXT"):
            parse_lyrics("第一句\n第二句", "txt")

    def test_txt_alignment_uses_song_duration(self):
        result = parse_lyrics("第一句\n第二句\n第三句", "txt", duration=90)
        self.assertEqual([item.time for item in result], [0, 30, 60])


if __name__ == "__main__":
    unittest.main()

