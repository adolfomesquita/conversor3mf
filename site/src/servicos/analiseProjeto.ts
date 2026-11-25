// Resumo do projeto .3mf lido no navegador, antes de converter: slicer e impressora de origem,
// bico, altura de camada, filamentos (cores) e miniatura da placa 1.
// É só uma prévia para o usuário escolher o destino: a conversão lê e valida o arquivo de novo (e
// decide). A detecção usa o mesmo código da conversão (../conversao).
import { MENSAGENS } from "@conversao/erros";
import { familiaConvertivel, identificarOrigem, lerMetadadosCabecalho, mensagemOrigemNaoSuportada } from "@conversao/origem";
import {
  alturaCamadaDoProjeto,
  bicoDoProjeto,
  eEntradaGcode,
  filamentosDoProjeto,
  impressoraDoProjeto,
  type FilamentoDoProjeto,
  type ValorProjeto,
} from "@conversao/resumoProjeto";
import { comoTexto, lerEntrada, listarEntradas, type EntradaZip } from "./leitorZip";

export type { FilamentoDoProjeto };

export interface ResumoProjeto {
  slicer: string;
  versaoSlicer: string | null;
  impressora: string | null;
  bico: number | null;
  alturaCamada: number | null;
  filamentos: FilamentoDoProjeto[];
  placas: number | null;
  objetos: number | null;
  /** PNG da placa 1 gravado pelo slicer, se houver. */
  miniatura: Blob | null;
}

export type AnaliseProjeto =
  | { tipo: "ok"; resumo: ResumoProjeto }
  | { tipo: "recusado"; mensagem: string }
  | { tipo: "indisponivel" };

const MODELO = "3D/3dmodel.model";
const PROJETO = "Metadata/project_settings.config";
const SETTINGS = "Metadata/model_settings.config";
const MINIATURA = "Metadata/plate_1.png";
const MAX_CONFIG = 16 * 1024 * 1024;
const MAX_MINIATURA = 4 * 1024 * 1024;
const CHAVE_VALIDA = /^[A-Za-z0-9_.-]{1,128}$/;

function lerConfig(texto: string): (k: string) => ValorProjeto | undefined {
  const bruto: unknown = JSON.parse(texto);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new Error("config inválida");
  const mapa = new Map<string, ValorProjeto>();
  const escalar = (v: unknown): string | null =>
    typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    if (!CHAVE_VALIDA.test(k)) continue;
    if (Array.isArray(v)) {
      const lista = v.map(escalar);
      if (lista.every((x): x is string => x !== null)) mapa.set(k, lista);
    } else {
      const s = escalar(v);
      if (s !== null) mapa.set(k, s);
    }
  }
  return (k) => mapa.get(k);
}

async function contarPlacasEObjetos(arquivo: Blob, e: EntradaZip | undefined): Promise<{ placas: number | null; objetos: number | null }> {
  if (!e) return { placas: null, objetos: null };
  try {
    const texto = comoTexto(await lerEntrada(arquivo, e, MAX_CONFIG));
    return { placas: texto.match(/<plate>/g)?.length ?? 0, objetos: texto.match(/<object\s/g)?.length ?? 0 };
  } catch {
    return { placas: null, objetos: null };
  }
}

export async function analisarProjeto(arquivo: Blob): Promise<AnaliseProjeto> {
  let entradas: EntradaZip[];
  try {
    entradas = await listarEntradas(arquivo);
  } catch {
    // Não deu para ler aqui; a conversão dá o diagnóstico.
    return { tipo: "indisponivel" };
  }
  try {
    const porNome = new Map(entradas.map((e) => [e.nome, e]));
    if (entradas.some((e) => eEntradaGcode(e.nome))) return { tipo: "recusado", mensagem: MENSAGENS.PROJETO_COM_GCODE };
    if (entradas.some((e) => e.criptografada)) return { tipo: "recusado", mensagem: MENSAGENS.ZIP_CRIPTOGRAFADO };
    const modelo = porNome.get(MODELO);
    if (!modelo) return { tipo: "recusado", mensagem: MENSAGENS.NAO_E_PROJETO };

    const cabecalho = lerMetadadosCabecalho(comoTexto(await lerEntrada(arquivo, modelo, 64 * 1024, true)));
    const projeto = porNome.get(PROJETO);
    const origem = identificarOrigem(
      entradas.map((e) => e.nome),
      cabecalho,
      projeto !== undefined,
    );
    if (!origem.suportado || !projeto) {
      const familia = familiaConvertivel(origem.slicer);
      return { tipo: "recusado", mensagem: familia && !projeto ? MENSAGENS.NAO_E_PROJETO : mensagemOrigemNaoSuportada(origem) };
    }

    const ler = lerConfig(comoTexto(await lerEntrada(arquivo, projeto, MAX_CONFIG)));
    const { placas, objetos } = await contarPlacasEObjetos(arquivo, porNome.get(SETTINGS));
    let miniatura: Blob | null = null;
    const png = porNome.get(MINIATURA);
    if (png && png.tamanho <= MAX_MINIATURA) {
      try {
        miniatura = new Blob([(await lerEntrada(arquivo, png, MAX_MINIATURA)) as BlobPart], { type: "image/png" });
      } catch {
        miniatura = null;
      }
    }
    return {
      tipo: "ok",
      resumo: {
        slicer: origem.slicer,
        versaoSlicer: origem.versao,
        impressora: impressoraDoProjeto(ler),
        bico: bicoDoProjeto(ler),
        alturaCamada: alturaCamadaDoProjeto(ler),
        filamentos: filamentosDoProjeto(ler),
        placas,
        objetos,
        miniatura,
      },
    };
  } catch {
    return { tipo: "indisponivel" };
  }
}

// Fotos das impressoras de origem ---------------------------------------------------------------
// web/public/impressoras/origens.json: nome normalizado do modelo -> arquivo PNG (gerado por
// functions/scripts/gerar-capas-origem.mjs). A URL vem sempre do índice, nunca do texto do arquivo.

let indiceCapas: Promise<Record<string, string>> | null = null;

export function normalizarModelo(nome: string): string {
  return nome.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function capaDaImpressora(nome: string | null): Promise<string | null> {
  if (!nome) return null;
  indiceCapas ??= fetch(`${import.meta.env.BASE_URL}impressoras/origens.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
    .catch(() => ({}));
  const indice = await indiceCapas;
  // Sem printer_model, o nome vem do perfil ("Bambu Lab P1S 0.4 nozzle"): tenta sem o bico.
  const arquivo = indice[normalizarModelo(nome)] ?? indice[normalizarModelo(nome.replace(/\s*\d+(\.\d+)?\s*nozzle.*$/i, ""))];
  return arquivo && /^(origem\/)?[a-z0-9.-]+\.png$/.test(arquivo) ? `${import.meta.env.BASE_URL}impressoras/${arquivo}` : null;
}
