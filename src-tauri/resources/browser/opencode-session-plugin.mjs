// OpenCode's documented before-tool hook provides the real invoking session.
// Never infer ownership from whichever chat happens to be selected in Desktop.
import { browserSession } from './session.mjs';
export default async function browserSessionPlugin() {
  return {
    'tool.execute.before': async (input, output) => {
      if (!/^desktop_browser_browser_[a-z0-9_]+$/.test(input.tool)) return;
      output.args.__arvelaSession = browserSession({ engine: 'opencode', sessionID: input.sessionID });
    },
  };
}
