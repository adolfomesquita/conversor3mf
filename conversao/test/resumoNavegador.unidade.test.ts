// O resumo exibido no navegador (site/src/servicos/analiseProjeto.ts) precisa dizer o mesmo que a
// conversão no servidor: slicer, versão, número de filamentos, placas, objetos e motivo de recusa.
// Roda com projetos sintéticos e, se AMOSTRAS_3MF_DIR estiver definido, com os projetos reais.
import { openAsBlob, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { converterProjeto } from "../src/converter.js";
import { ehErroConversao } from "../src/erros.js";
import { bicosDoModelo, listarModelos, perfilParaBico } from "../src/perfis.js";
import type { RelatorioConversao } from "../src/relatorio.js";
import { destinoAceitaBico } from "../src/resumoProjeto.js";
import { gravar, montarZip, pastaTemporaria, projetoBambu, type EntradaBruta } from "./ajudantes3mf.js";

interface Filamento {
  cor: string | null;
  tipo: string | null;
  nome: string | null;
}
type Analise =
  | {
      tipo: "ok";
      resumo: {
        slicer: string;
        versaoSlicer: string | null;
        impressora: string | null;
        bico: number | null;
        alturaCamada: number | null;
        filamentos: Filamento[];
        placas: number | null;
        objetos: number | null;
        miniatura: Blob | null;
      };
    }
  | { tipo: "recusado"; mensagem: string }
  | { tipo: "indisponivel" };

// Import dinâmico: o módulo é do pacote web (DOM, alias @conversao); fica fora do typecheck daqui.
const MODULO_WEB = new URL("../../site/src/servicos/analiseProjeto.ts", import.meta.url).href;
async function analisar(caminho: string): Promise<Analise> {
  const m = (await import(/* @vite-ignore */ MODULO_WEB)) as { analisarProjeto: (b: Blob) => Promise<Analise> };
  return m.analisarProjeto(await openAsBlob(caminho));
}

type Servidor =
  | { ok: true; origem: RelatorioConversao["origem"]; filamentos: RelatorioConversao["filamentos"] }
  | { ok: false; codigo: string; mensagem: string };

async function servidor(entrada: string, saida: string, modeloId = "anycubic-kobra-s1"): Promise<Servidor> {
  try {
    const r = await converterProjeto({ entrada, saida, modeloId });
    return { ok: true, origem: r.relatorio.origem, filamentos: r.relatorio.filamentos };
  } catch (e) {
    const err = e as { codigo?: string; message: string };
    return { ok: false, codigo: err.codigo ?? "?", mensagem: err.message };
  }
}

/** Diferenças entre o resumo do navegador e o servidor (vazio = concordam). */
function comparar(a: Analise, s: Servidor): string[] {
  if (!s.ok) {
    // Recusas que o resumo consegue ver antes do envio devem ter a mesma mensagem.
    if (["PROJETO_COM_GCODE", "NAO_E_PROJETO", "ORIGEM_NAO_SUPORTADA", "ZIP_CRIPTOGRAFADO"].includes(s.codigo)) {
      return a.tipo === "recusado" && a.mensagem === s.mensagem ? [] : [`recusa ${s.codigo}: navegador=${a.tipo}`];
    }
    return []; // demais erros (bico, XML, limites) só o servidor detecta
  }
  if (a.tipo !== "ok") return [`servidor converteu, navegador=${a.tipo}`];
  const r = a.resumo;
  const o = s.origem;
  const dif: string[] = [];
  if (r.slicer !== o.slicer) dif.push(`slicer ${r.slicer} != ${o.slicer}`);
  if (r.versaoSlicer !== o.versaoSlicer) dif.push(`versão ${r.versaoSlicer} != ${o.versaoSlicer}`);
  if (r.filamentos.length !== o.filamentos) dif.push(`filamentos ${r.filamentos.length} != ${o.filamentos}`);
  if (r.alturaCamada !== o.alturaCamada) dif.push(`altura ${r.alturaCamada} != ${o.alturaCamada}`);
  if (r.placas !== null && r.placas !== o.placas) dif.push(`placas ${r.placas} != ${o.placas}`);
  if (r.objetos !== null && r.objetos !== o.objetos) dif.push(`objetos ${r.objetos} != ${o.objetos}`);
  // Cada filamento: cor, tipo e nome iguais aos do relatório (o servidor usa #FFFFFF, "PLA" e ""
  // quando falta; o navegador mostra "não informado").
  s.filamentos.forEach((f, i) => {
    const b = r.filamentos[i];
    if (!b) return;
    if ((b.cor ?? "#FFFFFF") !== f.cor.slice(0, 7).toUpperCase()) dif.push(`filamento ${i + 1} cor ${b.cor} != ${f.cor}`);
    if ((b.tipo ?? "PLA") !== f.tipoOrigem.trim().slice(0, 30)) dif.push(`filamento ${i + 1} tipo ${b.tipo} != ${f.tipoOrigem}`);
    if ((b.nome ?? "") !== f.perfilOrigem.trim().slice(0, 80)) dif.push(`filamento ${i + 1} nome`);
  });
  return dif;
}

describe("resumo do projeto no navegador", () => {
  let tmp: ReturnType<typeof pastaTemporaria>;
  beforeEach(() => {
    tmp = pastaTemporaria();
  });
  afterEach(() => tmp.limpar());

  const rodar = async (entradas: EntradaBruta[]) => {
    const entrada = gravar(tmp.caminho("p.3mf"), montarZip(entradas));
    return { a: await analisar(entrada), s: await servidor(entrada, tmp.caminho("s.3mf")) };
  };

  it("projeto Bambu: mesmos dados do servidor, cores e tipos na ordem", async () => {
    const { a, s } = await rodar(
      projetoBambu({
        filamentos: [
          { tipo: "PLA", cor: "#FF0000", nome: "Bambu PLA Basic @BBL X1C" },
          { tipo: "PETG", cor: "#00ff00", nome: "Generic PETG @BBL X1C" },
          { tipo: "PLA", cor: "#0000FF80", nome: "Bambu PLA Matte @BBL X1C" },
        ],
        alturaCamada: "0.16",
      }),
    );
    expect(comparar(a, s)).toEqual([]);
    expect(a.tipo).toBe("ok");
    if (a.tipo !== "ok") return;
    expect(a.resumo.filamentos).toEqual([
      { cor: "#FF0000", tipo: "PLA", nome: "Bambu PLA Basic @BBL X1C" },
      { cor: "#00FF00", tipo: "PETG", nome: "Generic PETG @BBL X1C" },
      { cor: "#0000FF", tipo: "PLA", nome: "Bambu PLA Matte @BBL X1C" },
    ]);
    expect(a.resumo.bico).toBe(0.4);
    expect(a.resumo.alturaCamada).toBe(0.16);
  });

  it("destino bloqueado na tela ⇔ conversão recusaria o bico (todos os modelos)", () => {
    const divergentes: string[] = [];
    for (const m of listarModelos()) {
      for (const bico of [null, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1]) {
        let servidorAceita = true;
        try {
          perfilParaBico(m.id, bico);
        } catch (e) {
          if (!ehErroConversao(e) || e.codigo !== "BICO_NAO_SUPORTADO") throw e;
          servidorAceita = false;
        }
        // A tela recebe os bicos de listarDestinos, que usa bicosDoModelo.
        if (destinoAceitaBico(bicosDoModelo(m), bico) !== servidorAceita) divergentes.push(`${m.id} ${bico}`);
      }
    }
    expect(divergentes).toEqual([]);
  });

  it("cor inválida não vira CSS", async () => {
    const { a } = await rodar(projetoBambu({ filamentos: [{ tipo: "PLA", cor: "red;background:url(x)" }] }));
    expect(a.tipo === "ok" && a.resumo.filamentos[0]!.cor).toBeNull();
  });

  it("recusa .gcode.3mf com a mesma mensagem do servidor", async () => {
    const { a, s } = await rodar(projetoBambu({ entradasExtras: [{ nome: "Metadata/plate_1.gcode", dados: "G28" }] }));
    expect(s.ok).toBe(false);
    expect(comparar(a, s)).toEqual([]);
  });

  it("recusa 3MF sem configurações com a mesma mensagem do servidor", async () => {
    const { a, s } = await rodar(projetoBambu({ omitir: ["Metadata/project_settings.config"] }));
    expect(s.ok).toBe(false);
    expect(comparar(a, s)).toEqual([]);
  });

  it("arquivo que não é ZIP: resumo indisponível (o servidor dá o diagnóstico)", async () => {
    const entrada = gravar(tmp.caminho("x.3mf"), Buffer.from("não é zip"));
    expect((await analisar(entrada)).tipo).toBe("indisponivel");
  });

  it("entrada com tamanho declarado mentiroso não estoura o limite do leitor", async () => {
    const enorme = "x".repeat(20 * 1024 * 1024); // 20 MB comprime para quase nada
    const entradas = projetoBambu();
    const i = entradas.findIndex((e) => e.nome === "Metadata/project_settings.config");
    entradas[i] = { ...entradas[i]!, dados: enorme, tamanhoDeclarado: 100 };
    const entrada = gravar(tmp.caminho("bomba.3mf"), montarZip(entradas));
    expect((await analisar(entrada)).tipo).toBe("indisponivel");
  });
});

const pasta = process.env.AMOSTRAS_3MF_DIR;
describe.skipIf(!pasta)("resumo do navegador x servidor em amostras reais (opcional)", () => {
  it(
    "concorda com o servidor em todas as amostras",
    async () => {
      const tmp = pastaTemporaria();
      const maxBytes = Number(process.env.AMOSTRAS_MAX_MB ?? "25") * 1e6;
      const arquivos = readdirSync(pasta!)
        .filter((n) => n.toLowerCase().endsWith(".3mf") && !n.includes("_projeto_"))
        .filter((n) => statSync(join(pasta!, n)).size <= maxBytes)
        .sort();
      const diferencas: string[] = [];
      const contagem: Record<string, number> = {};
      try {
        for (const [i, nome] of arquivos.entries()) {
          const entrada = join(pasta!, nome);
          const a = await analisar(entrada);
          const s = await servidor(entrada, tmp.caminho("s.3mf"));
          contagem[a.tipo] = (contagem[a.tipo] ?? 0) + 1;
          if (a.tipo === "ok" && a.resumo.miniatura) contagem.miniatura = (contagem.miniatura ?? 0) + 1;
          for (const d of comparar(a, s)) diferencas.push(`#${i} ${d}`);
        }
      } finally {
        tmp.limpar();
      }
      // eslint-disable-next-line no-console -- só números agregados
      console.log(JSON.stringify({ arquivos: arquivos.length, contagem }));
      expect(diferencas).toEqual([]);
    },
    6 * 60 * 60 * 1000,
  );
});
