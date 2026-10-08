// Explicitly loaded only by isolated evals, with ALL built-in Pi tools disabled.
import { Type } from 'typebox';
export default function (pi: any) {
  const schemas = {
    read: Type.Object({ path: Type.String() }),
    write: Type.Object({ path: Type.String(), text: Type.String() }),
    list: Type.Object({}), browser_snapshot: Type.Object({}),
    browser_action: Type.Object({ revision: Type.Integer(), ref: Type.String(), action: Type.Union([Type.Literal('click'), Type.Literal('fill')]), value: Type.Optional(Type.String()) }),
  };
  const descriptions = {
    read: 'Read an allowed fixture file.', write: 'Replace an allowed fixture file with complete text.',
    list: 'List allowed fixture files.', browser_snapshot: 'Observe the isolated browser and get current refs and revision.',
    browser_action: 'Click or fill an observed ref at the current revision. On STALE_SNAPSHOT get a fresh snapshot. Refresh after each mutation.',
  };
  for (const [name, parameters] of Object.entries(schemas).filter(([name]) => process.env.ARVELA_EVAL_CATEGORY === 'browser' ? name.startsWith('browser_') : !name.startsWith('browser_'))) pi.registerTool({
    name: `fixture_${name}`, label: name, description: descriptions[name as keyof typeof descriptions], parameters,
    async execute(_id: string, args: unknown, signal: AbortSignal) {
      const response = await fetch(`${process.env.ARVELA_EVAL_URL}/tool`, {
        method: 'POST', headers: { authorization: `Bearer ${process.env.ARVELA_EVAL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, args }), signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
      if (!response.ok) throw Error('EVAL_TRANSPORT_FAILURE');
      const body = await response.json();
      if (body.error) throw Error(body.error);
      return { content: [{ type: 'text', text: typeof body.result === 'string' ? body.result : JSON.stringify(body.result) }], details: {} };
    },
  });
  pi.on('before_agent_start', () => ({ systemPrompt: 'Solve the synthetic task using only fixture tools. Inspect, change, then describe the result briefly. No bash or arbitrary files are available. Refresh browser_snapshot after each browser mutation or stale-reference refusal.' }));
}
