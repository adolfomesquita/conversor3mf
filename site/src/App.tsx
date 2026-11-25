// Versão estática: uma página só, com o conversor e o texto de privacidade e termos (#privacidade).
// Sem rotas do navegador: o GitHub Pages não sabe responder a endereços internos.
import { useEffect, useState } from "react";
import { CONFIGURACAO, NOME_APP, linkContato } from "./configuracao";
import { Conversor } from "./Conversor";
import { contarVisita } from "./servicos/estatistica";

const CONTATO_PROBLEMA = linkContato(`Problema no ${NOME_APP}`);

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
      <h2>Seus arquivos não saem do seu computador</h2>
      <p>
        A conversão é feita inteira no seu navegador. O projeto .3mf que você escolhe é lido e convertido no seu computador e não é enviado a
        nenhum servidor. O arquivo convertido é gerado na memória do navegador e baixado direto para você.
      </p>
      <h2>O que não fazemos</h2>
      <p>Não há cadastro, login, cookies nem publicidade. Não guardamos nada sobre você ou seus arquivos.</p>
      {CONFIGURACAO.estatistica && (
        <>
          <h2>Contagem de uso</h2>
          <p>
            Contamos quantas pessoas usam o site com o <a href="https://www.goatcounter.com/">GoatCounter</a>, um contador sem cookies. Cada
            visita envia o endereço desta página, o site de onde você veio, o navegador, a largura da tela e o país (deduzido pelo endereço IP). Cada conversão envia só o nome da
            impressora de destino, ou que houve um erro. O nome e o conteúdo do seu arquivo nunca são enviados. Segundo o GoatCounter, o endereço
            IP não é guardado. Se o seu navegador pede para não ser rastreado (Do Not Track ou Global Privacy Control), nada é contado.
          </p>
        </>
      )}
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
      {CONFIGURACAO.contato && CONTATO_PROBLEMA && (
        <>
          <h2>Contato</h2>
          <p>
            Para reportar um problema ou tirar uma dúvida, escreva para <a href={CONTATO_PROBLEMA}>{CONFIGURACAO.contato}</a>. O link só abre o seu
            programa de e-mail: nada é enviado sem você mandar. Se você escrever, recebemos o seu endereço de e-mail e o que estiver na mensagem,
            e usamos isso só para responder. Se anexar um projeto, envie só arquivos que você pode compartilhar.
          </p>
        </>
      )}
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
  useEffect(() => contarVisita(), []);
  return (
    <div className="pagina">
      <header className="cabecalho">
        <div className="container cabecalho-conteudo">
          <div className="marca-grupo">
            <a href="#" className="marca">
              <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} />
              {NOME_APP}
            </a>
            {CONFIGURACAO.versaoDeTeste && (
              <span
                className="etiqueta-teste"
                title="O site ainda está em teste: confira o arquivo no slicer antes de imprimir e, se algo der errado, reporte por e-mail."
              >
                Versão de teste
              </span>
            )}
          </div>
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
            {CONTATO_PROBLEMA && <a href={CONTATO_PROBLEMA}>Reportar problema</a>}
            <a href="#privacidade">Privacidade e termos</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
