# Rule: pure core / injected shell (frontend)

Decision logic — reducers, view-models, formatters, parsers — is pure
(input → output): NO DOM, NO `fetch`/WebSocket, NO Svelte import. Put it in a
`.ts` module that tests with zero mounting and zero mocks. Effects (socket, fetch,
IndexedDB, clock) are INJECTED at the edges (props or an adapter). This is for
testability, not purity dogma — stop where it would only add ceremony.
