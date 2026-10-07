import { expect, it, vi } from "vitest";
import { actionTools, compactResult, createActions, createMetrics } from "../src-tauri/resources/browser/actions.mjs";
function fixture() {
  let identity = "page1";
  const call = vi.fn(async () => ({ content: [{ type: "text", text: "snapshot" }] }));
  const validate = vi.fn();
  const runtime = createActions({call, validate, identity: async () => identity});
  return {runtime,call,validate, change: () => { identity = "page2"; }};
}
const keyboard = {tool:"browser_keyboard_type",arguments:{text:"fixture"}};
it("combines action, text wait and final observation once", async () => {
  const f = fixture(); const result = await f.runtime.run("browser_action", {step:keyboard,waitFor:{text:"Saved"}});
  expect(f.call.mock.calls.map(([p]) => p.name)).toEqual(["browser_keyboard_type","browser_wait_for","browser_snapshot"]);
  expect(result.structuredContent).toMatchObject({completed:1,total:1,noReplay:true});
});
it("validates the whole sequence before sending any input", async () => {
  const f = fixture(); f.validate.mockImplementation(() => {throw Error("Invalid last step");});
  await expect(f.runtime.run("browser_sequence", {steps:[keyboard,{tool:"browser_evaluate",arguments:{}}]})).rejects.toThrow();
  expect(f.call).not.toHaveBeenCalled();
});
it("stops before another step on a shared input/navigation/viewport interrupt", async () => {
  const f = fixture(); f.call.mockImplementationOnce(async () => { f.change(); return {content:[]}; });
  const result = await f.runtime.run("browser_sequence", {steps:[keyboard,keyboard]});
  expect(f.call.mock.calls.map(([p]) => p.name)).toEqual(["browser_keyboard_type","browser_snapshot"]);
  expect(result).toMatchObject({isError:true,structuredContent:{completed:1,reason:"interrupted",uncertainLastAction:false}});
});
it("never replays a failed input and distinguishes uncertain delivery", async () => {
  const f = fixture(); f.call.mockRejectedValueOnce(Error("Transport failed after input"));
  const result = await f.runtime.run("browser_sequence", {steps:[keyboard,keyboard]});
  expect(f.call.mock.calls.map(([p]) => p.name)).toEqual(["browser_keyboard_type","browser_snapshot"]);
  expect(result.structuredContent).toMatchObject({completed:0,reason:"action",uncertainLastAction:true});
});
it("refreshes the CSS screenshot when a geometry guard refuses input", async () => {
  const f = fixture(); f.call.mockRejectedValueOnce(Object.assign(Error("stale"),{recovery:"geometry"}));
  const result = await f.runtime.run("browser_action",{step:keyboard});
  expect(f.call.mock.calls[1][0]).toEqual({name:"browser_take_screenshot",arguments:{scale:"css",type:"png"}});
  expect(result.structuredContent).toMatchObject({reason:"geometry",uncertainLastAction:false,completed:0});
});
it("already aborted requests do not execute input or a fallback observation", async () => {
  const f = fixture(), cancel = new AbortController(); cancel.abort();
  const result = await f.runtime.run("browser_sequence",{steps:[keyboard]},cancel.signal);
  expect(result.structuredContent.reason).toBe("deadline"); expect(f.call).not.toHaveBeenCalled();
});
it("marks truncation and removes replay code while retaining current references", () => {
  const result = compactResult({content:[{type:"text",text:"### Ran Playwright code\nsecret replay\n### Snapshot\nbutton [ref=e5]\n"+"x".repeat(3000)}]},1000);
  expect(result.content[0].text).not.toContain("secret replay"); expect(result.content[0].text).toContain("[ref=e5]");
  expect(result.content[0].text.length).toBe(1000); expect(result.structuredContent.observationTruncated).toBe(true);
});
it("records numeric telemetry only, bounded regardless of request count", () => {
  const metrics = createMetrics(); for (let i=0;i<1000;i++) metrics.record({queueMs:2,actionMs:3,observeMs:4,completedSteps:1,url:"secret",password:"secret"});
  expect(metrics.snapshot()).toMatchObject({calls:1000,queueMs:2000,actionMs:3000,observeMs:4000,completedSteps:1000});
  expect(JSON.stringify(metrics.snapshot())).not.toContain("secret"); expect(JSON.stringify(metrics.snapshot()).length).toBeLessThan(400);
});
it("composition schemas stay compact instead of duplicating all official schemas", () => {
  const tools = actionTools([{name:"browser_click",inputSchema:{description:"x".repeat(100000)}}]);
  expect(JSON.stringify(tools).length).toBeLessThan(6000);
});

it("does not report successful verification when aborted just after the last input", async () => {
  const f=fixture(), cancel=new AbortController();
  f.call.mockImplementationOnce(async () => {cancel.abort("interrupted"); return {content:[]};});
  const result=await f.runtime.run("browser_action",{step:keyboard},cancel.signal);
  expect(result).toMatchObject({isError:true,structuredContent:{completed:1,reason:"interrupted",noReplay:true}});
  expect(f.call).toHaveBeenCalledOnce();
});
it("compact observations do not retain a duplicate unbounded structured snapshot", () => {
  const result=compactResult({content:[{type:"text",text:"snapshot"}],structuredContent:{snapshot:"x".repeat(100000)}});
  expect(JSON.stringify(result).length).toBeLessThan(1000);
});
