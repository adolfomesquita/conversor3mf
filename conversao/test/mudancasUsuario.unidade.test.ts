// Mudanças do usuário em opções que o perfil de destino não define: o relatório só pede revisão
// quando há motivo. Opção que o slicer de destino conhece = mudança mantida; opção que ele não tem =
// descartada (não teria efeito), sem alarme.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { converterProjeto } from "../src/converter.js";
import { obterPerfil, opcoesDoSlicer } from "../src/perfis.js";
import { gravar, lerZip, montarZip, pastaTemporaria, projetoBambu } from "./ajudantes3mf.js";

const S1 = "anycubic-kobra-s1-0.4";

let tmp: ReturnType<typeof pastaTemporaria>;
beforeEach(() => {
  tmp = pastaTemporaria();
});
afterEach(() => tmp.limpar());

async function converter(perfilId: string) {
  const entradas = projetoBambu({
    configExtra: { skin_infill_density: "9%", skeleton_infill_density: "9%", opcao_que_nenhum_slicer_tem: "1" },
    diferencas: ["opcao_que_nenhum_slicer_tem;skeleton_infill_density;skin_infill_density", "", "", ""],
  });
  const entrada = gravar(tmp.caminho("entrada.3mf"), montarZip(entradas));
  const saida = tmp.caminho("saida.3mf");
  const r = await converterProjeto({ entrada, saida, perfilId });
  const config = JSON.parse((await lerZip(saida)).get("Metadata/project_settings.config")!.toString("utf8")) as Record<string, unknown>;
  return { ...r, config };
}

describe("mudanças do usuário fora do perfil de destino", () => {
  it("todo destino tem a lista de opções do slicer", () => {
    for (const id of [S1, "flashforge-creator-5-0.4", "bambu-lab-p1s-0.4", "creality-k2-plus-0.4"]) {
      const opcoes = opcoesDoSlicer(obterPerfil(id));
      expect(opcoes, id).not.toBeNull();
      expect(opcoes!.size, id).toBeGreaterThan(500);
      expect(opcoes!.has("sparse_infill_density"), id).toBe(true);
    }
  });

  it("opção que o slicer conhece fica mantida, sem pedir revisão", async () => {
    const { relatorio, config } = await converter(S1);
    for (const k of ["skin_infill_density", "skeleton_infill_density"]) {
      expect(config[k], k).toBe("9%");
      expect(relatorio.revisar.some((i) => i.chave === k), k).toBe(false);
      expect(relatorio.mantidos.some((i) => i.chave === k), k).toBe(true);
    }
  });

  it("opção que o slicer não tem sai do projeto e vai para 'descartado', sem pedir revisão", async () => {
    const { relatorio, config } = await converter(S1);
    expect(config.opcao_que_nenhum_slicer_tem).toBeUndefined();
    expect(relatorio.revisar.some((i) => i.chave === "opcao_que_nenhum_slicer_tem")).toBe(false);
    const d = relatorio.descartados.find((i) => i.chave === "opcao_que_nenhum_slicer_tem");
    expect(d?.descricao).toContain("Anycubic Slicer Next não tem");
  });
});
