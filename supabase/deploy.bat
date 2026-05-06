@echo off
REM Deploy do backend Supabase do CMS VejaSeuSIte (rodar uma vez)
REM Pre-requisito: SQL ja aplicado no SQL Editor

setlocal
set REF=zrpirpdspltxdyniqogq

echo === 1. Login no Supabase (abre o navegador na primeira vez) ===
call npx --yes supabase login
if errorlevel 1 goto erro

echo === 2. Deploy da Edge Function github-proxy ===
call npx supabase functions deploy github-proxy --project-ref %REF% --no-verify-jwt
if errorlevel 1 goto erro

echo === 3. Configurar GITHUB_PAT como secret ===
set /p PAT="Cole o PAT do GitHub (ex: gho_... ou github_pat_...): "
call npx supabase secrets set GITHUB_PAT=%PAT% --project-ref %REF%
if errorlevel 1 goto erro

echo === 4. Inserir Henrique na tabela clients (depois do SQL aplicado) ===
call setup-client.bat
if errorlevel 1 goto erro

echo.
echo ===============================================
echo Deploy concluido com sucesso!
echo Acesse https://vejaseusite.github.io/HenriqueSilva/admin/
echo ===============================================
goto fim

:erro
echo.
echo Algo deu errado. Verifique a mensagem acima.
exit /b 1

:fim
endlocal
