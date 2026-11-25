// Destino Bambu Studio (2.9.1) e cabeçalho "Application" do projeto convertido.
// Formato conferido contra projetos genuínos do Bambu Studio 2.8 e o código-fonte da 2.9.1
// (bbs_3mf.cpp: só carrega configurações de projetos "BambuStudio-<versão>"; PrintConfig.cpp:
// listas por variante de bico e por filamento).
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { converterProjeto } from "../src/converter.js";
import { criarReescritorModelo } from "../src/modeloPrincipal.js";
import { obterPerfil } from "../src/perfis.js";
import { gravar, lerZip, montarZip, pastaTemporaria, projetoBambu, type OpcoesProjeto } from "./ajudantes3mf.js";

const P1S = "bambu-lab-p1s-0.4";
const A1 = "bambu-lab-a1-0.4";
const S1 = "anycubic-kobra-s1-0.4";
const C5 = "flashforge-creator-5-0.4";
const APP_BAMBU = "BambuStudio-02.09.01.70";

let tmp: ReturnType<typeof pastaTemporaria>;
beforeEach(() => {
  tmp = pastaTemporaria();
});
afterEach(() => tmp.limpar());

/** Projeto sintético com outro cabeçalho Application (null = sem o metadado). */
function comAplicacao(app: string | null, op: OpcoesProjeto = {}) {
  const base = projetoBambu(op);
  const original = base.find((e) => e.nome === "3D/3dmodel.model")!.dados.toString();
  const modelo =
    app === null
      ? original.replace(/<metadata name="Application">[^<]*<\/metadata>/, "")
      : original.replace("BambuStudio-02.08.02.61", app);
  return projetoBambu({ ...op, substituir: { ...(op.substituir ?? {}), "3D/3dmodel.model": modelo } });
}

async function converter(entradas: ReturnType<typeof projetoBambu>, perfilId: string) {
  const entrada = gravar(tmp.caminho("entrada.3mf"), montarZip(entradas));
  const saida = tmp.caminho("saida.3mf");
  const r = await converterProjeto({ entrada, saida, perfilId });
  const arquivos = await lerZip(saida);
  const config = JSON.parse(arquivos.get("Metadata/project_settings.config")!.toString("utf8")) as Record<string, unknown>;
  const app = /<metadata name="Application">([^<]*)<\/metadata>/.exec(arquivos.get("3D/3dmodel.model")!.toString("utf8"))?.[1];
  return { ...r, config, app, arquivos };
}

const lista = (v: unknown) => (Array.isArray(v) ? (v as string[]) : [String(v)]);

describe("cabeçalho Application", () => {
  it("destino Bambu: sempre a versão do Bambu Studio do catálogo (senão projetos antigos são reposicionados)", async () => {
    for (const app of ["BambuStudio-02.04.00.70", "BambuStudio-1.3.9.4", "BambuStudio-2.0.0.3", "Creality_Print V7.1.1.4472 Release"]) {
      const r = await converter(comAplicacao(app), P1S);
      expect(r.app, app).toBe(APP_BAMBU);
      expect(r.relatorio.substituidos.some((s) => s.para === APP_BAMBU)).toBe(true);
    }
  });

  it("origem sem Application (OrcaSlicer só com o metadado próprio): o metadado é inserido", async () => {
    const base = comAplicacao(null);
    const modelo = base.find((e) => e.nome === "3D/3dmodel.model")!.dados.toString().replace("<resources>", '<metadata name="OrcaSlicer">2.4.2</metadata><resources>');
    const r = await converter(projetoBambu({ substituir: { "3D/3dmodel.model": modelo } }), P1S);
    expect(r.relatorio.origem.slicer).toBe("OrcaSlicer");
    expect(r.app).toBe(APP_BAMBU);
  });

  it("Anycubic e Flashforge: mantém o da família Bambu e troca o de outros slicers", async () => {
    expect((await converter(comAplicacao("BambuStudio-02.04.00.70"), S1)).app).toBe("BambuStudio-02.04.00.70");
    expect((await converter(comAplicacao("Creality_Print V7.1.1.4472 Release", { entradasExtras: [{ nome: "Metadata/creality.config", dados: "{}" }] }), S1)).app).toBe(
      "BambuStudio-2.0.0.3",
    );
    expect((await converter(comAplicacao("Creality_Print V7.1.1.4472 Release", { entradasExtras: [{ nome: "Metadata/creality.config", dados: "{}" }] }), C5)).app).toBe(
      "BambuStudio-02.06.00.51",
    );
  });

  it("reescreve em streaming com qualquer divisão em pedaços e só no cabeçalho", async () => {
    const xml =
      '<?xml version="1.0"?><model><metadata name="Title">a &lt; b</metadata><metadata name="Application">Creality_Print V7</metadata>' +
      '<resources><object id="1"><metadata name="Application">dentro</metadata></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>';
    for (const tamanho of [1, 2, 5, 1000]) {
      const b = Buffer.from(xml, "utf8");
      const partes: Buffer[] = [];
      for (let i = 0; i < b.length; i += tamanho) partes.push(b.subarray(i, i + tamanho));
      const saida: Buffer[] = [];
      await new Promise<void>((res, rej) =>
        Readable.from(partes)
          .pipe(criarReescritorModelo({ deltas: null, aplicacao: "BambuStudio-<x>" }))
          .on("data", (c: Buffer) => saida.push(c))
          .on("end", res)
          .on("error", rej),
      );
      const out = Buffer.concat(saida).toString();
      expect(out).toBe(xml.replace("Creality_Print V7", "BambuStudio-&lt;x&gt;"));
    }
  });
});

describe("destino Bambu Studio", () => {
  const filamentos = [
    { tipo: "PLA", cor: "#FF0000", nome: "Anycubic PLA @Anycubic Kobra S1 0.4 nozzle" },
    { tipo: "PETG", cor: "#00FF00", nome: "Generic PETG @Anycubic Kobra S1 0.4 nozzle" },
    { tipo: "PLA", cor: "#0000FF", nome: "Anycubic PLA Matte @Anycubic Kobra S1 0.4 nozzle" },
  ];

  it("formato do Bambu Studio 2.x: um valor por filamento na variante padrão, índices e mapas", async () => {
    for (const id of [P1S, A1]) {
      const r = await converter(projetoBambu({ filamentos }), id);
      const c = r.config;
      const n = 3;
      expect(c.filament_settings_id).toEqual([expect.any(String), expect.any(String), expect.any(String)]);
      expect(c.filament_colour).toEqual(["#FF0000", "#00FF00", "#0000FF"]);
      expect(c.filament_self_index).toEqual(["1", "2", "3"]);
      expect(c.filament_nozzle_map).toEqual(["0", "0", "0"]);
      expect(c.filament_volume_map).toEqual(["0", "0", "0"]);
      expect(c.filament_extruder_variant).toEqual(Array(n).fill("Direct Drive Standard"));
      for (const k of ["nozzle_temperature", "filament_flow_ratio", "filament_max_volumetric_speed", "filament_type"]) expect(lista(c[k]), k).toHaveLength(n);
      // Vários valores por filamento (secagem no AMS): a lista inteira de cada filamento, em sequência.
      const dev = lista(c.filament_dev_ams_drying_temperature);
      expect(dev.length % n).toBe(0);
      expect(dev.length).toBeGreaterThan(n);
      // Processo: um valor por variante de bico da impressora.
      const pv = lista(c.print_extruder_variant).length;
      expect(lista(c.outer_wall_speed)).toHaveLength(pv);
      expect(c.different_settings_to_system).toHaveLength(n + 2);
      expect(c.version).toBe("02.09.01.70");
      expect(r.app).toBe(APP_BAMBU);
    }
  });

  it("valor do filamento vem da variante padrão do perfil de destino", async () => {
    const r = await converter(projetoBambu({ filamentos: [{ tipo: "PLA", cor: "#FFFFFF" }] }), P1S);
    const perfil = obterPerfil(P1S);
    const pf = perfil.filamentos.perfis[(r.config.filament_settings_id as string[])[0]!]!;
    const variantes = lista(pf.filament_extruder_variant);
    const j = variantes.indexOf("Direct Drive Standard");
    expect(j).toBeGreaterThanOrEqual(0);
    // Chave por variante que não é mudança reaplicada do usuário.
    expect(lista(r.config.filament_max_volumetric_speed)[0]).toBe(lista(pf.filament_max_volumetric_speed)[j]);
    expect(lista(r.config.filament_flow_ratio)[0]).toBe(lista(pf.filament_flow_ratio)[j]);
  });

  it("support_style organic (Anycubic/Flashforge) vira tree_organic no Bambu, global e por objeto", async () => {
    const r = await converter(
      comAplicacao("BambuStudio-2.0.0.3", {
        configExtra: { support_style: "organic" },
        diferencas: ["support_style", "", "", ""],
        modelSettingsExtra: `<object id="900"><metadata key="name" value="x"/><metadata key="support_style" value="organic"/></object>`,
      }),
      P1S,
    );
    expect(r.config.support_style).toBe("tree_organic");
    expect(r.arquivos.get("Metadata/model_settings.config")!.toString()).toContain('<metadata key="support_style" value="tree_organic"/>');
    const aceitos = obterPerfil(P1S).valoresAceitos!;
    for (const [k, v] of Object.entries(r.config)) if (typeof v === "string" && aceitos[k]) expect(aceitos[k], k).toContain(v);
  });

  it("Bambu para Bambu (P1S -> A1): converte e mantém cores e ordem", async () => {
    const r = await converter(projetoBambu(), A1);
    expect(r.relatorio.destino.impressora).toBe("Bambu Lab A1");
    expect(r.relatorio.filamentos.map((f) => f.cor)).toEqual((r.config.filament_colour as string[]).map((c) => c.toUpperCase()));
  });

  it("modelos de dois bicos ficam fora do catálogo", () => {
    for (const id of ["bambu-lab-h2d-0.4", "bambu-lab-h2c-0.4", "bambu-lab-x2d-0.4"]) expect(() => obterPerfil(id)).toThrow();
  });
});
