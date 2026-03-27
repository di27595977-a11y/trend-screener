// server/ml/train.js
// TensorFlow.js model training for 3-class price direction prediction.
// Run: node server/ml/train.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_COLUMNS } from './features.js';

dotenv.config();

const __dirname    = dirname(fileURLToPath(import.meta.url));
const MODEL_DIR    = join(__dirname, 'saved_model');
const SCALER_PATH  = join(__dirname, 'scaler.json');
const METRICS_PATH = join(__dirname, 'model_metrics.json');

// ─── Model Architecture ──────────────────────────────────────────────────────

async function buildModel(tf, inputDim) {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 256, activation: 'relu', inputShape: [inputDim] }));
  model.add(tf.layers.dropout({ rate: 0.3 }));
  model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
  model.add(tf.layers.dropout({ rate: 0.3 }));
  model.add(tf.layers.dense({ units: 64,  activation: 'relu' }));
  model.add(tf.layers.dense({ units: 3,   activation: 'softmax' })); // [down, flat, up]

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss:      'categoricalCrossentropy',
    metrics:   ['accuracy'],
  });

  return model;
}

// ─── Standard Scaler ─────────────────────────────────────────────────────────

function fitScaler(data2d) {
  const nFeatures = data2d[0].length;
  const mean = new Array(nFeatures).fill(0);
  const std  = new Array(nFeatures).fill(1);

  for (let j = 0; j < nFeatures; j++) {
    const col = data2d.map((row) => row[j]);
    const m   = col.reduce((a, b) => a + b, 0) / col.length;
    mean[j]   = m;
    const variance = col.reduce((s, v) => s + (v - m) ** 2, 0) / col.length;
    std[j]    = Math.sqrt(variance) || 1;
  }

  return { mean, std };
}

function applyScaler(data2d, scaler) {
  return data2d.map((row) =>
    row.map((v, j) => (v - scaler.mean[j]) / scaler.std[j]),
  );
}

// ─── Confusion Matrix ─────────────────────────────────────────────────────────

function confusionMatrix(predictions, actuals, numClasses = 3) {
  const matrix = Array.from({ length: numClasses }, () => new Array(numClasses).fill(0));
  for (let i = 0; i < predictions.length; i++) {
    matrix[actuals[i]][predictions[i]]++;
  }
  return matrix;
}

function accuracy(predictions, actuals) {
  const correct = predictions.filter((p, i) => p === actuals[i]).length;
  return correct / predictions.length;
}

// ─── Main Training Flow ───────────────────────────────────────────────────────

async function loadTrainingData(supabase) {
  console.log('[train] Loading training data from Supabase...');

  const PAGE = 1000;
  let offset = 0;
  const allRows = [];

  while (true) {
    const { data, error } = await supabase
      .from('ml_features')
      .select('features, label')
      .not('label', 'is', null)
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(`Supabase error: ${error.message}`);
    if (!data || data.length === 0) break;

    allRows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`[train] Loaded ${allRows.length} labelled rows.`);
  return allRows;
}

function prepareDatasets(rows, validationSplit = 0.2) {
  // Shuffle
  const shuffled = [...rows].sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(shuffled.length * (1 - validationSplit));

  const trainRows = shuffled.slice(0, splitIdx);
  const valRows   = shuffled.slice(splitIdx);

  function extractXY(set) {
    const X = set.map((r) => FEATURE_COLUMNS.map((k) => r.features[k] ?? 0));
    const Y = set.map((r) => {
      // Label: -1→0, 0→1, 1→2
      const lbl = r.label + 1;  // shift to 0/1/2
      return [lbl === 0 ? 1 : 0, lbl === 1 ? 1 : 0, lbl === 2 ? 1 : 0];
    });
    return { X, Y };
  }

  return { train: extractXY(trainRows), val: extractXY(valRows) };
}

export async function trainModel({ epochs = 50, batchSize = 256 } = {}) {
  // Lazy-load TensorFlow.js to avoid errors if not installed
  let tf;
  try {
    tf = await import('@tensorflow/tfjs');
  } catch {
    console.error('[train] @tensorflow/tfjs not installed. Run: npm install @tensorflow/tfjs');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const rows = await loadTrainingData(supabase);
  if (rows.length < 100) {
    console.error('[train] Not enough training data (need >= 100 labelled rows). Run data collection first.');
    process.exit(1);
  }

  const { train, val } = prepareDatasets(rows);

  console.log(`[train] Train: ${train.X.length} rows, Val: ${val.X.length} rows`);
  console.log(`[train] Feature count: ${FEATURE_COLUMNS.length}`);

  // Fit scaler on training data
  const scaler = fitScaler(train.X);
  const trainXScaled = applyScaler(train.X, scaler);
  const valXScaled   = applyScaler(val.X,   scaler);

  // Save scaler
  if (!existsSync(__dirname)) mkdirSync(__dirname, { recursive: true });
  writeFileSync(SCALER_PATH, JSON.stringify(scaler, null, 2));
  console.log(`[train] Scaler saved to ${SCALER_PATH}`);

  // Build and train model
  const model = await buildModel(tf, FEATURE_COLUMNS.length);
  model.summary();

  const xTrain = tf.tensor2d(trainXScaled);
  const yTrain = tf.tensor2d(train.Y);
  const xVal   = tf.tensor2d(valXScaled);
  const yVal   = tf.tensor2d(val.Y);

  // Compute class weights to handle imbalanced labels
  const labelCounts = [0, 0, 0]; // [down, flat, up]
  for (const y of train.Y) labelCounts[y.indexOf(1)]++;
  const totalSamples = train.Y.length;
  const classWeight = {};
  for (let c = 0; c < 3; c++) {
    classWeight[c] = labelCounts[c] > 0 ? totalSamples / (3 * labelCounts[c]) : 1;
  }
  console.log(`[train] Class weights: down=${classWeight[0].toFixed(2)}, flat=${classWeight[1].toFixed(2)}, up=${classWeight[2].toFixed(2)}`);

  console.log(`[train] Training for ${epochs} epochs, batch ${batchSize}...`);
  const history = await model.fit(xTrain, yTrain, {
    epochs,
    batchSize,
    validationData: [xVal, yVal],
    classWeight,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if ((epoch + 1) % 10 === 0 || epoch === 0) {
          console.log(
            `  Epoch ${epoch + 1}/${epochs} - loss: ${logs.loss.toFixed(4)}, acc: ${logs.acc?.toFixed(4) ?? logs.accuracy?.toFixed(4)}, ` +
            `val_loss: ${logs.val_loss.toFixed(4)}, val_acc: ${(logs.val_acc ?? logs.val_accuracy)?.toFixed(4)}`,
          );
        }
      },
    },
  });

  // Evaluate
  const predTensor = model.predict(xVal);
  const predArray  = await predTensor.array();
  const predLabels = predArray.map((probs) => probs.indexOf(Math.max(...probs)));
  const trueLabels = val.Y.map((onehot) => onehot.indexOf(1));

  const valAccuracy = accuracy(predLabels, trueLabels);
  const cm = confusionMatrix(predLabels, trueLabels);

  console.log(`\n[train] Validation accuracy: ${(valAccuracy * 100).toFixed(2)}%`);
  console.log('[train] Confusion matrix (rows=actual, cols=predicted):');
  console.table(cm);

  // Save model - use IOHandler for cross-platform compatibility
  if (!existsSync(MODEL_DIR)) mkdirSync(MODEL_DIR, { recursive: true });
  await model.save(tf.io.withSaveHandler(async (artifacts) => {
    const modelJSON = {
      modelTopology: artifacts.modelTopology,
      weightsManifest: [{
        paths: ['weights.bin'],
        weights: artifacts.weightSpecs,
      }],
      format: 'layers-model',
      generatedBy: 'TensorFlow.js tfjs-layers',
      convertedBy: null,
    };
    writeFileSync(join(MODEL_DIR, 'model.json'), JSON.stringify(modelJSON));
    writeFileSync(join(MODEL_DIR, 'weights.bin'), Buffer.from(artifacts.weightData));
    return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
  }));
  console.log(`[train] Model saved to ${MODEL_DIR}`);

  // Save metrics
  const finalLogs = history.history;
  const metrics = {
    trainedAt:      new Date().toISOString(),
    totalRows:      rows.length,
    trainRows:      train.X.length,
    valRows:        val.X.length,
    epochs,
    batchSize,
    valAccuracy,
    confusionMatrix: cm,
    finalTrainLoss: finalLogs.loss?.at(-1),
    finalValLoss:   finalLogs.val_loss?.at(-1),
    labelDistribution: {
      down: rows.filter((r) => r.label === -1).length,
      flat: rows.filter((r) => r.label ===  0).length,
      up:   rows.filter((r) => r.label ===  1).length,
    },
  };
  writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
  console.log(`[train] Metrics saved to ${METRICS_PATH}`);

  // Cleanup tensors
  xTrain.dispose(); yTrain.dispose(); xVal.dispose(); yVal.dispose(); predTensor.dispose();

  return metrics;
}

// CLI runner
const isDirectRun = process.argv[1] && (await import('node:url')).pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  const epochs    = Number.parseInt(process.argv[process.argv.indexOf('--epochs')    + 1] || '50',  10);
  const batchSize = Number.parseInt(process.argv[process.argv.indexOf('--batch')     + 1] || '256', 10);
  trainModel({ epochs, batchSize })
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}
