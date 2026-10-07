// deepseek-up-T :: 「暂存包 vs 在用安装包」的判定（终端侧）
//
// 为什么要有这个模块：本项目的工作流是「改 → 构建到 state/staged/app.asar → 落盘 → 重启」，
// 而落盘**必须等人先把 Harness 完全退出**（托盘 → Quit），人可以拖很久。于是
// 「暂存包比在用安装包新」是常态而不是故障 —— 但它曾经只存在于人的记忆里：
// 一份含重播修复的暂存包在磁盘上等了一整天，界面上一个字都没说。
//
// 三条纪律（与图形界面那份实现完全一致）：
//   1. **0 字节与读不到一律算「拿不到」**，不是反面证据 —— 不许把「测不到」说成「有改动」；
//   2. **大小相同只说「大小相同」**，绝不说「逐字节相同」（这里刻意不算 121MB 的 sha256）；
//   3. **方向（谁更新）只能由 mtime 判定** —— mtime 拿不到时状态是 `differs`（不同但判不出方向），
//      而不是硬猜一个「待落盘」。
//
// ★ 同一条判定有两份实现：这里（终端：`dsht doctor` / `dsht upgrade`）与
//   `plugins/dsh-up-t/lib/index.js`（图形界面：左下角胶囊 / 设置页）。两份必须给出**完全一样**的
//   五态与措辞 —— `test/staged.test.mjs` 用一张输入表逐格对照。改一份忘另一份会立刻变红，
//   而不是让终端与界面各说一套。

import { statOrNull } from './paths.mjs';

/** 只有正数才是证据。0 与 null 一样表示「这份事实拿不到」。 */
function evidenceOrNull(n) {
  return typeof n === 'number' && n > 0 ? n : null;
}

/**
 * 判定表：给四个数字，还一个状态加一句人话。**纯函数，与文件读取刻意分开。**
 *
 * 分开的理由是测试：这条判定有五个状态要钉住，而其中两个（0 字节的暂存包、暂存包比在用的更旧）
 * 如果只能靠「改真文件再复原」来造，那么测试中途一死就会留下一个被改过的工作区 ——
 * 用一个 121 MB 的产物去换两条断言，不划算。所以判定与 I/O 分开，判定表直接喂数字。
 *
 * 措辞与 `plugins/dsh-up-t/lib/index.js` 的同一函数逐字相同（有对照测试钉住）。
 */
export function stagedVerdict({ bytes, mtimeMs, installedBytes, installedMtimeMs }) {
  const b = evidenceOrNull(bytes);
  const ib = evidenceOrNull(installedBytes);
  const m = typeof mtimeMs === 'number' && isFinite(mtimeMs) ? mtimeMs : null;
  const im = typeof installedMtimeMs === 'number' && isFinite(installedMtimeMs) ? installedMtimeMs : null;
  if (b === null) {
    return { status: 'unavailable', why: '暂存包是 0 字节或读不到 —— 0 字节不是「有改动」的证据', deltaBytes: null };
  }
  if (ib === null) {
    return { status: 'unavailable', why: '没拿到在用安装包的大小，无法与暂存包比较', deltaBytes: null };
  }
  const deltaBytes = b - ib;
  if (b === ib) {
    return {
      status: 'same-size',
      why: '与在用安装包大小相同（大小相同不等于逐字节相同，也可能是这次改动没改大小）',
      deltaBytes,
    };
  }
  if (m !== null && im !== null) {
    return m > im
      ? { status: 'pending', why: '暂存包比在用安装包新', deltaBytes }
      : { status: 'behind', why: '暂存包比在用安装包旧 —— 别用它落盘，先重新构建', deltaBytes };
  }
  return {
    status: 'differs',
    why: '与在用安装包大小不同，但没拿到可比的时间戳，判不出谁更新',
    deltaBytes,
  };
}

/**
 * 读磁盘拿事实，再交给上面的判定表。
 *
 * 与图形界面那份的差别只有一处措辞：文件不存在时终端说「用 dsht 的构建命令生成它」，
 * 界面说「界面上那个按钮就是干这个的」—— 因为两边能按的东西不一样。
 *
 * @param {{ stagedFile: string, asar: string }} paths 通常直接传 resolvePaths() 的结果
 */
export function stagedFacts(paths) {
  const out = {
    file: paths.stagedFile,
    bytes: null,
    mtimeMs: null,
    installedBytes: null,
    installedMtimeMs: null,
    // 差多少字节（暂存 - 在用）：只在两侧都拿到时才有意义
    deltaBytes: null,
    status: 'unavailable',
    why: null,
  };
  const live = statOrNull(paths.asar);
  out.installedBytes = evidenceOrNull(live ? live.size : null);
  out.installedMtimeMs = live && typeof live.mtimeMs === 'number' ? live.mtimeMs : null;

  const st = statOrNull(out.file);
  if (!st) {
    out.why = '还没构建过暂存包（state/staged/app.asar 不存在）—— `node vendor/whale/build.mjs` 或 `dsht upgrade --stage` 会写它';
    return out;
  }
  out.bytes = evidenceOrNull(st.size);
  out.mtimeMs = typeof st.mtimeMs === 'number' ? st.mtimeMs : null;
  return { ...out, ...stagedVerdict(out) };
}

/** 人话一行，给 doctor / upgrade 的报告用（不参与判定，只是排版）。 */
export function stagedLine(facts) {
  if (!facts) return null;
  if (facts.status === 'pending' || facts.status === 'behind' || facts.status === 'differs') {
    const d = facts.deltaBytes;
    const size = d === null ? '' : d === 0 ? '' : `（${d > 0 ? '大' : '小'} ${Math.abs(d)} 字节）`;
    return `${facts.why}${size}`;
  }
  return facts.why ?? '拿不到暂存产物的信息';
}
