"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

// Botão de alternância claro/escuro. Evita flash de hidratação só renderizando
// o ícone após montar (o tema real só é conhecido no cliente).
export function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme();
	const [montado, setMontado] = useState(false);

	// eslint-disable-next-line react-hooks/set-state-in-effect -- padrão de next-themes para evitar flash de hidratação.
	useEffect(() => setMontado(true), []);

	const escuro = resolvedTheme === "dark";

	return (
		<button
			onClick={() => setTheme(escuro ? "light" : "dark")}
			aria-label={escuro ? "Ativar tema claro" : "Ativar tema escuro"}
			className="p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors text-muted-foreground"
		>
			{montado && escuro ? <Sun size={16} /> : <Moon size={16} />}
		</button>
	);
}
