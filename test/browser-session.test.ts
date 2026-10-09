import {expect,it} from "vitest";
import plugin from "../src-tauri/resources/browser/opencode-session-plugin.mjs";
import {browserSession,sessionKey,stripSession} from "../src-tauri/resources/browser/session.mjs";
it("routes the actual invoking chat and leaves unrelated tools and arguments untouched",async()=>{
 const hook=(await plugin())["tool.execute.before"];
 const args={url:"https://example.test",__arvelaSession:{engine:"pi",sessionID:"wrong"}};
 await hook({tool:"desktop_browser_browser_navigate",sessionID:"ses_background"},{args});
 const routed=stripSession({name:"browser_navigate",arguments:args});
 expect(routed.session).toEqual({engine:"opencode",sessionID:"ses_background"});
 expect(routed.params.arguments).toEqual({url:"https://example.test"});
 const other={args:{command:"echo hello"}};
 await hook({tool:"bash",sessionID:"ses_other"},other);expect(other.args).toEqual({command:"echo hello"});
});
it("Pi metadata is removed before the official tool, preserving unrelated metadata",()=>{
 const input={name:"browser_snapshot",arguments:{},_meta:{arvelaSession:{engine:"pi",sessionID:"pi_session"},other:"keep"}};
 expect(stripSession(input)).toEqual({session:{engine:"pi",sessionID:"pi_session"},params:{name:"browser_snapshot",arguments:{},_meta:{other:"keep"}}});
 expect(input._meta.arvelaSession).toEqual({engine:"pi",sessionID:"pi_session"});
});
it("keeps engines, projects and chats independent and rejects invalid identity",()=>{
 const keys=[sessionKey("/a",{engine:"pi",sessionID:"same"}),sessionKey("/b",{engine:"pi",sessionID:"same"}),sessionKey("/a",{engine:"opencode",sessionID:"same"}),sessionKey("/a",{engine:"pi",sessionID:"other"})];
 expect(new Set(keys).size).toBe(4);
 for(const identity of [null,[],{}, {engine:"remote",sessionID:"a"},{engine:"pi",sessionID:"../a"},{engine:"pi",sessionID:""}]) expect(()=>browserSession(identity)).toThrow();
});
