// Conversão no servidor: caminho de entrada -> caminho de saída + relatório. A lógica fica em
// converterNucleo.ts (o mesmo código roda no navegador, na versão estática).
import { createWriteStream, type WriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { converterZip, resolverDestino, type DestinoConversao, type ResultadoConversao } from "./converterNucleo.js";
import { limitesCom, type LimitesConversao } from "./limites.js";
import { ZipSeguro } from "./zipSeguro.js";

export type { ResultadoConversao } from "./converterNucleo.js";

export interface OpcoesConversao extends DestinoConversao {
  entrada: string;
  saida: string;
  limites?: Partial<LimitesConversao>;
}

export async function converterProjeto(opcoes: OpcoesConversao): Promise<ResultadoConversao> {
  const limites = limitesCom(opcoes.limites);
  // Recusa destino desconhecido antes de abrir o arquivo.
  const resolver = resolverDestino({ modeloId: opcoes.modeloId, perfilId: opcoes.perfilId });
  const zip = await ZipSeguro.abrir(opcoes.entrada, limites);
  let arquivo: WriteStream | null = null;
  let fechado: Promise<void> = Promise.resolve();
  // O arquivo de saída só é criado depois das validações (projeto recusado não deixa arquivo).
  const abrirSaida = () => {
    arquivo = createWriteStream(opcoes.saida);
    const a = arquivo;
    fechado = new Promise<void>((resolve) => a.on("close", () => resolve()));
    return a;
  };
  try {
    const r = await converterZip(zip, resolver, limites, abrirSaida);
    await fechado; // "close" vem depois de "finish": o arquivo já está fechado ao devolver
    return r;
  } catch (e) {
    if (arquivo) {
      (arquivo as WriteStream).destroy();
      await fechado;
      await unlink(opcoes.saida).catch(() => undefined);
    }
    throw e;
  } finally {
    zip.fechar();
  }
}
