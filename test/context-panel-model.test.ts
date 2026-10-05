import { expect, it } from "vitest";
import { projectFile, sessionContext } from "../src/state/taskContext";
import { emptySessionChat } from "../src/state/chatReducer";
it("uses actual source attachments and completed outputs, deduplicates paths and ignores incomplete writes", () => {
 const chat=emptySessionChat(); chat.messageOrder=["u","a"];
 chat.messages.u={id:"u",sessionID:"s",role:"user",time:{created:1}};
 chat.messages.a={id:"a",sessionID:"s",role:"assistant",time:{created:2}};
 chat.partsByMessage={u:["f"],a:["w","t","r","x"]};
 chat.parts={f:{id:"f",messageID:"u",sessionID:"s",type:"file",filename:"source.pdf",mime:"application/pdf"},
 w:{id:"w",messageID:"a",sessionID:"s",type:"tool",tool:"write",state:{status:"completed",input:{filePath:"/project/report.md"}}},
 t:{id:"t",messageID:"a",sessionID:"s",type:"text",text:"[Report](/project/report.md) [Other](https://example.com)"},
 r:{id:"r",messageID:"a",sessionID:"s",type:"tool",tool:"write",state:{status:"running",input:{filePath:"/project/pending.txt"}}},
 x:{id:"x",messageID:"a",sessionID:"s",type:"file",filename:"assistant.json"}};
 const context=sessionContext(chat);expect(context.sources.map(x=>x.name)).toEqual(["source.pdf"]);expect(context.results.map(x=>x.path)).toEqual(["/project/report.md"]);
});
it("never previews traversal, sibling directories or unrelated absolute files through the project API",()=>{
 expect(projectFile("../private/key","/project")).toBeNull();expect(projectFile("/project-other/key","/project")).toBeNull();
 expect(projectFile("src/main.ts","/project")).toBe("src/main.ts");expect(projectFile("C:\\Work\\src\\a.ts","C:\\Work")).toBe("src/a.ts");
});
it("does not manufacture context for an empty or unloaded chat",()=>expect(sessionContext()).toEqual({sources:[],results:[]}));
