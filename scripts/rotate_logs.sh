#!/bin/sh
# Rotate QuakeLens launchd logs using copytruncate (> 10 MiB, keep 3 gzipped archives).
set -eu

LOG_DIR="${HOME}/Library/Logs/quakelens"
MAX_BYTES=10485760

for f in "${LOG_DIR}"/*.log; do
  [ -f "$f" ] || continue
  size=$(/usr/bin/stat -f%z "$f" 2>/dev/null || echo 0)
  if [ "$size" -gt "$MAX_BYTES" ]; then
    [ -f "$f.3.gz" ] && /bin/rm -f "$f.3.gz"
    [ -f "$f.2.gz" ] && /bin/mv -f "$f.2.gz" "$f.3.gz"
    [ -f "$f.1.gz" ] && /bin/mv -f "$f.1.gz" "$f.2.gz"
    /usr/bin/gzip -c "$f" > "$f.1.gz"
    : > "$f"
  fi
done
