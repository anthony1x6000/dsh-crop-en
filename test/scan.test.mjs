import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEntries, cjkLiterals, hasCjk, scan } from '../lib/scan.mjs';

test('hasCjk sees han characters and fullwidth punctuation', () => {
  assert.equal(hasCjk('plain ascii'), false);
  assert.equal(hasCjk('工作'), true);
  assert.equal(hasCjk('full！width'), true);
});

test('js scan reads quoted and template literals, skips comments', () => {
  const source = [
    "const a = '准备开工';",
    'const b = "收尾"; // 注释里的中文不算',
    '/* 块注释',
    "   中文也不算 */",
    'const c = `模板 ${x} 文本`;',
    "const d = 'it\\'s fine';",
  ].join('\n');
  const values = scan(source, 'js').literals.map((literal) => literal.raw);
  assert.deepEqual(values, ['准备开工', '收尾', '模板 ${x} 文本', "it\\'s fine"]);
  assert.equal(cjkLiterals(source, 'js').length, 3);
});

test('js scan masks literals and comments but keeps newlines', () => {
  const source = "const a = '工作';\n// 注释\nconst b = 1;\n";
  const { masked } = scan(source, 'js');
  assert.equal(masked.split('\n').length, source.split('\n').length);
  assert.equal(masked.includes('工作'), false);
  assert.equal(masked.includes('1'), true);
});

test('py scan reads single, double, triple-quoted and f-strings, skips comments', () => {
  const source = [
    'text = "健康度：%" + str(1)',
    "# 注释",
    "html = '''<h1>全局</h1>",
    "<!-- 中文注释 --></html>'''",
    "msg = f'共 {n} 条'",
    "q = '它\\'s'",
  ].join('\n');
  const values = scan(source, 'py').literals.map((literal) => literal.raw);
  assert.equal(values.length, 4);
  assert.equal(values[1].includes('全局'), true);
  assert.equal(cjkLiterals(source, 'py').length, 4);
});

test('applyEntries rewrites literal spans only, once per occurrence', () => {
  const source = "const a = '工作';\n// 工作\nconst b = '工作';\n";
  const { out, replaced, missing } = applyEntries(source, [['工作', 'work']], 'js');
  assert.equal(replaced, 2);
  assert.deepEqual(missing, []);
  assert.equal(out, "const a = 'work';\n// 工作\nconst b = 'work';\n");
});

test('applyEntries reports dictionary strings that are gone', () => {
  const { replaced, missing } = applyEntries("const a = 'x';\n", [['工作', 'work']], 'js');
  assert.equal(replaced, 0);
  assert.deepEqual(missing, ['工作']);
});

test('applyEntries does not touch a string that only appears in comments', () => {
  const source = "// '工作'\nconst a = 1;\n";
  const { replaced } = applyEntries(source, [['工作', 'work']], 'js');
  assert.equal(replaced, 0);
});

test('js scan keeps a template literal whole across interpolations with nested templates', () => {
  const source = "const a = `${x}${y ? ` · 卡 ${z}` : ''}`;\n";
  const values = scan(source, 'js').literals.map((literal) => literal.raw);
  assert.equal(values.length, 1);
  assert.ok(values[0].includes('卡'));
});

test('masking a nested template is stable across a translation', () => {
  const original = "const a = `${x}${y ? ` · 卡 ${z}` : ''}`;\n";
  const translated = "const a = `${x}${y ? ` · card ${z}` : ''}`;\n";
  assert.equal(scan(original, 'js').masked, scan(translated, 'js').masked);
});
