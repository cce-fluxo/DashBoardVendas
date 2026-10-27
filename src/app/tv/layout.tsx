import type { Metadata } from "next";
import { Inter, Sofia_Sans } from "next/font/google";

// Pareamento do Figma: Sofia Sans para texto, Inter para número.
const texto = Sofia_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--fonte-texto" });
const numero = Inter({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--fonte-numero" });

export const metadata: Metadata = { title: "Fluxo · TV" };

// Sem sidebar e sem tema escuro: é um painel de parede, lido a 4 metros, e o
// fundo branco é parte da identidade. O fundo cobre a sobra quando a tela não
// é 16:9.
export default function TvLayout({ children }: { children: React.ReactNode }) {
	return (
		<div
			className={`${texto.variable} ${numero.variable}`}
			style={{
				minHeight: "100vh",
				background: "#FFFFFF",
				color: "#111111",
				fontFamily: "var(--fonte-texto), sans-serif",
				overflow: "hidden",
			}}
		>
			{children}
		</div>
	);
}
