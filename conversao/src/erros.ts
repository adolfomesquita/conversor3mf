// Erros da conversão. A mensagem é segura para mostrar ao usuário (pt-BR, sem detalhes internos,
// sem nome de arquivo nem conteúdo). O código vai para logs e testes.

export type CodigoErroConversao =
  | "ZIP_INVALIDO"
  | "ZIP_LIMITE"
  | "ZIP_CAMINHO_INVALIDO"
  | "ZIP_ENTRADA_DUPLICADA"
  | "ZIP_CRIPTOGRAFADO"
  | "XML_INVALIDO"
  | "XML_DTD"
  | "NAO_E_PROJETO"
  | "PROJETO_COM_GCODE"
  | "CONFIG_INVALIDA"
  | "BICO_NAO_SUPORTADO"
  | "PERFIL_DESCONHECIDO"
  | "ESTRUTURA_INESPERADA"
  | "ORIGEM_NAO_SUPORTADA";

/** Mensagens ao usuário (as mesmas no resumo e na conversão). */
export const MENSAGENS: Readonly<Record<CodigoErroConversao, string>> = {
  ZIP_INVALIDO: "O arquivo não é um .3mf válido (ZIP corrompido ou incompleto).",
  ZIP_LIMITE: "O arquivo excede os limites de segurança (tamanho descompactado, número de arquivos internos ou taxa de compressão).",
  ZIP_CAMINHO_INVALIDO: "O arquivo contém caminhos internos inválidos e foi recusado por segurança.",
  ZIP_ENTRADA_DUPLICADA: "O arquivo contém entradas internas duplicadas e foi recusado por segurança.",
  ZIP_CRIPTOGRAFADO: "Arquivos .3mf com conteúdo criptografado não são aceitos.",
  XML_INVALIDO: "O arquivo contém XML malformado.",
  XML_DTD: "O arquivo contém declarações XML não permitidas (DOCTYPE/entidades) e foi recusado por segurança.",
  NAO_E_PROJETO: "O arquivo não é um projeto do Bambu Studio (faltam as configurações do projeto).",
  PROJETO_COM_GCODE: "Arquivos fatiados (.gcode.3mf) não são aceitos. Use o projeto .3mf, sem G-code.",
  CONFIG_INVALIDA: "As configurações do projeto estão em um formato inválido.",
  BICO_NAO_SUPORTADO: "O diâmetro de bico do projeto não é suportado para esta impressora.",
  PERFIL_DESCONHECIDO: "Impressora de destino desconhecida.",
  ESTRUTURA_INESPERADA: "A estrutura interna do projeto é diferente da esperada e não pôde ser convertida com segurança.",
  ORIGEM_NAO_SUPORTADA: "O slicer que gerou este projeto não é suportado.",
};

export class ErroConversao extends Error {
  readonly codigo: CodigoErroConversao;

  constructor(codigo: CodigoErroConversao, mensagem?: string, opcoes?: { cause?: unknown }) {
    super(mensagem ?? MENSAGENS[codigo], opcoes);
    this.name = "ErroConversao";
    this.codigo = codigo;
  }
}

export function ehErroConversao(e: unknown): e is ErroConversao {
  return e instanceof ErroConversao;
}
