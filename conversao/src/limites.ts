// Limites de segurança para tratar o .3mf como entrada não confiável.
// Calibrados com 230 projetos reais (docs/inspecao-3mf-e-perfis.md, seção 5): maior arquivo 265 MB,
// 1,37 GB descompactado, maior entrada 478 MB, 340 entradas, taxa de compressão até ~40x.
// Todos são injetáveis para que os testes usem valores pequenos.

export interface LimitesConversao {
  /** Número máximo de entradas no ZIP. */
  maxEntradas: number;
  /** Soma máxima dos tamanhos descompactados (bytes). */
  maxTotalDescompactado: number;
  /** Tamanho máximo descompactado de uma entrada (bytes). */
  maxEntradaDescompactada: number;
  /** Razão máxima descompactado/compactado de uma entrada (proteção contra zip bomb). */
  maxRazaoCompressao: number;
  /** A razão só é avaliada em entradas maiores que isto (arquivos minúsculos comprimem muito). */
  minBytesParaRazao: number;
  /** Tamanho máximo de arquivos de configuração lidos inteiros na memória (JSON/XML de Metadata, rels). */
  maxBytesConfiguracao: number;
  /** Profundidade máxima de elementos XML aninhados. */
  maxProfundidadeXml: number;
  /** Número máximo de filamentos aceitos na origem. */
  maxFilamentosOrigem: number;
  /** Número máximo de chaves no project_settings.config. */
  maxChavesConfiguracao: number;
  /** Nível de compressão do ZIP de saída (0–9). */
  nivelCompressao: number;
}

const MB = 1024 * 1024;

export const LIMITES_PADRAO: Readonly<LimitesConversao> = Object.freeze({
  maxEntradas: 5000,
  maxTotalDescompactado: 2048 * MB,
  maxEntradaDescompactada: 1024 * MB,
  maxRazaoCompressao: 200,
  minBytesParaRazao: 1 * MB,
  maxBytesConfiguracao: 64 * MB,
  maxProfundidadeXml: 128,
  maxFilamentosOrigem: 64,
  maxChavesConfiguracao: 5000,
  nivelCompressao: 6,
});

export function limitesCom(parcial: Partial<LimitesConversao> = {}): LimitesConversao {
  return { ...LIMITES_PADRAO, ...parcial };
}
