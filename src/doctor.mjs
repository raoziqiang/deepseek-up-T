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

export const GROUPS = ['环境', '组合层', '解析', '安装包'];

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
