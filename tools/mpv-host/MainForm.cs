using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Cinesoft.MpvHost;

internal sealed class MainForm : Form
{
    private readonly HostOptions _options;
    private readonly Panel _videoHostPanel;
    private Process? _mpvProcess;
    private readonly StringBuilder _mpvLogs = new();
    private readonly CancellationTokenSource _stdinCts = new();
    private Task? _stdinTask;
    private const int GWL_STYLE = -16;
    private const uint WS_CHILD = 0x40000000;
    private const uint WS_VISIBLE = 0x10000000;
    private const uint WS_POPUP = 0x80000000;
    private const uint WS_CAPTION = 0x00C00000;
    private const uint WS_THICKFRAME = 0x00040000;
    private const uint WS_MINIMIZEBOX = 0x00020000;
    private const uint WS_MAXIMIZEBOX = 0x00010000;
    private const uint WS_SYSMENU = 0x00080000;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;
    private static readonly uint TOP_LEVEL_STYLE_MASK = WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern nint SetParent(nint hWndChild, nint hWndNewParent);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern nint GetWindowLongPtr64(nint hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern nint SetWindowLongPtr64(nint hWnd, int nIndex, nint dwNewLong);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
    private static extern int GetWindowLong32(nint hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
    private static extern int SetWindowLong32(nint hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(nint hWnd, nint hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    public MainForm(HostOptions options)
    {
        _options = options;

        Text = string.IsNullOrWhiteSpace(_options.Title) ? "CineSoft MPV Host" : _options.Title;
        Width = _options.Width;
        Height = _options.Height;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.Black;
        if (_options.Borderless)
        {
            FormBorderStyle = FormBorderStyle.None;
        }
        if (_options.NoTaskbar)
        {
            ShowInTaskbar = false;
        }
        if (_options.X.HasValue || _options.Y.HasValue)
        {
            StartPosition = FormStartPosition.Manual;
            var x = _options.X ?? Left;
            var y = _options.Y ?? Top;
            Bounds = new Rectangle(x, y, _options.Width, _options.Height);
        }

        _videoHostPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Black,
        };

        Controls.Add(_videoHostPanel);

        Shown += OnShown;
        FormClosing += OnFormClosing;
    }

    private void OnShown(object? sender, EventArgs e)
    {
        ApplyParentChildWindowMode();
        StartCommandLoop();
        StartMpvEmbedded();
    }

    private static nint GetWindowStyle(nint hwnd)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, GWL_STYLE) : new nint(GetWindowLong32(hwnd, GWL_STYLE));
    }

    private static void SetWindowStyle(nint hwnd, nint style)
    {
        if (IntPtr.Size == 8)
        {
            SetWindowLongPtr64(hwnd, GWL_STYLE, style);
        }
        else
        {
            SetWindowLong32(hwnd, GWL_STYLE, style.ToInt32());
        }
    }

    private void ApplyParentChildWindowMode()
    {
        if (!_options.ParentHwnd.HasValue || _options.ParentHwnd.Value <= 0) return;

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;

        var parentHwnd = new nint(_options.ParentHwnd.Value);
        var childHwnd = Handle;
        SetParent(childHwnd, parentHwnd);

        var existingStyle = GetWindowStyle(childHwnd);
        var style = (long)existingStyle;
        style &= ~(long)TOP_LEVEL_STYLE_MASK;
        style |= WS_CHILD;
        style |= WS_VISIBLE;
        SetWindowStyle(childHwnd, new nint(style));

        var x = Math.Max(0, _options.X ?? 0);
        var y = Math.Max(0, _options.Y ?? 0);
        var w = Math.Max(100, _options.Width);
        var h = Math.Max(100, _options.Height);
        Bounds = new Rectangle(x, y, w, h);
        SetWindowPos(childHwnd, nint.Zero, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);

        Console.WriteLine($"[host:parent] parentHwnd={parentHwnd} childHwnd={childHwnd} style=0x{style:X} bounds={x},{y},{w},{h}");
    }

    private void StartCommandLoop()
    {
        _stdinTask = Task.Run(async () =>
        {
            using var reader = new StreamReader(Console.OpenStandardInput());
            while (!_stdinCts.Token.IsCancellationRequested)
            {
                string? line;
                try
                {
                    line = await reader.ReadLineAsync(_stdinCts.Token);
                }
                catch
                {
                    break;
                }

                if (line is null) break;
                HandleStdinCommand(line);
            }
        }, _stdinCts.Token);
    }

    private void HandleStdinCommand(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        try
        {
            var cmd = JsonSerializer.Deserialize<HostCommand>(line);
            if (cmd?.Type is null) return;
            BeginInvoke(() =>
            {
                switch (cmd.Type.Trim().ToLowerInvariant())
                {
                    case "bounds":
                    {
                        var x = Math.Max(0, cmd.X ?? Left);
                        var y = Math.Max(0, cmd.Y ?? Top);
                        var w = Math.Max(100, cmd.Width ?? Width);
                        var h = Math.Max(100, cmd.Height ?? Height);
                        Bounds = new Rectangle(x, y, w, h);
                        break;
                    }
                    case "show":
                        Show();
                        break;
                    case "hide":
                        Hide();
                        break;
                    case "close":
                        Close();
                        break;
                }
            });
        }
        catch
        {
            // ignore malformed command lines
        }
    }

    private void StartMpvEmbedded()
    {
        if (_mpvProcess is not null)
        {
            return;
        }

        _videoHostPanel.CreateControl();
        var hwnd = _videoHostPanel.Handle.ToInt64();

        var args = new List<string>
        {
            $"--wid={hwnd}",
            "--force-window=yes",
            "--idle=no",
            "--no-config",
            "--terminal=no",
            "--msg-level=all=warn",
        };

        if (string.Equals(_options.SourceType, "embedded-stream-url", StringComparison.OrdinalIgnoreCase))
        {
            args.Add("--cache=yes");
            args.Add("--demuxer-readahead-secs=20");
            args.Add("--network-timeout=10");
            args.Add("--user-agent=CineSoft-MPV");
        }

        if (!string.IsNullOrWhiteSpace(_options.Title))
        {
            args.Add($"--title={_options.Title}");
        }

        if (_options.StartPaused)
        {
            args.Add("--pause");
        }

        args.Add(_options.Source);

        var psi = new ProcessStartInfo
        {
            FileName = _options.MpvPath,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        foreach (var arg in args)
        {
            psi.ArgumentList.Add(arg);
        }

        _mpvProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _mpvProcess.OutputDataReceived += (_, ev) => CaptureLog(ev.Data, isError: false);
        _mpvProcess.ErrorDataReceived += (_, ev) => CaptureLog(ev.Data, isError: true);
        _mpvProcess.Exited += (_, _) =>
        {
            var exitCode = _mpvProcess?.ExitCode ?? -1;
            Console.WriteLine($"[MpvHost:MPV:exit] code={exitCode}");
            CaptureLog($"mpv exited with code {exitCode}", isError: false);
            if (!_options.KeepOpenOnExit)
            {
                BeginInvoke(() => Close());
            }
        };

        if (!_mpvProcess.Start())
        {
            throw new InvalidOperationException("Failed to start mpv process.");
        }

        _mpvProcess.BeginOutputReadLine();
        _mpvProcess.BeginErrorReadLine();
    }

    private void CaptureLog(string? line, bool isError)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        var prefix = isError ? "[MpvHost:MPV:stderr]" : "[MpvHost:MPV:stdout]";
        lock (_mpvLogs)
        {
            _mpvLogs.AppendLine($"{prefix} {line}");
            if (_mpvLogs.Length > 16000)
            {
                _mpvLogs.Remove(0, _mpvLogs.Length - 16000);
            }
        }
        Console.WriteLine($"{prefix} {line}");
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        _stdinCts.Cancel();
        CleanupMpvProcess();
    }

    private void CleanupMpvProcess()
    {
        try
        {
            if (_mpvProcess is { HasExited: false })
            {
                _mpvProcess.Kill(entireProcessTree: true);
                _mpvProcess.WaitForExit(2000);
            }
        }
        catch
        {
            // ignore cleanup errors
        }
        finally
        {
            _mpvProcess?.Dispose();
            _mpvProcess = null;
        }
    }
}

internal sealed class HostCommand
{
    public string? Type { get; set; }
    public int? X { get; set; }
    public int? Y { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
}
