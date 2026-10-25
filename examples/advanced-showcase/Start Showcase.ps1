$ErrorActionPreference='Stop'
$lvxConfig=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'lab-config.json') | ConvertFrom-Json
$lvxRepo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot $lvxConfig.studioRoot))
$lvxNode=(Get-Command node -ErrorAction Stop).Source
$lvxLogs=Join-Path $PSScriptRoot 'evidence'
New-Item -ItemType Directory -Path $lvxLogs -Force | Out-Null
try{$lvxHealth=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$lvxConfig.port+'/health') -TimeoutSec 2}catch{$lvxHealth=$null}
if($lvxHealth -and ($lvxHealth.lab -ne $lvxConfig.marker -or $lvxHealth.workspace -ne (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'workspace')).Path)){throw 'The lab port belongs to another service or another copy of this lab. Stop that service before opening this copy.'}
if(-not $lvxHealth){Start-Process -FilePath $lvxNode -ArgumentList @('"'+(Join-Path $PSScriptRoot 'lab-server.cjs')+'"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $lvxLogs 'server-stdout.log') -RedirectStandardError (Join-Path $lvxLogs 'server-stderr.log');Start-Sleep -Seconds 2}
$lvxHealth=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$lvxConfig.port+'/health') -TimeoutSec 3
if($lvxHealth.lab -ne $lvxConfig.marker -or $lvxHealth.workspace -ne (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'workspace')).Path){throw 'The running service does not belong to this copy of the lab.'}
& $lvxNode (Join-Path $lvxRepo 'scripts/open-showcase.cjs') $PSScriptRoot
if($LASTEXITCODE -ne 0){throw 'Showcase profile could not be opened. Inspect evidence/server-stderr.log and the guide.'}
