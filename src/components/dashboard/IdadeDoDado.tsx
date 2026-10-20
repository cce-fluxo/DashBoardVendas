"use client";

import type { DashboardData } from "@/types";

/**
 * Há quanto tempo a FONTE foi lida — não há quanto tempo a página abriu.
 *
 * O rótulo anterior era "Atualizado {agora}", com bolinha verde pulsando. Ele
 * mostrava a hora da requisição, então dizia "atualizado agora" mesmo com o
 * agendador parado havia dez horas. A bolinha verde reforçava a mentira.
 *
 * Nenhum agendador externo é confiável: o do GitHub Actions documenta que pode
 * atrasar e DESCARTAR execuções em horário de pico, e foi o que aconteceu — 64%
 * das rodadas de agosto nunca ocorreram. Não dá para garantir que a carga
 * aconteça; dá para garantir que a tela não minta sobre ela.
 */
export function IdadeDoDado({
	ultimaAtualizacao,
	fonteMaisAtrasada,
	frescor,
	dadoVelho,
}: {
	ultimaAtualizacao?: string | null;
	fonteMaisAtrasada?: string | null;
	frescor?: DashboardData["frescor"];
	dadoVelho?: boolean;
}) {
	if (!ultimaAtualizacao) {
		return (
			<div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
				<div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
				<span className="hidden lg:block">Sem carga registrada</span>
			</div>
		);
	}

	const minutos = Math.max(
		0,
		// eslint-disable-next-line react-hooks/purity -- a idade é recalculada a cada render de propósito; sem relógio, ela congelaria.
		Math.floor((Date.now() - new Date(ultimaAtualizacao).getTime()) / 60000),
	);

	const quando =
		minutos < 2
			? "agora"
			: minutos < 60
				? `há ${minutos} min`
				: minutos < 60 * 48
					? `há ${Math.floor(minutos / 60)}h`
					: `há ${Math.floor(minutos / 1440)} dias`;

	// O tooltip abre o quadro inteiro: o rótulo mostra só a fonte mais atrasada,
	// e quem quiser conferir as outras não deveria precisar de outra tela.
	const detalhe = (frescor ?? [])
		.map((f) => {
			const idade =
				f.horasDesdeAUltima == null
					? "nunca carregada"
					: f.horasDesdeAUltima < 1
						? `${Math.round(f.horasDesdeAUltima * 60)} min`
						: `${f.horasDesdeAUltima.toFixed(1)}h`;
			return `${f.nome}: ${idade}${f.atraso > 1 ? " — ATRASADA" : ""}`;
		})
		.join("\n");

	return (
		<div
			className={`flex items-center gap-1.5 text-xs ${
				dadoVelho ? "text-amber-600 dark:text-amber-400" : "text-foreground/30"
			}`}
			title={detalhe}
		>
			{/* Pulsa só quando o dado é recente. Animação em dado velho comunica
			    atividade que não existe. */}
			<div
				className={`w-1.5 h-1.5 rounded-full ${
					dadoVelho ? "bg-amber-500" : "bg-emerald-400 animate-pulse"
				}`}
			/>
			{/* Nomear a fonte é o que torna o aviso acionável. "Dado de há 6h" não
			    diz o que fazer; "Pipefy · há 5h" diz onde olhar — e evita que a
			    planilha, que sincroniza uma vez por dia e por isso vive com horas de
			    idade, seja confundida com um problema. */}
			<span className="hidden lg:block">
				{fonteMaisAtrasada ? `${fonteMaisAtrasada} · ` : ""}
				{quando}
			</span>
		</div>
	);
}
