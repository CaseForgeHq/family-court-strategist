using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Web.Script.Serialization;

// Status only: installation and automatic relaunch remain electron-updater's job.
sealed class UpdateWindow : Form {
    readonly string executable, ready;
    readonly int previousPid;
    readonly Stopwatch elapsed = Stopwatch.StartNew();
    readonly Timer animation = new Timer(), monitor = new Timer();
    readonly Label title = new Label(), detail = new Label();
    float angle;
    bool previousExited;
    Dictionary<string, object> plan;
    string root, stage, backup, receipt, pending, updateId;
    bool switched, attempted, finished;
    Process replacement;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    public UpdateWindow(string path, int pid, string signal, string planFile) {
        executable = Path.GetFullPath(path); previousPid = pid; ready = signal;
        if (planFile != null) {
            plan = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(planFile));
            root = Path.GetDirectoryName(executable); updateId = Convert.ToString(plan["id"]);
            if (!System.Text.RegularExpressions.Regex.IsMatch(updateId, "^[a-f0-9]{32}$") ||
                !String.Equals(Path.GetFullPath(Convert.ToString(plan["root"])), root, StringComparison.OrdinalIgnoreCase) ||
                Convert.ToInt32(plan["previousPid"]) != pid) throw new Exception("Invalid restart plan.");
            stage = Path.Combine(root, ".caseforge-stage-" + updateId);
            if (!String.Equals(Path.GetFullPath(planFile), Path.Combine(stage, "plan.json"), StringComparison.OrdinalIgnoreCase)) throw new Exception("Invalid stage path.");
            backup = Path.Combine(root, ".caseforge-rollback-" + updateId);
            receipt = Path.Combine(root, ".caseforge-ready-" + updateId);
            pending = Path.Combine(root, ".caseforge-fast-update.json");
        }
        Text = "Case Forge — Restarting"; ClientSize = new Size(490, 172);
        FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(14, 31, 44); ForeColor = Color.FromArgb(236, 244, 251);
        AutoScaleMode = AutoScaleMode.Dpi; DoubleBuffered = true;
        title.Text = "Restarting Case Forge"; title.SetBounds(90, 46, 340, 30);
        title.Font = new Font("Segoe UI", 16, FontStyle.Bold);
        detail.Text = "Reopening automatically…";
        detail.SetBounds(92, 85, 355, 46); detail.Font = new Font("Segoe UI", 10);
        detail.ForeColor = Color.FromArgb(180, 206, 227);
        var close = new Button(); close.Text = "×"; close.AccessibleName = "Hide restart status";
        close.SetBounds(454, 8, 27, 27); close.FlatStyle = FlatStyle.Flat;
        close.FlatAppearance.BorderSize = 0; close.ForeColor = detail.ForeColor;
        close.Click += delegate { if (plan != null) Hide(); else Close(); };
        FormClosing += delegate(object sender, FormClosingEventArgs args) { if (plan != null && !finished) { args.Cancel = true; Hide(); } };
        Controls.Add(title); Controls.Add(detail); Controls.Add(close);
        animation.Interval = 25; animation.Tick += delegate { angle = (angle + 6) % 360; Invalidate(new Rectangle(24, 49, 55, 55)); };
        monitor.Interval = 25; monitor.Tick += delegate { Observe(); };
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
            if (plan != null) {
                if (!attempted) { attempted = true; Apply(); }
                if (File.Exists(receipt)) {
                    double started = Convert.ToDouble(plan["startedAt"]);
                    double now = (DateTime.UtcNow - new DateTime(1970,1,1)).TotalMilliseconds;
                    File.WriteAllText(Path.Combine(root, ".caseforge-last-update.json"), json.Serialize(new { version = plan["version"], restartMs = Math.Round(now - started), result = "ready" }));
                    File.Delete(pending); File.Delete(receipt);
                    // Only directories created by this verified transaction are removed.
                    new System.Threading.Thread(delegate() { try { if (switched) Directory.Delete(backup, true); Directory.Delete(stage, true); } catch {} }).Start();
                    Finish(); return;
                }
                if (switched && replacement != null && replacement.HasExited) { if (Rollback()) Finish(); return; }
                if (!switched) return;
            } else {
            foreach (var candidate in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable))) {
                using (candidate) { try {
                    if (candidate.Id != previousPid && candidate.MainWindowHandle != IntPtr.Zero &&
                        String.Equals(candidate.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase)) { Close(); return; }
                } catch {} }
            }
            }
        }
        if (elapsed.Elapsed.TotalSeconds > 90) {
            title.Text = "Still applying your update";
            detail.Text = "Windows is taking longer than usual. Case Forge will reopen when installation finishes.";
        }
        if (elapsed.Elapsed.TotalMinutes > 10) Finish();
    }
    Process Launch() {
        string profile = plan != null && plan.ContainsKey("userData") ? Convert.ToString(plan["userData"]) : "";
        if (profile.Contains("\"") || profile.Contains("\r") || profile.Contains("\n")) throw new Exception("Invalid profile path.");
        return Process.Start(new ProcessStartInfo(executable, profile.Length == 0 ? "" : "--user-data-dir=\"" + profile + "\"") { UseShellExecute = false, WorkingDirectory = root });
    }
    void Apply() {
        try {
            var next = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(stage, "resources", "fast-update.json")));
            if (Convert.ToString(next["version"]) != Convert.ToString(plan["version"])) throw new Exception("Unexpected staged version.");
            string resources = Path.Combine(root, "resources");
            // Short-lived renderer/AV handles can outlive the main process.
            var switching = Stopwatch.StartNew();
            while (true) {
                try {
                    Directory.Move(resources, backup);
                    try { Directory.Move(Path.Combine(stage, "resources"), resources); }
                    catch { Directory.Move(backup, resources); throw; }
                    break;
                } catch (IOException) { if (switching.ElapsedMilliseconds > 1500) throw; System.Threading.Thread.Sleep(25); }
                catch (UnauthorizedAccessException) { if (switching.ElapsedMilliseconds > 1500) throw; System.Threading.Thread.Sleep(25); }
            }
            switched = true;
            File.WriteAllText(pending, json.Serialize(new { id = updateId, version = plan["version"] }));
            replacement = Launch();
        } catch (Exception error) {
            if (Rollback(error.GetType().Name + ": " + error.Message)) Finish();
        }
    }
    void Finish() { finished = true; Close(); }
    bool Rollback(string reason = "Replacement app exited before becoming ready.") {
        try {
            if (switched) {
                var restoring = Stopwatch.StartNew();
                while (true) {
                    try {
                        if (Directory.Exists(Path.Combine(root, "resources"))) Directory.Move(Path.Combine(root, "resources"), Path.Combine(stage, "failed-resources"));
                        Directory.Move(backup, Path.Combine(root, "resources")); switched = false; break;
                    } catch (IOException) { if (restoring.ElapsedMilliseconds > 2000) throw; System.Threading.Thread.Sleep(25); }
                    catch (UnauthorizedAccessException) { if (restoring.ElapsedMilliseconds > 2000) throw; System.Threading.Thread.Sleep(25); }
                }
            }
            File.WriteAllText(Path.Combine(root, ".caseforge-fast-failed.json"), json.Serialize(new { version = plan["version"], reason = reason }));
            if (File.Exists(pending)) File.Delete(pending);
            Launch(); return true;
        } catch (Exception error) {
            title.Text = "Restoring Case Forge"; detail.Text = "Waiting for Windows to release the app files…";
            try { File.WriteAllText(Path.Combine(root, ".caseforge-recovery-error.txt"), error.GetType().Name + ": " + error.Message); } catch {}
            return false;
        }
    }
    [STAThread] static void Main(string[] args) {
        int pid; if ((args.Length != 3 && args.Length != 4) || !Int32.TryParse(args[1], out pid) || !Path.IsPathRooted(args[0])) return;
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new UpdateWindow(args[0], pid, args[2], args.Length == 4 ? args[3] : null));
    }
}
