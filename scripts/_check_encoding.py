# -*- coding: utf-8 -*-
from pathlib import Path
import re

paths = [
    Path(r"C:/Users/Chenmo/AppData/Roaming/Cursor/User/cursor-chat-keepalive.js"),
    Path(r"d:/000MY/jhy/cursor-chat-keepalive/inject-keepalive.js"),
]
for p in paths:
    b = p.read_bytes()
    raw = p.read_text(encoding="utf-8")
    m = re.search(r"continueText:\s*'([^']*)'", raw)
    print("FILE", p)
    print("  bom", b[:3].hex(), "size", len(b))
    print("  continueText", repr(m.group(1) if m else None))
    print("  has 继续", "继续" in raw)
    print("  has 发送", "发送" in raw)
