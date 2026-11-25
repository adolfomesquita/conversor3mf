/// <reference lib="webworker" />
// Worker da conversão (versão estática): roda a MESMA biblioteca do servidor, fora da tela, para a
// página não travar. O arquivo nunca sai do computador: é lido em pedaços do File escolhido e o
// resultado volta como Blob para o download.
import "./ambienteNode";
import { Writable } from "node:stream";
import { converterZip } from "@conversao/converterNucleo";
import { ehErroConversao, MENSAGENS } from "@conversao/erros";
import { LeitorBlob } from "@conversao/leitorBlob";
import { limitesCom } from "@conversao/limites";
import { definirLeitorPerfis, type ModeloNoIndice, type PerfilAlvo } from "@conversao/perfis";
import { ZipSeguro } from "@conversao/zipSeguro";
import type { MensagemWorker, PedidoConversao } from "./mensagensWorker";
import { urlDoPerfil } from "./perfisEstaticos";

const textos = new Map<string, string>();

async function baixar(nome: string): Promise<string> {
  const emCache = textos.get(nome);
  if (emCache !== undefined) return emCache;
  const url = urlDoPerfil(nome);
  if (!url) throw new Error(`perfil ausente: ${nome}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`perfil indisponível: ${nome}`);
  const t = await r.text();
  textos.set(nome, t);
  return t;
}

/**
 * Baixa só o necessário para o modelo escolhido: índice, perfis do modelo (o bico só é conhecido ao
 * ler o projeto) e a lista de opções do slicer de destino. A biblioteca lê tudo de forma síncrona.
 */
async function prepararPerfis(modeloId: string): Promise<void> {
  const indice = JSON.parse(await baixar("indice.json")) as { modelos: ModeloNoIndice[] };
  const modelo = indice.modelos.find((m) => m.id === modeloId);
  const perfis = modelo ? await Promise.all(modelo.perfis.map((p) => baixar(`${p.id}.json`))) : [];
  const opcoes = new Set(perfis.map((t) => (JSON.parse(t) as PerfilAlvo).slicer.opcoes).filter((x): x is string => !!x));
  await Promise.all([...opcoes].map((id) => baixar(`opcoes-${id}.json`).catch(() => "")));
  definirLeitorPerfis((nome) => {
    const t = textos.get(nome);
    if (t === undefined || t === "") throw new Error(`perfil não carregado: ${nome}`);
    return t;
  });
}

function enviar(m: MensagemWorker): void {
  self.postMessage(m);
}

async function converter(pedido: PedidoConversao): Promise<MensagemWorker> {
  const inicio = performance.now();
  await prepararPerfis(pedido.modeloId);
  const limites = limitesCom();

  // Progresso pela leitura do arquivo: o modelo principal e os XML pequenos são lidos duas vezes.
  let lidos = 0;
  let total = pedido.arquivo.size;
  let ultimo = 0;
  const aoLer = (n: number) => {
    lidos += n;
    const agora = performance.now();
    if (agora - ultimo > 250) {
      ultimo = agora;
      enviar({ tipo: "progresso", fracao: Math.min(0.99, lidos / total) });
    }
  };
  const zip = await ZipSeguro.abrirLeitor(new LeitorBlob(pedido.arquivo, aoLer), pedido.arquivo.size, limites);
  total = zip.entradas.reduce((s, e) => s + e.compactado * (e.nome === "3D/3dmodel.model" || /\.(rels|xml|config)$/i.test(e.nome) ? 2 : 1), 0) || total;

  const partes: Uint8Array[] = [];
  const saida = new Writable({
    write(trecho: Uint8Array, _enc, cb) {
      partes.push(trecho);
      cb();
    },
  });
  try {
    const r = await converterZip(zip, { modeloId: pedido.modeloId }, limites, saida);
    const arquivo = new Blob(partes as BlobPart[], { type: "model/3mf" });
    return { tipo: "ok", arquivo, relatorio: r.relatorio, milissegundos: Math.round(performance.now() - inicio) };
  } finally {
    zip.fechar();
  }
}

self.onmessage = async (ev: MessageEvent<PedidoConversao>) => {
  let resposta: MensagemWorker;
  try {
    resposta = await converter(ev.data);
  } catch (e) {
    if (!ehErroConversao(e)) console.error(e);
    resposta = ehErroConversao(e)
      ? { tipo: "erro", codigo: e.codigo, mensagem: e.message }
      : { tipo: "erro", codigo: "ESTRUTURA_INESPERADA", mensagem: MENSAGENS.ESTRUTURA_INESPERADA };
  }
  enviar(resposta);
};
