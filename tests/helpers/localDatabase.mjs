import { createRequire } from 'node:module';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function useGracefulWindowsShutdown(pg, databaseDir, runtime) {
  if (process.platform !== 'win32') return;
  const { pg_ctl } = await import(pathToFileURL(runtime.resolve('@embedded-postgres/windows-x64')).href);
  let stopped = false;
  // Override the public stop method so the wrapper's own exit hook is idempotent
  // too. pg_ctl waits for all PostgreSQL workers; taskkill can orphan a worker.
  pg.stop = async () => {
    if (stopped) return;
    await promisify(execFile)(pg_ctl, ['stop', '-D', databaseDir, '-m', 'fast', '-w', '-t', '10'],
      { windowsHide: true, timeout: 15_000 });
    stopped = true;
  };
}

// This helper cannot connect to a remote URL. All identities and clock controls
// exist only inside a fresh loopback-only test cluster.
export async function withLocalDatabase(run) {
  const runtime = createRequire(resolve('.expo/weekly-sql-tests/package.json'));
  const { default: EmbeddedPostgres } = await import(pathToFileURL(runtime.resolve('embedded-postgres')).href);
  const server = net.createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  const databaseDir = await mkdtemp(resolve('.expo/weekly-sql-tests/scheduling-'));
  assert.ok(databaseDir.startsWith(resolve('.expo/weekly-sql-tests') + sep));
  const pg = new EmbeddedPostgres({ databaseDir, port, user: 'postgres', password: randomUUID(),
    persistent: true, postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
  const clients = [];
  let started = false;
  const connect = async (userId = null, role = null, now = '2026-09-27T15:00:00Z') => {
    const client = pg.getPgClient(); clients.push(client); await client.connect();
    if (role) await client.query(`set role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub',$1,false),set_config('test.now',$2,false)", [userId ?? '', now]);
    return client;
  };
  try {
    await pg.initialise(); await pg.start(); started = true;
    await useGracefulWindowsShutdown(pg, databaseDir, runtime);
    const admin = await connect();
    await admin.query(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    const apply = async (file) => admin.query(await readFile(join('supabase/migrations', file), 'utf8'));
    await run({ admin, connect, apply });
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
    if (started) await pg.stop();
    await rm(databaseDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
