import React, { useState } from 'react';
import { SAMPLE_DATA } from '../utils/sampleData';
import { getSpreadsheetColumnValues, readListSpreadsheet } from '../utils/spreadsheetImport';
import { ArrowLeft, Plus, Trash2, Sparkles, Send, Users, Building, Calendar, BookOpen, Upload } from 'lucide-react';

function dateOffsetFromToday(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function DataEntryForm({ onSubmit, loading, onCancel }) {
  const [schoolName, setSchoolName] = useState('');
  const [examName, setExamName] = useState('');
  const [sessions, setSessions] = useState([
    { id: '1', date: dateOffsetFromToday(0), time_slot: '09:00 AM - 12:00 PM', session_name: 'Morning Session' },
    { id: '2', date: dateOffsetFromToday(0), time_slot: '01:30 PM - 04:30 PM', session_name: 'Afternoon Session' },
  ]);
  const [teachersText, setTeachersText] = useState('');
  const [roomsText, setRoomsText] = useState('');
  const [teacherImport, setTeacherImport] = useState(null);
  const [roomImport, setRoomImport] = useState(null);
  const [importError, setImportError] = useState('');

  const loadDemoData = () => {
    setSchoolName(SAMPLE_DATA.school_name);
    setExamName(SAMPLE_DATA.exam_name);
    setSessions(SAMPLE_DATA.sessions.map(({ dateOffset, ...session }) => ({
      ...session,
      date: dateOffsetFromToday(dateOffset),
    })));
    setTeachersText(SAMPLE_DATA.teachersText);
    setRoomsText(SAMPLE_DATA.roomsText);
  };

  const addSession = () => {
    const newId = String(Date.now());
    setSessions([
      ...sessions,
      { id: newId, date: dateOffsetFromToday(1), time_slot: '09:00 AM - 12:00 PM', session_name: `Session ${sessions.length + 1}` }
    ]);
  };

  const removeSession = (id) => {
    if (sessions.length === 1) return;
    setSessions(sessions.filter(s => s.id !== id));
  };

  const updateSession = (id, field, value) => {
    setSessions(sessions.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const importSpreadsheet = async (file, listType) => {
    if (!file) return;

    try {
      const importedSheet = await readListSpreadsheet(file, listType);
      const columnValues = getSpreadsheetColumnValues(importedSheet, importedSheet.selectedColumn);
      if (columnValues.length === 0) {
        throw new Error('No values were found in the selected column.');
      }

      if (listType === 'teachers') {
        setTeacherImport(importedSheet);
        setTeachersText(columnValues.join('\n'));
      } else {
        setRoomImport(importedSheet);
        setRoomsText(columnValues.join('\n'));
      }
      setImportError('');
    } catch (error) {
      setImportError(`${file.name}: ${error.message}`);
    }
  };

  const selectImportColumn = (listType, columnIndex) => {
    const setImport = listType === 'teachers' ? setTeacherImport : setRoomImport;
    const importedSheet = listType === 'teachers' ? teacherImport : roomImport;
    const setText = listType === 'teachers' ? setTeachersText : setRoomsText;
    const updatedImport = { ...importedSheet, selectedColumn: Number(columnIndex) };

    setImport(updatedImport);
    setText(getSpreadsheetColumnValues(updatedImport, updatedImport.selectedColumn).join('\n'));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // Parse teachers & rooms split by newline or comma
    const teacherList = teachersText
      .split(/[\n,]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const roomList = roomsText
      .split(/[\n,]+/)
      .map(r => r.strip ? r.strip() : r.trim())
      .filter(r => r.length > 0);

    if (!schoolName.trim()) {
      alert("Please enter School / Institution Name");
      return;
    }
    if (!examName.trim()) {
      alert("Please enter Exam Name");
      return;
    }
    if (teacherList.length === 0) {
      alert("Please enter at least one teacher.");
      return;
    }
    if (roomList.length === 0) {
      alert("Please enter at least one room.");
      return;
    }

    onSubmit({
      school_name: schoolName.trim(),
      exam_name: examName.trim(),
      sessions: sessions.map(s => ({
        id: s.id,
        date: s.date,
        time_slot: s.time_slot,
        session_name: s.session_name
      })),
      teachers: teacherList,
      rooms: roomList
    });
  };

  // Quick stats
  const teacherCount = teachersText.split(/[\n,]+/).filter(t => t.trim()).length;
  const roomCount = roomsText.split(/[\n,]+/).filter(r => r.trim()).length;
  const totalShiftsRequired = sessions.length * roomCount;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            Configure Exam Schedule
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Input institutional details, exam sessions, teacher list, and available rooms.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </button>
          <button
            type="button"
            onClick={loadDemoData}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition shadow-lg shadow-indigo-500/10"
          >
            <Sparkles className="h-4 w-4 text-indigo-400" />
            Load Demo Data
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Institution & Exam Details */}
        <div className="glass-panel p-6 space-y-4">
          <h2 className="text-sm font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Basic Details
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">School / Institution Name</label>
              <input
                type="text"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="e.g. St. Xavier High School"
                required
                className="w-full glass-input px-3.5 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Exam Title / Semester</label>
              <input
                type="text"
                value={examName}
                onChange={(e) => setExamName(e.target.value)}
                placeholder="e.g. Annual Final Examinations 2026"
                required
                className="w-full glass-input px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Exam Sessions Manager */}
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Exam Sessions & Timings ({sessions.length})
            </h2>
            <button
              type="button"
              onClick={addSession}
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-medium px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20"
            >
              <Plus className="h-3.5 w-3.5" /> Add Session
            </button>
          </div>

          <div className="space-y-3">
            {sessions.map((session) => (
              <div key={session.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 items-center">
                <div className="md:col-span-4">
                  <label className="block text-[10px] uppercase text-slate-400 font-medium mb-1">Session Label</label>
                  <input
                    type="text"
                    value={session.session_name}
                    onChange={(e) => updateSession(session.id, 'session_name', e.target.value)}
                    className="w-full glass-input px-3 py-1.5 text-xs"
                    placeholder="e.g. Session 1"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[10px] uppercase text-slate-400 font-medium mb-1">Date</label>
                  <input
                    type="date"
                    value={session.date}
                    onChange={(e) => updateSession(session.id, 'date', e.target.value)}
                    className="w-full glass-input px-3 py-1.5 text-xs"
                  />
                </div>
                <div className="md:col-span-4">
                  <label className="block text-[10px] uppercase text-slate-400 font-medium mb-1">Timing Slot</label>
                  <input
                    type="text"
                    value={session.time_slot}
                    onChange={(e) => updateSession(session.id, 'time_slot', e.target.value)}
                    className="w-full glass-input px-3 py-1.5 text-xs"
                    placeholder="09:00 AM - 12:00 PM"
                  />
                </div>
                <div className="md:col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeSession(session.id)}
                    disabled={sessions.length === 1}
                    className="p-1.5 text-slate-500 hover:text-red-400 disabled:opacity-30 transition"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 3: Bulk Lists for Teachers and Rooms */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Teachers Textarea */}
          <div className="glass-panel p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                <Users className="h-4 w-4" /> Teachers List
              </h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {teacherCount} Teachers
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <Upload className="h-3.5 w-3.5" /> Import CSV / Excel
                <input type="file" accept=".csv,.xlsx,.xlsm" className="sr-only" onChange={e => importSpreadsheet(e.target.files?.[0], 'teachers')} />
              </label>
              {teacherImport && <span className="text-xs text-slate-500">{teacherImport.fileName}</span>}
            </div>
            {teacherImport?.columns.length > 1 && (
              <label className="block text-xs text-slate-600">Import column
                <select value={teacherImport.selectedColumn} onChange={e => selectImportColumn('teachers', e.target.value)} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1">
                  {teacherImport.columns.map((column, index) => <option key={index} value={index}>{column}</option>)}
                </select>
              </label>
            )}
            <p className="text-xs text-slate-500">Paste teacher names or import a CSV/XLSX file. Imported names remain editable.</p>
            <textarea
              rows={8}
              value={teachersText}
              onChange={(e) => setTeachersText(e.target.value)}
              placeholder="Dr. Robert Ford&#10;Prof. Eleanor Vance&#10;Sarah Connor&#10;Arthur Dent..."
              className="w-full glass-input p-3 text-xs leading-relaxed font-mono"
            />
          </div>

          {/* Rooms Textarea */}
          <div className="glass-panel p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                <Building className="h-4 w-4" /> Exam Rooms
              </h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {roomCount} Rooms
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <Upload className="h-3.5 w-3.5" /> Import CSV / Excel
                <input type="file" accept=".csv,.xlsx,.xlsm" className="sr-only" onChange={e => importSpreadsheet(e.target.files?.[0], 'rooms')} />
              </label>
              {roomImport && <span className="text-xs text-slate-500">{roomImport.fileName}</span>}
            </div>
            {roomImport?.columns.length > 1 && (
              <label className="block text-xs text-slate-600">Import column
                <select value={roomImport.selectedColumn} onChange={e => selectImportColumn('rooms', e.target.value)} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1">
                  {roomImport.columns.map((column, index) => <option key={index} value={index}>{column}</option>)}
                </select>
              </label>
            )}
            <p className="text-xs text-slate-500">Paste room numbers or import a CSV/XLSX file. Imported rooms remain editable.</p>
            <textarea
              rows={8}
              value={roomsText}
              onChange={(e) => setRoomsText(e.target.value)}
              placeholder="Hall A&#10;Hall B&#10;Room 101&#10;Room 102..."
              className="w-full glass-input p-3 text-xs leading-relaxed font-mono"
            />
          </div>
        </div>

        {importError && <p role="alert" className="text-sm text-red-700">{importError}</p>}

        {/* Summary Card & Generate Button */}
        <div className="glass-panel p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-400 space-y-1">
            <div className="flex items-center gap-4">
              <span>Required Shifts: <strong className="text-white">{totalShiftsRequired}</strong></span>
              <span>•</span>
              <span>Est. Avg Duties/Teacher: <strong className="text-blue-400">{teacherCount > 0 ? (totalShiftsRequired / teacherCount).toFixed(1) : 0}</strong></span>
            </div>
            <p className="text-slate-500">School schedules prioritize teachers with fewer saved duties; tied teachers are selected randomly.</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full md:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-xl shadow-blue-600/25 flex items-center justify-center gap-2.5 transition active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Balancing teacher duties...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Generate Invigilation Schedule
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
