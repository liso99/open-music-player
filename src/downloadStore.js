const DB_NAME = 'open-music-downloads';
const STORE_NAME = 'tracks';
const VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = work(store);
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function saveDownload(key, track, blob) {
  await withStore('readwrite', (store) => store.put({
    key,
    track,
    blob,
    createdAt: Date.now(),
  }));
}

export async function listDownloads() {
  const items = await withStore('readonly', (store) => store.getAll());
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteDownload(key) {
  await withStore('readwrite', (store) => store.delete(key));
}

export async function hasDownload(key) {
  const item = await withStore('readonly', (store) => store.get(key));
  return Boolean(item);
}
