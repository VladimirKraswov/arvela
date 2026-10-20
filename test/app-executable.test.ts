import {expect,it} from 'vitest';
import {sameAppExecutable} from '../src/util/appExecutable';
it('recognizes only the shipped migration family across absolute paths',()=>{
 expect(sameAppExecutable('/old/opencode-desktop','/new/enki')).toBe(true);
 expect(sameAppExecutable('/old/enki','/new/opencode-desktop')).toBe(true);
 expect(sameAppExecutable('\\\\old\\apps\\OPENCODE-DESKTOP.EXE','C:\\new\\enki.exe')).toBe(true);
 expect(sameAppExecutable('/old/other','/new/enki')).toBe(false);
 expect(sameAppExecutable('opencode-desktop','/new/enki')).toBe(false);
 expect(sameAppExecutable('/old/OPENCODE-DESKTOP','/new/enki')).toBe(false);
 expect(sameAppExecutable('/old/enki.exe','C:\\new\\enki.exe')).toBe(false);
 expect(sameAppExecutable('/old/enki-custom','/new/enki')).toBe(false);
});
