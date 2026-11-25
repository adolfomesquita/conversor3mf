import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { converterProjeto } from "../src/converter.js";
import { identificarOrigem, lerMetadadosCabecalho } from "../src/origem.js";
import { gravar, montarZip, pastaTemporaria, projetoBambu, type EntradaBruta } from "./ajudantes3mf.js";

const meta = (pares: Record<string, string>) => new Map(Object.entries(pares));

describe("identificação do slicer de origem (assinaturas reais)", () => {
  const casos: Array<[string, Record<string, string>, string[], boolean, string, string | null]> = [
    ["Bambu Studio", { Application: "BambuStudio-02.08.02.61" }, [], true, "Bambu Studio", "02.08.02.61"],
    ["Anycubic Slicer Next 2", { Application: "BambuStudio-2.0.0.3" }, [], true, "Anycubic Slicer Next", "2.0.0.3"],
    ["Anycubic Slicer Next 1.3", { Application: "BambuStudio-1.3.0" }, [], true, "Anycubic Slicer Next", "1.3.0"],
    ["OrcaSlicer", { Application: "BambuStudio-02.06.00.51", OrcaSlicer: "2.4.2" }, [], true, "OrcaSlicer", "2.4.2"],
    ["Creality Print", { Application: "Creality_Print V7.1.1.4472 Release" }, ["Metadata/creality.config"], true, "Creality Print", "7.1.1.4472"],
    ["PrusaSlicer", { Application: "PrusaSlicer-2.8.1" }, ["Metadata/Slic3r_PE.config"], false, "PrusaSlicer", "2.8.1"],
    ["Cura", { Application: "UltiMaker Cura 5.8" }, ["Cura/x.cfg"], false, "Cura", "5.8"],
    ["3MF puro", {}, [], false, "Sem slicer", null],
  ];
  for (const [rotulo, m, extras, temProjeto, slicer, versao] of casos) {
    it(rotulo, () => {
      const o = identificarOrigem(["3D/3dmodel.model", ...extras], meta(m), temProjeto);
      expect(o.slicer).toBe(slicer);
      expect(o.versao).toBe(versao);
      expect(o.suportado).toBe(temProjeto && ["Bambu Studio", "Anycubic Slicer Next", "OrcaSlicer", "Creality Print"].includes(slicer));
    });
  }

  it("lê só os metadados do cabeçalho, decodificando entidades", () => {
    const m = lerMetadadosCabecalho(`<?xml version="1.0"?><model><metadata name="Application">BambuStudio-02.08.02.61</metadata><metadata name="Title">A &amp; B</metadata><resources><metadata name="Application">falso</metadata></resources></model>`);
    expect(m.get("Application")).toBe("BambuStudio-02.08.02.61");
    expect(m.get("Title")).toBe("A & B");
  });
});

describe("conversão conforme a origem", () => {
  let tmp: ReturnType<typeof pastaTemporaria>;
  beforeEach(() => { tmp = pastaTemporaria(); });
  afterEach(() => tmp.limpar());

  const comAplicacao = (app: string, extra: Parameters<typeof projetoBambu>[0] = {}): EntradaBruta[] => {
    const base = projetoBambu(extra);
    const modelo = base.find((e) => e.nome === "3D/3dmodel.model")!.dados.toString().replace("BambuStudio-02.08.02.61", app);
    return projetoBambu({ ...extra, substituir: { ...(extra.substituir ?? {}), "3D/3dmodel.model": modelo } });
  };

  async function rodar(entradas: EntradaBruta[]) {
    const entrada = gravar(tmp.caminho("e.3mf"), montarZip(entradas));
    return converterProjeto({ entrada, saida: tmp.caminho("s.3mf"), perfilId: "anycubic-kobra-s1-0.4" });
  }

  it("registra o slicer de origem no relatório", async () => {
    const r = await rodar(projetoBambu());
    expect(r.relatorio.origem.slicer).toBe("Bambu Studio");
    expect(r.relatorio.origem.versaoSlicer).toBe("02.08.02.61");
  });

  it("projeto do Anycubic Slicer Next para a mesma impressora: converte e avisa", async () => {
    const r = await rodar(comAplicacao("BambuStudio-2.0.0.3", { configExtra: { printer_settings_id: "Anycubic Kobra S1 0.4 nozzle" } }));
    expect(r.relatorio.origem.slicer).toBe("Anycubic Slicer Next");
    expect(r.relatorio.avisos.map((a) => a.codigo)).toContain("MESMA_IMPRESSORA");
  });

  it("Creality Print: converte e descarta os dados exclusivos dele", async () => {
    const r = await rodar(comAplicacao("Creality_Print V7.1.1.4472 Release", { entradasExtras: [{ nome: "Metadata/creality.config", dados: "<config/>" }] }));
    expect(r.relatorio.origem.slicer).toBe("Creality Print");
    expect(r.relatorio.descartados.some((d) => d.descricao.includes("Creality"))).toBe(true);
  });

  it("recusa PrusaSlicer com mensagem que cita o slicer", async () => {
    const entradas = comAplicacao("PrusaSlicer-2.8.1", { omitir: ["Metadata/project_settings.config"] });
    await expect(rodar([...entradas, { nome: "Metadata/Slic3r_PE.config", dados: "; x" }])).rejects.toMatchObject({
      codigo: "ORIGEM_NAO_SUPORTADA",
      message: expect.stringContaining("PrusaSlicer"),
    });
  });

  it("recusa 3MF sem configurações de slicer", async () => {
    const entradas = comAplicacao("", { omitir: ["Metadata/project_settings.config", "Metadata/model_settings.config"] });
    await expect(rodar(entradas)).rejects.toMatchObject({ codigo: "ORIGEM_NAO_SUPORTADA", message: expect.stringContaining("só tem geometria") });
  });

  it("projeto Bambu sem configurações: não é projeto", async () => {
    await expect(rodar(projetoBambu({ omitir: ["Metadata/project_settings.config"] }))).rejects.toMatchObject({ codigo: "NAO_E_PROJETO" });
  });
});
