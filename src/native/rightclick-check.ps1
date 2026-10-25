param([Parameter(Mandatory=$true)][int]$HelperPid,[Parameter(Mandatory=$true)][long]$WindowHandle,[switch]$MessageOnly,[switch]$Left,[switch]$DoubleClick,[switch]$Escape,[string]$ScreenshotPath)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TrailerInput {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c,string t);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p,IntPtr a,string c,string t);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent,IntPtr child);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint data,UIntPtr extra);
  [StructLayout(LayoutKind.Explicit,Size=40)] public struct Input {
    [FieldOffset(0)] public uint Type; [FieldOffset(20)] public uint Flags;
  }
  [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint n,Input[] input,int size);
  public static uint Click(bool left){return SendInput(2,new[]{new Input{Flags=left?2u:8u},new Input{Flags=left?4u:16u}},40);}
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
}
'@
$tray=[TrailerInput]::FindWindow('Shell_TrayWnd',$null)
$oldDpi=[TrailerInput]::SetThreadDpiAwarenessContext([TrailerInput]::GetWindowDpiAwarenessContext($tray))
$oldPoint=[TrailerInput+Point]::new();[void][TrailerInput]::GetCursorPos([ref]$oldPoint)
try {
  $child=[IntPtr]::Zero;$target=[IntPtr]::Zero
  if(-not $Escape){ do {
    $child=[TrailerInput]::FindWindowEx($tray,$child,'TokenTrailerTaskbar',$null)
    if($child -eq [IntPtr]::Zero){break}
    [uint32]$owner=0;[void][TrailerInput]::GetWindowThreadProcessId($child,[ref]$owner)
    if($owner -eq $HelperPid){$target=$child;break}
  }while($true) }
  if($target -eq [IntPtr]::Zero){$target=[IntPtr]$WindowHandle}
  [uint32]$targetOwner=0;[void][TrailerInput]::GetWindowThreadProcessId($target,[ref]$targetOwner)
  if($targetOwner -ne $HelperPid){throw "No owned taskbar window: expected $HelperPid, actual $targetOwner, handle $WindowHandle"}
  if($ScreenshotPath){
    Add-Type -AssemblyName System.Drawing
    $capture=[TrailerInput+Rect]::new();[void][TrailerInput]::GetWindowRect($target,[ref]$capture)
    $bitmap=[Drawing.Bitmap]::new(($capture.R-$capture.L),($capture.B-$capture.T));$graphics=[Drawing.Graphics]::FromImage($bitmap)
    try{$graphics.CopyFromScreen($capture.L,$capture.T,0,0,$bitmap.Size);$bitmap.Save($ScreenshotPath)}finally{$graphics.Dispose();$bitmap.Dispose()}
  }
  if($Escape){
    if($MessageOnly){[void][TrailerInput]::PostMessage($target,0x100,[IntPtr]27,[IntPtr]::Zero);return}

    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}');return
  }
  if($MessageOnly){
    if($Left -or $DoubleClick){
      [void][TrailerInput]::SendMessage($target,0x201,[IntPtr]::Zero,[IntPtr]::Zero)
      [void][TrailerInput]::SendMessage($target,0x202,[IntPtr]::Zero,[IntPtr]::Zero)
      if($DoubleClick){
        [void][TrailerInput]::SendMessage($target,0x203,[IntPtr]::Zero,[IntPtr]::Zero)
        [void][TrailerInput]::SendMessage($target,0x202,[IntPtr]::Zero,[IntPtr]::Zero)
      }
    }else{[void][TrailerInput]::SendMessage($target,0x205,[IntPtr]::Zero,[IntPtr]::Zero)}
    return
  }
  $rect=[TrailerInput+Rect]::new();[void][TrailerInput]::GetWindowRect($target,[ref]$rect)
  $point=[TrailerInput+Point]::new();$point.X=($rect.L+$rect.R)/2;$point.Y=($rect.T+$rect.B)/2
  if([TrailerInput]::WindowFromPoint($point) -ne $target -and -not [TrailerInput]::IsChild($target,[TrailerInput]::WindowFromPoint($point))){throw 'Refusing input: owned window is obscured'}
  if(-not [TrailerInput]::SetCursorPos($point.X,$point.Y)){throw 'Cursor move rejected'}
  $actual=[TrailerInput+Point]::new();[void][TrailerInput]::GetCursorPos([ref]$actual)
  if($actual.X -ne $point.X -or $actual.Y -ne $point.Y){throw 'Cursor did not reach owned target'}
  if([TrailerInput]::Click([bool]$Left) -ne 2){throw 'OS rejected mouse input'}
  Start-Sleep -Milliseconds 2000
  Write-Output 'Owned taskbar right-click injected'
}finally{
  [void][TrailerInput]::SetCursorPos($oldPoint.X,$oldPoint.Y)
  [void][TrailerInput]::SetThreadDpiAwarenessContext($oldDpi)
}
