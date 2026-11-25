// Destino Creality Print (7.3.1). Formato conferido contra um projeto genuíno do Creality Print 7.1.1
// (K2 Plus) e o código-fonte da 7.3.1:
// - Check3mfVendor.cpp: projeto sem "Creality" no cabeçalho Application e sem Metadata/creality.config
//   abre a janela "não é do Creality Print, escolha a impressora" e refaz as configurações;
// - PrintConfig.cpp: filament_map_mode só aceita AutoForSaving/AutoForMatch/Manual; velocidades e
//   limites da máquina são listas; material_flow_temp_graph é valor único.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { converterProjeto } from "../src/converter.js";
import { obterPerfil } from "../src/perfis.js";
import { gravar, lerZip, montarZip, pastaTemporaria, projetoBambu, type OpcoesProjeto } from "./ajudantes3mf.js";

const K2P = "creality-k2-plus-0.4";
const K1C = "creality-k1c-0.4";
const E3V3 = "creality-ender-3-v3-0.4";
const P1S = "bambu-lab-p1s-0.4";
const APP_CREALITY = "Creality_Print V7.3.1.6378 Release";

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
  return { ...r, config, app, arquivos };
}

describe("destino Creality Print", () => {
  it("cabeçalho sempre do Creality Print 7.3.1, de qualquer origem (senão ele pede para escolher a impressora)", async () => {
    for (const app of ["BambuStudio-02.08.02.61", "BambuStudio-2.0.0.3", "Creality_Print V5.1.7.10514 Release", "Creality_Print V7.1.1.4472 Release"]) {
      const r = await converter(comAplicacao(app), K2P);
      expect(r.app, app).toBe(APP_CREALITY);
      expect(r.config.version).toBe("7.3.1.6378");
    }
  });

  it("não grava Metadata/creality.config (o slicer migra os padrões antigos de filamento por função)", async () => {
    const r = await converter(projetoBambu(), K2P);
    expect([...r.arquivos.keys()].some((k) => /creality\.config$/i.test(k))).toBe(false);
  });

  it("modo de mapeamento de filamentos com o nome do Creality Print, no projeto e nas placas", async () => {
    const r = await converter(projetoBambu(), K1C);
    expect(r.config.filament_map_mode).toBe("AutoForSaving");
    const ms = r.arquivos.get("Metadata/model_settings.config")!.toString("utf8");
    expect(ms).toContain('<metadata key="filament_map_mode" value="AutoForSaving"/>');
    expect(ms).not.toContain("Auto For Flush");
    // E de volta para a família Bambu: o nome do Bambu Studio.
    const b = await converter(comAplicacao(APP_CREALITY), P1S);
    expect(b.config.filament_map_mode).toBe("Auto For Flush");
  });

  it("listas no formato do Creality Print 7.3.1 e valores aceitos", async () => {
    const r = await converter(projetoBambu(), K2P);
    const c = r.config;
    expect(c.printable_area).toEqual(["0x0", "350x0", "350x350", "0x350"]);
    for (const k of ["machine_max_speed_x", "machine_max_acceleration_e", "outer_wall_speed", "bridge_speed"]) expect(Array.isArray(c[k]), k).toBe(true);
    const aceitos = obterPerfil(K2P).valoresAceitos!;
    for (const [k, v] of Object.entries(c)) {
      if (!aceitos[k]) continue;
      for (const x of Array.isArray(v) ? (v as string[]) : [v as string]) expect(aceitos[k], k).toContain(x);
    }
  });

  it("valor único do perfil de filamento sai sem lista (material_flow_temp_graph)", async () => {
    // CR-10 Smart: o filamento padrão (Generic PLA) define a chave.
    const id = "creality-cr-10-smart-0.4";
    const perfil = obterPerfil(id);
    expect(perfil.escalaresFilamento).toContain("material_flow_temp_graph");
    const esperado = perfil.filamentos.perfis[perfil.filamentos.padrao]!.material_flow_temp_graph;
    expect(typeof esperado).toBe("string");
    const r = await converter(projetoBambu({ filamentos: [{ tipo: "PLA", cor: "#FFFFFF" }] }), id);
    expect(r.config.material_flow_temp_graph).toBe(esperado);
  });

  it("nenhum endereço de rede do perfil vai para o projeto (Ender-3 V3 traz um IP interno)", async () => {
    const r = await converter(projetoBambu(), E3V3);
    for (const k of ["print_host", "print_host_webui", "printhost_apikey"]) expect(r.config[k] ?? "", k).toBe("");
    expect(JSON.stringify(r.config)).not.toMatch(/\d+\.\d+\.\d+\.\d+:\d+/);
  });

  it("nome mostrado sem o sublinhado interno; modelos de vários bicos fora", () => {
    expect(obterPerfil("creality-k1c-cfs-c-0.4").impressora).toBe("Creality K1C CFS-C");
    expect(obterPerfil("creality-k1c-cfs-c-0.4").maquina.config.printer_model).toBe("Creality K1C_CFS-C");
    for (const id of ["creality-k3-0.4", "creality-sermoon-d3-pro-0.4"]) expect(() => obterPerfil(id)).toThrow();
  });
});
