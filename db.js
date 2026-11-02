// Data layer. One interface, two backends: Supabase (real) and an in-memory demo.

export function supabaseDB(client) {
  const chk = ({ data, error }) => { if (error) throw error; return data; };
  return {
    kind: 'supabase',
    async all(table) {
      let out = [], from = 0;
      for (;;) {
        const data = chk(await client.from(table).select('*').range(from, from + 999));
        out = out.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }
      return out;
    },
    async insert(table, row) { return chk(await client.from(table).insert(row).select().single()); },
    async insertMany(table, rows, conflictKey) {
      if (!rows.length) return [];
      const q = conflictKey
        ? client.from(table).upsert(rows, { onConflict: conflictKey, ignoreDuplicates: true })
        : client.from(table).insert(rows);
      return chk(await q.select());
    },
    async update(table, id, patch, key = 'id') { return chk(await client.from(table).update(patch).eq(key, id).select().single()); },
    async upsert(table, row, key) { return chk(await client.from(table).upsert(row, { onConflict: key }).select().single()); },
    async remove(table, id, key = 'id') { chk(await client.from(table).delete().eq(key, id)); return true; },
    subscribe(onChange) {
      try {
        const ch = client.channel('nest-live');
        for (const t of ['entries', 'goals']) ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, p => onChange(t, p));
        ch.subscribe();
        return () => client.removeChannel(ch);
      } catch (e) { return () => {}; }
    }
  };
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export function memoryDB(seed) {
  const T = {};
  for (const [k, v] of Object.entries(seed)) T[k] = v.map(r => ({ ...r }));
  const keyOf = t => (t === 'categories' || t === 'settings' ? (t === 'settings' ? 'key' : 'id') : 'id');
  return {
    kind: 'demo',
    async all(table) { return (T[table] || []).map(r => ({ ...r })); },
    async insert(table, row) {
      const r = { ...row };
      if (keyOf(table) === 'id' && !r.id) r.id = uuid();
      if (table === 'entries' && !r.created_at) r.created_at = new Date().toISOString();
      (T[table] = T[table] || []).push(r);
      return { ...r };
    },
    async insertMany(table, rows, conflictKey) {
      const out = [];
      for (const row of rows) {
        if (conflictKey && (T[table] || []).some(x => x[conflictKey] && x[conflictKey] === row[conflictKey])) continue;
        out.push(await this.insert(table, row));
      }
      return out;
    },
    async update(table, id, patch, key = 'id') {
      const r = (T[table] || []).find(x => x[key] === id);
      if (!r) throw new Error('not found');
      Object.assign(r, patch);
      return { ...r };
    },
    async upsert(table, row, key) {
      const r = (T[table] || []).find(x => x[key] === row[key]);
      if (r) { Object.assign(r, row); return { ...r }; }
      return this.insert(table, row);
    },
    async remove(table, id, key = 'id') { T[table] = (T[table] || []).filter(x => x[key] !== id); return true; },
    subscribe() { return () => {}; }
  };
}
