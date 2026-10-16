import assert from "node:assert/strict";
import ts from "typescript";

const verbs = new Set(["Get", "Post", "Put", "Patch", "Delete", "Head", "Options", "All"]);

/** Enforce response protection per Nest route, including aliases, without counting headers. */
export function assertClinicalRouteCacheHeaders(source, filename = "controller.ts") {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, `${filename}: cannot inspect invalid TypeScript`);
  const aliases = new Map(), namespaces = new Set();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "@nestjs/common") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) aliases.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text);
    } else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  const nameOf = call => ts.isIdentifier(call.expression) ? aliases.get(call.expression.text) ?? call.expression.text
    : ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression) && namespaces.has(call.expression.expression.text)
      ? call.expression.name.text : null;
  const routes = [];
  const visit = node => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const calls = (ts.getDecorators(member) ?? []).map(decorator => decorator.expression).filter(ts.isCallExpression);
      const methods = calls.map(nameOf).filter(name => verbs.has(name));
      if (!methods.length) continue;
      const protectedResponse = calls.some(call => nameOf(call) === "Header" && call.arguments.length === 2
        && ts.isStringLiteralLike(call.arguments[0]) && call.arguments[0].text.toLowerCase() === "cache-control"
        && ts.isStringLiteralLike(call.arguments[1]) && call.arguments[1].text === "no-store, private");
      routes.push({ handler: `${node.name?.text ?? "anonymous"}.${member.name.getText(file)}`, methods, protectedResponse });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(routes.length, `${filename}: no HTTP route handlers found`);
  const missing = routes.filter(route => !route.protectedResponse).map(route => `${route.handler} (${route.methods.join(", ")})`);
  assert.deepEqual(missing, [], `${filename}: each clinical route needs @Header("Cache-Control", "no-store, private"): ${missing.join("; ")}`);
  return routes;
}
