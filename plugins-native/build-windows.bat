@echo off
:: VirgoAudioMasters — Windows build launcher (cmd fallback for build-windows.ps1)
:: Double-click this file or run from a terminal to build the VST3 plugins.
::
:: Requirements: CMake, Visual Studio 2019/2022 (C++ workload), Git
:: See build-windows.ps1 for full documentation.

echo.
echo ============================================
echo  VirgoAudioMasters VST3 Build
echo ============================================
echo.

:: Try to run the PowerShell script with bypassed execution policy
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1" %*
if %ERRORLEVEL% neq 0 (
    echo.
    echo Build failed! See error above.
    pause
    exit /b %ERRORLEVEL%
)
pause
