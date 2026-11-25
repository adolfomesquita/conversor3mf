// Leitor de ZIP leve, só para o resumo do projeto antes de converter.
// Lê pedaços do arquivo (File/Blob.slice), sem carregar o .3mf inteiro na memória (pode ter 300 MB):
// o diretório central e só as entradas pedidas, com limite de bytes descompactados.
// Não é a validação de segurança do arquivo: essa é feita na conversão (../conversao/src/zipSeguro.ts).
import { Inflate } from "fflate";

export interface EntradaZip {
  nome: string;
  metodo: number;
  criptografada: boolean;
  tamanhoComprimido: number;
  tamanho: number;
  offsetLocal: number;
}

export class ErroLeituraZip extends Error {}

const MAX_ENTRADAS = 5000;
const MAX_DIRETORIO = 16 * 1024 * 1024;
// Pedaços pequenos: o deflate expande no máximo ~1000×, então cada push gera no máximo ~64 MB
// mesmo num arquivo malicioso, e a leitura para assim que passa do limite.
const PEDACO = 64 * 1024;
const decodificador = new TextDecoder("utf-8");

async function ler(arquivo: Blob, inicio: number, fim: number): Promise<DataView> {
  if (inicio < 0 || fim > arquivo.size || fim < inicio) throw new ErroLeituraZip("fora do arquivo");
  return new DataView(await arquivo.slice(inicio, fim).arrayBuffer());
}

function u64(v: DataView, pos: number): number {
  const n = v.getBigUint64(pos, true);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new ErroLeituraZip("valor grande demais");
  return Number(n);
}

/** Entradas do diretório central (ZIP e ZIP64). */
export async function listarEntradas(arquivo: Blob): Promise<EntradaZip[]> {
  const tamFinal = Math.min(arquivo.size, 22 + 0xffff);
  if (tamFinal < 22) throw new ErroLeituraZip("pequeno demais");
  const fim = await ler(arquivo, arquivo.size - tamFinal, arquivo.size);
  let eocd = -1;
  for (let i = tamFinal - 22; i >= 0; i--) {
    if (fim.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ErroLeituraZip("sem diretório central");
  let total = fim.getUint16(eocd + 10, true);
  let tamDir = fim.getUint32(eocd + 12, true);
  let offDir = fim.getUint32(eocd + 16, true);
  if (total === 0xffff || tamDir === 0xffffffff || offDir === 0xffffffff) {
    const posEocd = arquivo.size - tamFinal + eocd;
    if (posEocd < 20) throw new ErroLeituraZip("ZIP64 sem localizador");
    const loc = await ler(arquivo, posEocd - 20, posEocd);
    if (loc.getUint32(0, true) !== 0x07064b50) throw new ErroLeituraZip("ZIP64 sem localizador");
    const pos64 = u64(loc, 8);
    const r64 = await ler(arquivo, pos64, pos64 + 56);
    if (r64.getUint32(0, true) !== 0x06064b50) throw new ErroLeituraZip("ZIP64 inválido");
    total = u64(r64, 32);
    tamDir = u64(r64, 40);
    offDir = u64(r64, 48);
  }
  if (total > MAX_ENTRADAS || tamDir > MAX_DIRETORIO) throw new ErroLeituraZip("diretório grande demais");
  const dir = await ler(arquivo, offDir, offDir + tamDir);
  const bytes = new Uint8Array(dir.buffer);
  const entradas: EntradaZip[] = [];
  let p = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > tamDir || dir.getUint32(p, true) !== 0x02014b50) throw new ErroLeituraZip("diretório inválido");
    const flags = dir.getUint16(p + 8, true);
    const metodo = dir.getUint16(p + 10, true);
    let tamanhoComprimido = dir.getUint32(p + 20, true);
    let tamanho = dir.getUint32(p + 24, true);
    const tamNome = dir.getUint16(p + 28, true);
    const tamExtra = dir.getUint16(p + 30, true);
    const tamComentario = dir.getUint16(p + 32, true);
    let offsetLocal = dir.getUint32(p + 42, true);
    if (p + 46 + tamNome + tamExtra > tamDir) throw new ErroLeituraZip("diretório inválido");
    const nome = decodificador.decode(bytes.subarray(p + 46, p + 46 + tamNome));
    // Campo extra ZIP64 (0x0001): só os valores que estão como 0xFFFFFFFF, nesta ordem.
    let e = p + 46 + tamNome;
    const fimExtra = e + tamExtra;
    while (e + 4 <= fimExtra) {
      const id = dir.getUint16(e, true);
      const tam = dir.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        const limite = e + 4 + tam;
        if (tamanho === 0xffffffff && q + 8 <= limite) {
          tamanho = u64(dir, q);
          q += 8;
        }
        if (tamanhoComprimido === 0xffffffff && q + 8 <= limite) {
          tamanhoComprimido = u64(dir, q);
          q += 8;
        }
        if (offsetLocal === 0xffffffff && q + 8 <= limite) offsetLocal = u64(dir, q);
      }
      e += 4 + tam;
    }
    entradas.push({ nome, metodo, criptografada: (flags & 1) !== 0, tamanhoComprimido, tamanho, offsetLocal });
    p += 46 + tamNome + tamExtra + tamComentario;
  }
  return entradas;
}

/**
 * Conteúdo descompactado de uma entrada, até maxBytes. Com parcial=true devolve só o começo
 * (ex.: cabeçalho do 3dmodel.model); senão, falha se a entrada passar do limite.
 */
export async function lerEntrada(arquivo: Blob, entrada: EntradaZip, maxBytes: number, parcial = false): Promise<Uint8Array> {
  if (entrada.criptografada) throw new ErroLeituraZip("criptografada");
  if (!parcial && entrada.tamanho > maxBytes) throw new ErroLeituraZip("entrada grande demais");
  const local = await ler(arquivo, entrada.offsetLocal, entrada.offsetLocal + 30);
  if (local.getUint32(0, true) !== 0x04034b50) throw new ErroLeituraZip("cabeçalho local inválido");
  const inicio = entrada.offsetLocal + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const fim = inicio + entrada.tamanhoComprimido;
  if (fim > arquivo.size) throw new ErroLeituraZip("entrada fora do arquivo");

  if (entrada.metodo === 0) {
    if (!parcial && entrada.tamanhoComprimido > maxBytes) throw new ErroLeituraZip("entrada grande demais");
    return new Uint8Array(await arquivo.slice(inicio, Math.min(fim, inicio + maxBytes)).arrayBuffer());
  }
  if (entrada.metodo !== 8) throw new ErroLeituraZip("método de compressão não suportado");

  const partes: Uint8Array[] = [];
  let total = 0;
  let estourou = false;
  let terminou = false;
  const inflador = new Inflate((dados, final) => {
    if (estourou) return;
    partes.push(dados);
    total += dados.length;
    if (total > maxBytes) estourou = true;
    if (final) terminou = true;
  });
  for (let pos = inicio; pos < fim && !estourou && !terminou; pos += PEDACO) {
    const pedaco = new Uint8Array(await arquivo.slice(pos, Math.min(fim, pos + PEDACO)).arrayBuffer());
    inflador.push(pedaco, pos + PEDACO >= fim);
  }
  if (estourou && !parcial) throw new ErroLeituraZip("entrada grande demais");
  const saida = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const parte of partes) {
    if (off >= saida.length) break;
    const n = Math.min(parte.length, saida.length - off);
    saida.set(parte.subarray(0, n), off);
    off += n;
  }
  return saida;
}

export function comoTexto(bytes: Uint8Array): string {
  return decodificador.decode(bytes);
}
