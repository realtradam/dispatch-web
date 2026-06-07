# Rule: styling is DaisyUI v5 + the dracula theme (UI units only)

The global stylesheet already enables **DaisyUI v5** with the **dracula** theme
(`data-theme` on `<html>`). Do NOT add or change theme config, re-import Tailwind/DaisyUI,
or hand-roll a design system — just apply DaisyUI / Tailwind utility classes in your
`.svelte` files (e.g. `select`, `textarea`, `btn btn-primary`, `tabs`, `chat chat-start` /
`chat-end` + `chat-bubble`).

Keep components THIN: a `.svelte` file wires props/events to pure logic and applies classes
— it holds NO business logic (that stays in `logic/` / the reducer). Render plain semantic
HTML decorated with classes. biome lints `.ts`/`.js` only; `.svelte` correctness is
`svelte-check`'s job.
