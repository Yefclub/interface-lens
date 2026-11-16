# Interface Lens

Skill para construir e refinar interfaces com inspeção do resultado real. Segue o padrão aberto [Agent Skills](https://agentskills.io) e funciona em qualquer agente que o leia: Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode e outros.

Inclui um inspetor visual que mede componentes, textos e ícones, aponta candidatos de desalinhamento, espaçamento e contraste, e descreve o produto: tecnologias, componentes, tokens e temas. Ele acompanha o que a aplicação mostra por cima: com um modal aberto, mede o modal, não a página atrás.

A skill trabalha junto com as outras que o projeto tiver e orienta o agente a consultar e sugerir o [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) para os padrões que a plataforma web já resolve.

O objetivo é corrigir a interface e verificar sua composição no contexto da tela. Um relatório sem alertas não substitui essa observação.

## Instalar

Em qualquer agente, pelo [CLI de skills](https://github.com/vercel-labs/skills):

```sh
npx skills add Yefclub/interface-lens
```

O CLI detecta os agentes instalados e copia a skill para o diretório de cada um. Use `-g` para instalar para todos os projetos e `-a <agente>` para escolher um.

No Claude Code, como plugin:

```
/plugin marketplace add Yefclub/interface-lens
/plugin install interface-lens@yefclub
```

Manualmente, copie a pasta [`skills/interface-lens`](skills/interface-lens) para o diretório de skills do agente: `~/.claude/skills/` no Claude Code, ou `.agents/skills/` no projeto, lido por Codex, Cursor, Gemini CLI, GitHub Copilot e OpenCode.

Depois, descreva uma tarefa de construção ou refinamento de interface, ou invoque a skill pelo nome.

O agente deve respeitar as instruções do projeto, os tokens, o navegador e o escopo autorizado. A skill não concede autorização para publicar, enviar dados ou alterar serviços externos.

## Usar somente o inspetor

Execute [`inspect.js`](skills/interface-lens/scripts/inspect.js) como Snippet no DevTools de uma página. Ele não depende de framework, pacotes, extensão ou serviço remoto.

```js
VisualInspector.report();    // Tecnologias, tema, tokens, componentes e achados, em texto
VisualInspector.context();   // O mesmo contexto em dados
VisualInspector.audit();     // Achados com seletor e retângulo
const antes = VisualInspector.snapshot();
VisualInspector.diff(antes); // O que mudou desde então
VisualInspector.refresh();   // Redesenha agora, antes de uma captura
VisualInspector.select('button[aria-label="Salvar"]');
VisualInspector.select(null);
VisualInspector.toggleFocus(); // Inclui ou exclui o que está coberto por outra camada
VisualInspector.toggleGuides();
VisualInspector.togglePanel();
VisualInspector.remove();
```

As guias acompanham componentes visíveis e seus conteúdos. O painel pode ser arrastado pelo cabeçalho e tem três abas: a inspeção do componente sob o ponteiro, os achados e o contexto do produto. Adaptadores opcionais descrevem regiões e padrões do produto. Veja [a referência do runtime](skills/interface-lens/references/runtime.md) e [como carregar o inspetor em cada harness](skills/interface-lens/references/agentes.md).

## Validar o runtime

```sh
npm install
npx playwright install chromium
npm test
```

Os testes abrem [`tests/browser.html`](tests/browser.html), [`tests/context.html`](tests/context.html) e [`tests/focus.html`](tests/focus.html) no Chromium. Cada cenário provoca um desvio, confere que o detector o acusa e restaura o estado; os de contexto conferem tokens, temas, componentes e tecnologias; os de foco abrem modais em div, declarados e nativos; os de interação usam o painel com o ponteiro, inclusive sob um diálogo modal.

Para rodar à mão, sirva a raiz do projeto com `python3 -m http.server 8766 --bind 127.0.0.1`, abra `http://127.0.0.1:8766/tests/browser.html` em uma janela de pelo menos 1280×800 e clique **Executar testes**.

## Limites

- Níveis são inferidos do DOM, sem promessa de corresponder a nomes de componentes do framework.
- Baselines e limites de glifos são estimativas; caixas de texto usam `Range`.
- Só a área visível e a camada em foco são auditadas. A ordem de empilhamento do modo foco é estimada onde o teste de ponto do navegador não alcança.
- O inspetor enxerga o documento em que foi injetado; frames precisam de injeção própria.
- Tecnologias, temas e componentes são detectados por evidência no DOM e nas folhas de estilo. Folhas de outra origem não podem ser lidas e builds minificados escondem nomes de componentes.
- Vídeo, canvas, frames de outra origem e shadow roots fechados podem exigir inspeção complementar.
- O inspetor não certifica qualidade, intenção visual ou acessibilidade completa.
- Dados retornados são locais e podem conter textos da página. O runtime não envia nem salva esses dados automaticamente.

O projeto contém somente a skill, o runtime genérico e exemplos sintéticos. Nenhuma sessão autenticada ou captura de aplicação privada acompanha a distribuição.

## Licença

[MIT](LICENSE), Copyright © 2026 Yefclub.
