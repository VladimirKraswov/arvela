import { describe, expect, it } from "vitest";
import { isAbsoluteLocalPath, normalizeLocalPath, pathBasename, pathDirname, pathIsWithin } from "../src/util/paths";

describe("engine paths across platforms", () => {
  it("recognizes drive, UNC and POSIX paths without accepting drive-relative paths", () => {
    for (const path of ["C:\\Проект с пробелами", "C:/repo", "\\\\server\\share\\repo", "/tmp/repo"])
      expect(isAbsoluteLocalPath(path)).toBe(true);
    for (const path of ["C:repo", "repo/file", "\\repo", ""])
      expect(isAbsoluteLocalPath(path)).toBe(false);
  });

  it("keeps POSIX directories with different case distinct", () => {
    expect(pathIsWithin("/home/user/Project/file.ts", "/home/user/project")).toBe(false);
    expect(pathIsWithin("/home/user/project/file.ts", "/home/user/project")).toBe(true);
    expect(pathIsWithin("/home/user/project-other/file.ts", "/home/user/project")).toBe(false);
  });

  it("compares Windows separators and case without confusing sibling projects", () => {
    expect(pathIsWithin("c:\\WORK\\Проект\\src\\file.ts", "C:/work/Проект/")).toBe(true);
    expect(pathIsWithin("C:/work/project-other", "C:\\work\\project")).toBe(false);
    expect(pathIsWithin("\\\\Server\\Share\\folder", "\\\\server\\share")).toBe(true);
  });

  it("handles filesystem roots and missing roots", () => {
    expect(normalizeLocalPath("C:\\")).toBe("C:/");
    expect(pathDirname("C:/file.ts")).toBe("C:/");
    expect(pathDirname("/file.ts")).toBe("/");
    expect(pathIsWithin("/tmp/file.ts", "/")).toBe(true);
    expect(pathIsWithin("C:/file.ts", "C:/")).toBe(true);
    expect(pathIsWithin("/tmp/file.ts", "")).toBe(false);
  });

  it("displays just the last directory or filename", () => {
    expect(pathBasename("C:\\Dev\\Проект с пробелами\\")).toBe("Проект с пробелами");
    expect(pathBasename("/work/project/")).toBe("project");
    expect(pathDirname("src/file.ts")).toBe("src");
    expect(pathDirname("file.ts")).toBe("");
  });
});
