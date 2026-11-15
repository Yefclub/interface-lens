# Interface Lens

Skill para construir e refinar interfaces com inspeção do resultado real. Inclui um inspetor visual reutilizável para componentes, níveis, textos, ícones e candidatos de alinhamento.

O objetivo é corrigir a interface e verificar sua composição no contexto da tela. Um relatório sem alertas não substitui essa observação.

## Usar a skill

Copie a pasta [`skills/interface-lens`](skills/interface-lens) para o diretório de skills do seu harness. No Codex, o diretório pessoal padrão é `~/.codex/skills`. Invoque `$interface-lens` ou descreva uma tarefa de construção ou refinamento de interface.

O agente deve respeitar as instruções do projeto, os tokens, o navegador e o escopo autorizado. A skill não concede autorização para publicar, enviar dados ou alterar serviços externos.

## Usar somente o inspetor

Execute [`inspect.js`](skills/interface-lens/scripts/inspect.js) como Snippet no DevTools de uma página. Ele não depende de React, pacotes, extensão ou serviço remoto.

```js
VisualInspector.audit();
VisualInspector.measurements();
VisualInspector.select('button[aria-label="Salvar"]');
VisualInspector.select(null);
VisualInspector.toggleGuides();
VisualInspector.remove();
```

As guias acompanham componentes visíveis e seus conteúdos. O painel mostra hierarquia e geometria; o relatório distingue medidas de candidatos ópticos. Adaptadores opcionais descrevem regiões e padrões do produto. Veja [a referência](skills/interface-lens/references/runtime.md).

## Validar o runtime

Na raiz do projeto, execute:

```sh
node --check skills/interface-lens/scripts/inspect.js
python -m http.server 8766 --bind 127.0.0.1
```

Abra `http://127.0.0.1:8766/tests/browser.html` no navegador e clique **Executar testes**. Os cenários verificam geometria de texto e ícone, um ícone dentro de grid, dimensão contratada, conteúdo oculto, preservação do DOM e remoção da camada. Cada deslocamento é restaurado antes do próximo cenário. Encerre o servidor ao terminar.

## Limites

- Níveis são inferidos do DOM, sem promessa de corresponder a nomes de componentes do framework.
- Baselines e limites de glifos são estimativas; caixas de texto usam `Range`.
- Vídeo, canvas, frames de outra origem e shadow roots fechados podem exigir inspeção complementar.
- O inspetor não certifica qualidade, intenção visual ou acessibilidade completa.
- Dados retornados são locais e podem conter textos da página. O runtime não envia nem salva esses dados automaticamente.

O projeto contém somente a skill, o runtime genérico e exemplos sintéticos. Nenhuma sessão autenticada ou captura de aplicação privada acompanha a distribuição.

## Licença

[MIT](LICENSE), Copyright © 2026 Yefclub.
