with open(r"C:\Users\fija\.gemini\antigravity\scratch\skulk\src\App.tsx", "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if "maxParticipants" in line or "max-participants" in line.lower():
            print(f"Line {i+1}: {line.strip()}")
