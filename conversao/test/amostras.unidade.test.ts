// Suíte OPCIONAL com projetos reais (fora do repositório). Só roda se AMOSTRAS_3MF_DIR apontar
// para uma pasta local. Imprime apenas números agregados (sem nomes de arquivos).
//
//   AMOSTRAS_3MF_DIR=/caminho/projetos   (obrigatório)
//   AMOSTRAS_SAIDA_DIR=/caminho/saida    (opcional: grava os convertidos para abrir nos slicers)
//   AMOSTRAS_MAX_MB=25                   (opcional: ignora arquivos maiores)
//   AMOSTRAS_FILTRO=texto                (opcional: só arquivos cujo nome contém o texto)
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { converterProjeto } from "../src/converter.js";
import { listarModelos } from "../src/perfis.js";

const pasta = process.env.AMOSTRAS_3MF_DIR;
const ESPERADOS = new Set(["BICO_NAO_SUPORTADO", "NAO_E_PROJETO", "PROJETO_COM_GCODE"]);

describe.skipIf(!pasta)("amostras reais (opcional)", () => {
  it(
    "converte todas as amostras para todos os destinos sem erros inesperados",
    async () => {
      const maxBytes = Number(process.env.AMOSTRAS_MAX_MB ?? "25") * 1e6;
      const filtro = process.env.AMOSTRAS_FILTRO ?? "";
      const saidaDir = process.env.AMOSTRAS_SAIDA_DIR ?? join(tmpdir(), "conv3mf-amostras");
      mkdirSync(saidaDir, { recursive: true });
      const arquivos = readdirSync(pasta!)
        .filter((n) => n.toLowerCase().endsWith(".3mf") && !n.includes("_projeto_") && n.includes(filtro))
        .filter((n) => statSync(join(pasta!, n)).size <= maxBytes)
        .sort();
      const contagem: Record<string, number> = {};
      const avisos: Record<string, number> = {};
      const inesperados: string[] = [];
      let i = 0;
      for (const nome of arquivos) {
        // Por padrão os dois destinos conferidos no slicer; AMOSTRAS_MODELOS=todos para o catálogo inteiro.
        const modelos = process.env.AMOSTRAS_MODELOS === "todos" ? listarModelos().map((m) => m.id) : ["anycubic-kobra-s1", "flashforge-creator-5"];
        for (const id of modelos) {
          const base = nome.replace(/\.3mf$/i, "");
          const saida = join(saidaDir, `${base}__${id}.3mf`);
          try {
            const r = await converterProjeto({ entrada: join(pasta!, nome), saida, modeloId: id });
            contagem.ok = (contagem.ok ?? 0) + 1;
            for (const a of r.relatorio.avisos) avisos[a.codigo] = (avisos[a.codigo] ?? 0) + 1;
            if (!process.env.AMOSTRAS_SAIDA_DIR) rmSync(saida, { force: true });
          } catch (e) {
            const codigo = (e as { codigo?: string }).codigo ?? "SEM_CODIGO";
            contagem[codigo] = (contagem[codigo] ?? 0) + 1;
            if (!ESPERADOS.has(codigo)) inesperados.push(`#${i} ${id} ${codigo}`);
          }
        }
        i++;
      }
      // eslint-disable-next-line no-console -- só números agregados
      console.log(JSON.stringify({ arquivos: arquivos.length, contagem, avisos }));
      expect(inesperados).toEqual([]);
    },
    6 * 60 * 60 * 1000,
  );
});
