/**
 * Cloudflare Workers AI wrapper for reading MG Windsor EV cluster (MID) photos.
 * Uses the Worker's built-in [ai] binding so no extra third-party AI account is needed.
 */
import {
  MID_PHOTO_VISION_PROMPT,
  MidExtractedReading,
  parseMidAiJsonResponse,
} from '../mobile-expo/src/sdk/midPhotoTrip';

export const MID_VISION_PRIMARY_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const MID_VISION_FALLBACK_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
export const MAX_DAILY_MID_AI_PARSES_PER_VIN = 30;
export const MAX_IMAGE_DATA_URI_CHARS = 3_500_000;

export interface WorkersAiBinding {
  run(model: string, input: any): Promise<any>;
}

export interface MidVisionKvAdapter {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface ParseMidPhotoResult {
  status: number;
  ok: boolean;
  code?: string;
  error?: string;
  extracted?: MidExtractedReading;
  modelUsed?: string;
  remainingDailyQuota?: number;
}

export function extractAiResponseText(aiResult: unknown): string {
  if (typeof aiResult === 'string') return aiResult;
  if (!aiResult || typeof aiResult !== 'object') return '';
  const res = aiResult as Record<string, any>;
  if (typeof res.response === 'string') return res.response;
  if (res.response && typeof res.response === 'object') {
    return JSON.stringify(res.response);
  }
  const choiceContent = res.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string') return choiceContent;
  if (Array.isArray(choiceContent)) {
    return choiceContent
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
  }
  return '';
}

function isMetaLicenseAgreementError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /\b5016\b|agree|license|acceptable\s*use/i.test(msg);
}

function hasAnyExtractedNumber(reading: MidExtractedReading): boolean {
  return (
    reading.tripKm !== null ||
    reading.odoKm !== null ||
    reading.socPct !== null ||
    reading.dteKm !== null
  );
}

async function runSingleVisionModel(
  ai: WorkersAiBinding,
  model: string,
  imageDataUrl: string
): Promise<MidExtractedReading> {
  const messages = [
    {
      role: 'system',
      content: 'You extract exact numbers from EV dashboard photos and reply strictly in JSON.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: MID_PHOTO_VISION_PROMPT },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];

  let aiResp: any;
  try {
    aiResp = await ai.run(model, { messages, max_tokens: 180, temperature: 0 });
  } catch (err) {
    if (model === MID_VISION_PRIMARY_MODEL && isMetaLicenseAgreementError(err)) {
      await ai.run(model, { prompt: 'agree' });
      aiResp = await ai.run(model, { messages, max_tokens: 180, temperature: 0 });
    } else {
      throw err;
    }
  }

  const rawText = extractAiResponseText(aiResp);
  return parseMidAiJsonResponse(rawText);
}

export async function parseMidPhotoWithWorkersAi(params: {
  ai?: WorkersAiBinding;
  kv?: MidVisionKvAdapter;
  vin: string;
  dateKey: string;
  imageDataUrl: string;
}): Promise<ParseMidPhotoResult> {
  const { ai, kv, vin, dateKey, imageDataUrl } = params;
  if (!ai || typeof ai.run !== 'function') {
    return {
      status: 503,
      ok: false,
      code: 'AI_BINDING_MISSING',
      error: 'Cloudflare Workers AI binding (AI) is not enabled on this Worker yet.',
    };
  }

  if (
    typeof imageDataUrl !== 'string' ||
    !/^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(imageDataUrl.trim())
  ) {
    return {
      status: 400,
      ok: false,
      code: 'INVALID_IMAGE',
      error: 'Valid base64 JPEG/PNG/WebP image data URI is required.',
    };
  }

  if (imageDataUrl.length > MAX_IMAGE_DATA_URI_CHARS) {
    return {
      status: 400,
      ok: false,
      code: 'IMAGE_TOO_LARGE',
      error: 'Image payload exceeds 2.5 MB limit after compression.',
    };
  }

  let usedCount = 0;
  const quotaKey = `mid_ai_quota:${vin}:${dateKey}`;
  if (kv) {
    try {
      const rawCount = await kv.get(quotaKey);
      usedCount = Math.max(0, Math.floor(Number(rawCount) || 0));
    } catch {
      usedCount = 0;
    }
    if (usedCount >= MAX_DAILY_MID_AI_PARSES_PER_VIN) {
      return {
        status: 429,
        ok: false,
        code: 'DAILY_QUOTA_REACHED',
        error: `Daily AI scan limit (${MAX_DAILY_MID_AI_PARSES_PER_VIN}/day) reached for this vehicle. Enter numbers manually.`,
        remainingDailyQuota: 0,
      };
    }
  }

  const trimmedImage = imageDataUrl.trim();
  const models = [MID_VISION_PRIMARY_MODEL, MID_VISION_FALLBACK_MODEL];
  let lastErrorMsg = '';
  let bestReading: MidExtractedReading | null = null;
  let bestModel = MID_VISION_PRIMARY_MODEL;

  for (const model of models) {
    try {
      const parsed = await runSingleVisionModel(ai, model, trimmedImage);
      bestReading = parsed;
      bestModel = model;
      if (hasAnyExtractedNumber(parsed)) {
        break;
      }
    } catch (err) {
      lastErrorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  if (!bestReading) {
    return {
      status: 502,
      ok: false,
      code: 'AI_INFERENCE_FAILED',
      error: lastErrorMsg || 'Workers AI could not read this MID photo.',
    };
  }

  const nextUsed = usedCount + 1;
  if (kv) {
    try {
      await kv.put(quotaKey, String(nextUsed));
    } catch {}
  }

  return {
    status: 200,
    ok: true,
    extracted: bestReading,
    modelUsed: bestModel,
    remainingDailyQuota: Math.max(0, MAX_DAILY_MID_AI_PARSES_PER_VIN - nextUsed),
  };
}
