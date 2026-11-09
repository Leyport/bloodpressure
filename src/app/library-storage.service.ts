import { Injectable } from '@angular/core';
import { LibraryItem } from './library.model';

const DB_NAME = 'bp_library';
const STORE = 'items';

/** Stores uploaded appointments, documents and spreadsheets locally in IndexedDB. */
@Injectable({ providedIn: 'root' })
export class LibraryStorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async list(): Promise<LibraryItem[]> {
    const items = await this.run<LibraryItem[]>('readonly', s => s.getAll());
    return items.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  async put(item: LibraryItem): Promise<void> {
    await this.run('readwrite', s => s.put(item));
  }

  async delete(id: string): Promise<void> {
    await this.run('readwrite', s => s.delete(id));
  }
}
