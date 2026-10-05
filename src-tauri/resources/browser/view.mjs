// Trusted pixel projection of the real browser. Remote HTML never enters the
// privileged Desktop WebView. No extra listener, exposed CDP or injected script.
export function createView(getContext) {
  let active;
  let cursor;
  let busy = false;
  let attached;
  let revision = 0;
  let nextPageId = 0;
  const pageIds = new WeakMap();
  const pageId = value => {
    if (!pageIds.has(value)) pageIds.set(value, String(++nextPageId));
    return pageIds.get(value);
  };
  const selected = new WeakMap();
  async function page() {
    const context = await getContext();
    if (attached !== context) {
      attached = context;
      context.on('page', value => { active = value; });
    }
    if (!active || active.isClosed()) active = context.pages().at(-1) || await context.newPage();
    return active;
  }
  async function before(client, params, owner = 'agent') {
    if (owner === 'agent') revision++;
    const current = await page();
    if (selected.get(client) !== current) {
      // The official backend's tab list is initially empty until its first
      // context-using call. A read-only snapshot attaches it to our context.
      if (!selected.has(client)) {
        const initialized = await client.callTool({ name: 'browser_snapshot', arguments: {} });
        if (initialized.isError) throw new Error('Could not attach browser context');
      }
      const index = current.context().pages().indexOf(current);
      const result = await client.callTool({ name: 'browser_tabs', arguments: { action: 'select', index } });
      if (result.isError) throw new Error('Could not synchronize browser tab');
      selected.set(client, current);
    }
    busy = true;
    const args = params.arguments || {};
    let point;
    if (Number.isFinite(args.x) && Number.isFinite(args.y)) point = { x: args.x, y: args.y };
    else if (typeof args.target === 'string' && /^[a-zA-Z0-9]+$/.test(args.target)) {
      const box = await current.locator(`aria-ref=${args.target}`).boundingBox({ timeout: 500 }).catch(() => null);
      if (box) point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    if (point) cursor = { ...point, owner, action: params.name, at: Date.now() };
  }
  async function after(client, params, result) {
    busy = false;
    const context = await getContext();
    const pages = context.pages();
    const text = result?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') || '';
    const url = text.match(/^- Page URL: (.+)$/m)?.[1];
    if (params.name === 'browser_tabs' && params.arguments?.action === 'select') active = pages[params.arguments.index];
    else if (url) active = pages.find(value => value.url() === url) || active;
    if (active && !active.isClosed()) selected.set(client, active);
  }
  async function frame(context) {
    if (!context) return { browserOpen: false, tabs: [], busy: false };
    const pages = context.pages();
    if (!active || active.isClosed()) active = pages.at(-1);
    if (!active) return { browserOpen: true, tabs: [], busy };
    const current = active;
    const viewport = current.viewportSize() || { width: 1280, height: 800 };
    const size = { width: Math.min(viewport.width, 1920), height: Math.min(viewport.height, 1200) };
    const image = await current.screenshot({ type: 'jpeg', quality: 65, timeout: 2000, scale: 'css', clip: { x: 0, y: 0, ...size } });
    const tabs = await Promise.all(pages.map(async (value, index) => ({ index, url: value.url(), title: await value.title().catch(() => ''), active: value === current })));
    return { browserOpen: true, tabs, url: current.url(), title: await current.title().catch(() => ''),
      pageId: pageId(current), revision,
      width: size.width, height: size.height, image: image.toString('base64'), busy,
      cursor: cursor && Date.now() - cursor.at < 8000 ? cursor : null };
  }
  function assertCurrent(expected) {
    if (busy || !active || active.isClosed() || !expected || expected.pageId !== pageId(active)
        || expected.url !== active.url() || expected.revision !== revision)
      throw new Error('Page changed; inspect a fresh frame before manual input');
  }
  return { page, before, after, frame, assertCurrent, failed: () => { busy = false; } };
}
