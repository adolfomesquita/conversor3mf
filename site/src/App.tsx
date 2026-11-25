// Versão estática: uma página só, com o conversor e o texto de privacidade e termos (#privacidade).
// Sem rotas do navegador: o GitHub Pages não sabe responder a endereços internos.
import { useEffect, useState } from "react";
import { CONFIGURACAO, NOME_APP } from "./configuracao";
import { Conversor } from "./Conversor";

function useSecao(): "conversor" | "privacidade" {
  const ler = (): "conversor" | "privacidade" => (window.location.hash === "#privacidade" ? "privacidade" : "conversor");
  const [secao, setSecao] = useState(ler);
  useEffect(() => {
    const aoMudar = () => {
      setSecao(ler());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);
  return secao;
}

function Privacidade() {
  return (
    <article className="cartao texto-legal">
      <h1>Privacidade e termos</h1>
      <p className="versao">Rascunho — revisar antes de publicar</p>
      <h2>Seus arquivos não saem do seu computador</h2>
      <p>
        A conversão é feita inteira no seu navegador. O projeto .3mf que você escolhe é lido e convertido no seu computador e não é enviado a
        nenhum servidor. O arquivo convertido é gerado na memória do navegador e baixado direto para você.
      </p>
      <h2>O que não fazemos</h2>
      <p>Não há cadastro, login, cookies nem ferramentas de estatística ou publicidade. Não guardamos nada sobre você ou seus arquivos.</p>
      <h2>Hospedagem</h2>
      <p>
        O site é hospedado no GitHub Pages. Como em qualquer site, o GitHub recebe dados técnicos do acesso (como o endereço IP) para entregar
        as páginas; veja a declaração de privacidade do GitHub. Os perfis de impressora são baixados do mesmo site, só os da impressora
        escolhida.
      </p>
      <h2>Uso</h2>
      <p>
        O resultado é uma sugestão de configuração para a impressora de destino: revise-o no slicer antes de imprimir. O serviço é oferecido
        como está, sem garantia de que a impressão terá o mesmo resultado da impressora de origem. Use só arquivos que você tem o direito de
        usar.
      </p>
      <h2>Código e licenças</h2>
      <p>
        Os perfis de impressora e as imagens vêm de projetos de código aberto sob a licença AGPL-3.0 (OrcaSlicer, Bambu Studio, Creality Print,
        Snapmaker Orca e derivados).
        {CONFIGURACAO.codigoFonte && (
          <>
            {" "}
            O código-fonte deste site está em <a href={CONFIGURACAO.codigoFonte}>{CONFIGURACAO.codigoFonte}</a>.
          </>
        )}
      </p>
    </article>
  );
}

export function App() {
  const secao = useSecao();
  return (
    <div className="pagina">
      <header className="cabecalho">
        <div className="container cabecalho-conteudo">
          <a href="#" className="marca">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} />
            {NOME_APP}
          </a>
          <nav className="menu aberto" aria-label="Principal">
            <a href="#" aria-current={secao === "conversor" ? "page" : undefined}>
              Conversor
            </a>
            <a href="#privacidade" aria-current={secao === "privacidade" ? "page" : undefined}>
              Privacidade
            </a>
          </nav>
        </div>
      </header>
      <main className="container conteudo">{secao === "privacidade" ? <Privacidade /> : <Conversor />}</main>
      <footer className="rodape">
        <div className="container rodape-conteudo">
          <span>
            © {new Date().getFullYear()} {NOME_APP} · grátis, sem cadastro
          </span>
          <nav aria-label="Legal">
            <a href="#privacidade">Privacidade e termos</a>          </nav>
        </div>
      </footer>
    </div>
  );
}
