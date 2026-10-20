// src/lib/exportar/imagem.ts
//
// Transforma um pedaço da tela em PNG.
//
// POR QUE CAPTURAR O DOM E NÃO DESENHAR A IMAGEM NO SERVIDOR
//
// A alternativa era gerar a imagem por fora (Satori/ImageResponse), com um
// layout próprio. Seriam DUAS renderizações do mesmo funil, e elas divergiriam:
// a imagem passaria a mostrar um gráfico que o dashboard nunca mostrou, e o
// bug só apareceria no slide de outra pessoa. É a mesma armadilha das sete
// cópias do calendário — só que numa cópia que ninguém revisa.
//
// Capturando o nó que já está na tela existe um renderizador só. O que você vê
// é o que sai, incluindo o tema: exportar claro quando a tela está escura seria
// uma terceira versão da verdade.
//
// html-to-image clona o nó dentro de um <foreignObject> e deixa o PRÓPRIO
// navegador rasterizar — por isso não precisa reimplementar CSS (a rota do
// html2canvas, que quebra em cores modernas e em variáveis).

import { toPng } from "html-to-image";

/** Elementos marcados assim somem da imagem (o botão de exportar, por exemplo). */
export const MARCA_OCULTAR = "ocultar";

function fundoOpaco(no: HTMLElement): string {
	const bg = getComputedStyle(no).backgroundColor;
	// PNG com fundo transparente vira um bloco de texto ilegível quando colado
	// sobre um slide escuro. Se o card não declara cor própria, herda a do corpo.
	if (bg && bg !== "transparent" && !bg.startsWith("rgba(0, 0, 0, 0)")) return bg;
	return getComputedStyle(document.body).backgroundColor || "#ffffff";
}

/**
 * Prazo máximo. html-to-image espera um `requestAnimationFrame` por dentro, e
 * rAF NÃO dispara em aba oculta: quem clicasse e trocasse de aba ficava com o
 * botão girando para sempre, sem erro em lugar nenhum. Falha visível é melhor
 * que espera infinita — o prazo é o que transforma uma na outra.
 */
const PRAZO_MS = 30_000;

export async function gerarPng(no: HTMLElement): Promise<string> {
	const captura = toPng(no, {
		// 2× para o texto não sair borrado ao projetar ou imprimir.
		pixelRatio: 2,
		backgroundColor: fundoOpaco(no),
		cacheBust: true,
		filter: (alvo) =>
			!(
				alvo instanceof HTMLElement && alvo.dataset.export === MARCA_OCULTAR
			),
	});

	let prazo: ReturnType<typeof setTimeout>;
	const estouro = new Promise<never>((_, rejeitar) => {
		prazo = setTimeout(
			() =>
				rejeitar(
					new Error(
						"a geração da imagem não respondeu — a aba precisa estar visível",
					),
				),
			PRAZO_MS,
		);
	});

	try {
		return await Promise.race([captura, estouro]);
	} finally {
		clearTimeout(prazo!);
	}
}

export function baixar(dataUrl: string, nomeArquivo: string): void {
	const link = document.createElement("a");
	link.href = dataUrl;
	link.download = nomeArquivo;
	link.rel = "noopener";
	document.body.appendChild(link);
	link.click();
	link.remove();
}
