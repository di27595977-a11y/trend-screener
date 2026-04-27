import { NavLink, Route, Routes } from 'react-router-dom';
import AlertScanner from './components/AlertScanner';
import AlphaSignals from './components/AlphaSignals';
import AlphaStrategyConsole from './components/AlphaStrategyConsole';
import BacktestReport from './components/BacktestReport';
import ChartDetail from './components/ChartDetail';
import CryptoAnalyzer from './components/CryptoAnalyzer';
import Dashboard from './components/Dashboard';
import RangeSignalsPage from './components/RangeSignalsPage';
import WinRateCalculator from './components/WinRateCalculator';

const COPY = {
  eyebrow: '趨勢交易控制台',
  title: '把掃描、回測、Alpha 訊號和策略控制收進同一個操作台',
  description:
    '先用趨勢面板把市場看清楚，再用策略控制台管理 Alpha 策略規格，最後把真正的 paper trading 交給 Alpha 交易核心。',
  dashboard: '總覽',
  backtest: '回測',
  alpha: 'Alpha 訊號',
  strategy: '策略控制',
  winrate: '勝率',
  analyzer: '分析',
  alerts: '警報',
  range: '區間',
};

function AppNavLink({ to, children, end = false }) {
  return (
    <NavLink
      end={end}
      to={to}
      className={({ isActive }) =>
        [
          'inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition',
          isActive
            ? 'border-emerald-400/80 bg-emerald-400/10 text-emerald-100'
            : 'border-white/10 bg-white/5 text-slate-300 hover:border-emerald-300/40 hover:text-white',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  );
}

function AppShell({ children }) {
  return (
    <div className="relative min-h-screen overflow-hidden text-slate-100">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.12),_transparent_28%),linear-gradient(180deg,#050816_0%,#0b1021_40%,#09111d_100%)]" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:56px_56px] opacity-20" />

      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 pb-8 pt-4 sm:px-6 sm:pt-5 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/55 px-4 py-4 shadow-[0_32px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:px-5 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">{COPY.eyebrow}</p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-3xl">{COPY.title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300 sm:text-base">{COPY.description}</p>
          </div>

          <nav className="grid grid-cols-4 gap-3 sm:flex sm:flex-wrap">
            <AppNavLink end to="/">
              {COPY.dashboard}
            </AppNavLink>
            <AppNavLink to="/backtest">{COPY.backtest}</AppNavLink>
            <AppNavLink to="/alpha">{COPY.alpha}</AppNavLink>
            <AppNavLink to="/strategy">{COPY.strategy}</AppNavLink>
            <AppNavLink to="/winrate">{COPY.winrate}</AppNavLink>
            <AppNavLink to="/analyzer">{COPY.analyzer}</AppNavLink>
            <AppNavLink to="/alerts">{COPY.alerts}</AppNavLink>
            <AppNavLink to="/range">{COPY.range}</AppNavLink>
          </nav>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/chart/:symbol" element={<ChartDetail />} />
        <Route path="/backtest" element={<BacktestReport />} />
        <Route path="/alpha" element={<AlphaSignals />} />
        <Route path="/strategy" element={<AlphaStrategyConsole />} />
        <Route path="/winrate" element={<WinRateCalculator />} />
        <Route path="/analyzer" element={<CryptoAnalyzer />} />
        <Route path="/alerts" element={<AlertScanner />} />
        <Route path="/range" element={<RangeSignalsPage />} />
      </Routes>
    </AppShell>
  );
}
