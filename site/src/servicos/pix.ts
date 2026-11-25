// "Pix copia e cola" estático (BR Code, padrão EMV do Banco Central), gerado no navegador.
// Nenhum pagamento passa pelo site: a pessoa cola o código (ou lê o QR) no app do banco dela.

export interface DadosPix {
  chave: string;
  /** Nome de quem recebe (até 25 caracteres, sem acentos). */
  nome: string;
  /** Cidade de quem recebe (até 15 caracteres, sem acentos). */
  cidade: string;
  /** Valor em reais; sem valor, a pessoa digita no app do banco. */
  valor?: number | null;
  /** Identificador da transação ("***" = sem identificador, padrão para Pix estático). */
  txid?: string;
}

function campo(id: string, valor: string): string {
  return `${id}${String(valor.length).padStart(2, "0")}${valor}`;
}

/** Só caracteres que o BR Code aceita: sem acentos, ASCII imprimível. */
function ascii(texto: string, max: number): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, max);
}

/** CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), como exige o BR Code. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function payloadPix(d: DadosPix): string {
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", d.chave.trim());
  const valor = d.valor && d.valor > 0 ? campo("54", d.valor.toFixed(2)) : "";
  const semCrc =
    campo("00", "01") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    valor +
    campo("58", "BR") +
    campo("59", ascii(d.nome, 25)) +
    campo("60", ascii(d.cidade, 15)) +
    campo("62", campo("05", ascii(d.txid ?? "***", 25) || "***")) +
    "6304";
  return semCrc + crc16(semCrc);
}
