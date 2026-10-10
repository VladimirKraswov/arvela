// Trusted pixel projection of the real browser. Remote HTML never enters the
// privileged Desktop WebView. No extra listener, exposed CDP or injected script.
export function createView(getContext) {
  let active;
  let cursor;
  let busy = false;
  let attached;
  let revision = 0;
  let observationEpoch = 0;
  let interruptionEpoch = 0;
  let navigationEpoch = 0;
  const screenshotStarts = new WeakMap();
  const watched = new WeakSet();
  let mode = 'fast';
  let size = { width: 1280, height: 800 };
  const observed = new WeakMap();
  const geometry = value => JSON.stringify([pageId(value), value.url(), value.viewportSize(), revision, observationEpoch]);
  const reads = new Set(['browser_snapshot', 'browser_take_screenshot', 'browser_console_messages', 'browser_network_requests']);
  const pointer = name => /^browser_mouse_.*_xy$/.test(name) || ['browser_mouse_down', 'browser_mouse_up'].includes(name);
  const humanTools = new Set([...reads, 'browser_close', 'browser_navigate', 'browser_navigate_back', 'browser_tabs',
    'browser_press_key', 'browser_keyboard_type', 'browser_mouse_down', 'browser_mouse_up', 'browser_mouse_wheel', 'browser_file_upload', 'browser_handle_dialog', 'browser_wait_for', 'browser_resize',
    'browser_mouse_click_xy', 'browser_mouse_move_xy', 'browser_mouse_drag_xy']);
  function policy(params, owner = 'agent') {
    if (owner !== 'agent' || mode !== 'human') return;
    if (!humanTools.has(params.name))
      throw Object.assign(new Error('Human mode: use a fresh screenshot, mouse coordinates and keyboard typing. DOM actions and code execution are disabled.'), { recovery: 'mode' });
  }
  function guard(client, params, owner = 'agent') {
    policy(params, owner);
    const args = params.arguments || {}, viewport = active.viewportSize() || size;
    const points = params.name === 'browser_mouse_drag_xy' ? [[args.startX, args.startY], [args.endX, args.endY]] : ('x' in args || 'y' in args) ? [[args.x, args.y]] : [];
    const outside = points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= viewport.width || y >= viewport.height);
    if (pointer(params.name) && (outside || (owner === 'agent' && observed.get(client) !== geometry(active))))
      throw Object.assign(new Error('Viewport or page changed. No input was sent. Use the fresh screenshot and its CSS pixel coordinates.'), { recovery: 'geometry' });
  }
  async function resize(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || width > 1920 || height < 240 || height > 1200)
      throw new Error('Invalid viewport');
    if (width === size.width && height === size.height) return;
    size = { width, height }; revision++; cursor = undefined;
    if (active && !active.isClosed()) await active.setViewportSize(size);
  }
  function setMode(value) {
    if (!['fast', 'human'].includes(value)) throw new Error('Invalid browser mode');
    if (mode !== value) { mode = value; revision++; cursor = undefined; }
  }
  const state = () => ({ mode, viewport: { ...size }, revision });
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
      context.on('page', value => { active = value; revision++; });
    }
    if (!active || active.isClosed()) active = context.pages().at(-1) || await context.newPage();
    if (!watched.has(active)) {
      watched.add(active);
      pageId(active);
      active.on('framenavigated', frame => { if (frame === active?.mainFrame()) { revision++; navigationEpoch++; } });
    }
    if (JSON.stringify(active.viewportSize()) !== JSON.stringify(size)) { revision++; cursor = undefined; await active.setViewportSize(size); }
    return active;
  }
  async function before(client, params, owner = 'agent', signal) {
    signal?.throwIfAborted();
    const current = await page();
    signal?.throwIfAborted();
    guard(client, params, owner);
    if (!reads.has(params.name) && !['browser_mouse_move_xy', 'browser_mouse_down', 'browser_wait_for'].includes(params.name) && !(params.name === 'browser_tabs' && params.arguments?.action === 'list')) {
      if (owner === 'agent') revision++;
      else {
        observationEpoch++;
        // A manual wheel changes every screen coordinate. Invalidate old
        // panel frames as well as agent observations, without invalidating
        // each character of an otherwise continuous manual typing burst.
        if (params.name === 'browser_mouse_wheel') { revision++; cursor = undefined; }
      }
    }
    if (selected.get(client) !== current) {
      // The official backend's tab list is initially empty until its first
      // context-using call. A read-only snapshot attaches it to our context.
      if (!selected.has(client)) {
        const initialized = await client.callTool({ name: 'browser_snapshot', arguments: {} }, undefined, { signal, timeout: 10000 });
        if (initialized.isError) throw new Error('Could not attach browser context');
      }
      signal?.throwIfAborted();
      const index = current.context().pages().indexOf(current);
      const result = await client.callTool({ name: 'browser_tabs', arguments: { action: 'select', index } }, undefined, { signal, timeout: 10000 });
      if (result.isError) throw new Error('Could not synchronize browser tab');
      signal?.throwIfAborted();
      selected.set(client, current);
    }
    if (params.name === 'browser_take_screenshot') screenshotStarts.set(client, geometry(current));
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
    if (active && !active.isClosed()) {
      selected.set(client, active);
      // Coordinates are meaningful only after observing the current viewport.
      if (params.name === 'browser_take_screenshot' && !result?.isError && !params.arguments?.fullPage && !params.arguments?.target && params.arguments?.scale === 'css' && screenshotStarts.get(client) === geometry(active)) observed.set(client, geometry(active));
      if (params.name === 'browser_resize') { size = active.viewportSize() || size; cursor = undefined; }
    }
  }
  async function frame(context, observedPageId) {
    if (!context) return { browserOpen: false, tabs: [], busy: false, mode };
    const pages = context.pages();
    if (!active || active.isClosed()) active = pages.at(-1);
    if (!active) return { browserOpen: true, tabs: [], busy, mode };
    const agentPage = active;
    const current = (observedPageId && pages.find(value => pageId(value) === observedPageId)) || active;
    const viewport = current.viewportSize() || { width: 1280, height: 800 };
    const size = { width: Math.min(viewport.width, 1920), height: Math.min(viewport.height, 1200) };
    const capturedRevision = revision, capturedUrl = current.url();
    const image = await current.screenshot({ type: 'jpeg', quality: 65, timeout: 2000, scale: 'css', clip: { x: 0, y: 0, ...size } });
    const tabs = await Promise.all(pages.map(async (value, index) => ({ index, id: pageId(value), url: value.url(), title: await value.title().catch(() => ''), active: value === agentPage })));
    const title = await current.title().catch(() => '');
    if (capturedRevision !== revision || capturedUrl !== current.url() || active !== agentPage || current.isClosed()) throw Object.assign(new Error('Frame changed during capture'), { frameChanged: true });
    return { browserOpen: true, mode, tabs, url: capturedUrl, title,
      pageId: pageId(current), revision: capturedRevision,
      width: size.width, height: size.height, image: image.toString('base64'), busy,
      cursor: current === agentPage && cursor && Date.now() - cursor.at < 8000 ? cursor : null };
  }
  function assertCurrent(expected) {
    if (busy || !active || active.isClosed() || !expected || expected.pageId !== pageId(active)
        || expected.url !== active.url() || expected.revision !== revision
        || (expected.width !== undefined && (expected.width !== active.viewportSize()?.width || expected.height !== active.viewportSize()?.height)))
      throw new Error('Page changed; inspect a fresh frame before manual input');
  }
  async function identity() { const current = await page(); return JSON.stringify([pageId(current), current.url(), current.viewportSize(), mode, interruptionEpoch, observationEpoch, navigationEpoch]); }
  return { identity, interrupt: (invalidate = true) => { interruptionEpoch++; if (invalidate) observationEpoch++; }, page, before, after, frame, assertCurrent, resize, setMode, state, policy, changed: () => { observationEpoch++; }, failed: () => { busy = false; } };
}
