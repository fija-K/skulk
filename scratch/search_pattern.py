with open('C:/Users/fija/.gemini/antigravity/scratch/skulk/src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

import re
matches = re.finditer(r'setItem\(\s*[\'"]skulk_guest_id[\'"]', content)
for m in matches:
    print(f"Match: {m.group(0)} at position {m.start()}")
