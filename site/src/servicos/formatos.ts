// Tipos e formatação da tela do conversor.

/** Impressora de destino (modelo). O bico é escolhido pela conversão conforme o projeto. */
export interface Destino {
  id: string;
  fabricante: string;
  impressora: string;
  slicer: string;
  maxFilamentos: number;
  capa: string | null;
  bicos: number[];
}

/** Doação voluntária (null = desligada). */
export interface Doacao {
  pix: { chave: string; nome: string; cidade: string } | null;
  link: string | null;
}

export interface ItemRelatorio {
  categoria: string;
  descricao: string;
  chave?: string;
  de?: string;
  para?: string;
}

export interface Relatorio {
  destino: { perfilId: string; impressora: string; bico: number; slicer: string; versaoPacotePerfis: string };
  origem: {
    slicer: string;
    versaoSlicer: string | null;
    impressora: string | null;
    versaoProjeto: string | null;
    alturaCamada: number | null;
    filamentos: number;
    placas: number;
    objetos: number;
  };
  processo: { nome: string; alturaCamadaPerfil: number; alturaCamadaProjeto: number; exata: boolean };
  filamentos: Array<{ indice: number; cor: string; tipoOrigem: string; perfilOrigem: string; perfilDestino: string; equivalenciaExata: boolean }>;
  mantidos: ItemRelatorio[];
  substituidos: ItemRelatorio[];
  revisar: ItemRelatorio[];
  descartados: ItemRelatorio[];
  avisos: Array<{ codigo: string; mensagem: string }>;
  resumo: { mantidos: number; substituidos: number; revisar: number; descartados: number; avisos: number; situacao: "ok" | "revisar" };
}

export function formatarBico(b: number): string {
  return String(b).replace(".", ",");
}

/** Validação rápida antes de ler o arquivo (a conversão valida tudo de novo). */
export function validarArquivo(arquivo: File, tamanhoMaximoMb: number): string | null {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith(".gcode.3mf")) return "Arquivos fatiados (.gcode.3mf) não são aceitos. Envie o projeto .3mf.";
  if (!nome.endsWith(".3mf")) return "Escolha um arquivo .3mf.";
  if (arquivo.size === 0) return "O arquivo está vazio.";
  if (arquivo.size > tamanhoMaximoMb * 1024 * 1024) return `O arquivo passa do limite de ${tamanhoMaximoMb} MB.`;
  return null;
}

export function formatarBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
