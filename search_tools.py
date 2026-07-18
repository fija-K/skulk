with open(r"C:\Users\fija\.gemini\antigravity\scratch\skulk\src\App.tsx", "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if "loose" in line.lower() or "timer" in line.lower() or "tools" in line.lower():
            if "state" in line.lower() or "div" in line or "button" in line or "const" in line or "function" in line:
                # print first 150 matching line numbers to keep output tidy
                print(f"Line {i+1}: {line.strip()}")
