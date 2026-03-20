import { getScanResults, getScannerStatus, triggerScan } from './binanceApi';

export async function loadDashboardSnapshot(filters = {}) {
  const [status, scan] = await Promise.all([getScannerStatus(), getScanResults(filters)]);

  return {
    status,
    rows: scan.results || [],
    meta: scan.meta || {},
  };
}

export function createPollingLoop(task, intervalMs) {
  let timerId = null;

  const run = async () => {
    await task();
  };

  timerId = window.setInterval(run, intervalMs);

  return () => {
    if (timerId) {
      window.clearInterval(timerId);
    }
  };
}

export { triggerScan };
