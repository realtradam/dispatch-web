import { describe, expect, it } from "vitest";
import { createLocalStore } from "./index";

function createMemoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear() {
			map.clear();
		},
		getItem(key: string) {
			return map.get(key) ?? null;
		},
		key(index: number) {
			return [...map.keys()][index] ?? null;
		},
		removeItem(key: string) {
			map.delete(key);
		},
		setItem(key: string, value: string) {
			map.set(key, value);
		},
	};
}

describe("createLocalStore", () => {
	it("save then load round-trips an object", () => {
		const storage = createMemoryStorage();
		const store = createLocalStore<{ name: string; count: number }>("test", { storage });

		store.save({ name: "alice", count: 42 });
		const loaded = store.load();

		expect(loaded).toEqual({ name: "alice", count: 42 });
	});

	it("load returns null when key is absent", () => {
		const storage = createMemoryStorage();
		const store = createLocalStore<string>("missing", { storage });

		expect(store.load()).toBeNull();
	});

	it("load returns null on corrupt JSON", () => {
		const storage = createMemoryStorage();
		storage.setItem("corrupt", "{not valid json!!!");
		const store = createLocalStore<object>("corrupt", { storage });

		expect(store.load()).toBeNull();
	});

	it("clear removes the value", () => {
		const storage = createMemoryStorage();
		const store = createLocalStore<string>("key", { storage });

		store.save("hello");
		expect(store.load()).toBe("hello");

		store.clear();
		expect(store.load()).toBeNull();
	});

	it("save swallows a throwing setItem (quota) without throwing", () => {
		const storage = createMemoryStorage();
		const originalSetItem = storage.setItem.bind(storage);
		let callCount = 0;
		storage.setItem = (_key: string, _value: string) => {
			callCount++;
			if (callCount > 1) {
				throw new DOMException("QuotaExceededError", "QuotaExceededError");
			}
			originalSetItem(_key, _value);
		};

		const store = createLocalStore<number[]>("quota", { storage });

		// First save works
		store.save([1, 2, 3]);
		expect(store.load()).toEqual([1, 2, 3]);

		// Second save throws but is swallowed
		expect(() => store.save([4, 5, 6])).not.toThrow();
	});

	it("construction with undefined storage yields a safe no-op store", () => {
		const store = createLocalStore<string>("noop", { storage: undefined });

		// All operations are safe no-ops
		expect(store.load()).toBeNull();
		expect(() => store.save("hello")).not.toThrow();
		expect(() => store.clear()).not.toThrow();
	});

	it("round-trips arrays", () => {
		const storage = createMemoryStorage();
		const store = createLocalStore<number[]>("arr", { storage });

		store.save([1, 2, 3]);
		expect(store.load()).toEqual([1, 2, 3]);
	});

	it("round-trips nested objects", () => {
		const storage = createMemoryStorage();
		const store = createLocalStore<{ a: { b: string[] } }>("nested", { storage });

		store.save({ a: { b: ["x", "y"] } });
		expect(store.load()).toEqual({ a: { b: ["x", "y"] } });
	});

	it("overwrites previous value on repeated save", () => {
		const storage = createMemoryStorage();
		const store = createLocalStore<string>("key", { storage });

		store.save("first");
		store.save("second");
		expect(store.load()).toBe("second");
	});
});
