// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fileChooserOpen, focusComposer, openFileInput, registerComposer, requestComposerFiles, subscribeFileChooser } from "../src/attachments/composerBridge";

it("routes file and focus requests only to the composer editing the same chat", () => {
  const openFiles = vi.fn(() => true), focus = vi.fn();
  expect(requestComposerFiles("chat-a")).toBe(false); // nothing mounted: the caller must say so
  const stop = registerComposer({ scope: () => "chat-a", openFiles, focus });
  expect(requestComposerFiles("chat-b")).toBe(false); focusComposer("chat-b");
  expect(openFiles).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled();
  expect(requestComposerFiles("chat-a")).toBe(true); focusComposer("chat-a");
  expect(openFiles).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce();
  stop(); expect(requestComposerFiles("chat-a")).toBe(false);
});

it("tracks an open native chooser until change, cancel or the window regains focus", () => {
  const input = document.createElement("input"); input.type = "file";
  const click = vi.spyOn(input, "click").mockImplementation(() => {});
  const changes = vi.fn(); const stop = subscribeFileChooser(changes);
  expect(openFileInput(input)).toBe(true); expect(click).toHaveBeenCalledOnce(); expect(fileChooserOpen()).toBe(true);
  input.dispatchEvent(new Event("cancel")); expect(fileChooserOpen()).toBe(false);
  openFileInput(input); window.dispatchEvent(new Event("focus")); expect(fileChooserOpen()).toBe(false);
  openFileInput(input); input.dispatchEvent(new Event("change")); expect(fileChooserOpen()).toBe(false);
  expect(changes).toHaveBeenCalledTimes(6); stop();
  input.disabled = true; expect(openFileInput(input)).toBe(false); expect(fileChooserOpen()).toBe(false);
  expect(openFileInput(null)).toBe(false);
});
