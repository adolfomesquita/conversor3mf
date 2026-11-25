// Ajustes do ambiente para a biblioteca do servidor rodar no Worker. Importado PRIMEIRO no worker:
// em ESM, os módulos importados são avaliados na ordem, antes de quem os importa.
import { Buffer as BufferNavegador } from "vite-plugin-node-polyfills/shims/buffer";
import processNavegador from "vite-plugin-node-polyfills/shims/process";

// Globais do Node. No build do Worker o plugin de polyfills não as injeta: são definidas aqui, com os
// mesmos objetos que o plugin usa no resto do código.
const g = globalThis as unknown as Record<string, unknown>;
g.global ??= globalThis;
g.Buffer ??= BufferNavegador;
g.process ??= processNavegador;
const BufferG = g.Buffer as typeof BufferNavegador;
const processG = g.process as typeof processNavegador;

// setImmediate não existe no navegador (yauzl/yazl usam). MessageChannel dá uma tarefa nova sem o
// atraso mínimo de 4 ms que o setTimeout encadeado sofre.
if (typeof globalThis.setImmediate !== "function") {
  const fila: Array<() => void> = [];
  const canal = new MessageChannel();
  canal.port1.onmessage = () => fila.shift()?.();
  (globalThis as unknown as { setImmediate: unknown }).setImmediate = (fn: (...a: unknown[]) => void, ...args: unknown[]) => {
    fila.push(() => fn(...args));
    canal.port2.postMessage(0);
    return 0;
  };
}

// O "process.nextTick" do polyfill usa setTimeout; os fluxos do Node passam por ele a cada pedaço.
// Com microtarefas (o que o Node faz de verdade) a conversão fica muitas vezes mais rápida.
processG.nextTick = ((fn: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args))) as typeof processG.nextTick;

// Texto UTF-8: o Buffer do polyfill codifica e decodifica em JavaScript puro, letra por letra, e os
// XML do projeto têm centenas de MB. TextDecoder/TextEncoder são nativos e dão o mesmo resultado
// (bytes inválidos viram U+FFFD, como no Node).
const decodificador = new TextDecoder("utf-8");
const codificador = new TextEncoder();
const eUtf8 = (enc: unknown) => enc === undefined || enc === "utf8" || enc === "utf-8";

const toStringOriginal = BufferG.prototype.toString;
BufferG.prototype.toString = function (this: InstanceType<typeof BufferG>, enc?: BufferEncoding, inicio?: number, fim?: number): string {
  if (!eUtf8(enc)) return toStringOriginal.call(this, enc, inicio, fim);
  const a = Math.max(0, inicio ?? 0);
  const b = Math.min(this.length, fim ?? this.length);
  return b <= a ? "" : decodificador.decode(this.subarray(a, b));
} as typeof BufferG.prototype.toString;

const fromOriginal = BufferG.from.bind(BufferG) as (...a: unknown[]) => InstanceType<typeof BufferG>;
(BufferG as unknown as { from: unknown }).from = (valor: unknown, enc?: unknown, tamanho?: unknown): InstanceType<typeof BufferG> => {
  if (typeof valor === "string" && eUtf8(enc)) {
    const u = codificador.encode(valor);
    return fromOriginal(u.buffer, u.byteOffset, u.byteLength);
  }
  return fromOriginal(valor, enc, tamanho);
};

export {};
