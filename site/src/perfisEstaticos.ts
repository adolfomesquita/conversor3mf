// Endereço de cada arquivo de perfil. O Vite copia os JSON da biblioteca (functions/src/conversao/perfis)
// para o site como arquivos estáticos; o navegador baixa só os do modelo escolhido.
const URLS = import.meta.glob("../../conversao/src/perfis/*.json", { query: "?url", import: "default", eager: true }) as Record<
  string,
  string
>;

const porNome = new Map(Object.entries(URLS).map(([caminho, url]) => [caminho.slice(caminho.lastIndexOf("/") + 1), url]));

export function urlDoPerfil(nome: string): string | undefined {
  return porNome.get(nome);
}
