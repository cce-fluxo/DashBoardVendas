"use client";

// src/components/dashboard/Exportavel.tsx
//
// Card que sabe virar imagem.
//
// Substitui o wrapper `<div className="bg-card …">` repetido em cada seção. A
// aparência na tela é a mesma; o que muda é que o cabeçalho ganha um botão e a
// imagem ganha um rodapé que só existe nela.
//
// O RODAPÉ SÓ APARECE NA IMAGEM
//
// Na tela, período e coordenação estão no selo e na barra lateral — repeti-los
// dentro do card seria ruído. Fora da tela não há barra lateral nenhuma, então
// a coordenação e a idade do dado precisam viajar junto. O rodapé é montado no
// instante da captura e desmontado logo depois.
//
// Ver src/lib/exportar/legenda.ts para o porquê de cada linha da legenda, e
// src/lib/exportar/imagem.ts para o porquê de capturar o DOM.

import { useCallback, useRef, useState } from "react";
import { Download, Loader2, AlertCircle } from "lucide-react";
import { BadgePeriodo } from "@/components/dashboard/FunnelChartV2";
import {
	ContextoExport,
	legendaDaImagem,
	nomeDoArquivo,
} from "@/lib/exportar/legenda";
import { MARCA_OCULTAR, baixar, gerarPng } from "@/lib/exportar/imagem";

type Estado = "parado" | "gerando" | "erro";

function BotaoExportar({
	estado,
	onClick,
}: {
	estado: Estado;
	onClick: () => void;
}) {
	// `data-export="ocultar"`: o botão não entra na própria imagem.
	return (
		<button
			data-export={MARCA_OCULTAR}
			onClick={onClick}
			disabled={estado === "gerando"}
			title={
				estado === "erro"
					? "Não foi possível gerar a imagem — tente de novo"
					: "Baixar como imagem (PNG)"
			}
			aria-label="Baixar este gráfico como imagem"
			className={`p-1.5 rounded-lg transition-colors ${
				estado === "erro"
					? "text-red-500 hover:bg-red-500/10"
					: "text-foreground/30 hover:text-foreground/70 hover:bg-foreground/[0.06]"
			} disabled:cursor-wait`}
		>
			{estado === "gerando" ? (
				<Loader2 size={14} className="animate-spin" />
			) : estado === "erro" ? (
				<AlertCircle size={14} />
			) : (
				<Download size={14} />
			)}
		</button>
	);
}

/**
 * Rodapé de procedência. Discreto de propósito: ele não disputa atenção com o
 * gráfico, só impede que a imagem seja lida fora do recorte que a produziu.
 */
function RodapeDaImagem({ contexto }: { contexto: ContextoExport }) {
	const { recorte, procedencia } = legendaDaImagem(contexto);
	return (
		<div className="mt-1 pt-2.5 border-t border-foreground/[0.08] flex items-center justify-between gap-4 text-[10px] leading-none">
			<span className="text-foreground/50 font-medium">{recorte}</span>
			<span className="text-foreground/30 text-right">{procedencia}</span>
		</div>
	);
}

export function Exportavel({
	contexto,
	subtitulo,
	acoes,
	semSelo,
	className,
	children,
}: {
	contexto: ContextoExport;
	subtitulo?: string;
	/** Controles próprios da seção (um seletor, um aviso), à esquerda do selo. */
	acoes?: React.ReactNode;
	/** Para seções que já mostram o período por outro meio. */
	semSelo?: boolean;
	className?: string;
	children: React.ReactNode;
}) {
	const alvo = useRef<HTMLDivElement>(null);
	const [estado, setEstado] = useState<Estado>("parado");

	const exportar = useCallback(async () => {
		setEstado("gerando");
		try {
			// O rodapé acabou de ser montado por `setEstado`. Sem esperar a pintura,
			// a captura pega o quadro anterior — a imagem sairia sem a legenda, que
			// é justamente a parte que não dá para conferir olhando a tela.
			//
			// O prazo existe porque `requestAnimationFrame` NÃO dispara em aba
			// oculta: clicar e trocar de aba deixava a promessa pendurada para
			// sempre, com o botão girando e nenhum erro em lugar nenhum. Com o
			// prazo, o pior caso é a captura sair um quadro antes — o commit do
			// React já aconteceu, então o rodapé está no DOM de qualquer forma.
			await Promise.race([
				new Promise<void>((r) =>
					requestAnimationFrame(() => requestAnimationFrame(() => r())),
				),
				new Promise<void>((r) => setTimeout(r, 120)),
			]);
			const no = alvo.current;
			if (!no) throw new Error("nó de captura ausente");
			baixar(await gerarPng(no), nomeDoArquivo(contexto));
			setEstado("parado");
		} catch (err) {
			// Falha silenciosa aqui é indistinguível de "o navegador bloqueou o
			// download": o botão precisa acusar.
			console.error("[Exportar imagem]", err);
			setEstado("erro");
		}
	}, [contexto]);

	return (
		<div
			ref={alvo}
			className={
				className ??
				"bg-card border border-foreground/[0.08] rounded-xl p-5 md:p-6 flex flex-col gap-4"
			}
		>
			<div className="flex items-center justify-between flex-wrap gap-2">
				<div className="flex flex-col gap-0.5 min-w-0">
					<h3 className="text-sm md:text-base font-semibold text-foreground">
						{contexto.titulo}
					</h3>
					{subtitulo && (
						<p className="text-xs text-foreground/40">{subtitulo}</p>
					)}
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{acoes}
					{!semSelo && <BadgePeriodo periodo={contexto.periodo} />}
					<BotaoExportar estado={estado} onClick={exportar} />
				</div>
			</div>

			{children}

			{estado === "gerando" && <RodapeDaImagem contexto={contexto} />}
		</div>
	);
}
