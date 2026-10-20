import Image from "next/image";

// Logo que troca conforme o tema, via classes dark: (sem flash de hidratação):
//   - tema claro  → logo-fluxo-preta.png (letra preta, visível no claro)
//   - tema escuro → logo-fluxo.png       (letra branca, visível no escuro)
// A classe .dark é aplicada no <html> pelo next-themes antes da pintura.
export function Logo({ className = "" }: { className?: string }) {
	return (
		<>
			<Image
				src="/logo-fluxo-preta.png"
				alt="Fluxo"
				width={32}
				height={32}
				priority
				className={`block dark:hidden ${className}`}
			/>
			<Image
				src="/logo-fluxo.png"
				alt="Fluxo"
				width={32}
				height={32}
				priority
				className={`hidden dark:block ${className}`}
			/>
		</>
	);
}
