[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('plan', 'prepare-profile', 'migrate-data', 'apply-acl', 'configure-service-logon', 'rotate-password', 'stop-services', 'restart-services', 'health', 'verify', 'verify-reboot-readiness')]
  [string]$Action = 'plan',

  [string]$AccountName = 'codexwinmux-svc',
  [string]$RepoRoot,
  [string]$SourceUserProfile,
  [string]$ServiceProfileRoot,
  [string]$PasswordEnv = 'CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_PASSWORD',
  [string]$RotationPasswordEnv = 'CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_ROTATION_PASSWORD',
  [switch]$IncludeCodexCredentials
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $RepoRoot = (Resolve-Path (Join-Path $ScriptRoot '..')).Path
}

if (-not $SourceUserProfile) {
  $SourceUserProfile = if ($env:USERPROFILE) { $env:USERPROFILE } else { 'C:\Users\yohan' }
}

if (-not $ServiceProfileRoot) {
  $programData = if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }
  $ServiceProfileRoot = Join-Path $programData 'codexwinmux\service-profile'
}

$ServiceLocalAppData = Join-Path $ServiceProfileRoot 'AppData\Local'
$ServiceAppData = Join-Path $ServiceProfileRoot 'AppData\Roaming'
$SourceCodexDir = Join-Path $SourceUserProfile '.codex'
$SourceDataDir = Join-Path $SourceUserProfile '.codexwinmux'
$TargetCodexDir = Join-Path $ServiceProfileRoot '.codex'
$TargetDataDir = Join-Path $ServiceProfileRoot '.codexwinmux'
$ReleaseDir = Join-Path $RepoRoot 'release\win-unpacked'
$ServiceDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'codexwinmux\service'

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

function Get-EnvSecret([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable '$Name'."
  }
  return $value
}

function New-SecureSecret([string]$Secret) {
  ConvertTo-SecureString $Secret -AsPlainText -Force
}

function Get-AccountSid {
  try {
    $account = [Security.Principal.NTAccount]::new($env:COMPUTERNAME, $AccountName)
    return $account.Translate([Security.Principal.SecurityIdentifier]).Value
  } catch {
    return $null
  }
}

function Read-ServiceLogonRights {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "codexwinmux-service-rights-$([Guid]::NewGuid().ToString('N'))"
  $exportPath = Join-Path $tempRoot 'rights.inf'
  try {
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    & secedit /export /cfg $exportPath /areas USER_RIGHTS | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exportPath)) {
      return @()
    }
    $content = Get-Content -LiteralPath $exportPath -Raw
    $match = [regex]::Match($content, '(?m)^SeServiceLogonRight\s*=\s*(.*)$')
    if (-not $match.Success) {
      return @()
    }
    return @($match.Groups[1].Value.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Test-ServiceLogonRight {
  $sid = Get-AccountSid
  if (-not $sid) {
    return $false
  }
  $rights = Read-ServiceLogonRights
  return $rights -contains "*$sid" `
    -or $rights -contains $AccountName `
    -or $rights -contains ".\$AccountName" `
    -or $rights -contains "$env:COMPUTERNAME\$AccountName"
}

function Grant-ServiceLogonRight {
  Assert-Administrator
  $sid = Get-AccountSid
  if (-not $sid) {
    throw "Cannot resolve SID for '$AccountName'."
  }
  if ((Read-ServiceLogonRights) -contains "*$sid") {
    return
  }

  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "codexwinmux-service-rights-$([Guid]::NewGuid().ToString('N'))"
  $exportPath = Join-Path $tempRoot 'export.inf'
  $importPath = Join-Path $tempRoot 'import.inf'
  $dbPath = Join-Path $tempRoot 'rights.sdb'
  try {
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    & secedit /export /cfg $exportPath /areas USER_RIGHTS | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exportPath)) {
      throw "Failed to export local user rights with secedit."
    }

    $content = Get-Content -LiteralPath $exportPath -Raw
    $entry = "*$sid"
    if ($content -match '(?m)^SeServiceLogonRight\s*=') {
      $content = [regex]::Replace($content, '(?m)^SeServiceLogonRight\s*=\s*(.*)$', {
          param($match)
          $values = @($match.Groups[1].Value.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
          if ($values -notcontains $entry) {
            $values += $entry
          }
          return "SeServiceLogonRight = $($values -join ',')"
        })
    } elseif ($content -match '(?m)^\[Privilege Rights\]\s*$') {
      $content = [regex]::Replace($content, '(?m)^\[Privilege Rights\]\s*$', "[Privilege Rights]`r`nSeServiceLogonRight = $entry")
    } else {
      $content = "$content`r`n[Privilege Rights]`r`nSeServiceLogonRight = $entry`r`n"
    }

    Set-Content -LiteralPath $importPath -Value $content -Encoding Unicode
    & secedit /configure /db $dbPath /cfg $importPath /areas USER_RIGHTS | Out-Null
    if ($LASTEXITCODE -ne 0 -and -not (Test-ServiceLogonRight)) {
      throw "Failed to grant SeServiceLogonRight with secedit. ExitCode=$LASTEXITCODE."
    }
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Get-Plan {
  [pscustomobject]@{
    account = [pscustomobject]@{
      name = $AccountName
      qualifiedName = ".\$AccountName"
      passwordEnv = $PasswordEnv
      rotationPasswordEnv = $RotationPasswordEnv
      serviceLogonRight = 'SeServiceLogonRight'
      passwordPresent = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($PasswordEnv))
      rotationPasswordPresent = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($RotationPasswordEnv))
    }
    profile = [pscustomobject]@{
      root = $ServiceProfileRoot
      userProfile = $ServiceProfileRoot
      localAppData = $ServiceLocalAppData
      appData = $ServiceAppData
    }
    migrations = @(
      [pscustomobject]@{
        id = 'codex-credential-session-migration'
        source = $SourceCodexDir
        target = $TargetCodexDir
        sensitive = $true
        requiresExplicitCredentialCopy = $true
      },
      [pscustomobject]@{
        id = 'codexwinmux-runtime-data-migration'
        source = $SourceDataDir
        target = $TargetDataDir
        sensitive = $true
        requiresExplicitCredentialCopy = $false
      }
    )
    aclTargets = @(
      [pscustomobject]@{ path = $ServiceProfileRoot; rights = 'Modify' },
      [pscustomobject]@{ path = $ReleaseDir; rights = 'ReadAndExecute' },
      [pscustomobject]@{ path = $ServiceDir; rights = 'ReadAndExecute' }
    )
    smokeGates = @('health', 'upgrade', 'uninstall', 'reboot')
  }
}

function Ensure-ProfileDirectories {
  New-Item -ItemType Directory -Force -Path $ServiceProfileRoot, $ServiceLocalAppData, $ServiceAppData, $TargetDataDir | Out-Null
}

function Ensure-LocalServiceAccount([string]$Secret) {
  Assert-Administrator
  $secure = New-SecureSecret $Secret
  $existing = Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue
  if ($existing) {
    Set-LocalUser -Name $AccountName -Password $secure
    return
  }

  New-LocalUser `
    -Name $AccountName `
    -Password $secure `
    -PasswordNeverExpires `
    -UserMayNotChangePassword `
    -Description 'codexwinmux dedicated local service account' | Out-Null
}

function Copy-DirectoryIfPresent([string]$Source, [string]$Target) {
  if (-not (Test-Path -LiteralPath $Source)) {
    return [pscustomobject]@{ source = $Source; target = $Target; copied = $false; reason = 'source-missing' }
  }
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Target -Recurse -Force -ErrorAction SilentlyContinue
  return [pscustomobject]@{ source = $Source; target = $Target; copied = $true; reason = $null }
}

function Grant-AccountAcl {
  Assert-Administrator
  Ensure-ProfileDirectories
  $modifyGrant = "$AccountName`:(OI)(CI)M"
  $rxGrant = "$AccountName`:(OI)(CI)RX"
  & icacls $ServiceProfileRoot /grant $modifyGrant /T | Out-Null
  if (Test-Path -LiteralPath $ReleaseDir) {
    & icacls $ReleaseDir /grant $rxGrant /T | Out-Null
  }
  if (Test-Path -LiteralPath $ServiceDir) {
    & icacls $ServiceDir /grant $rxGrant /T | Out-Null
  }
}

function Write-ServiceProfileConfig {
  Invoke-ServiceProfileCommand 'write-config'
}

function Invoke-ServiceProfileCommand([string]$ServiceAction, [string]$ServiceRole = 'all') {
  $helper = Join-Path $RepoRoot 'scripts\windows-service.ps1'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $helper $ServiceAction `
    -Mode split `
    -Role $ServiceRole `
    -RepoRoot $RepoRoot `
    -ServiceUserProfilePath $ServiceProfileRoot `
    -ServiceLocalAppDataPath $ServiceLocalAppData `
    -ServiceAppDataPath $ServiceAppData
  if ($LASTEXITCODE -ne 0) {
    throw "windows-service.ps1 $ServiceAction failed with exit code $LASTEXITCODE."
  }
}

function Set-ServiceLogon([string]$Secret) {
  Assert-Administrator
  foreach ($serviceName in @('codexwinmux-core', 'codexwinmux-backend')) {
    $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
    if (-not $service) {
      throw "Service '$serviceName' is not installed."
    }
    $result = Invoke-CimMethod -InputObject $service -MethodName Change -Arguments @{
      StartName = ".\$AccountName"
      StartPassword = $Secret
    }
    if ($result.ReturnValue -ne 0) {
      throw "Failed to configure '$serviceName' logon account. ReturnValue=$($result.ReturnValue)."
    }
  }
}

function Get-ServiceAccountStatus {
  $services = Get-CimInstance Win32_Service -Filter "Name='codexwinmux-core' OR Name='codexwinmux-backend'" |
    Select-Object Name, State, StartMode, StartName
  [pscustomobject]@{
    accountName = $AccountName
    serviceLogonRightGranted = Test-ServiceLogonRight
    profileRootExists = Test-Path -LiteralPath $ServiceProfileRoot
    codexDirExists = Test-Path -LiteralPath $TargetCodexDir
    dataDirExists = Test-Path -LiteralPath $TargetDataDir
    services = $services
  }
}

switch ($Action) {
  'plan' {
    Get-Plan | ConvertTo-Json -Depth 8
  }
  'prepare-profile' {
    $secret = Get-EnvSecret $PasswordEnv
    Ensure-LocalServiceAccount $secret
    Grant-ServiceLogonRight
    Ensure-ProfileDirectories
    Grant-AccountAcl
    Write-ServiceProfileConfig
    Get-ServiceAccountStatus | ConvertTo-Json -Depth 8
  }
  'migrate-data' {
    Ensure-ProfileDirectories
    $results = @()
    if ($IncludeCodexCredentials) {
      $results += Copy-DirectoryIfPresent $SourceCodexDir $TargetCodexDir
    } else {
      $results += [pscustomobject]@{
        source = $SourceCodexDir
        target = $TargetCodexDir
        copied = $false
        reason = 'requires-IncludeCodexCredentials'
      }
    }
    $results += Copy-DirectoryIfPresent $SourceDataDir $TargetDataDir
    $results | ConvertTo-Json -Depth 8
  }
  'apply-acl' {
    Grant-AccountAcl
    Get-ServiceAccountStatus | ConvertTo-Json -Depth 8
  }
  'configure-service-logon' {
    $secret = Get-EnvSecret $PasswordEnv
    Write-ServiceProfileConfig
    Grant-ServiceLogonRight
    Set-ServiceLogon $secret
    Get-ServiceAccountStatus | ConvertTo-Json -Depth 8
  }
  'rotate-password' {
    $secret = Get-EnvSecret $RotationPasswordEnv
    Ensure-LocalServiceAccount $secret
    Grant-ServiceLogonRight
    Set-ServiceLogon $secret
    Get-ServiceAccountStatus | ConvertTo-Json -Depth 8
  }
  'stop-services' {
    Assert-Administrator
    Invoke-ServiceProfileCommand 'stop'
    Get-ServiceAccountStatus | ConvertTo-Json -Depth 8
  }
  'restart-services' {
    Assert-Administrator
    Invoke-ServiceProfileCommand 'restart'
    Get-ServiceAccountStatus | ConvertTo-Json -Depth 8
  }
  'health' {
    Invoke-ServiceProfileCommand 'health' 'backend'
  }
  'verify' {
    Get-ServiceAccountStatus | ConvertTo-Json -Depth 8
  }
  'verify-reboot-readiness' {
    $status = Get-ServiceAccountStatus
    $failures = @()
    foreach ($service in $status.services) {
      if ($service.StartMode -ne 'Auto') { $failures += "not-auto:$($service.Name)" }
      if ($service.StartName -ne ".\$AccountName") { $failures += "wrong-account:$($service.Name)" }
    }
    if (-not $status.serviceLogonRightGranted) { $failures += 'missing-SeServiceLogonRight' }
    [pscustomobject]@{
      ok = $failures.Count -eq 0
      failures = $failures
      status = $status
    } | ConvertTo-Json -Depth 8
    if ($failures.Count -gt 0) {
      exit 1
    }
  }
}
