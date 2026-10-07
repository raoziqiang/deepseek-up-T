// deepseek-up-T :: 体检
//
// 目的：回答「现在这台机器上的 DSH 处于什么状态、能不能安全地改」。
// 本模块只读——除了可选的 tasklist / node --version 子进程外，不触碰任何文件。

import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  resolvePaths, exists, statOrNull, readText, readJson, sha256, human,
} from './paths.mjs';
import { scanPatch, isEmptyArray, looksLikePackage } from './cordis.mjs';
import { readAsarHeader, asarPackageIndex, asarStats } from './asar.mjs';
import { stagedFacts, stagedLine } from './staged.mjs';

export const GROUPS = ['环境', '组合层', '运行时', '解析', '安装包'];

/** 进程还在不在。`kill(pid, 0)` 不发信号，只做存在性/权限检查；EPERM 也算「在」。 */
function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  try { process.kill(n, 0); return true; } catch (err) { return err?.code === 'EPERM'; }
}

/** 粗粒度时长，只为人类可读，不参与任何判断。 */
function humanAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} 小时 ${m % 60} 分钟`;
  return `${Math.floor(h / 24)} 天`;
}

function probeProcess() {
  if (process.platform !== 'win32') return { supported: false };
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH'],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 },
    );
    return { supported: true, running: /deepseek harness\.exe/i.test(out) };
  } catch (err) {
    return { supported: true, running: null, error: String(err.message ?? err) };
  }
}

function probeNodeVersion(bin) {
  try {
    return execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
  } catch {
    return null;
  }
}

export async function runDoctor({ hash = true } = {}) {
  const P = resolvePaths();
  const checks = [];
  const LEVELS = new Set(['error', 'warn', 'info']);
  const add = (group, id, level, ok, detail, hint) => {
    // 位置参数容易错位，这里让错位立刻炸出来，而不是静默把提示文本当成结论。
    if (!LEVELS.has(level)) {
      throw new Error(`doctor 内部错误：检查项「${id}」的 level 非法（收到 ${JSON.stringify(level)}）`);
    }
    checks.push({ group, id, level, ok: Boolean(ok), detail, hint });
  };

  // ───────────────────────── 环境 ─────────────────────────
  add('环境', 'DSH_HOME', 'error', exists(P.home), P.home,
    'DSH_HOME 指向的目录不存在，DSH 尚未在本机初始化过。');

  const profileDirOk = exists(P.profileDir);
  add('环境', 'profile 目录', 'error', profileDirOk, P.profileDir,
    `profile "${P.profile}" 目录不存在。检查 DSH_PROFILE / DSH_PROFILE_DIR。`);

  add('环境', 'profile 版本文件', 'info', exists(P.versionFile),
    exists(P.versionFile) ? `Harness ${readText(P.versionFile)?.trim()}` : '未找到 version 文件', null);

  const nodeOk = exists(P.bundledNode);
  add('环境', '内置 Node', 'error', nodeOk,
    nodeOk ? `${probeNodeVersion(P.bundledNode) ?? '版本未知'}  ${P.bundledNode}` : P.bundledNode,
    'DSH 内置运行时缺失，插件安装/脚本执行可能失败。');

  // ───────────────────────── 组合层 ─────────────────────────
  const cordisYmlText = readText(P.cordisYml);
  if (cordisYmlText === null) {
    add('组合层', 'cordis.yml', 'error', false, '文件不存在', 'profile 根文件缺失，DSH 无法组合。');
  } else {
    const empty = isEmptyArray(cordisYmlText);
    add('组合层', 'cordis.yml 保持空数组', 'error', empty,
      empty ? '顶层为 []，符合约定' : '顶层不是 []，有人往里面写了东西',
      '协议要求：所有意图写进 cordis.patch.yml，cordis.yml 必须保持 []。');
  }

  const patchText = readText(P.cordisPatch);
  let patchScan = null;
  if (patchText === null) {
    add('组合层', 'cordis.patch.yml', 'error', false, '文件不存在', '个人改造层缺失。');
  } else {
    add('组合层', 'cordis.patch.yml', 'info', true, `${human(Buffer.byteLength(patchText))}  ${P.cordisPatch}`, null);
    patchScan = scanPatch(patchText);

    add('组合层', 'patch 顶层为数组', 'error', patchScan.isArray,
      patchScan.isArray ? `是（${patchScan.entries.length} 个条目）` : '顶层不是 YAML 数组',
      'patch 层必须是一个顶层 YAML 数组（每项以 "- " 开头）。',
    );

    add('组合层', '无 Tab 缩进', 'error', patchScan.tabLines.length === 0,
      patchScan.tabLines.length === 0 ? '未发现 Tab'
        : `第 ${patchScan.tabLines.slice(0, 10).join(', ')} 行含 Tab`,
      'YAML 禁止用 Tab 缩进，必须用空格。');

    add('组合层', '条目 id 无重复', 'error', patchScan.duplicateIds.length === 0,
      patchScan.duplicateIds.length === 0 ? '无重复 id'
        : `重复 id：${patchScan.duplicateIds.join(', ')}`,
      '同一 id 在 patch 层出现多次时只有最后一次生效，通常是误合并造成的。');

    add('组合层', '!!js 表达式', 'info', true, `${patchScan.jsTagCount} 处`, null);

    const missingId = patchScan.entries.filter((e) => !e.id);
    add('组合层', '每个条目都有 id', 'warn', missingId.length === 0,
      missingId.length === 0 ? '全部有条目 id' : `${missingId.length} 个条目缺 id（行 ${missingId.map((e) => e.line).join(', ')}）`,
      '没有 id 的条目无法被后续层按 id 覆盖，也难以维护。');
  }

  // ───────────────────────── 运行时（我们自己写的 L1 插件） ─────────────────────────
  //
  // 这一段存在的理由：`doctor` 原本只能回答「文件在不在、配置合不合法」，全都是**静态**事实。
  // 而 L1 插件最容易出的问题恰恰在运行时——插件装好了但 profile 没重启、重启了但插件抛错、
  // 或者加载了但客户端脚本 404（那条路径被刻意设计成静默失败）。心跳文件把「加载了吗」
  // 从「肉眼看界面」变成一条可核对的文件事实。
  const beatText = readText(P.pluginHeartbeat);
  if (beatText === null) {
    add('运行时', 'T4 插件 dsh-up-t 心跳', 'info', true,
      '还没有心跳文件',
      `预期行为：dsh-up-t 装好后必须**重启 Harness** 才会加载；加载时它会在 ${P.pluginHeartbeat} 落一枚心跳。`
      + '重启后这里会变成 OK 并显示加载时间与进程号。');
  } else {
    let beat = null;
    try { beat = JSON.parse(beatText); } catch { beat = null; }
    if (!beat || typeof beat !== 'object') {
      add('运行时', 'T4 插件 dsh-up-t 心跳', 'warn', false,
        `${P.pluginHeartbeat} 存在但内容不是合法 JSON`,
        '删掉这个文件并重启 Harness，让插件重写它。');
    } else {
      const alive = beat.pid ? pidAlive(beat.pid) : null;
      const ageMs = beat.at ? Date.now() - Date.parse(beat.at) : null;
      const age = Number.isFinite(ageMs) ? `（${humanAge(ageMs)}前）` : '';
      // `stage` 是这次加载「走到哪一步」的结论。**「加载了」和「能用」是两件事**：插件可以
      // 加载成功、apply() 跑完、然后卡在等 webServer 上 —— 那时界面里什么都没有，却没有一条报错。
      // 旧版本的心跳没有 stage 字段，那时一律当「未知」，绝不当作「没就绪」：
      // 把「我手里没有这条信息」说成「你坏了」是最糟的一种诊断错误。
      const stage = typeof beat.stage === 'string' ? beat.stage : null;
      const routeCount = Array.isArray(beat.routes) ? beat.routes.length : null;
      // 握手 = 渲染层自己报的「这段脚本真的跑起来了」。宿主就绪而握手缺失，说明断点在**投递**上
      // （注入行没被收集 / bundle 在渲染层加载失败），而不是宿主半侧 —— 这两者都不报错。
      const seenVia = beat.client && typeof beat.client.sources === 'object' && beat.client.sources
        ? Object.keys(beat.client.sources).sort() : [];
      const seenText = seenVia.length ? ` · 渲染层已握手（${seenVia.join('+')}）` : '';
      const head = `${beat.plugin ?? '?'} ${beat.version ?? '?'} · ${beat.at ?? '时间未知'}${age} · pid ${beat.pid ?? '?'}`;
      const seenPart = seenVia.length ? seenText
        : (stage === 'ready' ? ' · 还没有渲染层握手' : '');
      const step = stage === 'ready'
        ? ` · 服务已就绪${routeCount !== null ? `（路由 ${routeCount} 条）` : ''}${seenPart}`
        : stage === 'apply' ? ' · 只走到 apply()' : ' · 心跳没有 stage 字段（旧版本写的）';
      if (alive === false) {
        add('运行时', 'T4 插件 dsh-up-t 心跳', 'warn', false,
          `${head}  ← 该进程已经不在了`,
          '这枚心跳来自一个**已经退出**的进程：说明插件当时确实加载过，但当前 Harness 进程是另一个（心跳没被刷新）。'
          + '如果你刚重启完还是这种状态，说明插件这次没被加载 —— 去 .plugin-manager/logs 找报错。');
      } else if (stage === 'apply') {
        add('运行时', 'T4 插件 dsh-up-t 心跳', 'warn', false,
          `${head}${step}`,
          '插件被加载了、`apply()` 也跑完了，但之后**没有走到 ready** —— 也就是 `webServer` 这个依赖一直没就绪：'
          + '路由没注册，界面里既不会有胶囊也不会有设置页，而且不会有任何报错。'
          + `去看 .plugin-manager/logs 里有没有加载错误；心跳本身在 ${P.pluginHeartbeat}。`);
      } else if (stage === 'ready' && !seenVia.length) {
        add('运行时', 'T4 插件 dsh-up-t 心跳', 'warn', false,
          `${head}${step}`,
          `宿主半侧已经就绪（路由已注册${routeCount !== null ? `：${routeCount} 条` : ''}），但**渲染层还没有握手** —— 浏览器里那段脚本还没跑起来。`
          + '桌面形态下这意味着注入行没被收集、或客户端脚本在渲染层加载失败（**两种都不报错**）；'
          + '刚启动的头几秒、以及无界面形态下出现这一条是正常的，可以先等一下再跑一次。');
      } else {
        add('运行时', 'T4 插件 dsh-up-t 心跳', 'warn', true, `${head}${step}`, null);
      }
    }
  }

  // ───────────────────────── 安装包（先读头，解析检查要用） ─────────────────────────
  let asarIndex = null;
  let asarStatsValue = null;
  let asarBytes = null;
  let asarHash = null;

  const asarStat = statOrNull(P.asar);
  if (!asarStat) {
    add('安装包', 'app.asar', 'error', false, P.asar, '找不到安装包，DSH_INSTALL_DIR 可能不对。');
  } else {
    asarBytes = asarStat.size;
    try {
      const { header, jsonLen } = readAsarHeader(P.asar);
      asarIndex = asarPackageIndex(header);
      asarStatsValue = asarStats(header);
      add('安装包', 'app.asar 头可解析', 'error', true,
        `头 ${human(jsonLen)}，条目 ${asarStatsValue.files} 文件 / ${asarStatsValue.dirs} 目录`,
        null);
    } catch (err) {
      add('安装包', 'app.asar 头可解析', 'error', false, String(err.message ?? err),
        '安装包已损坏或被截断，考虑用 .whale-backup 恢复。');
    }
    if (hash) {
      try { asarHash = await sha256(P.asar); } catch { /* 忽略 */ }
    }
    add('安装包', 'app.asar 大小', 'info', true,
      `${human(asarBytes)}（${asarBytes} 字节）${asarHash ? `  sha256:${asarHash.slice(0, 16)}` : ''}`, null);
  }

  const backupStat = statOrNull(P.asarBackup);
  if (!backupStat) {
    add('安装包', '原版备份', 'warn', false, '未找到 app.asar.whale-backup',
      '没有原版副本就无法一键回滚安装包层改造。建议立刻备份一份 app.asar。');
  } else {
    let same = null;
    if (hash && asarHash) {
      try { same = (await sha256(P.asarBackup)) === asarHash; } catch { same = null; }
    }
    const sizeSame = asarBytes !== null && backupStat.size === asarBytes;
    const verdict = same === null
      ? (sizeSame ? '大小相同（未比对内容）' : `大小不同：备份 ${human(backupStat.size)} vs 当前 ${human(asarBytes)}`)
      : (same ? '内容与当前 app.asar 完全一致' : '内容与当前 app.asar 不同');
    add('安装包', '原版备份可比对', 'info', Boolean(backupStat), verdict,
      '备份与当前一致 ⇒ 当前安装包是未改造的原版。');
  }

  const tmpStat = statOrNull(P.asarTmp);
  add('安装包', '无残留 app.asar.tmp', 'warn', !tmpStat,
    tmpStat ? `残留 ${human(tmpStat.size)}（${P.asarTmp}）` : '无残留',
    '残留通常是上次重打包未落盘。DSH 运行时占用会阻止替换，需先退出 Harness 再落盘。');

  // 暂存产物：回答「我改的东西构建出来了没有、落盘了没有」。
  // 这一条曾经只存在于人的记忆里 —— 一份含重播修复的暂存包在磁盘上等了一整天，
  // 而报告里一个字都没说（它比的是「在用安装包 vs 原版备份」，暂存包根本不在比较里）。
  // 判定表在 src/staged.mjs，与左下角胶囊/设置页那份**逐字相同**（有对照测试钉住）。
  const staged = stagedFacts(P);
  if (!exists(P.stagedFile)) {
    add('安装包', '暂存包', 'info', true, '还没构建过（state/staged/app.asar 不存在）',
      '改完声明后 `node vendor/whale/build.mjs`，或 `dsht upgrade --stage`。');
  } else if (staged.status === 'pending') {
    add('安装包', '暂存包', 'info', true, stagedLine(staged),
      '落盘要先把 Harness 完全退出（托盘 → Quit）：node vendor/whale/install.mjs --yes');
  } else if (staged.status === 'behind') {
    add('安装包', '暂存包', 'warn', false, stagedLine(staged),
      '先重新构建（node vendor/whale/build.mjs）再落盘 —— 拿旧产物落盘会把后来的修复冲掉。');
  } else {
    // same-size / differs / unavailable 都是「说不了更多」的状态，照实说，不许升级成结论。
    add('安装包', '暂存包', 'info', true, stagedLine(staged), null);
  }

  const proc = probeProcess();
  if (!proc.supported) {
    add('安装包', 'Harness 进程', 'info', true, '非 Windows，跳过', null);
  } else if (proc.running === null) {
    add('安装包', 'Harness 进程', 'info', true, `无法判定（${proc.error}）`, null);
  } else {
    add('安装包', 'Harness 进程', 'info', true,
      proc.running ? '正在运行（含托盘）' : '未运行',
      proc.running ? '此刻无法替换 app.asar；改安装包层前必须退出 Harness 及托盘进程。' : null);
  }

  // ───────────────────────── 解析 ─────────────────────────
  const resolvers = [
    { label: 'profile', dir: P.profileModules },
    { label: 'host', dir: P.hostModules },
  ];
  const resolvePackage = (name) => {
    for (const r of resolvers) {
      const pj = path.join(r.dir, name, 'package.json');
      if (exists(pj)) return r.label;
      if (exists(path.join(r.dir, name))) return `${r.label}(缺 package.json)`;
    }
    if (asarIndex?.has(name)) return 'asar';
    return null;
  };

  if (profileDirOk) {
    const pkg = readJson(P.profilePackageJson);
    const bundles = pkg?.dsh?.profile?.bundles;
    if (!Array.isArray(bundles)) {
      add('解析', 'profile bundles 可读', 'warn', false,
        'package.json 里没有 dsh.profile.bundles 数组', 'profile 可能不是标准结构。');
    } else {
      const resolved = bundles.map((b) => ({ b, where: resolvePackage(b) }));
      const missing = resolved.filter((r) => !r.where);
      const onlyAsar = resolved.filter((r) => r.where === 'asar');
      add('解析', 'bundles 全部可解析', 'error', missing.length === 0,
        missing.length === 0
          ? `${bundles.length} 个 bundle 全部可解析`
          : `缺失 ${missing.length} 个：${missing.map((m) => m.b).join(', ')}`,
        '缺失的 bundle 会让对应能力静默消失。用 pnpm 在 profile 目录重新安装。');
      if (onlyAsar.length) {
        add('解析', '仅安装包提供的 bundle', 'warn', false,
          onlyAsar.map((r) => r.b).join(', '),
          '这些 bundle 只存在于 app.asar 内：随 Harness 版本走，无法单独升级。');
      }
    }
  }

  if (patchScan) {
    const names = [...new Set(patchScan.entries.map((e) => e.name).filter(looksLikePackage))];
    const resolved = names.map((n) => ({ n, where: resolvePackage(n) }));
    const missing = resolved.filter((r) => !r.where);
    const onlyAsar = resolved.filter((r) => r.where === 'asar');
    add('解析', 'patch 引用的包可解析', 'error', missing.length === 0,
      missing.length === 0
        ? `${names.length} 个包全部可解析`
        : `缺失 ${missing.length} 个：${missing.map((m) => m.n).join(', ')}`,
      'patch 指向一个不存在的包时，该条目不会生效（可能只留一条日志）。');
    if (onlyAsar.length) {
      add('解析', 'patch 中仅安装包提供的包', 'warn', false,
        onlyAsar.map((r) => r.n).join(', '),
        '这些包随 app.asar 走。改动它们只能走安装包层。');
    }
  }

  // ───────────────────────── 汇总 ─────────────────────────
  const summary = {
    error: checks.filter((c) => c.level === 'error' && !c.ok).length,
    warn: checks.filter((c) => c.level === 'warn' && !c.ok).length,
    info: checks.filter((c) => c.level === 'info').length,
    total: checks.length,
  };

  return {
    checkedAt: new Date().toISOString(),
    profile: P.profile,
    home: P.home,
    checks,
    summary,
    facts: {
      asarBytes,
      asarHash,
      asarFiles: asarStatsValue?.files ?? null,
      asarPackages: asarIndex ? asarIndex.size : null,
      asarDshPackages: asarIndex
        ? [...asarIndex.values()].filter((p) => p.startsWith('/dsh/node_modules/')).length
        : null,
      patchEntries: patchScan?.entries.length ?? null,
    },
  };
}
