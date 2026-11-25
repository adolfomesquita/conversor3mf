import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { converterProjeto } from "../src/converter.js";
import { criarDeslocadorItens } from "../src/modeloPrincipal.js";
import { ErroConversao } from "../src/erros.js";
import { listarModelos, obterPerfil } from "../src/perfis.js";
import { gravar, lerZip, montarZip, origemPlacaBambu, pastaTemporaria, projetoBambu, type OpcoesProjeto } from "./ajudantes3mf.js";

const S1 = "anycubic-kobra-s1-0.4";
const C5 = "flashforge-creator-5-0.4";

let tmp: ReturnType<typeof pastaTemporaria>;
beforeEach(() => { tmp = pastaTemporaria(); });
afterEach(() => tmp.limpar());

async function converter(op: OpcoesProjeto, perfilId = S1) {
  const entrada = gravar(tmp.caminho("entrada.3mf"), montarZip(projetoBambu(op)));
  const saida = tmp.caminho("saida.3mf");
  const r = await converterProjeto({ entrada, saida, perfilId });
  const arquivos = await lerZip(saida);
  const config = JSON.parse(arquivos.get("Metadata/project_settings.config")!.toString("utf8")) as Record<string, unknown>;
  return { ...r, arquivos, config, entrada };
}

function codigos(r: { relatorio: { avisos: Array<{ codigo: string }> } }) {
  return r.relatorio.avisos.map((a) => a.codigo);
}

describe("conversão para o Kobra S1", () => {
  it("troca máquina, processo e filamentos mantendo cores, ordem e mudanças do usuário", async () => {
    const r = await converter({
      filamentos: [
        { tipo: "PLA", cor: "#FF0000", nome: "Bambu PLA Basic @BBL X1C" },
        { tipo: "PETG", cor: "#00ff00", nome: "Bambu PETG HF @BBL X1C" },
        { tipo: "PLA", cor: "#0000FF", nome: "Bambu PLA Silk @BBL X1C" },
      ],
    });
    const c = r.config;
    expect(c.printer_settings_id).toBe("Anycubic Kobra S1 0.4 nozzle");
    expect(c.print_settings_id).toBe("0.20mm Standard @Anycubic Kobra S1 0.4 nozzle");
    expect(c.filament_settings_id).toEqual([
      "Generic PLA @Anycubic Kobra S1 0.4 nozzle",
      "Generic PETG @Anycubic Kobra S1 0.4 nozzle",
      "Generic PLA Silk @Anycubic Kobra S1 0.4 nozzle",
    ]);
    expect(c.filament_colour).toEqual(["#FF0000", "#00FF00", "#0000FF"]);
    expect(c.filament_type).toEqual(["PLA", "PETG", "PLA"]);
    expect(c.printable_area).toEqual(["0x0", "250x0", "250x250", "0x250"]);
    expect(c.nozzle_diameter).toEqual(["0.4"]);
    expect(c.version).toBe("2.0.0.3");
    // Mudanças do usuário no processo: reaplicadas.
    expect(c.sparse_infill_density).toBe("25%");
    expect(c.enable_support).toBe("1");
    expect(c.brim_type).toBe("no_brim");
    expect(c.outer_wall_speed).toBe("300");
    // Não alterado pelo usuário: vem do processo de destino, não da origem.
    const proc = obterPerfil(S1).processos.find((p) => p.nome === c.print_settings_id)!;
    expect(c.wall_loops).toBe(proc.config.wall_loops);
    // Filamento 1: temperatura do usuário reaplicada; calibrações descartadas.
    expect((c.nozzle_temperature as string[])[0]).toBe("225");
    const filDestino = obterPerfil(S1).filamentos.perfis["Generic PLA @Anycubic Kobra S1 0.4 nozzle"]!;
    expect((c.filament_flow_ratio as string[])[0]).toBe((filDestino.filament_flow_ratio as string[])[0]);
    // G-code vem do destino, nunca da origem.
    expect(c.machine_start_gcode).toBe(obterPerfil(S1).maquina.config.machine_start_gcode);
    expect(c.z_offset).not.toBe("0.1");
    expect(c.filament_map).toEqual(["1", "1", "1"]);
    expect(c.physical_extruder_map).toBeUndefined();
    expect(c.different_settings_to_system).toEqual([
      "brim_type;enable_support;outer_wall_speed;sparse_infill_density",
      "nozzle_temperature",
      "",
      "",
      "",
    ]);

    const rel = r.relatorio;
    expect(rel.processo.exata).toBe(true);
    expect(rel.filamentos.map((f) => f.cor)).toEqual(["#FF0000", "#00FF00", "#0000FF"]);
    expect(rel.mantidos.map((m) => m.chave)).toEqual(expect.arrayContaining(["sparse_infill_density", "enable_support", "brim_type", "nozzle_temperature"]));
    expect(rel.revisar.map((m) => m.chave)).toContain("outer_wall_speed");
    expect(rel.descartados.map((m) => m.chave)).toEqual(expect.arrayContaining(["filament_flow_ratio", "pressure_advance", "z_offset"]));
    expect(codigos(r)).toEqual([]);
  });

  it("copia a geometria byte a byte e remove só os dados exclusivos do Bambu", async () => {
    const r = await converter({});
    const original = await lerZip(r.entrada);
    expect(r.arquivos.get("3D/Objects/object_1.model")!.equals(original.get("3D/Objects/object_1.model")!)).toBe(true);
    expect(r.arquivos.get("Metadata/plate_1.png")!.equals(original.get("Metadata/plate_1.png")!)).toBe(true);
    for (const removido of ["Metadata/slice_info.config", "Metadata/filament_settings_1.config", "Metadata/filament_sequence.json"]) {
      expect(r.arquivos.has(removido)).toBe(false);
    }
    expect([...r.arquivos.keys()].sort()).toEqual(
      [...original.keys()].filter((k) => !/slice_info|filament_settings_1|filament_sequence/.test(k)).sort(),
    );
    const settings = r.arquivos.get("Metadata/model_settings.config")!.toString("utf8");
    expect(settings).toContain('<metadata key="filament_maps" value="1 1"/>');
    expect(settings).toContain('<metadata key="filament_map_mode" value="Auto For Flush"/>');
    expect(settings).not.toContain("filament_volume_maps");
    expect(settings).toContain('<metadata key="wall_loops" value="3"/>'); // override por objeto mantido
  });

  it("mantém a posição dentro da placa e ajusta a grade de placas à mesa menor", async () => {
    const objetos = [
      { tamanho: [20, 20, 10] as [number, number, number], placa: 1, posicao: [10, 10] as [number, number] },
      { tamanho: [30, 30, 10] as [number, number, number], placa: 2, posicao: [200, 150] as [number, number] },
    ];
    const r = await converter({ objetos });
    const modelo = r.arquivos.get("3D/3dmodel.model")!.toString("utf8");
    const transforms = [...modelo.matchAll(/<item [^>]*transform="([^"]+)"/g)].map((m) => m[1]!.split(" ").map(Number));
    const n = 2;
    objetos.forEach((o, i) => {
      const [nx, ny] = origemPlacaBambu(o.placa, n, [250, 250]);
      expect(transforms[i]![9]).toBeCloseTo(nx + o.posicao[0] + o.tamanho[0] / 2, 5);
      expect(transforms[i]![10]).toBeCloseTo(ny + o.posicao[1] + o.tamanho[1] / 2, 5);
    });
    expect(codigos(r)).toEqual([]);
  });

  it("avisa objeto maior que a mesa e objeto fora da área", async () => {
    const r = await converter({
      objetos: [
        { tamanho: [252, 20, 10], placa: 1, posicao: [2, 10] },
        { tamanho: [20, 20, 10], placa: 2, posicao: [235, 10] },
      ],
    });
    expect(codigos(r)).toEqual(expect.arrayContaining(["NAO_CABE_NA_MESA", "FORA_DA_AREA"]));
    expect(r.relatorio.avisos.find((a) => a.codigo === "NAO_CABE_NA_MESA")!.mensagem).toContain("Placa 1");
    expect(r.relatorio.avisos.find((a) => a.codigo === "FORA_DA_AREA")!.mensagem).toContain("Placa 2");
  });

  it("avisa objeto mais alto que a área de impressão", async () => {
    const r = await converter({ objetos: [{ tamanho: [20, 20, 251], placa: 1, posicao: [10, 10] }] });
    expect(codigos(r)).toContain("NAO_CABE_NA_MESA");
  });

  it("aceita até 8 cores e avisa a partir de 9", async () => {
    const cores = (k: number) => Array.from({ length: k }, (_, i) => ({ tipo: "PLA", cor: `#0000${String(i).padStart(2, "0")}` }));
    expect(codigos(await converter({ filamentos: cores(8) }))).not.toContain("CORES_EXCEDEM");
    const r = await converter({ filamentos: cores(9) });
    expect(codigos(r)).toContain("CORES_EXCEDEM");
    expect((r.config.filament_colour as string[]).length).toBe(9);
  });

  it("usa o filamento padrão e marca revisão para tipos sem equivalente", async () => {
    const r = await converter({ filamentos: [{ tipo: "PVA", cor: "#EEEEEE" }, { tipo: "PA-CF", cor: "#222222" }] });
    expect(r.config.filament_settings_id).toEqual(["Generic PLA @Anycubic Kobra S1 0.4 nozzle", "Anycubic PA6-CF @Anycubic Kobra S1 0.4 nozzle"]);
    expect(codigos(r).filter((c) => c === "FILAMENTO_APROXIMADO")).toHaveLength(2);
  });
});

describe("forma dos valores", () => {
  for (const id of [S1, C5]) {
    it(`${id}: nenhum valor vazio indevido com um filamento de cada tipo mapeado`, async () => {
      const perfil = obterPerfil(id);
      const tipos = [...new Set(perfil.filamentos.regras.flatMap((r) => r.tipos))].slice(0, 60);
      const r = await converter({ filamentos: tipos.map((t, i) => ({ tipo: t, cor: `#${(i * 4099).toString(16).padStart(6, "0").slice(-6)}` })) }, id);
      const n = tipos.length;
      for (const [k, v] of Object.entries(r.config)) {
        if (!Array.isArray(v) || v.length !== n) continue;
        v.forEach((x, i) => {
          if (x !== "") return;
          const nomeDestino = (r.config.filament_settings_id as string[])[i]!;
          const doPerfil = perfil.filamentos.perfis[nomeDestino]![k];
          expect(Array.isArray(doPerfil) ? doPerfil[0] : doPerfil, `${k}[${i}]`).toBe("");
        });
      }
    });
  }

  it("projeto com valores por variante de bico (Bambu 2.x): usa a variante ativa e a forma do destino", async () => {
    const r = await converter({
      filamentos: [
        { tipo: "PLA", cor: "#FF0000" },
        { tipo: "PLA", cor: "#00FF00" },
      ],
      configExtra: {
        printer_extruder_variant: ["Direct Drive High Flow"],
        print_extruder_variant: ["Direct Drive Standard", "Direct Drive High Flow"],
        outer_wall_speed: ["200", "350"],
        initial_layer_speed: ["50"],
        filament_self_index: ["1", "1", "2", "2"],
        filament_extruder_variant: ["Direct Drive Standard", "Direct Drive High Flow", "Direct Drive Standard", "Direct Drive High Flow"],
        nozzle_temperature: ["220", "230", "240", "250"],
      },
      diferencas: ["outer_wall_speed;initial_layer_speed", "nozzle_temperature", "nozzle_temperature", ""],
    });
    expect(r.config.outer_wall_speed).toBe("350");
    expect(r.config.initial_layer_speed).toBe("50");
    expect((r.config.nozzle_temperature as string[]).slice(0, 2)).toEqual(["230", "250"]);
  });
});

describe("modelo principal grande (malha embutida, lido em streaming)", () => {
  it("mede a malha embutida e ajusta a posição", async () => {
    const entradas = projetoBambu({ objetos: [{ tamanho: [30, 30, 30], placa: 1, posicao: [230, 10] }] });
    // Move a malha do arquivo de objeto para dentro do 3dmodel.model (formato de projetos antigos).
    const malha = entradas.find((e) => e.nome === "3D/Objects/object_1.model")!.dados.toString();
    const objMalha = /<object id="1"[\s\S]*?<\/object>/.exec(malha)![0].replace('id="1"', 'id="7"');
    const modelo = entradas.find((e) => e.nome === "3D/3dmodel.model")!.dados.toString()
      .replace(/<component p:path="[^"]+" objectid="1"/, '<component objectid="7"')
      .replace("<resources>", `<resources>
  ${objMalha}`);
    const r = await converter({ substituir: { "3D/3dmodel.model": modelo }, omitir: ["3D/Objects/object_1.model"] });
    // 230 + 30 = 260 > 250: fora da área no destino (medido a partir da malha embutida).
    expect(codigos(r)).toContain("FORA_DA_AREA");
    const saida = r.arquivos.get("3D/3dmodel.model")!.toString();
    expect(saida).toContain('<object id="7"');
    const t = /<item [^>]*transform="([^"]+)"/.exec(saida)![1]!.split(" ").map(Number);
    expect(t[9]).toBeCloseTo(245, 5); // posição relativa à placa mantida (230 + 15)
  });

  it("o deslocador funciona com qualquer divisão em trechos e com '>' dentro de atributos", async () => {
    const xml = `<?xml version="1.0"?><model><resources><object id="1" name="a>b"/></resources><build><item objectid="1" name="x>y" transform="1 0 0 0 1 0 0 0 1 10 20 5"/><item objectid="1"/></build></model>`;
    for (const tamanho of [1, 2, 3, 7, 1000]) {
      const partes: Buffer[] = [];
      const b = Buffer.from(xml, "utf8");
      for (let i = 0; i < b.length; i += tamanho) partes.push(b.subarray(i, i + tamanho));
      const saida: Buffer[] = [];
      await new Promise<void>((res, rej) =>
        Readable.from(partes).pipe(criarDeslocadorItens([[1.5, -2], [3, 4]])).on("data", (c: Buffer) => saida.push(c)).on("end", res).on("error", rej),
      );
      const out = Buffer.concat(saida).toString();
      expect(out).toContain('name="x>y" transform="1 0 0 0 1 0 0 0 1 11.5 18 5"');
      expect(out).toContain('<item objectid="1" transform="1 0 0 0 1 0 0 0 1 3 4 0"/>');
      expect(out.replace(/transform="[^"]*"/g, "")).toBe(xml.replace(/transform="[^"]*"/g, "").replace('<item objectid="1"/>', '<item objectid="1" />'));
    }
  });
});

describe("valores de lista fixa (enum) aceitos pelo destino", () => {
  for (const id of [S1, C5]) {
    it(`${id}: traduz tree_organic -> organic e descarta valor desconhecido (global e por objeto)`, async () => {
      const r = await converter(
        {
          configExtra: { support_style: "tree_organic", wall_generator: "inexistente" },
          diferencas: ["support_style;wall_generator", "", "", ""],
          modelSettingsExtra: `<object id="900"><metadata key="name" value="x"/><metadata key="support_style" value="tree_organic"/><metadata key="seam_position" value="valor_desconhecido"/></object>`,
        },
        id,
      );
      expect(r.config.support_style).toBe("organic");
      const proc = obterPerfil(id).processos.find((p) => p.nome === r.config.print_settings_id)!;
      expect(r.config.wall_generator).toBe(proc.config.wall_generator ?? obterPerfil(id).maquina.config.wall_generator);
      const ms = r.arquivos.get("Metadata/model_settings.config")!.toString();
      expect(ms).toContain('<metadata key="support_style" value="organic"/>');
      expect(ms).not.toContain("valor_desconhecido");
      expect(ms).not.toContain("tree_organic");
      expect(r.relatorio.revisar.map((x) => x.chave)).toEqual(expect.arrayContaining(["wall_generator", "seam_position"]));
      // Nada que o slicer precise substituir ao abrir: todo enum gravado está na lista aceita.
      const aceitos = obterPerfil(id).valoresAceitos!;
      for (const [k, v] of Object.entries(r.config)) {
        if (typeof v === "string" && aceitos[k]) expect(aceitos[k], k).toContain(v);
      }
    });
  }
});

describe("conversão para o Creator 5", () => {
  it("usa 4 cabeçotes e avisa quando há mais filamentos", async () => {
    const r = await converter({ filamentos: Array.from({ length: 5 }, (_, i) => ({ tipo: "PLA", cor: `#1${i}1${i}1${i}` })) }, C5);
    expect(r.config.printer_settings_id).toBe("Flashforge Creator 5 0.4 nozzle");
    expect(r.config.nozzle_diameter).toEqual(["0.4", "0.4", "0.4", "0.4"]);
    expect(r.config.version).toBe("02.06.00.51");
    expect(codigos(r)).toContain("CORES_EXCEDEM");
    expect(r.relatorio.avisos.find((a) => a.codigo === "CORES_EXCEDEM")!.mensagem).toContain("4 cabeçotes");
  });

  it("sem processo de 0.16 mm: usa o mais próximo, mantém a altura e pede revisão", async () => {
    const r = await converter({ alturaCamada: "0.16" }, C5);
    expect(r.config.layer_height).toBe("0.16");
    expect(r.relatorio.processo.exata).toBe(false);
    expect(r.relatorio.processo.alturaCamadaPerfil).toBe(0.2);
    expect(codigos(r)).toContain("ALTURA_APROXIMADA");
    expect((r.config.different_settings_to_system as string[])[0]).toContain("layer_height");
  });

  it("mesa de mesmo tamanho: modelo principal não é reescrito", async () => {
    const r = await converter({}, C5);
    const original = await lerZip(r.entrada);
    expect(r.arquivos.get("3D/3dmodel.model")!.equals(original.get("3D/3dmodel.model")!)).toBe(true);
  });
});

describe("situações do projeto", () => {
  it("sem registro de mudanças do usuário: aplica o processo padrão e avisa", async () => {
    const r = await converter({ diferencas: null });
    expect(codigos(r)).toContain("SEM_DIFERENCAS_REGISTRADAS");
    expect(r.config.sparse_infill_density).not.toBe("25%");
  });

  it("recusa bico diferente do suportado", async () => {
    await expect(converter({ bico: "0.6" })).rejects.toMatchObject({ codigo: "BICO_NAO_SUPORTADO" });
  });

  it("marca comandos por camada para revisão", async () => {
    const r = await converter({
      entradasExtras: [{ nome: "Metadata/custom_gcode_per_layer.xml", dados: `<?xml version="1.0"?>\n<custom_gcodes_per_layer><plate><layer top_z="2" type="1" extruder="1" color="#FF0000" extra="" gcode="M600"/></plate></custom_gcodes_per_layer>` }],
    });
    expect(codigos(r)).toContain("GCODE_POR_CAMADA");
    expect(r.arquivos.has("Metadata/custom_gcode_per_layer.xml")).toBe(true);
  });

  it("avisa objeto atribuído a filamento inexistente", async () => {
    const r = await converter({ objetos: [{ tamanho: [10, 10, 10], placa: 1, posicao: [50, 50], extrusor: 5 }] });
    expect(codigos(r)).toContain("EXTRUSOR_INVALIDO");
  });

  it("recusa perfil de destino desconhecido", async () => {
    const entrada = gravar(tmp.caminho("e.3mf"), montarZip(projetoBambu()));
    await expect(converterProjeto({ entrada, saida: tmp.caminho("s.3mf"), perfilId: "nao-existe" })).rejects.toBeInstanceOf(ErroConversao);
  });

  it("o relatório não contém nomes de objetos", async () => {
    const r = await converter({});
    expect(JSON.stringify(r.relatorio)).not.toContain("Cubo");
  });
});

describe("escolha por modelo (o bico vem do projeto)", () => {
  async function porModelo(modeloId: string, op: OpcoesProjeto) {
    const entrada = gravar(tmp.caminho("m.3mf"), montarZip(projetoBambu(op)));
    return converterProjeto({ entrada, saida: tmp.caminho("ms.3mf"), modeloId });
  }

  it("usa o perfil do bico do projeto", async () => {
    expect((await porModelo("anycubic-kobra-s1", { bico: "0.4" })).relatorio.destino.perfilId).toBe("anycubic-kobra-s1-0.4");
    expect((await porModelo("anycubic-kobra-s1", { bico: "0.6", alturaCamada: "0.3" })).relatorio.destino.perfilId).toBe("anycubic-kobra-s1-0.6");
    expect((await porModelo("flashforge-creator-5", { bico: "0.25", alturaCamada: "0.1" })).relatorio.destino.perfilId).toBe("flashforge-creator-5-0.25");
  });

  it("bico HF não entra na escolha automática; bico sem perfil dá erro claro", async () => {
    expect((await porModelo("flashforge-guider4", { bico: "0.4" })).relatorio.destino.perfilId).toBe("flashforge-guider4-0.4");
    await expect(porModelo("flashforge-guider4", { bico: "0.8" })).rejects.toMatchObject({ codigo: "BICO_NAO_SUPORTADO" });
    await expect(porModelo("anycubic-kobra-2", { bico: "0.6" })).rejects.toMatchObject({
      codigo: "BICO_NAO_SUPORTADO",
      message: expect.stringContaining("0,4"),
    });
  });

  it("recusa modelo desconhecido sem abrir o arquivo", async () => {
    await expect(converterProjeto({ entrada: "nao-existe.3mf", saida: tmp.caminho("x.3mf"), modeloId: "../../etc/passwd" })).rejects.toMatchObject({ codigo: "PERFIL_DESCONHECIDO" });
  });
});

describe("todos os perfis gerados (teste sintético)", () => {
  const ids = listarModelos().flatMap((m) => m.perfis.map((p) => p.id));

  it("o catálogo tem os dois fabricantes e os perfis conferidos no slicer", () => {
    expect(ids.length).toBeGreaterThanOrEqual(70);
    expect(ids).toEqual(expect.arrayContaining([S1, C5]));
  });

  for (const id of ids) {
    it(`${id}: converte, sem valores vazios indevidos nem enum fora da lista`, async () => {
      const perfil = obterPerfil(id);
      const tipos = [...new Set(perfil.filamentos.regras.flatMap((r) => r.tipos))].slice(0, 12);
      const r = await converter(
        { bico: String(perfil.bico), filamentos: tipos.map((t, i) => ({ tipo: t, cor: `#${((i + 1) * 999331).toString(16).padStart(6, "0").slice(-6)}` })) },
        id,
      );
      expect(r.config.printer_settings_id).toBe(perfil.maquina.nome);
      const n = tipos.length;
      for (const [k, v] of Object.entries(r.config)) {
        if (Array.isArray(v) && v.length === n) {
          v.forEach((x, i) => {
            if (x !== "") return;
            const nome = (r.config.filament_settings_id as string[])[i]!;
            // Sem a chave no perfil do filamento, vale a do filamento padrão (como na conversão).
            const doPerfil = perfil.filamentos.perfis[nome]![k] ?? perfil.filamentos.perfis[perfil.filamentos.padrao]![k];
            expect(Array.isArray(doPerfil) ? doPerfil[0] : doPerfil, `${k}[${i}]`).toBe("");
          });
        }
        const aceitos = perfil.valoresAceitos?.[k];
        if (typeof v === "string" && aceitos) expect(aceitos, k).toContain(v);
      }
    });
  }
});
