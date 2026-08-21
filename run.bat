@echo off
REM 이 파일은 CP949(ANSI) + CRLF 로 저장한다.
REM UTF-8 로 저장하면 cmd 가 한글 줄을 깨뜨려 읽는다.
REM (.gitattributes 의 *.bat -text 가 변환을 막고 있다)
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] 가상환경을 만듭니다...
  python -m venv .venv
  echo [2/3] 패키지를 설치합니다...
  .venv\Scripts\python.exe -m pip install --upgrade pip
  .venv\Scripts\python.exe -m pip install -r requirements.txt
  echo [3/3] Chromium 렌더러를 설치합니다...
  .venv\Scripts\python.exe -m playwright install chromium
)

echo.
echo  카드뉴스 스튜디오  ->  http://127.0.0.1:8765
echo.
start "" http://127.0.0.1:8765
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8765
