'use strict';

module.exports = {
  id: 'plugin/virtual-provider-registered',
  component: 'plugin',
  title: 'the virtual modelselect provider registers one model per preference',
  steps: [],
  expect: { plugin: { addedIncludes: 'modelselect', catalogHas: 'modelselect', virtualCount: 2 } },
};
