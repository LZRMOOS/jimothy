// The Feature Tour note: a single Markdown document that renders through the
// real editor to show off what the app can do. Because it's just a note body,
// it stays portable plain Markdown and can never drift from how notes actually
// render. Features that resolve against user data (note links, mentions, custom
// emoji, images) are documented as syntax rather than seeded, so the tour works
// standalone in any vault.

export const FEATURE_TOUR_TITLE = "✨ Feature Tour";

// Steps for the guided coachmark tour. Each targets a real UI element by its
// `data-tour` attribute; the overlay spotlights that element and shows the
// copy beside it. `target: null` means a centered, element-less step (intro /
// outro). Keeping the selectors here (not scattered in the overlay) makes it
// obvious what the tour depends on if the layout ever changes.
export type TourStep = {
  target: string | null; // value of the data-tour attribute, or null for centered
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    target: null,
    title: "Welcome 👋",
    body: "Take a 30-second spin through the app. Use Next and Back, or hit Esc to bail out any time.",
  },
  {
    target: "search",
    title: "Search or create",
    body: "Start typing to fuzzy-search every note. Press Enter to open a match, or Cmd+Enter to create a new note with what you typed as the title. Filter by #tag or @mention right from here.",
  },
  {
    target: "command-palette",
    title: "Command palette",
    body: "Cmd+K opens the palette to run any action or jump to a note. It's the fastest way to get anywhere.",
  },
  {
    target: "sidebar",
    title: "Codexes",
    body: "Group notes into collections. Each codex gets its own icon and color, and Cmd+1-9 switches between them instantly.",
  },
  {
    target: "notes-list",
    title: "Your notes",
    body: "Every note in the current view. Pin favorites to the top, and expand a note to see what links back to it.",
  },
  {
    target: "editor",
    title: "The editor",
    body: "A WYSIWYG Markdown editor with tables, task lists, code blocks, tags, macros, and more. Everything saves as portable plain Markdown.",
  },
  {
    target: "settings",
    title: "Make it yours",
    body: "Themes, custom macros, a personal dictionary, custom emoji, encryption, and sync live in Settings.",
  },
  {
    target: null,
    title: "That's the tour!",
    body: "We'll drop you into a sample note that shows the formatting features up close. Open the reference panel with Cmd+. any time for the full cheat sheet.",
  },
];

export const FEATURE_TOUR_BODY = `Welcome to your notes app! This note renders through the same editor as everything else, so what you see here is exactly what you get. Feel free to edit, break, or delete it.

## Formatting

You can write **bold**, *italic*, ~~strikethrough~~, and \`inline code\`. Text flows as plain Markdown under the hood.

## Blocks

> Blockquotes pull a thought aside.

Fenced code blocks are syntax-highlighted:

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

A horizontal rule separates sections:

---

Tables are portable GFM pipe tables. Click inside one for a toolbar to add or remove rows and columns.

| Feature | Shortcut | Notes |
| --- | --- | --- |
| New note | Cmd+N | Start writing instantly |
| Command palette | Cmd+K | Run any action |
| Daily note | Cmd+J | Today's note |

## Lists

- Bullet lists
- keep things
- tidy

1. Numbered lists
2. do the same
3. in order

## Tasks

Task items are checkboxes with optional priority and due-date pills:

- [ ] A plain task
- [x] A finished task
- [ ] High priority task !high
- [ ] Medium priority task !med
- [ ] Low priority task !low
- [ ] Task with a due date !2026-08-01

## Tags

Drop a #tag anywhere and it becomes searchable and color-coded. Try #demo and #welcome.

## Macros

Type these triggers followed by Space or Enter and they expand as you go:

- \`/date\` inserts today's date
- \`/time\` inserts the current time
- \`/table\` inserts a fresh 2x2 table

You can define your own macros in Settings.

## Things that use your own data

A few features resolve against content you add, so they're shown here as syntax:

- **Note links** — type \`[[\` to link to another note; the link survives renames.
- **Mentions** — type \`@\` to insert an entry from your dictionary (Settings > Dictionary).
- **Custom emoji** — type \`:name:\` to insert your own images (Settings > Emoji), reusable as codex icons.
- **Images** — paste or drop an image straight into a note; it's stored as a portable relative path.

## Handy shortcuts

- **Cmd+K** — command palette (search actions and notes)
- **Cmd+F / Cmd+H** — find / find & replace in the note
- **Cmd+T** — table of contents
- **Cmd+\\\\** — split view (two notes side by side)
- **Cmd+.** — reference panel with the full Markdown and controls cheat sheet

Open the reference panel any time with Cmd+. for the complete list. Happy note-taking!
`;
