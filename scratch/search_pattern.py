import re

with open('C:/Users/fija/.gemini/antigravity/scratch/skulk/src/App.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

patterns = ['sharingYoutubeId', 'sharing', 'viewingShare', 'updateMySharing']
for i, line in enumerate(lines):
    for pattern in patterns:
        if pattern in line:
            if 'console' in line or 'import' in line:
                continue
            print(f"{i+1}: {line.strip()}")
            break
