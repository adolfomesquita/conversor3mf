// Substituto do módulo "zlib" do Node para o Worker, usando a compressão NATIVA do navegador
// (CompressionStream / DecompressionStream "deflate-raw"), muito mais rápida que a versão em
// JavaScript do polyfill. Só o que o yauzl (leitura do ZIP) e o yazl (escrita) usam.
// O conteúdo descompactado é idêntico; só os bytes compactados podem diferir dos do servidor.
import { Duplex } from "node:stream";

type Fluxo = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };

const LIMITE_FILA = 8 * 1024 * 1024;

const comoErro = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

/**
 * Fluxo Node (Duplex) sobre um TransformStream da web. A saída é lida adiantada (o compressor nativo
 * trabalha em paralelo com quem consome) para uma fila de no máximo ~8 MB; com a fila cheia, a
 * entrada para de ser aceita. Assim fica rápido sem acumular o arquivo inteiro na memória.
 */
function duplexDe(fluxo: Fluxo): Duplex {
  const escritor = fluxo.writable.getWriter();
  const leitor = fluxo.readable.getReader();
  const fila: Buffer[] = [];
  let bytesNaFila = 0;
  let lendo = false;
  let acabou = false;
  let entregouFim = false;
  let querDados = false;
  let liberarEscrita: (() => void) | null = null;

  const d = new Duplex({
    write(trecho: Uint8Array, _enc, cb) {
      // Erro de dados aparece na leitura (leitor.read rejeita).
      escritor.write(trecho).catch(() => undefined);
      if (bytesNaFila < LIMITE_FILA) cb();
      else liberarEscrita = () => cb();
      bombear();
    },
    final(cb) {
      escritor.close().then(
        () => cb(),
        (e: unknown) => cb(comoErro(e)),
      );
      bombear();
    },
    read() {
      querDados = true;
      entregar();
      bombear();
    },
    destroy(erro, cb) {
      escritor.abort(erro ?? undefined).catch(() => undefined);
      leitor.cancel(erro ?? undefined).catch(() => undefined);
      cb(erro);
    },
  });

  function entregar(): void {
    while (querDados && fila.length > 0) {
      const b = fila.shift()!;
      bytesNaFila -= b.length;
      querDados = d.push(b);
    }
    if (acabou && fila.length === 0 && !entregouFim) {
      entregouFim = true;
      d.push(null);
    }
    if (bytesNaFila < LIMITE_FILA && liberarEscrita) {
      const liberar = liberarEscrita;
      liberarEscrita = null;
      liberar();
    }
  }

  function bombear(): void {
    if (lendo || acabou || bytesNaFila >= LIMITE_FILA) return;
    lendo = true;
    leitor.read().then(
      ({ done, value }) => {
        lendo = false;
        if (done) acabou = true;
        else {
          fila.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
          bytesNaFila += value.byteLength;
        }
        entregar();
        bombear();
      },
      (e: unknown) => {
        lendo = false;
        d.destroy(comoErro(e));
      },
    );
  }

  return d;
}

export function createInflateRaw(): Duplex {
  return duplexDe(new DecompressionStream("deflate-raw") as unknown as Fluxo);
}

export function createDeflateRaw(): Duplex {
  return duplexDe(new CompressionStream("deflate-raw") as unknown as Fluxo);
}

/** O yazl usa `new zlib.DeflateRaw(opcoes)`; o nível é ignorado (o navegador escolhe). */
export function DeflateRaw(): Duplex {
  return createDeflateRaw();
}

export function deflateRaw(dados: Uint8Array, _opcoes: unknown, cb: (erro: Error | null, resultado?: Buffer) => void): void {
  const copia = new Uint8Array(dados.byteLength);
  copia.set(dados);
  new Response(new Blob([copia]).stream().pipeThrough(new CompressionStream("deflate-raw")))
    .arrayBuffer()
    .then(
      (b) => cb(null, Buffer.from(b)),
      (e: unknown) => cb(e instanceof Error ? e : new Error(String(e))),
    );
}

export default { createInflateRaw, createDeflateRaw, DeflateRaw, deflateRaw };
