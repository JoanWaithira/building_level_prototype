/**
 * Simple univariate LSTM forecast for daily grid import (kWh).
 * Chronological split: 80% train · 10% validation · 10% test.
 */
const LOOKBACK = 14;
const FORECAST_DAYS = 14;
const UNITS = 16;
const EPOCHS = 28;
const BATCH = 16;

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function mae(yTrue, yPred) {
  if (!yTrue.length) return null;
  let s = 0;
  for (let i = 0; i < yTrue.length; i++) s += Math.abs(yTrue[i] - yPred[i]);
  return s / yTrue.length;
}

function rmse(yTrue, yPred) {
  if (!yTrue.length) return null;
  let s = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const e = yTrue[i] - yPred[i];
    s += e * e;
  }
  return Math.sqrt(s / yTrue.length);
}

function buildWindows(norm, lookback) {
  const xs = [];
  const ys = [];
  for (let i = lookback; i < norm.length; i++) {
    xs.push(norm.slice(i - lookback, i).map((v) => [v]));
    ys.push(norm[i]);
  }
  return { xs, ys };
}

/**
 * @param {Array<{date:string,value:number}>} dailySeries
 * @param {{ onProgress?: (p:{epoch:number,epochs:number,loss?:number}) => void }} [opts]
 */
export async function forecastImportLstm(dailySeries, opts = {}) {
  const series = (dailySeries ?? []).filter((d) => d?.date != null && Number.isFinite(d.value));
  const minPoints = LOOKBACK + 40;
  if (series.length < minPoints) {
    return {
      ok: false,
      error: `Need at least ${minPoints} daily points for LSTM (have ${series.length}).`,
    };
  }

  const tf = await import("@tensorflow/tfjs");
  await tf.ready();

  const values = series.map((d) => d.value);
  const dates = series.map((d) => d.date);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const norm = values.map((v) => (v - min) / span);

  const { xs, ys } = buildWindows(norm, LOOKBACK);
  const n = xs.length;
  const nTrain = Math.max(1, Math.floor(n * 0.8));
  const nVal = Math.max(1, Math.floor(n * 0.1));
  const iValEnd = nTrain + nVal;
  const trainX = xs.slice(0, nTrain);
  const trainY = ys.slice(0, nTrain);
  const valX = xs.slice(nTrain, iValEnd);
  const valY = ys.slice(nTrain, iValEnd);
  const testX = xs.slice(iValEnd);
  const testY = ys.slice(iValEnd);

  if (testX.length < 1) {
    return { ok: false, error: "Not enough windows for an 80/10/10 split." };
  }

  const xTrain = tf.tensor3d(trainX);
  const yTrain = tf.tensor2d(trainY, [trainY.length, 1]);
  const xVal = valX.length ? tf.tensor3d(valX) : null;
  const yVal = valY.length ? tf.tensor2d(valY, [valY.length, 1]) : null;

  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: UNITS,
      inputShape: [LOOKBACK, 1],
    }),
  );
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({
    optimizer: tf.train.adam(0.01),
    loss: "meanSquaredError",
  });

  const fitArgs = {
    epochs: EPOCHS,
    batchSize: Math.min(BATCH, Math.max(1, trainX.length)),
    shuffle: false,
    verbose: 0,
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        opts.onProgress?.({
          epoch: epoch + 1,
          epochs: EPOCHS,
          loss: logs?.loss,
        });
        if (typeof tf.nextFrame === "function") await tf.nextFrame();
      },
    },
  };
  if (xVal && yVal) {
    fitArgs.validationData = [xVal, yVal];
  }

  await model.fit(xTrain, yTrain, fitArgs);

  const predictBatch = (xArr) => {
    if (!xArr.length) return [];
    const t = tf.tensor3d(xArr);
    const out = model.predict(t);
    const data = Array.from(out.dataSync());
    t.dispose();
    out.dispose();
    return data.map((v) => v * span + min);
  };

  const trainPred = predictBatch(trainX);
  const valPred = predictBatch(valX);
  const testPred = predictBatch(testX);
  const trainTrue = trainY.map((v) => v * span + min);
  const valTrue = valY.map((v) => v * span + min);
  const testTrue = testY.map((v) => v * span + min);

  let window = norm.slice(-LOOKBACK);
  const forecast = [];
  for (let step = 0; step < FORECAST_DAYS; step++) {
    const t = tf.tensor3d([window.map((v) => [v])]);
    const out = model.predict(t);
    const nextNorm = out.dataSync()[0];
    t.dispose();
    out.dispose();
    const nextVal = Math.max(0, nextNorm * span + min);
    forecast.push({
      date: addDays(dates[dates.length - 1], step + 1),
      value: Math.round(nextVal * 100) / 100,
    });
    window = [...window.slice(1), nextNorm];
  }

  const historyTail = series.slice(-60);

  model.dispose();
  xTrain.dispose();
  yTrain.dispose();
  xVal?.dispose();
  yVal?.dispose();

  return {
    ok: true,
    lookback: LOOKBACK,
    forecastDays: FORECAST_DAYS,
    split: {
      trainPct: 80,
      valPct: 10,
      testPct: 10,
      nWindows: n,
      nTrain: trainX.length,
      nVal: valX.length,
      nTest: testX.length,
    },
    metrics: {
      trainMae: mae(trainTrue, trainPred),
      valMae: mae(valTrue, valPred),
      testMae: mae(testTrue, testPred),
      testRmse: rmse(testTrue, testPred),
    },
    history: historyTail,
    forecast,
    forecastTotal: forecast.reduce((s, d) => s + d.value, 0),
  };
}
