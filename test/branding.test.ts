import {expect,it} from 'vitest';
import fs from 'node:fs';
import {validateVersions} from '../scripts/releases/packet.mjs';
it('Enki package keeps the profile ABI while the signed bridge supports installed clients',()=>{
 const config=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
 const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
 expect(()=>validateVersions(process.cwd(),version)).not.toThrow();
 expect(config.identifier).toBe('dev.local.opencodedesktop');expect(config.productName).toBe('Arvela');
 expect(config.app.windows[0].title).toBe('Enki');expect(config.mainBinaryName).toBe('enki');
 expect(JSON.parse(fs.readFileSync('package.json','utf8')).name).toBe('enki');
 const plist=fs.readFileSync('src-tauri/Info.plist','utf8');
 expect(plist).toContain('<key>CFBundleDisplayName</key><string>Enki</string>');
 expect(plist).toContain('<key>NSMicrophoneUsageDescription</key>');
 expect(plist).toContain('<key>NSDocumentsFolderUsageDescription</key>');
});

it('bundled operator guidance uses Enki while old protocol readers remain explicit',()=>{
 for(const name of ['src-tauri/resources/workshop/AGENTS.md','src-tauri/resources/computer/SKILL.md','src-tauri/resources/browser/SKILL.md','src-tauri/resources/skills/create-shared-skill/SKILL.md']){
  const text=fs.readFileSync(name,'utf8');expect(text).not.toContain('Arvela');
 }
 expect(fs.readFileSync('src-tauri/resources/computer/SKILL.md','utf8')).toContain('name: enki-computer');
});
