import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import ChartDetail from './components/ChartDetail';
import BacktestReport from './components/BacktestReport';

const COPY = {
  eyebrow: '\u8da8\u52e2\u7be9\u9078\u5668',
  title: '\u5f9e\u5e7e\u767e\u500b\u5e63\u88e1\u5feb\u901f\u6311\u51fa\u503c\u5f97\u6253\u958b\u5716\u770b\u7684\u5019\u9078',
  description:
    '\u7a0b\u5f0f\u8ca0\u8cac\u6383\u63cf\u3001\u8a55\u5206\u8207\u756b\u7dda\uff0c\u4eba\u773c\u8ca0\u8cac\u6700\u7d42\u5224\u65b7\uff0c\u5e6b\u4f60\u5728 Binance USDT-M \u5408\u7d04\u5e02\u5834\u88e1\u66f4\u5feb\u627e\u5230\u5716\u5f62\u4e7e\u6de8\u3001\u7a69\u5b9a\u4e0a\u5347\u7684\u6a19\u7684\u3002',
  dashboard: '\u5100\u8868\u677f',
  backtest: '\u56de\u6e2c\u5831\u544a',
};

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
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-emerald-300/75">{COPY.eyebrow}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{COPY.title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300 sm:text-base">{COPY.description}</p>
          </div>

          <nav className="flex flex-wrap gap-3">
            <AppNavLink end to="/">
              {COPY.dashboard}
            </AppNavLink>
            <AppNavLink to="/backtest">{COPY.backtest}</AppNavLink>
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
