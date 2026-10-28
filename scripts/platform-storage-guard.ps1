function Test-AlbinaaStorageBudget {
  param([Parameter(Mandatory=$true)][object[]]$Volumes)
  $blocked = @($Volumes | Where-Object { [long]$_.freeBytes -lt [long]$_.minimumBytes })
  [pscustomobject]@{ ok = ($blocked.Count -eq 0); volumes = @($Volumes); blocked = $blocked }
}

function Get-AlbinaaStorageHeadroom {
  param(
    [Parameter(Mandatory=$true)][string]$DatabasePath,
    [Parameter(Mandatory=$true)][string]$RuntimePath
  )
  $requirements = @{}
  foreach ($entry in @(@{path=$DatabasePath; minimum=20GB}, @{path=$RuntimePath; minimum=10GB})) {
    $root = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($entry.path))
    if (-not $root -or $root.StartsWith('\\')) { throw 'Storage guard requires a local drive' }
    if (-not $requirements.ContainsKey($root) -or $requirements[$root] -lt $entry.minimum) { $requirements[$root] = $entry.minimum }
  }
  $volumes = @(foreach ($root in $requirements.Keys) {
    $drive = [IO.DriveInfo]::new($root)
    if (-not $drive.IsReady) { throw "Storage drive unavailable: $root" }
    [pscustomobject]@{drive=$root; freeBytes=$drive.AvailableFreeSpace; minimumBytes=$requirements[$root]}
  })
  Test-AlbinaaStorageBudget -Volumes $volumes
}

function Get-AlbinaaDatabaseStoragePath {
  $raw = & docker.exe inspect albinaa-clean-db --format '{{json .Mounts}}'
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect database storage mount' }
  $mounts = @($raw | ConvertFrom-Json)
  $databaseMount = @($mounts | Where-Object { $_.Destination -eq '/var/lib/postgresql/data' -and $_.Type -eq 'bind' })
  if ($databaseMount.Count -ne 1) { throw 'Expected one database bind mount' }
  $databaseMount[0].Source
}
