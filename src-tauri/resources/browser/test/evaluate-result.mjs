export function parseEvaluateResult(text) {
  const result = text.split('### Result\n')[1];
  if (!result) throw new Error('Missing browser evaluate result');
  return JSON.parse(result.split(/\n(?:###|Desktop browser state:)/)[0].trim());
}
