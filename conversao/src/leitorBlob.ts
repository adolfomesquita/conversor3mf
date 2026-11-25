// Leitor de acesso aleatório sobre um Blob/File (o arquivo escolhido no navegador), para o yauzl ler
// o ZIP em pedaços sem carregar tudo na memória. Também roda no Node (que tem Blob), o que permite
// testar a versão do navegador com o mesmo código do servidor.
import { Readable } from "node:stream";
import yauzl from "yauzl";

const PEDACO = 2 * 1024 * 1024;

export class LeitorBlob extends yauzl.RandomAccessReader {
  private readonly blob: Blob;
  private readonly aoLer?: (bytes: number) => void;

  /** `aoLer` recebe a quantidade de bytes lida a cada pedaço (para mostrar o progresso). */
  constructor(blob: Blob, aoLer?: (bytes: number) => void) {
    super();
    this.blob = blob;
    this.aoLer = aoLer;
  }

  _readStreamForRange(inicio: number, fim: number): Readable {
    const blob = this.blob;
    const aoLer = this.aoLer;
    let pos = inicio;
    return new Readable({
      // Um pedaço por pedido de leitura: respeita o ritmo de quem consome (backpressure).
      read() {
        if (pos >= fim) {
          this.push(null);
          return;
        }
        const ate = Math.min(fim, pos + PEDACO);
        blob
          .slice(pos, ate)
          .arrayBuffer()
          .then((b) => {
            pos = ate;
            aoLer?.(b.byteLength);
            this.push(Buffer.from(b));
          })
          .catch((e: unknown) => this.destroy(e instanceof Error ? e : new Error(String(e))));
      },
    });
  }
}
