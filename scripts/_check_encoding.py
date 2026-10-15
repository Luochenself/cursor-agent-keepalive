# -*- coding: utf-8 -*-
"""Sanity-check inject script encoding / continueText (local only)."""
from pathlib import Path
import os
import re

root = Path(__file__).resolve().parents[1]
appdata = os.environ.get("APPDATA") or ""
paths = [
    root / "inject-keepalive.js",
]
if appdata:
    paths.append(Path(appdata) / "Cursor" / "User" / "cursor-chat-keepalive.js")

for p in paths:
    if not p.exists():
        print("SKIP missing", p)
        continue
    b = p.read_bytes()
    raw = p.read_text(encoding="utf-8")
    m = re.search(r"continueText:\s*'([^']*)'", raw)
    print("FILE", p.name)
    print("  bom", b[:3].hex(), "size", len(b))
    print("  continueText", repr(m.group(1) if m else None))
    print("  has 继续", "继续" in raw)
    print("  has 发送", "发送" in raw)
