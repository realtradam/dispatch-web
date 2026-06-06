# Rule: the surface interpreter is generic

The surface interpreter switches on field KINDS (toggle/progress/selector/stat/
button/custom), NEVER on a surface id. An `if (surface.id === "...")` imports a
feature's identity into the platform and breaks isolation (guardrail 1). An
unknown field `kind` or a `custom` `rendererId` with no registered renderer →
GRACEFUL SKIP, never a crash. Render from the spec; the backend owns what a
surface contains.
