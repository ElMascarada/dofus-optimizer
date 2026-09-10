import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { createEquipmentCandidatePolicy } from '../optimizer/equipment-candidate-policy.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

function item(id, slot, earth) {
  return {
    id,
    name: id,
    slot,
    level: 200,
    stats: { earth },
    conditions: null,
    setId: null
  };
}

function reducedProfile() {
  const base = getSearchProfile('BALANCED');
  return {
    ...base,
    candidate: {
      ...base.candidate,
      slotPoolTargets: {
        ...base.candidate.slotPoolTargets,
        dofus: 8,
        companion: 8
      }
    },
    search: {
      ...base.search,
      groupChoiceLimits: {
        ...base.search.groupChoiceLimits,
        dofus: 2,
        companion: 2
      },
      groupBeamWidth: 2,
      multiPickBeamWidth: 3,
      dofusGroupBeamWidth: 5,
      groupBucketLimit: 100,
      groupSpecialistReservePerStat: 1
    }
  };
}

async function loadBuildGroupChoices() {
  const sourceUrl = new URL('../js/equipment-search-v2.js', import.meta.url);
  const tempUrl = new URL(`../js/.equipment-search-v2-beam-policy-${process.pid}-${Date.now()}.tmp.mjs`, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  try {
    await writeFile(tempUrl, `${source}\nexport { buildGroupChoices };\n`, 'utf8');
    const module = await import(`${tempUrl.href}?v=${Date.now()}`);
    return module.buildGroupChoices;
  } finally {
    try { await unlink(tempUrl); } catch {}
  }
}

function firstLossLimit(buildGroupChoices, { slot, count, items, profile, witnessId }) {
  const policy = createEquipmentCandidatePolicy({
    items,
    syntheticOffense: { elements: ['earth'], profiles: ['large'] },
    searchProfile: profile
  });
  const diagnostic = { firstLoss: null };
  const originalLog = console.log;
  const logs = [];
  console.log = (...parts) => logs.push(parts.join(' '));
  let choices;
  try {
    choices = buildGroupChoices(items.map((entry) => policy.profileItem(entry)), count, {
      slot,
      policy,
      profile,
      constraints: {},
      setsById: {},
      diagnostic,
      diagnosticWitnessChoiceIds: [witnessId]
    });
  } finally {
    console.log = originalLog;
  }
  return { choices, diagnostic, logs };
}

test('Equipment-First restores canonical intermediate group-beam policy without changing final group limits', async () => {
  const buildGroupChoices = await loadBuildGroupChoices();
  const profile = reducedProfile();
  const dofusItems = Array.from({ length: 6 }, (_, index) => item(`dofus-${index}`, 'dofus', 600 - index * 50));
  const dofus = firstLossLimit(buildGroupChoices, {
    slot: 'dofus',
    count: 3,
    items: dofusItems,
    profile,
    witnessId: 'dofus-5'
  });

  assert.equal(profile.search.groupBeamWidth, 2);
  assert.equal(profile.search.dofusGroupBeamWidth, 5);
  assert.equal(profile.search.groupChoiceLimits.dofus, 2);
  assert.equal(dofus.diagnostic.firstLoss?.point, 'GROUP_CHOICE_DIVERSITY');
  assert.equal(dofus.diagnostic.firstLoss?.FIRST_LOSS_LIMIT, 5);
  assert.ok(dofus.logs.includes('FIRST_LOSS_LIMIT=5'));
  assert.equal(dofus.choices.length, 2);

  const companionItems = Array.from({ length: 6 }, (_, index) => item(`companion-${index}`, 'companion', 600 - index * 50));
  const multiPick = firstLossLimit(buildGroupChoices, {
    slot: 'companion',
    count: 5,
    items: companionItems,
    profile,
    witnessId: 'companion-5'
  });
  assert.equal(profile.search.multiPickBeamWidth, 3);
  assert.equal(multiPick.diagnostic.firstLoss?.FIRST_LOSS_LIMIT, 3);
  assert.equal(multiPick.choices.length, 2);

  console.log('DOFUS_INTERMEDIATE_BEAM_USES_DOFUS_GROUP_BEAM_WIDTH=PASS');
  console.log('MULTI_PICK_INTERMEDIATE_BEAM_USES_MULTI_PICK_BEAM_WIDTH=PASS');
  console.log('FINAL_DOFUS_GROUP_LIMIT_UNCHANGED=PASS');
});
