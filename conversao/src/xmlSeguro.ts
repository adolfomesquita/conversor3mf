// Parser XML para conteúdo não confiável.
// - saxes não busca recursos externos e não expande entidades além das 5 predefinidas;
//   além disso, QUALQUER DOCTYPE é recusado (bloqueia XXE e "billion laughs").
// - Profundidade de aninhamento limitada.
// - Funciona em streaming (arquivos de malha com centenas de MB) e com texto inteiro.
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import { SaxesParser, type SaxesTagNS, type SaxesTagPlain } from "saxes";
import { ErroConversao } from "./erros.js";

export interface TagXml {
  /** Nome local (sem prefixo). No modo sem namespaces, o nome completo como está no arquivo. */
  local: string;
  /** URI do namespace do elemento ("" se nenhum ou no modo sem namespaces). */
  uri: string;
  /** Atributos por nome local, de qualquer namespace exceto declarações xmlns (montado sob demanda). */
  readonly atributos: Map<string, { uri: string; valor: string }>;
  /** Acesso rápido a um atributo pelo nome local (sem montar o mapa). */
  atributo(nome: string): string | undefined;
}

export interface ManipuladoresXml {
  abrir?(tag: TagXml, profundidade: number): void;
  fechar?(local: string, profundidade: number): void;
}

export interface OpcoesXml {
  /**
   * Processar namespaces (padrão). Desligado só para arquivos de malha enormes, em que o custo
   * importa e basta ler elementos sem prefixo; DOCTYPE/entidades continuam recusados igual.
   */
  namespaces?: boolean;
}

export class AnalisadorXml {
  private readonly parser: SaxesParser;
  private readonly decodificador = new StringDecoder("utf8");
  private profundidade = 0;
  private inicio = true;
  private erro: unknown = null;

  constructor(manipuladores: ManipuladoresXml, maxProfundidade: number, opcoes: OpcoesXml = {}) {
    const comNs = opcoes.namespaces ?? true;
    this.parser = new SaxesParser({ xmlns: comNs, position: false });
    this.parser.on("doctype", () => {
      throw new ErroConversao("XML_DTD");
    });
    this.parser.on("error", (e) => {
      throw e instanceof ErroConversao ? e : new ErroConversao("XML_INVALIDO");
    });
    this.parser.on("opentag", (t) => {
      this.profundidade++;
      if (this.profundidade > maxProfundidade) throw new ErroConversao("XML_INVALIDO");
      if (!manipuladores.abrir) return;
      let tag: TagXml;
      if (comNs) {
        const tn = t as SaxesTagNS;
        // Mapa de atributos montado só se o manipulador pedir (malhas têm milhões de tags).
        let cache: Map<string, { uri: string; valor: string }> | null = null;
        tag = {
          local: tn.local,
          uri: tn.uri,
          get atributos() {
            if (!cache) {
              cache = new Map();
              for (const a of Object.values(tn.attributes)) {
                if (a.prefix === "xmlns" || a.name === "xmlns") continue;
                cache.set(a.local, { uri: a.uri, valor: a.value });
              }
            }
            return cache;
          },
          atributo(nome) {
            return this.atributos.get(nome)?.valor;
          },
        };
      } else {
        const tp = t as SaxesTagPlain;
        const attrs = tp.attributes;
        tag = {
          local: tp.name,
          uri: "",
          get atributos() {
            return new Map(Object.entries(attrs).map(([k, v]) => [k, { uri: "", valor: v }]));
          },
          atributo(nome) {
            return Object.prototype.hasOwnProperty.call(attrs, nome) ? attrs[nome] : undefined;
          },
        };
      }
      manipuladores.abrir(tag, this.profundidade);
    });
    this.parser.on("closetag", (t) => {
      manipuladores.fechar?.(comNs ? (t as SaxesTagNS).local : t.name, this.profundidade);
      this.profundidade--;
    });
  }

  escrever(trecho: Buffer | string): void {
    if (this.erro) throw this.erro;
    let texto = typeof trecho === "string" ? trecho : this.decodificador.write(trecho);
    if (this.inicio && texto.length > 0) {
      if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
      this.inicio = false;
    }
    try {
      this.parser.write(texto);
    } catch (e) {
      this.erro = e instanceof ErroConversao ? e : new ErroConversao("XML_INVALIDO");
      throw this.erro;
    }
  }

  finalizar(): void {
    if (this.erro) throw this.erro;
    try {
      const resto = this.decodificador.end();
      if (resto) this.parser.write(resto);
      this.parser.close();
    } catch (e) {
      throw e instanceof ErroConversao ? e : new ErroConversao("XML_INVALIDO");
    }
  }
}

export function analisarXmlTexto(texto: string, manipuladores: ManipuladoresXml, maxProfundidade: number): void {
  const a = new AnalisadorXml(manipuladores, maxProfundidade);
  a.escrever(texto);
  a.finalizar();
}

export function analisarXmlFluxo(
  fluxo: Readable,
  manipuladores: ManipuladoresXml,
  maxProfundidade: number,
  opcoes: OpcoesXml = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const a = new AnalisadorXml(manipuladores, maxProfundidade, opcoes);
    let terminou = false;
    const falhar = (e: unknown) => {
      if (terminou) return;
      terminou = true;
      fluxo.destroy();
      reject(e);
    };
    fluxo.on("data", (c: Buffer) => {
      try {
        a.escrever(c);
      } catch (e) {
        falhar(e);
      }
    });
    fluxo.on("end", () => {
      if (terminou) return;
      try {
        a.finalizar();
        terminou = true;
        resolve();
      } catch (e) {
        falhar(e);
      }
    });
    fluxo.on("error", falhar);
  });
}
