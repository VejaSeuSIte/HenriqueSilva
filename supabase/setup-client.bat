@echo off
REM Insere Henrique na tabela clients via REST. Roda DEPOIS do SQL ser aplicado.
REM User ja foi criado: 72eb001b-12b7-420c-aba1-07efeded0a72
REM
REM Uso:
REM   set SB_SECRET_KEY=<sua-service-role-key>
REM   setup-client.bat
REM
REM Ou cria um .env (gitignored) com SB_SECRET_KEY=...

setlocal
if "%SB_SECRET_KEY%"=="" (
  if exist .env (
    for /f "usebackq tokens=1,* delims==" %%a in (.env) do set %%a=%%b
  )
)
if "%SB_SECRET_KEY%"=="" (
  set /p SB_SECRET_KEY="Cole a service_role / sb_secret key: "
)

set URL=https://zrpirpdspltxdyniqogq.supabase.co/rest/v1/clients
set USER_ID=72eb001b-12b7-420c-aba1-07efeded0a72

curl -sS -X POST "%URL%" ^
  -H "apikey: %SB_SECRET_KEY%" ^
  -H "Authorization: Bearer %SB_SECRET_KEY%" ^
  -H "Content-Type: application/json" ^
  -H "Prefer: return=representation" ^
  --data-raw "{\"slug\":\"henriquesilva\",\"repo_owner\":\"VejaSeuSIte\",\"repo_name\":\"HenriqueSilva\",\"display_name\":\"Henrique Silva Advocacia\",\"owner_user_id\":\"%USER_ID%\"}"

echo.
endlocal
