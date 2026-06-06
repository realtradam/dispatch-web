export interface HttpUrlEnv {
	readonly VITE_HTTP_URL?: string;
	readonly VITE_HTTP_PORT?: string;
}

export interface HttpUrlLocation {
	readonly protocol: string;
	readonly hostname: string;
}

const DEFAULT_PORT = "24203";
const DEFAULT_FALLBACK = "http://localhost:24203";

export function resolveHttpUrl(env: HttpUrlEnv, location?: HttpUrlLocation): string {
	if (env.VITE_HTTP_URL !== undefined && env.VITE_HTTP_URL !== "") {
		return env.VITE_HTTP_URL;
	}

	if (location === undefined) {
		return DEFAULT_FALLBACK;
	}

	const port =
		env.VITE_HTTP_PORT !== undefined && env.VITE_HTTP_PORT !== ""
			? env.VITE_HTTP_PORT
			: DEFAULT_PORT;
	return `${location.protocol}//${location.hostname}:${port}`;
}
