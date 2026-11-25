// Destino Snapmaker Orca (2.4.1) e projetos salvos por ele como origem. Conferido contra o código-fonte
// da 2.4.1 (bbs_3mf.cpp: só "BambuStudio-" e "Snapmaker_Orca-" contam como projeto da família; com
// outro cabeçalho ele divide objetos repetidos e trata como projeto de terceiros; versão < 1.5.9 vira
// projeto antigo e as placas são reposicionadas).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { converterProjeto } from "../src/converter.js";
import { identificarOrigem } from "../src/origem.js";
import { obterPerfil } from "../src/perfis.js";
import { gravar, lerZip, montarZip, pastaTemporaria, projetoBambu, type OpcoesProjeto } from "./ajudantes3mf.js";

const U1 = "snapmaker-u1-0.4";
const J1 = "snapmaker-j1-0.4";
const S1 = "anycubic-kobra-s1-0.4";
const APP = "Snapmaker_Orca-2.4.1";

let tmp: ReturnType<typeof pastaTemporaria>;
beforeEach(() => {
  tmp = pastaTemporaria();
});
afterEach(() => tmp.limpar());

function comAplicacao(app: string, op: OpcoesProjeto = {}) {
  const base = projetoBambu(op);
  const modelo = base.find((e) => e.nome === "3D/3dmodel.model")!.dados.toString().replace("BambuStudio-02.08.02.61", app);
  return projetoBambu({ ...op, substituir: { ...(op.substituir ?? {}), "3D/3dmodel.model": modelo } });
}

async function converter(entradas: ReturnType<typeof projetoBambu>, perfilId: string) {
  const entrada = gravar(tmp.caminho("entrada.3mf"), montarZip(entradas));
  const saida = tmp.caminho("saida.3mf");
  const r = await converterProjeto({ entrada, saida, perfilId });
  const arquivos = await lerZip(saida);
  const config = JSON.parse(arquivos.get("Metadata/project_settings.config")!.toString("utf8")) as Record<string, unknown>;
  const app = /<metadata name="Application">([^<]*)<\/metadata>/.exec(arquivos.get("3D/3dmodel.model")!.toString("utf8"))?.[1];
  return { ...r, config, app };
}

describe("destino Snapmaker Orca", () => {
  it("cabeçalho sempre do Snapmaker Orca 2.4.1, de qualquer origem", async () => {
    for (const app of ["BambuStudio-02.08.02.61", "BambuStudio-1.3.9.4", "Creality_Print V7.1.1.4472 Release", APP]) {
      const r = await converter(comAplicacao(app), U1);
      expect(r.app, app).toBe(APP);
      expect(r.config.version).toBe("2.4.1");
      expect(r.config.printer_settings_id).toBe(obterPerfil(U1).maquina.nome);
    }
  });

  it("U1: 4 cabeçotes (troca de ferramenta); mais cores que isso dá aviso", async () => {
    const p = obterPerfil(U1);
    expect(p).toMatchObject({ extrusoras: 4, maxFilamentos: 4, multiMaterial: "trocaDeFerramenta" });
    expect(obterPerfil(J1)).toMatchObject({ extrusoras: 2, maxFilamentos: 2 });
    const quatro = Array.from({ length: 4 }, (_, i) => ({ tipo: "PLA", cor: `#0000${i}${i}` }));
    expect((await converter(projetoBambu({ filamentos: quatro }), U1)).relatorio.avisos.some((a) => a.codigo === "CORES_EXCEDEM")).toBe(false);
    const seis = Array.from({ length: 6 }, (_, i) => ({ tipo: "PLA", cor: `#0000${i}${i}` }));
    expect((await converter(projetoBambu({ filamentos: seis }), U1)).relatorio.avisos.some((a) => a.codigo === "CORES_EXCEDEM")).toBe(true);
  });

  it("valores de lista fixa aceitos pelo Snapmaker Orca", async () => {
    const r = await converter(projetoBambu(), U1);
    const aceitos = obterPerfil(U1).valoresAceitos!;
    for (const [k, v] of Object.entries(r.config)) {
      if (!aceitos[k]) continue;
      for (const x of Array.isArray(v) ? (v as string[]) : [v as string]) expect(aceitos[k], k).toContain(x);
    }
  });
});

describe("projeto salvo pelo Snapmaker Orca como origem", () => {
  it("é reconhecido (antes era 'slicer desconhecido' e recusado)", () => {
    const o = identificarOrigem(["Metadata/project_settings.config", "3D/3dmodel.model"], new Map([["Application", APP]]), true);
    expect(o).toEqual({ slicer: "Snapmaker Orca", versao: "2.4.1", suportado: true });
  });

  it("converte para outra marca; Anycubic recebe o cabeçalho da família Bambu", async () => {
    const r = await converter(comAplicacao(APP), S1);
    expect(r.relatorio.origem.slicer).toBe("Snapmaker Orca");
    expect(r.app).toBe("BambuStudio-2.0.0.3");
  });
});
