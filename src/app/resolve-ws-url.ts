export interface WsUrlEnv {
	readonly VITE_WS_URL?: string;
	readonly VITE_WS_PORT?: string;
}

export interface WsUrlLocation {
	readonly protocol: string;
	readonly hostname: string;
}

const DEFAULT_PORT = "24205";
const DEFAULT_FALLBACK = "ws://localhost:24205";

export function resolveWsUrl(env: WsUrlEnv, location?: WsUrlLocation): string {
	if (env.VITE_WS_URL !== undefined && env.VITE_WS_URL !== "") {
		return env.VITE_WS_URL;
	}

	if (location === undefined) {
		return DEFAULT_FALLBACK;
	}

	const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
	const port =
		env.VITE_WS_PORT !== undefined && env.VITE_WS_PORT !== "" ? env.VITE_WS_PORT : DEFAULT_PORT;
	return `${wsProtocol}://${location.hostname}:${port}`;
}
