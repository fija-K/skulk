import os
import shutil

artifacts_dir = r"C:\Users\fija\.gemini\antigravity\brain\a4b32f7d-423f-4e9b-ab63-070ea9647358"
target_dir = r"C:\Users\fija\.gemini\antigravity\scratch\skulk\public\themes"

# Ensure target directory exists
os.makedirs(target_dir, exist_ok=True)

mapping = {
    "media__1784373326970.jpg": "gotham_3d.jpg",
    "media__1784373326979.jpg": "gotham_comic.jpg",
    "media__1784373327097.jpg": "matrix_green.jpg",
    "media__1784373374068.jpg": "matrix_pink.jpg",
    "media__1784373326985.jpg": "tech_workbench.jpg",
    "media__1784373374139.jpg": "steampunk_mary.jpg",
    "media__1784373417058.jpg": "babushka_animals.jpg",
    "media__1784373417066.jpg": "oriental_collage.jpg",
    "media__1784373417083.jpg": "pop_art.jpg"
}

print("Starting theme copy process...")
copied_count = 0
for src_name, dest_name in mapping.items():
    src_path = os.path.join(artifacts_dir, src_name)
    dest_path = os.path.join(target_dir, dest_name)
    if os.path.exists(src_path):
        shutil.copy2(src_path, dest_path)
        print(f"Copied: {src_name} -> {dest_name}")
        copied_count += 1
    else:
        print(f"ERROR: Source file not found: {src_path}")

print(f"Finished. Successfully copied {copied_count} of {len(mapping)} files.")
