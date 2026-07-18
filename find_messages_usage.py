import os

app_tsx_path = r"C:\Users\fija\.gemini\antigravity\scratch\skulk\src\App.tsx"

with open(app_tsx_path, "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if "messages" in line.lower() or "chat" in line.lower():
            if "collection" in line or "addDoc" in line or "onSnapshot" in line or "delete" in line:
                print(f"Line {i+1}: {line.strip()}")
