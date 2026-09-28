import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shortcutLabel } from "../../lib/shortcuts";
import { FEATURE_SHORTCUTS, FeaturesStep } from "./FeaturesStep";

const FEATURE_IDS = [
  "sessions",
  "projects",
  "splits",
  "status",
  "remote",
  "keyboard",
] as const;

describe("FeaturesStep", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders one captioned figure per feature", () => {
    const { container } = render(<FeaturesStep isMac />);

    expect(container.querySelectorAll("figure")).toHaveLength(FEATURE_IDS.length);
    for (const id of FEATURE_IDS) {
      const figure = screen.getByTestId(`onboarding-feature-${id}`);
      expect(figure.tagName).toBe("FIGURE");
      const caption = figure.querySelector("figcaption");
      expect(caption?.textContent?.trim()).not.toBe("");
    }
  });

  it("hides every illustration panel from assistive technology", () => {
    render(<FeaturesStep isMac />);

    for (const id of FEATURE_IDS) {
      const figure = screen.getByTestId(`onboarding-feature-${id}`);
      const illustration = figure.firstElementChild;
      expect(illustration).not.toBeNull();
      expect(illustration?.tagName).not.toBe("FIGCAPTION");
      expect(illustration?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("shows each shortcut keycap exactly once, in the keyboard caption", () => {
    render(<FeaturesStep isMac={false} />);

    const keyboard = screen.getByTestId("onboarding-feature-keyboard");
    const keycaps = Array.from(keyboard.querySelectorAll("kbd"));
    expect(keycaps).toHaveLength(FEATURE_SHORTCUTS.length);
    for (const kbd of keycaps) {
      expect(kbd.closest("figcaption")).not.toBeNull();
    }

    const labels = keycaps.map((kbd) => kbd.textContent);
    for (const shortcut of FEATURE_SHORTCUTS) {
      expect(labels).toContain(shortcutLabel(shortcut.id, false));
    }
  });
});
