// deepseek-up-T :: 替换/新增页面的**引用完整性**（离线、只读）
//
//   node test/assets.test.mjs
//
// 为什么要有它：`action: replace` 的素材是**手写的**，和 `action: patch` 完全不同 ——
// patch 的素材是原版那份文件（构建时逐字节核对过），改坏了锚点就命中不了；而 replace
// 的素材是「我写的这一份」，构建器只检查「这个条目确实和原版不同」，**不会检查它是不是
// 少了什么**。于是一页 HTML 可以一边通过字节核对（11 个条目按声明改了、其余逐字节一致），
// 一边引用着归档里根本不存在的脚本 —— 运行期只表现为一个 404 的 `<script>`，
// 界面上什么都不说。
//
// 这不是假想。T1 的 `renderer/welcome.html` 就是这么坏的：它是 DSH 的**登录/欢迎窗口**
// 页面，而替换素材漏掉了原版加载的 `../lib/welcome/welcome.js`（欢迎界面自己的 React 启动
// 脚本）和 `../lib/welcome/welcome.css`，还把 splash 控制器写成 `../lib/welcome/whale-splash.js`
// ——那个文件实际插入在 `renderer/whale-splash.js`。CSP 也少了 `font-src 'self'`。
// 三条都得靠**和原版比对**才发现，而字节核对没有这个视角。
//
// 所以这里立两条不变量（都对着归档里的真字节，不读工作区源码）：
//   A. 每个被 insert/replace 的 HTML，它引用的每个本地资源都必须在归档里存在；
//   B. 每个被 replace 的 HTML，**原版引用过的东西一样都不能丢**，CSP 也不许比原来更严。
// 另外用合成样例做反证：断言这两个检查函数真的会报错（否则「全绿」可能只是因为它们
// 什么都没查）。

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPatchDecl } from '../src/patchdecl.mjs';
import { listPatchDecls } from '../src/upgrade.mjs';
import { resolvePaths } from '../src/paths.mjs';
import { readAsarHeader, listAsarPaths, readAsarEntry } from '../src/asar.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = resolvePaths();
const STAGED = path.join(PROJECT_ROOT, 'state', 'staged', 'app.asar');

let bad = 0;
let skipped = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? `  ${extra}` : ''}`);
  if (!cond) bad += 1;
};
const skip = (name, why) => {
  console.log(`SKIP ${name}  ${why}`);
  skipped += 1;
};

// ── 归档读取（缓存表头与路径表：每个 121MB 归档的表头有几 MB，别反复读）──
const HEADERS = new Map();
const pathSets = new Map();
const headerOf = (archive) => {
  if (!HEADERS.has(archive)) HEADERS.set(archive, readAsarHeader(archive).header);
  return HEADERS.get(archive);
};
const pathSetOf = (archive) => {
  if (!pathSets.has(archive)) pathSets.set(archive, new Set(listAsarPaths(headerOf(archive))));
  return pathSets.get(archive);
};
const readTextEntry = (archive, entryPath) => {
  const buf = readAsarEntry(archive, entryPath);
  return buf === null ? null : buf.toString('utf8');
};

// ── 引用提取 ──
// 只认「本地文件引用」：带 scheme 的（http:/data:/dsh-app:）、锚点、协议相对一律不算。
const REF_RE = /(?:src|href)\s*=\s*["']([^"']*)["']/gi;
export function refs(text) {
  const out = new Set();
  for (const m of String(text).matchAll(REF_RE)) {
    const raw = m[1].trim();
    if (raw === '' || raw.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    if (raw.startsWith('//')) continue;
    out.add(raw.split('?')[0].split('#')[0]);
  }
  return out;
}

/** 把 HTML 里的相对引用解析成归档内的条目路径。 */
export function resolveRef(htmlPath, ref) {
  const base = path.posix.dirname(htmlPath);
  const joined = ref.startsWith('/') ? ref.slice(1) : `${base}/${ref}`;
  return path.posix.normalize(joined);
}

/** A：引用了归档里不存在的资源。 */
export function missingRefs(htmlPath, text, archivePaths) {
  const out = [];
  for (const ref of refs(text)) {
    const target = resolveRef(htmlPath, ref);
    if (!archivePaths.has(target)) out.push({ ref, target });
  }
  return out;
}

/** B：原版引用过、新版却没引用的本地资源。 */
export function droppedRefs(originalText, newText) {
  const have = refs(newText);
  return [...refs(originalText)].filter((r) => !have.has(r));
}

/** CSP 指令 → 源列表；用于「替换后不许比原来更严」。 */
export function cspOf(text) {
  // 属性值本身带引号（`content="default-src 'none'"`），所以必须「成对匹配到同一种引号」，
  // 不能用 `[^"']*` —— 那会在第一个 `'none'` 的内层单引号处截断。
  const m = /http-equiv=["']Content-Security-Policy["'][^>]*content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(String(text));
  if (!m) return null;
  const value = m[1] ?? m[2] ?? '';
  const map = new Map();
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    map.set(tokens[0].toLowerCase(), new Set(tokens.slice(1)));
  }
  return map;
}

/** C：新版 CSP 丢掉的原版指令 / 指令里的源。 */
export function loosenedCsp(originalText, newText) {
  const before = cspOf(originalText);
  const after = cspOf(newText);
  if (before === null) return [];
  if (after === null) return [{ directive: '(整条 CSP)', source: 'meta 不见了' }];
  const out = [];
  for (const [directive, sources] of before) {
    const now = after.get(directive);
    if (now === undefined) {
      out.push({ directive, source: '(整条指令不见了)' });
      continue;
    }
    for (const s of sources) if (!now.has(s)) out.push({ directive, source: s });
  }
  return out;
}

// 允许「替换时丢掉某个引用」的白名单：一行一个，必须写明理由。
// 空着是常态 —— 原版加载过的东西，替换版没有理由不加载。
const ALLOW_DROPPED = new Map();

// ── 准备：暂存包（没有就先构建一次）──
if (!fs.existsSync(STAGED)) {
  console.log(`暂存包不存在，先构建一次：${STAGED}`);
  const built = spawnSync(process.execPath, ['vendor/whale/build.mjs'], {
    cwd: PROJECT_ROOT, stdio: 'inherit',
  });
  if (built.status !== 0) {
    console.error('build.mjs 没能产出暂存包，后面的检查无法进行。');
    process.exit(1);
  }
}

const stagedPaths = pathSetOf(STAGED);
const haveBackup = fs.existsSync(P.asarBackup);
const backupPaths = haveBackup ? pathSetOf(P.asarBackup) : null;

console.log(`暂存包   ${fs.statSync(STAGED).size} 字节  ${stagedPaths.size} 个条目`);
console.log(`原版备份 ${haveBackup ? `${fs.statSync(P.asarBackup).size} 字节  ${backupPaths.size} 个条目` : '不存在（与替换前的比对会跳过）'}`);

// ── 收集声明 ──
const declFiles = listPatchDecls(P);
const decls = [];
for (const file of declFiles) {
  try {
    decls.push(readPatchDecl(file));
  } catch (e) {
    // L0 声明（只改 profile 里的 cordis.patch.yml）没有 target.entries，这里不适用。
    console.log(`（跳过 ${path.basename(file)}：${e.message}）`);
  }
}
const items = decls.flatMap((d) => d.items.map((it) => ({ ...it, declFile: d.file })));

// ── 1. 不变量 A：被改动的 HTML 引用的资源必须都在归档里 ──
console.log('\n── 1. 引用完整性（insert/replace 的 HTML）──');
const touchedHtml = items.filter((it) => /\.html$/i.test(it.path ?? '') && it.action !== undefined);
let refsChecked = 0;
let missingTotal = 0;
for (const it of touchedHtml) {
  const text = readTextEntry(STAGED, it.path);
  if (text === null) {
    check(`${it.path} 能在暂存包里读到`, false, `（声明为 ${it.action}，但归档里没有这个条目）`);
    missingTotal += 1;
    continue;
  }
  const all = [...refs(text)];
  const missing = missingRefs(it.path, text, stagedPaths);
  refsChecked += all.length;
  missingTotal += missing.length;
  const shown = all.map((r) => {
    const bad = missing.some((m) => m.ref === r);
    return `${bad ? '✗' : '✓'} ${r}${bad ? ` → ${resolveRef(it.path, r)}（不存在）` : ''}`;
  });
  check(
    `${it.path}（${it.action}）引用的 ${all.length} 个资源都存在`,
    missing.length === 0,
    `\n       ${shown.join('\n       ')}`,
  );
}
console.log(`    共检查 ${touchedHtml.length} 个页面、${refsChecked} 条引用`);

// ── 2. 不变量 B：replace 不许丢掉原版引用过的东西、也不许收紧 CSP ──
console.log('\n── 2. 替换页与原版的差集（只对 action: replace）──');
const replaced = items.filter((it) => it.action === 'replace' && /\.html$/i.test(it.path ?? ''));
let droppedTotal = 0;
let cspTotal = 0;
if (!haveBackup) {
  skip('替换页与原版比对', `原版备份不存在：${P.asarBackup}`);
} else {
  for (const it of replaced) {
    const before = backupPaths.has(it.path) ? readTextEntry(P.asarBackup, it.path) : null;
    const after = readTextEntry(STAGED, it.path);
    if (before === null) {
      check(`${it.path} 在原版备份里能读到`, false, '（找不到原文，无法比对「丢了什么」）');
      continue;
    }
    const dropped = droppedRefs(before, after).filter((r) => !ALLOW_DROPPED.has(`${it.path}:${r}`));
    const loosened = loosenedCsp(before, after);
    droppedTotal += dropped.length;
    cspTotal += loosened.length;
    check(`${it.path} 没丢掉原版引用过的资源`, dropped.length === 0, dropped.length ? `丢了：${dropped.join('、')}` : '');
    check(
      `${it.path} 的 CSP 不比原版更严`,
      loosened.length === 0,
      loosened.length ? `少了：${loosened.map((l) => `${l.directive} ${l.source}`).join('、')}` : '',
    );
  }
}

// ── 3. 反证：检查函数本身必须会报错（否则上面的「全绿」可能只是没查东西）──
console.log('\n── 3. 反证（合成的坏样例必须被抓住）──');
const fakePaths = new Set(['renderer/welcome.css', 'renderer/whale.css', 'lib/welcome/welcome.js']);
const fakeGood = '<link href="../lib/welcome/welcome.js"><link href="whale.css">';
check(
  'A 抓得住「引用了不存在的文件」',
  missingRefs('renderer/welcome.html', '<script src="../lib/welcome/whale-splash.js"></script>', fakePaths)
    .some((m) => m.target === 'lib/welcome/whale-splash.js'),
);
check('A 不误报「引用存在的文件」', missingRefs('renderer/welcome.html', fakeGood, fakePaths).length === 0);
check(
  'B 抓得住「替换页丢了原版加载的脚本」',
  droppedRefs('<script src="../lib/welcome/welcome.js"></script>', '<link href="whale.css">')
    .includes('../lib/welcome/welcome.js'),
);
check('B 不误报「都在」的情况', droppedRefs(fakeGood, fakeGood).length === 0);
check(
  'C 抓得住「CSP 少了一条指令」',
  loosenedCsp(
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src 'self'">`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'">`,
  ).some((l) => l.directive === 'font-src'),
);
check(
  'C 抓得住「CSP 少了一个源」',
  loosenedCsp(
    `<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline'">`,
    `<meta http-equiv="Content-Security-Policy" content="script-src 'self'">`,
  ).some((l) => l.source === "'unsafe-inline'"),
);
check(
  'C 不误报「变宽」（更宽不是问题）',
  loosenedCsp(
    `<meta http-equiv="Content-Security-Policy" content="script-src 'self'">`,
    `<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline'">`,
  ).length === 0,
);

// ── 4. 这次的具体回归：welcome.html 是一条真实修好的 bug，钉住它 ──
console.log('\n── 4. 钉住 T1 登录窗口那条（2026-10-06 修）──');

// 坏版本原文（当时真的被构建进暂存包的那一份）留在 test/fixtures/ 里，直接拿它喂给三条规则：
// 合成样例证明「规则会响」，这一份证明「就是这些规则没响才放它过去的」。
const BROKEN_FIXTURE = path.join(PROJECT_ROOT, 'test', 'fixtures', 'welcome-html-broken-before-2026-10-06.html');
if (!fs.existsSync(BROKEN_FIXTURE)) {
  check('坏版本证据文件还在', false, BROKEN_FIXTURE);
} else {
  const broken = fs.readFileSync(BROKEN_FIXTURE, 'utf8');
  const brokenRefs = refs(broken);
  const FIXTURE_SHA16 = '5BC23F972FCC30A6';
  const brokenSha = createHash('sha256').update(fs.readFileSync(BROKEN_FIXTURE)).digest('hex').slice(0, 16).toUpperCase();
  check(`证据文件确实是坏的那一份（sha256 ${FIXTURE_SHA16}）`, brokenSha === FIXTURE_SHA16, `实际 ${brokenSha}`);
  // 坏版本与真实归档放一起时，规则 A 必须报出那个 404 的脚本
  const brokenMissing = missingRefs('renderer/welcome.html', broken, stagedPaths);
  check(
    'A 会在坏版本上报出 lib/welcome/whale-splash.js 不存在',
    brokenMissing.some((m) => m.target === 'lib/welcome/whale-splash.js'),
    brokenMissing.map((m) => m.target).join('、'),
  );
  // 坏版本丢掉的正是原版那两个引用
  check('坏版本确实没引用 welcome.js', !brokenRefs.has('../lib/welcome/welcome.js'));
  check('坏版本确实没引用 welcome.css', !brokenRefs.has('../lib/welcome/welcome.css'));
  check('坏版本的 CSP 确实没有 font-src', !(cspOf(broken) ?? new Map()).has('font-src'));
  if (haveBackup) {
    const orig = readTextEntry(P.asarBackup, 'renderer/welcome.html');
    const droppedOnBroken = droppedRefs(orig, broken);
    const loosenedOnBroken = loosenedCsp(orig, broken);
    check(
      'B 会在坏版本上报出 2 条丢失的引用',
      droppedOnBroken.length >= 2,
      droppedOnBroken.join('、'),
    );
    check(
      'C 会在坏版本上报出 font-src 缺失',
      loosenedOnBroken.some((l) => l.directive === 'font-src'),
      loosenedOnBroken.map((l) => `${l.directive} ${l.source}`).join('、'),
    );
  } else {
    skip('坏版本与原版备份的比对', '原版备份不存在');
  }
}

const welcomeAfter = stagedPaths.has('renderer/welcome.html') ? readTextEntry(STAGED, 'renderer/welcome.html') : null;
if (welcomeAfter === null) {
  check('暂存包里有 renderer/welcome.html', false);
} else {
  const refsAfter = refs(welcomeAfter);
  for (const need of ['../lib/welcome/welcome.js', '../lib/welcome/welcome.css', '../lib/welcome/whale-animation.js']) {
    check(`welcome.html 仍然加载 ${need}`, refsAfter.has(need));
  }
  check('welcome.html 不再指向不存在的 ../lib/welcome/whale-splash.js', !refsAfter.has('../lib/welcome/whale-splash.js'));
  check('welcome.html 指向真实存在的 whale-splash.js', refsAfter.has('whale-splash.js'), `归档里有 renderer/whale-splash.js：${stagedPaths.has('renderer/whale-splash.js')}`);
  check('CSP 里仍有 font-src', (cspOf(welcomeAfter) ?? new Map()).has('font-src'));
}

// ── 5. 反空洞：确认这次检查确实覆盖到了东西 ──
console.log('\n── 5. 这次检查的覆盖面 ──');
check('检查了声明里的每一个 HTML（不少于 2 个）', touchedHtml.length >= 2, `实际 ${touchedHtml.length}`);
check('至少核对了 6 条引用', refsChecked >= 6, `实际 ${refsChecked}`);
check('至少有一个 action: replace 页面参与与原版比对', replaced.length >= 1 || !haveBackup, `实际 ${replaced.length}`);
if (!haveBackup) skip('replace 页面数量断言', '没有原版备份可比');

console.log(`\n${bad === 0 ? '全部通过' : `${bad} 条失败`}${skipped ? `（跳过 ${skipped} 项）` : ''}`);
process.exit(bad === 0 ? 0 : 1);
