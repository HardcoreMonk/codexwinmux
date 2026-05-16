[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'start', 'stop', 'restart', 'status', 'health', 'uninstall', 'write-config')]
  [string]$Action = 'status',

  [ValidateSet('combined', 'split')]
  [string]$Mode = 'split',

  [ValidateSet('all', 'backend', 'core')]
  [string]$Role = 'all',

  [string]$ServiceName = 'codexwinmux',
  [string]$RepoRoot,
  [string]$EngineExe,
  [string]$WrapperPath,
  [string]$WrapperConfigPath,
  [string]$WinSwSource,
  [string]$HostName = '127.0.0.1',
  [int]$Port = 8121,
  [string]$CoreEngineHost = '127.0.0.1',
  [int]$CoreEnginePort = 8122,
  [string]$ServiceUserProfilePath,
  [string]$ServiceLocalAppDataPath,
  [string]$ServiceAppDataPath,
  [string]$ServiceLogPath
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
$AppAsarPath = Join-Path $WorkingDirectory 'resources\app.asar'
$AppAsarUnpackedPath = Join-Path $WorkingDirectory 'resources\app.asar.unpacked'
$PackagedNodePath = "$(Join-Path $AppAsarUnpackedPath '.next\standalone\node_modules');$(Join-Path $AppAsarPath '.next\standalone\node_modules')"
$BackendServerScriptPath = Join-Path $AppAsarPath 'dist\server.js'
$CoreHostScriptPath = Join-Path $AppAsarUnpackedPath 'dist\workers\core-engine-host.js'
$UserProfilePath = if ($ServiceUserProfilePath) { $ServiceUserProfilePath } else { $DefaultUserProfilePath }
$LocalAppDataPath = if ($ServiceLocalAppDataPath) {
  $ServiceLocalAppDataPath
} elseif ($ServiceUserProfilePath) {
  Join-Path $ServiceUserProfilePath 'AppData\Local'
} else {
  $DefaultLocalAppDataPath
}
$AppDataPath = if ($ServiceAppDataPath) {
  $ServiceAppDataPath
} elseif ($ServiceUserProfilePath) {
  Join-Path $ServiceUserProfilePath 'AppData\Roaming'
} else {
  $DefaultAppDataPath
}
$LogPath = if ($ServiceLogPath) { $ServiceLogPath } else { Join-Path $LocalAppDataPath 'codexwinmux\logs' }
$ServiceArguments = "`"$BackendServerScriptPath`""
$ServiceProcessEnvName = 'ELECTRON_RUN_AS_NODE'
$CoreEngineTransport = 'tcp'

$SplitActions = @('write-config', 'install', 'start', 'restart', 'status', 'health', 'stop', 'uninstall')
if ($Mode -eq 'split' -and $SplitActions -notcontains $Action) {
  throw "Split mode supports only: $($SplitActions -join ', ')."
}

$UnsupportedCombinedActions = @('write-config', 'install', 'start', 'restart')
if ($Mode -eq 'combined' -and $UnsupportedCombinedActions -contains $Action) {
  throw "Combined Windows service start/install was removed after split Core/Backend default-on. Use -Mode split, or use -Mode combined only for status/health/stop/uninstall migration cleanup."
}

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

  $coreTransportEnvXml = ''
  if ($script:CoreEngineTransport -eq 'tcp') {
    $coreTransportEnvXml = @"
  <env name="CODEXWINMUX_CORE_ENGINE_TRANSPORT" value="tcp" />
  <env name="CODEXWINMUX_CORE_ENGINE_HOST" value="$(Escape-XmlValue $CoreEngineHost)" />
  <env name="CODEXWINMUX_CORE_ENGINE_PORT" value="$(Escape-XmlValue ([string]$CoreEnginePort))" />
"@
  }

  $xml = @"
<service>
  <id>$(Escape-XmlValue $ServiceName)</id>
  <name>$(Escape-XmlValue $ServiceName)</name>
  <description>Runs the local codexwinmux Backend/Core Engine.</description>
  <executable>$(Escape-XmlValue $EngineExe)</executable>
  <arguments>$(Escape-XmlValue $ServiceArguments)</arguments>
  <workingdirectory>$(Escape-XmlValue $WorkingDirectory)</workingdirectory>
  <startmode>Automatic</startmode>
  <stoptimeout>30 sec</stoptimeout>
  <env name="$(Escape-XmlValue $ServiceProcessEnvName)" value="1" />
$coreTransportEnvXml
  <env name="NODE_ENV" value="production" />
  <env name="NODE_PATH" value="$(Escape-XmlValue $PackagedNodePath)" />
  <env name="__CMUX_APP_DIR" value="$(Escape-XmlValue $AppAsarPath)" />
  <env name="__CMUX_APP_DIR_UNPACKED" value="$(Escape-XmlValue $AppAsarUnpackedPath)" />
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

function New-SplitServiceSpec([string]$TargetRole) {
  $name = if ($TargetRole -eq 'core') { 'codexwinmux-core' } else { 'codexwinmux-backend' }
  $arguments = if ($TargetRole -eq 'core') { "`"$CoreHostScriptPath`"" } else { "`"$BackendServerScriptPath`"" }
  $envName = 'ELECTRON_RUN_AS_NODE'
  $baseDir = Split-Path -Parent $WrapperPath
  [pscustomobject]@{
    Role = $TargetRole
    ServiceName = $name
    WrapperPath = Join-Path $baseDir "$name-service.exe"
    WrapperConfigPath = Join-Path $baseDir "$name-service.xml"
    ServiceArguments = $arguments
    ServiceProcessEnvName = $envName
    CoreEngineTransport = 'tcp'
  }
}

function Get-SplitServiceSpecs([string]$Order) {
  $roles = if ($Role -eq 'all') {
    if ($Order -eq 'stop') { @('backend', 'core') } else { @('core', 'backend') }
  } else {
    @($Role)
  }
  return @($roles | ForEach-Object { New-SplitServiceSpec $_ })
}

function Use-ServiceSpec($Spec, [scriptblock]$Block) {
  $previousServiceName = $script:ServiceName
  $previousWrapperPath = $script:WrapperPath
  $previousWrapperConfigPath = $script:WrapperConfigPath
  $previousServiceDir = $script:ServiceDir
  $previousServiceArguments = $script:ServiceArguments
  $previousServiceProcessEnvName = $script:ServiceProcessEnvName
  $previousCoreEngineTransport = $script:CoreEngineTransport
  try {
    $script:ServiceName = $Spec.ServiceName
    $script:WrapperPath = $Spec.WrapperPath
    $script:WrapperConfigPath = $Spec.WrapperConfigPath
    $script:ServiceDir = Split-Path -Parent $Spec.WrapperPath
    $script:ServiceArguments = $Spec.ServiceArguments
    $script:ServiceProcessEnvName = $Spec.ServiceProcessEnvName
    $script:CoreEngineTransport = $Spec.CoreEngineTransport
    & $Block
  } finally {
    $script:ServiceName = $previousServiceName
    $script:WrapperPath = $previousWrapperPath
    $script:WrapperConfigPath = $previousWrapperConfigPath
    $script:ServiceDir = $previousServiceDir
    $script:ServiceArguments = $previousServiceArguments
    $script:ServiceProcessEnvName = $previousServiceProcessEnvName
    $script:CoreEngineTransport = $previousCoreEngineTransport
  }
}

if ($Mode -eq 'split') {
  switch ($Action) {
    'install' {
      Assert-Administrator
      foreach ($spec in Get-SplitServiceSpecs 'start') {
        Use-ServiceSpec $spec { Invoke-WinSw 'install' }
      }
    }
    'start' {
      Assert-Administrator
      foreach ($spec in Get-SplitServiceSpecs 'start') {
        Use-ServiceSpec $spec { Invoke-WinSw 'start' }
      }
    }
    'restart' {
      Assert-Administrator
      foreach ($spec in Get-SplitServiceSpecs 'stop') {
        Use-ServiceSpec $spec { Invoke-WinSw 'stop' }
      }
      foreach ($spec in Get-SplitServiceSpecs 'start') {
        Use-ServiceSpec $spec { Invoke-WinSw 'start' }
      }
    }
    'stop' {
      Assert-Administrator
      foreach ($spec in Get-SplitServiceSpecs 'stop') {
        Use-ServiceSpec $spec { Invoke-WinSw 'stop' }
      }
    }
    'uninstall' {
      Assert-Administrator
      foreach ($spec in Get-SplitServiceSpecs 'stop') {
        Use-ServiceSpec $spec { Invoke-WinSw 'uninstall' }
      }
    }
    'write-config' {
      foreach ($spec in Get-SplitServiceSpecs 'start') {
        Use-ServiceSpec $spec {
          Ensure-WinSwWrapper
          Write-WinSwConfig
          Write-Output "Wrote $WrapperConfigPath"
        }
      }
    }
    'status' {
      foreach ($spec in Get-SplitServiceSpecs 'start') {
        Use-ServiceSpec $spec { Show-ServiceStatus }
      }
    }
    'health' {
      Show-Health
    }
  }
  return
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
