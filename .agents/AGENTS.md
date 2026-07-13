# Workspace Rules - Skulk Project

## Modularity & File Size Constraints
- **Do not add new feature code to existing files directly** if it can be modularized. Always create a new file (e.g., in `src/components/`, `src/hooks/`, or `src/utils/`) for new features or substantial logic blocks.
- **Keep files organized and clean.** Once any component or helper module starts growing large (exceeding a reasonable size or scope), proactively extract it into a separate, reusable component, utility, or hook.
