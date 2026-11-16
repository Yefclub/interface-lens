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
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.reload();
  await settle();

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
  for (const file of ['browser.html', 'context.html']) {
    await page.goto(base + file);
    print(file, (await page.evaluate(() => window.runVisualTests())).results);
  }
  await page.goto(base + 'browser.html');
  print('interação com o painel', await panelInteraction(page));
  if (errors.length) { failed += errors.length; console.log('\nErros da página:\n' + errors.join('\n')); }
  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} falha(s)` : '\nTodos os testes passaram');
  process.exit(failed ? 1 : 0);
})();
