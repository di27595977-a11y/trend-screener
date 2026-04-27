import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { createSupabaseClient, isSupabaseConfigured } from '../src/services/supabaseClient.js';

const DEFAULT_ALPHA_ENGINE_ROOT = path.resolve(process.cwd(), '..', 'Alpha-engine');

function getAlphaEngineRoot() {
  const configured = process.env.ALPHA_ENGINE_ROOT?.trim();
  return configured ? path.resolve(configured) : DEFAULT_ALPHA_ENGINE_ROOT;
}

function getProviderHint() {
  return (process.env.ALPHA_STRATEGY_PROVIDER || '').trim().toLowerCase();
}

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getPythonExecutable(alphaEngineRoot) {
  const configured = process.env.ALPHA_ENGINE_PYTHON?.trim();
  const candidates = [
    configured,
    path.join(alphaEngineRoot, 'venv', 'Scripts', 'python.exe'),
    path.join(alphaEngineRoot, 'venv', 'bin', 'python'),
    'python',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'python') {
      return candidate;
    }

    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return 'python';
}

async function resolveProviderMode() {
  const providerHint = getProviderHint();
  if (providerHint === 'local' || providerHint === 'supabase') {
    return providerHint;
  }

  if (await fileExists(getAlphaEngineRoot())) {
    return 'local';
  }

  if (isSupabaseConfigured()) {
    return 'supabase';
  }

  return 'local';
}

async function runStrategyConsole(args, payload = null) {
  const alphaEngineRoot = getAlphaEngineRoot();
  const pythonExecutable = await getPythonExecutable(alphaEngineRoot);

  return new Promise((resolve, reject) => {
    const child = execFile(
      pythonExecutable,
      ['-m', 'integration.strategy_console', ...args],
      {
        cwd: alphaEngineRoot,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
        },
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || stdout?.trim() || error.message));
          return;
        }

        try {
          resolve({
            provider: 'local',
            sync_required: false,
            ...JSON.parse(stdout || '{}'),
          });
        } catch (parseError) {
          reject(new Error(`Failed to parse strategy console output: ${parseError.message}`));
        }
      },
    );

    if (payload) {
      child.stdin.write(JSON.stringify(payload));
    }
    child.stdin.end();
  });
}

async function runStrategyBacktest(fileName) {
  const alphaEngineRoot = getAlphaEngineRoot();
  const pythonExecutable = await getPythonExecutable(alphaEngineRoot);

  return new Promise((resolve, reject) => {
    execFile(
      pythonExecutable,
      ['-m', 'integration.strategy_backtest', '--file-name', fileName],
      {
        cwd: alphaEngineRoot,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
        },
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || stdout?.trim() || error.message));
          return;
        }

        try {
          resolve({
            provider: 'local',
            sync_required: false,
            queued: false,
            ...JSON.parse(stdout || '{}'),
          });
        } catch (parseError) {
          reject(new Error(`Failed to parse strategy backtest output: ${parseError.message}`));
        }
      },
    );
  });
}

function getSupabase() {
  const client = createSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured for deployable strategy control.');
  }
  return client;
}

async function getLatestApplyJob(supabase) {
  const { data, error } = await supabase
    .from('alpha_strategy_apply_jobs')
    .select('id, requested_at, requested_by, statuses, status, result, applied_at, completed_at')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function listRemoteAlphaStrategies() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('alpha_strategy_specs')
    .select('file_name, strategy_id, status, enabled, spec, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  const { data: backtestJobs, error: backtestError } = await supabase
    .from('alpha_strategy_backtest_jobs')
    .select('id, file_name, strategy_id, requested_at, requested_by, status, timeframe, lookback_days, symbol_mode, symbols, top_n, result, error, started_at, completed_at')
    .order('requested_at', { ascending: false })
    .limit(100);

  if (backtestError) {
    throw backtestError;
  }

  const latestBacktestByFile = new Map();
  (backtestJobs || []).forEach((row) => {
    if (!row.file_name || latestBacktestByFile.has(row.file_name)) {
      return;
    }
    latestBacktestByFile.set(row.file_name, row);
  });

  return {
    provider: 'supabase',
    root_path: null,
    spec_dir: 'supabase:alpha_strategy_specs',
    base_config_path: 'remote-control-plane',
    candidate_output_path: 'synced-by-alpha-engine',
    restart_required: false,
    sync_required: true,
    latest_apply_job: await getLatestApplyJob(supabase),
    strategies: (data || []).map((row) => ({
      file_name: row.file_name,
      file_path: `supabase:${row.file_name}`,
      updated_at: row.updated_at,
      spec: row.spec,
      latest_backtest_job: latestBacktestByFile.get(row.file_name) || null,
    })),
  };
}

async function saveRemoteAlphaStrategy(fileName, spec) {
  const supabase = getSupabase();
  const payload = {
    file_name: fileName,
    strategy_id: spec.strategy_id,
    status: spec.status || 'candidate',
    enabled: Boolean(spec.enabled),
    spec,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('alpha_strategy_specs').upsert(payload);
  if (error) {
    throw error;
  }

  return {
    provider: 'supabase',
    sync_required: true,
    saved: true,
    strategy: {
      file_name: fileName,
      file_path: `supabase:${fileName}`,
      spec,
    },
  };
}

async function applyRemoteAlphaStrategies() {
  const supabase = getSupabase();
  const { data: strategies, error: readError } = await supabase
    .from('alpha_strategy_specs')
    .select('strategy_id, status, enabled')
    .eq('status', 'candidate');

  if (readError) {
    throw readError;
  }

  const candidateStrategies = (strategies || []).filter((row) => row.enabled !== false);
  const requestedAt = new Date().toISOString();
  const { data: job, error: writeError } = await supabase
    .from('alpha_strategy_apply_jobs')
    .insert({
      requested_at: requestedAt,
      requested_by: 'trend-screener',
      statuses: ['candidate'],
      status: 'pending',
      result: {
        strategy_count: candidateStrategies.length,
        strategies: candidateStrategies.map((row) => row.strategy_id),
      },
    })
    .select('id, requested_at, status, statuses, result')
    .single();

  if (writeError) {
    throw writeError;
  }

  return {
    provider: 'supabase',
    applied: true,
    queued: true,
    restart_required: false,
    sync_required: true,
    strategy_count: candidateStrategies.length,
    strategies: candidateStrategies.map((row) => row.strategy_id),
    job,
  };
}

async function runRemoteAlphaStrategyBacktest(fileName) {
  const supabase = getSupabase();
  const { data: row, error: readError } = await supabase
    .from('alpha_strategy_specs')
    .select('file_name, strategy_id, spec')
    .eq('file_name', fileName)
    .maybeSingle();

  if (readError) {
    throw readError;
  }
  if (!row?.spec) {
    throw new Error(`Strategy not found: ${fileName}`);
  }

  const backtest = row.spec?.backtest && typeof row.spec.backtest === 'object' ? row.spec.backtest : {};
  const symbolMode = String(backtest.symbol_mode || 'top_n');
  const manualSymbols = Array.isArray(backtest.symbols)
    ? backtest.symbols.map((item) => String(item).trim().toUpperCase()).filter(Boolean)
    : [];
  const topN = Number(backtest.top_n || 20);
  const lookbackDays = Number(backtest.lookback_days || 60);
  const timeframe = String(backtest.timeframe || row.spec?.timeframes?.trigger || '15m');

  const { data: job, error: writeError } = await supabase
    .from('alpha_strategy_backtest_jobs')
    .insert({
      file_name: row.file_name,
      strategy_id: row.strategy_id,
      spec: row.spec,
      requested_at: new Date().toISOString(),
      requested_by: 'trend-screener',
      status: 'pending',
      timeframe,
      lookback_days: lookbackDays,
      symbol_mode: symbolMode,
      symbols: manualSymbols,
      top_n: topN,
      result: {
        strategy_id: row.strategy_id,
        timeframe,
        lookback_days: lookbackDays,
        symbol_mode: symbolMode,
        symbols: manualSymbols,
        top_n: topN,
      },
    })
    .select('id, file_name, strategy_id, requested_at, requested_by, status, timeframe, lookback_days, symbol_mode, symbols, top_n, result, error, started_at, completed_at')
    .single();

  if (writeError) {
    throw writeError;
  }

  return {
    provider: 'supabase',
    queued: true,
    completed: false,
    sync_required: true,
    job,
  };
}

export async function listAlphaStrategies() {
  const mode = await resolveProviderMode();
  return mode === 'supabase' ? listRemoteAlphaStrategies() : runStrategyConsole(['list']);
}

export async function saveAlphaStrategy(fileName, spec) {
  const mode = await resolveProviderMode();
  return mode === 'supabase'
    ? saveRemoteAlphaStrategy(fileName, spec)
    : runStrategyConsole(['save', '--file-name', fileName], { spec });
}

export async function applyAlphaStrategies() {
  const mode = await resolveProviderMode();
  return mode === 'supabase' ? applyRemoteAlphaStrategies() : runStrategyConsole(['apply']);
}

export async function runAlphaStrategyBacktest(fileName) {
  const mode = await resolveProviderMode();
  return mode === 'supabase'
    ? runRemoteAlphaStrategyBacktest(fileName)
    : runStrategyBacktest(fileName);
}
