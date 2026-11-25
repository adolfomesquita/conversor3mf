# CLAUDE.md — Conversor 3MF (site estático)

Site gratuito, sem cadastro, que converte projetos `.3mf` (Bambu Studio, OrcaSlicer e derivados, Anycubic Slicer Next, Creality Print, Snapmaker Orca) para impressoras Bambu Lab, Creality, Anycubic, Flashforge e Snapmaker, abertos nos slicers das fabricantes (Bambu Studio 2.9.1, Creality Print 7.3.1, Anycubic Slicer Next, Orca-Flashforge, Snapmaker Orca 2.4.1). **A conversão roda inteira no navegador; o arquivo não sai do computador.** Interface, código, mensagens e documentação em **pt-BR**. Detalhes: [README.md](README.md); achados de formato: [docs/inspecao-3mf-e-perfis.md](docs/inspecao-3mf-e-perfis.md).

Publicado em https://adolfomesquita.github.io/conversor3mf/ (repositório **público** `adolfomesquita/conversor3mf`, AGPL-3.0). Cada push na `main` roda os testes e republica o site.

## Regras de trabalho (do usuário)

- Trabalhar **por fases e parar ao fim de cada uma** para revisão. Não começar a próxima sem o "seguir".
- **Nunca** publicar, fazer deploy nem criar recursos pagos sem perguntar. Commit e push só a pedido (push na `main` = site novo no ar).
- O repositório é público: nada de dado pessoal (nomes, e-mails, caminhos com o usuário do Windows), segredo ou projeto .3mf de terceiros. Commits com o e-mail oculto do GitHub (configurado só neste repositório).
- Respostas ao usuário em português, curtas e sem jargão.

## Versão com servidor (Firebase)

A versão anterior (login, área admin, cota, Cloud Functions, App Check) foi tirada daqui em 24/11/2026 e está no repositório **privado** `adolfomesquita/conversor3mf-firebase` (cópia local em `C:\Dev\conversor3mf-firebase`; lá o workflow do Pages está desativado). **A biblioteca de conversão está duplicada** nos dois repositórios: **a fonte oficial é este repositório (público)** (decisão do usuário em 25/11/2026). Toda mudança na biblioteca nasce aqui; o repositório privado só copia daqui, quando o usuário pedir.

## Requisitos que valem sempre

- `.3mf` é não confiável, mesmo no navegador: limites de ZIP, zip bomb, path traversal, sem DTD/XXE, nunca executar; G-code, `post_process` e `print_host` nunca copiados.
- Nada sai do navegador: sem envio de arquivo, nome ou conteúdo para lugar nenhum; sem cookies nem publicidade (a página de privacidade promete isso). Única exceção: a contagem de uso do GoatCounter (decisão do usuário, 25/11/2026), feita em `site/src/servicos/estatistica.ts` sem o script deles: visita (página, origem, navegador, largura da tela; o país o GoatCounter deduz pelo IP) e eventos `convertido: <impressora>` / `erro na conversão`. Nunca pôr nome, conteúdo ou mensagem de erro do arquivo num evento; mudou o que é contado? Mude o texto "Contagem de uso" da privacidade.
- Resultado no navegador = resultado no Node: mudou a biblioteca (fluxos, ZIP, texto)? Rode `npm test` (inclui `leitorBlob.unidade.test.ts`) e, se mexer em fluxo/ZIP/compressão, a comparação com projetos reais (README, "Como o navegador roda a biblioteca").

## Decisões de produto

- Destino = slicer da fabricante. Altura de camada sem perfil exato → processo mais próximo + item "revisar". O usuário escolhe o **modelo**; o **bico** vem do projeto (sem bico → 0,4). Perfis HF fora do casamento automático.
- Limite de 300 MB (`site/src/configuracao.ts`). Cores: Kobra S1 8 (decisão do usuário); demais em `conversao/scripts/perfis/catalogo.json`, vários "a confirmar".
- Bambu Lab (repositório oficial do Bambu Studio, tag `v02.09.01.70`): modelos de dois bicos (H2D, H2D Pro, H2C, X2D) fora. Cabeçalho `Application` decide se a família Bambu carrega as configurações (README).
- Creality (Creality Print 7.3.1, tag `v7.3.1`): cabeçalho sempre `Creality_Print V7.3.1.6378 Release`; **sem** `creality.config` de propósito; K3 e Sermoon D3 Pro fora; `print_host` dos perfis oficiais sempre esvaziado.
- Snapmaker (Snapmaker Orca 2.4.1, tag `v2.4.1`): cabeçalho sempre `Snapmaker_Orca-2.4.1`; multicabeçote como troca de ferramenta; projetos do Snapmaker Orca aceitos como origem.
- Doação voluntária (Pix QR + copia e cola gerados no navegador, link opcional) em `site/src/configuracao.ts`; `doacao: null` esconde o quadro. **A chave Pix ainda não foi informada.**
- Contato público `conversor3mf@gmail.com` (decisão do usuário, 25/11/2026) em `site/src/configuracao.ts` (`contato`): link "mailto" no rodapé, na privacidade e nos erros de conversão; o e-mail leva só a mensagem de erro, nunca nome ou conteúdo do arquivo. É o único e-mail que pode aparecer no repositório.
- Tela: arquivo → resumo lido no navegador (origem com foto, filamentos/cores, prévia) → destino → download `<nome original>_<impressora>.3mf`.

## Pendências

- Confirmar no slicer: só Kobra S1 0.4 e Creator 5 0.4 foram abertos de verdade; Bambu Lab, Creality e Snapmaker nunca foram abertos nos slicers de destino; tabela de cores "a confirmar".
- Chave Pix. `fflate` 0.8.2 tem aviso moderado (em `unzipSync`, não usado); atualizar para 0.8.3 quando aprovado.

## Mapa rápido

- `conversao/src/`: `converterNucleo.ts` (conversão de um ZIP aberto para um fluxo), `converter.ts` (versão com arquivos, para Node/testes), `configProjeto.ts`, `modelSettings.ts`, `modeloPrincipal.ts` (3dmodel em streaming), `zipSeguro.ts` (+ `abrirLeitor`), `leitorBlob.ts`, `xmlSeguro.ts`, `perfis.ts` (+ `definirLeitorPerfis`) e `perfis/*.json` (302 perfis, 113 modelos, `indice.json`, `opcoes-<fabricante>.json`). `origem.ts`, `resumoProjeto.ts` e `erros.ts` são usados também pelo resumo da tela: mudou a regra de bico, filamentos ou recusa? Mude ali.
- `site/src/`: `Conversor.tsx`, `App.tsx` (privacidade em `#privacidade`), `conversor.worker.ts`, `ambienteNode.ts` (globais e ajustes do Node no Worker), `zlibNavegador.ts` (compressão nativa), `configuracao.ts`, `servicos/{analiseProjeto,leitorZip,formatos,nomeDownload,pix}.ts`, `componentes/`.
- Geradores: `conversao/scripts/gerar-perfis.mjs` (perfis + capas de destino), `gerar-capas-origem.mjs` (fotos de origem + `site/public/impressoras/origens.json`). Comando completo no README.

## Comandos

- `npm run instalar`, `npm run dev` (http://127.0.0.1:5174), `npm test`, `npm run lint`, `npm run build` (`site/dist`), `npm run audit`.
- Amostras reais (opcional, só números agregados): `AMOSTRAS_3MF_DIR=<sua pasta com os .3mf>` (+ `AMOSTRAS_MAX_MB=600`, `AMOSTRAS_MODELOS=todos`) com `npm --prefix conversao test -- amostras` ou `-- resumoNavegador`.
- Comparar navegador × Node: `npm --prefix conversao run build`, `node scripts/referencia-navegador.mjs <pasta> '[["a.3mf","modelo-id"]]'`, depois `AMOSTRAS_PAGINAS_DIR=<pasta> npm run dev` e `__rodar(...)` no console.

## Armadilhas conhecidas

- Medir velocidade no painel de navegador oculto engana (até 5× mais lento). Compare com um laço de CPU antes e depois.
- No build do Worker o plugin de polyfills não injeta `process`/`Buffer`: por isso `ambienteNode.ts` define as globais e é o PRIMEIRO import do Worker.
- `new URL("./x", import.meta.url)` na biblioteca vira arquivo copiado no build do Vite: use `/* @vite-ignore */` em código que só roda no Node.
- Regex em scripts node/python via heredoc corrompe `\b`, `\d`, `\\` etc.: editar arquivos com a ferramenta Edit.
- Clones esparsos do OrcaSlicer, BambuStudio, CrealityPrint e Snapmaker Orca (para os geradores) ficam fora do repositório; recriar com `git sparse-checkout` (README, "Como adicionar uma nova impressora"). No Git Bash, padrões que começam com `/` viram caminhos do Windows: use o modo cone.
