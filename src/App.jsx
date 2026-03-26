import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import ChartDetail from './components/ChartDetail';
import BacktestReport from './components/BacktestReport';
import AlphaSignals from './components/AlphaSignals';
import WinRateCalculator from './components/WinRateCalculator';

const COPY = {
  eyebrow: '趨勢篩選器',
  title: '從幾百個幣裡快速挑出值得打開圖看的候選',
  description:
    '程式負責掃描、評分與畫線，人眼負責最終判斷，幫你在 Binance USDT-M 合約市場裡更快找到圖形乾淨、穩定上升的標的。',
  dashboard: '儀表板',
  backtest: '回測報告',
  alpha: '即時訊號',
  winrate: '勝率計算',
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
            <AppNavLink to="/winrate">{COPY.winrate}</AppNavLink>
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
        <Route path="/winrate" element={<WinRateCalculator />} />
      </Routes>
    </AppShell>
  );
}
