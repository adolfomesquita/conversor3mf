// 3D/3dmodel.model: estrutura (objetos, componentes, itens de montagem) e ajuste de posição.
// A geometria em si nunca é reescrita; só a translação dos itens de <build>, quando o tamanho da
// mesa muda, para manter cada objeto na mesma posição relativa dentro da sua placa.
import { ErroConversao } from "./erros.js";
import { StringDecoder } from "node:string_decoder";
import { Transform } from "node:stream";
import type { ManipuladoresXml } from "./xmlSeguro.js";

export const NS_CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
export const NS_PRODUCAO = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06";
export const CAMINHO_MODELO = "3D/3dmodel.model";

/** Matriz 3MF 4x3 em ordem de linha: m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32. */
export type Matriz = readonly number[];
export const IDENTIDADE: Matriz = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export function lerMatriz(texto: string | undefined): Matriz | null {
  if (texto === undefined) return IDENTIDADE;
  const v = texto.trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(Number.isFinite) ? v : null;
}

/** Aplica `a` e depois `b` (p * A * B). */
export function compor(a: Matriz, b: Matriz): Matriz {
  const r: number[] = new Array<number>(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    }
  }
  for (let j = 0; j < 3; j++) {
    r[9 + j] = a[9]! * b[j]! + a[10]! * b[3 + j]! + a[11]! * b[6 + j]! + b[9 + j]!;
  }
  return r;
}

export interface Componente {
  caminho: string | null;
  objeto: string;
  matriz: Matriz;
}

export interface ObjetoModelo {
  temMalha: boolean;
  componentes: Componente[];
}

export interface ItemMontagem {
  objeto: string;
  matriz: Matriz;
}

export interface EstruturaModelo {
  objetos: Map<string, ObjetoModelo>;
  itens: ItemMontagem[];
}

function normalizarCaminho(p: string): string {
  return p.replace(/^\/+/, "");
}

/**
 * Leitor da estrutura do 3dmodel.model em streaming, sem processar namespaces (o arquivo pode ter
 * centenas de MB de malha embutida). Os prefixos são resolvidos a partir das declarações da raiz:
 * o namespace padrão tem de ser o núcleo 3MF, e o prefixo da extensão Production é descoberto ali.
 * Redeclarações de namespace em elementos estruturais são recusadas (o significado mudaria).
 */
export function leitorEstrutura(): { manipuladores: ManipuladoresXml; resultado(): EstruturaModelo } {
  const objetos = new Map<string, ObjetoModelo>();
  const itens: ItemMontagem[] = [];
  let atual: ObjetoModelo | null = null;
  let dentroBuild = false;
  let raizOk = false;
  let atributoCaminho = "p:path";
  const ESTRUTURAIS = new Set(["resources", "object", "components", "component", "build", "item", "mesh"]);

  const manipuladores: ManipuladoresXml = {
    abrir(tag, prof) {
      if (prof === 1) {
        if (tag.local !== "model" || tag.atributo("xmlns") !== NS_CORE) throw new ErroConversao("ESTRUTURA_INESPERADA");
        for (const [k, a] of tag.atributos) {
          if (k.startsWith("xmlns:") && a.valor === NS_PRODUCAO) atributoCaminho = `${k.slice(6)}:path`;
        }
        raizOk = true;
        return;
      }
      if (!ESTRUTURAIS.has(tag.local)) return;
      for (const k of tag.atributos.keys()) {
        if (k === "xmlns" || k.startsWith("xmlns:")) throw new ErroConversao("ESTRUTURA_INESPERADA");
      }
      if (tag.local === "object") {
        const id = tag.atributo("id");
        if (!id || objetos.has(id)) throw new ErroConversao("ESTRUTURA_INESPERADA");
        atual = { temMalha: false, componentes: [] };
        objetos.set(id, atual);
      } else if (tag.local === "mesh" && atual) {
        atual.temMalha = true;
      } else if (tag.local === "component" && atual) {
        const obj = tag.atributo("objectid");
        const matriz = lerMatriz(tag.atributo("transform"));
        if (!obj || !matriz) throw new ErroConversao("ESTRUTURA_INESPERADA");
        const caminho = tag.atributo(atributoCaminho);
        atual.componentes.push({ caminho: caminho ? normalizarCaminho(caminho) : null, objeto: obj, matriz });
      } else if (tag.local === "build") {
        dentroBuild = true;
      } else if (tag.local === "item" && dentroBuild) {
        const obj = tag.atributo("objectid");
        const matriz = lerMatriz(tag.atributo("transform"));
        if (!obj || !matriz) throw new ErroConversao("ESTRUTURA_INESPERADA");
        itens.push({ objeto: obj, matriz });
      }
    },
    fechar(local) {
      if (local === "object") atual = null;
      if (local === "build") dentroBuild = false;
    },
  };
  return {
    manipuladores,
    resultado() {
      if (!raizOk) throw new ErroConversao("ESTRUTURA_INESPERADA");
      return { objetos, itens };
    },
  };
}

// Referências: para cada (arquivo, objeto com malha), os itens de montagem que o usam e a matriz final.
export interface RefMalha {
  item: number;
  matriz: Matriz;
}
export type MapaReferencias = Map<string, Map<string, RefMalha[]>>;

export function resolverReferencias(est: EstruturaModelo): { refs: MapaReferencias; incompletos: Set<number> } {
  const refs: MapaReferencias = new Map();
  const incompletos = new Set<number>();
  const adicionar = (caminho: string, objeto: string, ref: RefMalha) => {
    let porObj = refs.get(caminho);
    if (!porObj) refs.set(caminho, (porObj = new Map()));
    let lista = porObj.get(objeto);
    if (!lista) porObj.set(objeto, (lista = []));
    lista.push(ref);
  };
  const expandir = (item: number, objeto: string, matriz: Matriz, prof: number) => {
    const o = est.objetos.get(objeto);
    if (!o || prof > 16) {
      incompletos.add(item);
      return;
    }
    if (o.temMalha) adicionar(CAMINHO_MODELO, objeto, { item, matriz });
    for (const c of o.componentes) {
      const m = compor(c.matriz, matriz);
      if (c.caminho === null || c.caminho === CAMINHO_MODELO) expandir(item, c.objeto, m, prof + 1);
      else adicionar(c.caminho, c.objeto, { item, matriz: m });
    }
  };
  est.itens.forEach((it, i) => expandir(i, it.objeto, it.matriz, 0));
  return { refs, incompletos };
}

// Caixas envolventes por item, alimentadas pelos vértices das malhas -------------------------------

export interface Caixa {
  min: [number, number, number];
  max: [number, number, number];
}

export class AcumuladorGeometria {
  readonly caixas: Array<Caixa | null>;
  constructor(nItens: number, private readonly refs: MapaReferencias) {
    this.caixas = Array.from({ length: nItens }, () => null);
  }

  /** Manipuladores XML para um arquivo de malha (3D/3dmodel.model ou 3D/Objects/*.model). */
  manipuladores(caminho: string): ManipuladoresXml {
    const porObj = this.refs.get(caminho);
    let atuais: RefMalha[] | undefined;
    const caixas = this.caixas;
    return {
      abrir(tag) {
        // Com namespaces: só o núcleo 3MF. Sem namespaces (malhas grandes): só elementos sem prefixo.
        if (tag.uri !== NS_CORE && tag.uri !== "") return;
        if (tag.local === "object") {
          atuais = porObj?.get(tag.atributo("id") ?? "");
        } else if (tag.local === "vertex" && atuais) {
          const x = Number(tag.atributo("x"));
          const y = Number(tag.atributo("y"));
          const z = Number(tag.atributo("z"));
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new ErroConversao("XML_INVALIDO");
          for (const r of atuais) {
            const m = r.matriz;
            const px = x * m[0]! + y * m[3]! + z * m[6]! + m[9]!;
            const py = x * m[1]! + y * m[4]! + z * m[7]! + m[10]!;
            const pz = x * m[2]! + y * m[5]! + z * m[8]! + m[11]!;
            const c = caixas[r.item];
            if (!c) caixas[r.item] = { min: [px, py, pz], max: [px, py, pz] };
            else {
              if (px < c.min[0]) c.min[0] = px;
              if (px > c.max[0]) c.max[0] = px;
              if (py < c.min[1]) c.min[1] = py;
              if (py > c.max[1]) c.max[1] = py;
              if (pz < c.min[2]) c.min[2] = pz;
              if (pz > c.max[2]) c.max[2] = pz;
            }
          }
        }
      },
      fechar(local) {
        if (local === "object") atuais = undefined;
      },
    };
  }
}

// Grade de placas do Bambu Studio: placas em colunas = ceil(sqrt(n)), espaçamento de 1/5 da mesa.
// Conferido empiricamente em projetos reais (mesas 256x256 e 330x320, até 30 placas).
export const ESPACO_ENTRE_PLACAS = 1 / 5;

export function origemPlaca(indice: number, nPlacas: number, larguraMesa: number, profundidadeMesa: number): [number, number] {
  const colunas = Math.max(1, Math.ceil(Math.sqrt(nPlacas)));
  const col = indice % colunas;
  const lin = Math.floor(indice / colunas);
  return [col * larguraMesa * (1 + ESPACO_ENTRE_PLACAS), -lin * profundidadeMesa * (1 + ESPACO_ENTRE_PLACAS)];
}

function formatarNumero(n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Ajusta a translação (m30, m31) de uma tag <item ...>, preservando o resto da tag. */
function deslocarTag(tag: string, dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return tag;
  const re = /(\stransform\s*=\s*)(["'])([^"']*)\2/;
  const m = re.exec(tag);
  if (!m) {
    const fim = tag.endsWith("/>") ? tag.length - 2 : tag.length - 1;
    return `${tag.slice(0, fim)} transform="1 0 0 0 1 0 0 0 1 ${formatarNumero(dx)} ${formatarNumero(dy)} 0"${tag.slice(fim)}`;
  }
  const partes = m[3]!.trim().split(/\s+/);
  if (partes.length !== 12) throw new ErroConversao("ESTRUTURA_INESPERADA");
  partes[9] = formatarNumero(Number(partes[9]) + dx);
  partes[10] = formatarNumero(Number(partes[10]) + dy);
  return tag.replace(re, `${m[1]}${m[2]}${partes.join(" ")}${m[2]}`);
}

/**
 * Transform em streaming que soma (dx, dy) à translação de cada <item> dentro de <build>, na ordem.
 * Só o atributo `transform` dessas tags muda; o resto do arquivo passa byte a byte (como texto UTF-8).
 * Tags nunca contêm "<" em atributos (é escapado), então o texto é processado até o último "<"
 * de cada trecho e o restante fica para o próximo.
 */
export function criarDeslocadorItens(deltas: Array<[number, number]>): Transform {
  return criarReescritorModelo({ deltas, aplicacao: null });
}

function escaparXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Reescreve o 3dmodel.model em streaming:
 * - deltas: desloca a transformação de cada <item> do <build> (null = não mexe nos itens);
 * - aplicacao: troca o <metadata name="Application"> do cabeçalho (antes de <resources>), ou o
 *   insere se não existir, para o slicer de destino reconhecer o projeto como seu.
 */
export function criarReescritorModelo(opcoes: { deltas: Array<[number, number]> | null; aplicacao: string | null }): Transform {
  const { deltas, aplicacao } = opcoes;
  const decodificador = new StringDecoder("utf8");
  let resto = "";
  let dentroBuild = false;
  let noCabecalho = aplicacao !== null;
  let i = 0;
  // Atributos entre aspas podem conter ">"; por isso a tag é lida respeitando as aspas.
  const RE = /<build\b(?:[^>"']|"[^"]*"|'[^']*')*>|<\/build\s*>|<item\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  // O texto do metadado não tem "<"; como cada trecho é cortado antes do último "<", o elemento
  // aberto num trecho chega inteiro até o "<" do fechamento.
  const RE_CABECALHO = /(<metadata\s+name\s*=\s*"Application"\s*>)[^<]*|<resources\b/g;
  const reescreverCabecalho = (texto: string): string =>
    texto.replace(RE_CABECALHO, (trecho, abertura: string | undefined) => {
      if (!noCabecalho) return trecho;
      if (abertura) {
        noCabecalho = false;
        return `${abertura}${escaparXml(aplicacao!)}`;
      }
      // Chegou aos recursos sem Application: insere antes deles.
      noCabecalho = false;
      return `<metadata name="Application">${escaparXml(aplicacao!)}</metadata>\n ${trecho}`;
    });
  const processar = (texto: string): string => {
    const t = noCabecalho ? reescreverCabecalho(texto) : texto;
    if (deltas === null) return t;
    return t.replace(RE, (tag) => {
      if (tag.startsWith("<build")) {
        dentroBuild = true;
        return tag;
      }
      if (tag.startsWith("</build")) {
        dentroBuild = false;
        return tag;
      }
      if (!dentroBuild) return tag;
      const d = deltas[i++];
      if (!d) throw new ErroConversao("ESTRUTURA_INESPERADA");
      return deslocarTag(tag, d[0], d[1]);
    });
  };
  return new Transform({
    transform(trecho: Buffer, _enc, cb) {
      try {
        const texto = resto + decodificador.write(trecho);
        const corte = texto.lastIndexOf("<");
        const pronto = corte < 0 ? texto : texto.slice(0, corte);
        resto = corte < 0 ? "" : texto.slice(corte);
        cb(null, pronto.length > 0 ? Buffer.from(processar(pronto), "utf8") : undefined);
      } catch (e) {
        cb(e as Error);
      }
    },
    flush(cb) {
      try {
        const final = processar(resto + decodificador.end());
        if (deltas !== null && i !== deltas.length) throw new ErroConversao("ESTRUTURA_INESPERADA");
        cb(null, final.length > 0 ? Buffer.from(final, "utf8") : undefined);
      } catch (e) {
        cb(e as Error);
      }
    },
  });
}
