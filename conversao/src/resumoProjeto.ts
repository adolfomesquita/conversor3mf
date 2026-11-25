// Leitura das informações principais do projeto (Metadata/project_settings.config), compartilhada
// entre a conversão e o resumo mostrado antes de converter. Sem imports: o site importa este arquivo
// diretamente, e resumo e conversão precisam concordar sobre bico, filamentos etc.
// O resumo é só uma prévia; quem decide é sempre a conversão.

export type ValorProjeto = string | readonly string[];
/** Lê uma chave do project_settings (já filtrado: só textos ou listas de textos). */
export type LerChave = (chave: string) => ValorProjeto | undefined;

/** Entradas de G-code (projeto fatiado .gcode.3mf), recusadas na conversão. */
export function eEntradaGcode(nome: string): boolean {
  return /\.gcode(\.md5)?$/i.test(nome) || /^Metadata\/plate_\d+\.gcode/i.test(nome);
}

function lista(v: ValorProjeto | undefined): readonly string[] {
  if (v === undefined) return [];
  return typeof v === "string" ? [v] : v;
}

function texto(v: ValorProjeto | undefined): string | null {
  if (v === undefined) return null;
  const t = typeof v === "string" ? v : (v[0] ?? null);
  return t === null || t.trim() === "" ? null : t.trim();
}

function numero(v: ValorProjeto | undefined): number | null {
  const t = texto(v);
  if (t === null) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** Diâmetro do bico do projeto (primeira extrusora), ou null se não informado/inválido. */
export function bicoDoProjeto(ler: LerChave): number | null {
  const b = numero(ler("nozzle_diameter"));
  return b !== null && b > 0 && b < 5 ? b : null;
}

/**
 * Quantidade de filamentos do projeto (0 se não informado). As cores são o que os objetos e a
 * pintura referenciam; as outras listas podem estar expandidas por variante de bico (Bambu 2.x).
 */
/** Bico usado para escolher o perfil de destino: o do projeto ou, se ausente, 0,4 mm. */
export function bicoAlvo(bico: number | null): number {
  return bico ?? 0.4;
}

export function mesmoBico(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** O destino com estes bicos (perfis de casamento automático) aceita o projeto? Mesma regra da conversão. */
export function destinoAceitaBico(bicos: readonly number[], bico: number | null): boolean {
  const alvo = bicoAlvo(bico);
  return bicos.some((b) => mesmoBico(b, alvo));
}

export function quantidadeFilamentos(ler: LerChave): number {
  return lista(ler("filament_colour")).length || lista(ler("filament_settings_id")).length || lista(ler("filament_type")).length;
}

export function alturaCamadaDoProjeto(ler: LerChave): number | null {
  const a = numero(ler("layer_height"));
  return a !== null && a > 0 && a < 5 ? a : null;
}

/** Modelo da impressora de origem ("Bambu Lab P1S"); se ausente, o nome do perfil da impressora. */
export function impressoraDoProjeto(ler: LerChave): string | null {
  const t = texto(ler("printer_model")) ?? texto(ler("printer_settings_id"));
  return t === null ? null : t.slice(0, 100);
}

const COR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

export interface FilamentoDoProjeto {
  /** "#RRGGBB" validado, ou null. */
  cor: string | null;
  tipo: string | null;
  nome: string | null;
}

/**
 * Filamentos na ordem do projeto. Tipo, nome e cor são lidos pela posição, como a conversão faz
 * (configProjeto.ts): essas listas têm um item por filamento (não são expandidas por variante).
 */
export function filamentosDoProjeto(ler: LerChave, max = 64): FilamentoDoProjeto[] {
  const n = Math.min(quantidadeFilamentos(ler), max);
  const cores = lista(ler("filament_colour"));
  const tipos = lista(ler("filament_type"));
  const nomes = lista(ler("filament_settings_id"));
  const out: FilamentoDoProjeto[] = [];
  for (let i = 0; i < n; i++) {
    const cor = cores[i];
    out.push({
      cor: cor && COR.test(cor) ? cor.slice(0, 7).toUpperCase() : null,
      tipo: texto(tipos[i])?.slice(0, 30) ?? null,
      nome: texto(nomes[i])?.slice(0, 80) ?? null,
    });
  }
  return out;
}
