import { describe, expect, it, vi } from "vitest";
import { filesFromNativeDrop } from "../src/attachments/native-drop";

describe("Finder file drops", () => {
  it("reads only dropped files and preserves names and media types", async () => {
    const inspect = vi.fn(async () => ({ isFile: true, isSymlink: false, size: 3 }));
    const read = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const files = await filesFromNativeDrop(["/Users/test/Desktop/снимок.png"], inspect, read);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("снимок.png");
    expect(files[0].type).toBe("image/png");
    expect(inspect).toHaveBeenCalledWith("/Users/test/Desktop/снимок.png");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("rejects folders and oversized files before reading their contents", async () => {
    const read = vi.fn();
    await expect(filesFromNativeDrop(["/tmp/folder"], async () => ({ isFile: false, isSymlink: false, size: 1 }), read)).rejects.toThrow("папки");
    await expect(filesFromNativeDrop(["/tmp/large.mp4"], async () => ({ isFile: true, isSymlink: false, size: 51 * 1024 * 1024 }), read)).rejects.toThrow("50 МБ");
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects a file that changes while it is being read", async () => {
    await expect(filesFromNativeDrop(["/tmp/x.pdf"], async () => ({ isFile: true, isSymlink: false, size: 3 }), async () => new Uint8Array([1, 2]))).rejects.toThrow("изменился");
  });
});
