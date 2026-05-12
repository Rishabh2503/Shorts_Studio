/**
 * Hand-rolled IndexedDB key-value store. Used for autosaving the project
 * state so a refresh / accidental close doesn't lose work.
 *
 * We deliberately avoid pulling in `idb-keyval` (adds another dep) \u2014 the
 * surface area we need is tiny and IDB's promise wrapping is straightforward.
 *
 * Storage layout:
 *   DB name : shorts-studio
 *   Store   : kv  (out-of-line keys, string)
 *
 * Why IndexedDB and not localStorage?
 *   - localStorage is sync (blocks the main thread) and capped at ~5 MB.
 *   - We may eventually store image blobs / audio blobs here, which require
 *     IDB's binary support and quota (typically hundreds of MB).
 */

const DB_NAME = 'shorts-studio';
const STORE_NAME = 'kv';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // If the connection is closed by another tab upgrading, drop the cached
    // promise so the next caller reopens cleanly instead of getting a
    // broken handle.
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB upgrade blocked by another tab'));
    };
  });
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDB();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // Private-mode browsers / quota exceeded / corrupt DB \u2014 fail soft
    // and let the caller fall through to the default project.
    console.warn('[idb] get failed', err);
    return undefined;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[idb] set failed', err);
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[idb] delete failed', err);
  }
}
