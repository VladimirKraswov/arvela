import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { JSDOM } from 'jsdom';
import { fixtures, browserHtml,browserWorkflowHtml } from '../scripts/evaluations/fixtures.mjs';
import { cleanEnvironment, gradeCode, selfCheck, runProcess, parseAgentEvents, renderReport } from '../scripts/evaluations/runner.mjs';
import { startBackend } from '../scripts/evaluations/backend.mjs';
import { startProxy } from '../scripts/evaluations/proxy.mjs';

afterEach(() => vi.unstubAllGlobals());
describe('reproducible evaluation fixtures', () => {
  it('M44/M45 archived sources and all failed/successful project files match their receipts', async () => {
    const base=fileURLToPath(new URL('../docs/evaluations/2026-10-08/',import.meta.url));let sources=0,files=0,wrappers=0;
    for(const run of ['projects/initial','projects/request-budget','projects/qualified-browser','navigation']){
      const root=join(base,run),report=JSON.parse(await readFile(join(root,'report.json'),'utf8'));
      for(const [name,sha] of Object.entries(report.revisions)){
        const file=name.startsWith('../../services/hub/')?`dependencies/hub/${name.split('/').at(-1)}`:name.startsWith('../../src-tauri/')?'dependencies/project-map-core.mjs':name;
        expect(file).not.toContain('..');const bytes=await readFile(join(root,'sources',file));expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);sources++;
      }
      for(const trial of report.trials){
        if(trial.candidate){const bytes=await readFile(join(root,trial.candidate.file));expect(createHash('sha256').update(bytes).digest('hex')).toBe(trial.candidate.sha256);wrappers++;}
        for(const candidate of trial.candidateFiles??[]){expect(candidate.file).not.toContain('..');const bytes=await readFile(join(root,candidate.file));expect(createHash('sha256').update(bytes).digest('hex')).toBe(candidate.sha256);files++;}
      }
    }
    expect({sources,files,wrappers}).toEqual({sources:45,files:180,wrappers:36});
  });
  it('every code/recovery baseline fails and every reference passes independent assertions', async () => {
    const checks = await selfCheck(); expect(checks).toHaveLength(12);
    expect(checks.every(c => c.baselineFails && c.referencePasses)).toBe(true);
  }, 15000);
  it('has 16 distinct versioned tasks including miniature projects', () => {
    expect(fixtures).toHaveLength(16); expect(new Set(fixtures.map(f => f.id)).size).toBe(16);
    expect(new Set(fixtures.map(f => f.category))).toEqual(new Set(['code', 'browser', 'recovery', 'project']));
  });
  it('browser baseline is wrong, invalid save is refused, corrected save preserves Pine', () => {
    const dom = new JSDOM(browserHtml, { runScripts: 'dangerously' });
    try {
      const d = dom.window.document;
      expect(d.querySelector('#oak')!.textContent).toBe('0');
      (d.querySelector('[aria-label="Edit Oak"]') as HTMLButtonElement).click();
      const input = d.querySelector('input')!; input.value = '120';
      (d.querySelector('[aria-label="Save"]') as HTMLButtonElement).click();
      expect(d.querySelector('#oak')!.textContent).toBe('0');
      expect(d.querySelector('[role="alert"]')!.textContent).toContain('0 to 100');
      input.value = '20'; (d.querySelector('[aria-label="Save"]') as HTMLButtonElement).click();
      expect(d.querySelector('#oak')!.textContent).toBe('20'); expect(d.querySelector('#pine')!.textContent).toBe('5');
      expect((dom.window as any).saved).toBe(1);
    } finally { dom.window.close(); }
  });
  it('scoped tools refuse arbitrary paths, symlinks and oversized writes without changing owner files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arvela-tools-test-'));
    const work = join(root, 'work'); const { mkdir } = await import('node:fs/promises'); await mkdir(work);
    const owner = join(root, 'owner.txt'); await writeFile(owner, 'owner data'); await writeFile(join(work, 'solution.cjs'), 'fixture');
    const backend = await startBackend({ fixture: fixtures[0], work });
    try {
      await expect(backend.execute('read', { path: '../owner.txt' })).rejects.toThrow('FILE_NOT_ALLOWED');
      await expect(backend.execute('write', { path: 'solution.cjs', text: 'x'.repeat(65537) })).rejects.toThrow('FILE_TOO_LARGE');
      await rm(join(work, 'solution.cjs')); await symlink(owner, join(work, 'solution.cjs'));
      await expect(backend.execute('write', { path: 'solution.cjs', text: 'changed' })).rejects.toThrow('NOT_REGULAR_FILE');
      expect(await readFile(owner, 'utf8')).toBe('owner data');
      const unauthorized = await fetch(`${backend.url}/tool`, { method: 'POST', body: '{}' }); expect(unauthorized.status).toBe(401);
    } finally { await backend.close(); await rm(root, { recursive: true, force: true }); }
  });
  it('candidate grading cannot read files outside its fixture', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arvela-grade-test-'));
    try {
      const work = join(root, 'work'); await mkdir(work);
      const outside = join(root, 'outside.txt'); await writeFile(outside, 'synthetic owner fixture');
      await writeFile(join(work, 'solution.cjs'), `require("node:fs").readFileSync(${JSON.stringify(outside)});exports.price=(q,u)=>(q??1)*u;`);
      const denied = await gradeCode(fixtures[0], work);
      expect(denied.passed).toBe(false); expect(denied.diagnostic).toContain('ERR_ACCESS_DENIED');
      await writeFile(join(work, 'solution.cjs'), 'process.exit(0);');
      expect((await gradeCode(fixtures[0], work)).passed).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('timed-out and over-output processes are failures, never green exit markers', async () => {
    const timeout = await runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { seconds: 0.1 });
    expect(timeout.stopped).toBe('timeout'); expect(timeout.exitCode).not.toBe(0);
    const flood = await runProcess(process.execPath, ['-e', 'console.log("x".repeat(4096));setInterval(()=>{},1000)'], { bytes: 64 });
    expect(flood.stopped).toBe('output-limit');
  });
  it('child environments exclude owner credentials, provider variables and configuration', () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'synthetic-secret';
    try {
      const env = cleanEnvironment('/test-home');
      expect(env.DEEPSEEK_API_KEY).toBeUndefined(); expect(env.HOME).toBe('/test-home');
      expect(env.OPENCODE_TEST_HOME).toBe('/test-home'); expect(env.PI_CODING_AGENT_DIR).toBe(join('/test-home','pi'));
    } finally { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous; }
  });
  it('counts only terminal usage events, not streaming snapshots or duplicated agent_end', () => {
    const message = { role: 'assistant', usage: { input: 12, output: 4, cacheRead: 8 }, stopReason: 'stop' };
    const stream = [{ type: 'message_update', usage: message.usage }, { type: 'message_end', message }, { type: 'agent_end', messages: [message] }].map(JSON.stringify).join('\n');
    expect(parseAgentEvents('pi', stream).tokens).toEqual({ input: 12, output: 4, cacheRead: 8, cacheWrite: 0 });
    expect(parseAgentEvents('pi', '').tokens).toBeNull();
    expect(parseAgentEvents('opencode', JSON.stringify({ type: 'error' })).errors).toBe(1);
  });
  it('report leaves unavailable provider usage unknown and failures visible', () => {
    const text = renderReport({ model: 'synthetic', effort: 'medium', effectiveEffort: 'high', limits: {}, trials: [{ fixture: 'a', engine: 'pi', repeat: 1, passed: false, status: 'timeout', verifiedSeconds: 2, tools: { staleRefusals: 0 }, providerUsage: { responsesWithUsage: 0 } }] });
    expect(text).toContain('0/1'); expect(text).toContain('unknown'); expect(text).toContain('timeout');
  });
  it('partial usage cannot look complete and failed elapsed time is not time to a verified outcome', () => {
    const text = renderReport({ model: 'synthetic', effort: 'off', effectiveEffort: 'off', limits: {}, trials: [{ fixture: 'a', engine: 'pi', repeat: 1, passed: false, status: 'budget-exhausted', elapsedSeconds: 3, verifiedSeconds: null, tools: { staleRefusals: 0 }, providerUsage: { requests: 2, responsesWithUsage: 1, input: 10, output: 2 } }] });
    expect(text).toContain('partial 12'); expect(text).toContain('3.0'); expect(text).toContain('0/1');
    expect(text).toContain('Elapsed seconds through grading');
  });
  it('published synthetic candidates remain byte-identical to each report, including failed trials', async () => {
    const root = fileURLToPath(new URL('../docs/evaluations/2026-10-08/', import.meta.url));
    let candidates = 0;
    for (const relative of ['paired.json', 'final-smoke.json', 'budget-stop/report.json']) {
      const path = join(root, relative);
      const report = JSON.parse(await readFile(path, 'utf8'));
      for (const trial of report.trials) if (trial.candidate) {
        expect(trial.candidate.file).toMatch(/^solutions\/[a-z0-9-]+\.cjs$/);
        const content = await readFile(join(dirname(path), trial.candidate.file));
        expect(createHash('sha256').update(content).digest('hex')).toBe(trial.candidate.sha256);
        candidates++;
      }
    }
    expect(candidates).toBe(3);
  });
});

describe('cloud admission limits and paired request policy', () => {
  const limits = { requests: 1, outputTokens: 64, tokens: 1000, requestBytes: 10000, totalTokens: 10000, totalRequests: 2 };
  it('normalizes both agents, counts chunked UTF-8 SSE usage once and refuses excess requests', async () => {
    const realFetch = globalThis.fetch;
    let sent: any;
    vi.stubGlobal('fetch', async (url: string, options: any) => {
      if (!String(url).startsWith('https://api.deepseek.com/')) return realFetch(url, options);
      sent = JSON.parse(options.body);
      const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"я"}}]}\n\ndata: {"usage":{"prompt_tokens":30,"completion_tokens":4,"prompt_cache_hit_tokens":20}}\n\ndata: [DONE]\n\n');
      return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
    });
    const budget = { requests: 0, input: 0, output: 0 };
    const proxy = await startProxy({ key: 'fixture-only', model: 'deepseek-flash', effort: 'medium', budget, limits });
    try {
      const options = { method: 'POST', headers: { Authorization: `Bearer ${proxy.token}` }, body: JSON.stringify({ model: 'wrong', reasoning_effort: 'low', max_tokens: 999999, stream: true, messages: [] }) };
      const response = await fetch(`${proxy.url}/chat/completions`, options); await response.text();
      expect(sent.model).toBe('deepseek-flash'); expect(sent.max_tokens).toBe(64); expect(sent.reasoning_effort).toBe('high'); expect(sent.thinking.type).toBe('enabled');
      expect(proxy.usage.timings).toHaveLength(1);expect(proxy.usage.timings[0].firstResponseMs).toBeGreaterThanOrEqual(0);expect(JSON.stringify(proxy.usage.timings)).not.toContain('я');
      expect(proxy.usage.input).toBe(30); expect(proxy.usage.output).toBe(4); expect(proxy.usage.responsesWithUsage).toBe(1);
      const refused = await fetch(`${proxy.url}/chat/completions`, options); expect(refused.status).toBe(403); expect(budget.requests).toBe(1);
    } finally { await proxy.close(); }
  });
  it('provider rejection remains an error without manufactured token counts or credential echoes', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, options: any) => String(url).startsWith('https://api.deepseek.com/') ? Promise.resolve(new Response('secret upstream body', { status: 401 })) : realFetch(url, options));
    const proxy = await startProxy({ key: 'do-not-echo', model: 'deepseek-flash', effort: 'off', budget: { requests: 0, input: 0, output: 0 }, limits });
    try {
      const response = await fetch(`${proxy.url}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${proxy.token}` }, body: JSON.stringify({ messages: [] }) });
      expect(response.status).toBe(401); expect(await response.text()).not.toContain('secret'); expect(proxy.usage.responsesWithUsage).toBe(0); expect(proxy.usage.errors).toBe(1);
    } finally { await proxy.close(); }
  });
  it('concurrent title/answer requests are admitted sequentially against completed token usage', async () => {
    const realFetch = globalThis.fetch;
    let unblock!: () => void, upstreamCalls = 0;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    vi.stubGlobal('fetch', async (url: string, options: any) => {
      if (!String(url).startsWith('https://api.deepseek.com/')) return realFetch(url, options);
      upstreamCalls++; await blocked;
      return new Response(JSON.stringify({ model: 'served-revision', usage: { prompt_tokens: 30, completion_tokens: 4 } }));
    });
    const proxy = await startProxy({ key: 'fixture-only', model: 'deepseek-flash', effort: 'off', budget: { requests: 0, input: 0, output: 0 }, limits: { ...limits, requests: 3, tokens: 20 } });
    try {
      const options = { method: 'POST', headers: { Authorization: `Bearer ${proxy.token}` }, body: JSON.stringify({ messages: [] }) };
      const first = fetch(`${proxy.url}/chat/completions`, options);
      const second = fetch(`${proxy.url}/chat/completions`, options);
      await vi.waitFor(() => expect(upstreamCalls).toBe(1));
      unblock();
      const responses = await Promise.all([first, second]);
      expect(responses.map(r => r.status).sort()).toEqual([200, 403]);
      expect(upstreamCalls).toBe(1); expect(proxy.usage.servedModels).toEqual(['served-revision']);
    } finally { unblock(); await proxy.close(); }
  });
});
it('miniature project tools expose public checks while preserving protected entrypoints and held-out oracle',async()=>{
 const f=fixtures.find(f=>f.id==='project-checkout')!,root=await mkdtemp(join(tmpdir(),'arvela-project-tools-'));
 for(const [name,text] of Object.entries(f.files)){await mkdir(dirname(join(root,name)),{recursive:true});await writeFile(join(root,name),text as string);}
 const backend=await startBackend({fixture:f,work:root});
 try{
  await expect(backend.execute('write',{path:'solution.cjs',text:'exports.checkout=()=>42;'})).rejects.toThrow('READ_ONLY_FILE');
  expect((await backend.execute('check')).passed).toBe(false);
  for(const [name,text] of Object.entries(f.reference))await backend.execute('write',{path:name,text});
  expect((await backend.execute('check')).passed).toBe(true);expect((await gradeCode(f,root)).passed).toBe(true);
  await writeFile(join(root,'README.md'),'changed authority');expect((await gradeCode(f,root)).passed).toBe(false);
 }finally{await backend.close();await rm(root,{recursive:true,force:true});}
});

it('two-product workflow preserves distinct targets and rejects invalid input before two saves',()=>{
 const dom=new JSDOM(browserWorkflowHtml,{runScripts:'dangerously'});try{const d=dom.window.document;
 (d.querySelector('[aria-label="Edit Oak"]') as HTMLButtonElement).click();const input=d.querySelector('input')!;input.value='120';(d.querySelector('[aria-label="Save"]') as HTMLButtonElement).click();expect(d.querySelector('#oak')!.textContent).toBe('0');input.value='20';(d.querySelector('[aria-label="Save"]') as HTMLButtonElement).click();
 (d.querySelector('[aria-label="Edit Pine"]') as HTMLButtonElement).click();input.value='10';(d.querySelector('[aria-label="Save"]') as HTMLButtonElement).click();expect(d.querySelector('#oak')!.textContent).toBe('20');expect(d.querySelector('#pine')!.textContent).toBe('10');expect((dom.window as any).saved).toBe(2);expect((dom.window as any).invalid).toBe(1);expect(fixtures.find(f=>f.workflow)!.requests).toBe(32);
 }finally{dom.window.close();}
});
