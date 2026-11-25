// Perfis-alvo versionados (gerados por scripts/gerar-perfis.mjs a partir dos slicers das fabricantes).
// São ~80 arquivos (vários MB): ficam no disco e são lidos sob demanda, com cache, a partir de um
// índice pequeno. Assim nenhuma Function paga o custo de carregar todos na inicialização.
// O build copia os JSON para lib/ (scripts/copiar-perfis.mjs), porque o deploy ignora src/.
// A leitura dos arquivos é trocável (definirLeitorPerfis): no servidor vem do disco; no navegador
// (versão estática) vem de arquivos já baixados. Nada de Node roda ao carregar este módulo.
import { ErroConversao } from "./erros.js";
import { bicoAlvo, mesmoBico } from "./resumoProjeto.js";

export type ValorConfig = string | string[];
export type ConfigPlana = Record<string, ValorConfig>;

export interface RegraFilamento {
  tipos: string[];
  nomeContem?: string[];
  perfil: string;
  exato: boolean;
}

export interface ProcessoAlvo {
  nome: string;
  alturaCamada: number;
  padraoDaAltura: boolean;
  config: ConfigPlana;
}

export type MultiMaterial = "trocaComPurga" | "trocaDeFerramenta" | "unicaCor";

export interface PerfilAlvo {
  formato: 1;
  id: string;
  modeloId: string;
  fabricante: string;
  impressora: string;
  bico: number;
  variante: string;
  /** false para variantes especiais (ex.: bico HF), que não são escolhidas pelo diâmetro do projeto. */
  casamentoAutomatico: boolean;
  slicer: {
    nome: string;
    versaoApp: string;
    versaoProjeto: string;
    pacotePerfis: string;
    versaoPacotePerfis: string;
    /**
     * Valor de <metadata name="Application"> que o slicer de destino grava ("BambuStudio-<versão>").
     * Slicers da família Bambu só carregam as configurações se o cabeçalho começar com "BambuStudio-"
     * e tratam versões antigas como projetos legados (reposicionam placas etc.).
     */
    aplicacao?: string;
    /** "sempre": reescreve o cabeçalho em toda conversão; senão, só quando a origem não é da família Bambu. */
    reescreverAplicacao?: "sempre";
    /** "bambu-2": projeto no formato do Bambu Studio 2.x (filament_self_index e mapas por filamento). */
    formatoProjeto?: "bambu-2";
    /** Lista de opções que o slicer de destino conhece (arquivo perfis/opcoes-<id>.json). */
    opcoes?: string;
  };
  geradoEm: string;
  mesa: { origemX: number; origemY: number; x: number; y: number; z: number };
  maxFilamentos: number;
  fonteMaxFilamentos: string;
  extrusoras: number;
  multiMaterial: MultiMaterial;
  tipoMesa: string;
  regrasFilamento: string;
  maquina: { nome: string; config: ConfigPlana };
  processos: ProcessoAlvo[];
  filamentos: { padrao: string; regras: RegraFilamento[]; perfis: Record<string, ConfigPlana> };
  /**
   * Valores aceitos pelo slicer de destino nas opções de lista fixa (enum). Valor fora daqui é
   * substituído pelo slicer ao abrir (com aviso), então a conversão traduz ou descarta antes.
   */
  valoresAceitos?: Record<string, string[]>;
  /** Opções dos perfis de filamento que são de valor único no slicer de destino (gravadas sem lista). */
  escalaresFilamento?: string[];
}

export interface PerfilNoIndice {
  id: string;
  bico: number;
  variante: string;
  casamentoAutomatico: boolean;
  regrasFilamento: string;
}

export interface ModeloNoIndice {
  id: string;
  fabricante: string;
  impressora: string;
  slicer: string;
  maxFilamentos: number;
  fonteMaxFilamentos: string;
  capa: string | null;
  perfis: PerfilNoIndice[];
}

/** Lê um arquivo da pasta de perfis pelo nome (ex.: "indice.json"). Deve lançar erro se não existir. */
export type LeitorPerfis = (arquivo: string) => string;

function leitorDoDisco(): LeitorPerfis {
  // Carregado só quando usado (Node 22.3+), para o módulo também servir ao navegador.
  const fs = process.getBuiltinModule("node:fs");
  const url = process.getBuiltinModule("node:url");
  const pasta = url.fileURLToPath(new URL(/* @vite-ignore */ "./perfis/", import.meta.url));
  return (arquivo) => fs.readFileSync(`${pasta}${arquivo}`, "utf8");
}

let lerArquivo: LeitorPerfis | null = null;
const ler: LeitorPerfis = (arquivo) => (lerArquivo ??= leitorDoDisco())(arquivo);

/** Troca a fonte dos arquivos de perfis (versão do navegador) e limpa os caches. */
export function definirLeitorPerfis(leitor: LeitorPerfis): void {
  lerArquivo = leitor;
  indice = null;
  cache.clear();
  cacheOpcoes.clear();
}

const ID_SEGURO = /^[a-z0-9][a-z0-9.-]{0,79}$/;

let indice: { modelos: ModeloNoIndice[]; perfis: Map<string, ModeloNoIndice> } | null = null;

function carregarIndice() {
  if (indice) return indice;
  const bruto = JSON.parse(ler("indice.json")) as { formato: number; modelos: ModeloNoIndice[] };
  if (bruto.formato !== 1 || !Array.isArray(bruto.modelos) || bruto.modelos.length === 0) throw new Error("índice de perfis inválido");
  const perfis = new Map<string, ModeloNoIndice>();
  for (const m of bruto.modelos) {
    if (!ID_SEGURO.test(m.id)) throw new Error(`id de modelo inválido no índice: ${m.id}`);
    for (const p of m.perfis) {
      if (!ID_SEGURO.test(p.id)) throw new Error(`id de perfil inválido no índice: ${p.id}`);
      perfis.set(p.id, m);
    }
  }
  indice = { modelos: bruto.modelos, perfis };
  return indice;
}

function validar(p: unknown): PerfilAlvo {
  const x = p as PerfilAlvo;
  const ok =
    x &&
    x.formato === 1 &&
    typeof x.id === "string" &&
    typeof x.bico === "number" &&
    x.maquina?.config &&
    Array.isArray(x.processos) &&
    x.processos.length > 0 &&
    x.filamentos?.perfis?.[x.filamentos.padrao] !== undefined &&
    x.filamentos.regras.every((r) => x.filamentos.perfis[r.perfil] !== undefined);
  if (!ok) throw new Error(`perfil-alvo inválido: ${String((p as { id?: string })?.id)}`);
  return x;
}

const cache = new Map<string, PerfilAlvo>();

/** Perfil por id (modelo + bico). Só ids do índice; nunca um caminho vindo de fora. */
const cacheOpcoes = new Map<string, Set<string> | null>();

/**
 * Opções que o slicer de destino do perfil conhece, ou null se não houver lista (então não dá para
 * afirmar nada). Usado para decidir se uma mudança do usuário fora do perfil vale no destino.
 */
export function opcoesDoSlicer(perfil: PerfilAlvo): Set<string> | null {
  const id = perfil.slicer.opcoes;
  if (!id || !/^[a-z0-9-]{1,40}$/.test(id)) return null;
  if (!cacheOpcoes.has(id)) {
    try {
      const bruto = JSON.parse(ler(`opcoes-${id}.json`)) as { formato: number; opcoes: unknown };
      const lista = Array.isArray(bruto.opcoes) ? bruto.opcoes.filter((x): x is string => typeof x === "string") : [];
      cacheOpcoes.set(id, bruto.formato === 1 && lista.length > 100 ? new Set(lista) : null);
    } catch {
      cacheOpcoes.set(id, null);
    }
  }
  return cacheOpcoes.get(id) ?? null;
}

export function obterPerfil(id: string): PerfilAlvo {
  const emCache = cache.get(id);
  if (emCache) return emCache;
  if (!ID_SEGURO.test(id) || !carregarIndice().perfis.has(id)) throw new ErroConversao("PERFIL_DESCONHECIDO");
  const perfil = validar(JSON.parse(ler(`${id}.json`)));
  if (perfil.id !== id) throw new Error(`perfil ${id} com id interno ${perfil.id}`);
  cache.set(id, perfil);
  return perfil;
}

export function listarModelos(): ModeloNoIndice[] {
  return carregarIndice().modelos;
}

export function obterModelo(modeloId: string): ModeloNoIndice {
  const m = carregarIndice().modelos.find((x) => x.id === modeloId);
  if (!m) throw new ErroConversao("PERFIL_DESCONHECIDO");
  return m;
}

/**
 * Perfil do modelo para o bico do projeto (o usuário escolhe a impressora; o bico vem do arquivo).
 * Sem bico informado, usa 0,4 mm. Variantes especiais (HF) não entram na escolha automática.
 */
/** Bicos com perfil de casamento automático (os que a tela oferece e a conversão aceita). */
export function bicosDoModelo(modelo: ModeloNoIndice): number[] {
  return [...new Set(modelo.perfis.filter((x) => x.casamentoAutomatico).map((x) => x.bico))].sort((a, b) => a - b);
}

export function perfilParaBico(modeloId: string, bico: number | null): PerfilAlvo {
  const modelo = obterModelo(modeloId);
  // Mesma regra do resumo no navegador (resumoProjeto.ts), que bloqueia o destino antes do envio.
  const alvo = bicoAlvo(bico);
  const p = modelo.perfis.find((x) => x.casamentoAutomatico && mesmoBico(x.bico, alvo));
  if (!p) {
    const disponiveis = bicosDoModelo(modelo)
      .map((b) => String(b).replace(".", ","))
      .join("; ");
    throw new ErroConversao(
      "BICO_NAO_SUPORTADO",
      `O projeto usa bico de ${String(alvo).replace(".", ",")} mm, mas para ${modelo.impressora} há perfis só para bico de ${disponiveis} mm.`,
    );
  }
  return obterPerfil(p.id);
}
