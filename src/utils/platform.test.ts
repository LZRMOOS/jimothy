import { describe, it, expect } from "vitest";
import { isMac, mod, shift, alt, modName, altName, superName } from "./platform";

// The detection runs at import time against the test environment (jsdom, which
// reports a non-mac userAgent), so these lock in the Windows/Linux branch: the
// bug we fixed was Windows showing mac labels.
describe("platform labels", () => {
  it("detects a non-mac environment under jsdom", () => {
    expect(isMac).toBe(false);
  });

  it("uses Ctrl-style modifier labels off mac", () => {
    expect(mod).toBe("Ctrl+");
    expect(shift).toBe("Shift+");
    expect(alt).toBe("Alt+");
    expect(modName).toBe("Ctrl");
    expect(altName).toBe("Alt");
    expect(superName).toBe("Win");
  });

  it("composes into readable chords", () => {
    expect(`${mod}${shift}F`).toBe("Ctrl+Shift+F");
    expect(`${mod}K`).toBe("Ctrl+K");
  });
});
