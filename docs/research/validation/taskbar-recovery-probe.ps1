param([string]$OutputDirectory=(Join-Path $env:TEMP 'tokentrailer-taskbar-recovery'))
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Add-Type -AssemblyName System.Drawing
$original=Get-Content (Join-Path $PSScriptRoot 'taskbar-attachment-probe.ps1') -Raw
Add-Type ([regex]::Match($original,"(?s)Add-Type @'\r?\n(.*?)\r?\n'@").Groups[1].Value)
$diagnostic=Get-Content (Join-Path $PSScriptRoot 'taskbar-diagnostic-probe.ps1') -Raw
Add-Type ([regex]::Match($diagnostic,"(?s)Add-Type @'\r?\n(.*?)\r?\n'@").Groups[1].Value)
$name='TTRecoveryDiagnostic'
if(-not [ProbeDiagnostic]::Register($name,0)){throw 'Register failed'}
$child=[IntPtr]::Zero;$oldDpi=[IntPtr]::Zero
$events=@();$captures=0;$lost=$false;$missing=$false
$watch=[Diagnostics.Stopwatch]::StartNew()
try {
  while($watch.ElapsedMilliseconds -lt 11500){
    $ms=$watch.ElapsedMilliseconds
    if($ms -ge 3000 -and -not $lost){[void][TaskbarProbe]::DestroyWindow($child);$lost=$true;$events += [pscustomobject]@{AtMs=$ms;Event='simulated_child_loss'}}
    $injectMissing=$ms -ge 6500 -and $ms -lt 8500
    if($injectMissing -and -not $missing){[void][TaskbarProbe]::DestroyWindow($child);$child=[IntPtr]::Zero;$missing=$true;$events += [pscustomobject]@{AtMs=$ms;Event='simulated_discovery_unavailable'}}
    $tray=if($injectMissing){[IntPtr]::Zero}else{[TaskbarProbe]::FindWindow('Shell_TrayWnd',$null)}
    if($tray -ne [IntPtr]::Zero -and -not [TaskbarProbe]::IsWindow($child)) {
      $dpi=[TaskbarProbe]::SetThreadDpiAwarenessContext([TaskbarProbe]::GetWindowDpiAwarenessContext($tray));if($oldDpi -eq [IntPtr]::Zero){$oldDpi=$dpi}
      $child=[TaskbarProbe]::CreateWindowEx(0x80000,$name,'Diagnostic',0x40000000,0,0,160,24,[TaskbarProbe]::GetDesktopWindow(),[IntPtr]::Zero,[ProbeDiagnostic]::GetModuleHandle($null),[IntPtr]::Zero)
      if($child -eq [IntPtr]::Zero){throw 'Creation failed'}
      [void][TaskbarProbe]::SetParent($child,$tray)
      if(-not [ProbeDiagnostic]::SetLayeredWindowAttributes($child,0,255,2)){throw 'Layered alpha failed'}
      # Diagnostic coordinate only; permanent UI needs layout collision detection.
      [void][TaskbarProbe]::SetWindowPos($child,[IntPtr]::Zero,8,4,160,24,0x0050)
      [void][TaskbarProbe]::UpdateWindow($child)
      [void][ProbeDiagnostic]::Pump(150)
      $captures++;$r=[TaskbarProbe+Rect]::new();[void][TaskbarProbe]::GetWindowRect($child,[ref]$r)
      $b=[Drawing.Bitmap]::new(160,24);$g=[Drawing.Graphics]::FromImage($b)
      try{$g.CopyFromScreen($r.L,$r.T,0,0,$b.Size);$b.Save((Join-Path $OutputDirectory "attachment-$captures.png"),[Drawing.Imaging.ImageFormat]::Png)}finally{$g.Dispose();$b.Dispose()}
      $events += [pscustomobject]@{AtMs=$watch.ElapsedMilliseconds;Event='attached';ParentMatches=([TaskbarProbe]::GetParent($child)-eq $tray);Visible=[TaskbarProbe]::IsWindowVisible($child)}
    }
    [void][ProbeDiagnostic]::Pump(100)
  }
} finally {
  if($child -ne [IntPtr]::Zero){[void][TaskbarProbe]::DestroyWindow($child)}
  [void][ProbeDiagnostic]::UnregisterClass($name,[ProbeDiagnostic]::GetModuleHandle($null))
  if($oldDpi -ne [IntPtr]::Zero){[void][TaskbarProbe]::SetThreadDpiAwarenessContext($oldDpi)}
}
if($captures -ne 3 -or [TaskbarProbe]::IsWindow($child)){throw 'Recovery/cleanup assertion failed'}
[pscustomobject]@{Events=$events;AttachmentCount=$captures;CleanupConfirmed=$true;ActualExplorerRestart=$false;ActualLogin=$false;Simulated=$true} | ConvertTo-Json -Depth 5 | Tee-Object -FilePath (Join-Path $OutputDirectory 'result.json')
