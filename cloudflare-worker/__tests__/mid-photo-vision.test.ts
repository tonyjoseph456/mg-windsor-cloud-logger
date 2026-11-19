import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_DAILY_MID_AI_PARSES_PER_VIN,
  MID_VISION_FALLBACK_MODEL,
  MID_VISION_PRIMARY_MODEL,
  extractAiResponseText,
  parseMidPhotoWithWorkersAi,
} from '../mid-photo-vision';

const SAMPLE_DATA_URI = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/';

describe('Cloudflare Workers AI MID Photo Vision Parsing', () => {
  it('returns 503 AI_BINDING_MISSING cleanly when env.AI is not bound', async () => {
    const res = await parseMidPhotoWithWorkersAi({
      ai: undefined,
      vin: 'MZB123456',
      dateKey: '2026-11-19',
      imageDataUrl: SAMPLE_DATA_URI,
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 503);
    assert.equal(res.code, 'AI_BINDING_MISSING');
  });

  it('rejects malformed or empty image payloads', async () => {
    const res = await parseMidPhotoWithWorkersAi({
      ai: { run: async () => ({ response: '{}' }) },
      vin: 'MZB123456',
      dateKey: '2026-11-19',
      imageDataUrl: 'https://example.com/not-a-data-uri.jpg',
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.equal(res.code, 'INVALID_IMAGE');
  });

  it('auto-accepts Meta license prompt ("agree") on first use and extracts cluster fields', async () => {
    const calls: Array<{ model: string; input: any }> = [];
    let licenseAccepted = false;

    const mockAi = {
      async run(model: string, input: any) {
        calls.push({ model, input });
        if (input?.prompt === 'agree') {
          licenseAccepted = true;
          return { response: 'Thank you for agreeing' };
        }
        if (!licenseAccepted) {
          throw new Error('5016: Please submit prompt "agree" to accept the Meta Llama 3.2 license');
        }
        return {
          response: '{"tripKm": 168.1, "odoKm": 39599, "socPct": 41, "dteKm": 130}',
        };
      },
    };

    const mem = new Map<string, string>();
    const res = await parseMidPhotoWithWorkersAi({
      ai: mockAi,
      kv: {
        get: async (k) => mem.get(k) ?? null,
        put: async (k, v) => {
          mem.set(k, v);
        },
      },
      vin: 'MZB123456',
      dateKey: '2026-11-19',
      imageDataUrl: SAMPLE_DATA_URI,
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.modelUsed, MID_VISION_PRIMARY_MODEL);
    assert.deepEqual(res.extracted, {
      tripKm: 168.1,
      odoKm: 39599,
      socPct: 41,
      dteKm: 130,
    });
    assert.equal(res.remainingDailyQuota, MAX_DAILY_MID_AI_PARSES_PER_VIN - 1);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].input.prompt, 'agree');
  });

  it('falls back to Mistral vision model if primary fails and extracts nested OpenAI choices format', async () => {
    const mockAi = {
      async run(model: string) {
        if (model === MID_VISION_PRIMARY_MODEL) {
          throw new Error('Capacity temporarily exhausted');
        }
        return {
          choices: [
            {
              message: {
                content: '```json\n{"tripKm": 64.9, "odoKm": 39193, "socPct": 81, "dteKm": 256}\n```',
              },
            },
          ],
        };
      },
    };

    const res = await parseMidPhotoWithWorkersAi({
      ai: mockAi,
      vin: 'MZB999',
      dateKey: '2026-11-19',
      imageDataUrl: SAMPLE_DATA_URI,
    });
    assert.equal(res.ok, true);
    assert.equal(res.modelUsed, MID_VISION_FALLBACK_MODEL);
    assert.equal(res.extracted?.tripKm, 64.9);
    assert.equal(res.extracted?.odoKm, 39193);
    assert.equal(res.extracted?.socPct, 81);
    assert.equal(res.extracted?.dteKm, 256);
    assert.equal(
      extractAiResponseText({ response: { tripKm: 32.4, odoKm: 38443, socPct: 91, dteKm: 291 } }),
      '{"tripKm":32.4,"odoKm":38443,"socPct":91,"dteKm":291}'
    );
  });

  it('enforces per-VIN daily rate limit so shared friends stay inside free Neuron budget', async () => {
    const mem = new Map<string, string>([
      [`mid_ai_quota:MZB_LIMIT:2026-11-19`, String(MAX_DAILY_MID_AI_PARSES_PER_VIN)],
    ]);
    let invoked = false;
    const res = await parseMidPhotoWithWorkersAi({
      ai: {
        run: async () => {
          invoked = true;
          return { response: '{}' };
        },
      },
      kv: {
        get: async (k) => mem.get(k) ?? null,
        put: async (k, v) => {
          mem.set(k, v);
        },
      },
      vin: 'MZB_LIMIT',
      dateKey: '2026-11-19',
      imageDataUrl: SAMPLE_DATA_URI,
    });
    assert.equal(invoked, false);
    assert.equal(res.ok, false);
    assert.equal(res.status, 429);
    assert.equal(res.code, 'DAILY_QUOTA_REACHED');
  });
});
