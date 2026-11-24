"""Fetch and persist Kyoto JMA/Yahoo earthquake archive (2025-2026 + older) and Kyoto City Bousai updates."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.disaster_updates import ARCHIVE_PATH, updates_store  # noqa: E402


async def main() -> None:
    res = await updates_store.refresh_live(persist=True)
    counts = res["counts"]
    print(
        f"Saved Kyoto disaster archive to {ARCHIVE_PATH}: "
        f"earthquakes={counts['total_earthquakes']} "
        f"(2025-2026={counts['recent_2y_earthquakes']}, older={counts['archive_earthquakes']}), "
        f"municipality_updates={counts['total_municipality_updates']} "
        f"(2025-2026={counts['recent_2y_municipality_updates']}, older={counts['archive_municipality_updates']})"
    )


if __name__ == "__main__":
    asyncio.run(main())
