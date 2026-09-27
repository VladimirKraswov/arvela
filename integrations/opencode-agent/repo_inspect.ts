import {tool} from '@opencode-ai/plugin';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {homedir} from 'node:os';

const script = join(homedir(), '.config/opencode/tools/repo_inspect.py');

export default tool({
  description: 'Read-only map of the selected repository: status, instructions, test commands and bounded path/line search. Supply query to locate code or file to get its SHA-256 and likely tests. Returns no file contents; use read for relevant snippets.',
  args: {
    query: tool.schema.string().optional().describe('Optional exact text or symbol to locate; paths and line numbers only.'),
    file: tool.schema.string().optional().describe('Optional repository-relative file for a guarded SHA-256 snapshot and likely tests.'),
  },
  async execute(args, context) {
    const argv = [script, '--root', context.directory];
    if (args.query) argv.push('--query', args.query);
    if (args.file) argv.push('--file', args.file);
    const result = await promisify(execFile)('python3', argv, {
      signal: context.abort,
      timeout: 20000,
      maxBuffer: 131072,
    });
    return result.stdout;
  },
});
