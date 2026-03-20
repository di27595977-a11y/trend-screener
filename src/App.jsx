import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import ChartDetail from './components/ChartDetail';
import BacktestReport from './components/BacktestReport';

function AppNavLink({ to, children, end = false }) {
  return (
    <NavLink
      end={end}
      to={to}
      className={({ isActive }) =>
        [
          'rounded-full border px-4 py-2 text-sm font-medium transition',
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

      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 pb-8 pt-5 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/55 px-5 py-5 shadow-[0_32px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">Trend Screener</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Scan fast. Draw structure. Let your eyes decide.
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300 sm:text-base">
              Binance USDT-M perpetual trend ranking with live prices, pattern overlays, and backtest feedback.
            </p>
          </div>

          <nav className="flex flex-wrap gap-3">
            <AppNavLink end to="/">
              Dashboard
            </AppNavLink>
            <AppNavLink to="/backtest">Backtest</AppNavLink>
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
      </Routes>
    </AppShell>
  );
}
