// Fixtures sintéticas: um "ZIP cru" (permite nomes, flags, atributos e tamanhos declarados
// arbitrários, para montar arquivos maliciosos) e um projeto Bambu Studio mínimo e realista.
// Nenhum arquivo real de usuário é usado nos testes.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import yauzl from "yauzl";

export interface EntradaBruta {
  nome: string;
  dados: Buffer | string;
  comprimir?: boolean;
  /** Sobrescreve o tamanho descompactado declarado (para simular cabeçalho mentiroso). */
  tamanhoDeclarado?: number;
  flags?: number;
  /** Atributos externos (bits altos = modo Unix, ex.: link simbólico). */
  atributosExternos?: number;
}

export function montarZip(entradas: EntradaBruta[]): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const e of entradas) {
    const dados = Buffer.isBuffer(e.dados) ? e.dados : Buffer.from(e.dados, "utf8");
    const nome = Buffer.from(e.nome, "utf8");
    const comprimir = e.comprimir ?? true;
    const corpo = comprimir ? deflateRawSync(dados) : dados;
    const crc = crc32(dados);
    const tamanho = e.tamanhoDeclarado ?? dados.length;
    const flags = (e.flags ?? 0) | 0x0800;
    const metodo = comprimir ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x5b21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(tamanho, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, corpo);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x5b21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(corpo.length, 20);
    central.writeUInt32LE(tamanho, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE((e.atributosExternos ?? 0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrais.push(central, nome);

    offset += 30 + nome.length + corpo.length;
  }
  const dc = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(dc.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, dc, fim]);
}

// Pasta temporária por teste ----------------------------------------------------------------------

export function pastaTemporaria(): { caminho: (nome: string) => string; limpar: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "conv3mf-"));
  return { caminho: (n) => join(dir, n), limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

export function gravar(caminho: string, conteudo: Buffer): string {
  writeFileSync(caminho, conteudo);
  return caminho;
}

export async function lerZip(caminho: string): Promise<Map<string, Buffer>> {
  const zip = await new Promise<yauzl.ZipFile>((res, rej) =>
    yauzl.open(caminho, { lazyEntries: true }, (e, z) => (e || !z ? rej(e) : res(z))),
  );
  const out = new Map<string, Buffer>();
  await new Promise<void>((res, rej) => {
    zip.on("entry", (e: yauzl.Entry) => {
      zip.openReadStream(e, (err, s) => {
        if (err || !s) return rej(err);
        const partes: Buffer[] = [];
        s.on("data", (c: Buffer) => partes.push(c));
        s.on("end", () => {
          out.set(e.fileName, Buffer.concat(partes));
          zip.readEntry();
        });
        s.on("error", rej);
      });
    });
    zip.on("end", () => res());
    zip.on("error", rej);
    zip.readEntry();
  });
  return out;
}

// Projeto Bambu sintético ----------------------------------------------------------------------------

export interface FilamentoFixture {
  tipo: string;
  cor: string;
  nome?: string;
}

export interface ObjetoFixture {
  /** Dimensões do cubo (mm). */
  tamanho: [number, number, number];
  /** Placa (1-based). */
  placa: number;
  /** Canto mínimo do objeto em coordenadas relativas à placa (mm). */
  posicao: [number, number];
  extrusor?: number;
}

export interface OpcoesProjeto {
  filamentos?: FilamentoFixture[];
  alturaCamada?: string;
  bico?: string;
  mesa?: [number, number];
  objetos?: ObjetoFixture[];
  /** different_settings_to_system: [processo, ...filamentos, impressora]; null = ausente. */
  diferencas?: string[] | null;
  configExtra?: Record<string, unknown>;
  entradasExtras?: EntradaBruta[];
  modelSettingsExtra?: string;
  /** Substitui o conteúdo de entradas pelo nome. */
  substituir?: Record<string, string | Buffer>;
  omitir?: string[];
}

const NS = `xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"`;

function cubo(id: number, [x, y, z]: [number, number, number]): string {
  const v = [
    [0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0],
    [0, 0, z], [x, 0, z], [x, y, z], [0, y, z],
  ];
  const t = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  // Centralizado na origem local, como o Bambu grava (a translação fica no item de montagem).
  const vert = v.map(([a, b, c]) => `<vertex x="${a! - x / 2}" y="${b! - y / 2}" z="${c! - z / 2}"/>`).join("");
  const tri = t.map(([a, b, c], i) => `<triangle v1="${a}" v2="${b}" v3="${c}"${i === 0 ? ' paint_color="4"' : ""}/>`).join("");
  return `<object id="${id}" p:UUID="00000000-0000-0000-0000-00000000000${id}" type="model"><mesh><vertices>${vert}</vertices><triangles>${tri}</triangles></mesh></object>`;
}

/** Origem (canto) da placa no espaço do Bambu: grade com colunas = ceil(sqrt(n)), espaço de 1/5. */
export function origemPlacaBambu(placa1: number, nPlacas: number, [w, d]: [number, number]): [number, number] {
  const col = Math.ceil(Math.sqrt(nPlacas));
  const i = placa1 - 1;
  return [(i % col) * w * 1.2, -Math.floor(i / col) * d * 1.2];
}

export function projetoBambu(op: OpcoesProjeto = {}): EntradaBruta[] {
  const filamentos = op.filamentos ?? [
    { tipo: "PLA", cor: "#FFFFFF", nome: "Bambu PLA Basic @BBL X1C" },
    { tipo: "PLA", cor: "#161616", nome: "Bambu PLA Basic @BBL X1C" },
  ];
  const mesa = op.mesa ?? [256, 256];
  const objetos = op.objetos ?? [{ tamanho: [20, 20, 10], placa: 1, posicao: [100, 100] }];
  const nPlacas = Math.max(...objetos.map((o) => o.placa));

  const objetosXml: string[] = [];
  const itensXml: string[] = [];
  const malhas: EntradaBruta[] = [];
  objetos.forEach((o, i) => {
    const malhaId = 1;
    const objId = 2 * (i + 1);
    const caminho = `3D/Objects/object_${i + 1}.model`;
    malhas.push({ nome: caminho, dados: `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ${NS} requiredextensions="p"><resources>${cubo(malhaId, o.tamanho)}</resources><build/></model>` });
    objetosXml.push(
      `<object id="${objId}" p:UUID="00000000-0000-0000-0000-0000000001${String(i).padStart(2, "0")}" type="model"><components><component p:path="/${caminho}" objectid="${malhaId}" p:UUID="00000000-0000-0000-0000-0000000002${String(i).padStart(2, "0")}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>`,
    );
    const [ox, oy] = origemPlacaBambu(o.placa, nPlacas, mesa);
    const tx = ox + o.posicao[0] + o.tamanho[0] / 2;
    const ty = oy + o.posicao[1] + o.tamanho[1] / 2;
    const tz = o.tamanho[2] / 2;
    itensXml.push(`<item objectid="${objId}" p:UUID="00000000-0000-0000-0000-0000000003${String(i).padStart(2, "0")}" transform="1 0 0 0 1 0 0 0 1 ${tx} ${ty} ${tz}" printable="1"/>`);
  });

  const modelo = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS} requiredextensions="p">
 <metadata name="Application">BambuStudio-02.08.02.61</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
  ${objetosXml.join("\n  ")}
 </resources>
 <build p:UUID="00000000-0000-0000-0000-000000000999">
  ${itensXml.join("\n  ")}
 </build>
</model>
`;

  const placasXml = Array.from({ length: nPlacas }, (_, p) => {
    const inst = objetos
      .map((o, i) => (o.placa === p + 1 ? `    <model_instance>\n      <metadata key="object_id" value="${2 * (i + 1)}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${100 + i}"/>\n    </model_instance>` : ""))
      .filter(Boolean)
      .join("\n");
    return `  <plate>
    <metadata key="plater_id" value="${p + 1}"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <metadata key="filament_map_mode" value="Manual"/>
    <metadata key="filament_maps" value="${filamentos.map((_, i) => (i % 2) + 1).join(" ")}"/>
    <metadata key="filament_volume_maps" value="${filamentos.map(() => 0).join(" ")}"/>
    <metadata key="gcode_file" value=""/>
    <metadata key="thumbnail_file" value="Metadata/plate_${p + 1}.png"/>
${inst}
  </plate>`;
  }).join("\n");

  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objetos
  .map(
    (o, i) => `  <object id="${2 * (i + 1)}">
    <metadata key="name" value="Cubo ${i + 1}"/>
    <metadata key="extruder" value="${o.extrusor ?? 1}"/>
    <metadata key="wall_loops" value="3"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="Cubo ${i + 1}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
    </part>
  </object>`,
  )
  .join("\n")}
${placasXml}
${op.modelSettingsExtra ?? ""}
</config>
`;

  const config: Record<string, unknown> = {
    name: "project_settings",
    from: "project",
    version: "02.08.02.61",
    printer_settings_id: "Bambu Lab X1 Carbon 0.4 nozzle",
    print_settings_id: "0.20mm Standard @BBL X1C",
    filament_settings_id: filamentos.map((f) => f.nome ?? `Generic ${f.tipo} @BBL X1C`),
    filament_type: filamentos.map((f) => f.tipo),
    filament_colour: filamentos.map((f) => f.cor),
    nozzle_diameter: [op.bico ?? "0.4"],
    layer_height: op.alturaCamada ?? "0.2",
    printable_area: ["0x0", `${mesa[0]}x0`, `${mesa[0]}x${mesa[1]}`, `0x${mesa[1]}`],
    printable_height: "250",
    curr_bed_type: "Textured PEI Plate",
    sparse_infill_density: "25%",
    enable_support: "1",
    brim_type: "no_brim",
    outer_wall_speed: "300",
    wall_loops: "2",
    nozzle_temperature: filamentos.map(() => "225"),
    filament_flow_ratio: filamentos.map(() => "0.98"),
    pressure_advance: filamentos.map(() => "0.02"),
    machine_start_gcode: "G28 ; Bambu",
    filament_map: filamentos.map((_, i) => String((i % 2) + 1)),
    filament_map_mode: "Manual",
    physical_extruder_map: ["0", "1"],
    post_process: [],
    z_offset: "0.1",
    ...op.configExtra,
  };
  if (op.diferencas !== null) {
    config.different_settings_to_system = op.diferencas ?? [
      "enable_support;sparse_infill_density;brim_type;outer_wall_speed",
      ...filamentos.map((_, i) => (i === 0 ? "nozzle_temperature;filament_flow_ratio;pressure_advance" : "")),
      "z_offset",
    ];
  }

  let entradas: EntradaBruta[] = [
    {
      nome: "[Content_Types].xml",
      dados: `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/></Types>`,
    },
    {
      nome: "_rels/.rels",
      dados: `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
    },
    { nome: "3D/3dmodel.model", dados: modelo },
    {
      nome: "3D/_rels/3dmodel.model.rels",
      dados: `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${objetos.map((_, i) => `<Relationship Target="/3D/Objects/object_${i + 1}.model" Id="rel-${i + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`).join("")}</Relationships>`,
    },
    ...malhas,
    { nome: "Metadata/model_settings.config", dados: settings },
    { nome: "Metadata/project_settings.config", dados: JSON.stringify(config, null, 4) },
    { nome: "Metadata/slice_info.config", dados: `<?xml version="1.0" encoding="UTF-8"?>\n<config><header><header_item key="X-BBL-Client-Type" value="slicer"/></header></config>` },
    { nome: "Metadata/filament_settings_1.config", dados: `{"name":"Meu PLA","inherits":"Bambu PLA Basic @BBL X1C"}` },
    { nome: "Metadata/filament_sequence.json", dados: `{"plate_1":{"sequence":[]}}` },
    { nome: "Metadata/plate_1.png", dados: Buffer.from("89504e470d0a1a0a", "hex"), comprimir: false },
    ...(op.entradasExtras ?? []),
  ];
  if (op.omitir) entradas = entradas.filter((e) => !op.omitir!.includes(e.nome));
  if (op.substituir) {
    entradas = entradas.map((e) => (op.substituir![e.nome] !== undefined ? { ...e, dados: op.substituir![e.nome]! } : e));
  }
  return entradas;
}
