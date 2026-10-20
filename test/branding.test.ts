import {expect,it} from 'vitest';
import fs from 'node:fs';
import {validateVersions} from '../scripts/releases/packet.mjs';
it('Enki display branding keeps the package identity accepted by installed update clients',()=>{
 const config=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
 const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
 expect(()=>validateVersions(process.cwd(),version)).not.toThrow();
 expect(config.identifier).toBe('dev.local.opencodedesktop');expect(config.productName).toBe('Arvela');
 expect(config.app.windows[0].title).toBe('Enki');
 const plist=fs.readFileSync('src-tauri/Info.plist','utf8');
 expect(plist).toContain('<key>CFBundleDisplayName</key><string>Enki</string>');
 expect(plist).toContain('<key>NSMicrophoneUsageDescription</key>');
 expect(plist).toContain('<key>NSDocumentsFolderUsageDescription</key>');
});
