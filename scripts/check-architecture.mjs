import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const sources = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(name);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) sources.push(name);
  }
}
walk(path.join(root, 'src'));
const relative = file => path.relative(root, file).split(path.sep).join('/');
const graph = new Map();
const violations = [];
for (const file of sources) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const edges = [];
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typesOnly = clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings)
        && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly));
      if (!typesOnly) specifier = node.moduleSpecifier;
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && (!node.exportClause || !ts.isNamedExports(node.exportClause)
        || node.exportClause.elements.some(element => !element.isTypeOnly))) specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifier = node.arguments[0];
    }
    if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
      const base = path.resolve(path.dirname(file), specifier.text);
      const resolved = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]
        .find(candidate => sources.includes(candidate));
      if (resolved) edges.push(resolved);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(file, [...new Set(edges)]);
}
const checked = new Set();
function cycles(file, stack = []) {
  if (stack.includes(file)) {
    violations.push(`Runtime import cycle: ${[...stack.slice(stack.indexOf(file)), file].map(relative).join(' -> ')}`);
    return;
  }
  if (checked.has(file)) return;
  for (const dependency of graph.get(file) ?? []) cycles(dependency, [...stack, file]);
  checked.add(file);
}
for (const file of sources) cycles(file);
for (const [file, dependencies] of graph) {
  if (/^src\/(api|agent|util|attachments)\//.test(relative(file))) {
    for (const dependency of dependencies) {
      if (/^src\/(components|control|state\/store)(\/|\.)/.test(relative(dependency)))
        violations.push(`Lower layer imports application/UI: ${relative(file)} -> ${relative(dependency)}`);
    }
  }
}
if (violations.length) {
  console.error([...new Set(violations)].join('\n'));
  process.exitCode = 1;
} else console.log(`Architecture: ${sources.length} modules, no runtime cycles or reversed application dependencies.`);
