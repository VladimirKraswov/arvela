import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import cpp from 'highlight.js/lib/languages/cpp';
import java from 'highlight.js/lib/languages/java';
import swift from 'highlight.js/lib/languages/swift';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import markdown from 'highlight.js/lib/languages/markdown';
for (const [name, grammar] of Object.entries({javascript, typescript, python, bash, json, css, xml, yaml, sql, rust, go, cpp, java, swift, diff, ini, markdown})) hljs.registerLanguage(name, grammar);
hljs.registerAliases(['sh','shell','zsh'],{languageName:'bash'});
hljs.registerAliases(['tsx'],{languageName:'typescript'});
hljs.registerAliases(['jsx'],{languageName:'javascript'});
export const escapeCode = (code:string) => code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
/** No auto-detection on streamed/untrusted text; large blocks remain responsive plain text. */
export function highlightCode(code:string, language:string):string {
  if (code.length > 40000 || !language || !hljs.getLanguage(language)) return escapeCode(code);
  try { return hljs.highlight(code,{language,ignoreIllegals:true}).value; } catch { return escapeCode(code); }
}
