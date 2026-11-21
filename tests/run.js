// Executa as páginas de teste no Chromium e confere a interação real com o painel.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
const server = http.createServer((request, response) => {
  const file = path.join(root, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return response.writeHead(404).end();
  response.writeHead(200, { 'content-type':types[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
});

async function panelInteraction(page) {
  const results = [];
  const record = (name, passed, detail) => results.push({ name, passed:!!passed, detail });
  const rect = () => page.evaluate(() => { const b=document.getElementById('visual-inspector-panel').getBoundingClientRect(); return { x:b.x, y:b.y, width:b.width, height:b.height }; });
  const text = () => page.evaluate(() => document.getElementById('visual-inspector-panel').shadowRoot.textContent);
  const settle = () => page.evaluate(() => { VisualInspector.refresh(); });
  await page.reload();
  await settle();

  // Detectores de "clique fora" das aplicações escutam o documento; o painel não pode dispará-los.
  await page.evaluate(() => { window.pageEvents = []; for (const type of ['pointerdown', 'mousedown', 'click']) document.addEventListener(type, () => window.pageEvents.push(type), true); });
  const tab = await page.evaluate(() => { const b=document.getElementById('visual-inspector-panel').shadowRoot.getElementById('vi-tab-context').getBoundingClientRect(); return { x:b.x+b.width/2, y:b.y+b.height/2 }; });
  await page.mouse.click(tab.x, tab.y);
  const clicked = await page.evaluate(() => ({ tab:document.getElementById('visual-inspector-panel').shadowRoot.querySelector('[aria-selected="true"]').id, events:window.pageEvents }));
  record('Clique em uma aba troca a aba sem chegar à aplicação', clicked.tab === 'vi-tab-context' && clicked.events.length === 0, clicked);
  for (const activation of ['Enter','Space','click']) {
    await page.evaluate(() => {
      const root=document.getElementById('visual-inspector-panel').shadowRoot;
      root.getElementById('vi-tab-inspect').dispatchEvent(new MouseEvent('click'));
      window.pageEvents=[];
      root.getElementById('vi-tab-context').focus();
    });
    if (activation==='click') await page.evaluate(() => document.getElementById('visual-inspector-panel').shadowRoot.getElementById('vi-tab-context').click());
    else await page.keyboard.press(activation);
    const activated=await page.evaluate(() => ({ tab:document.getElementById('visual-inspector-panel').shadowRoot.querySelector('[aria-selected="true"]').id,events:window.pageEvents }));
    record(`${activation} ativa a aba sem vazar clique para a aplicação`,activated.tab==='vi-tab-context'&&activated.events.length===0,activated);
  }
  await page.evaluate(() => document.getElementById('visual-inspector-panel').shadowRoot.getElementById('vi-tab-inspect').dispatchEvent(new MouseEvent('click')));

  const sample = await page.locator('#sample').boundingBox();
  // O padding direito pertence ao botão: o centro cai no texto e a esquerda fica sob o controle oculto da fixture.
  await page.mouse.move(sample.x + sample.width - 5, sample.y + sample.height / 2);
  await settle();
  record('Ponteiro sobre um componente preenche a inspeção', /Salvar exemplo/.test(await text()) && /Tamanho/.test(await text()));
  let box = await rect();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12);
  await settle();
  record('Seleção permanece legível com o ponteiro sobre o painel', /Salvar exemplo/.test(await text()));

  await page.mouse.move(box.x + 120, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x - 180, box.y - 240, { steps:8 });
  await page.mouse.up();
  const dragged = await rect();
  record('Painel acompanha o arraste pelo cabeçalho', Math.abs(dragged.x - (box.x - 300)) <= 1 && Math.abs(dragged.y - (box.y - 260)) <= 1, { box, dragged });
  await page.evaluate(() => { document.getElementById('intro').textContent += ' '; });
  await settle();
  record('Posição escolhida sobrevive a novos desenhos', JSON.stringify(await rect()) === JSON.stringify(dragged));

  await page.mouse.move(dragged.x + 120, dragged.y + 20);
  await page.mouse.down();
  await page.mouse.move(-500, -500, { steps:4 });
  await page.mouse.up();
  const clamped = await rect();
  record('Arraste não leva o painel para fora da tela', clamped.x === 16 && clamped.y === 16, clamped);
  await page.mouse.dblclick(clamped.x + 120, clamped.y + 20);
  await settle();
  box = await rect();
  record('Duplo clique devolve o posicionamento automático', box.x > 400, box);
  return results;
}

// Um <dialog> modal nativo torna o painel inerte; ele precisa continuar clicável sem fechar nem acionar o diálogo.
async function panelUnderModal(page) {
  const results = [];
  const record = (name, passed, detail) => results.push({ name, passed:!!passed, detail });
  const inPanel = selector => page.evaluate(selector => { const b=document.getElementById('visual-inspector-panel').shadowRoot.querySelector(selector).getBoundingClientRect(); return { x:b.x+b.width/2, y:b.y+b.height/2 }; }, selector);
  await page.mouse.move(5, 5);
  await page.reload();
  await page.evaluate(() => {
    window.pageClicks = 0;
    document.addEventListener('click', () => { window.pageClicks++; });
    document.getElementById('native').showModal();
    VisualInspector.refresh();
  });
  const tab = await inPanel('#vi-tab-findings');
  await page.mouse.click(tab.x, tab.y);
  const state = await page.evaluate(() => ({ tab:document.getElementById('visual-inspector-panel').shadowRoot.querySelector('[aria-selected="true"]').id, open:document.getElementById('native').open, clicks:window.pageClicks }));
  record('Clique no painel funciona sob dialog modal', state.tab === 'vi-tab-findings', state);
  record('Clique no painel não chega à aplicação', state.open && state.clicks === 0, state);
  const before = await page.evaluate(() => { VisualInspector.refresh(); return document.getElementById('visual-inspector-panel').getBoundingClientRect().x; });
  const head = await inPanel('.title');
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  await page.mouse.move(head.x - 220, head.y - 180, { steps:6 });
  await page.mouse.up();
  const after = await page.evaluate(() => document.getElementById('visual-inspector-panel').getBoundingClientRect().x);
  record('Painel pode ser arrastado sob dialog modal', Math.abs(before - after - 220) <= 1, { before, after });
  return results;
}

// Linhas do contêiner em largura de celular e em uma lista longa, com um desvio plantado e o custo medido.
async function linesAtScale(page, base) {
  const results = [];
  const record = (name, passed, detail) => results.push({ name, passed:!!passed, detail });
  const LINE = ['linha-texto','coluna-icones','linha-rotulo','linha-caixa','linha-final'];
  await page.setViewportSize({ width:390, height:844 });
  await page.goto(base + 'lines.html');
  const narrow = await page.evaluate(LINE => { VisualInspector.refresh(); return VisualInspector.audit().findings.filter(f => LINE.includes(f.rule)); }, LINE);
  record('Linhas alinhadas em 390 px sem achados', narrow.length === 0, narrow);
  const shifted = await page.evaluate(() => { document.getElementById('sec1').style.paddingLeft='15px'; return VisualInspector.audit().findings.map(f => f.rule + ' ' + f.deltaPx); });
  record('Desvio acusado em 390 px', shifted.length === 1 && shifted[0] === 'linha-texto 3', shifted);
  await page.setViewportSize({ width:1280, height:800 });

  const row = (i, extra='') => `<li><a href="#" style="display:flex;align-items:center;gap:8px;height:28px;padding:0 12px${extra}"><svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16"/></svg><span>Item ${i}</span><span style="margin-left:auto;width:24px;text-align:center;border-radius:9px;background:#e3e7ee">${i % 90}</span></a></li>`;
  const list = Array.from({ length:3000 }, (_, i) => row(i, i === 12 ? ';padding-left:15px' : '')).join('');
  await page.goto(base + 'lines.html');
  await page.evaluate(list => {
    VisualInspector.remove();
    document.body.innerHTML = `<nav aria-label="Lista longa" style="position:fixed;left:0;top:0;bottom:0;width:260px;overflow:auto;font:14px Arial"><ul style="margin:0;padding:0;list-style:none">${list}</ul></nav>`;
    installVisualInspector({ panel:false });
  }, list);
  const timed = await page.evaluate(LINE => {
    const start = performance.now(), audit = VisualInspector.audit(), ms = performance.now() - start;
    return { ms:Math.round(ms), findings:audit.findings.filter(f => LINE.includes(f.rule)).map(f => ({ rule:f.rule, delta:f.deltaPx, component:f.component })) };
  }, LINE);
  record('Lista de 3000 linhas: desvio plantado acusado sem falso positivo', timed.findings.length === 1 && timed.findings[0].rule === 'coluna-icones' && timed.findings[0].delta === 3, timed);
  record(`Lista de 3000 linhas auditada em ${timed.ms} ms`, timed.ms < 4000, timed.ms);
  return results;
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/tests/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1280, height:800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  let failed = 0;
  const print = (suite, results) => {
    console.log(`\n${suite}`);
    for (const r of results) {
      console.log(`  ${r.passed ? 'ok  ' : 'FALHOU'} ${r.name}`);
      if (!r.passed) { failed++; if (r.detail !== undefined) console.log('         ' + JSON.stringify(r.detail)); }
    }
  };
  for (const file of ['browser.html', 'context.html', 'focus.html', 'lines.html']) {
    await page.goto(base + file);
    print(file, (await page.evaluate(() => window.runVisualTests())).results);
  }
  print('linhas em escala', await linesAtScale(page, base));
  await page.goto(base + 'browser.html');
  print('interação com o painel', await panelInteraction(page));
  await page.goto(base + 'focus.html');
  print('painel sob dialog modal', await panelUnderModal(page));
  if (errors.length) { failed += errors.length; console.log('\nErros da página:\n' + errors.join('\n')); }
  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} falha(s)` : '\nTodos os testes passaram');
  process.exit(failed ? 1 : 0);
})();
