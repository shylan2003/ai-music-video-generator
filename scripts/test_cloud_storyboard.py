from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from main import LyricLine, MusicEnergyPoint, build_smart_scene_groups  # noqa: E402


class CloudStoryboardWindowTests(unittest.TestCase):
    def test_five_minute_song_uses_30_to_50_contiguous_cloud_windows(self):
        duration = 323.6
        lyrics = [
            LyricLine(id=f"line-{index}", text=f"第 {index + 1} 句", time=index * 3.05)
            for index in range(106)
        ]

        groups = build_smart_scene_groups(lyrics, duration=duration, target_seconds=8)

        self.assertGreaterEqual(len(groups), 30)
        self.assertLessEqual(len(groups), 50)
        self.assertEqual(groups[0]["start_time"], 0)
        self.assertAlmostEqual(groups[-1]["end_time"], duration, places=3)
        for previous, current in zip(groups, groups[1:]):
            self.assertEqual(previous["end_time"], current["start_time"])
        for group in groups:
            shot_duration = group["end_time"] - group["start_time"]
            self.assertGreaterEqual(shot_duration, 6)
            self.assertLessEqual(shot_duration, 10)

        covered_ids = [lyric_id for group in groups for lyric_id in group["lyric_ids"]]
        self.assertCountEqual(covered_ids, [lyric.id for lyric in lyrics])
        self.assertEqual(len(covered_ids), len(set(covered_ids)))

    def test_short_song_still_respects_provider_duration_limits(self):
        duration = 67.0
        lyrics = [
            LyricLine(id=f"short-{index}", text=f"短歌 {index + 1}", time=index * 4.0)
            for index in range(17)
        ]

        groups = build_smart_scene_groups(lyrics, duration=duration, target_seconds=8)

        self.assertTrue(groups)
        self.assertTrue(all(6 <= group["end_time"] - group["start_time"] <= 10 for group in groups))
        self.assertEqual(
            [lyric_id for group in groups for lyric_id in group["lyric_ids"]],
            [lyric.id for lyric in lyrics],
        )

    def test_boundaries_can_snap_to_local_music_energy_peaks(self):
        lyrics = [
            LyricLine(id=f"energy-{index}", text=f"能量歌词 {index}", time=float(index * 4))
            for index in range(8)
        ]
        energy = [
            MusicEnergyPoint(time=8.3, value=0.4),
            MusicEnergyPoint(time=8.8, value=0.92),
            MusicEnergyPoint(time=9.3, value=0.35),
        ]

        groups = build_smart_scene_groups(lyrics, duration=32, target_seconds=8, music_energy=energy)

        self.assertEqual(groups[0]["end_time"], 8.8)
        self.assertTrue(all(6 <= group["end_time"] - group["start_time"] <= 10 for group in groups))


if __name__ == "__main__":
    unittest.main()
