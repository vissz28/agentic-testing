# Finds node.exe on Windows when `node` is not on the PATH of the shell an agent started.
# Looks in this order: the PATH of this shell; the Machine and User PATH from the registry (a shell started by an app can miss the user part);
# the usual install folders; nvm, fnm, Volta and Scoop; then every profile in C:\Users.
# Prints, on separate lines: NODE_EXE=<path>, NODE_VERSION=<v>, NODE_DIR=<folder>, NODE_PROFILE=<owner folder or system>, and the line to run to use it.
# Run it as: powershell -NoProfile -ExecutionPolicy Bypass -File "<plugin>\bin\find-node.ps1"
$ErrorActionPreference = 'SilentlyContinue'
$min = 18

function Test-Node($exe) {
  if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { return $null }
  $v = (& $exe --version 2>$null)
  if ($v -match '^v(\d+)\.') { return [pscustomobject]@{ Exe = $exe; Version = $v; Major = [int]$Matches[1] } }
  return $null
}

# Newest version first: v20.11.0 before v9.0.0 (a text sort would put v9 first).
function Sort-Versions($dirs) {
  $dirs | Sort-Object -Descending { $n = $_.Name.TrimStart('v'); try { [version]($n -replace '[^\d.].*$', '') } catch { [version]'0.0' } }
}
# nvm-windows: its root is NVM_HOME, the "root:" line of settings.txt, or the usual places. The active version is the folder NVM_SYMLINK points to.
$nvmRoots = New-Object System.Collections.Generic.List[string]
foreach ($r in @($env:NVM_HOME, "$env:APPDATA\nvm", 'C:\nvm', 'C:\nvm4w\nvm', "$env:ProgramData\nvm")) { if ($r) { $nvmRoots.Add($r) } }
foreach ($r in @($nvmRoots)) {
  $st = Join-Path $r 'settings.txt'
  if (Test-Path -LiteralPath $st) { Get-Content -LiteralPath $st | ForEach-Object { if ($_ -match '^\s*root:\s*(.+?)\s*$') { $nvmRoots.Add($Matches[1]) } } }
}

$candidates = New-Object System.Collections.Generic.List[string]
$add = { param($p) if ($p) { $candidates.Add($p) } }

# 1. this shell
& $add ((Get-Command node.exe).Source)
# 2. the registry's PATH, Machine then User
foreach ($scope in 'Machine', 'User') {
  $p = [Environment]::GetEnvironmentVariable('Path', $scope)
  foreach ($d in ($p -split ';')) {
    $d = [Environment]::ExpandEnvironmentVariables($d.Trim())
    if ($d) { & $add (Join-Path $d 'node.exe') }
  }
}
# 3. the usual folders and the version managers of this user
foreach ($d in @("$env:ProgramFiles\nodejs", "${env:ProgramFiles(x86)}\nodejs", "$env:LOCALAPPDATA\Programs\nodejs",
                 "$env:NVM_SYMLINK", "$env:USERPROFILE\scoop\apps\nodejs\current", "$env:USERPROFILE\scoop\apps\nodejs-lts\current",
                 "$env:LOCALAPPDATA\Volta\bin", "$env:USERPROFILE\.volta\bin")) { if ($d) { & $add (Join-Path $d 'node.exe') } }
foreach ($root in @($nvmRoots) + @("$env:APPDATA\fnm\node-versions", "$env:LOCALAPPDATA\fnm\node-versions")) {
  if ($root) { Sort-Versions (Get-ChildItem -LiteralPath $root -Directory) | ForEach-Object {
    & $add (Join-Path $_.FullName 'node.exe'); & $add (Join-Path $_.FullName 'installation\node.exe') } }
}
# 4. every profile on the machine
Get-ChildItem 'C:\Users' -Directory | ForEach-Object {
  $u = $_.FullName
  & $add "$u\AppData\Local\Programs\nodejs\node.exe"
  & $add "$u\scoop\apps\nodejs\current\node.exe"
  & $add "$u\.volta\bin\node.exe"
  Sort-Versions (Get-ChildItem "$u\AppData\Roaming\nvm" -Directory) | ForEach-Object { & $add (Join-Path $_.FullName 'node.exe') }
  Sort-Versions (Get-ChildItem "$u\AppData\Roaming\fnm\node-versions" -Directory) | ForEach-Object { & $add (Join-Path $_.FullName 'installation\node.exe') }
}

$seen = @{}
$best = $null
foreach ($c in $candidates) {
  $key = $c.ToLowerInvariant()
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = $true
  $n = Test-Node $c
  if ($n -and $n.Major -ge $min) { $best = $n; break }   # the first that works and is new enough: this shell, then the system, then this user, then other profiles
  if ($n -and -not $best) { $old = $n }
}

if (-not $best) {
  if ($old) { Write-Output "NODE_TOO_OLD=$($old.Exe) $($old.Version): Quality Code needs Node.js $min or later (https://nodejs.org)" }
  else { Write-Output "NODE_NOT_FOUND: no node.exe in the PATH, the usual folders, nvm, fnm, Volta, Scoop or any profile in C:\Users. Install Node.js $min or later: https://nodejs.org" }
  exit 1
}

$dir = Split-Path -Parent $best.Exe
$owner = if ($best.Exe -like 'C:\Users\*') { ($best.Exe -split '\\')[2] } else { 'system' }
Write-Output "NODE_EXE=$($best.Exe)"
Write-Output "NODE_VERSION=$($best.Version)"
Write-Output "NODE_DIR=$dir"
Write-Output "NODE_PROFILE=$owner"
Write-Output "USE_IT=`$env:Path = '$dir;' + `$env:Path"
exit 0
