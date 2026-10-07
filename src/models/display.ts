/** Presentation only: never use a display name for routing or model eligibility. */
export function compactModelName(name: string): string {
  return name
    .split(/\s+[—–]\s+/)[0]
    .replace(/\s*\((?:Tesla|RTX|NInfer|V100|GeForce)\b[^)]*\)?$/i, "")
    .replace(/\s+(?:NVFP4|BF16|FP16|FP8|mixed groupwise-int)\b.*$/i, "")
    .replace(/^Qwen3\.8(?=[\s-]|$)/i, "Qwen")
    .replace(/\s+/g, " ")
    .trim() || name;
}
