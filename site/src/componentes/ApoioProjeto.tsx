import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { payloadPix } from "../servicos/pix";
import type { Doacao } from "../servicos/formatos";

const SUGESTOES = [5, 10, 20];
const MAXIMO = 1000;

/** QR Code desenhado em SVG a partir da matriz (sem HTML gerado por terceiros). */
function QrCode({ texto, rotulo }: { texto: string; rotulo: string }) {
  const matriz = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    const caminho: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) caminho.push(`M${c + 4} ${r + 4}h1v1h-1z`);
    return { n: n + 8, d: caminho.join("") };
  }, [texto]);
  return (
    <svg className="qr-pix" viewBox={`0 0 ${matriz.n} ${matriz.n}`} role="img" aria-label={rotulo} shapeRendering="crispEdges">
      <rect width={matriz.n} height={matriz.n} fill="#fff" />
      <path d={matriz.d} fill="#000" />
    </svg>
  );
}

function textoValor(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Doação voluntária para manter o projeto: Pix (QR e "copia e cola", com valor opcional) e/ou link
 * para uma plataforma de apoio. O pagamento acontece no app do banco ou no site externo; nada de
 * pagamento passa por aqui e nada é registrado.
 */
export function ApoioProjeto({ doacao }: { doacao: Doacao }) {
  const [valor, setValor] = useState<number | null>(10);
  const [outro, setOutro] = useState("");
  const [copiado, setCopiado] = useState(false);

  const codigo = useMemo(
    () => (doacao.pix ? payloadPix({ chave: doacao.pix.chave, nome: doacao.pix.nome, cidade: doacao.pix.cidade, valor }) : null),
    [doacao.pix, valor],
  );

  function escolher(v: number | null) {
    setValor(v);
    setOutro("");
    setCopiado(false);
  }

  function digitar(texto: string) {
    const limpo = texto.replace(/[^\d,]/g, "").slice(0, 7);
    setOutro(limpo);
    setCopiado(false);
    const n = Number(limpo.replace(",", "."));
    setValor(Number.isFinite(n) && n >= 1 && n <= MAXIMO ? Math.round(n * 100) / 100 : null);
  }

  async function copiar() {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  const hostLink = (() => {
    try {
      return doacao.link ? new URL(doacao.link).host.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();

  return (
    <section className="apoio" aria-labelledby="titulo-apoio">
      <h2 id="titulo-apoio">Apoie o projeto</h2>
      <p>
        O conversor é gratuito. Se ele te ajudou, uma doação ajuda a pagar a hospedagem e o domínio. É totalmente opcional e não muda
        nada no seu uso.
      </p>
      {doacao.pix && codigo && (
        <div className="apoio-pix">
          <div className="apoio-valores" role="group" aria-label="Valor da doação">
            {SUGESTOES.map((v) => (
              <button
                key={v}
                type="button"
                className={`botao botao-pequeno ${valor === v && !outro ? "" : "botao-secundario"}`}
                aria-pressed={valor === v && !outro}
                onClick={() => escolher(v)}
              >
                {textoValor(v)}
              </button>
            ))}
            <label className="apoio-outro">
              <span>Outro valor (R$)</span>
              <input inputMode="decimal" value={outro} onChange={(e) => digitar(e.target.value)} placeholder="ex.: 15" aria-label="Outro valor em reais" />
            </label>
            <button type="button" className={`botao botao-pequeno ${valor === null && !outro ? "" : "botao-secundario"}`} onClick={() => escolher(null)}>
              Escolher no banco
            </button>
          </div>
          {outro && valor === null && <p className="nota">Digite um valor entre R$ 1 e R$ {MAXIMO}.</p>}
          <div className="apoio-codigo">
            <QrCode texto={codigo} rotulo={`QR Code do Pix${valor ? ` de ${textoValor(valor)}` : ""}`} />
            <div>
              <p>
                <strong>{valor ? `Pix de ${textoValor(valor)}` : "Pix (valor à sua escolha)"}</strong> para {doacao.pix.nome}. Leia o QR Code
                no app do banco ou copie o código:
              </p>
              <code className="apoio-copia-cola">{codigo}</code>
              <button type="button" className="botao botao-pequeno" onClick={() => void copiar()}>
                {copiado ? "Copiado!" : "Copiar código Pix"}
              </button>
              <p className="nota">Chave Pix: {doacao.pix.chave}</p>
            </div>
          </div>
        </div>
      )}
      {doacao.link && hostLink && (
        <p>
          <a className="botao botao-secundario botao-pequeno" href={doacao.link} target="_blank" rel="noopener noreferrer">
            Apoiar pelo {hostLink}
          </a>
        </p>
      )}
    </section>
  );
}
