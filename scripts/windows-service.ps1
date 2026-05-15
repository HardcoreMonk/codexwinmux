[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'start', 'stop', 'restart', 'status', 'health', 'uninstall', 'write-config')]
  [string]$Action = 'status',

  [string]$ServiceName = 'codexwinmux',
  [string]$RepoRoot,
  [string]$EngineExe,
  [string]$WrapperPath,
  [string]$WrapperConfigPath,
  [string]$WinSwSource,
  [string]$HostName = '127.0.0.1',
  [int]$Port = 8121
)

$ErrorActionPreference = 'Stop'

$DefaultUserProfilePath = if ($env:USERPROFILE) { $env:USERPROFILE } else { 'C:\Windows\System32\config\systemprofile' }
$DefaultLocalAppDataPath = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $DefaultUserProfilePath 'AppData\Local' }
$DefaultAppDataPath = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $DefaultUserProfilePath 'AppData\Roaming' }

if (-not $RepoRoot) {
  $ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $RepoRoot = (Resolve-Path (Join-Path $ScriptRoot '..')).Path
}

if (-not $EngineExe) {
  $EngineExe = Join-Path $RepoRoot 'release\win-unpacked\codexwinmux.exe'
}

if (-not $WrapperPath) {
  $WrapperPath = Join-Path $DefaultLocalAppDataPath 'codexwinmux\service\codexwinmux-service.exe'
}

if (-not $WrapperConfigPath) {
  $WrapperConfigPath = Join-Path (Split-Path -Parent $WrapperPath) 'codexwinmux-service.xml'
}

$ServiceDir = Split-Path -Parent $WrapperPath
$WorkingDirectory = Split-Path -Parent $EngineExe
$UserProfilePath = $DefaultUserProfilePath
$LocalAppDataPath = $DefaultLocalAppDataPath
$AppDataPath = $DefaultAppDataPath
$LogPath = Join-Path $LocalAppDataPath 'codexwinmux\logs'

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Administrator {
  if (-not (Test-IsAdministrator)) {
    throw "Action '$Action' requires an elevated PowerShell session."
  }
}

function Escape-XmlValue([string]$Value) {
  return [Security.SecurityElement]::Escape($Value)
}

function Resolve-WinSwSource {
  if ($WinSwSource -and (Test-Path -LiteralPath $WinSwSource)) {
    return (Resolve-Path -LiteralPath $WinSwSource).Path
  }

  $command = Get-Command winsw.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $wingetLink = Join-Path $LocalAppDataPath 'Microsoft\WinGet\Links\winsw.exe'
  if (Test-Path -LiteralPath $wingetLink) {
    return $wingetLink
  }

  throw 'WinSW was not found. Install WinSW or pass -WinSwSource <path-to-winsw.exe>.'
}

function Ensure-ServiceDirectory {
  New-Item -ItemType Directory -Force -Path $ServiceDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogPath | Out-Null
}

function Ensure-WinSwWrapper {
  Ensure-ServiceDirectory
  if (Test-Path -LiteralPath $WrapperPath) {
    return
  }

  $source = Resolve-WinSwSource
  Copy-Item -LiteralPath $source -Destination $WrapperPath
}

function Write-WinSwConfig {
  Ensure-ServiceDirectory

  $xml = @"
<service>
  <id>$(Escape-XmlValue $ServiceName)</id>
  <name>$(Escape-XmlValue $ServiceName)</name>
  <description>Runs the local codexwinmux Backend/Core Engine.</description>
  <executable>$(Escape-XmlValue $EngineExe)</executable>
  <arguments>--codexwinmux-engine</arguments>
  <workingdirectory>$(Escape-XmlValue $WorkingDirectory)</workingdirectory>
  <startmode>Automatic</startmode>
  <stoptimeout>30 sec</stoptimeout>
  <env name="CODEXWINMUX_ELECTRON_ENGINE_PROCESS" value="1" />
  <env name="CODEXWINMUX_WINDOWS_HOST_OWNER" value="service" />
  <env name="CODEXWINMUX_RUNTIME_V2" value="1" />
  <env name="CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER" value="windows" />
  <env name="CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER" value="windows" />
  <env name="HOST" value="$(Escape-XmlValue $HostName)" />
  <env name="PORT" value="$(Escape-XmlValue ([string]$Port))" />
  <env name="HOME" value="$(Escape-XmlValue $UserProfilePath)" />
  <env name="USERPROFILE" value="$(Escape-XmlValue $UserProfilePath)" />
  <env name="LOCALAPPDATA" value="$(Escape-XmlValue $LocalAppDataPath)" />
  <env name="APPDATA" value="$(Escape-XmlValue $AppDataPath)" />
  <logpath>$(Escape-XmlValue $LogPath)</logpath>
  <log mode="roll-by-size-time">
    <sizeThreshold>10485760</sizeThreshold>
    <pattern>yyyyMMdd</pattern>
    <autoRollAtTime>00:00:00</autoRollAtTime>
    <zipOlderThanNumDays>7</zipOlderThanNumDays>
    <keepFiles>8</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="none" />
</service>
"@

  Set-Content -LiteralPath $WrapperConfigPath -Value $xml -Encoding UTF8
}

function Invoke-WinSw([string]$Command) {
  Ensure-WinSwWrapper
  Write-WinSwConfig
  & $WrapperPath $Command
  if ($LASTEXITCODE -ne 0) {
    throw "WinSW command '$Command' failed with exit code $LASTEXITCODE."
  }
}

function Show-ServiceStatus {
  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $service) {
    [pscustomobject]@{
      service = $ServiceName
      installed = $false
      wrapper = $WrapperPath
      config = $WrapperConfigPath
    }
    return
  }

  $service | Select-Object Name, Status, StartType, ServiceType
}

function Show-Health {
  $uri = "http://${HostName}:${Port}/api/health"
  Invoke-RestMethod -Uri $uri | ConvertTo-Json -Depth 5
}

switch ($Action) {
  'install' {
    Assert-Administrator
    Invoke-WinSw 'install'
  }
  'start' {
    Assert-Administrator
    Invoke-WinSw 'start'
  }
  'stop' {
    Assert-Administrator
    Invoke-WinSw 'stop'
  }
  'restart' {
    Assert-Administrator
    Invoke-WinSw 'stop'
    Invoke-WinSw 'start'
  }
  'uninstall' {
    Assert-Administrator
    Invoke-WinSw 'uninstall'
  }
  'write-config' {
    Ensure-WinSwWrapper
    Write-WinSwConfig
    Write-Output "Wrote $WrapperConfigPath"
  }
  'status' {
    Show-ServiceStatus
  }
  'health' {
    Show-Health
  }
}
