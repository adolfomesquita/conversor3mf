// Configuração do site (GitHub Pages). Não há servidor nem área admin: mude aqui e publique.
import type { Doacao } from "./servicos/formatos";

export const NOME_APP = "Conversor 3MF";

export const CONFIGURACAO: {
  /** Limite do arquivo (o navegador precisa de memória para a entrada e a saída). */
  tamanhoMaximoMb: number;
  /**
   * Quadro "Apoie o projeto" ao fim da conversão. null = escondido.
   * Exemplo: { pix: { chave: "sua-chave-pix", nome: "NOME DO RECEBEDOR", cidade: "CIDADE" }, link: "https://..." }
   * (nome até 25 e cidade até 15 caracteres, sem acento, como no Pix).
   */
  doacao: Doacao | null;
  /** Endereço do código-fonte (exigido pela licença AGPL dos perfis). null = sem link. */
  codigoFonte: string | null;
} = {
  tamanhoMaximoMb: 300,
  doacao: null,
  codigoFonte: "https://github.com/adolfomesquita/conversor3mf",
};
