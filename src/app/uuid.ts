const HEX = "0123456789abcdef";

function hexChar(n: number): string {
	return HEX.charAt(n & 0xf);
}

function hexFromBytes(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i] as number;
		out += hexChar(b >> 4);
		out += hexChar(b);
	}
	return out;
}

function formatV4(rand: Uint8Array): string {
	const h = hexFromBytes(rand);
	return (
		h.slice(0, 8) +
		"-" +
		h.slice(8, 12) +
		"-4" +
		h.slice(13, 16) +
		"-" +
		((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") +
		h.slice(18, 20) +
		"-" +
		h.slice(20, 32)
	);
}

function uuidFromGetRandomValues(): string {
	const buf = new Uint8Array(16);
	crypto.getRandomValues(buf);
	buf[6] = ((buf[6] as number) & 0x0f) | 0x40;
	buf[8] = ((buf[8] as number) & 0x3f) | 0x80;
	return formatV4(buf);
}

function uuidFromMathRandom(): string {
	let s = "";
	for (let i = 0; i < 36; i++) {
		if (i === 8 || i === 13 || i === 18 || i === 23) {
			s += "-";
		} else if (i === 14) {
			s += "4";
		} else if (i === 19) {
			s += hexChar(Math.floor(Math.random() * 4) + 8);
		} else {
			s += hexChar(Math.floor(Math.random() * 16));
		}
	}
	return s;
}

export function randomId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
		return uuidFromGetRandomValues();
	}
	return uuidFromMathRandom();
}
