// Identificação do slicer que gerou o projeto. Os arquivos vêm dos usuários, de qualquer slicer.
//
// Assinaturas observadas em 230 projetos reais (docs/inspecao-3mf-e-perfis.md, seção 7):
// - Bambu Studio:          Application "BambuStudio-02.08.02.61" (versão com 2 dígitos por parte).
// - Anycubic Slicer Next:  também grava "BambuStudio-<versão>", mas com a versão própria sem zeros
//                          à esquerda ("2.0.0.3", "1.3.9.2", "1.3.0").
// - OrcaSlicer e derivados (Orca-Flashforge...): Application "BambuStudio-..." + metadado "OrcaSlicer".
// - Creality Print:        Application "Creality_Print V7..." e Metadata/creality.config.
// - Snapmaker Orca:        Application "Snapmaker_Orca-2.4.1" (fork do OrcaSlicer; bbs_3mf.cpp).
// - PrusaSlicer/SuperSlicer, Cura: formatos de projeto diferentes (não suportados).
// Os da família Bambu Studio/Orca compartilham o formato de projeto (project_settings.config) e são
// convertidos; os outros são recusados com mensagem clara.

export type SlicerOrigem =
  | "Bambu Studio"
  | "Anycubic Slicer Next"
  | "OrcaSlicer"
  | "Creality Print"
  | "Snapmaker Orca"
  | "PrusaSlicer"
  | "Cura"
  | "Sem slicer"
  | "Desconhecido";

export interface Origem {
  slicer: SlicerOrigem;
  versao: string | null;
  /** Formato de projeto da família Bambu Studio/Orca (convertível). */
  suportado: boolean;
}

const SUPORTADOS = new Set<SlicerOrigem>(["Bambu Studio", "Anycubic Slicer Next", "OrcaSlicer", "Creality Print", "Snapmaker Orca"]);

/** Slicer da família Bambu Studio/Orca (projeto convertível, se tiver as configurações). */
export function familiaConvertivel(slicer: SlicerOrigem): boolean {
  return SUPORTADOS.has(slicer);
}

function decodificarXml(v: string): string {
  return v
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Metadados <metadata name="...">valor</metadata> do início do 3dmodel.model (já validado como XML). */
export function lerMetadadosCabecalho(inicio: string): Map<string, string> {
  const out = new Map<string, string>();
  // Só o trecho antes de <resources>, onde ficam os metadados do modelo.
  const corte = inicio.search(/<resources\b/);
  const cabecalho = corte >= 0 ? inicio.slice(0, corte) : inicio;
  for (const m of cabecalho.matchAll(/<metadata\s+name\s*=\s*"([^"]{1,100})"\s*>([^<]{0,500})<\/metadata>/g)) {
    if (!out.has(m[1]!)) out.set(m[1]!, decodificarXml(m[2]!));
  }
  return out;
}

export function identificarOrigem(entradas: readonly string[], metadados: ReadonlyMap<string, string>, temProjeto: boolean): Origem {
  const nomes = new Set(entradas.map((e) => e.toLowerCase()));
  const app = metadados.get("Application") ?? "";
  const resultado = (slicer: SlicerOrigem, versao: string | null): Origem => ({
    slicer,
    versao: versao && versao.length > 0 ? versao.slice(0, 40) : null,
    suportado: SUPORTADOS.has(slicer) && temProjeto,
  });

  if (/^creality/i.test(app) || nomes.has("metadata/creality.config")) {
    return resultado("Creality Print", /V?(\d+(?:\.\d+)+)/.exec(app)?.[1] ?? null);
  }
  if (/prusaslicer|superslicer|slic3r/i.test(app) || nomes.has("metadata/slic3r_pe.config") || nomes.has("metadata/prusaslicer.config")) {
    return resultado("PrusaSlicer", /(\d+(?:\.\d+)+)/.exec(app)?.[1] ?? null);
  }
  if (/cura/i.test(app) || [...nomes].some((n) => n.startsWith("cura/"))) {
    return resultado("Cura", /(\d+(?:\.\d+)+)/.exec(app)?.[1] ?? null);
  }
  const snapmaker = /^Snapmaker_Orca-(\S+)/.exec(app);
  if (snapmaker) return resultado("Snapmaker Orca", snapmaker[1]!);
  const orca = metadados.get("OrcaSlicer");
  if (orca !== undefined) return resultado("OrcaSlicer", orca);
  const bambu = /^BambuStudio-(\S+)/.exec(app);
  if (bambu) {
    const v = bambu[1]!;
    if (/^\d{2}\.\d{2}\.\d{2}\.\d{2}$/.test(v)) return resultado("Bambu Studio", v);
    if (/^\d{1,2}(\.\d+){1,3}$/.test(v)) return resultado("Anycubic Slicer Next", v);
    return resultado("Desconhecido", v);
  }
  if (!temProjeto && app === "") return resultado("Sem slicer", null);
  return resultado(temProjeto ? "Desconhecido" : "Sem slicer", app || null);
}

export function mensagemOrigemNaoSuportada(o: Origem): string {
  switch (o.slicer) {
    case "PrusaSlicer":
      return "Projetos do PrusaSlicer/SuperSlicer usam outro formato e ainda não são suportados. Envie um projeto do Bambu Studio, OrcaSlicer ou derivados.";
    case "Cura":
      return "Projetos do Cura usam outro formato e ainda não são suportados. Envie um projeto do Bambu Studio, OrcaSlicer ou derivados.";
    case "Sem slicer":
      return "Este .3mf só tem geometria, sem configurações de slicer. Abra-o direto no slicer da sua impressora.";
    default:
      return "Não foi possível identificar o slicer de origem deste projeto. São suportados projetos do Bambu Studio, OrcaSlicer e derivados (Anycubic Slicer Next, Orca-Flashforge, Creality Print, Snapmaker Orca).";
  }
}
