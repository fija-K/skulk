with open(r"C:\Users\fija\.gemini\antigravity\scratch\skulk\src\App.tsx", "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if "handleSelectRoomMode" in line:
            print(f"Line {i+1}: {line.strip()}")
