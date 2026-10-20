"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// Wrapper do next-themes. Tema padrão CLARO, alternável para escuro pelo header.
// attribute="class" → aplica a classe .dark no <html>, que os tokens do globals.css usam.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
	return (
		<NextThemesProvider
			attribute="class"
			defaultTheme="light"
			enableSystem={false}
			disableTransitionOnChange
		>
			{children}
		</NextThemesProvider>
	);
}
