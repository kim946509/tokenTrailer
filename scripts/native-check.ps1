# Run with Windows PowerShell 5.1, matching the shipped helper runtime.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing,System.Windows.Forms,UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -Path (Join-Path $PSScriptRoot '../src/native/taskbar.cs') -ReferencedAssemblies System.Drawing,System.Windows.Forms,UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OwnWindowTest {
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c,string t);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p,IntPtr a,string c,string t);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
}
'@
$output=Join-Path $PSScriptRoot '../.test-output'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$report=@{ActualExplorerRestart=$false;ActualLogin=$false}
try {
  [TrailerBar]::Caption="Claude 5h 36% / 7d 60%`nCodex 5h 90% / 7d 48%"
  [TrailerBar]::CompactCaption="CL 5h 36% / 7d 60%`nCX 5h 90% / 7d 48%"
  [TrailerBar]::Percentages=[double[]]@(36,60,90,48)
  [TrailerBar]::ResetCaption="Claude 5h 2h / 7d 3d`nCodex 5h 1h / 7d 4d"
  [TrailerBar]::CompactResetCaption="CL 5h 2h / 7d 3d`nCX 5h 1h / 7d 4d"
  foreach($case in @(@(59.9,'#76DB9B'),@(60,'#FFB454'),@(89.9,'#FFB454'),@(90,'#FF7078'))){
    if([Drawing.ColorTranslator]::ToHtml([TrailerBar]::UsageColor($case[0])) -ne $case[1]){throw 'Usage color boundary failed'}
  }
  $report.QuotaTextColors='pass'
  $full=[TrailerBar]::RequiredWidth([TrailerBar]::Caption,96)
  $compact=[TrailerBar]::RequiredWidth([TrailerBar]::CompactCaption,96)
  if($compact -ge $full){throw 'Compact labels must reduce measured width'}
  $occupied=[Collections.Generic.List[int[]]]::new()
  $occupied.Add([int[]]@(0,250))
  $testWidth=250+$compact+48
  if([TrailerBar]::GapPosition($occupied,$testWidth,$full,8) -ne -1){throw 'Full label must not overlap in narrow gap'}
  if([TrailerBar]::GapPosition($occupied,$testWidth,$compact,8) -lt 250){throw 'Compact label should fit narrow gap'}
  if([TrailerBar]::GapPosition($occupied,280,$compact,8) -ne -1){throw 'No-space must remain hidden'}
  $report.MeasuredGapLayout='pass'
  [TrailerBar]::Tick($true)
  if([TrailerBar]::State -ne 'attached'){throw "Attachment failed: $([TrailerBar]::State)"}
  $watch=[Diagnostics.Stopwatch]::StartNew()
  while($watch.ElapsedMilliseconds -lt 500){[TrailerBar]::Pump();Start-Sleep -Milliseconds 20}
  $r=[TrailerBar]::Bounds
  $image=[Drawing.Bitmap]::new($r.R-$r.L,$r.B-$r.T);$graphics=[Drawing.Graphics]::FromImage($image)
  try{$graphics.CopyFromScreen($r.L,$r.T,0,0,$image.Size);$image.Save((Join-Path $output 'taskbar.png'))}finally{$graphics.Dispose();$image.Dispose()}
  $report.Position=@{x=$r.L;y=$r.T;width=($r.R-$r.L);height=($r.B-$r.T)}
  $tray=[OwnWindowTest]::FindWindow('Shell_TrayWnd',$null)
  $own=[TrailerBar]::WindowHandle
  [uint32]$owner=0;[void][OwnWindowTest]::GetWindowThreadProcessId($own,[ref]$owner)
  if($owner -ne $PID){throw 'Refusing to destroy a window owned by another process'}
  [void][OwnWindowTest]::SendMessage($own,0x205,[IntPtr]::Zero,[IntPtr]::Zero)
  if(-not [TrailerBar]::RightClicked -or [TrailerBar]::Clicked){throw 'Right click must be distinct from left click'}
  [TrailerBar]::Tick($true);[TrailerBar]::Pump()
  if(-not [TrailerBar]::ShowResetTimes -or [TrailerBar]::DisplayCaption.Contains('%')){throw 'Right click must switch displayed text inline'}
  [void][OwnWindowTest]::SendMessage($own,0x205,[IntPtr]::Zero,[IntPtr]::Zero)
  [TrailerBar]::Tick($true);[TrailerBar]::Pump()
  if([TrailerBar]::ShowResetTimes -or -not [TrailerBar]::DisplayCaption.Contains('%')){throw 'Second right click must restore percentages'}
  [TrailerBar]::RightClicked=$false
  $report.RightClickEvent='pass'
  if(-not [OwnWindowTest]::DestroyWindow($own)){throw 'Own window destruction failed'}
  [TrailerBar]::Tick($true);[TrailerBar]::Pump()
  if([TrailerBar]::State -ne 'attached'){throw 'Own child recovery failed'}
  $report.OwnWindowRecovery='pass'
  [TrailerBar]::Tick($false)
  if([TrailerBar]::State -ne 'disabled'){throw 'Disable failed'}
  $report.Disable='pass'
  [TrailerBar]::Tick($true)
  if([TrailerBar]::State -ne 'attached'){throw 'Re-enable failed'}
  $report.Reenable='pass'
}finally{[TrailerBar]::Close()}
$report | ConvertTo-Json | Tee-Object -FilePath (Join-Path $output 'native-result.json')
