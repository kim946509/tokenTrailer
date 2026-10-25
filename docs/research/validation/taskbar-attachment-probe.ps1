param([string]$ImagePath = (Join-Path $env:TEMP 'tokentrailer-taskbar-probe.png'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TaskbarProbe {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c,string t);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
  [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SetParent(IntPtr child,IntPtr parent);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
  [DllImport("user32.dll")] public static extern bool UpdateWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
}
'@
$tray=[TaskbarProbe]::FindWindow('Shell_TrayWnd',$null)
if($tray -eq [IntPtr]::Zero){throw 'Taskbar not found'}
$rect=[TaskbarProbe+Rect]::new()
[void][TaskbarProbe]::GetWindowRect($tray,[ref]$rect)
$oldDpi=[TaskbarProbe]::SetThreadDpiAwarenessContext([TaskbarProbe]::GetWindowDpiAwarenessContext($tray))
$child=[IntPtr]::Zero
$result=$null
try {
  # Synthetic display only; no usage/auth data. Briefly covers a small taskbar area.
  $child=[TaskbarProbe]::CreateWindowEx(0,'STATIC','TT TEST 123K',0x40000201,0,0,160,24,[TaskbarProbe]::GetDesktopWindow(),[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
  if($child -eq [IntPtr]::Zero){throw 'Test window creation failed'}
  [void][TaskbarProbe]::SetParent($child,$tray)
  if([TaskbarProbe]::GetParent($child) -ne $tray){throw 'Taskbar attachment failed'}
  $height=[Math]::Min(24,$rect.B-$rect.T)
  [void][TaskbarProbe]::SetWindowPos($child,[IntPtr]::Zero,8,4,160,$height,0x0050)
  [void][TaskbarProbe]::UpdateWindow($child)
  Start-Sleep -Milliseconds 700
  $actual=[TaskbarProbe+Rect]::new()
  [void][TaskbarProbe]::GetWindowRect($child,[ref]$actual)
  $bitmap=[Drawing.Bitmap]::new(160,$height)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($actual.L,$actual.T,0,0,$bitmap.Size)
    $bitmap.Save($ImagePath,[Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
  $result=[ordered]@{TaskbarPresent=$true;Dpi=[TaskbarProbe]::GetDpiForWindow($tray);ParentMatches=([TaskbarProbe]::GetParent($child)-eq $tray);WindowVisible=[TaskbarProbe]::IsWindowVisible($child);InsideTaskbar=($actual.L -ge $rect.L -and $actual.T -ge $rect.T -and $actual.R -le $rect.R -and $actual.B -le $rect.B);Capture=$ImagePath;ExplorerRestartTested=$false;LoginTested=$false}
} finally {
  if($child -ne [IntPtr]::Zero){[void][TaskbarProbe]::DestroyWindow($child)}
  [void][TaskbarProbe]::SetThreadDpiAwarenessContext($oldDpi)
}
if([TaskbarProbe]::IsWindow($child)){throw 'Probe cleanup failed'}
$result.CleanupConfirmed=$true
$result | ConvertTo-Json
