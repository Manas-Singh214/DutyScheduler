import React, { useEffect, useState } from 'react';
import { saveAs } from 'file-saver';
import { ArrowDownToLine, CalendarDays, History, LogOut, Upload } from 'lucide-react';
import Navbar from './components/Navbar';
import DataEntryForm from './components/DataEntryForm';
import Dashboard from './components/Dashboard';
import { exportDocxClientSide } from './utils/docxExporter';
import { API_BASE_URL } from './utils/api';

const TOKEN_KEY = 'exam-duty-access-token';
const API = (path) => `${API_BASE_URL}${path}`;

async function request(path, options = {}, token = '') {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(API(path), { ...options, headers });
  const body = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : null;
  if (!response.ok) throw new Error(body?.detail || body?.message || `Request failed (${response.status}).`);
  return body;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [account, setAccount] = useState(null);
  const [mode, setMode] = useState('auth');
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [allocationData, setAllocationData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [history, setHistory] = useState({});
  const [historyMessage, setHistoryMessage] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setAccount(null);
      setAuthReady(true);
      return;
    }
    request('/auth/me', {}, token)
      .then((result) => {
        setAccount(result);
        setMode('home');
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken('');
        setMode('auth');
      })
      .finally(() => setAuthReady(true));
  }, [token]);

  const handleAccountAction = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const result = await request(`/auth/${authMode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      localStorage.setItem(TOKEN_KEY, result.access_token);
      setToken(result.access_token);
      setAccount({ username: result.username, role: result.role, school_name: result.school_name });
      setMode('home');
      setPassword('');
    } catch (cause) {
      setError(cause.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setAccount(null);
    setMode('auth');
    setHistory({});
    setAllocationData(null);
  };

  const openHistory = async () => {
    setMode('history');
    setHistoryBusy(true);
    setHistoryMessage('');
    try {
      setHistory(await request('/auth/history', {}, token));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setHistoryBusy(false);
    }
  };

  const importHistory = async (file) => {
    if (!file) return;
    setHistoryBusy(true);
    setHistoryMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await request('/auth/history/import', { method: 'POST', body: form }, token);
      setHistoryMessage(result.message);
      setHistory(await request('/auth/history', {}, token));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setHistoryBusy(false);
    }
  };

  const downloadHistory = async () => {
    try {
      const response = await fetch(API('/auth/history/export.xlsx'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Could not download the history workbook.');
      saveAs(await response.blob(), 'school-duty-history.xlsx');
    } catch (cause) {
      setError(cause.message);
    }
  };

  const handleGenerateAllocation = async (formData) => {
    setLoading(true);
    setError('');
    try {
      const data = await request('/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      }, token);
      setAllocationData({ ...data, exam_id: crypto.randomUUID(), workspace: true });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExportWord = async () => {
    if (!allocationData) return;
    setExporting(true);
    setExportSuccess(false);
    const safeSchool = (allocationData.school_name || 'Exam').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    try {
      const response = await fetch(API('/export'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_name: allocationData.school_name,
          exam_name: allocationData.exam_name,
          schedule: allocationData.schedule,
          fairness_matrix: allocationData.fairness_matrix
        })
      });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      saveAs(await response.blob(), `${safeSchool}_Exam_Schedule.docx`);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 4000);
    } catch {
      try {
        await exportDocxClientSide(allocationData);
        setExportSuccess(true);
        setTimeout(() => setExportSuccess(false), 4000);
      } catch (cause) {
        setError(`Could not export the Word document: ${cause.message}`);
      }
    } finally {
      setExporting(false);
    }
  };

  const handleSaveExam = async (data) => {
    setError('');
    try {
      const counts = Object.fromEntries(data.fairness_matrix.map((item) => [item.teacher, item.total_duties]));
      const result = await request('/auth/history/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exam_id: data.exam_id, exam_name: data.exam_name, teacher_counts: counts })
      }, token);
      setHistoryMessage(result.message);
      setAllocationData({ ...data, history_saved: true });
    } catch (cause) {
      setError(cause.message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Navbar onReset={() => { setAllocationData(null); setMode('home'); }} hasData={!!allocationData} />
      {error && <div role="alert" className="mx-auto mt-4 w-full max-w-5xl rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}<button className="float-right font-semibold" onClick={() => setError('')}>Dismiss</button></div>}
      <main className="flex-1">
        {!authReady ? (
          <p className="mx-auto max-w-md px-4 py-16 text-center text-sm text-slate-600">Loading your workspace…</p>
        ) : !account ? (
          <AccountPanel
            authMode={authMode}
            setAuthMode={setAuthMode}
            username={username}
            setUsername={setUsername}
            password={password}
            setPassword={setPassword}
            onSubmit={handleAccountAction}
          />
        ) : allocationData ? (
          <Dashboard
            data={allocationData}
            onUpdateSchedule={setAllocationData}
            onExportWord={handleExportWord}
            exporting={exporting}
            exportSuccess={exportSuccess}
            workspace={allocationData.workspace}
            historySaved={allocationData.history_saved}
            onSaveExam={handleSaveExam}
          />
        ) : mode === 'history' ? (
          <HistoryView history={history} busy={historyBusy} message={historyMessage} onImport={importHistory} onExport={downloadHistory} onBack={() => setMode('home')} />
        ) : mode === 'workspace' ? (
          <DataEntryForm onSubmit={handleGenerateAllocation} loading={loading} />
        ) : (
          <HomeScreen account={account} onChoose={setMode} onOpenHistory={openHistory} onLogout={handleLogout} />
        )}
      </main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">Exam Duty Allocator · Duty history stays with your username</footer>
    </div>
  );
}

function HomeScreen({ account, onChoose, onOpenHistory, onLogout }) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Exam Duty Allocator</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Plan duties with continuity.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Create a duty chart and keep your past exam assignments together in one private workspace.</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600"><span>{account.username}</span><button onClick={onLogout} title="Sign out" className="rounded border border-slate-300 p-2"><LogOut size={16} /></button></div>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <button onClick={() => onChoose('workspace')} className="glass-panel group p-6 text-left transition hover:border-emerald-600">
          <CalendarDays className="text-emerald-800" size={22} />
          <h2 className="mt-5 text-lg font-semibold text-slate-900">Create a duty schedule</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Generate, review, and download your exam duty chart.</p>
          <span className="mt-5 inline-block text-sm font-medium text-emerald-800">Start scheduling →</span>
        </button>
        <button onClick={onOpenHistory} className="glass-panel group p-6 text-left transition hover:border-emerald-600">
          <History className="text-emerald-800" size={22} />
          <h2 className="mt-5 text-lg font-semibold text-slate-900">Past-duty history</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Import, review, or download this username’s saved teacher totals.</p>
          <span className="mt-5 inline-block text-sm font-medium text-emerald-800">View history →</span>
        </button>
      </div>
      <p className="mt-5 text-sm text-slate-500">Forgot your username or password? Create a new account with a different username. Your old history cannot be recovered.</p>
    </section>
  );
}

function AccountPanel({ authMode, setAuthMode, username, setUsername, password, setPassword, onSubmit }) {
  const isRegistering = authMode === 'register';
  return (
    <section className="mx-auto max-w-md px-4 py-10">
      <div className="glass-panel p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Exam Duty Allocator</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-900">{isRegistering ? 'Create your account' : 'Sign in to schedule'}</h1>
        <p className="mt-2 text-sm text-slate-600">Use a username and password. No email or verification step is needed. To share history, teammates use the same login.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block text-sm text-slate-700">Username<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" autoComplete="username" className="glass-input mt-1 block w-full px-3 py-2" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="block text-sm text-slate-700">Password<input required type="password" minLength={isRegistering ? 12 : 1} maxLength={256} autoComplete={isRegistering ? 'new-password' : 'current-password'} className="glass-input mt-1 block w-full px-3 py-2" value={password} onChange={(event) => setPassword(event.target.value)} />{isRegistering && <span className="mt-1 block text-xs text-slate-500">Use at least 12 characters.</span>}</label>
          <button className="w-full rounded-md bg-emerald-800 px-4 py-2.5 text-sm font-medium text-white">{isRegistering ? 'Create account' : 'Sign in'}</button>
        </form>
        <button onClick={() => setAuthMode(isRegistering ? 'login' : 'register')} className="mt-5 text-sm font-medium text-emerald-800">
          {isRegistering ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
        {!isRegistering && <p className="mt-4 text-xs leading-5 text-slate-500">Forgot your login? Create a new account with a different username. Past history stays with the old account.</p>}
      </div>
    </section>
  );
}

function HistoryView({ history, busy, message, onImport, onExport, onBack }) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><button onClick={onBack} className="mb-4 text-sm text-slate-600">← Home</button><h1 className="text-2xl font-semibold text-slate-900">Past-duty history</h1><p className="mt-1 text-sm text-slate-600">Imported totals are added to existing history. The same workbook cannot be imported twice.</p></div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"><Upload size={16} />Import Excel<input className="sr-only" type="file" accept=".xlsx,.xlsm" onChange={(event) => onImport(event.target.files?.[0])} /></label>
          <button onClick={onExport} className="inline-flex items-center gap-2 rounded-md bg-emerald-800 px-3 py-2 text-sm text-white"><ArrowDownToLine size={16} />Download workbook</button>
        </div>
      </div>
      {busy && <p className="mt-5 text-sm text-slate-600">Updating history…</p>}
      {message && <p role="status" className="mt-4 text-sm text-emerald-800">{message}</p>}
      <div className="glass-panel mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3">Teacher</th><th className="px-4 py-3 text-right">Past duties</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{Object.entries(history).sort(([a], [b]) => a.localeCompare(b)).map(([teacher, count]) => <tr key={teacher}><td className="px-4 py-3 text-slate-800">{teacher}</td><td className="px-4 py-3 text-right tabular-nums text-slate-700">{count}</td></tr>)}
            {!Object.keys(history).length && <tr><td colSpan="2" className="px-4 py-8 text-center text-slate-500">No past-duty totals yet. Mark an exam complete or import an Excel workbook.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
