@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "PYTHON=%BACKEND%\venv\Scripts\python.exe"

where.exe python >nul 2>nul
if errorlevel 1 (
    echo Python was not found. Install Python 3 and make sure it is on PATH.
    pause
    exit /b 1
)

where.exe npm.cmd >nul 2>nul
if errorlevel 1 (
    echo Node.js and npm were not found. Install Node.js and make sure it is on PATH.
    pause
    exit /b 1
)

if not exist "%PYTHON%" (
    echo Setting up the backend environment...
    python -m venv "%BACKEND%\venv"
    if errorlevel 1 goto setup_failed
)

echo Checking backend packages...
"%PYTHON%" -m pip install -r "%BACKEND%\requirements.txt"
if errorlevel 1 goto setup_failed

if not exist "%FRONTEND%\node_modules\vite\bin\vite.js" (
    echo Installing frontend packages...
    pushd "%FRONTEND%"
    call npm.cmd ci
    if errorlevel 1 (
        popd
        goto setup_failed
    )
    popd
)

echo Starting the Exam Scheduler...
start "Exam Scheduler Backend" /D "%BACKEND%" "%PYTHON%" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
start "Exam Scheduler Frontend" /D "%FRONTEND%" "%ComSpec%" /k npm.cmd run dev -- --host 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173"
exit /b 0

:setup_failed
echo.
echo Setup did not complete. Review the error above, then run EXAMSCHEDULER.bat again.
pause
exit /b 1
