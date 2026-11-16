# Carregar o inspetor em cada harness

O runtime é um único arquivo, `scripts/inspect.js`. Carregue-o pelo caminho. Colar o conteúdo na conversa gasta contexto a cada injeção e não acrescenta nada.

Use o navegador e a sessão que o usuário escolheu. Os nomes de ferramenta abaixo são exemplos e mudam entre versões; confira a lista do seu harness.

## Agente com terminal e Playwright

```js
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:3000/rota');
await page.addScriptTag({ path: '/caminho/da/skill/scripts/inspect.js' });
console.log(await page.evaluate(() => VisualInspector.report()));
await page.screenshot({ path: 'com-guias.png' });
await page.evaluate(() => VisualInspector.togglePanel());
```

## MCP de navegador que executa código Playwright

Quando a ferramenta recebe uma função com `page` (por exemplo `browser_run_code` no Playwright MCP), o servidor lê o arquivo do disco:

```js
async (page) => {
  await page.addScriptTag({ path: '/caminho/da/skill/scripts/inspect.js' });
  return await page.evaluate(() => VisualInspector.report());
}
```

## MCP ou extensão que só avalia expressões na página

Vale para `browser_evaluate` no Playwright MCP, `evaluate_script` no Chrome DevTools MCP e ferramentas de JavaScript de extensões. Sirva a pasta `scripts` em localhost e carregue por URL:

```bash
python3 -m http.server 8766 --bind 127.0.0.1 --directory /caminho/da/skill/scripts
```

```js
await new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = 'http://127.0.0.1:8766/inspect.js';
  script.onload = () => { script.remove(); resolve(); };
  script.onerror = reject;
  document.head.append(script);
});
VisualInspector.report();
```

Uma política de segurança de conteúdo restritiva pode recusar o script. Nesse caso, use um contexto Playwright com `bypassCSP`, o Snippet do DevTools ou o inspector nativo. Encerre o servidor ao terminar.

## DevTools, sem agente

Em Sources › Snippets, crie um snippet com o conteúdo de `inspect.js` e execute. O painel e a API ficam disponíveis no console.

## Sem nenhuma forma de injeção

Use o inspector nativo, as medidas que o harness oferecer e capturas. As etapas da skill continuam valendo; só a medição automática fica de fora.

## Gastar pouco contexto

- Comece por `VisualInspector.report()`. É texto, cabe em uma resposta e já traz contexto e achados.
- Peça `audit().findings` quando precisar dos retângulos. O retorno completo de `audit()` inclui todas as partes de texto e ícone e cresce com a página.
- De `context()`, leia o campo necessário: `context().theme`, `context().tokens.colors`.
- Guarde `snapshot()` fora da página. Uma recarga ou o hot reload descarta o estado em memória; `diff(antes)` aceita o JSON guardado.

## Capturas

O painel aparece nas capturas. Use `VisualInspector.togglePanel()` para ocultá-lo, `VisualInspector.movePanel(x, y)` para tirá-lo da área de interesse ou instale com `installVisualInspector({ panel: false })`. Para a captura limpa, oculte também as guias com `VisualInspector.toggleGuides()`.

## Temas

`context().theme.themes` informa o seletor de cada tema e onde ele é aplicado. Prefira o controle do próprio produto para alternar, porque ele também atualiza a persistência e o `color-scheme`. Em um mock, aplicar a classe ou o atributo na raiz é suficiente; restaure depois. Repita a inspeção em cada tema que a mudança afeta.
