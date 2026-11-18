'use strict';

/** Deterministic PRNG (mulberry32) so every fuzz run is reproducible. */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random int in [min, max). */
function int(rand, min, max) {
  return min + Math.floor(rand() * (max - min));
}

/** Pick one element of a non-empty array. */
function pick(rand, arr) {
  return arr[int(rand, 0, arr.length)];
}

/** Random model table: taskTypes x {go, free, go_ranked, free_ranked}. */
function catalog(rand, taskNames, modelNames) {
  const taskTypes = {};
  for (const name of taskNames) {
    const goRanked = [];
    const freeRanked = [];
    for (let i = 0; i < int(rand, 0, 4); i += 1) {
      const cost = rand() < 0.3 ? null : Number((rand() * 10).toFixed(2));
      goRanked.push({
        model: pick(rand, modelNames),
        score: int(rand, 50, 100),
        input_cost: cost,
        output_cost: cost === null ? null : cost * 4,
        blended_cost: cost === null ? null : Number((cost * 2.4).toFixed(2)),
      });
    }
    for (let i = 0; i < int(rand, 0, 3); i += 1) {
      freeRanked.push({
        model: pick(rand, modelNames),
        score: int(rand, 40, 99),
        input_cost: 0,
        output_cost: 0,
        blended_cost: 0,
      });
    }
    taskTypes[name] = { go: goRanked[0]?.model || null, free: freeRanked[0]?.model || null, go_ranked: goRanked, free_ranked: freeRanked };
  }
  return taskTypes;
}

module.exports = { mulberry32, int, pick, catalog };
