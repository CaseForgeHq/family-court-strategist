using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;

// Status only: installation and automatic relaunch remain electron-updater's job.
sealed class UpdateWindow : Form {
    readonly string executable, ready;
    readonly int previousPid;
    readonly Stopwatch elapsed = Stopwatch.StartNew();
    readonly Timer animation = new Timer(), monitor = new Timer();
    readonly Label title = new Label(), detail = new Label();
    float angle;
    bool previousExited;
    public UpdateWindow(string path, int pid, string signal) {
        executable = Path.GetFullPath(path); previousPid = pid; ready = signal;
        Text = "Case Forge — Restarting"; ClientSize = new Size(490, 172);
        FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(14, 31, 44); ForeColor = Color.FromArgb(236, 244, 251);
        AutoScaleMode = AutoScaleMode.Dpi; DoubleBuffered = true;
        title.Text = "Restarting Case Forge"; title.SetBounds(90, 46, 340, 30);
        title.Font = new Font("Segoe UI", 16, FontStyle.Bold);
        detail.Text = "Applying your update. We'll reopen automatically.";
        detail.SetBounds(92, 85, 355, 46); detail.Font = new Font("Segoe UI", 10);
        detail.ForeColor = Color.FromArgb(180, 206, 227);
        var close = new Button(); close.Text = "×"; close.AccessibleName = "Hide restart status";
        close.SetBounds(454, 8, 27, 27); close.FlatStyle = FlatStyle.Flat;
        close.FlatAppearance.BorderSize = 0; close.ForeColor = detail.ForeColor;
        close.Click += delegate { Close(); };
        Controls.Add(title); Controls.Add(detail); Controls.Add(close);
        animation.Interval = 25; animation.Tick += delegate { angle = (angle + 6) % 360; Invalidate(new Rectangle(24, 49, 55, 55)); };
        monitor.Interval = 250; monitor.Tick += delegate { Observe(); };
        Shown += delegate { try { File.WriteAllText(ready, "ready"); } catch {} animation.Start(); monitor.Start(); };
        FormClosed += delegate { animation.Dispose(); monitor.Dispose(); };
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e); e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var border = new Pen(Color.FromArgb(58, 119, 177))) e.Graphics.DrawRectangle(border, 0, 0, Width - 1, Height - 1);
        using (var track = new Pen(Color.FromArgb(37, 63, 85), 4)) e.Graphics.DrawEllipse(track, 32, 57, 38, 38);
        using (var arc = new Pen(Color.FromArgb(114, 193, 255), 4)) { arc.StartCap = LineCap.Round; arc.EndCap = LineCap.Round; e.Graphics.DrawArc(arc, 32, 57, 38, 38, angle, 95); }
        using (var line = new LinearGradientBrush(new Rectangle(0, Height - 3, Width, 3), Color.FromArgb(35, 114, 227), Color.FromArgb(120, 208, 255), 0f)) e.Graphics.FillRectangle(line, 0, Height - 3, Width, 3);
    }
    void Observe() {
        if (!previousExited) {
            try { using (var old = Process.GetProcessById(previousPid)) previousExited = old.HasExited; } catch { previousExited = true; }
        }
        if (previousExited) {
            foreach (var candidate in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable))) {
                using (candidate) { try {
                    if (candidate.Id != previousPid && candidate.MainWindowHandle != IntPtr.Zero &&
                        String.Equals(candidate.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase)) { Close(); return; }
                } catch {} }
            }
        }
        if (elapsed.Elapsed.TotalSeconds > 90) {
            title.Text = "Still applying your update";
            detail.Text = "Windows is taking longer than usual. Case Forge will reopen when installation finishes.";
        }
        if (elapsed.Elapsed.TotalMinutes > 10) Close();
    }
    [STAThread] static void Main(string[] args) {
        int pid; if (args.Length != 3 || !Int32.TryParse(args[1], out pid) || !Path.IsPathRooted(args[0])) return;
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new UpdateWindow(args[0], pid, args[2]));
    }
}
