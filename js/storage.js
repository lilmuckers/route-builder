const DB_NAME = 'path-tracer';
const DB_VERSION = 1;

let db;

async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('routes')) {
        const store = d.createObjectStore('routes', { keyPath: 'id' });
        store.createIndex('startTime', 'startTime');
      }
      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveRoute(route) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('routes', 'readwrite');
    tx.objectStore('routes').put(route);
    tx.oncomplete = () => resolve(route.id);
    tx.onerror = e => reject(e.target.error);
  });
}

export async function getRoute(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('routes', 'readonly');
    const req = tx.objectStore('routes').get(id);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function getAllRoutes() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('routes', 'readonly');
    const req = tx.objectStore('routes').getAll();
    req.onsuccess = e => resolve(e.target.result ?? []);
    req.onerror = e => reject(e.target.error);
  });
}

export async function deleteRoute(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('routes', 'readwrite');
    tx.objectStore('routes').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

export async function getSetting(key) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(key);
    req.onsuccess = e => resolve(e.target.result?.value ?? null);
    req.onerror = e => reject(e.target.error);
  });
}

export async function setSetting(key, value) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}
