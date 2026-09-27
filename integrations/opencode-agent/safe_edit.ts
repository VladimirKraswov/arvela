import {tool} from '@opencode-ai/plugin';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {homedir} from 'node:os';

const script = join(homedir(), '.config/opencode/tools/safe_edit.py');

export default tool({
  description: 'Guarded exact replacement of one repository file. First call repo_inspect(file) for its SHA-256 and read the current text. A changed file or missing/ambiguous old text returns conflict without writing. Use for stale-edit recovery, not as a blind retry.',
  args: {
    path: tool.schema.string().describe('Repository-relative file path; no symlinks.'),
    expected_sha256: tool.schema.string().length(64).describe('SHA-256 from repo_inspect(file) for the version you read.'),
    old: tool.schema.string().min(1).describe('Exact, unique text to replace.'),
    new: tool.schema.string().describe('Replacement text.'),
  },
  async execute(args, context) {
    // Custom tools do not inherit the built-in edit tool's permission rule.
    // Ask the OpenCode permission engine and disallow the read-only reviewer.
    if (context.agent === 'qwen-review') {
      throw new Error('safe_edit is unavailable to the read-only reviewer');
    }
    await context.ask({
      permission: 'edit',
      patterns: [args.path],
      always: [],
      metadata: {tool: 'safe_edit', path: args.path},
    });
    const child = spawn('python3', [script, context.directory], {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: context.abort,
    });
    const payload = JSON.stringify(args);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.end(payload);
    const code = await new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', status => resolve(status ?? 1));
    });
    if (code !== 0) throw new Error(stderr.slice(0, 1000) || stdout.slice(0, 1000));
    return stdout;
  },
});
