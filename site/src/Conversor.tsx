// Tela do conversor: tudo acontece no navegador (arquivo -> resumo -> destino -> download).
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { bicoAlvo, destinoAceitaBico } from "@conversao/resumoProjeto";
import { bicosDoModelo, type ModeloNoIndice } from "@conversao/perfis";
import { ApoioProjeto } from "./componentes/ApoioProjeto";
import { Carregando } from "./componentes/Carregando";
import { Aviso } from "./componentes/Aviso";
import { RelatorioConversao } from "./componentes/RelatorioConversao";
import { ResumoProjeto } from "./componentes/ResumoProjeto";
import { analisarProjeto, normalizarModelo, type AnaliseProjeto, type ResumoProjeto as Resumo } from "./servicos/analiseProjeto";
import { formatarBico, formatarBytes, validarArquivo, type Destino, type Relatorio } from "./servicos/formatos";
import { nomeDoResultado } from "./servicos/nomeDownload";
import { CONFIGURACAO, NOME_APP, linkContato } from "./configuracao";
import { converterNoNavegador, type ConversaoEmAndamento } from "./mensagensWorker";
import { urlDoPerfil } from "./perfisEstaticos";

type Etapa =
  | { tipo: "escolha" }
  | { tipo: "convertendo"; fracao: number; inicio: number }
  | { tipo: "fim"; url: string; nome: string; relatorio: Relatorio; segundos: number };

type Leitura = { estado: "lendo" } | { estado: "pronto"; analise: AnaliseProjeto };

interface Compatibilidade {
  bloqueio: string | null;
  alertas: string[];
}

function compatibilidade(d: Destino, resumo: Resumo | null): Compatibilidade {
  if (!resumo) return { bloqueio: null, alertas: [] };
  const alertas: string[] = [];
  const bloqueio = destinoAceitaBico(d.bicos, resumo.bico) ? null : `sem perfil para bico de ${formatarBico(bicoAlvo(resumo.bico))} mm`;
  const n = resumo.filamentos.length;
  if (n > d.maxFilamentos) alertas.push(`o projeto tem ${n} cores`);
  if (resumo.impressora && normalizarModelo(resumo.impressora) === normalizarModelo(d.impressora)) alertas.push("mesma impressora do projeto");
  return { bloqueio, alertas };
}

async function carregarDestinos(): Promise<Destino[]> {
  const url = urlDoPerfil("indice.json");
  if (!url) throw new Error("índice ausente");
  const r = await fetch(url);
  if (!r.ok) throw new Error("índice indisponível");
  const { modelos } = (await r.json()) as { modelos: ModeloNoIndice[] };
  return modelos.map((m) => ({
    id: m.id,
    fabricante: m.fabricante,
    impressora: m.impressora,
    slicer: m.slicer,
    maxFilamentos: m.maxFilamentos,
    capa: m.capa,
    bicos: bicosDoModelo(m),
  }));
}

function tempo(segundos: number): string {
  if (segundos < 60) return `${segundos} s`;
  return `${Math.floor(segundos / 60)} min ${String(segundos % 60).padStart(2, "0")} s`;
}

export function Conversor() {
  const [destinos, setDestinos] = useState<Destino[] | null>(null);
  const [erroDestinos, setErroDestinos] = useState(false);
  const [destino, setDestino] = useState("");
  const [filtro, setFiltro] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "escolha" });
  const [agora, setAgora] = useState(() => Date.now());
  const campoArquivo = useRef<HTMLInputElement>(null);
  const leituraAtual = useRef(0);
  const conversao = useRef<ConversaoEmAndamento | null>(null);
  const urlAtual = useRef<string | null>(null);

  useEffect(() => {
    carregarDestinos().then(setDestinos, () => setErroDestinos(true));
    return () => {
      conversao.current?.cancelar();
      if (urlAtual.current) URL.revokeObjectURL(urlAtual.current);
    };
  }, []);

  // Relógio da conversão em andamento.
  const convertendo = etapa.tipo === "convertendo";
  useEffect(() => {
    if (!convertendo) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [convertendo]);

  const analise = leitura?.estado === "pronto" ? leitura.analise : null;
  const resumo = analise?.tipo === "ok" ? analise.resumo : null;
  const invalido = arquivo ? validarArquivo(arquivo, CONFIGURACAO.tamanhoMaximoMb) : null;
  const podeEscolherDestino = !!arquivo && !invalido && leitura?.estado === "pronto" && analise?.tipo !== "recusado";

  const termo = filtro.trim().toLowerCase();
  const grupos = useMemo(
    () =>
      Object.entries(
        (destinos ?? [])
          .filter((d) => !termo || d.impressora.toLowerCase().includes(termo) || d.id === destino)
          .reduce<Record<string, Destino[]>>((acc, d) => {
            (acc[d.fabricante] ??= []).push(d);
            return acc;
          }, {}),
      ),
    [destinos, termo, destino],
  );

  if (erroDestinos) return <section className="cartao"><Aviso tipo="erro">Não foi possível carregar a lista de impressoras. Recarregue a página.</Aviso></section>;
  if (!destinos) return <Carregando />;

  const destinoEscolhido = destinos.find((d) => d.id === destino);
  const destinoBloqueado = destinoEscolhido ? compatibilidade(destinoEscolhido, resumo).bloqueio !== null : false;

  function escolherArquivo(f: File | null) {
    setErro(null);
    setArquivo(f);
    setLeitura(null);
    const id = ++leituraAtual.current;
    if (!f || validarArquivo(f, CONFIGURACAO.tamanhoMaximoMb)) return;
    setLeitura({ estado: "lendo" });
    analisarProjeto(f)
      .catch((): AnaliseProjeto => ({ tipo: "indisponivel" }))
      .then((a) => {
        if (leituraAtual.current === id) setLeitura({ estado: "pronto", analise: a });
      });
  }

  function soltarArquivo(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setArrastando(false);
    if (!convertendo) escolherArquivo(e.dataTransfer.files[0] ?? null);
  }

  async function converter(e: FormEvent) {
    e.preventDefault();
    if (!arquivo || !destinoEscolhido || destinoBloqueado) return;
    const problema = validarArquivo(arquivo, CONFIGURACAO.tamanhoMaximoMb);
    if (problema) return setErro(problema);
    setErro(null);
    const inicio = Date.now();
    setAgora(inicio);
    setEtapa({ tipo: "convertendo", fracao: 0, inicio });
    const c = converterNoNavegador({ arquivo, modeloId: destinoEscolhido.id }, (fracao) =>
      setEtapa((atual) => (atual.tipo === "convertendo" ? { ...atual, fracao } : atual)),
    );
    conversao.current = c;
    const r = await c.resultado;
    if (conversao.current !== c) return;
    conversao.current = null;
    if (r.tipo === "erro") {
      setEtapa({ tipo: "escolha" });
      setErro(r.mensagem);
      return;
    }
    const url = URL.createObjectURL(r.arquivo);
    urlAtual.current = url;
    setEtapa({
      tipo: "fim",
      url,
      nome: nomeDoResultado(arquivo.name, destinoEscolhido.impressora),
      relatorio: r.relatorio as unknown as Relatorio,
      segundos: Math.round(r.milissegundos / 1000),
    });
  }

  function cancelar() {
    conversao.current?.cancelar();
    conversao.current = null;
    setEtapa({ tipo: "escolha" });
  }

  function novaConversao() {
    if (urlAtual.current) URL.revokeObjectURL(urlAtual.current);
    urlAtual.current = null;
    setEtapa({ tipo: "escolha" });
    setErro(null);
    setDestino("");
    if (campoArquivo.current) campoArquivo.current.value = "";
    escolherArquivo(null);
  }

  // O e-mail leva só a mensagem de erro; o nome e o conteúdo do arquivo ficam de fora.
  const linkErro = erro
    ? linkContato(`Problema na conversão (${NOME_APP})`, `Mensagem de erro: ${erro}\n\nO que aconteceu (origem do projeto, impressora de destino):\n`)
    : null;

  return (
    <section className="cartao">
      <h1>Converter projeto</h1>
      <p className="subtitulo">
        Escolha um projeto .3mf (Bambu Studio, OrcaSlicer, Anycubic Slicer Next, Creality Print ou Snapmaker Orca) e a impressora de destino. Geometria, pintura,
        modificadores e posição na mesa são mantidos.
      </p>
      <p className="nota">
        Grátis e sem cadastro · até {CONFIGURACAO.tamanhoMaximoMb} MB · <strong>o arquivo não sai do seu computador</strong>: a conversão é feita aqui, no seu
        navegador.
      </p>

      {erro && (
        <Aviso tipo="erro">
          {erro}
          {linkErro && (
            <>
              {" "}
              Se o problema continuar, <a href={linkErro}>reporte por e-mail</a>.
            </>
          )}
        </Aviso>
      )}

      {etapa.tipo === "fim" ? (
        <div className="resultado-conversao">
          <p className="nota">Pronto em {tempo(etapa.segundos)}.</p>
          <div className="acoes">
            <a className="botao" href={etapa.url} download={etapa.nome}>
              Baixar projeto convertido
            </a>
            <button type="button" className="botao botao-secundario" onClick={novaConversao}>
              Converter outro
            </button>
          </div>
          {CONFIGURACAO.doacao && <ApoioProjeto doacao={CONFIGURACAO.doacao} />}
          <RelatorioConversao relatorio={etapa.relatorio} />
        </div>
      ) : (
        <form onSubmit={converter} noValidate>
          <div className="passo">
            <h2 className="titulo-passo">1. Projeto .3mf</h2>
            <input
              ref={campoArquivo}
              id="arquivo"
              className="sr-only"
              type="file"
              accept=".3mf"
              disabled={convertendo}
              onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)}
            />
            {!arquivo ? (
              <label
                htmlFor="arquivo"
                className={`zona-arquivo${arrastando ? " arrastando" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setArrastando(true);
                }}
                onDragLeave={() => setArrastando(false)}
                onDrop={soltarArquivo}
              >
                <span className="opcao-titulo">Escolha ou arraste o projeto .3mf</span>
                <span className="nota">Até {CONFIGURACAO.tamanhoMaximoMb} MB. Nada é enviado: tudo acontece no seu computador.</span>
              </label>
            ) : (
              <>
                {invalido && <Aviso tipo="erro">{invalido}</Aviso>}
                {leitura?.estado === "lendo" && <Carregando texto="Lendo o projeto…" />}
                {analise?.tipo === "recusado" && <Aviso tipo="erro">{analise.mensagem}</Aviso>}
                {analise?.tipo === "indisponivel" && (
                  <Aviso tipo="info">Não foi possível ler o resumo deste arquivo. Você ainda pode tentar converter.</Aviso>
                )}
                {resumo && <ResumoProjeto resumo={resumo} nomeArquivo={arquivo.name} />}
                <p className="nota linha-arquivo">
                  {!resumo && <span>{arquivo.name} · </span>}
                  {formatarBytes(arquivo.size)} ·{" "}
                  <button type="button" className="link-botao" onClick={() => campoArquivo.current?.click()} disabled={convertendo}>
                    Trocar arquivo
                  </button>
                </p>
              </>
            )}
          </div>

          {podeEscolherDestino && (
            <fieldset className="escolha-destino passo" disabled={convertendo}>
              <legend className="titulo-passo">2. Impressora de destino</legend>
              <div className="campo">
                <label htmlFor="filtro-impressora" className="sr-only">
                  Buscar impressora
                </label>
                <input
                  id="filtro-impressora"
                  type="search"
                  placeholder="Buscar impressora (ex.: P1S, K1C, U1, Kobra S1, AD5X)"
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                />
              </div>
              {grupos.length === 0 && <p className="nota">Nenhuma impressora encontrada.</p>}
              {grupos.map(([fabricante, lista]) => (
                <div key={fabricante} className="grupo-destino">
                  <h3 className="titulo-grupo">{fabricante}</h3>
                  <div className="opcoes-destino">
                    {lista
                      .map((d) => ({ d, c: compatibilidade(d, resumo) }))
                      .sort((a, b) => Number(!!a.c.bloqueio) - Number(!!b.c.bloqueio))
                      .map(({ d, c }) => (
                        <label key={d.id} className={`opcao-destino${destino === d.id ? " selecionada" : ""}${c.bloqueio ? " indisponivel" : ""}`}>
                          <input type="radio" name="destino" value={d.id} checked={destino === d.id} disabled={!!c.bloqueio} onChange={() => setDestino(d.id)} />
                          {d.capa ? (
                            <img className="capa-impressora" src={`${import.meta.env.BASE_URL}impressoras/${d.capa}`} alt="" width={72} height={72} loading="lazy" />
                          ) : (
                            <span className="capa-impressora" aria-hidden="true" />
                          )}
                          <span className="opcao-titulo">{d.impressora.replace(new RegExp(`^${fabricante}\\s+`), "")}</span>
                          <span className="nota">
                            {d.maxFilamentos > 1 ? `até ${d.maxFilamentos} cores` : "1 cor"} · bico {d.bicos.map(formatarBico).join(" / ")} mm
                            {c.bloqueio && <span className="alerta-destino bloqueio">{c.bloqueio}</span>}
                            {c.alertas.map((a) => (
                              <span key={a} className="alerta-destino">
                                {a}
                              </span>
                            ))}
                          </span>
                        </label>
                      ))}
                  </div>
                </div>
              ))}
              {destinoEscolhido && (
                <p className="nota">
                  {destinoEscolhido.impressora}: o arquivo convertido abre no {destinoEscolhido.slicer}.
                  {resumo && resumo.filamentos.length > destinoEscolhido.maxFilamentos
                    ? ` O projeto tem ${resumo.filamentos.length} cores e a impressora usa até ${destinoEscolhido.maxFilamentos}; o relatório indicará o que revisar.`
                    : ""}
                </p>
              )}
            </fieldset>
          )}

          {etapa.tipo === "convertendo" && (
            <div className="progresso" role="status" aria-live="polite">
              <progress value={etapa.fracao} max={1} />
              <span>
                Convertendo… {Math.round(etapa.fracao * 100)}% · {tempo(Math.round((agora - etapa.inicio) / 1000))}. Projetos grandes podem levar alguns minutos;
                deixe esta aba aberta.{" "}
                <button type="button" className="link-botao" onClick={cancelar}>
                  Cancelar
                </button>
              </span>
            </div>
          )}

          {podeEscolherDestino && etapa.tipo !== "convertendo" && (
            <button type="submit" className="botao botao-largo" disabled={!destino || destinoBloqueado}>
              Converter
            </button>
          )}
        </form>
      )}
    </section>
  );
}
