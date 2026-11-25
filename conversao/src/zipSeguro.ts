// Leitura de ZIP não confiável (o .3mf é um pacote ZIP/OPC).
// Checagens: ZIP válido; nº de entradas; tamanho declarado por entrada e total; razão de compressão
// (zip bomb); nomes (path traversal, absolutos, drive, barra invertida, controle, NUL); duplicatas
// (inclusive só por maiúsculas/minúsculas); links simbólicos; criptografia; métodos de compressão.
// Na leitura, os bytes realmente descompactados são contados e não podem passar do declarado
// (validateEntrySizes do yauzl + contador próprio) nem do limite total.
import { Transform, type Readable, type TransformCallback } from "node:stream";
import yauzl, { type Entry, type RandomAccessReader, type ZipFile } from "yauzl";
import { ErroConversao } from "./erros.js";
import type { LimitesConversao } from "./limites.js";

export interface EntradaZip {
  nome: string;
  tamanho: number;
  compactado: number;
  diretorio: boolean;
  data: Date;
  bruta: Entry;
}

const OPCOES_YAUZL = { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: true } as const;

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

export function nomeEntradaValido(nome: string): boolean {
  if (nome.length === 0 || nome.length > 1024) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(nome)) return false;
  if (nome.startsWith("/") || /^[A-Za-z]:/.test(nome)) return false;
  const partes = nome.split("/");
  if (partes[partes.length - 1] === "") partes.pop(); // diretório
  if (partes.length === 0) return false;
  return partes.every((p) => p !== "" && p !== "." && p !== "..");
}

function erroDoYauzl(e: unknown): ErroConversao {
  if (e instanceof ErroConversao) return e;
  const msg = e instanceof Error ? e.message : "";
  if (/absolute path|invalid relative path|invalid characters/i.test(msg)) return new ErroConversao("ZIP_CAMINHO_INVALIDO");
  if (/encrypt/i.test(msg)) return new ErroConversao("ZIP_CRIPTOGRAFADO");
  return new ErroConversao("ZIP_INVALIDO");
}

export class ZipSeguro {
  readonly entradas: EntradaZip[];
  private readonly zip: ZipFile;
  private readonly limites: LimitesConversao;
  private readonly porNome: Map<string, EntradaZip>;
  private totalLido = 0;

  private constructor(zip: ZipFile, entradas: EntradaZip[], limites: LimitesConversao) {
    this.zip = zip;
    this.entradas = entradas;
    this.limites = limites;
    this.porNome = new Map(entradas.map((e) => [e.nome, e]));
  }

  /** Abre um arquivo do disco (servidor). */
  static async abrir(caminho: string, limites: LimitesConversao): Promise<ZipSeguro> {
    const zip = await new Promise<ZipFile>((resolve, reject) => {
      yauzl.open(caminho, OPCOES_YAUZL, (e, z) => (e || !z ? reject(erroDoYauzl(e)) : resolve(z)));
    });
    return ZipSeguro.validar(zip, limites);
  }

  /**
   * Abre a partir de um leitor de acesso aleatório (navegador: o arquivo escolhido pela pessoa, lido
   * em pedaços). Mesmas checagens do disco.
   */
  static async abrirLeitor(leitor: RandomAccessReader, tamanho: number, limites: LimitesConversao): Promise<ZipSeguro> {
    const zip = await new Promise<ZipFile>((resolve, reject) => {
      yauzl.fromRandomAccessReader(leitor, tamanho, OPCOES_YAUZL, (e, z) => (e || !z ? reject(erroDoYauzl(e)) : resolve(z)));
    });
    return ZipSeguro.validar(zip, limites);
  }

  private static async validar(zip: ZipFile, limites: LimitesConversao): Promise<ZipSeguro> {
    try {
      if (zip.entryCount > limites.maxEntradas) throw new ErroConversao("ZIP_LIMITE");
      const entradas = await ZipSeguro.lerDiretorio(zip, limites);
      return new ZipSeguro(zip, entradas, limites);
    } catch (e) {
      zip.close();
      throw erroDoYauzl(e);
    }
  }

  private static lerDiretorio(zip: ZipFile, limites: LimitesConversao): Promise<EntradaZip[]> {
    return new Promise((resolve, reject) => {
      const entradas: EntradaZip[] = [];
      const vistos = new Set<string>();
      let total = 0;
      zip.on("entry", (e: Entry) => {
        try {
          const nome = e.fileName;
          if (!nomeEntradaValido(nome)) throw new ErroConversao("ZIP_CAMINHO_INVALIDO");
          const chave = nome.normalize("NFC").toLowerCase();
          if (vistos.has(chave)) throw new ErroConversao("ZIP_ENTRADA_DUPLICADA");
          vistos.add(chave);
          if (e.isEncrypted()) throw new ErroConversao("ZIP_CRIPTOGRAFADO");
          if (((e.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) throw new ErroConversao("ZIP_CAMINHO_INVALIDO");
          if (e.compressionMethod !== 0 && e.compressionMethod !== 8) throw new ErroConversao("ZIP_INVALIDO");
          const diretorio = nome.endsWith("/");
          if (e.uncompressedSize > limites.maxEntradaDescompactada) throw new ErroConversao("ZIP_LIMITE");
          if (
            e.uncompressedSize > limites.minBytesParaRazao &&
            e.uncompressedSize / Math.max(1, e.compressedSize) > limites.maxRazaoCompressao
          ) {
            throw new ErroConversao("ZIP_LIMITE");
          }
          total += e.uncompressedSize;
          if (total > limites.maxTotalDescompactado) throw new ErroConversao("ZIP_LIMITE");
          if (entradas.length + 1 > limites.maxEntradas) throw new ErroConversao("ZIP_LIMITE");
          entradas.push({
            nome,
            tamanho: e.uncompressedSize,
            compactado: e.compressedSize,
            diretorio,
            data: e.getLastModDate(),
            bruta: e,
          });
          zip.readEntry();
        } catch (erro) {
          reject(erroDoYauzl(erro));
        }
      });
      zip.on("end", () => resolve(entradas));
      zip.on("error", (erro) => reject(erroDoYauzl(erro)));
      zip.readEntry();
    });
  }

  obter(nome: string): EntradaZip | undefined {
    return this.porNome.get(nome);
  }

  /** Fluxo descompactado da entrada, com contagem real de bytes. */
  async abrirFluxo(entrada: EntradaZip): Promise<Readable> {
    const bruto = await new Promise<Readable>((resolve, reject) => {
      this.zip.openReadStream(entrada.bruta, (e, s) => (e || !s ? reject(erroDoYauzl(e)) : resolve(s)));
    });
    let lidos = 0;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const zip = this;
    const contador = new Transform({
      transform(trecho: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
        lidos += trecho.length;
        zip.totalLido += trecho.length;
        if (lidos > entrada.tamanho || zip.totalLido > zip.limites.maxTotalDescompactado) {
          cb(new ErroConversao("ZIP_LIMITE"));
          return;
        }
        cb(null, trecho);
      },
    });
    bruto.on("error", (e) => contador.destroy(erroDoYauzl(e)));
    return bruto.pipe(contador);
  }

  /** Lê a entrada inteira para a memória, recusando se passar de `max` bytes. */
  async lerBuffer(entrada: EntradaZip, max: number): Promise<Buffer> {
    if (entrada.tamanho > max) throw new ErroConversao("ZIP_LIMITE");
    const fluxo = await this.abrirFluxo(entrada);
    const partes: Buffer[] = [];
    let total = 0;
    for await (const p of fluxo) {
      const b = p as Buffer;
      total += b.length;
      if (total > max) {
        fluxo.destroy();
        throw new ErroConversao("ZIP_LIMITE");
      }
      partes.push(b);
    }
    return Buffer.concat(partes, total);
  }

  /** Lê só os primeiros `bytes` da entrada (ex.: cabeçalho de um XML enorme). */
  async lerInicio(entrada: EntradaZip, bytes: number): Promise<string> {
    const fluxo = await this.abrirFluxo(entrada);
    const partes: Buffer[] = [];
    let total = 0;
    try {
      for await (const p of fluxo) {
        const b = p as Buffer;
        partes.push(b);
        total += b.length;
        if (total >= bytes) break;
      }
    } finally {
      fluxo.destroy();
    }
    const t = Buffer.concat(partes, total).subarray(0, bytes).toString("utf8");
    return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
  }

  async lerTexto(entrada: EntradaZip, max: number): Promise<string> {
    const b = await this.lerBuffer(entrada, max);
    const t = b.toString("utf8");
    return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
  }

  fechar(): void {
    this.zip.close();
  }
}
