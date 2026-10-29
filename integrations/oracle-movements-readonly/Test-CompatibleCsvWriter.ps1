$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'CompatibleCsvWriter.cs')
$values = @([double]0.937, [double]60.71428571428535, [decimal]1.2300, '2026000000100092100000000031', 'quoted "text"', [DBNull]::Value, "two`nlines")
$rows = New-Object 'object[,]' 7,1
for ($column=0; $column -lt $values.Count; $column++) { $rows[$column,0] = $values[$column] }
$output = New-Object IO.StringWriter
$count = [AlbinaaCompatibleMovementCsv]::WriteRows($rows,$output)
$expected = @($values | ForEach-Object {
  $value = if ($_ -is [DBNull]) { '' } else { [Convert]::ToString($_,[Globalization.CultureInfo]::InvariantCulture) }
  '"' + $value.Replace('"','""') + '"'
}) -join ','
if ($count -ne 1 -or $output.ToString() -cne ($expected+[Environment]::NewLine)) { throw 'CSV differs from the established field-by-field formatter' }
if (-not $output.ToString().Contains('"0.937"')) { throw 'Legacy leading-zero formatting was lost' }
if (-not $output.ToString().Contains('"2026000000100092100000000031"')) { throw 'Long serial precision was lost' }
'PASS: bulk ADO CSV preserves decimal formatting, long serials, quotes, nulls and newlines.'
