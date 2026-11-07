/* openchamber-modelselect — the panel's only way to touch config.
 *
 * Every read and write goes through the extension's local service
 * (`serviceRequest` on the host bridge), which owns the files. The panel
 * therefore declares no `files` capability and no filesystem paths: the
 * approval dialog is the service line alone.
 */
import { toPromise, str } from './dom.js';

/** Human text for a host/service refusal (never a bare error code). */
export function errText(err) {
  var code = str((err && err.code) || '');
  if (code === 'NO_SERVICE') {
    return 'the local service is not approved or not running — allow "Run a local service" in Settings → Extensions';
  }
  if (code === 'SERVICE_FAILED') return 'the local service failed to start — check its output on the extension card';
  if (code === 'REQUEST_FAILED') return 'the local service did not answer in time';
  if (code === 'DISABLED') return 'the extension is paused in Settings → Extensions';
  if (code === 'NOT_GRANTED') return 'the service is not approved for this extension';
  return str((err && err.message) || err || 'unknown error');
}

function messageOfBody(raw) {
  try {
    var parsed = JSON.parse(raw || '{}');
    return str(parsed && parsed.message);
  } catch (e) {
    return '';
  }
}

/**
 * A thin service client. `directory`/`session` are captured from the host's
 * `ready` context by the caller's getters, so a later ready updates them.
 */
export function makeApi(host, ctx) {
  function call(method, path, query, body) {
    var request = {
      method: method,
      path: path,
      query: Object.assign({
        directory: str(ctx.directory()),
        session: str(ctx.session())
      }, query || {})
    };
    if (body !== undefined) request.body = JSON.stringify(body);
    return toPromise(function () { return host.serviceRequest(request); }).then(function (result) {
      var status = (result && result.status) || 0;
      var raw = (result && result.body) || '';
      if (status < 200 || status >= 300) {
        var message = messageOfBody(raw);
        var err = new Error(message || ('service answered ' + status));
        err.status = status;
        throw err;
      }
      try {
        return JSON.parse(raw || '{}');
      } catch (e) {
        throw new Error('the local service answered something unreadable');
      }
    });
  }

  return {
    /** Everything the three tabs render, in one read. */
    config: function () {
      return call('GET', '/config');
    },
    /** Read-modify-write the managed config (`kind: 'plugin'`) or modelselect.json. */
    save: function (kind, values) {
      return call('POST', '/config', null, { kind: kind, values: values });
    },
    /** Add a bare `{ package, options: {} }` entry for the plugin. */
    addPlugin: function () {
      return call('POST', '/config', null, { kind: 'plugin-add' });
    },
    /** The model chain for one task type, with per-row usage bars. */
    chain: function (task) {
      return call('GET', '/chain', { task: str(task) });
    },
    /** One session's pick, for the background action's toast. */
    pick: function (sessionID) {
      return call('GET', '/pick', sessionID ? { session: str(sessionID) } : null);
    },
    /** The router-sync switch: same file the Work Status section toggles. */
    setRouter: function (on) {
      return call('POST', '/status', null, { id: 'routing-sync', value: on ? 'on' : 'off' });
    }
  };
}
