// Relatório de validação da conversão: o que foi mantido, substituído, descartado e o que exige revisão.
// Não contém nomes de arquivos nem de objetos (vai para o histórico do usuário e pode aparecer em logs).

export type CategoriaItem = "impressora" | "processo" | "filamento" | "configuracao" | "geometria" | "pacote";

export interface ItemRelatorio {
  categoria: CategoriaItem;
  descricao: string;
  chave?: string;
  de?: string;
  para?: string;
}

export type CodigoAviso =
  | "NAO_CABE_NA_MESA"
  | "FORA_DA_AREA"
  | "CORES_EXCEDEM"
  | "ALTURA_APROXIMADA"
  | "FILAMENTO_APROXIMADO"
  | "SEM_DIFERENCAS_REGISTRADAS"
  | "GCODE_POR_CAMADA"
  | "GEOMETRIA_NAO_VERIFICADA"
  | "EXTRUSOR_INVALIDO"
  | "POSICAO_NAO_AJUSTADA"
  | "BICO_NAO_INFORMADO"
  | "MESMA_IMPRESSORA"
  | "OBJETO_SEM_PLACA";

export interface AvisoRelatorio {
  codigo: CodigoAviso;
  mensagem: string;
}

export interface FilamentoRelatorio {
  indice: number;
  cor: string;
  tipoOrigem: string;
  perfilOrigem: string;
  perfilDestino: string;
  equivalenciaExata: boolean;
}

export interface RelatorioConversao {
  versaoFormato: 1;
  destino: {
    perfilId: string;
    impressora: string;
    bico: number;
    slicer: string;
    versaoPacotePerfis: string;
  };
  origem: {
    /** Slicer que gerou o projeto (identificado pelo arquivo) e a versão dele. */
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
  filamentos: FilamentoRelatorio[];
  mantidos: ItemRelatorio[];
  substituidos: ItemRelatorio[];
  revisar: ItemRelatorio[];
  descartados: ItemRelatorio[];
  avisos: AvisoRelatorio[];
  resumo: {
    mantidos: number;
    substituidos: number;
    revisar: number;
    descartados: number;
    avisos: number;
    /** "ok" quando não há nada para revisar nem avisos. */
    situacao: "ok" | "revisar";
  };
}

/** Acumulador usado pelas etapas da conversão. */
export class Relatorio {
  readonly mantidos: ItemRelatorio[] = [];
  readonly substituidos: ItemRelatorio[] = [];
  readonly revisar: ItemRelatorio[] = [];
  readonly descartados: ItemRelatorio[] = [];
  readonly avisos: AvisoRelatorio[] = [];

  aviso(codigo: CodigoAviso, mensagem: string): void {
    this.avisos.push({ codigo, mensagem });
  }
}
