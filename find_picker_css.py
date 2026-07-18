with open(r"C:\Users\fija\.gemini\antigravity\scratch\skulk\src\index.css", "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if "theme-picker-dropdown" in line:
            print(f"Line {i+1}: {line.strip()}")
