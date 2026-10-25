$ErrorActionPreference='Stop'
$lvxConfig=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'lab-config.json') | ConvertFrom-Json
$lvxHealth=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$lvxConfig.port+'/health') -TimeoutSec 3
if($lvxHealth.lab -ne $lvxConfig.marker -or $lvxHealth.workspace -ne (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'workspace')).Path){throw 'This is not this copy of the LVX showcase service.'}
Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$lvxConfig.port+'/admin/stop') -TimeoutSec 3 | Out-Null
Write-Output 'The separate showcase service has stopped. Your normal Studio data was not changed.'
