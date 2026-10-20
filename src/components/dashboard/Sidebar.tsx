"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
	LayoutDashboard,
	Users,
	Target,
	Filter,
	ShieldCheck,
} from "lucide-react";
import { Coordenacao } from "@/types";
import { COORD } from "@/lib/colors";

interface SidebarProps {
	coordenacoesAtivas: Coordenacao[];
	onToggleCoordenacao: (coord: Coordenacao) => void;
	gestaoAtual: string;
	periodoAtivo: string;
	isOpen?: boolean;
	onClose?: () => void;
}

const TODAS_COORDS: Coordenacao[] = ["CCE", "ACE", "MNP", "QAB", "PRO"];

const NAV_ITEMS = [
	{ href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
	{ href: "/dashboard/funil", label: "Funil", icon: Filter },
	{ href: "/dashboard/vendedores", label: "Vendedores", icon: Users },
	{ href: "/dashboard/metas", label: "Metas", icon: Target },
	{ href: "/dashboard/auditoria", label: "Auditoria", icon: ShieldCheck },
];

export function Sidebar({
	coordenacoesAtivas,
	onToggleCoordenacao,
	gestaoAtual,
	periodoAtivo,
	isOpen = false,
	onClose,
}: SidebarProps) {
	const pathname = usePathname();

	return (
		<TooltipProvider delayDuration={300}>
			{/* Overlay para mobile */}
			{isOpen && (
				<div
					className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
					onClick={onClose}
				/>
			)}

			<aside
				className={`
        fixed left-0 top-[112px] md:top-16 bottom-0 w-[220px]
        bg-background border-r border-foreground/[0.06]
        flex flex-col gap-6 px-4 py-6
        overflow-y-auto z-50
        transition-transform duration-300 ease-in-out
        ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}
			>
				{/* ── Filtro de coordenação ──────────────────────────── */}
				<div className="flex flex-col gap-3">
					<p className="text-[10px] font-semibold uppercase tracking-widest text-foreground/30">
						Coordenação
					</p>

					<div className="flex flex-col gap-1.5">
						{TODAS_COORDS.map((coord) => {
							const ativa = coordenacoesAtivas.includes(coord);
							const cor = COORD[coord];

							return (
								<button
									key={coord}
									onClick={() => onToggleCoordenacao(coord)}
									className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-150 group relative overflow-hidden ${
										ativa ? "" : "opacity-45 hover:opacity-80"
									}`}
									style={{
										backgroundColor: ativa ? `${cor}12` : "transparent",
										border: `1px solid ${ativa ? `${cor}30` : "var(--border)"}`,
									}}
								>
									{/* Borda esquerda colorida */}
									<div
										className="absolute left-0 top-0 bottom-0 w-0.5 rounded-full transition-all duration-150"
										style={{
											backgroundColor: cor,
											opacity: ativa ? 1 : 0.2,
										}}
									/>

									<div className="flex items-center gap-2.5 pl-1">
										{/* Bolinha colorida */}
										<div
											className="w-2 h-2 rounded-full shrink-0 transition-all duration-150"
											style={{
												backgroundColor: cor,
												opacity: ativa ? 1 : 0.3,
												boxShadow: ativa ? `0 0 6px ${cor}80` : "none",
											}}
										/>
										<span
											className="text-sm font-medium transition-all duration-150"
											style={{ color: ativa ? cor : "var(--muted-foreground)" }}
										>
											{coord}
										</span>
									</div>

									{/* Toggle pill */}
									<div
										className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all duration-150"
										style={{
											backgroundColor: ativa
												? `${cor}20`
												: "var(--muted)",
											color: ativa ? cor : "var(--muted-foreground)",
										}}
									>
										<div
											className="w-1 h-1 rounded-full"
											style={{
												backgroundColor: ativa ? cor : "var(--muted-foreground)",
											}}
										/>
										{ativa ? "ativo" : "oculto"}
									</div>
								</button>
							);
						})}
					</div>
				</div>

				{/* Divisor */}
				<div className="h-px bg-foreground/[0.06]" />

				{/* ── Navegação ─────────────────────────────────────── */}
				<div className="flex flex-col gap-3">
					<p className="text-[10px] font-semibold uppercase tracking-widest text-foreground/30">
						Navegação
					</p>

					<nav className="flex flex-col gap-1">
						{NAV_ITEMS.map(({ href, label, icon: Icon }) => {
							const ativo = pathname === href;
							return (
								<Link
									key={href}
									href={href}
									className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150"
									style={{
										backgroundColor: ativo ? "#F5833220" : "transparent",
										color: ativo ? "#F58332" : "var(--muted-foreground)",
										border: `1px solid ${ativo ? "#F5833230" : "transparent"}`,
									}}
								>
									<Icon size={15} strokeWidth={ativo ? 2 : 1.5} />
									{label}
								</Link>
							);
						})}
					</nav>
				</div>

				{/* Divisor */}
				<div className="h-px bg-foreground/[0.06]" />

				{/* ── Período ativo ──────────────────────────────────── */}
				<div className="flex flex-col gap-2 px-3 py-3 rounded-xl bg-foreground/[0.03] border border-foreground/[0.06]">
					<p className="text-[10px] uppercase tracking-widest text-foreground/30">
						Período ativo
					</p>
					<p className="text-base font-semibold text-foreground">
						Gestão {gestaoAtual}
					</p>
					<p className="text-xs text-foreground/40">{periodoAtivo}</p>
				</div>
			</aside>
		</TooltipProvider>
	);
}
