import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotesList } from "./NotesList";
import type { Note } from "../types";

// Mock IntersectionObserver and ResizeObserver for virtualizer
beforeEach(() => {
  (globalThis as any).IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  (globalThis as any).ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "test-1",
    title: "Test Note",
    body: "Some content here",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    encrypted: false,
    codex: null,
    archived: false,
    ...overrides,
  };
}

const defaultProps = {
  onSelect: () => {},
  onDelete: () => {},
  onTogglePin: () => {},
  onToggleSensitive: () => {},
  pinnedIds: [] as string[],
  sensitiveIds: [] as string[],
};

describe("NotesList", () => {
  it("renders empty state when no notes", () => {
    render(
      <NotesList notes={[]} selectedId={null} {...defaultProps} />
    );
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
  });

  it("renders note titles", () => {
    const notes = [
      makeNote({ id: "1", title: "First" }),
      makeNote({ id: "2", title: "Second" }),
    ];
    render(
      <NotesList notes={notes} selectedId={null} {...defaultProps} />
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("marks selected note", () => {
    const notes = [makeNote({ id: "1", title: "Selected" })];
    const { container } = render(
      <NotesList notes={notes} selectedId="1" {...defaultProps} />
    );
    expect(container.querySelector(".note-item.selected")).toBeInTheDocument();
  });

  it("calls onSelect when clicking a note", () => {
    const onSelect = vi.fn();
    const notes = [makeNote({ id: "abc", title: "Click me" })];
    render(
      <NotesList notes={notes} selectedId={null} {...defaultProps} onSelect={onSelect} />
    );
    fireEvent.click(screen.getByText("Click me"));
    expect(onSelect).toHaveBeenCalledWith("abc");
  });

  it("shows preview of note body", () => {
    const notes = [makeNote({ id: "1", title: "Title", body: "Preview line\nSecond line" })];
    render(
      <NotesList notes={notes} selectedId={null} {...defaultProps} />
    );
    expect(screen.getByText("Preview line")).toBeInTheDocument();
  });

  it("pins notes to top of list", () => {
    const notes = [
      makeNote({ id: "1", title: "Unpinned" }),
      makeNote({ id: "2", title: "Pinned" }),
    ];
    const { container } = render(
      <NotesList notes={notes} selectedId={null} {...defaultProps} pinnedIds={["2"]} />
    );
    const items = container.querySelectorAll(".note-item-title");
    expect(items[0].textContent).toContain("Pinned");
    expect(items[1].textContent).toContain("Unpinned");
  });

  it("highlights search matches in title", () => {
    const notes = [makeNote({ id: "1", title: "Meeting notes" })];
    const { container } = render(
      <NotesList notes={notes} selectedId={null} {...defaultProps} searchQuery="meeting" />
    );
    const mark = container.querySelector("mark.search-highlight");
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toBe("Meeting");
  });
});
