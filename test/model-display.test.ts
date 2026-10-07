import { expect, it } from "vitest";
import { compactModelName } from "../src/models/display";

it.each([
  ["Qwen3.8 27B Pi — mixed groupwise-int (Tesla V100)", "Qwen 27B Pi"],
  ["Qwen3.8 27B NVFP4 (NInfer · V100)", "Qwen 27B"],
  ["Qwen3.8 Flash Next NVFP4 (RTX 5090)", "Qwen Flash Next"],
  ["Gemma 4 31B", "Gemma 4 31B"],
  ["my-finetune-v2", "my-finetune-v2"],
  ["Qwen3.8 27B Pi", "Qwen 27B Pi"],
])("keeps model identity readable: %s", (name, expected) => {
  expect(compactModelName(name)).toBe(expected);
});
