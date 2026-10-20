import {it,expect,vi,afterEach} from 'vitest';
import * as platform from '../src/native/platform';
import * as integration from '../src/capabilities/integration';
afterEach(()=>vi.restoreAllMocks());
it('keeps optional MCP failure out of the blocking send error while reporting it to the user',async()=>{
 const {store}=await import('../src/state/store');
 vi.spyOn(platform,'isNative').mockReturnValue(true);
 const configure=vi.spyOn(integration,'configureShared').mockResolvedValue({unavailable:[{id:'web-compass',name:'Web Compass'}]});
 store.state={...store.state,directory:'/work',prefs:{...store.state.prefs,endpoint:'http://127.0.0.1:4096'},ui:{...store.state.ui,sendError:null}};
 await expect(store.configureSharedTools('/work')).resolves.toBeUndefined();
 expect(configure).toHaveBeenCalledTimes(1);
 expect(store.state.ui.toast).toContain('Web Compass');
 expect(store.state.ui.sendError).toBeNull();
 configure.mockRejectedValue(Error('unsafe config'));
 await expect(store.configureSharedTools('/work')).rejects.toThrow('unsafe config');
});
