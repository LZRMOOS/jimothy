import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Mock the Tauri APIs the hook touches.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { useNotes } from "./useNotes";

describe("useNotes save flushing", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      id: "n1",
      title: "T",
      body: "B",
      updated_at: "2026-07-24T00:00:00Z",
    });
  });

  it("debouncedSave does not write immediately", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.debouncedSave("n1", "T", "B", null);
    });
    expect(invokeMock).not.toHaveBeenCalledWith("save_note", expect.anything());
    vi.useRealTimers();
  });

  it("flushSave commits a pending save right away", async () => {
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.debouncedSave("n1", "Title", "Body", null);
    });
    await act(async () => {
      await result.current.flushSave();
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "save_note",
      expect.objectContaining({ id: "n1", title: "Title", body: "Body" })
    );
  });

  it("flushSave(onlyId) ignores a pending save for a different note", async () => {
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.debouncedSave("n1", "T", "B", null);
    });
    await act(async () => {
      await result.current.flushSave("other-id");
    });
    expect(invokeMock).not.toHaveBeenCalledWith("save_note", expect.anything());
  });

  it("flushSave is a no-op when nothing is pending", async () => {
    const { result } = renderHook(() => useNotes());
    await act(async () => {
      await result.current.flushSave();
    });
    expect(invokeMock).not.toHaveBeenCalledWith("save_note", expect.anything());
  });

  it("sends the base version and only flushes once", async () => {
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.recordBaseVersion("n1", "2026-01-01T00:00:00Z");
    });
    act(() => {
      result.current.debouncedSave("n1", "T", "B", null);
    });
    await act(async () => {
      await result.current.flushSave();
      // A second flush should find nothing pending.
      await result.current.flushSave();
    });
    const saveCalls = invokeMock.mock.calls.filter((c) => c[0] === "save_note");
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0][1]).toMatchObject({
      id: "n1",
      baseUpdatedAt: "2026-01-01T00:00:00Z",
    });
  });
});
