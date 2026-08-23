Option Explicit

If WScript.Arguments.Count <> 1 Then
  WScript.Quit 87
End If

Dim shell, powerShellPath, scriptPath, command, exitCode
Set shell = CreateObject("WScript.Shell")

powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
scriptPath = WScript.Arguments(0)
command = Chr(34) & powerShellPath & Chr(34) & _
  " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & _
  Chr(34) & scriptPath & Chr(34)

' Window style 0 prevents the console window from being created visibly.
' Wait=True preserves the real PowerShell exit code for Task Scheduler.
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
