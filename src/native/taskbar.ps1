param([Parameter(Mandatory=$true)][string]$StateFile,[Parameter(Mandatory=$true)][int]$OwnerPid)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing,System.Windows.Forms,UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -Path (Join-Path $PSScriptRoot 'taskbar.cs') -ReferencedAssemblies System.Drawing,System.Windows.Forms,UIAutomationClient,UIAutomationTypes,WindowsBase
$last='';$timer=[Diagnostics.Stopwatch]::StartNew();$next=0
try {
  while(Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue){
    if($timer.ElapsedMilliseconds -ge $next){
      try {
        $state=Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
        [TrailerBar]::Caption=$state.caption
        [TrailerBar]::CompactCaption=$state.compactCaption
        [TrailerBar]::ResetMenuLabels=[string[]]@($state.resetMenuItems | ForEach-Object { if($_.type -eq 'separator'){''}else{$_.label} })
        [TrailerBar]::ResetMenuEnabled=[bool[]]@($state.resetMenuItems | ForEach-Object { $_.enabled -ne $false })
        [TrailerBar]::Percentages=[double[]]@($state.percentages)
        [TrailerBar]::Tick([bool]$state.enabled)
        $bounds=[TrailerBar]::Bounds
        $current=@{resetMenuClosedBy=[TrailerBar]::ResetMenuClosedBy;resetMenuError=[TrailerBar]::ResetMenuError;resetMenuVisible=[TrailerBar]::ResetMenuVisible;resetMenuShows=[TrailerBar]::ResetMenuShows;resetMenuHandle=[TrailerBar]::ResetMenuHandle.ToInt64();state=[TrailerBar]::State;rightDowns=[TrailerBar]::RightDowns;rightUps=[TrailerBar]::RightUps;contextMenus=[TrailerBar]::ContextMenus;lastMouseMessage=[TrailerBar]::LastMouseMessage;windowHandle=[TrailerBar]::WindowHandle.ToInt64();helperPid=$PID;displayCaption=[TrailerBar]::DisplayCaption;x=$bounds.L;y=$bounds.T;width=($bounds.R-$bounds.L);height=($bounds.B-$bounds.T)}|ConvertTo-Json -Compress
        if($current -ne $last){[Console]::WriteLine($current);$last=$current}
      }catch{[Console]::WriteLine('{"state":"helper-error"}')}
      $next=$timer.ElapsedMilliseconds+1500
    }
    [TrailerBar]::Pump()
    if([TrailerBar]::DoubleClicked){[TrailerBar]::DoubleClicked=$false;[void][TrailerBar]::AllowSetForegroundWindow([uint32]$OwnerPid);[Console]::WriteLine('{"doubleClick":true}')}
    if([TrailerBar]::RightClicked){[TrailerBar]::RightClicked=$false;$next=0;[Console]::WriteLine('{"rightClick":true}')}
    Start-Sleep -Milliseconds 30
  }
}finally{[TrailerBar]::Close()}
