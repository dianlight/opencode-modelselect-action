/* openchamber-modelselect — background entry for `contributes.actions`.
 *
 * Runs in a hidden frame when the user picks "Model select pick" from a
 * session's menu: asks the local service for that session's newest pick and
 * shows it in a toast with Copy. Nothing is drawn here — the host hides the
 * frame and closes it when the handler finishes.
 */
import { connectHost } from '@openchamber/sdk';

const host = connectHost();

function messageOfBody(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return String((parsed && parsed.message) || '');
  } catch (e) {
    return '';
  }
}

async function readPick(item) {
  const result = await host.serviceRequest({
    method: 'GET',
    path: '/pick',
    query: {
      directory: item.directory || '',
      session: item.sessionId || ''
    }
  });
  const status = (result && result.status) || 0;
  const raw = (result && result.body) || '';
  if (status < 200 || status >= 300) {
    throw new Error(messageOfBody(raw) || ('the local service answered ' + status));
  }
  return JSON.parse(raw || '{}');
}

host.onAction(async (item) => {
  if (!item || item.kind !== 'session' || item.action !== 'model-pick') return;
  let pick;
  try {
    pick = await readPick(item);
  } catch (err) {
    await host.toast({
      kind: 'error',
      message: 'Model select: ' + String((err && err.message) || err),
      dismiss: true
    });
    return;
  }
  const title = item.sessionTitle ? item.sessionTitle + ' — ' : '';
  await host.toast({
    kind: 'info',
    message: title + pick.text,
    copy: { text: pick.text },
    dismiss: true
  });
});
