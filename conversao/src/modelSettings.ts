// Metadata/model_settings.config (XML do Bambu Studio): objetos, peças, modificadores, placas.
// É mantido quase intacto. Edições (só em tags <metadata .../>):
// - placas: mapeamento de filamentos normalizado ("1 1 ... 1", modo automático: "Auto For Flush" ou o nome do destino),
//   filament_volume_maps removido (específico dos bicos do Bambu H2D) e gcode_file esvaziado
//   (referência a um fatiamento anterior; o G-code em si nunca é aceito);
// - qualquer metadado executável/de host (G-code, post_process, print_host...) é removido;
// - configurações por objeto/peça com valor de lista fixa que o destino não aceita são traduzidas
//   ou removidas (o objeto passa a usar a configuração global).
import { chaveBloqueada, normalizarValorEnum } from "./configProjeto.js";
import type { PerfilAlvo } from "./perfis.js";
import { ErroConversao } from "./erros.js";
import { analisarXmlTexto } from "./xmlSeguro.js";

export interface InstanciaPlaca {
  objeto: string;
  instancia: number;
}

export interface PlacaInfo {
  id: number;
  instancias: InstanciaPlaca[];
}

export interface InfoModelSettings {
  placas: PlacaInfo[];
  objetos: number;
  maiorExtrusor: number;
  /** Valores não vazios de gcode_file nas placas (podem apontar para G-code ausente no pacote). */
  referenciasGcode: string[];
  metadadosBloqueados: string[];
}

export function analisarModelSettings(texto: string, maxProfundidade: number): InfoModelSettings {
  const placas: PlacaInfo[] = [];
  let placa: PlacaInfo | null = null;
  let instancia: { objeto?: string; instancia?: number } | null = null;
  let objetos = 0;
  let maiorExtrusor = 0;
  const referenciasGcode: string[] = [];
  const bloqueados: string[] = [];
  let raizOk = false;

  analisarXmlTexto(
    texto,
    {
      abrir(tag, prof) {
        if (prof === 1) {
          if (tag.local !== "config") throw new ErroConversao("ESTRUTURA_INESPERADA");
          raizOk = true;
          return;
        }
        if (tag.local === "object" && prof === 2) objetos++;
        else if (tag.local === "plate" && prof === 2) placa = { id: 0, instancias: [] };
        else if (tag.local === "model_instance" && placa) instancia = {};
        else if (tag.local === "metadata") {
          const chave = tag.atributos.get("key")?.valor ?? "";
          const valor = tag.atributos.get("value")?.valor ?? "";
          if (chaveBloqueada(chave)) bloqueados.push(chave);
          if (chave === "extruder") {
            const e = Number.parseInt(valor, 10);
            if (Number.isInteger(e) && e > maiorExtrusor) maiorExtrusor = e;
          }
          const p = placa as PlacaInfo | null;
          if (p && !instancia) {
            if (chave === "plater_id") p.id = Number.parseInt(valor, 10);
            if (chave === "gcode_file" && valor.trim() !== "") referenciasGcode.push(valor.trim());
          }
          if (instancia) {
            if (chave === "object_id") instancia.objeto = valor;
            if (chave === "instance_id") instancia.instancia = Number.parseInt(valor, 10);
          }
        }
      },
      fechar(local) {
        if (local === "model_instance" && placa && instancia) {
          if (instancia.objeto !== undefined) {
            (placa as PlacaInfo).instancias.push({ objeto: instancia.objeto, instancia: instancia.instancia ?? 0 });
          }
          instancia = null;
        } else if (local === "plate" && placa) {
          placas.push(placa);
          placa = null;
        }
      },
    },
    maxProfundidade,
  );
  if (!raizOk) throw new ErroConversao("ESTRUTURA_INESPERADA");
  placas.sort((a, b) => a.id - b.id);
  return { placas, objetos, maiorExtrusor, referenciasGcode, metadadosBloqueados: bloqueados };
}

function escaparAtributo(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export interface AjusteObjeto {
  chave: string;
  de: string;
  /** null = configuração removida do objeto (passa a valer a global). */
  para: string | null;
}

function desescaparAtributo(v: string): string {
  return v.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/**
 * Reescreve os metadados de placa, remove os bloqueados e confere os valores de lista fixa das
 * configurações por objeto/peça contra o destino, preservando o restante do texto.
 */
export function reescreverModelSettings(
  texto: string,
  nFilamentos: number,
  perfil?: PerfilAlvo,
): { texto: string; ajustes: AjusteObjeto[] } {
  let dentroPlaca = false;
  let profInstancia = 0;
  const ajustes: AjusteObjeto[] = [];
  const mapa = Array.from({ length: nFilamentos }, () => "1").join(" ");
  const saida = texto.replace(/<plate\s*>|<\/plate\s*>|<model_instance\s*>|<\/model_instance\s*>|<metadata\b[^>]*>/g, (tag) => {
    if (/^<plate/.test(tag)) {
      dentroPlaca = true;
      return tag;
    }
    if (/^<\/plate/.test(tag)) {
      dentroPlaca = false;
      return tag;
    }
    if (/^<model_instance/.test(tag)) {
      profInstancia++;
      return tag;
    }
    if (/^<\/model_instance/.test(tag)) {
      profInstancia--;
      return tag;
    }
    if (!tag.endsWith("/>")) throw new ErroConversao("ESTRUTURA_INESPERADA");
    const chave = /\skey\s*=\s*"([^"]*)"/.exec(tag)?.[1] ?? "";
    if (chaveBloqueada(chave)) return "";
    if (!dentroPlaca && perfil) {
      const bruto = /\svalue\s*=\s*"([^"]*)"/.exec(tag)?.[1];
      if (bruto !== undefined) {
        const valor = desescaparAtributo(bruto);
        const r = normalizarValorEnum(perfil, chave, valor);
        if (r.situacao === "rejeitado") {
          ajustes.push({ chave, de: valor, para: null });
          return "";
        }
        if (r.situacao === "traduzido") {
          ajustes.push({ chave, de: valor, para: r.valor });
          return tag.replace(/(\svalue\s*=\s*")[^"]*(")/, `$1${escaparAtributo(r.valor)}$2`);
        }
      }
    }
    if (!dentroPlaca || profInstancia > 0) return tag;
    if (chave === "filament_volume_maps") return "";
    if (chave === "gcode_file") return `<metadata key="gcode_file" value=""/>`;
    if (chave === "filament_maps") return `<metadata key="filament_maps" value="${escaparAtributo(mapa)}"/>`;
    if (chave === "filament_map_mode") {
      // Mesmo modo do projeto, com o nome que o destino usa (Creality Print: "AutoForSaving").
      const modo = perfil ? (normalizarValorEnum(perfil, chave, "Auto For Flush").valor ?? "Auto For Flush") : "Auto For Flush";
      return `<metadata key="filament_map_mode" value="${escaparAtributo(modo)}"/>`;
    }
    return tag;
  });
  return { texto: saida, ajustes };
}
