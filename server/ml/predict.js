// server/ml/predict.js
// Loads trained TF.js model and runs inference during scan.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFeatures, featureObjectToArray, FEATURE_COLUMNS } from './features.js';
import { fetchSymbolData } from './dataPipeline.js';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const MODEL_DIR   = join(__dirname, 'saved_model');
const SCALER_PATH = join(__dirname, 'scaler.json');
const METRICS_PATH = join(__dirname, 'model_metrics.json');

// ─── Model singleton (loaded once) ───────────────────────────────────────────

let _tf     = null;
let _model  = null;
let _scaler = null;
let _metrics = null;

export function isModelReady() {
  return _model !== null && _scaler !== null;
}

export function getModelMetrics() {
  if (!_metrics && existsSync(METRICS_PATH)) {
    try {
      _metrics = JSON.parse(readFileSync(METRICS_PATH, 'utf8'));
    } catch {
      _metrics = null;
    }
  }
  return _metrics;
}

export async function loadModel() {
  if (_model) return true;

  if (!existsSync(MODEL_DIR) || !existsSync(SCALER_PATH)) {
    return false;  // model not trained yet
  }

  try {
    _tf = await import('@tensorflow/tfjs');
  } catch {
    console.warn('[predict] @tensorflow/tfjs not available. ML predictions disabled.');
    return false;
  }

  try {
    // Load model via IOHandler for cross-platform compatibility (no tfjs-node needed)
    const modelJsonPath = join(MODEL_DIR, 'model.json');
    const modelJSON = JSON.parse(readFileSync(modelJsonPath, 'utf8'));
    const weightsPath = join(MODEL_DIR, modelJSON.weightsManifest[0].paths[0]);
    const weightData = readFileSync(weightsPath).buffer;

    _model = await _tf.loadLayersModel(_tf.io.fromMemory(
      modelJSON.modelTopology,
      modelJSON.weightsManifest[0].weights,
      weightData,
    ));
    _scaler = JSON.parse(readFileSync(SCALER_PATH, 'utf8'));
    _metrics = existsSync(METRICS_PATH)
      ? JSON.parse(readFileSync(METRICS_PATH, 'utf8'))
      : null;
    console.log('[predict] ML model loaded successfully.');
    return true;
  } catch (err) {
    console.error('[predict] Failed to load model:', err.message);
    _model = null;
    return false;
  }
}

// ─── Scaler application ───────────────────────────────────────────────────────

function scaleFeatures(featureArray) {
  return featureArray.map((v, j) => (v - _scaler.mean[j]) / (_scaler.std[j] || 1));
}

// ─── Single-symbol prediction ────────────────────────────────────────────────

/**
 * Run ML prediction for one symbol using pre-fetched data or fetching live.
 *
 * @param {string} symbol
 * @param {object|null} precomputedFeatures  - pass if features already computed
 * @returns {{ ml_score, ml_direction, ml_probability, feature_snapshot }}
 */
export async function predictSymbol(symbol, precomputedFeatures = null) {
  if (!isModelReady()) return null;

  let features;
  if (precomputedFeatures) {
    features = precomputedFeatures;
  } else {
    try {
      const data = await fetchSymbolData(symbol);
      features   = computeFeatures(data);
    } catch (err) {
      console.error(`[predict] Data fetch failed for ${symbol}:`, err.message);
      return null;
    }
  }

  try {
    const featureArr    = featureObjectToArray(features);
    const scaledArr     = scaleFeatures(featureArr);
    const inputTensor   = _tf.tensor2d([scaledArr]);
    const outputTensor  = _model.predict(inputTensor);
    const probs         = (await outputTensor.array())[0];  // [P_down, P_flat, P_up]

    inputTensor.dispose();
    outputTensor.dispose();

    const maxIdx  = probs.indexOf(Math.max(...probs));
    // Direction: 0=down→-1, 1=flat→0, 2=up→1
    const ml_direction  = maxIdx === 2 ? 1 : (maxIdx === 0 ? -1 : 0);
    const ml_score      = Math.round(probs[2] * 100);  // 0-100 long confidence
    const ml_probability = probs[maxIdx];

    return {
      ml_score,
      ml_direction,
      ml_probability,
      feature_snapshot: features,
    };
  } catch (err) {
    console.error(`[predict] Inference failed for ${symbol}:`, err.message);
    return null;
  }
}

/**
 * Run predictions for multiple symbols and store results in Supabase.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string[]} symbols
 * @param {string|null} snapshotId  - scan_snapshots UUID
 */
export async function predictBatch(supabase, symbols, snapshotId = null) {
  if (!isModelReady()) return;

  const predictions = [];

  for (const symbol of symbols) {
    const result = await predictSymbol(symbol);
    if (!result) continue;

    predictions.push({
      scan_snapshot_id: snapshotId,
      symbol,
      ml_score:         result.ml_score,
      ml_direction:     result.ml_direction,
      ml_probability:   result.ml_probability,
      feature_snapshot: result.feature_snapshot,
    });
  }

  if (predictions.length === 0) return;

  const { error } = await supabase
    .from('ml_predictions')
    .insert(predictions);

  if (error) {
    console.error('[predict] Failed to store predictions:', error.message);
  } else {
    console.log(`[predict] Stored ${predictions.length} ML predictions.`);
  }

  return predictions;
}
