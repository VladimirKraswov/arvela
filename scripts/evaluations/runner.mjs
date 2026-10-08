import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { fixtures, suiteVersion } from './fixtures.mjs';
import { startBackend } from './backend.mjs';
import { startProxy } from './proxy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const active = new Set();
export function cleanEnvironment(home) {
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: tmpdir(),
    XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state'),
    PI_CODING_AGENT_DIR: join(home, 'pi'), PI_OFFLINE: '1', PI_TELEMETRY: '0',
    OPENCODE_CONFIG_DIR: join(home, 'config', 'opencode'), OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
    OPENCODE_TEST_HOME: home, OPENCODE_ENABLE_EXPERIMENTAL_MODELS: 'true' };
  if (process.platform === 'win32') for (const key of ['SystemRoot', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
  return env;
}
export function runProcess(command, args, { cwd, env, seconds = 120, bytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    active.add(child);
    let stdout = '', stderr = '', size = 0, stopped = null, killing = false;
    const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
    const kill = reason => {
      if (killing) return; killing = true; stopped = reason;
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid, 'SIGKILL');
      } catch { child.kill('SIGKILL'); }
    };
    child.evalKill = kill;
    const timer = setTimeout(() => kill('timeout'), seconds * 1000);
    const capture = (target, chunk) => { size += chunk.length; if (size > bytes) { kill('output-limit'); return; } if (target === 'out') stdout += outDecoder.write(chunk); else stderr += errDecoder.write(chunk); };
    child.stdout.on('data', chunk => capture('out', chunk)); child.stderr.on('data', chunk => capture('err', chunk));
    child.on('error', e => { clearTimeout(timer); active.delete(child); reject(e); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer); active.delete(child);
      stdout += outDecoder.end(); stderr += errDecoder.end();
      // Agent CLIs may leave an MCP child after a normal exit; only our process group is touched.
      if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ } }
      resolvePromise({ exitCode, signal, stopped, stdout, stderr });
    });
  });
}

export async function gradeCode(fixture, work) {
  // Candidate code cannot read the oracle, credentials, owner filesystem or spawn/network.
  const source = `const assert=require('node:assert/strict');const s=require('./solution.cjs');(async()=>{${fixture.assertions};process.stdout.write('ARVELA_OUTCOME_OK\\n')})().catch(e=>{console.error(e.message);process.exitCode=1});`;
  const result = await runProcess(process.execPath, ['--permission', `--allow-fs-read=${await realpath(work)}`, '-e', source], {
    cwd: work, env: cleanEnvironment(join(work, '.grade-home')), seconds: 5, bytes: 32768,
  });
  const passed = result.exitCode === 0 && !result.stopped && result.stdout.trim() === 'ARVELA_OUTCOME_OK';
  return { passed, reason: passed ? null : result.stopped ?? 'independent-assertion-failed' };
}
export async function selfCheck() {
  const checks = [];
  for (const f of fixtures.filter(f => f.category !== 'browser')) {
    const root = await mkdtemp(join(tmpdir(), 'arvela-eval-check-'));
    try {
      for (const [name, text] of Object.entries(f.files)) await writeFile(join(root, name), text);
      const base = await gradeCode(f, root);
      for (const [name, text] of Object.entries(f.reference)) await writeFile(join(root, name), text);
      const reference = await gradeCode(f, root);
      checks.push({ id: f.id, baselineFails: !base.passed, referencePasses: reference.passed });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  if (!checks.every(c => c.baselineFails && c.referencePasses)) throw Error('Fixture discrimination failed');
  return checks;
}

export function parseAgentEvents(engine, text) {
  let assistantTurns = 0, errors = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; let usagePresent = false;
  for (const line of text.split('\n')) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'error') errors++;
    if (engine === 'pi' && event.type === 'message_end' && event.message?.role === 'assistant') {
      assistantTurns++; const u = event.message.usage;
      if (u) { usagePresent = true; for (const key of Object.keys(tokens)) tokens[key] += Number(u[key]) || 0; }
      if (event.message.stopReason === 'error' || event.message.errorMessage) errors++;
    }
    if (engine === 'opencode' && event.type === 'step_finish') {
      assistantTurns++; const u = event.part?.tokens;
      if (u) { usagePresent = true; tokens.input += u.input || 0; tokens.output += u.output || 0; tokens.cacheRead += u.cache?.read || 0; tokens.cacheWrite += u.cache?.write || 0; }
    }
  }
  return { assistantTurns, errors, tokens: usagePresent ? tokens : null };
}

async function prepareAgent(engine, root, work, backend, proxy, model, effort, category) {
  const home = join(root, 'home'); await mkdir(home);
  const env = { ...cleanEnvironment(home), ARVELA_EVAL_URL: backend.url, ARVELA_EVAL_TOKEN: backend.token, ARVELA_EVAL_CATEGORY: category };
  const prompt = 'Synthetic evaluation task. Use only fixture tools. Inspect the available files/browser, solve the task, then give a brief result. Do not ask for human intervention. Refresh browser snapshots after mutations or stale refs.\n';
  if (engine === 'pi') {
    await mkdir(join(home, 'pi'));
    await writeFile(join(home, 'pi', 'models.json'), JSON.stringify({ providers: { eval: {
      baseUrl: proxy.url, api: 'openai-completions', apiKey: '$ARVELA_EVAL_API_KEY',
      models: [{ id: model, name: model, reasoning: true, input: ['text'], contextWindow: 262144, maxTokens: 4096,
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: true } }],
    } } }), { mode: 0o600 });
    await writeFile(join(home, 'pi', 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
    env.ARVELA_EVAL_API_KEY = proxy.token;
    return { command: 'pi', args: ['--offline', '--mode', 'json', '-p', '--no-session', '--no-builtin-tools', '--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes', '-e', join(here, 'pi-extension.ts'), '--provider', 'eval', '--model', model, '--thinking', effort], env, prompt };
  }
  const config = {
    $schema: 'https://opencode.ai/config.json', autoupdate: false, share: 'disabled', snapshot: false,
    enabled_providers: ['eval'], lsp: false, formatter: false,
    provider: { eval: { npm: '@ai-sdk/openai-compatible', name: 'Isolated evaluation', options: { baseURL: proxy.url, apiKey: proxy.token },
      models: { [model]: { name: model, limit: { context: 262144, output: 4096 }, reasoning: true } } } },
    agent: { build: { tools: { '*': false, 'fixture_*': true }, permission: { '*': 'deny', 'fixture_*': 'allow' }, steps: 20 } },
    mcp: { fixture: { type: 'local', command: [process.execPath, join(here, 'mcp.mjs')], enabled: true, environment: { ARVELA_EVAL_URL: backend.url, ARVELA_EVAL_TOKEN: backend.token, ARVELA_EVAL_CATEGORY: category } } },
  };
  await mkdir(join(home, 'config', 'opencode'), { recursive: true });
  const configPath = join(home, 'config', 'opencode', 'opencode.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  env.OPENCODE_CONFIG = configPath;
  return { command: 'opencode', args: ['run', '--pure', '--format', 'json', '--model', `eval/${model}`, '--agent', 'build', '--variant', effort, '--dir', work], env, prompt };
}

export function renderReport(report) {
  const rows = report.trials.map(t => `| ${t.fixture} | ${t.engine} | ${t.repeat} | ${t.passed ? 'PASS' : t.status} | ${(t.verifiedSeconds).toFixed(1)} | ${t.providerUsage.responsesWithUsage ? t.providerUsage.input + t.providerUsage.output : 'unknown'} | ${t.tools.staleRefusals} |`);
  return `# Arvela synthetic evaluation ${suiteVersion}\n\nModel: ${report.model}; requested effort: ${report.effort}; effective provider effort: ${report.effectiveEffort}.\n\n${report.trials.filter(t => t.passed).length}/${report.trials.length} independently verified trials. Owner interventions: 0 (unattended runner; not a statement about production).\n\n| Fixture | Agent | Repeat | Result | Verified seconds | Provider tokens | Stale refusals |\n|---|---|---:|---|---:|---:|---:|\n${rows.join('\n')}\n\nLimits: ${JSON.stringify(report.limits)}. Provider token usage is authoritative where present; missing usage is unknown, never zero. Admission checks apply between responses; one in-flight response can exceed the token ceiling.\n\nThese small synthetic trials do not measure local Qwen throughput, general model intelligence, production browser emulation, UI behavior or long-project quality. No history, skills or private code was sent. Tool/fixture revisions are in the JSON report. Sequential AB/BA order alternates between repeats; no automatic retries or result deletion.\n`;
}

async function main() {
  const args = process.argv.slice(2); const value = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const allowed = new Set(['--self-check', '--live', '--output', '--agents', '--cases', '--repeats', '--timeout', '--total-timeout', '--model', '--effort', '--key-file', '--playwright-module', '--browser-executable', '--total-tokens', '--total-requests']);
  for (let i = 0; i < args.length; i++) { if (!allowed.has(args[i])) throw Error(`Unknown option ${args[i]}`); if (!['--self-check', '--live'].includes(args[i])) i++; }
  if (args.includes('--self-check')) { console.log(JSON.stringify(await selfCheck(), null, 2)); return; }
  if (!args.includes('--live')) throw Error('Live inference is opt-in: --live required. Offline CI: --self-check.');
  const integer = (flag, fallback, min, max) => { const n = Number(value(flag, fallback)); if (!Number.isInteger(n) || n < min || n > max) throw Error(`Invalid ${flag}`); return n; };
  const engines = value('--agents', 'opencode,pi').split(',');
  if (!engines.length || new Set(engines).size !== engines.length || engines.some(e => !['opencode', 'pi'].includes(e))) throw Error('Unknown/duplicate agent');
  const requested = value('--cases', fixtures.map(f => f.id).join(',')).split(',');
  const selected = fixtures.filter(f => requested.includes(f.id));
  if (selected.length !== requested.length) throw Error('Unknown/duplicate case');
  const repeats = integer('--repeats', '2', 1, 5), seconds = integer('--timeout', '120', 10, 300);
  const totalSeconds = integer('--total-timeout', '1800', 30, 3600);
  const model = value('--model', 'deepseek-flash'), effort = value('--effort', 'medium');
  if (model !== 'deepseek-flash' || !['off', 'medium'].includes(effort)) throw Error('This cloud suite supports deepseek-flash and off/medium only');
  const output = resolve(value('--output', join('.local', 'evaluations', new Date().toISOString().replaceAll(':', '-'))));
  // Never merge/overwrite previous evidence. Raw agent stream is intentionally not saved.
  await mkdir(output, { recursive: true });
  const reportPath = join(output, 'report.json');
  try { await readFile(reportPath); throw Error('Report already exists; choose a fresh output directory'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let key = process.env.DEEPSEEK_API_KEY;
  if (!key && value('--key-file')) {
    const auth = JSON.parse(await readFile(resolve(value('--key-file')), 'utf8'));
    key = auth.deepseek?.key;
  }
  if (typeof key !== 'string' || !key.trim()) throw Error('Missing DEEPSEEK_API_KEY or explicit --key-file OpenCode auth; no live trial started');
  const limits = { requests: 18, outputTokens: 4096, tokens: 60000, requestBytes: 100000,
    totalTokens: integer('--total-tokens', '1000000', 4096, 2000000), totalRequests: integer('--total-requests', '400', 1, 500), perTrialSeconds: seconds, totalSeconds };
  const budget = { requests: 0, input: 0, output: 0 };
  const sources = ['fixtures.mjs', 'backend.mjs', 'proxy.mjs', 'runner.mjs', 'mcp.mjs', 'pi-extension.ts'];
  const revisions = Object.fromEntries(await Promise.all(sources.map(async name => [name, hash(await readFile(join(here, name)))])));
  const versions = {};
  for (const engine of engines) { const v = await runProcess(engine, ['--version'], { seconds: 10, bytes: 1024 }); if (v.exitCode !== 0) throw Error(`${engine} unavailable`); versions[engine] = v.stdout.trim(); }
  const report = { schemaVersion: 1, suiteVersion, startedAt: new Date().toISOString(), model, effort, effectiveEffort: effort === 'off' ? 'off' : 'high', revisions, skillRevisions: [], versions, limits, trials: [], budget, complete: false };
  const start = performance.now(); let cancelled = false;
  const interrupt = () => { cancelled = true; for (const child of active) child.evalKill('cancelled'); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const globalTimer = setTimeout(interrupt, totalSeconds * 1000);
  const save = async () => { await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 }); await writeFile(join(output, 'report.md'), renderReport(report), { mode: 0o600 }); };
  try {
    for (let repeat = 1; repeat <= repeats; repeat++) for (const fixture of selected) for (const engine of (repeat % 2 ? engines : [...engines].reverse())) {
      if (cancelled || budget.requests >= limits.totalRequests || budget.input + budget.output >= limits.totalTokens) break;
      const root = await mkdtemp(join(tmpdir(), 'arvela-live-eval-')); const work = join(root, 'work'); await mkdir(work);
      let backend, proxy; const started = performance.now();
      const trial = { fixture: fixture.id, fixtureRevision: hash(JSON.stringify(fixture)), category: fixture.category, engine, repeat, passed: false, status: 'setup-error', verifiedSeconds: 0, ownerInterventions: 0, tools: { calls: 0, errors: 0, staleRefusals: 0 }, providerUsage: { requests: 0, responsesWithUsage: 0 }, agentUsage: null };
      try {
        for (const [name, text] of Object.entries(fixture.files)) await writeFile(join(work, name), text);
        backend = await startBackend({ fixture, work, playwrightModule: value('--playwright-module') ? pathToFileURL(resolve(value('--playwright-module'))).href : undefined, browserExecutable: value('--browser-executable') ? resolve(value('--browser-executable')) : undefined });
        proxy = await startProxy({ key, model, effort, budget, limits });
        const agent = await prepareAgent(engine, root, work, backend, proxy, model, effort, fixture.category);
        const result = await runProcess(agent.command, [...agent.args, agent.prompt + fixture.prompt], { cwd: work, env: agent.env, seconds });
        trial.agentUsage = parseAgentEvents(engine, result.stdout);
        trial.exitCode = result.exitCode; trial.stopped = result.stopped;
        const grade = fixture.category === 'browser' ? { passed: await backend.gradeBrowser() } : await gradeCode(fixture, work);
        trial.passed = grade.passed && result.exitCode === 0 && !result.stopped && trial.agentUsage.errors === 0 && proxy.usage.rejected === 0 && proxy.usage.errors === 0;
        trial.status = trial.passed ? 'PASS' : (result.stopped ?? (proxy.usage.rejected ? 'budget-exhausted' : (proxy.usage.errors || trial.agentUsage.errors ? 'agent-error' : 'outcome-failed')));
        // Summaries/booleans only; no chain of thought, raw output, endpoints or credential-bearing args.
      } catch (e) { trial.status = 'setup-error'; trial.errorCode = e.code ?? 'EVAL_SETUP_FAILED'; }
      finally {
        trial.verifiedSeconds = (performance.now() - started) / 1000;
        if (backend) { trial.tools = { ...backend.metrics }; await backend.close(); }
        if (proxy) { trial.providerUsage = { ...proxy.usage }; await proxy.close(); }
        await rm(root, { recursive: true, force: true });
      }
      report.trials.push(trial); await save();
      console.log(`${fixture.id} ${engine} #${repeat}: ${trial.status} ${trial.verifiedSeconds.toFixed(1)}s requests=${trial.providerUsage.requests}`);
    }
    report.complete = !cancelled && report.trials.length === repeats * selected.length * engines.length;
    report.finishedAt = new Date().toISOString(); report.totalSeconds = (performance.now() - start) / 1000; await save();
  } finally { clearTimeout(globalTimer); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
  if (!report.complete || report.trials.some(t => !t.passed)) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exitCode = 1; });
