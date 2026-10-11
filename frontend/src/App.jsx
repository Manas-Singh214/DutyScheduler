import React, { useEffect, useState } from 'react';
import { saveAs } from 'file-saver';
import { ArrowDownToLine, CalendarDays, History, LogOut, MailPlus, ShieldCheck, Upload } from 'lucide-react';
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

function allocateLocally(formData) {
  const teachers = [...new Set(formData.teachers.map((name) => name.trim()).filter(Boolean))];
  const rooms = [...new Set(formData.rooms.map((name) => name.trim()).filter(Boolean))];
  if (rooms.length > teachers.length) throw new Error('Each shift needs at least as many teachers as rooms.');
  const counts = Object.fromEntries(teachers.map((teacher) => [teacher, 0]));
  const schedule = formData.sessions.map((session, index) => {
    const used = new Set();
    const assignments = rooms.map((room) => {
      const choices = teachers.filter((teacher) => !used.has(teacher));
      const minimum = Math.min(...choices.map((teacher) => counts[teacher]));
      const tied = choices.filter((teacher) => counts[teacher] === minimum);
      const teacher = tied[Math.floor(Math.random() * tied.length)];
      used.add(teacher);
      counts[teacher] += 1;
      return { room, teacher };
    });
    return {
      session_id: session.id || `session_${index + 1}`,
      date: session.date,
      time_slot: session.time_slot,
      session_name: session.session_name || `Session ${index + 1}`,
      assignments
    };
  });
  const assigned = new Set(schedule.flatMap((session) => session.assignments.map((assignment) => assignment.teacher)));
  return {
    school_name: formData.school_name,
    exam_name: formData.exam_name,
    schedule,
    fairness_matrix: teachers.map((teacher) => ({ teacher, total_duties: counts[teacher] })),
    total_teachers: teachers.length,
    total_rooms: rooms.length,
    total_shifts: rooms.length * schedule.length,
    standby_teachers: teachers.filter((teacher) => !assigned.has(teacher)),
    history_totals: Object.fromEntries(teachers.map((teacher) => [teacher, 0]))
  };
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [account, setAccount] = useState(null);
  const [mode, setMode] = useState('home');
  const [authMode, setAuthMode] = useState('login');
  const [schoolName, setSchoolName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const [error, setError] = useState('');
  const [allocationData, setAllocationData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [history, setHistory] = useState({});
  const [historyMessage, setHistoryMessage] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [linkToken, setLinkToken] = useState('');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const verifyToken = query.get('verify_token');
    const inviteToken = query.get('invite_token');
    const resetToken = query.get('reset_token');
    if (verifyToken) {
      setMode('workspace');
      setAuthMode('login');
      request('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verifyToken }) })
        .then((result) => setAccountMessage(result.message))
        .catch((cause) => setError(cause.message));
      window.history.replaceState({}, '', window.location.pathname);
    } else if (inviteToken || resetToken) {
      setLinkToken(inviteToken || resetToken);
      setMode('workspace');
      setAuthMode(inviteToken ? 'invite' : 'reset');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setAccount(null);
      return;
    }
    request('/auth/me', {}, token)
      .then((result) => setAccount(result))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken('');
      });
  }, [token]);

  const handleAccountAction = async (event) => {
    event.preventDefault();
    setError('');
    setAccountMessage('');
    try {
      if (authMode === 'register') {
        const result = await request('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ school_name: schoolName, email, password })
        });
        setAccountMessage(result.message);
      } else if (authMode === 'invite' || authMode === 'reset') {
        const path = authMode === 'invite' ? '/auth/invite/accept' : '/auth/password-reset/confirm';
        const result = await request(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: linkToken, password })
        });
        setAccountMessage(result.message);
        setAuthMode('login');
        setLinkToken('');
      } else if (authMode === 'forgot') {
        const result = await request('/auth/password-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        setAccountMessage(result.message);
      } else {
        const result = await request('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        localStorage.setItem(TOKEN_KEY, result.access_token);
        setToken(result.access_token);
        setAccount({ email: result.email, role: result.role, school_name: result.school_name });
        setMode('home');
        setPassword('');
      }
    } catch (cause) {
      setError(cause.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setAccount(null);
    setMode('home');
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

  const sendInvite = async (event) => {
    event.preventDefault();
    setError('');
    setHistoryMessage('');
    try {
      const result = await request('/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail })
      }, token);
      setHistoryMessage(result.message);
      setInviteEmail('');
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
      }, mode === 'workspace' ? token : '');
      setAllocationData({ ...data, exam_id: crypto.randomUUID(), workspace: mode === 'workspace' });
    } catch (cause) {
      if (mode === 'workspace') {
        setError(cause.message);
      } else {
        try {
          setAllocationData({ ...allocateLocally(formData), exam_id: crypto.randomUUID(), workspace: false });
          setError('Backend unavailable; generated this one-time schedule in your browser.');
        } catch (fallbackError) {
          setError(`Could not generate the schedule: ${fallbackError.message}`);
        }
      }
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
        {allocationData ? (
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
        ) : mode === 'history' && account ? (
          <HistoryView history={history} busy={historyBusy} message={historyMessage} onImport={importHistory} onExport={downloadHistory} onBack={() => setMode('home')} />
        ) : mode === 'workspace' && !account ? (
          <AccountPanel
            authMode={authMode}
            setAuthMode={setAuthMode}
            schoolName={schoolName}
            setSchoolName={setSchoolName}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            message={accountMessage}
            onSubmit={handleAccountAction}
            onBack={() => { setMode('home'); setError(''); }}
          />
        ) : mode === 'invite' && account?.role === 'admin' ? (
          <section className="mx-auto max-w-xl px-4 py-8">
            <div className="glass-panel p-6">
              <button onClick={() => setMode('home')} className="mb-4 text-sm text-slate-600">← Back</button>
              <h1 className="text-xl font-semibold">Invite staff</h1>
              <p className="my-2 text-sm text-slate-600">They’ll join {account.school_name}’s private duty-history workspace.</p>
              <form onSubmit={sendInvite} className="mt-4 flex gap-2">
                <input className="glass-input min-w-0 flex-1 px-3 py-2" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="staff@school.edu" />
                <button className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white">Send invite</button>
              </form>
              {historyMessage && <p className="mt-3 text-sm text-emerald-800">{historyMessage}</p>}
            </div>
          </section>
        ) : mode === 'workspace' || mode === 'one-time' ? (
          <DataEntryForm onSubmit={handleGenerateAllocation} loading={loading} />
        ) : (
          <HomeScreen account={account} onChoose={setMode} onOpenHistory={openHistory} onLogout={handleLogout} onInvite={() => setMode('invite')} />
        )}
      </main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">Exam Duty Allocator · School-private duty history</footer>
    </div>
  );
}

function HomeScreen({ account, onChoose, onOpenHistory, onLogout, onInvite }) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Exam Duty Allocator</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Plan duties with continuity.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Generate a one-time chart or balance the next exam against your school’s past assignments.</p>
        </div>
        {account && <div className="flex items-center gap-3 text-sm text-slate-600"><span>{account.school_name} · {account.email}</span><button onClick={onLogout} title="Sign out" className="rounded border border-slate-300 p-2"><LogOut size={16} /></button></div>}
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <button onClick={() => onChoose('one-time')} className="glass-panel group p-6 text-left transition hover:border-emerald-600">
          <CalendarDays className="text-emerald-800" size={22} />
          <h2 className="mt-5 text-lg font-semibold text-slate-900">One-time schedule</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Create, review, and export a chart without account setup or saved history.</p>
          <span className="mt-5 inline-block text-sm font-medium text-emerald-800">Start a schedule →</span>
        </button>
        <button onClick={() => onChoose('workspace')} className="glass-panel group p-6 text-left transition hover:border-emerald-600">
          <ShieldCheck className="text-emerald-800" size={22} />
          <h2 className="mt-5 text-lg font-semibold text-slate-900">School workspace</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Use private school accounts and past exam totals to keep assignments balanced over time.</p>
          <span className="mt-5 inline-block text-sm font-medium text-emerald-800">{account ? 'Generate with history →' : 'Sign in or register →'}</span>
        </button>
      </div>
      {account && <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button onClick={onOpenHistory} className="glass-panel flex items-center gap-3 p-4 text-left text-sm font-medium text-slate-800"><History className="text-emerald-800" size={18} />Manage past-duty history</button>
        {account.role === 'admin' && <button onClick={onInvite} className="glass-panel flex items-center gap-3 p-4 text-left text-sm font-medium text-slate-800"><MailPlus className="text-emerald-800" size={18} />Invite school staff</button>}
      </div>}
    </section>
  );
}

function AccountPanel({ authMode, setAuthMode, schoolName, setSchoolName, email, setEmail, password, setPassword, message, onSubmit, onBack }) {
  const needsPassword = !['forgot'].includes(authMode);
  const title = { login: 'Sign in to your school', register: 'Create a school workspace', invite: 'Join your school workspace', reset: 'Choose a new password', forgot: 'Reset your password' }[authMode];
  return (
    <section className="mx-auto max-w-md px-4 py-10">
      <div className="glass-panel p-6 sm:p-8">
        <button onClick={onBack} className="mb-5 text-sm text-slate-600">← Back</button>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">School schedules and duty history are visible only to members of that school.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {authMode === 'register' && <label className="block text-sm text-slate-700">School name<input required minLength={2} className="glass-input mt-1 block w-full px-3 py-2" value={schoolName} onChange={(event) => setSchoolName(event.target.value)} /></label>}
          {authMode !== 'invite' && authMode !== 'reset' && <label className="block text-sm text-slate-700">School email<input required type="email" className="glass-input mt-1 block w-full px-3 py-2" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
          {needsPassword && <label className="block text-sm text-slate-700">Password<input required type="password" minLength={authMode === 'login' ? 1 : 12} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} className="glass-input mt-1 block w-full px-3 py-2" value={password} onChange={(event) => setPassword(event.target.value)} />{authMode !== 'login' && <span className="mt-1 block text-xs text-slate-500">Use at least 12 characters.</span>}</label>}
          <button className="w-full rounded-md bg-emerald-800 px-4 py-2.5 text-sm font-medium text-white">{authMode === 'login' ? 'Sign in' : authMode === 'register' ? 'Create account and verify email' : authMode === 'forgot' ? 'Email reset link' : 'Continue'}</button>
        </form>
        {message && <p role="status" className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
        {['login', 'register'].includes(authMode) && <div className="mt-5 flex justify-between text-sm">
          {authMode === 'login' ? <><button onClick={() => setAuthMode('register')} className="text-emerald-800">Register a school</button><button onClick={() => setAuthMode('forgot')} className="text-slate-600">Forgot password?</button></> : <button onClick={() => setAuthMode('login')} className="text-emerald-800">Already registered? Sign in</button>}
        </div>}
        {authMode === 'forgot' && <button onClick={() => setAuthMode('login')} className="mt-4 text-sm text-emerald-800">Return to sign in</button>}
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
