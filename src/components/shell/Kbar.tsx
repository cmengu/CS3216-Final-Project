const KEYS = {
  list: [
    ["↵", "Open order"],
    ["⌘I", "Ask"],
    ["X", "Select"],
    ["↑↓", "Navigate"],
    ["⌘K", "Search"],
  ],
  page: [
    ["⌘K", "Search"],
    ["⌘I", "Ask"],
    ["Esc", "Back"],
  ],
} as const;

/** The keyboard hint bar along the bottom of every page. */
export function Kbar({ kind }: { kind: keyof typeof KEYS }) {
  return (
    <div className="kbar" aria-hidden="true">
      {KEYS[kind].map(([a, b]) => (
        <span key={a}>
          <kbd>{a}</kbd>
          {b}
        </span>
      ))}
    </div>
  );
}
