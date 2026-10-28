$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'platform-storage-guard.ps1')
$cases = @(
  @{name='both drives have capacity'; db=30GB; runtime=15GB; expected=$true; blocked=0},
  @{name='thresholds are inclusive'; db=20GB; runtime=10GB; expected=$true; blocked=0},
  @{name='database low'; db=19GB; runtime=15GB; expected=$false; blocked=1},
  @{name='runtime low'; db=30GB; runtime=9GB; expected=$false; blocked=1},
  @{name='both drives full'; db=0; runtime=0; expected=$false; blocked=2},
  @{name='64 bit sizes are preserved'; db=300GB; runtime=100GB; expected=$true; blocked=0}
)
foreach ($case in $cases) {
  $result = Test-AlbinaaStorageBudget -Volumes @(
    [pscustomobject]@{drive='D:\';freeBytes=$case.db;minimumBytes=20GB},
    [pscustomobject]@{drive='E:\';freeBytes=$case.runtime;minimumBytes=10GB}
  )
  if ($result.ok -ne $case.expected -or $result.blocked.Count -ne $case.blocked) { throw "Failed: $($case.name)" }
  Write-Output "PASS: $($case.name)"
}
Write-Output '6 storage guard cases passed'
