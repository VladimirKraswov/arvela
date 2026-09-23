import {expect,it} from "vitest";
import {computerConfig,computerReadinessError,isLocalComputer,type ComputerStatus} from "../src/state/computer";
import {parseConfig} from "../src/state/configEditor";
const status:ComputerStatus={installed:true,enabled:false,version:"fixture",command:"/Applications/OpenCode Desktop.app/Contents/MacOS/opencode-desktop",skillPath:"/Users/fixture/.local/share/opencode-desktop/computer/skill",permissions:{}};
it("never treats an MCP transport connection as ready after driver revocation",()=>{
  expect(computerReadinessError({...status,enabled:true,permissions:{status:"refused",refusal:{code:"authorization_suspended"}}})).toContain("экстренной остановкой");
  expect(computerReadinessError({...status,enabled:true,permissions:{accessibility:true,screen_recording:false}})).toContain("не подтвердил");
  expect(computerReadinessError({...status,enabled:true,permissions:{accessibility:true,screen_recording:true}})).toBeUndefined();
});
it("preserves comments, models, credentials, permissions and other MCP servers",()=>{
  const source='// keep\n{"model":"local/next","provider":{"local":{"options":{"apiKey":"fixture"}}},"permission":{"bash":"ask"},"mcp":{"existing":{"type":"remote","url":"https://example.test"}},"skills":{"paths":["/old/skills"]}}';
  const next=computerConfig(source,status,true);expect(next.content).toContain('// keep');
  const config=parseConfig(next.content),old=parseConfig(source);
  for(const key of ["model","provider","permission"])expect(config[key]).toEqual(old[key]);
  expect((config.mcp as any).existing).toEqual((old.mcp as any).existing);
  expect((config.skills as any).paths).toEqual(["/old/skills",status.skillPath]);
  expect(next.config.command).toEqual([status.command,"--computer-mcp"]);
});
it("updates only its own MCP entry and never duplicates the skill",()=>{
  const once=computerConfig("{}",status,true).content;
  expect((parseConfig(computerConfig(once,status,true).content).skills as any).paths).toEqual([status.skillPath]);
  expect(computerConfig(once,status,false).config.enabled).toBe(false);
  expect(()=>computerConfig('{"mcp":{"cua_desktop":{"type":"remote","url":"https://example.test"}}}',status,true)).toThrow("занято");
});
it("does not register Mac commands in a remote OpenCode server",()=>{
  expect(isLocalComputer("http://127.0.0.1:4096",false)).toBe(true);
  expect(isLocalComputer("http://127.0.0.1:4501",true)).toBe(false);
  expect(isLocalComputer("http://192.168.31.10:4096",false)).toBe(false);
});
