# Inspeção: estrutura real dos .3mf e dos perfis OrcaSlicer

> Documento de inspeção feito na fase inicial, quando a conversão rodava num servidor (Cloud Functions). Hoje ela roda no navegador; os achados sobre o formato e os perfis continuam valendo.

Data: 11/11/2026. Fontes analisadas (somente leitura, nada foi copiado para o projeto):

- 230 arquivos .3mf em `Downloads` (154 com `project_settings.config`; ~60 do Bambu Studio, de 01.09 a 02.08.02.61, além de arquivos do Anycubic Slicer Next e do Orca-Flashforge).
- OrcaSlicer oficial: `SoftFever/OrcaSlicer`, commit `32dbacb` (12/11/2026), `resources/profiles/{Anycubic,Flashforge,OrcaFilamentLibrary,BBL}`.
  - Os perfis da instalação local (`C:\Program Files\OrcaSlicer\resources\profiles\*.opc`) estão num formato empacotado (`ZCRO`) que não dá para ler direto, por isso usei o repositório.
- Forks das fabricantes já instalados:
  - Anycubic Slicer Next: perfis versão `1.3.2609.02`.
  - Orca-Flashforge: perfis versão `02.04.00.10`, em `%APPDATA%\Orca-Flashforge\system`.

## 1. Estrutura do pacote .3mf (Bambu Studio)

| Entrada | Conteúdo | Tratamento previsto |
|---|---|---|
| `3D/3dmodel.model` | XML 3MF Core + namespace `BambuStudio`. Projetos antigos trazem a malha inteira embutida aqui: até **478 MB** de XML (corrigido na Fase 3; a primeira inspeção subestimou). Por isso é sempre lido em streaming. | Copiar byte a byte |
| `3D/Objects/*.model` + `3D/_rels/3dmodel.model.rels` | Malhas (extensão Production, `p:path`). Uma entrada chegou a **478 MB** descompactada. | Copiar byte a byte |
| Atributos `paint_color`, `paint_supports`, `paint_seam` nos triângulos | Pintura multicor e de suporte/costura | Intocados (estão dentro da malha) |
| `Metadata/model_settings.config` | Objetos, peças (`normal_part`, modificadores), matriz/posição, `extruder` por objeto/peça, **overrides por objeto** (`wall_loops`, `brim_type`, `layer_height`, `sparse_infill_*`...), placas (`<plate>`: `filament_maps`, `filament_map_mode`, `filament_volume_maps`, `gcode_file`, miniaturas) | Manter; limpar só chaves de placa ligadas a AMS/G-code; validar `extruder` contra o número de filamentos |
| `Metadata/project_settings.config` | **JSON plano e totalmente resolvido** (não é referência a preset): ~357 chaves no Bambu, 601–669 nos forks Orca | Reescrever (núcleo da conversão) |
| `Metadata/process_settings_N.config`, `filament_settings_N.config`, `machine_settings_N.config` | Presets de **usuário** do Bambu embutidos no projeto | Remover |
| `Metadata/slice_info.config`, `plate_N.gcode`, `plate_N.gcode.md5`, `filament_sequence.json` | Dados de fatiamento/AMS do Bambu | Remover |
| `Metadata/plate_N.png`, `top_N.png`, `pick_N.png`, `plate_no_light_N.png`, `plate_N.json` | Miniaturas e dados de placa | Manter (o slicer regenera) |
| `Metadata/cut_information.xml`, `layer_heights_profile.txt`, `layer_config_ranges.xml`, `custom_gcode_per_layer.xml`, `brim_ear_points.txt`, `assembly_model.json` | Recursos de projeto suportados pelo Orca | Manter; o `custom_gcode_per_layer.xml` exige revisão (pode conter G-code do Bambu) |
| `Auxiliaries/**` | Fotos e capa do MakerWorld | Manter |
| `_rels/.rels`, `[Content_Types].xml` | OPC | Manter |

Conclusão: a geometria nunca precisa ser lida como XML. Basta copiar as entradas do ZIP e reescrever só os arquivos de `Metadata/`. Isso preserva pintura, modificadores e posição, e evita carregar centenas de MB na memória.

## 2. `project_settings.config`

- **`different_settings_to_system`** é um array de tamanho `N filamentos + 2`, no formato `[processo, filamento_1..N, impressora]`. Cada item é uma lista de chaves separadas por `;`. Exemplos reais:
  - processo: `"brim_type;enable_support;sparse_infill_density;support_threshold_angle"`
  - filamento: `"filament_prime_volume"`, `"filament_flow_ratio;nozzle_temperature"`
  - impressora: `"z_offset"`, `"nozzle_type"`
- Em alguns arquivos o array está ausente (`null`). Nesse caso não dá para saber o que o usuário mudou, e o relatório dirá que só o perfil de processo do destino foi aplicado.
- **Plano de reaplicação:**
  - diffs de **processo**: reaplicados sobre o processo de destino;
  - diffs de **filamento**: reaplicados por filamento, só nas chaves seguras;
  - diffs de **impressora**: descartados (z_offset, nozzle_type... são da máquina de origem) e listados no relatório.
- Origens com nome de preset de usuário (`"0.20mm Standard P1S-copy"`, `"Coasters ed Lightboxes"`) também funcionam, porque o diff é sempre relativo ao preset de sistema.
- **Arrays por extrusora:**
  - Creator 5: arrays de **4** (`nozzle_diameter`, `extruder_colour`, `retraction_*`...) e `machine_max_*` de 8 (pares normal/silencioso × 4).
  - Origens Bambu H2D/H2C: dois bicos, com arrays de 2 e `filament_map` atribuindo filamento a bico.
- **Chaves exclusivas Bambu a remover:** AMS e mapeamento (`filament_map`, `filament_map_mode`, `physical_extruder_map`, `nozzle_volume_type`, `filament_ids` GFxxx), `flush_volumes_matrix` (recalculado para o destino), `machine_start/end_gcode` e G-codes de troca (vêm do perfil de destino), `host_type`/`print_host` e `curr_bed_type` (validar contra as placas do destino).
- Cores ficam em `filament_colour` (`#RRGGBB`). A ordem dos filamentos é a que os objetos referenciam via `extruder` (base 1) no `model_settings.config` e via `paint_color`. Por isso a ordem e a quantidade de filamentos precisam ser preservadas.

## 3. Perfis de destino

Os perfis seguem a cadeia `inherits` (por exemplo, `Flashforge Creator 5 0.4 nozzle` herda de `Flashforge Adventurer 5M Pro 0.4 Nozzle`, que herda de `fdm_machine_common`). Cada JSON versionado nas Functions será **achatado** (cadeia resolvida) e guardará a origem (repositório/fork + commit).

| | Anycubic Kobra S1 0.4 | Flashforge Creator 5 0.4 |
|---|---|---|
| Mesa | 250 × 250 × 250 mm | 256 × 256 × 256 mm |
| Extrusão | 1 bico, `single_extruder_multi_material=1` (ACE Pro: troca com purga) | **4 cabeçotes independentes** (troca de ferramenta, sem purga entre cores) |
| Firmware | Klipper | Klipper |
| Processos 0.4 no **OrcaSlicer oficial** | **só 0.20 mm** | 0.12, 0.20, 0.24 |
| Processos 0.4 no **fork da fabricante** | 0.08, 0.12, 0.16, 0.20 (Std e HQ), 0.24, 0.28 | 0.08, 0.10, 0.12, 0.20, 0.24 |
| Filamentos dedicados (oficial) | Anycubic PLA/PLA+/HS/Silk, PETG, ABS, ASA, TPU + Polymaker | ~37: PLA (vários), PETG, ABS, ASA, TPU, PA/PET/PPS-CF, PVA, BVOH, HIPS |
| Genéricos (`@System`, OrcaFilamentLibrary) | 295 compatíveis com qualquer máquina | idem |

**Os forks divergem do oficial:** os nomes mudam (`Generic PLA @Flashforge` × `Flashforge Generic PLA`), os conjuntos de chaves mudam (o fork Flashforge tem 149 chaves de máquina, o oficial 127) e até o formato dos valores muda (`#FF4D4F` × `FF4D4F`). Se o .3mf citar um perfil que o slicer não conhece, ele abre como preset "modificado/de projeto". Funciona, mas perde o vínculo com o perfil de sistema.

## 4. Os arquivos `*_projeto_*.3mf` em Downloads

Pelo campo `version`, foram salvos pelos próprios slicers das fabricantes (`2.0.0.3` = Anycubic Slicer Next, `01.10.01.50` = Orca-Flashforge). Problemas observados:

- `Tealight..._projeto_Flashforge_Creator_5.3mf`: os 5 filamentos/cores do original viraram **1** (`Generic PLA @FF C5`), e as cores se perderam.
- `Tealight..._projeto_Anycubic_Kobra_S1.3mf`: filamentos e cores diferentes do original e 3 placas, o que indica edição manual depois da importação.

Por isso não vou usá-los como gabarito sem confirmação.

## 5. Calibração das proteções de entrada (230 amostras)

| Métrica | Máximo observado |
|---|---|
| Tamanho do arquivo | **265 MB** (40 de 230 passam de 50 MB, ~17%) |
| Total descompactado | **1,37 GB** |
| Maior entrada descompactada | 478 MB |
| Nº de entradas | 340 |
| Taxa de compressão por entrada | ~40× |
| Taxa global | ~10,5× |
| `.gcode` embutido | 0 arquivos (`gcode_file` aparece em 16 placas, mas vazio) |

Limites propostos (configuráveis):
- arquivo: 50 MB, conforme o pedido;
- total descompactado: 1,5 GB;
- maior entrada: 600 MB;
- entradas: 2.000;
- taxa por entrada: 200×.

Também: processamento em **streaming** (sem carregar o ZIP inteiro) e Function com 2–4 GiB.

**`.gcode.3mf`** é recusado se o pacote contiver G-code (`*.gcode`, `Metadata/plate_N.gcode`) ou se uma placa apontar para uma entrada existente. *Correção na Fase 3:* 7 projetos legítimos têm `gcode_file` preenchido sem o arquivo no pacote (sobra de um fatiamento não salvo); nesses, a referência é só esvaziada e registrada no relatório.

## 6. Decisões tomadas (11/11/2026)

1. **Slicer de destino: o da fabricante.** Kobra S1 → Anycubic Slicer Next; Creator 5 → Orca-Flashforge. Os perfis versionados vêm desses forks, com a versão do pacote registrada em cada JSON.
2. **Altura sem perfil exato:** usar o processo de altura mais próxima, manter a altura original e marcar "exige revisão".
3. **Limite de upload: 300 MB** (configurável). A Function de conversão precisa de mais memória e tempo, com streaming obrigatório.
4. **Cores do Kobra S1: até 8** (dois ACE Pro). Creator 5: 4.
5. **JDK 21** instalado via winget para os emuladores.

## 7. Verificações da Fase 3 (12/11/2026)

- **Perfis de destino** extraídos das instalações locais:
  - Anycubic Slicer Next 2.0.0.3, pacote `Anycubic.json` 1.3.2609.02;
  - Flash Studio Desktop 1.7.21, que embute o Orca-Flashforge, pacote `Flashforge.json` 02.04.00.10.

  Todos os valores de filamento são listas de 1 elemento, então o projeto monta uma lista por filamento.
- **Grade de placas do Bambu:**
  - colunas = `ceil(sqrt(n))`, espaço de 1/5 da mesa entre placas;
  - conferida em 4 projetos reais (mesas 256×256 e 330×320, até 30 placas): 82 de 82 objetos dentro da placa calculada.
- **Os `_projeto_` da Anycubic não foram salvos pelo slicer:** `3dmodel.model` e `model_settings.config` são idênticos aos originais (cabeçalho `BambuStudio`, metadados de placa). Por isso não servem de referência de formato.
- **O `_projeto_` do Creator 5 (Summoned Warrior) foi salvo pelo slicer:** tem metadado `OrcaSlicer 2.4.2` e versão `02.06.00.51`. Ele mantém `filament_map` = 1 com modo "Auto For Flush" e 7 filamentos para 4 cabeçotes.
- **Versão gravada no projeto:**
  - Kobra S1: `2.0.0.3`, a versão do app;
  - Creator 5: `02.06.00.51`, vista no projeto do Creator 5 salvo pelo slicer e no `Orca-Flashforge.dll`. É uma **suposição**, ajustável no perfil.
- **Desempenho no maior projeto** (265 MB, 1,36 GB de XML), nesta máquina:
  - teste inicial: 100–140 s;
  - biblioteca final com o parser com namespaces: 239 s;
  - biblioteca final com o parser sem namespaces nas malhas: 78 s, pico de 241 MB;
  - versão final, com o modelo principal em streaming e sem leitura duplicada: **44 s, pico de 246 MB**. É o número que vale para a Fase 4.
  - Projeto com modelo principal de 478 MB (malha embutida): **30 s, pico de 236 MB**.
- **Avisos de posição conferidos um a um:** os 10 projetos com "fora da área" ou "objeto sem placa" (9 do lote mais o São Paulo FC, de 478 MB) já tinham objetos fora da placa no original, ou têm objetos perto da borda que passam de 250 mm. Nos projetos feitos para o Kobra S1, os objetos das outras placas caem dentro da grade calculada, o que indica que o slicer da Anycubic usa a mesma grade.
- **Valores por variante de bico** (Bambu 2.x): velocidades por `print_extruder_variant` e valores de filamento por `filament_self_index` + `filament_extruder_variant`. A conversão usa a variante ativa e ajusta o valor à forma do destino.
- **Lote:** 120 projetos reais de até 25 MB convertidos para os dois destinos, 226 conversões e nenhum erro inesperado.
  - 14 recusas, todas pela regra antiga de G-code, corrigida acima.
  - Avisos mais comuns:
    - sem registro das mudanças do usuário (54);
    - comandos por camada (48);
    - mais cores que o destino suporta (22);
    - altura aproximada (13);
    - fora da área (13).
- **Modo de linha de comando do Anycubic Slicer Next:** fecha com erro ao carregar o projeto (crash reporter). Não há verificação automática no slicer; a validação final é abrir os arquivos convertidos nos slicers.

## 8. Perguntas originais

1. **Qual slicer abrirá o arquivo convertido?** OrcaSlicer oficial, Anycubic Slicer Next / Orca-Flashforge, ou ambos como destinos separados. Isso define a fonte da verdade dos perfis.
2. **Altura de camada sem perfil exato** (ex.: 0.16 mm no Kobra S1 do Orca oficial): usar o processo mais próximo, sobrescrever `layer_height` e marcar "exige revisão" (recomendado), ou recusar?
3. **Limite de 50 MB:** cerca de 17% dos seus arquivos reais passam disso (até 265 MB). Manter 50 MB ou subir? Subir implica mais memória/tempo na Function e mais custo.
4. **Limite de cores do Kobra S1:** o pedido só cita os 4 do Creator 5. Para o S1, 4 (um ACE Pro) ou 8 (dois ACE Pro)?
5. **Java para os emuladores:** o Firestore/Storage Emulator exige **JDK 21+**, e não há Java instalado. Posso instalar via `winget install Microsoft.OpenJDK.21`?
6. **Origem dos `_projeto_`:** foram gerados por você no slicer da fabricante, ou por outra ferramenta?
