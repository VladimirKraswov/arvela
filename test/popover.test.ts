import { describe, expect, it } from "vitest";
import { placePopover } from "../src/util/popover";

describe("floating popup viewport placement", () => {
  it("escapes the composer rectangle and shows all options above its trigger", () => {
    const p = placePopover({ left: 400, right: 550, top: 550, bottom: 580 },
      { width: 240, height: 250 }, { width: 1000, height: 620 });
    expect(p.top).toBe(292); // Composer starts at450: popup must extend beyond it.
    expect(p.placement).toBe("top");
    expect(p.maxHeight).toBeGreaterThanOrEqual(250);
  });
  it("flips below a high trigger instead of clipping its first options", () => {
    const p = placePopover({ left: 200, right: 300, top: 50, bottom: 80 },
      { width: 240, height: 300 }, { width: 900, height: 620 });
    expect(p.placement).toBe("bottom");
    expect(p.top).toBe(88);
  });
  it("keeps right-edge menus inside the window", () => {
    const p = placePopover({ left: 850, right: 890, top: 400, bottom: 430 },
      { width: 360, height: 200 }, { width: 900, height: 620 });
    expect(p.left + p.width).toBe(890);
  });
  it("constrains long menus to available height and narrow windows", () => {
    const p = placePopover({ left: 170, right: 200, top: 310, bottom: 340 },
      { width: 360, height: 700 }, { width: 300, height: 620 });
    expect(p.width).toBe(280);
    expect(p.top).toBe(10);
    expect(p.maxHeight).toBe(292);
  });
  it("flips sidebar menus up near the bottom and aligns to the trigger", () => {
    const p = placePopover({ left: 260, right: 280, top: 560, bottom: 590 },
      { width: 180, height: 120 }, { width: 900, height: 620 }, "bottom", "end");
    expect(p.placement).toBe("top");
    expect(p.left).toBe(100);
    expect(p.top).toBe(432);
  });
});
