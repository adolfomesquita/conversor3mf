# Conversor 3MF

Converte projetos `.3mf` (Bambu Studio, OrcaSlicer e derivados, Anycubic Slicer Next, Creality Print, Snapmaker Orca) para impressoras de outras marcas, abertos nos slicers das fabricantes:

- Bambu Lab (11 modelos de um bico: X1, P1, P2S, A1, A2L, H2S, H3C) → Bambu Studio
- Creality (57 modelos de um bico: K1/K1C/K1 Max/K1 SE e variantes CFS-C, K2/K2 Plus/K2 Pro/K2 SE, Hi, Ender-3/5, CR, Sermoon, SPARKX e outros) → Creality Print
- Snapmaker (19 modelos: U1 com 4 cabeçotes, J1 e Artisan com 2, A250/A350 e variantes Dual/QS/B Kit) → Snapmaker Orca
- Anycubic (16 modelos: Kobra 1/2/3/4/X/S1 e variações) → Anycubic Slicer Next
- Flashforge (10 modelos: AD5X, Creator 5/5 Pro, Adventurer, Guider) → Orca-Flashforge

**Site:** https://adolfomesquita.github.io/conversor3mf/ — grátis, sem cadastro. **A conversão roda inteira no navegador: o arquivo não sai do computador.**

Licença: [AGPL-3.0](LICENSE) (a mesma dos perfis e imagens de impressoras, que vêm do OrcaSlicer, Bambu Studio, Creality Print e derivados).

## Estrutura

```
conversao/   biblioteca de conversão (TypeScript; roda no Node e no navegador)
  src/         conversão, leitura segura do ZIP/XML, perfis de destino (src/perfis/*.json)
  scripts/     geradores dos perfis e das imagens (a partir dos slicers e repositórios oficiais)
  test/        testes (projetos sintéticos, inclusive maliciosos)
site/        site estático (React + Vite), publicado no GitHub Pages
  src/         tela, Worker da conversão e adaptações do ambiente Node para o navegador
  public/      imagens das impressoras
scripts/     referencia-navegador.mjs (compara a conversão no navegador com a do Node)
docs/        achados do formato .3mf e dos perfis
```

## Desenvolvimento

Requer Node 24.

```bash
npm run instalar
```

```bash
npm run dev
```

Abre em http://127.0.0.1:5174. Outros comandos: `npm test` (biblioteca), `npm run lint`, `npm run build` (gera `site/dist`), `npm run audit`.

Publicação: cada push na `main` roda os testes e publica o site (`.github/workflows/pages.yml`).

## Como o navegador roda a biblioteca

A conversão roda num Worker (`site/src/conversor.worker.ts`), para a página não travar, com o mesmo código que os testes usam no Node:

- `vite-plugin-node-polyfills` fornece `stream`, `Buffer` etc. `site/src/ambienteNode.ts` (importado primeiro no Worker) define `process`/`Buffer`/`global` (o plugin não as injeta no build do Worker), `setImmediate` por `MessageChannel`, `process.nextTick` por microtarefa e texto UTF-8 por `TextDecoder`/`TextEncoder`.
- O `zlib` vira `site/src/zlibNavegador.ts`, com a compressão nativa do navegador (`CompressionStream`/`DecompressionStream` "deflate-raw") e fila de leitura limitada a 8 MB.
- Na biblioteca: `converterNucleo.ts` converte um ZIP aberto para um fluxo de saída (`converter.ts` é a versão com arquivos, usada nos testes e no Node); `ZipSeguro.abrirLeitor` e `leitorBlob.ts` leem o arquivo escolhido em pedaços de 2 MB; `definirLeitorPerfis` troca a leitura dos perfis (o Worker baixa só os do modelo escolhido).
- `conversao/test/leitorBlob.unidade.test.ts` garante que o caminho do navegador dá o mesmo resultado do caminho com arquivos. Conferido no navegador com 6 projetos reais (2,7 a 254 MB; origens Bambu, Creality e Snapmaker; destinos das 5 marcas): conteúdo de cada arquivo e relatório idênticos; 254 MB em cerca de 60 s. Os bytes compactados diferem (outro compressor); o conteúdo não.
- Para repetir a comparação: `scripts/referencia-navegador.mjs` (instruções no topo) e, no console do `npm run dev` com `AMOSTRAS_PAGINAS_DIR`, `__rodar(base, casos)` (só existe no modo de desenvolvimento).
- Navegadores sem `CompressionStream` "deflate-raw" (Chrome < 103, Firefox < 113, Safari < 16.4) não convertem.

## Configuração do site

`site/src/configuracao.ts`: limite de tamanho (300 MB), doação (Pix e/ou link; `null` esconde o quadro "Apoie o projeto") link do código-fonte, e-mail de contato e endereço de contagem do GoatCounter (`estatistica`; `null` desliga). A contagem (`site/src/servicos/estatistica.ts`) monta o pedido sem carregar script de fora, só no site publicado em https, e respeita Do Not Track/Global Privacy Control; o que é enviado está descrito na página de privacidade. O Pix (QR e copia e cola) é gerado no navegador (`site/src/servicos/pix.ts`); nenhum pagamento passa pelo site.

## Testes com projetos reais

Opcional (nada disso vai para o repositório): `AMOSTRAS_3MF_DIR` com a pasta dos projetos e, para abrir os resultados nos slicers, `AMOSTRAS_SAIDA_DIR` com a pasta de saída. `AMOSTRAS_MAX_MB` (padrão 25) e `AMOSTRAS_FILTRO` limitam quais arquivos entram; `AMOSTRAS_MODELOS=todos` converte para todos os destinos. Só números agregados são impressos.

```bash
npm --prefix conversao test -- amostras
```

## Conversão

**Destinos: 113 modelos, 302 perfis (modelo + bico)** de cinco fabricantes, em `conversao/src/perfis/` com um `indice.json`:

| Fabricante | Slicer de destino | Pacote de perfis | Modelos |
|---|---|---|---|
| Bambu Lab | Bambu Studio 2.9.1 (perfis e opções do repositório oficial, tag `v02.09.01.70`) | `BBL.json` 02.09.00.74 | X1 Carbon, X1, X1E, P1S, P1P, P2S, A1, A1 mini, A2L, H2S, H3C |
| Snapmaker | Snapmaker Orca 2.4.1 (perfis e opções do repositório oficial, tag `v2.4.1`) | `Snapmaker.json` 02.03.04.04 | U1 (4 cabeçotes), J1 e Artisan (2), A250 e A350 (com variantes Dual, QSKit, QS+B Kit, BKit) |
| Creality | Creality Print 7.3.1 (build 6378; perfis e opções do repositório oficial, tag `v7.3.1`) | `Creality.json` 26.10.29.20 | K1, K1C, K1 Max, K1 SE (e as variantes CFS-C/2025), K2, K2 Plus, K2 Pro, K2 SE, Hi, Ender-2 Pro, Ender-3 (V2/V3/V3 KE/V3 SE/V3 Plus/V3 Mega/V3 Neo/V4/S1…), Ender-5 (Max/Plus/S1), CR-6/CR-10/CR-20/CR-30/CR-M4, GS-01 a 04, Sermoon D3/M300/V1 Pro, Z2, mBox, SPARKX i7/i8 |
| Anycubic | Anycubic Slicer Next 2.0.0.3 | `Anycubic.json` 1.3.2609.02 | Kobra 1/1 Plus/1 Max, Kobra 2/2 Neo/2 Pro/2 Plus/2 Max, Kobra 3/3 V2/3 Max/3 Max V2, Kobra 4, Kobra X, Kobra S1, Kobra S1 Max |
| Flashforge | Orca-Flashforge (Flash Studio Desktop 1.7.21) | `Flashforge.json` 02.04.00.10 | Adventurer 3 Series, Adventurer 5M/5M Pro, Adventurer A5, AD5X, Creator 5/5 Pro, Guider 3 Ultra, Guider4/4 Pro |

- **Escolha:** o usuário escolhe o **modelo**; o perfil (bico) sai do `nozzle_diameter` do projeto. Bico sem perfil = recusa com a lista dos bicos disponíveis. Bicos HF (Guider 4) ficam fora da escolha automática.
- **Só Kobra S1 0.4 e Creator 5 0.4 foram abertos num slicer real** e têm regras de filamento escritas à mão (`sobrescritas` em `catalogo.json`). Os demais são gerados automaticamente (filamento genérico por tipo) e testados de forma sintética (`test:conversao` converte um projeto em cada um dos 302 perfis).
- Fora do catálogo: Flashforge Guider 2s (o pacote não tem processo compatível) e os modelos de **vários bicos**: Bambu Lab H2D, H2D Pro, H2C, X2D; Creality K3 (4 cabeçotes) e Sermoon D3 Pro (2 bicos), em `excluirModelos`: a conversão ainda não distribui filamentos entre os bicos.
- **Bambu Lab ainda não foi aberto no Bambu Studio.** O formato foi conferido contra projetos genuínos do Bambu Studio 2.8 (P1S, A1, X1C) e o código-fonte da 2.9.1 (`bbs_3mf.cpp`, `PrintConfig.cpp`).
- **Creality ainda não foi aberta no Creality Print.** O formato foi conferido contra um projeto genuíno do Creality Print 7.1.1 (K2 Plus) e o código-fonte da 7.3.1 (`bbs_3mf.cpp`, `Check3mfVendor.cpp`, `PrintConfig.cpp`). Nomes com `_` no perfil (ex.: `Creality K1C_CFS-C`) aparecem com espaço na tela.
- **Máximo de cores por modelo** (tabela `cores` em `catalogo.json`, com a fonte de cada valor):

| Modelo | Cores | Fonte |
|---|---|---|
| Bambu Lab X1/X1 Carbon/X1E, P1S, P1P, P2S, H2S, H3C | 16 | assumido: até 4 AMS de 4 cores — **a confirmar** |
| Bambu Lab A1, A1 mini, A2L | 4 | assumido: AMS lite — **a confirmar** |
| Creality K2, K2 Plus, K2 Pro | 16 | assumido: até 4 CFS de 4 cores — **a confirmar** |
| Creality K1/K1C/K1 Max/K1 SE CFS-C (e 2025 CFS-C), Hi, SPARKX i7 | 4 | assumido: um sistema de 4 cores — **a confirmar** |
| Demais Creality (K1/K1C/K1 Max sem CFS-C, K2 SE, Ender, CR, GS, Sermoon, Z2, mBox, SPARKX i8) | 1 | uma extrusora, sem sistema multicor conhecido — **a confirmar** |
| Kobra S1 | 8 | decisão do usuário (dois ACE Pro) |
| Kobra S1 Max | 8 | assumido por analogia com o S1 — **a confirmar** |
| Kobra 3, 3 V2, 3 Max, 3 Max V2 | 4 | assumido: um ACE Pro — **a confirmar** |
| AD5X | 4 | sistema IFS de 4 cores |
| Creator 5, Creator 5 Pro | 4 | 4 cabeçotes |
| Guider 3 Ultra | 2 | 2 extrusoras no perfil (bico 0,4) |
| Demais (Kobra 1/2/4/X, Adventurer, Guider 4) | 1 | uma extrusora, sem sistema multicor conhecido — **a confirmar** |

- **Valores de lista fixa (enum):** cada perfil traz `valoresAceitos` (opções do OrcaSlicer presentes na biblioteca do slicer de destino, ou do `PrintConfig.cpp` do próprio Bambu Studio/Creality Print, + valores usados nos perfis dele). Valor de origem fora da lista é traduzido nos dois sentidos (`support_style` `tree_organic` ⇄ `organic`; `filament_map_mode` `Auto For Flush` ⇄ `AutoForSaving` e `Auto For Match` ⇄ `AutoForMatch` no Creality Print) ou descartado com revisão, também nas configurações por objeto. Sem isso o slicer substitui o valor ao abrir e mostra o aviso "configuração gerada por uma versão mais recente".

O que a conversão faz:

- **Geometria, pintura, peças, modificadores, miniaturas:** copiados byte a byte (o arquivo de malha nunca é reescrito).
- **Posição:** cada objeto fica na mesma posição dentro da sua placa. Se a mesa do destino tem outro tamanho, só a translação dos itens de montagem muda, para acompanhar a grade de placas do slicer.
- **`project_settings.config`:**
  - impressora: substituída pelo perfil de destino;
  - processo: o de destino com a mesma altura de camada. Sem altura igual, usa o mais próximo, mantém a altura original e marca "revisar";
  - mudanças do usuário no processo (`different_settings_to_system`): reaplicadas. Velocidades e acelerações ficam marcadas para revisão. Mudança numa opção que o perfil de destino não define: **mantida** se o slicer de destino conhece a opção; **descartada** (sem efeito no destino, sem pedir revisão) se ele não tem. A lista de opções de cada slicer fica em `perfis/opcoes-<fabricante>.json`, gerada do `PrintConfig.cpp` do próprio slicer (Bambu Studio, Creality Print) ou das opções do OrcaSlicer presentes na biblioteca instalada (Anycubic, Flashforge), mais as chaves usadas nos perfis;
  - filamentos: mapeados por tipo (regras automáticas do gerador ou `sobrescritas` em `conversao/scripts/perfis/catalogo.json`), mantendo cor, ordem e quantidade. Das mudanças por filamento, só temperatura, ventilação e custo voltam; calibrações da impressora de origem (fluxo, pressure advance, retração) são descartadas;
  - mudanças na impressora de origem: descartadas.
- **Removidos:** `slice_info.config`, `filament_sequence.json`, presets de usuário embutidos e o mapeamento de AMS/bicos do Bambu.
- **Cabeçalho `Application` do 3dmodel:** os slicers da família Bambu só carregam as configurações se ele começar com `BambuStudio-`, e o Bambu Studio trata versões antigas como projeto legado (reposiciona placas abaixo de 1.5.9, muda a torre de limpeza abaixo de 2.0). Destino Bambu Studio: sempre `BambuStudio-02.09.01.70` (quem tiver versão mais antiga vê o aviso de projeto de versão nova). Anycubic e Flashforge: mantido se for da família Bambu; senão (ex.: Creality Print), trocado pelo do slicer de destino. Destino Creality Print: sempre `Creality_Print V7.3.1.6378 Release`, porque sem "Creality" no cabeçalho (ou `Metadata/creality.config`) ele abre a janela "este projeto não é do Creality Print", pede a impressora e refaz as configurações (`Check3mfVendor.cpp`). Destino Snapmaker Orca: sempre `Snapmaker_Orca-2.4.1` (ele só trata como projeto da família `BambuStudio-` e `Snapmaker_Orca-`; com outro cabeçalho divide objetos repetidos e trata como projeto de terceiros). Projetos salvos pelo Snapmaker Orca também são aceitos como origem.
- **Creality Print 7.3.1** (destino Creality): `Metadata/creality.config` **não** é gravado, de propósito: sem ele o slicer converte os antigos padrões 1/1/1 de `wall_filament`/`sparse_infill_filament`/`solid_infill_filament` para 0 ("filamento do objeto"), que é o padrão da 7.3. Listas gravadas como texto nos perfis da Creality (`"220"`, `"0x0,153x0,…"`, `"a;\"b\""`) são convertidas para lista pelo gerador, conforme o tipo no `PrintConfig.cpp` (as velocidades viraram listas na 7.3; o projeto genuíno 7.1.1 ainda as grava como valor único). `material_flow_temp_graph` é de valor único e sai do primeiro filamento.
- **Formato Bambu Studio 2.x** (destino Bambu): valores de filamento por variante de bico gravados um por filamento na variante padrão, com `filament_self_index`, `filament_nozzle_map` e `filament_volume_map`; valores com várias entradas por filamento (`filament_dev_*`, secagem no AMS) gravados em sequência.
- **Nunca copiados da origem:** G-code, `post_process` (scripts), `print_host`/`printhost_*`/`host_type`, inclusive nas configurações por objeto. Endereço e credenciais de envio (`print_host`, `print_host_webui`, `printhost_apikey`…) ficam vazios mesmo quando o perfil de destino os traz (perfis oficiais da Creality para Ender-3 V3, Hi e SPARKX vêm com o IP de rede interna de quem os criou).
- **Recusados:** `.gcode.3mf` (G-code embutido ou placa apontando para G-code), bico diferente do perfil, arquivos que não são projeto.
- **Avisos no relatório:**
  - objeto maior que a mesa;
  - objeto fora da área da placa;
  - mais cores do que a impressora suporta;
  - altura aproximada;
  - filamento sem equivalente;
  - comandos por camada (`custom_gcode_per_layer.xml`);
  - projeto sem registro das mudanças do usuário.

Proteções contra arquivo malicioso (limites em `conversao/src/limites.ts`, todos configuráveis):

| Proteção | Padrão |
|---|---|
| Entradas no ZIP | 5.000 |
| Total descompactado | 2 GB (bytes contados de verdade, não só os declarados) |
| Maior entrada descompactada | 1 GB |
| Razão de compressão por entrada (> 1 MB) | 200× |
| Configurações lidas em memória (JSON/XML de `Metadata`, rels) | 64 MB; malhas e o modelo principal (até 478 MB nos projetos reais) são sempre lidos em streaming |
| Profundidade de XML | 128 |

Também: nomes com `..`, absolutos, drive, barra invertida, caracteres de controle, duplicados (inclusive só por maiúsculas), links simbólicos e entradas criptografadas são recusados; XML com qualquer `DOCTYPE` é recusado (sem entidades externas); o JSON de configuração ignora `__proto__`/`constructor` e valores não textuais.

Desempenho medido com a biblioteca final, nesta máquina, sempre em streaming: maior projeto real (265 MB, 1,36 GB de XML) em **44 s, pico de 246 MB**; projeto com modelo principal de 478 MB em **30 s, pico de 236 MB**.

### Como adicionar uma nova impressora

Novos modelos de uma fabricante já no catálogo entram sozinhos ao regerar (o gerador percorre todo o pacote de perfis dela). Para uma **fabricante nova**:

1. Instale o slicer da fabricante e localize a pasta `resources/profiles` dele e a biblioteca principal (`.dll`).
2. Em `conversao/scripts/perfis/catalogo.json`, acrescente em `fabricantes`: pastas de perfis, arquivo do pacote, nome/versão do slicer, `versaoProjeto` gravada no projeto, tipo de placa. Acrescente em `cores` o máximo de cores dos modelos multicor (com a fonte). Use `excluirModelos` para deixar algum de fora.
3. Tenha um clone do repositório oficial do OrcaSlicer (https://github.com/OrcaSlicer/OrcaSlicer): ele fornece as imagens dos modelos e a lista de opções de valor fixo (`src/libslic3r/PrintConfig.cpp`). Para o Bambu Studio, que é código aberto, use um clone do repositório oficial (https://github.com/bambulab/BambuStudio) na tag da versão pública: `--raiz bambu=<clone>/resources/profiles` e `--enums bambu=<clone>/src/libslic3r/PrintConfig.cpp` (opções direto do código do slicer, sem `--binario`). Clone esparso: `git clone --depth 1 --branch v02.09.01.70 --filter=blob:none --sparse https://github.com/bambulab/BambuStudio.git` e `git sparse-checkout set resources/profiles/BBL src/libslic3r`. O mesmo para o Creality Print (https://github.com/CrealityOfficial/CrealityPrint, tag `v7.3.1`) e o Snapmaker Orca (https://github.com/Snapmaker/OrcaSlicer, tag `v2.4.1`, pastas `resources/profiles/Snapmaker` e `src/libslic3r`, com `--raiz snapmaker=` e `--enums snapmaker=`): `git sparse-checkout set resources/profiles src/libslic3r`, com `--raiz creality=<clone>/resources/profiles` e `--enums creality=<clone>/src/libslic3r/PrintConfig.cpp`. Com `--enums`, o gerador também usa os tipos das opções desse arquivo para gravar como lista o que o perfil grava como texto.
4. Gere os perfis (uma linha; os caminhos são os desta máquina):

   ```bash
   npm --prefix conversao run gerar-perfis -- --raiz "anycubic=C:/Program Files/AnycubicSlicerNext/resources/profiles" --raiz "flashforge=C:/Program Files/Flashforge/Flash Studio Desktop/resources/profiles" --binario "anycubic=C:/Program Files/AnycubicSlicerNext/AnycubicSlicer.dll" --binario "flashforge=C:/Program Files/Flashforge/Flash Studio Desktop/Orca-Flashforge.dll" --capas "C:/caminho/do/clone/OrcaSlicer" --raiz "bambu=C:/caminho/do/clone/BambuStudio/resources/profiles" --enums "bambu=C:/caminho/do/clone/BambuStudio/src/libslic3r/PrintConfig.cpp" --raiz "creality=C:/caminho/do/clone/CrealityPrint/resources/profiles" --enums "creality=C:/caminho/do/clone/CrealityPrint/src/libslic3r/PrintConfig.cpp" --raiz "snapmaker=C:/caminho/do/clone/SnapmakerOrca/resources/profiles" --enums "snapmaker=C:/caminho/do/clone/SnapmakerOrca/src/libslic3r/PrintConfig.cpp"
   ```

   O gerador resolve a herança (`inherits`), confere a compatibilidade de cada processo/filamento com a máquina, escolhe os filamentos por tipo, grava `conversao/src/perfis/<id>.json` e o `indice.json`, copia as imagens para `site/public/impressoras/` (origem em `ORIGEM.md`) e lista os modelos pulados.
5. Rode `npm test` (testa todos os perfis com um projeto sintético), converta alguns projetos reais (suíte opcional acima, `AMOSTRAS_MODELOS=todos`) e abra o resultado no slicer da fabricante antes de publicar. Para um perfil conferido no slicer, fixe as regras de filamento em `sobrescritas`.

## Limitações conhecidas

- Só Kobra S1 0.4 e Creator 5 0.4 foram abertos de verdade no slicer de destino. Bambu Studio 2.9.1, Creality Print 7.3.1 e Snapmaker Orca 2.4.1 ainda não. A tabela de cores tem valores "a confirmar".
- O GitHub Pages não permite configurar cabeçalhos HTTP: sem `X-Frame-Options`/`frame-ancestors`, o site pode ser exibido dentro de outro.

Achados da inspeção dos .3mf e dos perfis: [docs/inspecao-3mf-e-perfis.md](docs/inspecao-3mf-e-perfis.md).
