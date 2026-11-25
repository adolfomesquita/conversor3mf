// Núcleo da conversão: reescreve Metadata/project_settings.config para a impressora de destino.
//
// 1. Bloco da máquina: substituído pelo perfil de destino.
// 2. Processo: o do destino com a mesma altura de camada (ou o mais próximo, mantendo a altura
//    original e marcando revisão); só as configurações que o usuário mudou na origem
//    (different_settings_to_system[0]) são reaplicadas.
// 3. Filamentos: remapeados por tipo, mantendo cor, ordem e quantidade. Das mudanças do usuário
//    por filamento, só temperaturas/ventilação/custo são reaplicadas; calibrações da impressora de
//    origem (fluxo, pressure advance, retração...) são descartadas.
// 4. Mudanças na impressora de origem: descartadas.
// 5. Nunca copia da origem nada executável ou ligado a hosts: G-code, post_process, print_host...
import { ErroConversao } from "./erros.js";
import type { LimitesConversao } from "./limites.js";
import { opcoesDoSlicer, type ConfigPlana, type PerfilAlvo, type ProcessoAlvo, type RegraFilamento, type ValorConfig } from "./perfis.js";
import type { FilamentoRelatorio, Relatorio } from "./relatorio.js";
import { bicoDoProjeto, quantidadeFilamentos } from "./resumoProjeto.js";

export type ConfigOrigem = ReadonlyMap<string, ValorConfig>;

const CHAVE_VALIDA = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const CHAVES_PROIBIDAS = new Set(["__proto__", "constructor", "prototype"]);

/** Chaves que nunca são copiadas da origem: executam algo, enviam para hosts ou são G-code. */
export function chaveBloqueada(chave: string): boolean {
  return /(^|_)gcode$|^post_process$|^print_host|^printhost_|^host_type$|^bbl_use_printhost$|^printer_agent$/.test(chave);
}

/** Mudanças por filamento que fazem sentido em outra impressora (o resto é calibração da origem). */
const FILAMENTO_REAPLICAVEL = new Set([
  "nozzle_temperature",
  "nozzle_temperature_initial_layer",
  "hot_plate_temp",
  "hot_plate_temp_initial_layer",
  "textured_plate_temp",
  "textured_plate_temp_initial_layer",
  "cool_plate_temp",
  "cool_plate_temp_initial_layer",
  "eng_plate_temp",
  "eng_plate_temp_initial_layer",
  "supertack_plate_temp",
  "supertack_plate_temp_initial_layer",
  "fan_min_speed",
  "fan_max_speed",
  "fan_cooling_layer_time",
  "slow_down_layer_time",
  "slow_down_min_speed",
  "overhang_fan_speed",
  "overhang_fan_threshold",
  "close_fan_the_first_x_layers",
  "full_fan_speed_layer",
  "additional_cooling_fan_speed",
  "reduce_fan_stop_start_freq",
  "enable_overhang_bridge_fan",
  "filament_cost",
  "filament_density",
]);

/** Configurações de processo que dependem da cinemática/hotend: reaplicadas, mas marcadas para revisão. */
const PROCESSO_DEPENDENTE_DA_MAQUINA = /speed|acceleration|jerk|junction|flow_ratio|volumetric/;

/** Referências a filamento no processo (índice base 1; 0 = padrão). */
const REFERENCIA_FILAMENTO = /^(support|support_interface|wall|sparse_infill|solid_infill)_filament$/;

const COR_VALIDA = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

/**
 * Bambu Studio 2.x (src/libslic3r/PrintConfig.cpp, `filament_options_with_variant`): por filamento,
 * um valor por variante de bico. No projeto vai um valor por filamento, o da variante padrão da
 * impressora de destino (com filament_extruder_variant e filament_self_index), como o próprio
 * Bambu Studio grava.
 */
const FILAMENTO_POR_VARIANTE = new Set([
  "filament_flow_ratio", "filament_max_volumetric_speed", "filament_ramming_volumetric_speed", "filament_pre_cooling_temperature",
  "filament_ramming_travel_time", "filament_ramming_volumetric_speed_nc", "filament_pre_cooling_temperature_nc",
  "filament_ramming_travel_time_nc", "filament_extruder_variant", "filament_retraction_length", "filament_retract_length_nc",
  "filament_retract_length_toolchange", "filament_retract_restart_extra_toolchange", "filament_z_hop", "filament_z_hop_types",
  "filament_retract_restart_extra", "filament_retraction_speed", "filament_deretraction_speed", "filament_retraction_minimum_travel",
  "filament_retract_when_changing_layer", "filament_wipe", "filament_wipe_distance", "filament_retract_before_wipe",
  "filament_long_retractions_when_cut", "filament_retraction_distances_when_cut", "long_retractions_when_ec",
  "retraction_distances_when_ec", "nozzle_temperature_initial_layer", "nozzle_temperature", "filament_flush_volumetric_speed",
  "filament_flush_temp", "filament_flush_temp_fast", "filament_enable_overhang_speed", "filament_bridge_speed",
  "filament_overhang_1_4_speed", "filament_overhang_2_4_speed", "filament_overhang_3_4_speed", "filament_overhang_4_4_speed",
  "filament_overhang_totally_speed", "override_process_overhang_speed", "volumetric_speed_coefficients",
  "filament_adaptive_volumetric_speed", "filament_preheat_temperature_delta", "filament_cooling_before_tower", "slow_down_min_speed",
]);

/** Bambu Studio 2.x (`filament_dev_options`): vários valores por filamento, gravados em sequência. */
const FILAMENTO_VARIOS_VALORES = /^filament_dev_/;

/**
 * Mesmo valor com nomes diferentes entre o Bambu Studio e a família Orca (Anycubic, Flashforge).
 * Vale nos dois sentidos: só é usado quando o destino não aceita o nome da origem e aceita o outro.
 * Encontrados em projetos reais e confirmados abrindo o resultado nos slicers.
 */
const TRADUCAO_VALORES: Record<string, Record<string, string>> = {
  support_style: { tree_organic: "organic", organic: "tree_organic" },
  // Creality Print 7.x (PrintConfig.cpp, s_keys_map_FilamentMapMode) usa nomes sem espaço.
  filament_map_mode: {
    "Auto For Flush": "AutoForSaving",
    AutoForSaving: "Auto For Flush",
    "Auto For Match": "AutoForMatch",
    AutoForMatch: "Auto For Match",
  },
};

export type ResultadoValor = { valor: string; situacao: "aceito" | "traduzido" } | { valor: null; situacao: "rejeitado" };

/** Confere um valor de opção enum contra o destino: aceito, traduzido ou rejeitado. */
export function normalizarValorEnum(perfil: PerfilAlvo, chave: string, valor: string): ResultadoValor {
  const aceitos = perfil.valoresAceitos?.[chave];
  if (!aceitos || aceitos.includes(valor)) return { valor, situacao: "aceito" };
  const traduzido = TRADUCAO_VALORES[chave]?.[valor];
  if (traduzido !== undefined && aceitos.includes(traduzido)) return { valor: traduzido, situacao: "traduzido" };
  return { valor: null, situacao: "rejeitado" };
}

// ---------------------------------------------------------------------------------------------

/** Lê o JSON de configuração da origem de forma defensiva (sem protótipo, só strings). */
export function lerConfigOrigem(texto: string, limites: LimitesConversao): Map<string, ValorConfig> {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new ErroConversao("CONFIG_INVALIDA");
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new ErroConversao("CONFIG_INVALIDA");
  const entradas = Object.entries(bruto as Record<string, unknown>);
  if (entradas.length > limites.maxChavesConfiguracao) throw new ErroConversao("CONFIG_INVALIDA");
  const out = new Map<string, ValorConfig>();
  const escalar = (v: unknown): string | null =>
    typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;
  for (const [k, v] of entradas) {
    if (!CHAVE_VALIDA.test(k) || CHAVES_PROIBIDAS.has(k)) continue;
    if (Array.isArray(v)) {
      const lista = v.map(escalar);
      if (lista.every((x): x is string => x !== null)) out.set(k, lista);
    } else {
      const s = escalar(v);
      if (s !== null) out.set(k, s);
    }
  }
  return out;
}

function comoLista(v: ValorConfig | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function comoTexto(v: ValorConfig | undefined): string | null {
  if (v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function numero(v: ValorConfig | undefined): number | null {
  const t = comoTexto(v);
  if (t === null) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function iguais(a: ValorConfig | undefined, b: ValorConfig | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function resumirValor(v: ValorConfig | undefined): string {
  const t = Array.isArray(v) ? v.join(", ") : (v ?? "");
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
}

// ---------------------------------------------------------------------------------------------

/** Diâmetro do bico do projeto (primeira extrusora), ou null se não informado/inválido. */
export function bicoDaOrigem(origem: ConfigOrigem): number | null {
  return bicoDoProjeto((k) => origem.get(k));
}

export function contarFilamentos(origem: ConfigOrigem, limites: LimitesConversao): number {
  // Mesma contagem do resumo exibido no navegador (resumoProjeto.ts): cores primeiro.
  const n = quantidadeFilamentos((k) => origem.get(k));
  if (n < 1 || n > limites.maxFilamentosOrigem) throw new ErroConversao("CONFIG_INVALIDA");
  return n;
}

// Variantes de bico (Bambu Studio 2.x) -----------------------------------------------------------
// Projetos novos gravam valores por variante de extrusora ("Direct Drive Standard", "... High Flow"):
// - processo: um valor por item de print_extruder_variant;
// - filamento: um valor por (filamento, variante), com filament_self_index (filamento, base 1) e
//   filament_extruder_variant alinhados à lista.
// Usa-se o valor da variante ativa do projeto.

export function varianteAtiva(origem: ConfigOrigem): string {
  const pev = comoTexto(origem.get("printer_extruder_variant"));
  if (pev) return pev;
  const volume = comoTexto(origem.get("nozzle_volume_type"));
  return `Direct Drive ${volume && volume !== "" ? volume : "Standard"}`;
}

/** Valor de processo da origem para a variante ativa (escalar), quando a lista é por variante. */
export function valorProcessoOrigem(origem: ConfigOrigem, k: string, variante: string): { valor: ValorConfig; ambiguo: boolean } | null {
  const v = origem.get(k);
  if (v === undefined) return null;
  if (!Array.isArray(v)) return { valor: v, ambiguo: false };
  const variantes = comoLista(origem.get("print_extruder_variant"));
  if (variantes.length > 1 && variantes.length === v.length) {
    const j = Math.max(0, variantes.indexOf(variante));
    return { valor: v[j] ?? v[0] ?? "", ambiguo: false };
  }
  return { valor: v, ambiguo: new Set(v).size > 1 };
}

/** Valor do filamento `i` (base 0) para a variante ativa; null se não der para identificar. */
export function valorFilamentoOrigem(origem: ConfigOrigem, k: string, i: number, n: number, variante: string): string | null {
  const lista = comoLista(origem.get(k));
  if (lista.length === 0) return null;
  if (lista.length === n) return lista[i] ?? null;
  const indices = comoLista(origem.get("filament_self_index"));
  const variantes = comoLista(origem.get("filament_extruder_variant"));
  if (indices.length === lista.length) {
    const alvo = String(i + 1);
    let j = -1;
    if (variantes.length === lista.length) j = indices.findIndex((x, p) => x === alvo && variantes[p] === variante);
    if (j < 0) j = indices.indexOf(alvo);
    return j >= 0 ? (lista[j] ?? null) : null;
  }
  return lista.length === 1 ? (lista[0] ?? null) : null;
}

/** Converte um valor para a forma do destino (escalar ou lista de mesmo tamanho). */
export function ajustarForma(valor: ValorConfig, destino: ValorConfig | undefined): { valor: ValorConfig; perdeu: boolean } {
  if (destino === undefined) return { valor, perdeu: false };
  if (!Array.isArray(destino)) {
    if (!Array.isArray(valor)) return { valor, perdeu: false };
    return { valor: valor[0] ?? "", perdeu: new Set(valor).size > 1 };
  }
  const lista = Array.isArray(valor) ? valor : [valor];
  if (lista.length === destino.length) return { valor: lista, perdeu: false };
  const ajustado = destino.map((_, p) => lista[p] ?? lista[0] ?? "");
  return { valor: ajustado, perdeu: lista.length > 1 && new Set(lista).size > 1 };
}

export function escolherProcesso(perfil: PerfilAlvo, altura: number): { processo: ProcessoAlvo; exata: boolean } {
  const candidatos = perfil.processos.filter((p) => p.padraoDaAltura);
  let melhor = candidatos[0]!;
  let melhorDist = Infinity;
  for (const p of candidatos) {
    const d = Math.abs(p.alturaCamada - altura);
    // Empate: fica com a altura maior (perfis "Standard" mais usados).
    if (d < melhorDist - 1e-9 || (Math.abs(d - melhorDist) <= 1e-9 && p.alturaCamada > melhor.alturaCamada)) {
      melhor = p;
      melhorDist = d;
    }
  }
  return { processo: melhor, exata: melhorDist < 1e-6 };
}

export function escolherFilamento(perfil: PerfilAlvo, tipo: string, nomeOrigem: string): { regra: RegraFilamento | null; nome: string; exato: boolean } {
  const t = tipo.trim().toUpperCase();
  const n = nomeOrigem.toLowerCase();
  for (const r of perfil.filamentos.regras) {
    if (!r.tipos.includes(t)) continue;
    if (r.nomeContem && r.nomeContem.length > 0 && !r.nomeContem.some((x) => n.includes(x))) continue;
    return { regra: r, nome: r.perfil, exato: r.exato };
  }
  return { regra: null, nome: perfil.filamentos.padrao, exato: false };
}

function diferencas(origem: ConfigOrigem, n: number): { processo: string[]; filamentos: string[][]; maquina: string[] } | null {
  const d = origem.get("different_settings_to_system");
  if (!Array.isArray(d) || d.length < 2) return null;
  const dividir = (s: string | undefined) => (s ?? "").split(";").map((x) => x.trim()).filter((x) => x.length > 0);
  return {
    processo: dividir(d[0]),
    filamentos: Array.from({ length: n }, (_, i) => dividir(d[i + 1])),
    maquina: dividir(d.length >= n + 2 ? d[d.length - 1] : undefined),
  };
}

// ---------------------------------------------------------------------------------------------

export interface ResultadoConfig {
  config: ConfigPlana;
  processo: { nome: string; alturaCamadaPerfil: number; alturaCamadaProjeto: number; exata: boolean };
  filamentos: FilamentoRelatorio[];
  nFilamentos: number;
  origem: { impressora: string | null; versaoProjeto: string | null; alturaCamada: number | null; mesa: MesaOrigem };
}

export interface MesaOrigem {
  origemX: number;
  origemY: number;
  x: number;
  y: number;
}

export function mesaDaOrigem(origem: ConfigOrigem): MesaOrigem | null {
  const area = comoLista(origem.get("printable_area"));
  const pts = area.map((p) => p.split("x").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p[0]!);
  const ys = pts.map((p) => p[1]!);
  const mesa = {
    origemX: Math.min(...xs),
    origemY: Math.min(...ys),
    x: Math.max(...xs) - Math.min(...xs),
    y: Math.max(...ys) - Math.min(...ys),
  };
  return mesa.x > 0 && mesa.y > 0 && mesa.x < 10_000 && mesa.y < 10_000 ? mesa : null;
}

export function converterConfiguracao(
  origem: ConfigOrigem,
  perfil: PerfilAlvo,
  limites: LimitesConversao,
  rel: Relatorio,
): ResultadoConfig {
  const n = contarFilamentos(origem, limites);

  // Bico ---------------------------------------------------------------------------------------
  const bico = numero(origem.get("nozzle_diameter"));
  if (bico === null) {
    rel.aviso("BICO_NAO_INFORMADO", `O projeto não informa o diâmetro do bico; foi assumido ${perfil.bico} mm.`);
  } else if (Math.abs(bico - perfil.bico) > 1e-6) {
    throw new ErroConversao(
      "BICO_NAO_SUPORTADO",
      `O projeto usa bico de ${bico} mm, mas o destino ${perfil.impressora} está disponível só com bico de ${perfil.bico} mm.`,
    );
  }

  const mesaOrigem = mesaDaOrigem(origem);
  if (!mesaOrigem) throw new ErroConversao("CONFIG_INVALIDA");

  // Base: máquina + processo do destino ---------------------------------------------------------
  const alturaOrigem = numero(origem.get("layer_height"));
  const altura = alturaOrigem !== null && alturaOrigem > 0 && alturaOrigem < 5 ? alturaOrigem : null;
  const { processo, exata } = escolherProcesso(perfil, altura ?? 0.2);
  const config = new Map<string, ValorConfig>();
  for (const [k, v] of Object.entries(perfil.maquina.config)) config.set(k, v);
  for (const [k, v] of Object.entries(processo.config)) config.set(k, v);

  const impressoraOrigem = comoTexto(origem.get("printer_settings_id"));
  rel.substituidos.push({
    categoria: "impressora",
    descricao: "Perfil da impressora substituído pelo do destino (mesa, cinemática, G-code inicial/final, extrusoras).",
    de: impressoraOrigem ?? "(não informado)",
    para: perfil.maquina.nome,
  });
  rel.substituidos.push({
    categoria: "processo",
    descricao: "Processo de destino com a altura de camada do projeto; só as mudanças feitas pelo usuário foram reaplicadas.",
    de: comoTexto(origem.get("print_settings_id")) ?? "(não informado)",
    para: processo.nome,
  });

  const alteradosProcesso = new Set<string>();
  if (altura !== null && !exata) {
    config.set("layer_height", String(altura));
    alteradosProcesso.add("layer_height");
    rel.aviso(
      "ALTURA_APROXIMADA",
      `Não há processo de ${altura} mm para ${perfil.impressora}; foi usado o de ${processo.alturaCamada} mm mantendo a altura de ${altura} mm. Revise velocidades e larguras de linha.`,
    );
    rel.revisar.push({
      categoria: "processo",
      chave: "layer_height",
      descricao: "Altura de camada sem processo equivalente no destino.",
      de: String(altura),
      para: `${altura} (sobre o processo de ${processo.alturaCamada} mm)`,
    });
  }

  // Filamentos ----------------------------------------------------------------------------------
  const tipos = comoLista(origem.get("filament_type"));
  const nomes = comoLista(origem.get("filament_settings_id"));
  const coresOrigem = comoLista(origem.get("filament_colour"));
  const escolhidos = Array.from({ length: n }, (_, i) => {
    const tipo = tipos[i] ?? "PLA";
    const nomeOrigem = nomes[i] ?? "";
    return { tipo, nomeOrigem, ...escolherFilamento(perfil, tipo, nomeOrigem) };
  });
  const cores = Array.from({ length: n }, (_, i) => {
    const c = coresOrigem[i] ?? "";
    return COR_VALIDA.test(c) ? c.toUpperCase() : "#FFFFFF";
  });

  const chavesFil = new Set<string>();
  for (const e of escolhidos) for (const k of Object.keys(perfil.filamentos.perfis[e.nome]!)) chavesFil.add(k);
  const padraoFil = perfil.filamentos.perfis[perfil.filamentos.padrao]!;
  // Variante de bico padrão do destino (Bambu Studio 2.x), para os valores por variante.
  const varianteDestino = comoTexto(perfil.maquina.config.printer_extruder_variant);
  const valorDoFilamento = (pf: ConfigPlana, k: string): string[] | undefined => {
    const lista = pf[k] === undefined ? undefined : comoLista(pf[k]);
    if (lista === undefined || lista.length === 0) return undefined;
    if (FILAMENTO_VARIOS_VALORES.test(k)) return lista;
    if (varianteDestino && FILAMENTO_POR_VARIANTE.has(k)) {
      const j = comoLista(pf.filament_extruder_variant).indexOf(varianteDestino);
      return [lista[j >= 0 && j < lista.length ? j : 0]!];
    }
    return [lista[0]!];
  };
  for (const k of [...chavesFil]) {
    // Chave que só alguns perfis definem (e o padrão não): omitida, para o slicer usar o próprio
    // padrão em vez de receber um valor vazio para os outros filamentos.
    const porFilamento = escolhidos.map((e) => valorDoFilamento(perfil.filamentos.perfis[e.nome]!, k) ?? valorDoFilamento(padraoFil, k));
    if (porFilamento.some((v) => v === undefined)) {
      chavesFil.delete(k);
      continue;
    }
    // Opção de valor único que mesmo assim vem no perfil do filamento (ex.: material_flow_temp_graph no
    // Creality Print): o slicer usa a do primeiro filamento; gravar uma lista seria um tipo errado.
    if (perfil.escalaresFilamento?.includes(k)) config.set(k, porFilamento[0]![0]!);
    else config.set(k, porFilamento.flat() as string[]);
  }

  const filamentos: FilamentoRelatorio[] = escolhidos.map((e, i) => ({
    indice: i + 1,
    cor: cores[i]!,
    tipoOrigem: e.tipo,
    perfilOrigem: e.nomeOrigem,
    perfilDestino: e.nome,
    equivalenciaExata: e.exato,
  }));
  for (const f of filamentos) {
    rel.substituidos.push({
      categoria: "filamento",
      descricao: `Filamento ${f.indice} (${f.tipoOrigem}, cor ${f.cor}) mapeado por tipo; cor e posição mantidas.`,
      de: f.perfilOrigem || "(não informado)",
      para: f.perfilDestino,
    });
    if (!f.equivalenciaExata) {
      rel.aviso(
        "FILAMENTO_APROXIMADO",
        `O filamento ${f.indice} (${f.tipoOrigem}) não tem equivalente exato em ${perfil.impressora}; foi usado "${f.perfilDestino}". Confira temperaturas e compatibilidade.`,
      );
      rel.revisar.push({ categoria: "filamento", descricao: `Filamento ${f.indice} sem equivalente exato.`, de: f.tipoOrigem, para: f.perfilDestino });
    }
  }
  if (n > perfil.maxFilamentos) {
    const explicacao =
      perfil.multiMaterial === "trocaDeFerramenta"
        ? `${perfil.impressora} tem ${perfil.maxFilamentos} cabeçotes`
        : `${perfil.impressora} suporta até ${perfil.maxFilamentos} cores`;
    rel.aviso(
      "CORES_EXCEDEM",
      `O projeto usa ${n} filamentos, mas ${explicacao}. Reatribua os filamentos acima de ${perfil.maxFilamentos} no slicer antes de imprimir.`,
    );
  }

  // Mudanças do usuário -------------------------------------------------------------------------
  const dif = diferencas(origem, n);
  const alteradosFil: string[][] = Array.from({ length: n }, () => []);
  if (!dif) {
    rel.aviso(
      "SEM_DIFERENCAS_REGISTRADAS",
      "O projeto não registra quais configurações foram alteradas pelo usuário; foi aplicado só o processo padrão do destino. Confira suportes, preenchimento e paredes.",
    );
  } else {
    const variante = varianteAtiva(origem);
    for (const k of new Set(dif.processo)) {
      if (k === "layer_height") {
        if (altura !== null && exata) rel.mantidos.push({ categoria: "processo", chave: k, descricao: "Altura de camada", para: String(altura) });
        continue;
      }
      const valor = origem.get(k);
      if (valor === undefined) continue;
      if (chaveBloqueada(k)) {
        rel.descartados.push({ categoria: "configuracao", chave: k, descricao: "Descartado por segurança (script, G-code ou envio para impressora/host)." });
        continue;
      }
      if (k in perfil.maquina.config) {
        rel.descartados.push({ categoria: "impressora", chave: k, descricao: "Configuração da impressora de origem.", de: resumirValor(valor) });
        continue;
      }
      if (chavesFil.has(k)) continue;
      // Opção que o slicer de destino não tem: não teria efeito nenhum; sai do projeto, sem alarde.
      const conhecidas = opcoesDoSlicer(perfil);
      if (!(k in processo.config) && conhecidas && !conhecidas.has(k)) {
        rel.descartados.push({
          categoria: "processo",
          chave: k,
          descricao: `Mudança do usuário numa opção que o ${perfil.slicer.nome} não tem; não se aplica no destino.`,
          de: resumirValor(valor),
        });
        continue;
      }
      // Forma do valor: escolhe a variante de bico ativa e converte para a forma do destino.
      const daVariante = valorProcessoOrigem(origem, k, variante)!;
      const destinoAtual = config.get(k);
      const forma = ajustarForma(daVariante.valor, destinoAtual);
      let v = forma.valor;
      const formaIncerta = daVariante.ambiguo || forma.perdeu;
      let traduzido = false;
      // Valores de lista fixa: só grava o que o slicer de destino aceita (senão ele substitui ao abrir).
      if (typeof v === "string") {
        const n2 = normalizarValorEnum(perfil, k, v);
        if (n2.situacao === "rejeitado") {
          rel.revisar.push({
            categoria: "processo",
            chave: k,
            descricao: "Valor escolhido na origem não existe no slicer de destino; mantido o do perfil de destino.",
            de: v,
            para: resumirValor(config.get(k)),
          });
          continue;
        }
        if (n2.situacao === "traduzido") {
          traduzido = true;
          v = n2.valor;
        }
      }
      if (REFERENCIA_FILAMENTO.test(k)) {
        const idx = Number.parseInt(comoTexto(valor) ?? "0", 10);
        if (!Number.isInteger(idx) || idx < 0 || idx > n) {
          v = "0";
          rel.revisar.push({ categoria: "processo", chave: k, descricao: "Referência a filamento inexistente; voltou ao padrão.", de: resumirValor(valor), para: "0" });
        } else if (idx > perfil.maxFilamentos) {
          rel.revisar.push({ categoria: "processo", chave: k, descricao: `Usa o filamento ${idx}, além do que o destino suporta.`, de: String(idx) });
        }
      }
      if (iguais(config.get(k), v)) continue;
      const anterior = config.get(k);
      config.set(k, v);
      alteradosProcesso.add(k);
      if (formaIncerta) {
        rel.revisar.push({ categoria: "processo", chave: k, descricao: "Mudança do usuário com valores diferentes por bico na origem; foi usado o do bico ativo.", de: resumirValor(valor), para: resumirValor(v) });
      } else if (!(k in processo.config) && conhecidas) {
        // O slicer conhece a opção; o perfil só a deixa no padrão dele. Vale como qualquer mudança.
        rel.mantidos.push({ categoria: "processo", chave: k, descricao: "Mudança do usuário reaplicada.", para: resumirValor(v) });
      } else if (!(k in processo.config)) {
        rel.revisar.push({ categoria: "processo", chave: k, descricao: "Mudança do usuário numa opção que o perfil de destino não define; confira no slicer.", para: resumirValor(v) });
      } else if (PROCESSO_DEPENDENTE_DA_MAQUINA.test(k)) {
        rel.revisar.push({ categoria: "processo", chave: k, descricao: "Velocidade, aceleração ou fluxo que você ajustou para a impressora de origem foi mantido; confira se serve para a nova impressora.", de: resumirValor(anterior), para: resumirValor(v) });
      } else {
        rel.mantidos.push({
          categoria: "processo",
          chave: k,
          descricao: traduzido ? "Mudança do usuário reaplicada com o nome que o destino usa." : "Mudança do usuário reaplicada.",
          de: traduzido ? resumirValor(valor) : resumirValor(anterior),
          para: resumirValor(v),
        });
      }
    }

    dif.filamentos.forEach((chaves, i) => {
      for (const k of new Set(chaves)) {
        const lista = comoLista(origem.get(k));
        if (lista.length === 0) continue;
        const novo = valorFilamentoOrigem(origem, k, i, n, variante);
        if (chaveBloqueada(k)) {
          rel.descartados.push({ categoria: "configuracao", chave: k, descricao: `Filamento ${i + 1}: descartado por segurança (G-code).` });
          continue;
        }
        if (!FILAMENTO_REAPLICAVEL.has(k) || !chavesFil.has(k)) {
          rel.descartados.push({ categoria: "filamento", chave: k, descricao: `Filamento ${i + 1}: calibração da impressora de origem.`, de: resumirValor(novo ?? undefined) });
          continue;
        }
        if (novo === null) {
          rel.revisar.push({ categoria: "filamento", chave: k, descricao: `Filamento ${i + 1}: mudança do usuário não pôde ser associada a este filamento; não foi reaplicada.` });
          continue;
        }
        const atual = comoLista(config.get(k));
        if (atual[i] === novo) continue;
        const copia = [...atual];
        copia[i] = novo;
        config.set(k, copia);
        alteradosFil[i]!.push(k);
        rel.mantidos.push({ categoria: "filamento", chave: k, descricao: `Filamento ${i + 1}: mudança do usuário reaplicada.`, de: atual[i], para: novo });
      }
    });

    for (const k of new Set(dif.maquina)) {
      rel.descartados.push({ categoria: "impressora", chave: k, descricao: "Mudança na impressora de origem (não se aplica ao destino).", de: resumirValor(origem.get(k)) });
    }
  }

  // Mesa ---------------------------------------------------------------------------------------
  const mesaAntes = comoTexto(origem.get("curr_bed_type"));
  if (mesaAntes && mesaAntes !== perfil.tipoMesa) {
    rel.substituidos.push({ categoria: "configuracao", chave: "curr_bed_type", descricao: "Tipo de placa ajustado ao destino.", de: mesaAntes, para: perfil.tipoMesa });
  }

  // Chaves de projeto ---------------------------------------------------------------------------
  const nomesDestino = escolhidos.map((e) => e.nome);
  config.set("printer_settings_id", perfil.maquina.nome);
  config.set("print_settings_id", processo.nome);
  config.set("filament_settings_id", nomesDestino);
  config.set("filament_colour", cores);
  config.set("filament_map", Array.from({ length: n }, () => "1"));
  // Mapeamento automático, com o nome que o destino usa (o Creality Print recusa "Auto For Flush").
  config.set("filament_map_mode", normalizarValorEnum(perfil, "filament_map_mode", "Auto For Flush").valor ?? "Auto For Flush");
  if (perfil.slicer.formatoProjeto === "bambu-2") {
    // Chaves que o Bambu Studio 2.x grava no projeto (não vêm dos perfis): um valor por filamento,
    // na variante padrão (filament_self_index aponta cada valor por variante ao seu filamento) e
    // num bico só (modelos de dois bicos ficam fora do catálogo).
    config.set("filament_self_index", Array.from({ length: n }, (_, i) => String(i + 1)));
    config.set("filament_nozzle_map", Array.from({ length: n }, () => "0"));
    config.set("filament_volume_map", Array.from({ length: n }, () => "0"));
  }
  config.set("curr_bed_type", perfil.tipoMesa);
  config.set("inherits_group", Array.from({ length: n + 2 }, () => ""));
  config.set("different_settings_to_system", [
    [...alteradosProcesso].sort().join(";"),
    ...alteradosFil.map((l) => [...new Set(l)].sort().join(";")),
    "",
  ]);
  config.set("version", perfil.slicer.versaoProjeto);
  config.set("name", "project_settings");
  config.set("from", "project");

  // Garantia final: nada executável vindo da origem, e nenhum endereço/credencial de envio para a
  // impressora (nem do perfil: alguns perfis da Creality trazem um IP de rede interna).
  for (const k of [...config.keys()]) {
    if (chaveBloqueada(k) && !(k in perfil.maquina.config) && !(k in processo.config) && !chavesFil.has(k)) config.delete(k);
    else if (/^print_host(_webui)?$|^printhost_(apikey|cafile|user|password|port)$/.test(k) && config.get(k) !== "") config.set(k, "");
  }
  const postProcessOrigem = comoLista(origem.get("post_process")).filter((s) => s.trim() !== "");
  if (postProcessOrigem.length > 0 && !rel.descartados.some((d) => d.chave === "post_process")) {
    rel.descartados.push({ categoria: "configuracao", chave: "post_process", descricao: "Scripts de pós-processamento removidos por segurança." });
  }
  config.set("post_process", []);

  const saida: ConfigPlana = Object.create(null) as ConfigPlana;
  for (const k of [...config.keys()].sort()) saida[k] = config.get(k)!;

  return {
    config: saida,
    processo: { nome: processo.nome, alturaCamadaPerfil: processo.alturaCamada, alturaCamadaProjeto: altura ?? processo.alturaCamada, exata },
    filamentos,
    nFilamentos: n,
    origem: {
      impressora: impressoraOrigem,
      versaoProjeto: comoTexto(origem.get("version")),
      alturaCamada: altura,
      mesa: mesaOrigem,
    },
  };
}
