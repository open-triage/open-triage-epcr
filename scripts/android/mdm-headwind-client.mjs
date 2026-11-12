import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

/** Lab/operator adapter only. No Headwind dependency or credentials enter the clinical app. */
export class HeadwindLabClient {
  #origin; #cookie; #fetch;
  constructor(origin, cookie, fetcher = fetch) {
    const url = new URL(origin);
    assert.equal(url.href, url.origin + '/', 'Supply an exact console origin');
    assert(!url.username && !url.password);
    assert(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)), 'HTTP console is restricted to the loopback lab');
    assert(typeof cookie === 'string' && cookie.length > 0 && !/[\r\n]/.test(cookie), 'Private console session required');
    this.#origin = url.origin; this.#cookie = cookie; this.#fetch = fetcher;
  }
  static async fromStorageState(origin, path, fetcher = fetch) {
    const url = new URL(origin), state = JSON.parse(await readFile(path, 'utf8'));
    const cookie = state.cookies.filter(value => value.name === 'JSESSIONID' && value.domain.replace(/^\./, '') === url.hostname
      && value.path === '/' && (!value.secure || url.protocol === 'https:') && (value.expires === -1 || value.expires * 1000 > Date.now()));
    assert.equal(cookie.length, 1, 'One current private console session is required');
    assert(!/[;\r\n]/.test(cookie[0].value), 'Malformed console session');
    return new HeadwindLabClient(origin, `JSESSIONID=${cookie[0].value}`, fetcher);
  }
  async #request(path, method = 'GET', body) {
    const response = await this.#fetch(this.#origin + path, {method, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(20_000),
      headers: {Cookie: this.#cookie, Accept: 'application/json', ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    if (response.status !== 200) { await response.body?.cancel(); throw new Error('Headwind console request rejected; response body withheld'); }
    const result = await response.json();
    assert.equal(result.status, 'OK', 'Headwind console rejected the request; private response withheld');
    return result.data;
  }
  #id(id) { assert(Number.isSafeInteger(id) && id > 0, 'Explicit positive numeric lab record ID required'); return id; }
  configurations() { return this.#request('/rest/private/configurations/list'); }
  configuration(id) { return this.#request(`/rest/private/configurations/${this.#id(id)}`); }
  applications() { return this.#request('/rest/private/applications/search/'); }
  devices(configurationId) {
    return this.#request('/rest/private/devices/search', 'POST', {value: '', groupId: -1, configurationId: this.#id(configurationId), pageNum: 1, pageSize: 100, sortBy: null, sortDir: 'ASC', fastSearch: false});
  }
  saveConfiguration(configuration, expectedId) {
    assert.equal(configuration.id, this.#id(expectedId), 'Refuse to modify another configuration');
    assert(Array.isArray(configuration.applications) && Array.isArray(configuration.applicationSettings), 'Complete configuration snapshot required');
    return this.#request('/rest/private/configurations', 'PUT', configuration);
  }
  deviceSettings(id) { return this.#request(`/rest/private/devices/${this.#id(id)}/applicationSettings`); }
  saveDeviceSettings(id, settings) {
    assert(Array.isArray(settings), 'Explicit device-setting array required');
    return this.#request(`/rest/private/devices/${this.#id(id)}/applicationSettings`, 'POST', settings);
  }
  notifyDeviceSettings(id) { return this.#request(`/rest/private/devices/${this.#id(id)}/applicationSettings/notify`, 'POST', {}); }
}
