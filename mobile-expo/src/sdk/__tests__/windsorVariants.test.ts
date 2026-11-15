import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WINDSOR_VARIANTS,
  detectWindsorVariantFromSnapshot,
  getWindsorVariantById,
  matchWindsorVariantFromText,
  resolveWindsorSunroofState,
} from '../windsorVariants';
import { discoverCapabilities } from '../client';

describe('Windsor EV brochure variants & sunroof detection', () => {
  it('defines all 5 brochure trims with accurate glass roof / sunroof flags', () => {
    const byId = Object.fromEntries(WINDSOR_VARIANTS.map((v) => [v.id, v]));
    assert.equal(WINDSOR_VARIANTS.length, 5);
    assert.equal(byId.excite.hasSunroof, false);
    assert.equal(byId.excite.batteryKwh, 38);
    assert.equal(byId.exclusive.hasSunroof, false);
    assert.equal(byId.exclusive.batteryKwh, 38);
    assert.equal(byId.essence.hasSunroof, true);
    assert.equal(byId.essence.batteryKwh, 38);
    assert.equal(byId.exclusive_pro.hasSunroof, false);
    assert.equal(byId.exclusive_pro.batteryKwh, 52.9);
    assert.equal(byId.essence_pro.hasSunroof, true);
    assert.equal(byId.essence_pro.batteryKwh, 52.9);
  });

  it('matches Pro variants before non-Pro variants from raw text', () => {
    assert.equal(matchWindsorVariantFromText('Windsor Essence Pro')?.id, 'essence_pro');
    assert.equal(matchWindsorVariantFromText('EQ100_EXCLUSIVE_PRO')?.id, 'exclusive_pro');
    assert.equal(matchWindsorVariantFromText('Windsor Essence 38kWh')?.id, 'essence');
    assert.equal(matchWindsorVariantFromText('WINDSOR EXCLUSIVE')?.id, 'exclusive');
    assert.equal(matchWindsorVariantFromText('Windsor Excite')?.id, 'excite');
    assert.equal(matchWindsorVariantFromText('WINDSOR EQ100'), null);
  });

  it('auto-detects Exclusive vs Essence from server vehicle.raw metadata and disables/enables sunroof', () => {
    const exclusiveSnap: any = {
      vehicle: {
        vin: 'MZB123456',
        name: 'Windsor EV',
        model: 'Windsor EV',
        series: 'EQ100',
        raw: { series: 'EQ100', modelName: 'WINDSOR EXCLUSIVE' },
      },
    };
    assert.equal(detectWindsorVariantFromSnapshot(exclusiveSnap)?.id, 'exclusive');
    const exState = resolveWindsorSunroofState(exclusiveSnap, null);
    assert.equal(exState.source, 'detected');
    assert.equal(exState.sunroofEnabled, false);
    assert.equal(exState.showUnconfiguredWarning, false);

    const essenceProSnap: any = {
      vehicle: {
        vin: 'MZB999999',
        name: 'Windsor EV',
        model: 'Windsor EV',
        series: 'EQ100',
        raw: {
          series: 'EQ100',
          modelName: 'WINDSOR',
          vehicleModelConfiguration: [{ itemName: 'Model Trim', itemValue: 'Essence Pro' }],
        },
      },
    };
    const epState = resolveWindsorSunroofState(essenceProSnap, null);
    assert.equal(epState.detectedVariant?.id, 'essence_pro');
    assert.equal(epState.source, 'detected');
    assert.equal(epState.sunroofEnabled, true);
    assert.equal(epState.showUnconfiguredWarning, false);
  });

  it('returns unknown with warning when server returns only generic EQ100/WINDSOR, and honors manual selection', () => {
    const genericSnap: any = {
      vehicle: {
        vin: 'MZB000001',
        name: 'Windsor EV',
        model: 'Windsor EV',
        series: 'EQ100',
        raw: { series: 'EQ100', modelName: 'WINDSOR' },
      },
      capabilities: {
        climate: true,
        door_lock: true,
        find_my_car: true,
        tailgate: true,
        sunroof: false,
        heated_seats: false,
        window_param_ids: [9, 10, 11, 12],
      },
    };

    const unconfigured = resolveWindsorSunroofState(genericSnap, null);
    assert.equal(unconfigured.detectedVariant, null);
    assert.equal(unconfigured.source, 'unknown');
    assert.equal(unconfigured.showUnconfiguredWarning, true);
    assert.equal(unconfigured.sunroofEnabled, true);

    const userExclusive = resolveWindsorSunroofState(genericSnap, 'exclusive');
    assert.equal(userExclusive.source, 'manual');
    assert.equal(userExclusive.activeVariant?.id, 'exclusive');
    assert.equal(userExclusive.sunroofEnabled, false);
    assert.equal(userExclusive.showUnconfiguredWarning, false);

    const userEssence = resolveWindsorSunroofState(genericSnap, 'essence');
    assert.equal(userEssence.source, 'manual');
    assert.equal(userEssence.activeVariant?.id, 'essence');
    assert.equal(userEssence.sunroofEnabled, true);
    assert.equal(userEssence.showUnconfiguredWarning, false);
  });

  it('handles array-shaped and JSON-string vehicleModelConfiguration blocks in discoverCapabilities', () => {
    const arrayCaps = discoverCapabilities([
      {
        data: {
          vehicleModelConfiguration: [
            { itemCode: 'S61', itemValue: '1' },
            { itemCode: 'S35', itemValue: '0' },
            { itemCode: 'T11', itemValue: '1' },
            { itemCode: 'BOOT', itemValue: '1' },
            { itemCode: 'WINDOW', itemValue: '1111' },
          ],
        },
      },
    ]);
    assert.equal(arrayCaps.door_lock, true);
    assert.equal(arrayCaps.sunroof, false);

    const jsonStrCaps = discoverCapabilities([
      {
        modelConfigurationJsonStr: JSON.stringify([
          { itemCode: 'S61', itemValue: '1' },
          { itemCode: 'S35', itemValue: '1' },
        ]),
      },
    ]);
    assert.equal(jsonStrCaps.sunroof, true);
    assert.equal(getWindsorVariantById('INVALID'), null);
  });
});
