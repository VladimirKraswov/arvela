export interface ProjectScope { hub: string; server: string; directory: string }
export interface Binding { key: string; projectID: string; title: string; revision: number }
export const projectKey = (scope: ProjectScope) => JSON.stringify([scope.hub, scope.server, scope.directory]);
export const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export class ProjectBindings {
  private database?: Promise<IDBDatabase>;
  constructor(private name = 'arvela.project-memory.v1', private factory: IDBFactory | undefined = globalThis.indexedDB) {}
  close() { void this.database?.then(db => db.close()).catch(() => {}); this.database = undefined; }
  private open() {
    if (!this.factory) return Promise.reject<IDBDatabase>(Error('Хранилище проектов недоступно. Привязка не сохранена.'));
    if (!this.database) this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const q = this.factory!.open(this.name, 1); let settled = false;
      const timer = setTimeout(() => { settled = true; reject(Error('Хранилище проектов не отвечает.')); }, 5000);
      q.onupgradeneeded = () => q.result.createObjectStore('bindings', { keyPath: 'key' });
      q.onsuccess = () => { clearTimeout(timer); if (settled) { q.result.close(); return; } settled = true; q.result.onversionchange = () => this.close(); resolve(q.result); };
      q.onerror = q.onblocked = () => { clearTimeout(timer); settled = true; reject(Error('Закройте другое окно Arvela и повторите сохранение.')); };
    }).catch(e => { this.database = undefined; throw e; });
    return this.database;
  }
  async list(): Promise<Binding[]> {
    const db = await this.open(); return new Promise((resolve, reject) => {
      const tx = db.transaction('bindings', 'readonly'), q = tx.objectStore('bindings').getAll(); let rows: Binding[] = [];
      q.onsuccess = () => { rows = q.result; };
      tx.oncomplete = () => {
        if (rows.length > 200 || rows.some(r => !uuid(r.projectID) || !Number.isSafeInteger(r.revision) || r.revision < 1 || typeof r.key !== 'string' || typeof r.title !== 'string')) reject(Error('Привязки проектов повреждены; исходные данные сохранены.'));
        else resolve(rows);
      };
      tx.onabort = tx.onerror = () => reject(Error('Не удалось прочитать привязки проектов.'));
    });
  }
  async get(scope: ProjectScope) { return (await this.list()).find(row => row.key === projectKey(scope)) ?? null; }
  async bind(scope: ProjectScope, projectID: string, title: string, expected: number | null) {
    if (!scope.directory || !scope.hub || !scope.server || !uuid(projectID) || !title.trim() || title.length > 80) throw Error('Укажите папку и переносимый проект.');
    const key = projectKey(scope), db = await this.open();
    return new Promise<Binding>((resolve, reject) => {
      const tx = db.transaction('bindings', 'readwrite'), s = tx.objectStore('bindings'), q = s.get(key), count = s.count();
      let got = false, old: Binding | undefined, total: number | undefined, saved: Binding | undefined, error = 'Не удалось сохранить привязку.';
      const apply = () => { if (!got || total === undefined) return;
        if ((old?.revision ?? null) !== expected) { error = 'Привязка изменена в другом окне. Перечитайте проект.'; tx.abort(); return; }
        if (!old && total >= 200) { error = 'Достигнут предел 200 локальных привязок.'; tx.abort(); return; }
        saved = { key, projectID, title, revision: (old?.revision ?? 0) + 1 }; s.put(saved);
      };
      q.onsuccess = () => { old = q.result; got = true; apply(); }; count.onsuccess = () => { total = count.result; apply(); };
      tx.oncomplete = () => { if (saved) resolve(saved); else reject(Error(error)); };
      tx.onabort = tx.onerror = () => reject(Error(error));
    });
  }
}
export const projects = new ProjectBindings();
