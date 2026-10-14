const KEYS = {
  list: [
    ["↵", "Open order"],
    ["⌘I", "Ask"],
    ["X", "Select"],
    ["↑↓", "Navigate"],
    ["⌘K", "Search"],
  ],
  /* Only keys that work on these pages. */
  invoices: [
    ["⌘K", "Search"],
    ["⌘I", "Ask"],
  ],
  invoice: [
    ["Esc", "Back to invoices"],
    ["⌘K", "Search"],
    ["⌘I", "Ask"],
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
