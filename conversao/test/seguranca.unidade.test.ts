// O .3mf é entrada não confiável: zip bomb, path traversal, XXE, ZIP corrompido, G-code e scripts.
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { converterProjeto } from "../src/converter.js";
import { chaveBloqueada, lerConfigOrigem } from "../src/configProjeto.js";
import { LIMITES_PADRAO, type LimitesConversao } from "../src/limites.js";
import { nomeEntradaValido } from "../src/zipSeguro.js";
import { gravar, lerZip, montarZip, pastaTemporaria, projetoBambu, type EntradaBruta } from "./ajudantes3mf.js";

let tmp: ReturnType<typeof pastaTemporaria>;
beforeEach(() => { tmp = pastaTemporaria(); });
afterEach(() => tmp.limpar());

async function tentar(entradas: EntradaBruta[] | Buffer, limites?: Partial<LimitesConversao>) {
  const bruto = Buffer.isBuffer(entradas) ? entradas : montarZip(entradas);
  const entrada = gravar(tmp.caminho("entrada.3mf"), bruto);
  const saida = tmp.caminho("saida.3mf");
  try {
    const r = await converterProjeto({ entrada, saida, perfilId: "anycubic-kobra-s1-0.4", limites });
    return { ok: true as const, r, saida };
  } catch (e) {
    return { ok: false as const, codigo: (e as { codigo?: string }).codigo, saidaExiste: existsSync(saida) };
  }
}

async function esperarErro(entradas: EntradaBruta[] | Buffer, codigo: string, limites?: Partial<LimitesConversao>) {
  const r = await tentar(entradas, limites);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.codigo).toBe(codigo);
    expect(r.saidaExiste).toBe(false);
  }
}

describe("ZIP corrompido ou que não é ZIP", () => {
  it("bytes aleatórios", async () => {
    await esperarErro(Buffer.from("isto não é um zip".repeat(100)), "ZIP_INVALIDO");
  });

  it("arquivo vazio", async () => {
    await esperarErro(Buffer.alloc(0), "ZIP_INVALIDO");
  });

  it("ZIP truncado", async () => {
    const z = montarZip(projetoBambu());
    await esperarErro(z.subarray(0, Math.floor(z.length * 0.6)), "ZIP_INVALIDO");
  });

  it("conteúdo comprimido corrompido", async () => {
    const entradas = projetoBambu();
    const z = montarZip(entradas);
    // Corrompe bytes no meio dos dados (depois do primeiro cabeçalho local).
    for (let i = 200; i < 260; i++) z[i] = 0xff;
    const r = await tentar(z);
    expect(r.ok).toBe(false);
  });

  it("tamanho declarado menor que o real", async () => {
    const entradas = projetoBambu().map((e) => (e.nome === "3D/Objects/object_1.model" ? { ...e, tamanhoDeclarado: 10 } : e));
    const r = await tentar(entradas);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["ZIP_INVALIDO", "ZIP_LIMITE"]).toContain(r.codigo);
  });

  it("não é projeto Bambu (sem project_settings.config)", async () => {
    await esperarErro(projetoBambu({ omitir: ["Metadata/project_settings.config"] }), "NAO_E_PROJETO");
  });
});

describe("zip bomb e limites", () => {
  it("recusa entrada com razão de compressão excessiva", async () => {
    const bomba = Buffer.alloc(20 * 1024 * 1024, 0); // ~20 MB de zeros => ~20 KB comprimido
    await esperarErro([...projetoBambu(), { nome: "Auxiliaries/bomba.bin", dados: bomba }], "ZIP_LIMITE");
  });

  it("recusa total descompactado acima do limite", async () => {
    await esperarErro(projetoBambu(), "ZIP_LIMITE", { maxTotalDescompactado: 2000 });
  });

  it("recusa entrada individual acima do limite", async () => {
    await esperarErro(projetoBambu(), "ZIP_LIMITE", { maxEntradaDescompactada: 500 });
  });

  it("recusa número excessivo de entradas", async () => {
    const extras = Array.from({ length: 30 }, (_, i) => ({ nome: `Auxiliaries/f${i}.txt`, dados: "x" }));
    await esperarErro([...projetoBambu(), ...extras], "ZIP_LIMITE", { maxEntradas: 20 });
  });

  it("os limites padrão aceitam o projeto normal", async () => {
    expect(LIMITES_PADRAO.maxRazaoCompressao).toBeGreaterThan(40); // maior razão real observada ~40x
    expect((await tentar(projetoBambu())).ok).toBe(true);
  });
});

describe("nomes de entrada (path traversal)", () => {
  const ruins = ["../evil.txt", "3D/../../evil.txt", "/etc/passwd", "C:/Windows/x.txt", "3D/./x.model", "a//b.txt", "nul\u0000.txt", "ctrl\u0001.txt"];
  for (const nome of ruins) {
    it(`recusa ${JSON.stringify(nome)}`, async () => {
      expect(nomeEntradaValido(nome)).toBe(false);
      const r = await tentar([...projetoBambu(), { nome, dados: "x" }]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(["ZIP_CAMINHO_INVALIDO", "ZIP_INVALIDO"]).toContain(r.codigo);
    });
  }

  it("recusa barra invertida", async () => {
    const r = await tentar([...projetoBambu(), { nome: "Metadata\\..\\x.txt", dados: "x" }]);
    expect(r.ok).toBe(false);
  });

  it("aceita nomes Unicode legítimos", () => {
    expect(nomeEntradaValido("Auxiliaries/Model Pictures/foto ção 1.jpg")).toBe(true);
  });

  it("recusa entradas duplicadas, inclusive só por maiúsculas", async () => {
    await esperarErro([...projetoBambu(), { nome: "metadata/PROJECT_SETTINGS.config", dados: "{}" }], "ZIP_ENTRADA_DUPLICADA");
  });

  it("recusa link simbólico", async () => {
    await esperarErro([...projetoBambu(), { nome: "Auxiliaries/link", dados: "/etc/passwd", atributosExternos: (0o120777 << 16) >>> 0 }], "ZIP_CAMINHO_INVALIDO");
  });

  it("recusa entrada criptografada", async () => {
    const r = await tentar([...projetoBambu(), { nome: "Auxiliaries/seg.bin", dados: "x", flags: 0x1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["ZIP_CRIPTOGRAFADO", "ZIP_INVALIDO"]).toContain(r.codigo);
  });
});

describe("XML: DOCTYPE, entidades externas e XML malformado", () => {
  const xxe = `<?xml version="1.0"?>\n<!DOCTYPE config [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<config><object id="1"><metadata key="name" value="&xxe;"/></object></config>`;
  const bilhao = `<?xml version="1.0"?>\n<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]>\n<config>&lol2;</config>`;

  it("XXE no model_settings", async () => {
    await esperarErro(projetoBambu({ substituir: { "Metadata/model_settings.config": xxe } }), "XML_DTD");
  });

  it("expansão de entidades (billion laughs)", async () => {
    await esperarErro(projetoBambu({ substituir: { "Metadata/model_settings.config": bilhao } }), "XML_DTD");
  });

  it("DOCTYPE no 3dmodel.model", async () => {
    const entradas = projetoBambu();
    const modelo = entradas.find((e) => e.nome === "3D/3dmodel.model")!.dados.toString();
    const ruim = modelo.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE model SYSTEM "http://exemplo.invalid/x.dtd">');
    await esperarErro(projetoBambu({ substituir: { "3D/3dmodel.model": ruim } }), "XML_DTD");
  });

  it("DOCTYPE em arquivo de malha", async () => {
    const malha = `<?xml version="1.0"?>\n<!DOCTYPE model [<!ENTITY e SYSTEM "file:///etc/hosts">]>\n<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices><vertex x="&e;" y="0" z="0"/></vertices></mesh></object></resources></model>`;
    await esperarErro(projetoBambu({ substituir: { "3D/Objects/object_1.model": malha } }), "XML_DTD");
  });

  it("DOCTYPE em rels e content types", async () => {
    await esperarErro(projetoBambu({ substituir: { "_rels/.rels": `<?xml version="1.0"?><!DOCTYPE r SYSTEM "x"><Relationships/>` } }), "XML_DTD");
    await esperarErro(projetoBambu({ substituir: { "[Content_Types].xml": `<!DOCTYPE t [<!ENTITY a "b">]><Types/>` } }), "XML_DTD");
  });

  it("entidade não declarada", async () => {
    const ruim = `<?xml version="1.0"?>\n<config><object id="1"><metadata key="name" value="&naoexiste;"/></object></config>`;
    await esperarErro(projetoBambu({ substituir: { "Metadata/model_settings.config": ruim } }), "XML_INVALIDO");
  });

  it("XML malformado", async () => {
    await esperarErro(projetoBambu({ substituir: { "Metadata/model_settings.config": "<config><object></config>" } }), "XML_INVALIDO");
  });

  it("aninhamento profundo demais", async () => {
    const fundo = `<config>${"<a>".repeat(500)}${"</a>".repeat(500)}</config>`;
    await esperarErro(projetoBambu({ substituir: { "Metadata/model_settings.config": fundo } }), "XML_INVALIDO");
  });
});

describe("arquivos fatiados (.gcode.3mf)", () => {
  it("recusa G-code embutido", async () => {
    await esperarErro([...projetoBambu(), { nome: "Metadata/plate_1.gcode", dados: "G28\nG1 X10" }], "PROJETO_COM_GCODE");
  });

  const comReferencia = () => {
    const ms = projetoBambu().find((e) => e.nome === "Metadata/model_settings.config")!.dados.toString();
    return ms.replace('<metadata key="gcode_file" value=""/>', '<metadata key="gcode_file" value="Metadata/plate_1.gcode"/>');
  };

  it("recusa placa que aponta para G-code presente no pacote, mesmo com outra extensão", async () => {
    const ms = comReferencia().replace("Metadata/plate_1.gcode", "Metadata/plate_1.dat");
    await esperarErro(
      [...projetoBambu({ substituir: { "Metadata/model_settings.config": ms } }), { nome: "Metadata/plate_1.dat", dados: "G28" }],
      "PROJETO_COM_GCODE",
    );
  });

  it("aceita referência a G-code ausente (sobra de fatiamento) e a remove", async () => {
    const r = await tentar(projetoBambu({ substituir: { "Metadata/model_settings.config": comReferencia() } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ms = (await lerZip(r.saida)).get("Metadata/model_settings.config")!.toString();
    expect(ms).toContain('<metadata key="gcode_file" value=""/>');
    expect(ms).not.toContain("plate_1.gcode");
    expect(r.r.relatorio.descartados.some((d) => d.descricao.includes("G-code de um fatiamento anterior"))).toBe(true);
  });
});

describe("nada executável sai da origem", () => {
  it("remove post_process, G-code e host da origem, inclusive nas mudanças do usuário e por objeto", async () => {
    const r = await tentar(
      projetoBambu({
        configExtra: {
          post_process: ["C:\\Windows\\System32\\cmd.exe /c calc", "rm -rf ~"],
          print_host: "http://atacante.invalid",
          printhost_apikey: "chave",
          layer_change_gcode: "M117 ataque",
        },
        diferencas: ["post_process;layer_change_gcode;print_host;sparse_infill_density", "filament_start_gcode", "", "machine_start_gcode"],
        modelSettingsExtra: `<object id="999"><metadata key="name" value="x"/><metadata key="post_process" value="calc.exe"/><metadata key="before_layer_change_gcode" value="M0"/></object>`,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const arquivos = await lerZip(r.saida);
    const config = JSON.parse(arquivos.get("Metadata/project_settings.config")!.toString()) as Record<string, unknown>;
    expect(config.post_process).toEqual([]);
    expect(config.print_host).toBeUndefined();
    expect(config.printhost_apikey).toBeUndefined();
    expect(config.layer_change_gcode).not.toBe("M117 ataque");
    const texto = arquivos.get("Metadata/project_settings.config")!.toString();
    expect(texto).not.toContain("calc");
    expect(texto).not.toContain("atacante");
    const ms = arquivos.get("Metadata/model_settings.config")!.toString();
    expect(ms).not.toContain("post_process");
    expect(ms).not.toContain("before_layer_change_gcode");
    const descartados = r.r.relatorio.descartados.map((d) => d.chave);
    expect(descartados).toEqual(expect.arrayContaining(["post_process", "layer_change_gcode", "print_host"]));
  });

  it("classifica chaves executáveis e de host", () => {
    for (const k of ["machine_start_gcode", "layer_change_gcode", "filament_start_gcode", "post_process", "print_host", "printhost_apikey", "host_type"]) {
      expect(chaveBloqueada(k)).toBe(true);
    }
    for (const k of ["gcode_flavor", "gcode_file", "gcode_add_line_number", "sparse_infill_density", "nozzle_temperature"]) {
      expect(chaveBloqueada(k)).toBe(false);
    }
  });

  it("ignora chaves perigosas no JSON (__proto__, constructor) e valores não textuais", () => {
    const cfg = lerConfigOrigem('{"__proto__":{"admin":true},"constructor":"x","a-b":"1","ok":"1","n":2,"obj":{"x":1},"lista":["a",1]}', LIMITES_PADRAO);
    expect([...cfg.keys()].sort()).toEqual(["lista", "n", "ok"]);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it("recusa project_settings que não é JSON ou não é objeto", async () => {
    await esperarErro(projetoBambu({ substituir: { "Metadata/project_settings.config": "não é json" } }), "CONFIG_INVALIDA");
    await esperarErro(projetoBambu({ substituir: { "Metadata/project_settings.config": "[1,2,3]" } }), "CONFIG_INVALIDA");
  });

  it("recusa quantidade absurda de filamentos", async () => {
    const muitos = Array.from({ length: 65 }, () => ({ tipo: "PLA", cor: "#FFFFFF" }));
    await esperarErro(projetoBambu({ filamentos: muitos }), "CONFIG_INVALIDA");
  });
});
