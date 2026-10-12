param([Parameter(Mandatory=$true)][string]$PublicApi)
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $PublicApi).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolved 'Siemens.Engineering.dll'))) {
  throw 'PublicApi must be a TIA Portal PublicAPI Vxx folder containing Siemens.Engineering.dll'
}
$msbuild = Get-Command msbuild.exe -ErrorAction SilentlyContinue
if (-not $msbuild) { throw 'Visual Studio 2017 or later with .NET Framework 4.8 SDK is required' }
& $msbuild.Source "$PSScriptRoot\AquaFlow.TiaBridge.csproj" /t:Rebuild /p:Configuration=Release "/p:TIA_PUBLIC_API=$resolved"
if ($LASTEXITCODE -ne 0) { throw "Bridge build failed with exit code $LASTEXITCODE" }
$dll = Get-Item -LiteralPath (Join-Path $resolved 'Siemens.Engineering.dll')
$version = $dll.VersionInfo.FileVersion
$assemblyUri = ([Uri](Join-Path $resolved 'Siemens.Engineering.dll')).AbsoluteUri.Replace('&','&amp;')
$config = @"
<?xml version="1.0" encoding="utf-8" ?>
<configuration><startup useLegacyV2RuntimeActivationPolicy="true"><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup><runtime><assemblyBinding xmlns="urn:schemas-microsoft-com:asm.v1"><dependentAssembly><assemblyIdentity name="Siemens.Engineering" culture="neutral" publicKeyToken="d29ec89bac048f84"/><codeBase version="$version" href="$assemblyUri"/></dependentAssembly></assemblyBinding></runtime></configuration>
"@
$config | Set-Content -LiteralPath "$PSScriptRoot\bin\Release\AquaFlow.TiaBridge.exe.config" -Encoding UTF8
$exe = "$PSScriptRoot\bin\Release\AquaFlow.TiaBridge.exe"
$smoke = Join-Path $env:TEMP ("aquaflow-tia-bridge-smoke-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $smoke | Out-Null
try {
  $request = Join-Path $smoke 'request.json'
  $response = Join-Path $smoke 'response.json'
  @{ operation = 'status' } | ConvertTo-Json | Set-Content -LiteralPath $request -Encoding UTF8
  & $exe --request $request --response $response
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $response)) {
    throw 'Built bridge could not load and query the selected Siemens.Engineering PublicAPI'
  }
  $report = Get-Content -Raw -LiteralPath $response | ConvertFrom-Json
  if (-not $report.ok) { throw "Bridge PublicAPI smoke test failed: $($report.error)" }
  $match = [regex]::Match($resolved, '[\\/]PublicAPI[\\/]V(?<version>\d+)$', 'IgnoreCase')
  $expectedVersion = if ($match.Success) { [int]$match.Groups['version'].Value } else { $null }
  if ($match.Success -and $expectedVersion -notin @($report.supported_tia_versions)) {
    throw "Bridge loaded Siemens PublicAPI V$($report.supported_tia_versions -join ',') instead of V$($match.Groups['version'].Value)"
  }
  Write-Host "Built and API-smoke-tested $exe against $resolved ($($report.engineering_file_version))"
}
finally {
  Remove-Item -LiteralPath $smoke -Recurse -Force -ErrorAction SilentlyContinue
}
