// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { attachmentDrafts, attachmentScope } from "../src/attachments/drafts";

it("keeps draft files private to a workspace, moves them to the new session, and deletes only after acceptance", async () => {
  const a = attachmentScope("host-a", "/project-a", null);
  const b = attachmentScope("host-a", "/project-a", "ses_new");
  const unrelated = attachmentScope("host-b", "/project-a", null);
  await Promise.all([
    attachmentDrafts.add(a, [new File(["alpha"], "a.txt", { type: "text/plain" })]),
    attachmentDrafts.add(a, [new File(["beta"], "b.txt", { type: "text/plain" })]),
  ]);
  expect(attachmentDrafts.snapshot(a).map(x => x.name)).toEqual(["a.txt", "b.txt"]);
  await attachmentDrafts.ensure(unrelated);
  expect(attachmentDrafts.snapshot(unrelated)).toEqual([]);
  await attachmentDrafts.move(a, b);
  expect(attachmentDrafts.snapshot(a)).toEqual([]);
  expect(attachmentDrafts.snapshot(b).map(x => x.name)).toEqual(["a.txt", "b.txt"]);
  await attachmentDrafts.remove(b, [attachmentDrafts.snapshot(b)[0].id]);
  expect(attachmentDrafts.snapshot(b).map(x => x.name)).toEqual(["b.txt"]);
});
