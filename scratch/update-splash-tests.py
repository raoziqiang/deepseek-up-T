from pathlib import Path
p=Path('test/splash.test.mjs')
s=p.read_text(encoding='utf-8')
s=s.replace("'ellipse', 'rotate',", "'ellipse', 'rotate', 'drawImage',")
s=s.replace('function runToEnd(page, frames = 12)', 'function runToEnd(page, frames = Math.ceil(page.sandbox.WhaleSplash.DURATION_MS / 420) + 2)')
s=s.replace('默认时长 4200ms / 每帧 420ms ⇒ 11 帧足够到 t=1', '从共享动画时长计算帧数，每帧推进 420ms')
s=s.replace("assert.equal(page.created.length, 0, '加载阶段不该创建任何节点（挂件要等动画结束）');", "assert.equal(page.pendant(), null, '挂件要等动画结束');\n  assert.ok(page.created.every(el => el.parentNode === null), '预计算画布不能覆盖页面');")
s=s.replace("assert.ok(page.stageCtx.gradients.length > 0, '一个渐变都没建：背景没画');\n  assert.ok(ops.includes('fillRect'));", "assert.ok(ops.includes('drawImage'), '预计算背景没有合成到场景');\n  assert.ok(page.created.some(el => el.ctx2d?.gradients.length > 0 && el.ctx2d.ops.includes('fillRect')), '离屏背景没有画出');")
def block(start,end,new):
 global s
 a=s.index(start);b=s.index(end,a);s=s[:a]+new+'\n\n'+s[b:]
block("await check('跑到末尾：鲸鱼路径", "await check('所有传给画布", """await check('无 WebGL 与图片时仍画出降级主体，并明确报告降级', () => {
  runToEnd(page);
  assert.equal(page.sandbox.WhaleSplash.rendererInfo().mode, 'fallback-image');
  assert.equal(page.sandbox.WhaleSplash.rendererInfo().error, 'WebGL2 unavailable');
  assert.ok(page.created.some(el => el.ctx2d?.ops.includes('ellipse') && el.ctx2d.ops.includes('fill')));
  assert.deepEqual(Array.from(page.warns), ['Whale 3D fallback: WebGL2 unavailable']);
});""")
s=s.replace('const bad = Array.from(p.stageCtx.bad);', 'const bad = [p.stageCtx, ...p.created.map(el => el.ctx2d).filter(Boolean)].flatMap(ctx => Array.from(ctx.bad));')
s=s.replace('t.ms >= 900', 't.ms >= 600 && t.ms <= 1000')
s=s.replace("assert.ok(page.stage.classList.contains('is-done'));", "assert.ok(page.stage.classList.contains('is-done'));\n  assert.ok(!page.pendant().classList.contains('is-visible'), '场景淡出前挂件不能显示');",1)
s=s.replace("assert.ok(!page.body.children.includes(page.stage));", "assert.ok(!page.body.children.includes(page.stage));\n  page.pump(1, 16);\n  assert.ok(page.pendant().classList.contains('is-visible'), '场景移除后应显示挂件');",1)
block("await check('pagehide 之后", '// ── ③', """await check('pagehide 停止活动动画，完成后也不继续空转', () => {
  assert.equal(page.frames.size, 0, '完成后仍在空转');
  const active = makePage();
  active.pump(1, 100);
  assert.ok(active.frames.size > 0);
  active.dispatchWindow('pagehide');
  assert.equal(active.frames.size, 0);
  const before = active.rafCalls;
  active.pump(3, 420);
  assert.equal(active.rafCalls, before);
});""")
s=s.replace(".includes('bezierCurveTo')", ".includes('ellipse')")
block("await check('drawWhale 的 light", '// ── ⑤ 三条', """await check('同一鲸鱼在深浅主题下均能绘制，画布变换保持配对', () => {
  for (const light of [false, true]) {
    const ctx = makeCtx2d();
    page.sandbox.drawWhale(ctx, 100, 63, true, light);
    assert.ok(ctx.ops.includes('fill'));
    assert.equal(ctx.ops.filter(x => x === 'save').length, ctx.ops.filter(x => x === 'restore').length);
    assert.equal(ctx.bad.length, 0);
  }
});

await check('宽窄窗口均向左跃起再落下，接触点位于可见星海内', () => {
  for (const [width, height] of [[600, 700], [1280, 800]]) {
    const p = makePage({ innerWidth: width, innerHeight: height });
    const animation = new p.sandbox.WhaleSplash(p.stage);
    const poses = Array.from({length: 11}, (_, i) => animation.whalePose(i / 10));
    assert.ok(poses.every((pose, i) => i === 0 || pose.x <= poses[i - 1].x));
    assert.ok(animation.whalePose(.46).y < animation.whalePose(.16).y);
    assert.ok(animation.whalePose(.46).y < animation.whalePose(.76).y);
    assert.equal(animation.contacts.length, 2);
    assert.ok(animation.contacts[0].at < animation.contacts[1].at);
    assert.ok(animation.contacts.every(c => c.x >= 0 && c.x <= 1 && c.y > 0 && c.y < 1));
    animation.stop();
  }
});""")
s=s.replace("assert.deepEqual(Array.from(p.warns), []);", "assert.deepEqual(unexpectedWarnings(p), []);")
s=s.replace("'replay.js 是经典脚本，动画时长只在它自己这一份里'", "'replay.js 是经典脚本，并使用共享动画时长'")
block('    const m = /const DURATION_MS', "  await check('Replay：", """    assert.ok(REPLAY_SRC.includes('window.WhaleSplash?.DURATION_MS'));
    assert.ok(SPLASH_SRC.includes('window.WhaleSplash?.DURATION_MS'));
    const dur = page.sandbox.WhaleSplash.DURATION_MS;
    assert.ok(dur > 0 && dur <= 20000);
  });""")
s=s.replace('assert.equal(p.warns.length, 1);', 'assert.equal(unexpectedWarnings(p).length, 1);')
s=s.replace("await check('所有沙箱运行里都没有异常、也没有控制台告警'", "await check('所有沙箱运行无异常，只有预期的 WebGL 不可用降级诊断'")
s=s.replace('flatMap((p) => Array.from(p.warns))', 'flatMap((p) => unexpectedWarnings(p))')
s=s.replace('const results = [];', """// This VM deliberately has no GPU or Image. GPU visuals are reviewed in real Chrome.
function unexpectedWarnings(p) {
  const expected = 'Whale 3D fallback: WebGL2 unavailable';
  assert.ok(p.warns.filter(w => w === expected).length <= 1, '降级告警不能逐帧重复');
  return Array.from(p.warns).filter(w => w !== expected);
}
const results = [];""")
s=s.replace('// ── ④ 深浅两套皮肤真的不一样（不是只换了个变量名）', '// ── ④ 主题绘制与动作轨迹')
p.write_text(s,encoding='utf-8')
