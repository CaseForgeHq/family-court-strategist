$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  npm ci --ignore-scripts --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'MCP dependency installation failed.' }
  $releaseNode = (Get-Command node.exe).Source
  $releaseServer = Join-Path $PSScriptRoot 'server.mjs'
  codex mcp add caseforge_release -- $releaseNode $releaseServer
  if ($LASTEXITCODE -ne 0) { throw 'MCP registration failed.' }
  & $releaseNode (Join-Path $PSScriptRoot 'configure.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'MCP timeout configuration failed.' }
  codex mcp get caseforge_release
} finally { Pop-Location }
