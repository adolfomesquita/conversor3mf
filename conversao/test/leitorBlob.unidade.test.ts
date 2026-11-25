// Caminho da versão do navegador (ZIP lido de um Blob em pedaços, saída num fluxo em memória) deve dar
// exatamente o mesmo resultado do caminho do servidor (arquivo no disco).
import { readFileSync, writeFileSync } from "node:fs";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { converterProjeto } from "../src/converter.js";
import { converterZip } from "../src/converterNucleo.js";
import { ErroConversao } from "../src/erros.js";
import { LeitorBlob } from "../src/leitorBlob.js";
import { limitesCom } from "../src/limites.js";
import { ZipSeguro } from "../src/zipSeguro.js";
import { gravar, lerZip, montarZip, pastaTemporaria, projetoBambu } from "./ajudantes3mf.js";

let tmp: ReturnType<typeof pastaTemporaria>;
beforeEach(() => {
  tmp = pastaTemporaria();
});
afterEach(() => tmp.limpar());

async function pelaMemoria(dados: Buffer, modeloId: string) {
  const limites = limitesCom();
  const blob = new Blob([new Uint8Array(dados)]);
  const zip = await ZipSeguro.abrirLeitor(new LeitorBlob(blob), blob.size, limites);
  const partes: Buffer[] = [];
  const saida = new Writable({
    write(trecho: Buffer, _enc, cb) {
      partes.push(trecho);
      cb();
    },
  });
  try {
    const r = await converterZip(zip, { modeloId }, limites, saida);
    return { ...r, bytes: Buffer.concat(partes) };
  } finally {
    zip.fechar();
  }
}

describe("conversão pelo Blob (versão do navegador)", () => {
  for (const modeloId of ["anycubic-kobra-s1", "creality-k1c", "snapmaker-u1", "bambu-lab-p1s"]) {
    it(`mesmo conteúdo e relatório que pelo disco: ${modeloId}`, async () => {
      const dados = montarZip(projetoBambu({ filamentos: [{ tipo: "PLA", cor: "#FF0000" }, { tipo: "PETG", cor: "#00FF00" }] }));
      const entrada = gravar(tmp.caminho("entrada.3mf"), dados);
      const disco = await converterProjeto({ entrada, saida: tmp.caminho("disco.3mf"), modeloId });
      const memoria = await pelaMemoria(dados, modeloId);

      expect(memoria.relatorio).toEqual(disco.relatorio);
      expect(memoria.bytesSaida).toBe(memoria.bytes.length);
      expect(memoria.bytesSaida).toBe(readFileSync(tmp.caminho("disco.3mf")).length);

      writeFileSync(tmp.caminho("memoria.3mf"), memoria.bytes);
      const a = await lerZip(tmp.caminho("disco.3mf"));
      const b = await lerZip(tmp.caminho("memoria.3mf"));
      expect([...b.keys()]).toEqual([...a.keys()]);
      for (const [nome, conteudo] of a) expect(b.get(nome)?.equals(conteudo), nome).toBe(true);
    });
  }

  it("erro no meio da cópia termina com erro (não fica esperando para sempre)", async () => {
    const entradas = projetoBambu().map((e) => (e.nome === "3D/Objects/object_1.model" ? { ...e, tamanhoDeclarado: 10 } : e));
    const r = await pelaMemoria(montarZip(entradas), "anycubic-kobra-s1").catch((e: unknown) => e);
    expect(r).toBeInstanceOf(ErroConversao);
  }, 20_000);

  it("mesmas recusas: arquivo que não é ZIP", async () => {
    await expect(pelaMemoria(Buffer.from("isto não é um zip"), "anycubic-kobra-s1")).rejects.toBeInstanceOf(ErroConversao);
  });
});
