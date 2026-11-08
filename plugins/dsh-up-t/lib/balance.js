// deepseek-up-T :: DeepSeek 官方 API 余额（宿主侧）
//
// 只认 DeepSeek 官方接口 `GET https://api.deepseek.com/user/balance`（Bearer 鉴权）。
// 返回体（官方文档 api-docs.deepseek.com/api/get-user-balance）：
//   { is_available: boolean,
//     balance_infos: [{ currency: "CNY"|"USD", total_balance: "110.00",
//                       granted_balance: "10.00", topped_up_balance: "100.00" }] }
// 金额是**字符串**。
//
// 为什么放在宿主而不是渲染层：密钥绝不能进页面。渲染层只拿到 `/dsh-up-t/balance.json`
// 这份已经算好的结论（金额、币种、是否偏低、出错原因），里面没有任何密钥字节。
//
// 密钥从哪来（按顺序，先到先得）：
//   1. 环境变量 DEEPSEEK_API_KEY
//   2. $DSH_HOME/.credentials.yaml 的 `refs:` 段里的 DEEPSEEK_API_KEY
// 偏低阈值：环境变量 DSH_UP_T_BALANCE_LOW（默认 CNY 10 / USD 1.5）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BALANCE_URL = 'https://api.deepseek.com/user/balance';
export const KEY_REF = 'DEEPSEEK_API_KEY';
/** 正常缓存时长：余额变化慢，5 分钟问一次足够，也不会给官方接口添压力。 */
export const TTL_MS = 5 * 60 * 1000;
/** 出错后多久再试：别在离线时每次刷新页面都打一次。 */
export const ERROR_TTL_MS = 60 * 1000;
/** 手动刷新的最小间隔：防止页面（或别的网页）连点把接口打爆。 */
export const MIN_REFRESH_MS = 10 * 1000;
export const TIMEOUT_MS = 8000;
const DEFAULT_LOW = { CNY: 10, USD: 1.5 };

function dshHome(env) {
  return env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/**
 * 只读 `refs:` 段下两空格缩进的 `DEEPSEEK_API_KEY: <值>`。不做通用 YAML。
 * @returns {string|null}
 */
export function keyFromCredentials(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  let inRefs = false;
  for (const line of lines) {
    if (/^\S/.test(line)) { inRefs = /^refs:\s*$/.test(line); continue; }
    if (!inRefs) continue;
    const m = /^ {2}DEEPSEEK_API_KEY:\s*(.*?)\s*$/.exec(line);
    if (m) {
      const v = m[1].replace(/^(['"])(.*)\1$/, '$2').trim();
      return v || null;
    }
  }
  return null;
}

/** @returns {{ key: string|null, source: string|null }} 只说来源，不外泄值。 */
export function resolveKey({ env = process.env, readFile = fs.readFileSync } = {}) {
  const fromEnv = String(env[KEY_REF] ?? '').trim();
  if (fromEnv) return { key: fromEnv, source: 'env' };
  const file = path.join(dshHome(env), '.credentials.yaml');
  try {
    const k = keyFromCredentials(readFile(file, 'utf8'));
    if (k) return { key: k, source: 'credentials' };
  } catch { /* 文件不在就算没有 */ }
  return { key: null, source: null };
}

export function lowThreshold(currency, env = process.env) {
  const raw = Number(env.DSH_UP_T_BALANCE_LOW);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_LOW[currency] ?? 10;
}

const money = (s) => {
  const n = Number(String(s ?? '').trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * 把官方返回体收成渲染层要的样子。优先 CNY（人民币账户），其次第一条。
 * 结构不对就抛 —— 宁可显示「接口格式变了」，也不显示一个编出来的数。
 */
export function parseBalance(body, env = process.env) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.balance_infos)) {
    throw new Error('余额接口返回的格式不认识');
  }
  const infos = body.balance_infos
    .map((b) => ({
      currency: String(b?.currency ?? ''),
      total: money(b?.total_balance),
      granted: money(b?.granted_balance),
      toppedUp: money(b?.topped_up_balance),
    }))
    .filter((b) => b.currency && b.total !== null);
  if (!infos.length) throw new Error('余额接口没有返回任何币种');
  const main = infos.find((b) => b.currency === 'CNY') ?? infos[0];
  const low = lowThreshold(main.currency, env);
  return {
    available: body.is_available !== false,
    currency: main.currency,
    total: main.total,
    granted: main.granted,
    toppedUp: main.toppedUp,
    low,
    isLow: main.total <= low,
    others: infos.filter((b) => b !== main),
  };
}

/** 一次真请求。出错时抛带人话的 Error（`code` 给渲染层分颜色）。 */
export async function fetchBalance(key, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, env = process.env } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('宿主没有 fetch（Node 版本太旧）'), { code: 'no-fetch' });
  }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetchImpl(BALANCE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: ctrl?.signal,
    });
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    throw Object.assign(new Error(aborted ? '请求超时' : '连不上 api.deepseek.com'), { code: 'network' });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('API Key 无效或已被吊销'), { code: 'auth' });
  }
  if (res.status === 429) {
    throw Object.assign(new Error('请求太频繁，稍后再试'), { code: 'rate' });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`余额接口返回 HTTP ${res.status}`), { code: 'http' });
  }
  let body;
  try { body = await res.json(); } catch {
    throw Object.assign(new Error('余额接口返回的不是 JSON'), { code: 'format' });
  }
  try { return parseBalance(body, env); } catch (err) {
    throw Object.assign(err, { code: 'format' });
  }
}

/**
 * 带缓存的服务：同一时间只有一个请求在飞；成功缓存 TTL_MS，失败缓存 ERROR_TTL_MS；
 * 手动刷新至少隔 MIN_REFRESH_MS。永不抛 —— 失败也是一份可显示的结论。
 */
export function createBalanceService(opts = {}) {
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => Date.now());
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const readFile = opts.readFile ?? fs.readFileSync;
  let cached = null; // { payload, at, ttl }
  let inflight = null;

  async function load() {
    const { key, source } = resolveKey({ env, readFile });
    const at = now();
    if (!key) {
      return {
        ok: false,
        code: 'no-key',
        error: `没找到 ${KEY_REF}：设成环境变量，或写进 $DSH_HOME/.credentials.yaml 的 refs 段`,
        at,
      };
    }
    try {
      const b = await fetchBalance(key, { fetchImpl, env });
      return { ok: true, ...b, keySource: source, at };
    } catch (err) {
      return { ok: false, code: err?.code ?? 'error', error: String(err?.message ?? err), keySource: source, at };
    }
  }

  return {
    /** @param {{ force?: boolean }} [o] */
    async get(o = {}) {
      const t = now();
      if (cached) {
        const age = t - cached.at;
        const fresh = age < cached.ttl;
        const mayForce = o.force && age >= MIN_REFRESH_MS;
        if (fresh && !mayForce) return { ...cached.payload, cached: true };
      }
      if (!inflight) {
        inflight = load().then((payload) => {
          cached = { payload, at: now(), ttl: payload.ok ? TTL_MS : ERROR_TTL_MS };
          return payload;
        }).finally(() => { inflight = null; });
      }
      return { ...(await inflight), cached: false };
    },
    /** 测试用：清缓存。 */
    reset() { cached = null; },
  };
}
