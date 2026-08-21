@echo off
cd /d "%~dp0"

REM 배포 전 검수용. Vercel 에 올라갈 site 폴더를 그대로 localhost 에 띄운다.
REM 올라갈 파일과 똑같은 것을 보는 것이 목적이라 빌드부터 다시 한다.
REM
REM   preview.bat         localhost 에서만 (기본)
REM   preview.bat phone   같은 와이파이의 폰에서도 볼 수 있게
REM
REM 인코딩 주의 (두 가지가 다르다)
REM   1. 이 파일 자체는 CP949(ANSI) 로 저장한다. UTF-8 로 두면 cmd 가
REM      한글 줄을 명령으로 잘못 읽어 통째로 실행되지 않는다.
REM   2. 도구 스크립트는 UTF-8 로 출력한다. 그래서 파이썬을 부를 때만
REM      코드페이지를 65001 로 바꿨다가 되돌린다 (:py 아래).

if not exist ".venv\Scripts\python.exe" (
  echo 가상환경이 없습니다. run.bat 을 먼저 한 번 실행해 주세요.
  pause
  exit /b 1
)

echo.
echo  [1/3] 랜딩 + 가이드북 빌드...
call :py tools\build_site.py
if errorlevel 1 goto fail

echo  [2/3] 웹앱 빌드...
call :py tools\build_webapp.py
if errorlevel 1 goto fail

echo  [3/3] 배포 전 검사...
call :py tools\check_site.py
if errorlevel 1 goto fail

set BIND=127.0.0.1
if /i "%~1"=="phone" set BIND=0.0.0.0

echo.
echo   랜딩      http://localhost:8850/
echo   가이드북   http://localhost:8850/guide/
echo   웹앱      http://localhost:8850/app/

if /i "%~1"=="phone" (
  echo.
  echo   폰에서는 같은 와이파이에서 아래 주소로:
  for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo      http://%%a:8850/
)

echo.
echo   끝낼 때는 이 창에서 Ctrl+C
echo.

start "" http://localhost:8850/

REM --directory 로 띄운다. 안 그러면 이 창이 site 폴더를 붙잡고 있어서
REM 다음 빌드 때 site 를 지우지 못하고 실패한다.
.venv\Scripts\python.exe -m http.server 8850 --bind %BIND% --directory site
goto :eof

REM 파이썬은 UTF-8 로 찍는다. 그동안만 콘솔을 65001 로 두고 되돌린다.
:py
chcp 65001 > nul
.venv\Scripts\python.exe %*
set RC=%errorlevel%
chcp 949 > nul
exit /b %RC%

:fail
echo.
echo   빌드 또는 검사에서 걸렸습니다. 위 메시지를 확인해 주세요.
pause
