import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NotesList } from "./NotesList";
import type { Note } from "../types";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "test-1",
    title: "Test Note",
    body: "Some content here",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    encrypted: false,
    codex: null,
    ...overrides,
  };
}

describe("NotesList", () => {
  it("renders empty state when no notes", () => {
    render(
      <NotesList notes={[]} selectedId={null} onSelect={() => {}} onDelete={() => {}} />
    );
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
  });

  it("renders note titles", () => {
    const notes = [
      makeNote({ id: "1", title: "First" }),
      makeNote({ id: "2", title: "Second" }),
    ];
    render(
      <NotesList notes={notes} selectedId={null} onSelect={() => {}} onDelete={() => {}} />
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("marks selected note", () => {
    const notes = [makeNote({ id: "1", title: "Selected" })];
    const { container } = render(
      <NotesList notes={notes} selectedId="1" onSelect={() => {}} onDelete={() => {}} />
    );
    expect(container.querySelector(".note-item.selected")).toBeInTheDocument();
  });

  it("calls onSelect when clicking a note", () => {
    const onSelect = vi.fn();
    const notes = [makeNote({ id: "abc", title: "Click me" })];
    render(
      <NotesList notes={notes} selectedId={null} onSelect={onSelect} onDelete={() => {}} />
    );
    fireEvent.click(screen.getByText("Click me"));
    expect(onSelect).toHaveBeenCalledWith("abc");
  });

  it("shows preview of note body", () => {
    const notes = [makeNote({ id: "1", title: "Title", body: "Preview line\nSecond line" })];
    render(
      <NotesList notes={notes} selectedId={null} onSelect={() => {}} onDelete={() => {}} />
    );
    expect(screen.getByText("Preview line")).toBeInTheDocument();
  });

  it("shows encrypted badge for encrypted notes", () => {
    const notes = [makeNote({ id: "1", title: "Secret", encrypted: true })];
    const { container } = render(
      <NotesList notes={notes} selectedId={null} onSelect={() => {}} onDelete={() => {}} />
    );
    expect(container.querySelector(".encrypted-badge")).toBeInTheDocument();
  });

  it("highlights search matches in title", () => {
    const notes = [makeNote({ id: "1", title: "Meeting notes" })];
    const { container } = render(
      <NotesList notes={notes} selectedId={null} onSelect={() => {}} onDelete={() => {}} searchQuery="meeting" />
    );
    const mark = container.querySelector("mark.search-highlight");
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toBe("Meeting");
  });
});
