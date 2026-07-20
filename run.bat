@echo off
cd /d "%~dp0"
echo.
echo  OpenArmX MAGIC.EXE 전용 드럼 타임라인 시뮬레이터
echo  http://localhost:8084/magicexe_drum_simulator/
echo  종료: Ctrl+C
echo.
python serve.py
pause
