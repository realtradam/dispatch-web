# Rule: no ambient state (frontend)

State is owned per-unit and passed explicitly. NO module-global mutable store
reached from everywhere — that is the old FE's "tools leak across tabs" /
"model resets on tab switch" bug class. Svelte runes (`$state`) are a THIN
reactive wrapper over a pure reducer, never the home of logic. Subscriptions are
owned and disposed on unmount (no orphaned or duplicate subscriptions).
