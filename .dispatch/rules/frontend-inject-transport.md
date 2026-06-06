# Rule: inject the transport; parsers are pure

The WS/NDJSON framing + parsing is a PURE function (bytes/messages → typed events);
the socket/fetch is INJECTED. Test the parser with crafted chunk inputs (and
trace-replay-style fixtures), never a live connection. The op-protocol core is a
pure state machine: `reduce(intent, incoming) → { viewModel, outgoingCommands }`;
the carrier (WebSocket) is the injected shell.
