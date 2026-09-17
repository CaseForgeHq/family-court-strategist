param([int]$HelperProcessId, [string]$CapturePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HandoffCapture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
}
'@
$process = Get-Process -Id $HelperProcessId
$window = $process.MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw 'Restart helper has no visible window.' }
$element = [System.Windows.Automation.AutomationElement]::FromHandle($window)
$all = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$names = @($all | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
$rect = New-Object HandoffCapture+Rect
[void][HandoffCapture]::GetWindowRect($window, [ref]$rect)
$bitmap = New-Object System.Drawing.Bitmap(($rect.Right-$rect.Left), ($rect.Bottom-$rect.Top))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$dc = $graphics.GetHdc()
try { if (-not [HandoffCapture]::PrintWindow($window, $dc, 2)) { throw 'Window capture failed.' } }
finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
try { $bitmap.Save($CapturePath, [System.Drawing.Imaging.ImageFormat]::Png) }
finally { $bitmap.Dispose() }
[System.IO.File]::WriteAllText(($CapturePath + '.json'), (ConvertTo-Json -InputObject $names -Compress), (New-Object System.Text.UTF8Encoding($false)))
