using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Windows.Forms;
using System.Text.RegularExpressions;

public static class TrailerBar {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] struct Paint { public IntPtr Dc; public int Erase; public Rect R; public int Restore,Inc; [MarshalAs(UnmanagedType.ByValArray,SizeConst=32)] public byte[] Reserved; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Class { public uint Style; public IntPtr Proc; public int A,B; public IntPtr Instance,Icon,Cursor,Brush; public string Menu,Name; }
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate IntPtr WndProc(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string c,string t);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p,IntPtr a,string c,string t);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr h,IntPtr p);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr z,int x,int y,int w,int height,uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] static extern IntPtr SetCapture(IntPtr h);
  [DllImport("user32.dll")] static extern bool ReleaseCapture();
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref Class c);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool UnregisterClass(string c,IntPtr i);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint e,string c,string t,uint s,int x,int y,int w,int h,IntPtr p,IntPtr menu,IntPtr i,IntPtr param);
  [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h,uint key,byte alpha,uint f);
  [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr BeginPaint(IntPtr h,out Paint p);
  [DllImport("user32.dll")] static extern bool EndPaint(IntPtr h,ref Paint p);
  [DllImport("user32.dll")] static extern bool InvalidateRect(IntPtr h,IntPtr r,bool erase);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string n);
  static readonly WndProc Callback = WindowProc;
  static IntPtr child, parent;
  static bool registered;
  public static bool DoubleClicked;
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(uint processId);
  public static bool RightClicked;
  public static string[] ResetMenuLabels = new string[0];
  public static bool[] ResetMenuEnabled = new bool[0];
  static InfoWindow resetMenu;
  static IntPtr mouseHook, keyHook;
  delegate IntPtr HookProc(int code,IntPtr message,IntPtr data);
  static readonly HookProc MouseCallback = MouseInput, KeyCallback = KeyInput;
  [StructLayout(LayoutKind.Sequential)] struct HookPoint { public int X,Y; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id,HookProc proc,IntPtr module,uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
  public static bool ResetMenuVisible { get { return resetMenu != null && resetMenu.Visible; } }
  public static IntPtr ResetMenuHandle { get { return resetMenu == null ? IntPtr.Zero : resetMenu.Handle; } }
  public static int ResetMenuShows;
  public static string ResetMenuError = "";
  public static string ResetMenuClosedBy = "";
  sealed class InfoWindow : Form {
    public InfoWindow() {
      FormBorderStyle=FormBorderStyle.None; ShowInTaskbar=false; TopMost=true;
      AutoScaleMode=AutoScaleMode.None; Font=new Font("Segoe UI",9); BackColor=Color.FromArgb(19,29,43);
      AccessibleName="계정 한도 초기화까지 남은 시간";
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p=base.CreateParams;p.ExStyle|=0x08000000;return p; } }
    protected override void WndProc(ref Message m) {
      if(m.Msg==0x100 && m.WParam.ToInt32()==27){HideResetMenu();return;}
      base.WndProc(ref m);
    }
  }
  public static void HideResetMenu(string reason="cleanup") {
    if(ResetMenuVisible)ResetMenuClosedBy=reason;
    if(mouseHook!=IntPtr.Zero){UnhookWindowsHookEx(mouseHook);mouseHook=IntPtr.Zero;}
    if(keyHook!=IntPtr.Zero){UnhookWindowsHookEx(keyHook);keyHook=IntPtr.Zero;}
    if(resetMenu!=null)resetMenu.Hide();
  }
  public static void CheckOutsideClick(Point point) {
    if(!ResetMenuVisible)return;
    Rect r;GetWindowRect(resetMenu.Handle,out r);
    if(point.X>=r.L&&point.X<r.R&&point.Y>=r.T&&point.Y<r.B)return;
    if(point.X>=Bounds.L&&point.X<Bounds.R&&point.Y>=Bounds.T&&point.Y<Bounds.B)return;
    HideResetMenu("outside-click");
  }
  static IntPtr MouseInput(int code,IntPtr message,IntPtr data) {
    int m=message.ToInt32();
    if(code>=0&&(m==0x201||m==0x204||m==0x207||m==0x20B)) {
      var p=(HookPoint)Marshal.PtrToStructure(data,typeof(HookPoint));
      CheckOutsideClick(new Point(p.X,p.Y));
    }
    return CallNextHookEx(IntPtr.Zero,code,message,data);
  }
  static IntPtr KeyInput(int code,IntPtr message,IntPtr data) {
    if(code>=0&&ResetMenuVisible&&(message.ToInt32()==0x100||message.ToInt32()==0x104)&&Marshal.ReadInt32(data)==27) {
      HideResetMenu("escape-hook");return new IntPtr(1);
    }
    return CallNextHookEx(IntPtr.Zero,code,message,data);
  }
  static void OpenResetMenu() {
    if(ResetMenuVisible){HideResetMenu("toggle");return;}
    IntPtr old=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(child));
    try {
      if(resetMenu==null)resetMenu=new InfoWindow();
      while(resetMenu.Controls.Count>0)resetMenu.Controls[0].Dispose();
      var work=Screen.FromPoint(new Point(Bounds.L,Bounds.T)).WorkingArea;
      float scale=Math.Max(96,GetDpiForWindow(child))/96f;
      int width=Math.Min((int)(280*scale),work.Width),y=(int)(10*scale),padding=(int)(12*scale);
      var content=new Panel{Dock=DockStyle.Fill,AutoScroll=true,Padding=new Padding(1)};
      for(int i=0;i<ResetMenuLabels.Length;i++) {
        if(ResetMenuLabels[i]=="") { y+=(int)(8*scale);continue; }
        bool heading=i>=ResetMenuEnabled.Length||!ResetMenuEnabled[i];
        var label=new Label{Text=ResetMenuLabels[i],Left=padding,Top=y,Width=width-padding*2-2,
          Height=(int)(24*scale),ForeColor=heading?Color.FromArgb(128,217,190):Color.FromArgb(230,236,246),
          AutoEllipsis=true,TextAlign=ContentAlignment.MiddleLeft,UseMnemonic=false};
        int split=ResetMenuLabels[i].IndexOf("   ",StringComparison.Ordinal);
        if(split>=0) {
          label.Text=ResetMenuLabels[i].Substring(0,split);label.Width=(int)(78*scale);
          content.Controls.Add(new Label{Text=ResetMenuLabels[i].Substring(split+3),Left=padding+label.Width,Top=y,
            Width=width-padding*2-label.Width-2,Height=label.Height,ForeColor=Color.FromArgb(230,236,246),
            TextAlign=ContentAlignment.MiddleRight,AutoEllipsis=true,UseMnemonic=false});
        }
        content.Controls.Add(label);y+=label.Height;
      }
      int height=Math.Min(y+(int)(10*scale),work.Height);
      resetMenu.ClientSize=new Size(width,height);resetMenu.Controls.Add(content);
      resetMenu.Location=new Point(Math.Max(work.Left,Math.Min(Bounds.R-width,work.Right-width)),Math.Max(work.Top,Math.Min(Bounds.T-height-4,work.Bottom-height)));
      mouseHook=SetWindowsHookEx(14,MouseCallback,GetModuleHandle(null),0);
      keyHook=SetWindowsHookEx(13,KeyCallback,GetModuleHandle(null),0);
      if(mouseHook==IntPtr.Zero||keyHook==IntPtr.Zero){ResetMenuError="dismiss-hook-failed";HideResetMenu();return;}
      ResetMenuError="";resetMenu.Show();ResetMenuShows++;
    } finally {SetThreadDpiAwarenessContext(old);}
  }
  public static uint LastMouseMessage;
  public static int RightDowns,RightUps,ContextMenus;
  public static string State="starting";
  public static Rect Bounds;
  public static IntPtr WindowHandle { get { return child; } }
  public static string Caption="TokenTrailer";
  public static string CompactCaption="TokenTrailer";
  public static string DisplayCaption="TokenTrailer";
  public static double[] Percentages=new double[0];
  public static Color UsageColor(double value) {
    return Double.IsNaN(value)||Double.IsInfinity(value) ? Color.FromArgb(230,236,246) : value>=90 ? Color.FromArgb(255,112,120) : value>=60 ? Color.FromArgb(255,180,84) : Color.FromArgb(118,219,155);
  }
  static void DrawCaption(Graphics g,Font font,Rect rect) {
    string[] lines=DisplayCaption.Split('\n');int index=0;
    float lineHeight=font.GetHeight(g),y=(rect.B-lines.Length*lineHeight)/2;
    using(var format=new StringFormat(StringFormat.GenericTypographic)) {
      format.FormatFlags|=StringFormatFlags.MeasureTrailingSpaces|StringFormatFlags.NoWrap;
      foreach(string line in lines) {
        float x=(rect.R-g.MeasureString(line,font,Int32.MaxValue,format).Width)/2;
        foreach(string part in Regex.Split(line,@"(\d+(?:\.\d+)?%)")) {
          bool usage=Regex.IsMatch(part,@"^\d+(?:\.\d+)?%$");
          Color color=usage&&index<Percentages.Length ? UsageColor(Percentages[index]) : Color.FromArgb(230,236,246);
          if(usage)index++;
          using(var brush=new SolidBrush(color))g.DrawString(part,font,brush,new PointF(x,y),format);
          x+=g.MeasureString(part,font,Int32.MaxValue,format).Width;
        }
        y+=lineHeight;
      }
    }
  }
  public static int RequiredWidth(string text, float dpi) {
    using(var bitmap=new Bitmap(1,1)) { bitmap.SetResolution(dpi,dpi);
      using(var g=Graphics.FromImage(bitmap)) using(var font=new Font("Segoe UI",9,FontStyle.Regular,GraphicsUnit.Point)) {
        return (int)Math.Ceiling(g.MeasureString(text,font).Width)+16;
      }
    }
  }
  public static int GapPosition(List<int[]> occupied,int width,int desired,int pad) {
    int edge=pad,position=-1;
    foreach(var interval in occupied){if(interval[0]-edge>=desired+pad)position=interval[0]-desired-pad;edge=Math.Max(edge,interval[1]);}
    if(width-40-edge>=desired+pad)position=width-40-desired-pad;
    return position;
  }
  const string Name="TokenTrailerTaskbar";
  static IntPtr WindowProc(IntPtr h,uint m,IntPtr w,IntPtr l) {
    if(m>=0x200&&m<=0x20E||m==0x7B)LastMouseMessage=m;
    if(m==0x204)RightDowns++;if(m==0x205)RightUps++;if(m==0x7B)ContextMenus++;
    // The Explorer parent must not activate/eat the first click on our child.
    if(m==0x21)return new IntPtr(3);
    if(m==0x201||m==0x202)return IntPtr.Zero;
    if(m==0x204){SetCapture(h);return IntPtr.Zero;}
    if(m==0x203){HideResetMenu();DoubleClicked=true;return IntPtr.Zero;}
    if(m==0x205){ReleaseCapture();RightClicked=true;OpenResetMenu();return IntPtr.Zero;}
    if(m==0x7B){return IntPtr.Zero;}
    if(m==0xF){
      Paint p;IntPtr dc=BeginPaint(h,out p);
      try{using(var g=Graphics.FromHdc(dc)){g.Clear(Color.FromArgb(20,35,43));using(var font=new Font("Segoe UI",9,FontStyle.Regular,GraphicsUnit.Point)){Rect r;GetClientRect(h,out r);DrawCaption(g,font,r);}}}
      finally{EndPaint(h,ref p);}return IntPtr.Zero;
    }
    return DefWindowProc(h,m,w,l);
  }
  static void Remove(){HideResetMenu("surface-removed");if(IsWindow(child))DestroyWindow(child);child=IntPtr.Zero;parent=IntPtr.Zero;}
  public static void Tick(bool enabled){
    if(!enabled){Remove();State="disabled";return;}
    // Keep the input-hook message pump responsive while the information window is open.
    if(ResetMenuVisible&&IsWindow(child)){InvalidateRect(child,IntPtr.Zero,false);return;}
    IntPtr tray=FindWindow("Shell_TrayWnd",null);
    if(tray==IntPtr.Zero){Remove();State="waiting-shell";return;}
    IntPtr old=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(tray));
    try{
      Rect r; if(!GetWindowRect(tray,out r)){State="layout-unavailable";Remove();return;}
      int height=r.B-r.T,width=r.R-r.L;
      if(height<20||height>150||!IsWindowVisible(tray)){if(IsWindow(child))ShowWindow(child,0);State="taskbar-hidden";return;}
      float dpi=Math.Max(96,GetDpiForWindow(tray));
      string full=Caption,compact=CompactCaption;
      int desired=RequiredWidth(full,dpi),pad=8;
      var occupied=new List<int[]>();
      // Keep the left widgets area out of consideration even if UIA omits it.
      occupied.Add(new int[]{0,Math.Min(width,250)});
      foreach(string cls in new[]{"TrayNotifyWnd","ReBarWindow32"}){
        IntPtr h=FindWindowEx(tray,IntPtr.Zero,cls,null);Rect b;
        if(h!=IntPtr.Zero&&IsWindowVisible(h)&&GetWindowRect(h,out b))occupied.Add(new int[]{b.L-r.L,b.R-r.L});
      }
      try{
        var root=AutomationElement.FromHandle(tray);
        var types=new[]{ControlType.Button,ControlType.MenuItem,ControlType.ListItem,ControlType.Edit,ControlType.CheckBox,ControlType.TabItem,ControlType.Text};
        var conditions=new List<Condition>();foreach(var t in types)conditions.Add(new PropertyCondition(AutomationElement.ControlTypeProperty,t));
        var elements=root.FindAll(TreeScope.Descendants,new OrCondition(conditions.ToArray()));
        foreach(AutomationElement element in elements){var c=element.Current;if(c.IsOffscreen||c.ProcessId==Process.GetCurrentProcess().Id)continue;var b=c.BoundingRectangle;
          if(b.Width>0&&b.Height>0&&b.Top<r.B&&b.Bottom>r.T)occupied.Add(new int[]{(int)b.Left-r.L-pad,(int)Math.Ceiling(b.Right)-r.L+pad});}
      }catch{Remove();State="layout-unavailable";return;}
      occupied.Sort((a,b)=>a[0].CompareTo(b[0]));
      int position=GapPosition(occupied,width,desired,pad);DisplayCaption=full;
      if(position<0){desired=RequiredWidth(compact,dpi);position=GapPosition(occupied,width,desired,pad);DisplayCaption=compact;}
      if(position<0){Remove();State="no-space";return;}
      if(!IsWindow(child)||parent!=tray||GetParent(child)!=tray){
        Remove();
        if(!registered){var c=new Class{Style=8,Proc=Marshal.GetFunctionPointerForDelegate(Callback),Instance=GetModuleHandle(null),Name=Name};registered=RegisterClass(ref c)!=0;}
        if(!registered){State="create-failed";return;}
        child=CreateWindowEx(0x80000,Name,"TokenTrailer",0x40000000,0,0,desired,height-8,GetDesktopWindow(),IntPtr.Zero,GetModuleHandle(null),IntPtr.Zero);
        if(child==IntPtr.Zero){State="create-failed";return;}
        SetParent(child,tray);parent=tray;
        if(GetParent(child)!=tray||!SetLayeredWindowAttributes(child,0,255,2)){Remove();State="attach-failed";return;}
      }
      if(!SetWindowPos(child,IntPtr.Zero,position,4,desired,height-8,0x0050)){Remove();State="position-failed";return;}
      InvalidateRect(child,IntPtr.Zero,false);GetWindowRect(child,out Bounds);State="attached";
    }finally{SetThreadDpiAwarenessContext(old);}
  }
  public static void Pump(){Application.DoEvents();}
  public static void Close(){HideResetMenu();if(resetMenu!=null){resetMenu.Dispose();resetMenu=null;}Remove();if(registered)UnregisterClass(Name,GetModuleHandle(null));registered=false;}
}
