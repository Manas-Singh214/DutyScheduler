import React from 'react';
import { Calendar, RefreshCw } from 'lucide-react';

export default function Navbar({ onReset, hasData }) {
  return (
    <header className="border-b border-slate-800 bg-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Branding */}
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <Calendar className="h-4 w-4 text-emerald-700" />
            </div>
            <div>
              <span className="font-semibold text-base text-slate-900 flex items-center gap-2">
                Exam Duty Allocator
              </span>
              <p className="text-xs text-slate-500">Examination scheduling</p>
            </div>
          </div>

          <div className="flex items-center">
            {hasData && (
              <button
                onClick={onReset}
                className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 px-3 py-2 rounded-lg border border-slate-700 transition"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                New Allocation
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
