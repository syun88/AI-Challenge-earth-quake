"""Fetch and parse Kyoto City's R8_list.pdf into kyoto_r8_seismic_list.json."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.r8_seismic import R8_DATA_PATH, fetch_and_build_r8_json, r8_seismic_store  # noqa: E402


async def main() -> None:
    payload = await fetch_and_build_r8_json()
    r8_seismic_store._loaded = False
    summary = r8_seismic_store.get_summary_and_list(limit=5)
    print(
        f"Saved {payload['count']} entries to {R8_DATA_PATH}. "
        f"Grades: {summary['grade_counts']}"
    )


if __name__ == "__main__":
    asyncio.run(main())
