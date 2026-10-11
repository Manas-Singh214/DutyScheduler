import React, { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowLeftRight, Check, RotateCcw } from 'lucide-react';

function pairSessions(schedule) {
  const byDate = new Map();
  schedule.forEach((session) => {
    const items = byDate.get(session.date) || [];
    items.push(session);
    byDate.set(session.date, items);
  });
  const days = [...byDate.entries()];
  const multiPerDate = days.some(([, items]) => items.length > 1);
  const pairs = [];
  if (multiPerDate) {
    days.forEach(([date, sessions]) => {
      for (let index = 0; index < sessions.length; index += 2) {
        pairs.push({ id: `${date}-${index}`, date, first: sessions[index], second: sessions[index + 1] || null });
      }
    });
  } else {
    for (let index = 0; index < schedule.length; index += 2) {
      const first = schedule[index];
      const second = schedule[index + 1] || null;
      pairs.push({ id: first.session_id, date: first.date, first, second });
    }
  }
  return pairs;
}

function countCurrent(schedule, teachers) {
  const counts = Object.fromEntries(teachers.map((name) => [name, 0]));
  schedule.forEach((session) => session.assignments.forEach(({ teacher }) => {
    counts[teacher] = (counts[teacher] || 0) + 1;
  }));
  return counts;
}

export default function Dashboard({ data, onUpdateSchedule, onExportWord, exporting, exportSuccess, workspace, historySaved, onSaveExam }) {
  const groups = useMemo(() => pairSessions(data?.schedule || []), [data?.schedule]);
  const [activeId, setActiveId] = useState(groups[0]?.id || '');
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const active = groups.find((group) => group.id === activeId) || groups[0];
  if (!data || !active) return null;

  const teacherNames = data.fairness_matrix.map((item) => item.teacher);
  const rooms = [...new Set([...active.first.assignments, ...(active.second?.assignments || [])].map((item) => item.room))];
  const currentCounts = countCurrent(data.schedule, teacherNames);
  const effectiveCounts = Object.fromEntries(teacherNames.map((teacher) => [
    teacher,
    (data.history_totals?.[teacher] || 0) + (currentCounts[teacher] || 0)
  ]));
  const currentSpread = Math.max(...Object.values(effectiveCounts)) - Math.min(...Object.values(effectiveCounts));
  const findSlot = (slot) => {
    const session = data.schedule.find((item) => item.session_id === slot.sessionId);
    return session?.assignments.find((item) => item.room === slot.room);
  };

  const completeSwap = (target, replacement) => {
    const source = findSlot(selected);
    if (!source) return;
    const updated = data.schedule.map((session) => ({
      ...session,
      assignments: session.assignments.map((assignment) => {
        if (session.session_id === selected.sessionId && assignment.room === selected.room) {
          return { ...assignment, teacher: replacement };
        }
        if (target && session.session_id === target.sessionId && assignment.room === target.room) {
          return { ...assignment, teacher: source.teacher };
        }
        return assignment;
      })
    }));
    const nextCounts = countCurrent(updated, teacherNames);
    const totals = teacherNames.map((teacher) => (data.history_totals?.[teacher] || 0) + nextCounts[teacher]);
    const nextSpread = Math.max(...totals) - Math.min(...totals);
    if (nextSpread > currentSpread) {
      setNotice('This exchange would worsen the school-wide duty balance. Choose another teacher.');
      return;
    }
    const fairness = teacherNames.map((teacher) => ({ teacher, total_duties: nextCounts[teacher] }));
    onUpdateSchedule({ ...data, schedule: updated, fairness_matrix: fairness });
    setNotice(`Updated ${source.teacher} to ${replacement}.`);
    setSelected(null);
  };

  const assignedInSession = (session) => new Set((session?.assignments || []).map((item) => item.teacher));
  const selectedSession = selected && data.schedule.find((session) => session.session_id === selected.sessionId);
  const selectedAssignment = selected && findSlot(selected);
  const shiftStandby = selectedSession
    ? teacherNames.filter((name) => !assignedInSession(selectedSession).has(name))
    : [];
  const acceptableStandby = shiftStandby.filter((name) => {
    const nextCounts = { ...currentCounts, [name]: (currentCounts[name] || 0) + 1 };
    nextCounts[selectedAssignment?.teacher] = Math.max(0, (nextCounts[selectedAssignment?.teacher] || 0) - 1);
    const totals = teacherNames.map((teacher) => (data.history_totals?.[teacher] || 0) + nextCounts[teacher]);
    return Math.max(...totals) - Math.min(...totals) <= currentSpread;
  });

  const selectSlot = (session, room) => {
    const next = { sessionId: session.session_id, room };
    if (!selected) {
      setSelected(next);
      setNotice('Choose another duty to exchange, or assign an eligible standby teacher.');
    } else if (selected.sessionId === next.sessionId && selected.room === next.room) {
      setSelected(null);
      setNotice('');
    } else {
      completeSwap(next, findSlot(next)?.teacher);
    }
  };

  const freeForShift = (session) => {
    const assigned = assignedInSession(session);
    return teacherNames.filter((teacher) => !assigned.has(teacher));
  };

  return (
    <section className="mx-auto max-w-6xl space-y-5 px-4 py-7">
      <header className="glass-panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">{data.school_name}</p>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{data.exam_name}</h1>
          <p className="mt-1 text-sm text-slate-600">{data.total_rooms} rooms · {data.total_shifts} duties · {data.total_teachers} teachers</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspace && <button disabled={historySaved} onClick={() => onSaveExam(data)} className="inline-flex items-center gap-2 rounded-md border border-emerald-800 px-3 py-2 text-sm font-medium text-emerald-900 disabled:opacity-50"><Check size={16} />{historySaved ? 'History saved' : 'Mark exam complete'}</button>}
          <button onClick={onExportWord} disabled={exporting} className="inline-flex items-center gap-2 rounded-md bg-emerald-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><ArrowDownToLine size={16} />{exporting ? 'Preparing…' : exportSuccess ? 'Downloaded' : 'Export compact Word chart'}</button>
        </div>
      </header>

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Exam shift pairs">
        {groups.map((group, index) => <button key={group.id} onClick={() => { setActiveId(group.id); setSelected(null); }} className={`shrink-0 rounded-md border px-3 py-2 text-sm ${active.id === group.id ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{group.date} · Shift pair {index + 1}</button>)}
      </nav>

      <div className="glass-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div><h2 className="font-semibold text-slate-900">Room duty chart</h2><p className="mt-1 text-xs text-slate-600">{active.first.session_name} · {active.first.time_slot}{active.second ? `  /  ${active.second.session_name} · ${active.second.time_slot}` : '  /  No second shift'}</p></div>
          <p className="inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeftRight size={14} />Select a duty, then another duty or standby teacher to exchange.</p>
        </div>
        {notice && <p role="status" className="border-b border-slate-100 px-4 py-2 text-sm text-emerald-900">{notice}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr><th className="w-1/4 px-4 py-3">Room no.</th><th className="px-4 py-3">Shift 1 · {active.first.session_name}</th><th className="px-4 py-3">Shift 2 · {active.second?.session_name || 'Not scheduled'}</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rooms.map((room) => {
                const first = active.first.assignments.find((item) => item.room === room);
                const second = active.second?.assignments.find((item) => item.room === room);
                return <tr key={room}>
                  <th scope="row" className="px-4 py-3 font-semibold text-slate-800">{room}</th>
                  {[{ session: active.first, assignment: first }, { session: active.second, assignment: second }].map(({ session, assignment }, index) => {
                    const isSelected = session && selected?.sessionId === session.session_id && selected?.room === room;
                    return <td key={index} className="px-4 py-2">
                      {session && assignment ? <button onClick={() => selectSlot(session, room)} className={`w-full rounded border px-3 py-2 text-left transition ${isSelected ? 'border-emerald-700 bg-emerald-50 ring-1 ring-emerald-700' : 'border-transparent hover:border-slate-300 hover:bg-slate-50'}`}>{assignment.teacher}{isSelected && <span className="ml-2 text-xs text-emerald-800">Selected</span>}</button> : <span className="px-3 text-slate-400">—</span>}
                    </td>;
                  })}
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        {[active.first, active.second].filter(Boolean).map((session, index) => {
          const free = freeForShift(session);
          return <div key={session.session_id} className="glass-panel p-4">
            <h3 className="text-sm font-semibold text-slate-900">Shift {index + 1} standby <span className="font-normal text-slate-500">({free.length})</span></h3>
            <p className="mt-1 text-xs text-slate-500">Available for emergency replacement in this shift.</p>
            {selected && session.session_id === selected.sessionId ? (
              <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {acceptableStandby.length ? acceptableStandby.map((teacher) => <button key={teacher} onClick={() => completeSwap(null, teacher)} className="rounded border border-emerald-700 bg-white px-2.5 py-1.5 text-xs text-emerald-900 hover:bg-emerald-50">{teacher} · assign</button>) : <p className="text-xs text-slate-500">No standby exchange keeps the historical duty balance.</p>}
              </div>
            ) : <p className="mt-3 text-sm leading-6 text-slate-700">{free.join(' · ') || 'No standby teachers'}</p>}
          </div>;
        })}
      </section>
      {selected && <button onClick={() => { setSelected(null); setNotice('Selection cleared.'); }} className="inline-flex items-center gap-2 text-sm text-slate-600"><RotateCcw size={14} />Cancel selected duty</button>}
    </section>
  );
}
