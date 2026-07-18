with open(r"C:\Users\fija\.gemini\antigravity\scratch\skulk\src\components\call\ParticipantTile.tsx", "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if "badge" in line or "icon" in line or "mute" in line or "mic" in line or "cam" in line:
            if "div" in line or "svg" in line or "span" in line:
                print(f"Line {i+1}: {line.strip()}")
