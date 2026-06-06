export interface LocalStore<T> {
	load(): T | null;
	save(value: T): void;
	clear(): void;
}

export interface CreateLocalStoreOptions {
	storage?: Storage | undefined;
}

function createNoopStore<T>(): LocalStore<T> {
	return {
		load() {
			return null;
		},
		save() {},
		clear() {},
	};
}

export function createLocalStore<T>(key: string, opts?: CreateLocalStoreOptions): LocalStore<T> {
	let storage: Storage | undefined;
	if (opts !== undefined && "storage" in opts) {
		storage = opts.storage;
	} else {
		storage = globalThis.localStorage;
	}

	if (storage === undefined || storage === null) {
		return createNoopStore<T>();
	}

	return {
		load(): T | null {
			try {
				const raw = storage.getItem(key);
				if (raw === null) {
					return null;
				}
				return JSON.parse(raw) as T;
			} catch {
				return null;
			}
		},

		save(value: T): void {
			try {
				storage.setItem(key, JSON.stringify(value));
			} catch {
				// Swallow quota / write errors — persistence is best-effort.
			}
		},

		clear(): void {
			storage.removeItem(key);
		},
	};
}
