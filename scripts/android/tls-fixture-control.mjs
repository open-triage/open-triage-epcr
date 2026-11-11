import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Synthetic fixture IPC only. No application HTTP endpoint can replace trust. */
export function installTlsFixtureControl(server, variants, channel = process, read = readFile, requestCount = () => 0, applied = () => {}) {
  if (!variants) return () => {};
  const changed = async message => {
    if (!['android-fixture-tls', 'android-fixture-tls-observe'].includes(message?.type) || !/^[a-f0-9-]{36}$/.test(message.requestId ?? '')) return;
    const reply = { type: 'android-fixture-tls-result', requestId: message.requestId, changed: false };
    try {
      const selected = message.type === 'android-fixture-tls' && Object.hasOwn(variants, message.variant) ? variants[message.variant] : null;
      if (selected) {
        // Paths and bytes come only from the launcher's predeclared synthetic fixture.
        const [key, cert] = await Promise.all([read(selected.keyPath), read(selected.certPath)]);
        server.setSecureContext({ key, cert }); applied(selected); reply.changed = true;
      }
    } catch { /* Return only a category, never certificate/key or filesystem details. */ }
    reply.acceptedRequests = requestCount();
    if (channel.connected !== false) channel.send?.(reply, () => {});
  };
  channel.on('message', changed);
  return () => channel.off('message', changed);
}

async function requestFixtureTls(child, variant) {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Synthetic TLS rotation timed out.')), 10_000);
    const changed = message => {
      if (message?.type === 'android-fixture-tls-result' && message.requestId === requestId) finish(variant === undefined || message.changed ? null : new Error('Synthetic TLS rotation failed.'), message);
    };
    const exited = () => finish(new Error('Synthetic TLS API exited during rotation.'));
    const finish = (error, message) => { clearTimeout(timer); child.off('message', changed); child.off('exit', exited); error ? reject(error) : resolve(message); };
    child.on('message', changed); child.once('exit', exited);
    try {
      child.send({ type: variant === undefined ? 'android-fixture-tls-observe' : 'android-fixture-tls', requestId, variant }, error => { if (error) finish(new Error('Synthetic TLS fixture IPC unavailable.')); });
    } catch { finish(new Error('Synthetic TLS fixture IPC unavailable.')); }
  });
}
export async function setFixtureTls(child, variant) { return requestFixtureTls(child, variant); }
export async function observeFixtureTls(child) { return requestFixtureTls(child); }
