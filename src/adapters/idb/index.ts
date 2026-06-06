import type { StoredChunk } from "@dispatch/wire";
import type {
	ConversationCacheIndexEntry,
	ConversationChunkStore,
} from "../../features/conversation-cache";

const DEFAULT_DB_NAME = "dispatch-chunk-cache";
const DB_VERSION = 1;
const CHUNKS_STORE = "chunks";
const META_STORE = "meta";

interface ChunkRecord {
	conversationId: string;
	seq: number;
	role: StoredChunk["role"];
	chunk: StoredChunk["chunk"];
}

interface MetaRecord {
	conversationId: string;
	lastAccess: number;
}

export interface CreateIdbChunkStoreOptions {
	indexedDB?: IDBFactory;
	dbName?: string;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function txComplete(tx: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

function openDb(idb: IDBFactory, dbName: string): Promise<IDBDatabase> {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const req = idb.open(dbName, DB_VERSION);

		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
				const store = db.createObjectStore(CHUNKS_STORE, {
					keyPath: ["conversationId", "seq"],
				});
				store.createIndex("byConversation", "conversationId");
			}
			if (!db.objectStoreNames.contains(META_STORE)) {
				db.createObjectStore(META_STORE, { keyPath: "conversationId" });
			}
		};

		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function keyRangeFor(conversationId: string): IDBKeyRange {
	const lower: [string, number] = [conversationId, 0];
	const upper: [string, number] = [conversationId, Number.POSITIVE_INFINITY];
	return IDBKeyRange.bound(lower, upper);
}

function chunksToStoredChunks(records: ChunkRecord[]): StoredChunk[] {
	return records.map((r) => ({ seq: r.seq, role: r.role, chunk: r.chunk }));
}

export function createIdbChunkStore(opts?: CreateIdbChunkStoreOptions): ConversationChunkStore {
	const idb = opts?.indexedDB ?? globalThis.indexedDB;
	const dbName = opts?.dbName ?? DEFAULT_DB_NAME;

	let dbPromise: Promise<IDBDatabase> | null = null;

	function getDb(): Promise<IDBDatabase> {
		if (dbPromise === null) {
			dbPromise = openDb(idb, dbName);
		}
		return dbPromise;
	}

	return {
		async load(conversationId: string): Promise<readonly StoredChunk[]> {
			const db = await getDb();
			const tx = db.transaction(CHUNKS_STORE, "readonly");
			const store = tx.objectStore(CHUNKS_STORE);
			const range = keyRangeFor(conversationId);
			const records = await requestToPromise<ChunkRecord[]>(store.getAll(range));
			await txComplete(tx);

			records.sort((a, b) => a.seq - b.seq);
			return chunksToStoredChunks(records);
		},

		async append(conversationId: string, chunks: readonly StoredChunk[]): Promise<void> {
			if (chunks.length === 0) return;

			const db = await getDb();
			const tx = db.transaction([CHUNKS_STORE, META_STORE], "readwrite");
			const chunkStore = tx.objectStore(CHUNKS_STORE);
			const metaStore = tx.objectStore(META_STORE);

			for (const c of chunks) {
				chunkStore.put({
					conversationId,
					seq: c.seq,
					role: c.role,
					chunk: c.chunk,
				} satisfies ChunkRecord);
			}

			metaStore.put({
				conversationId,
				lastAccess: Date.now(),
			} satisfies MetaRecord);

			await txComplete(tx);
		},

		async delete(conversationId: string): Promise<void> {
			const db = await getDb();
			const tx = db.transaction([CHUNKS_STORE, META_STORE], "readwrite");
			const chunkStore = tx.objectStore(CHUNKS_STORE);
			const metaStore = tx.objectStore(META_STORE);

			chunkStore.delete(keyRangeFor(conversationId));
			metaStore.delete(conversationId);

			await txComplete(tx);
		},

		async index(): Promise<readonly ConversationCacheIndexEntry[]> {
			const db = await getDb();
			const tx = db.transaction([CHUNKS_STORE, META_STORE], "readonly");
			const chunkStore = tx.objectStore(CHUNKS_STORE);
			const metaStore = tx.objectStore(META_STORE);

			const allChunks = await requestToPromise<ChunkRecord[]>(chunkStore.getAll());
			const allMeta = await requestToPromise<MetaRecord[]>(metaStore.getAll());
			await txComplete(tx);

			const metaMap = new Map<string, number>();
			for (const m of allMeta) {
				metaMap.set(m.conversationId, m.lastAccess);
			}

			const grouped = new Map<string, { chunkCount: number; maxSeq: number }>();
			for (const r of allChunks) {
				const existing = grouped.get(r.conversationId);
				if (existing === undefined) {
					grouped.set(r.conversationId, { chunkCount: 1, maxSeq: r.seq });
				} else {
					existing.chunkCount++;
					if (r.seq > existing.maxSeq) {
						existing.maxSeq = r.seq;
					}
				}
			}

			const result: ConversationCacheIndexEntry[] = [];
			for (const [conversationId, stats] of grouped) {
				const lastAccess = metaMap.get(conversationId);
				result.push({
					conversationId,
					chunkCount: stats.chunkCount,
					maxSeq: stats.maxSeq,
					...(lastAccess !== undefined ? { lastAccess } : {}),
				});
			}

			return result;
		},
	};
}
