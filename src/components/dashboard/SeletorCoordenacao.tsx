"use client";

import { CoordenacaoOuND } from "@/types";

// ─── Configuração visual ───────────────────────────────────────────

const OPCOES: { valor: CoordenacaoOuND; label: string }[] = [
	{ valor: "CCE", label: "CCE" },
	{ valor: "ACE", label: "ACE" },
	{ valor: "MNP", label: "MNP" },
	{ valor: "QAB", label: "QAB" },
	{ valor: "PRO", label: "PRO" },
];

interface SeletorCoordenacaoProps {
	valor: CoordenacaoOuND;
	onChange: (coord: CoordenacaoOuND) => void;
	/**
	 * Quais coordenações este seletor pode oferecer. Omitido = todas.
	 *
	 * Existe porque a barra lateral passou a recortar o funil: oferecer aqui uma
	 * coordenação que a lateral excluiu abriria um card de zeros, e "zero" leria
	 * como desempenho nulo em vez de "fora do recorte" — a mesma confusão que
	 * `naoInstrumentada` resolve no funil.
	 */
	disponiveis?: CoordenacaoOuND[];
}

export function SeletorCoordenacao({
	valor,
	onChange,
	disponiveis,
}: SeletorCoordenacaoProps) {
	const opcoes = disponiveis
		? OPCOES.filter((o) => disponiveis.includes(o.valor))
		: OPCOES;

	return (
		<div className="flex items-center gap-1.5 flex-wrap">
			{opcoes.map((opcao) => {
				const ativo = opcao.valor === valor;
				return (
					<button
						key={opcao.valor}
						onClick={() => onChange(opcao.valor)}
						className={`
              px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150
              ${
								ativo
									? "bg-foreground/10 border-foreground/30 text-foreground"
									: "bg-transparent border-foreground/10 text-foreground/40 hover:text-foreground/70 hover:border-foreground/20"
							}
            `}
					>
						{opcao.label}
					</button>
				);
			})}
		</div>
	);
}
