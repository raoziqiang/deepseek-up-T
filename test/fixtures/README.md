# test/fixtures

放**证据文件**，不放运行期素材。这里的文件都是某个真实 bug 的原始形态，用来让「它以后不会再回来」
这句话有据可查 —— 不是手写的示意样例。

## `welcome-html-broken-before-2026-10-06.html`

`renderer/welcome.html` 的**坏版本原文**（991 字节，sha256 前 16 位 `5BC23F972FCC30A6`），
就是它当时被构建进 `state/staged/app.asar` 的那一份。它是 DSH **登录/欢迎窗口**的页面，
三处问题：

- 漏了原版加载的 `../lib/welcome/welcome.js`（欢迎界面自己的 React 启动脚本）与
  `../lib/welcome/welcome.css` ⇒ 窗口里 `#root` 永远是空的，登录界面不会出现；
- `../lib/welcome/whale-splash.js` 指向一个归档里**不存在**的文件（实际插入在
  `renderer/whale-splash.js`）⇒ splash 控制器 404，画布上什么都不画；
- CSP 少了 `font-src 'self'` ⇒ 品牌字体被 `default-src 'none'` 拦掉。

它**通过了**当时所有已有的检查：构建退出码 0、11 个条目按声明改动、其余 11466 个条目逐字节一致、
`node --check` 通过。原因是 `action: replace` 的素材是手写的，构建器只比对「与原来不同」，
不比对「是不是少了什么」。`test/assets.test.mjs` 就是为此立的，
第 4 节直接拿这个文件当反例喂给三条规则。

不要编辑这个文件：它一旦被改就不再是那份证据了。
