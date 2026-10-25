param([string]$OutputDirectory = (Join-Path $env:TEMP 'tokentrailer-taskbar-diagnostic'))
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Add-Type -AssemblyName System.Drawing
# Reuse declarations only; do not run or modify the original feasibility probe.
$original=Get-Content (Join-Path $PSScriptRoot 'taskbar-attachment-probe.ps1') -Raw
$declarations=[regex]::Match($original,"(?s)Add-Type @'\r?\n(.*?)\r?\n'@").Groups[1].Value
if(-not $declarations){throw 'Original declarations not found'}
Add-Type $declarations
Add-Type @'
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class ProbeDiagnostic {
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate IntPtr WndProc(IntPtr h,uint m,IntPtr w,IntPtr l);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct WClass {public uint Style; public IntPtr Proc;public int ClassExtra,WindowExtra;public IntPtr Instance,Icon,Cursor,Brush;public string Menu,Name;}
  [StructLayout(LayoutKind.Sequential)] public struct Paint {public IntPtr Dc;public int Erase;public Rect R;public int Restore,Inc;[MarshalAs(UnmanagedType.ByValArray,SizeConst=32)]public byte[] Reserved;}
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern ushort RegisterClass(ref WClass c);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern bool UnregisterClass(string c,IntPtr i);
  [DllImport("user32.dll")] public static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr BeginPaint(IntPtr h,out Paint p);
  [DllImport("user32.dll")] public static extern bool EndPaint(IntPtr h,ref Paint p);
  [DllImport("user32.dll")] public static extern int FillRect(IntPtr dc,ref Rect r,IntPtr b);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int DrawText(IntPtr dc,string t,int n,ref Rect r,uint flags);
  [DllImport("gdi32.dll")] public static extern IntPtr GetStockObject(int n);
  [DllImport("user32.dll",EntryPoint="GetClassLongPtrW")] public static extern UIntPtr GetClassLongPtr(IntPtr h,int index);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h,uint key,byte alpha,uint flags);
  public static int PaintCalls=0;
  static WndProc Callback=PaintWindow;
  static void Draw(IntPtr h,IntPtr dc){Rect r;GetClientRect(h,out r);FillRect(dc,ref r,GetStockObject(0));DrawText(dc,"TT CUSTOM 789K",-1,ref r,0x25);}
  static IntPtr PaintWindow(IntPtr h,uint m,IntPtr w,IntPtr l){if(m==0xF){PaintCalls++;Paint p;var dc=BeginPaint(h,out p);Draw(h,dc);EndPaint(h,ref p);return IntPtr.Zero;}if(m==0x318){Draw(h,w);return IntPtr.Zero;}return DefWindowProc(h,m,w,l);}
  public static bool Register(string name,uint style){var c=new WClass{Style=style,Proc=Marshal.GetFunctionPointerForDelegate(Callback),Instance=GetModuleHandle(null),Brush=GetStockObject(0),Name=name};return RegisterClass(ref c)!=0;}
  [StructLayout(LayoutKind.Sequential)] public struct Rect {public int L,T,R,B;}
  [StructLayout(LayoutKind.Sequential)] public struct Point {public int X,Y; public Point(int x,int y){X=x;Y=y;}}
  [StructLayout(LayoutKind.Sequential)] public struct Msg {public IntPtr H;public uint M;public UIntPtr W;public IntPtr L;public uint Time;public Point P;public uint Private;}
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref Point p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint cmd);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder b,int n);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int index);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h,IntPtr dc);
  [DllImport("gdi32.dll")] public static extern int GetClipBox(IntPtr dc,out Rect r);
  [DllImport("user32.dll")] public static extern bool PeekMessage(out Msg m,IntPtr h,uint min,uint max,uint flags);
  [DllImport("user32.dll")] public static extern bool TranslateMessage(ref Msg m);
  [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref Msg m);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h,int a,out int value,int size);
  public static string Class(IntPtr h){var b=new StringBuilder(256);GetClassName(h,b,256);return b.ToString();}
  public static string OwnText(IntPtr h){var b=new StringBuilder(256);GetWindowText(h,b,256);return b.ToString();}
  public static int Pump(int ms){int count=0;var sw=Stopwatch.StartNew();while(sw.ElapsedMilliseconds<ms){Msg m;while(PeekMessage(out m,IntPtr.Zero,0,0,1)){TranslateMessage(ref m);DispatchMessage(ref m);count++;}System.Threading.Thread.Sleep(10);}return count;}
}
'@
function RectOf([IntPtr]$h){$r=[TaskbarProbe+Rect]::new(); if(-not [TaskbarProbe]::GetWindowRect($h,[ref]$r)){throw 'GetWindowRect failed'}; return $r}
function Capture([string]$name,[TaskbarProbe+Rect]$r){
  $b=[Drawing.Bitmap]::new($r.R-$r.L,$r.B-$r.T);$g=[Drawing.Graphics]::FromImage($b)
  try{$g.CopyFromScreen($r.L,$r.T,0,0,$b.Size);$b.Save((Join-Path $OutputDirectory "$name.png"),[Drawing.Imaging.ImageFormat]::Png)}finally{$g.Dispose();$b.Dispose()}
}
$tray=[TaskbarProbe]::FindWindow('Shell_TrayWnd',$null)
if($tray -eq [IntPtr]::Zero){throw 'No taskbar'}
$previous=[TaskbarProbe]::SetThreadDpiAwarenessContext([TaskbarProbe]::GetWindowDpiAwarenessContext($tray))
$child=[IntPtr]::Zero
$results=[ordered]@{}
try {
  $results.TaskbarRect=RectOf $tray
  $results.TaskbarExStyle=('{0:X8}' -f [ProbeDiagnostic]::GetWindowLong($tray,-20))
  $client=[ProbeDiagnostic+Rect]::new();[void][ProbeDiagnostic]::GetClientRect($tray,[ref]$client);$results.TaskbarClient=$client
  $origin=[ProbeDiagnostic+Point]::new(0,0);[void][ProbeDiagnostic]::ClientToScreen($tray,[ref]$origin);$results.ClientScreenOrigin=$origin
  $control=[TaskbarProbe]::CreateWindowEx(0x08000000,'STATIC','TT CTRL 456K',0x90000201L,8,$origin.Y-32,160,24,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
  if($control -eq [IntPtr]::Zero){throw 'Control creation failed'}
  try {
    [void][TaskbarProbe]::SetWindowPos($control,[IntPtr](-1),8,$origin.Y-32,160,24,0x0050)
    [void][TaskbarProbe]::UpdateWindow($control)
    $results.ControlMessages=[ProbeDiagnostic]::Pump(400)
    Capture 'standalone-control-screen' (RectOf $control)
  } finally {[void][TaskbarProbe]::DestroyWindow($control)}
  $child=[TaskbarProbe]::CreateWindowEx(0,'STATIC','TT TEST 123K',0x40000201,0,0,160,24,[TaskbarProbe]::GetDesktopWindow(),[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
  if($child -eq [IntPtr]::Zero){throw 'Create failed'}
  [void][TaskbarProbe]::SetParent($child,$tray)
  $results.SetWindowPos=[TaskbarProbe]::SetWindowPos($child,[IntPtr]::Zero,8,4,160,24,0x0050)
  $results.UpdateWindow=[TaskbarProbe]::UpdateWindow($child)
  Start-Sleep -Milliseconds 700
  $r=RectOf $child
  $results.ChildRect=$r;$results.ChildText=[ProbeDiagnostic]::OwnText($child)
  $results.ChildStyle=('{0:X8}' -f [ProbeDiagnostic]::GetWindowLong($child,-16))
  $results.StaticClassStyle=('{0:X}' -f [ProbeDiagnostic]::GetClassLongPtr($child,-26).ToUInt64())
  $ownerPid=0; $results.WindowThread=[ProbeDiagnostic]::GetWindowThreadProcessId($child,[ref]$ownerPid);$results.OwnerProcess=$ownerPid;$results.CurrentThread=[ProbeDiagnostic]::GetCurrentThreadId()
  $results.Visible=[TaskbarProbe]::IsWindowVisible($child);$results.ParentMatches=([TaskbarProbe]::GetParent($child)-eq $tray)
  $clip=[ProbeDiagnostic+Rect]::new();$childDc=[ProbeDiagnostic]::GetDC($child)
  try{$results.ClipType=[ProbeDiagnostic]::GetClipBox($childDc,[ref]$clip);$results.ClipRect=$clip}finally{[void][ProbeDiagnostic]::ReleaseDC($child,$childDc)}
  $cloaked=0;$results.CloakQueryHresult=[ProbeDiagnostic]::DwmGetWindowAttribute($tray,14,[ref]$cloaked,4);$results.TaskbarCloaked=$cloaked
  Capture 'before-pump-screen' $r
  $b=[Drawing.Bitmap]::new(160,24);$g=[Drawing.Graphics]::FromImage($b);$dc=$g.GetHdc()
  try{$results.PrintWindow=[ProbeDiagnostic]::PrintWindow($child,$dc,0)}finally{$g.ReleaseHdc($dc)}
  try{$b.Save((Join-Path $OutputDirectory 'own-print.png'),[Drawing.Imaging.ImageFormat]::Png)}finally{$g.Dispose();$b.Dispose()}
  $results.MessagesDispatched=[ProbeDiagnostic]::Pump(800)
  Capture 'after-pump-screen' (RectOf $child)
  $p=[ProbeDiagnostic+Point]::new($r.L+80,$r.T+12)
  $hit=[ProbeDiagnostic]::WindowFromPoint($p)
  $results.HitClass=[ProbeDiagnostic]::Class($hit);$results.HitIsProbe=($hit -eq $child)
  $siblings=@();$h=[ProbeDiagnostic]::GetWindow($tray,5);$i=0
  while($h -ne [IntPtr]::Zero -and $i -lt 30){$siblings += [pscustomobject]@{ZOrder=$i;Class=[ProbeDiagnostic]::Class($h);IsProbe=($h -eq $child);Visible=[TaskbarProbe]::IsWindowVisible($h);Rect=(RectOf $h)};$h=[ProbeDiagnostic]::GetWindow($h,2);$i++}
  $results.TaskbarChildren=$siblings
  [void][TaskbarProbe]::DestroyWindow($child);$child=[IntPtr]::Zero
  $ab=@()
  foreach($mode in @(0,128,524288)){
    $style=$mode -band 128;$exStyle=$mode -band 524288
    $name="TTDiagnostic_$mode"
    if(-not [ProbeDiagnostic]::Register($name,$style)){throw 'Register diagnostic class failed'}
    try {
      [ProbeDiagnostic]::PaintCalls=0
      $child=[TaskbarProbe]::CreateWindowEx($exStyle,$name,'Diagnostic',0x40000000,0,0,160,24,[TaskbarProbe]::GetDesktopWindow(),[IntPtr]::Zero,[ProbeDiagnostic]::GetModuleHandle($null),[IntPtr]::Zero)
      if($child -eq [IntPtr]::Zero){throw 'Custom child creation failed'}
      [void][TaskbarProbe]::SetParent($child,$tray)
      $layered=$false;if($exStyle){$layered=[ProbeDiagnostic]::SetLayeredWindowAttributes($child,0,255,2)}
      [void][TaskbarProbe]::SetWindowPos($child,[IntPtr]::Zero,8,4,160,24,0x0050)
      [void][TaskbarProbe]::UpdateWindow($child)
      $count=[ProbeDiagnostic]::Pump(500)
      Capture "custom-class-$mode-screen" (RectOf $child)
      $ab += [pscustomobject]@{ClassStyle=$style;ExStyle=$exStyle;LayeredApplied=$layered;PaintCalls=[ProbeDiagnostic]::PaintCalls;ParentMatches=([TaskbarProbe]::GetParent($child)-eq $tray);Visible=[TaskbarProbe]::IsWindowVisible($child);Messages=$count}
    } finally {
      if($child -ne [IntPtr]::Zero){[void][TaskbarProbe]::DestroyWindow($child);$child=[IntPtr]::Zero}
      [void][ProbeDiagnostic]::UnregisterClass($name,[ProbeDiagnostic]::GetModuleHandle($null))
    }
  }
  $results.ClassStyleComparison=$ab
} finally {
  if($child -ne [IntPtr]::Zero){[void][TaskbarProbe]::DestroyWindow($child)}
  [void][TaskbarProbe]::SetThreadDpiAwarenessContext($previous)
}
$results.CleanupConfirmed=(-not [TaskbarProbe]::IsWindow($child))
if(-not $results.CleanupConfirmed){throw 'Cleanup failed'}
$json=$results | ConvertTo-Json -Depth 6
$json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'result.json') -Encoding utf8
$json
