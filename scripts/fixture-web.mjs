import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import { installConnection } from '@deepseek-ai/dsh-client-connection/client';
import CredentialProvider from '@deepseek-ai/dsh-credentials';
import { WebServer } from '@deepseek-ai/dsh-host-webserver';
import { bounded } from './probe-native.mjs';

// These generated authentication records never use a live profile or keychain.
class EphemeralCredentials extends CredentialProvider {
  records = new Map();
  async resolve() { return undefined; }
  async describe() { return { configured: false, writable: false }; }
  async set() { throw new Error('Reference credentials are outside this fixture.'); }
  async unset() { throw new Error('Reference credentials are outside this fixture.'); }
  async readRecord(key) { return this.records.get(key); }
  async describeRecord(key) { const record = this.records.get(key); return { configured: !!record, writable: true, ...(record ? { kind: record.kind } : {}) }; }
  async listRecords() { return [...this.records].map(([key, record]) => ({ key, kind: record.kind })); }
  async modifyRecord(key, mutate) { const next = await mutate(this.records.get(key)); if (next !== undefined) this.records.set(key, next); return this.records.get(key); }
  async deleteRecord(key) { this.records.delete(key); }
}

export async function ownerConnection(ctx) {
  const client = new Context();
  const requests = [];
  try {
    await bounded(ctx.plugin(EphemeralCredentials), 'fixture credentials');
    await bounded(ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }), 'ephemeral native HTTP listener');
    await bounded(ctx.plugin(Connection), 'native authenticated Connection');
    const connection = ctx.get('connection');
    assert.ok(connection instanceof Connection.HostConnectionService);
    const webServer = ctx.get('webServer');
    const origin = webServer.getOrigin();
    const baseUrl = `${origin}/`;
    let loginUrl;
    if (typeof connection.authenticatedUrl === 'function') {
      webServer.register({ kind: 'exact', path: '/', handler(req, res) {
        if (connection.authorizeIndex(req, res)) { res.writeHead(200); res.end('fixture'); }
      } });
      loginUrl = connection.authenticatedUrl(baseUrl);
    } else {
      const nativeTools = import.meta.resolve('@deepseek-ai/dsh-tools/package.json');
      const tokenProviderEntry = createRequire(nativeTools).resolve('@deepseek-ai/dsh-host-authentication-token');
      const tokenProvider = await import(pathToFileURL(tokenProviderEntry));
      await bounded(ctx.plugin(tokenProvider, { cookieMaxAgeDays: 30 }), 'native token authentication');
      const entries = [];
      ctx.emit(webServer, 'webserver/entry-url', baseUrl, entries);
      loginUrl = entries.find(entry => entry.open)?.url;
      assert.ok(loginUrl, 'native token authentication contributes a browser entry URL');
    }
    const login = await fetch(loginUrl, { redirect: 'manual' });
    assert.equal(login.status, 303);
    const cookie = login.headers.getSetCookie()[0]?.split(';', 1)[0];
    assert.ok(cookie);
    await login.arrayBuffer();
    await bounded(client.plugin({ name: 'fixture-native-http-client', apply(clientCtx) {
      installConnection(clientCtx, { transport: { fetch: async (path, init) => {
        const headers = new Headers(init.headers);
        headers.set('cookie', cookie);
        const response = await fetch(new URL(path, baseUrl), { ...init, headers });
        requests.push({ path: String(path), status: response.status });
        return response;
      } } });
    } }), 'native HTTP RPC client');
    return { rpc: client.get('connection').rpc, requests, origin, cookie, close: () => client.fiber.dispose() };
  } catch (error) {
    await client.fiber.dispose();
    throw error;
  }
}
