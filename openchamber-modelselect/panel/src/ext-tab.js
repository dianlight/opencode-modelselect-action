/* openchamber-modelselect — Extension tab: the router-sync switch (the same
 * project file the Work Status section toggles) plus the global
 * `~/.config/openchamber/modelselect.json` defaults. Both apply on the next
 * turn — no restart.
 *
 * Writes go through the service, so the package declares no file grants.
 */
import { el, str, sectionTitle } from './dom.js';
import { errText } from './api.js';
import { mkSelect, mkSwitch } from './fields.js';
import { mountBanner, mountButton } from '@openchamber/sdk/ui';

function typeOptions(types) {
  const seen = {};
  types.forEach((t) => { seen[t] = true; });
  seen.generic = true; // plugin fallback type — always selectable
  return Object.keys(seen).map((t) => ({ id: t, label: t }));
}

/** Mount the Extension tab: `snapshot` is the service's `/config` answer. */
export function mountExtensionTab(pane, snapshot, ctx) {
  const extConfig = snapshot.extConfig || {};
  const types = (snapshot.catalog && snapshot.catalog.types) || [];
  const fields = {};

  const note = el('div', 'mp-file');
  note.textContent = 'Writes: ' + snapshot.extensionPath + ' · routing-sync.json';
  pane.append(note);

  const banner = mountBanner(pane, { tone: 'info', title: '', body: '' });
  const setBanner = (tone, title, body) => {
    try { banner.update({ tone: tone, title: title, body: body || '' }); } catch (e) { /* best-effort */ }
  };

  sectionTitle(pane, 'Router');
  fields.sync = mkSwitch(pane, {
    label: 'auto-update routing.json',
    checked: Boolean(snapshot.syncOn),
    description: 'Refresh the stored routing deviations each turn (same switch as the status section).'
  });

  sectionTitle(pane, 'Auto model picks');
  fields.autoSmallModel = mkSwitch(pane, {
    label: 'autoSmallModel',
    checked: Boolean(extConfig.autoSmallModel),
    description: 'Route small/mechanical tasks to the small-model pick.'
  });
  fields.autoWalkthroughModel = mkSwitch(pane, {
    label: 'autoWalkthroughModel',
    checked: Boolean(extConfig.autoWalkthroughModel),
    description: 'Route walkthrough/tutorial sessions to the walkthrough pick.'
  });
  fields.smallModelTask = mkSelect(pane, {
    label: 'smallModelTask',
    value: str(extConfig.smallModelTask) || 'generic',
    options: typeOptions(types),
    searchable: true,
    searchPlaceholder: 'Filter task types…'
  });
  fields.walkthroughModelTask = mkSelect(pane, {
    label: 'walkthroughModelTask',
    value: str(extConfig.walkthroughModelTask) || 'generic',
    options: typeOptions(types),
    searchable: true,
    searchPlaceholder: 'Filter task types…'
  });

  const foot = el('div', 'mp-foot');
  mountButton(foot, {
    label: 'Save extension settings',
    variant: 'default',
    onClick: () => {
      const values = {
        autoSmallModel: Boolean(fields.autoSmallModel.checked),
        autoWalkthroughModel: Boolean(fields.autoWalkthroughModel.checked),
        smallModelTask: fields.smallModelTask.value,
        walkthroughModelTask: fields.walkthroughModelTask.value
      };
      Promise.all([
        ctx.api.setRouter(Boolean(fields.sync.checked)),
        ctx.api.save('extension', values)
      ]).then(() => {
        setBanner('success', 'Extension settings saved', 'Applies on the next turn — no restart needed.');
        ctx.fitHeight();
      }, (err) => {
        setBanner('error', 'Save failed', errText(err));
        ctx.fitHeight();
      });
    }
  });
  pane.append(foot);
  ctx.fitHeight();
}
