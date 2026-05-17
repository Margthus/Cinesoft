using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.IO.Pipes;
using System.Threading;

namespace Cinesoft.MpvHost;

internal sealed class MainForm : Form
{
    private readonly HostOptions _options;
    private readonly Panel _videoHostPanel;
    private Process? _mpvProcess;
    private readonly StringBuilder _mpvLogs = new();
    private readonly CancellationTokenSource _stdinCts = new();
    private Task? _stdinTask;
    private string? _mpvIpcPipeName;
    private int _ipcRequestId = 1000;
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
        Console.WriteLine($"[MpvHost:StdinCommand] raw={line}");
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement.Clone();
            var typeRaw = TryGetString(root, "type") ?? TryGetString(root, "Type");
            if (string.IsNullOrWhiteSpace(typeRaw))
            {
                Console.WriteLine($"[MpvHost:CommandDispatchError] unknown type=<null> raw={line}");
                return;
            }
            var type = typeRaw.Trim().ToLowerInvariant();
            if (type is "mpv-toggle-pause" or "mpv-set-pause" or "mpv-get-playback-status" or "mpv-seek" or "mpv-set-volume")
            {
                _ = Task.Run(async () =>
                {
                    try
                    {
                        if (type == "mpv-toggle-pause")
                        {
                            Console.WriteLine("[MpvHost:CommandDispatch] type=mpv-toggle-pause");
                            Console.WriteLine("[MpvHost:IPC] command=cycle pause");
                            await HandleTogglePauseAsync();
                            return;
                        }
                        if (type == "mpv-set-pause")
                        {
                            var pauseValue = TryGetBool(root, "pause") ?? TryGetBool(root, "Pause") ?? false;
                            Console.WriteLine("[MpvHost:CommandDispatch] type=mpv-set-pause");
                            Console.WriteLine($"[MpvHost:IPC] command=set pause value={pauseValue}");
                            await HandleSetPauseAsync(pauseValue);
                            return;
                        }
                        if (type == "mpv-seek")
                        {
                            var timePos = TryGetDouble(root, "timePos") ?? TryGetDouble(root, "TimePos") ?? 0d;
                            Console.WriteLine("[MpvHost:CommandDispatch] type=mpv-seek");
                            Console.WriteLine($"[MpvHost:IPC] command=set time-pos value={timePos}");
                            await HandleSeekAsync(timePos);
                            return;
                        }
                        if (type == "mpv-set-volume")
                        {
                            var volume = TryGetDouble(root, "volume") ?? TryGetDouble(root, "Volume") ?? 100d;
                            volume = Math.Max(0d, Math.Min(100d, volume));
                            Console.WriteLine("[MpvHost:CommandDispatch] type=mpv-set-volume");
                            Console.WriteLine($"[MpvHost:IPC] command=set volume value={volume}");
                            await HandleSetVolumeAsync(volume);
                            return;
                        }
                        Console.WriteLine("[MpvHost:CommandDispatch] type=mpv-get-playback-status");
                        Console.WriteLine("[MpvHost:IPC] command=get status");
                        await EmitPlaybackStatusAsync();
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[MpvHost:PlaybackStatusError] {ex.Message}");
                    }
                });
                return;
            }
            Console.WriteLine($"[MpvHost:CommandDispatch] type={type}");
            BeginInvoke(() =>
            {
                switch (type)
                {
                    case "bounds":
                    {
                        var x = Math.Max(0, TryGetInt(root, "x") ?? TryGetInt(root, "X") ?? Left);
                        var y = Math.Max(0, TryGetInt(root, "y") ?? TryGetInt(root, "Y") ?? Top);
                        var w = Math.Max(100, TryGetInt(root, "width") ?? TryGetInt(root, "Width") ?? Width);
                        var h = Math.Max(100, TryGetInt(root, "height") ?? TryGetInt(root, "Height") ?? Height);
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
                    default:
                        Console.WriteLine($"[MpvHost:CommandDispatchError] unknown type={type} raw={line}");
                        break;
                }
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[MpvHost:CommandDispatchError] parse error={ex.Message}");
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

        _mpvIpcPipeName = $"cinesoft-mpv-{Guid.NewGuid():N}";
        var args = new List<string>
        {
            $"--wid={hwnd}",
            $"--input-ipc-server=\\\\.\\pipe\\{_mpvIpcPipeName}",
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
        Console.WriteLine($"[MpvHost:IPC] mpvPipeName={_mpvIpcPipeName} mpvPipePath=\\\\.\\pipe\\{_mpvIpcPipeName}");

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

    private async Task EmitPlaybackStatusAsync()
    {
        var pauseResult = await SendMpvIpcCommandAsync(new object[] { "get_property", "pause" });
        if (!pauseResult.Success)
        {
            Console.WriteLine($"[MpvHost:PlaybackStatusError] {JsonSerializer.Serialize(new { error = pauseResult.Error, stage = "get-pause" })}");
            return;
        }
        var timeResult = await SendMpvIpcCommandAsync(new object[] { "get_property", "time-pos" });
        if (!timeResult.Success)
        {
            Console.WriteLine($"[MpvHost:PlaybackStatusError] {JsonSerializer.Serialize(new { error = timeResult.Error, stage = "get-time-pos" })}");
            return;
        }
        var durationResult = await SendMpvIpcCommandAsync(new object[] { "get_property", "duration" });
        if (!durationResult.Success)
        {
            Console.WriteLine($"[MpvHost:PlaybackStatusError] {JsonSerializer.Serialize(new { error = durationResult.Error, stage = "get-duration" })}");
            return;
        }
        var paused = pauseResult.Success && ToNullableBool(pauseResult.Data) == true;
        var timePos = timeResult.Success ? ToNullableDouble(timeResult.Data) : null;
        var duration = durationResult.Success ? ToNullableDouble(durationResult.Data) : null;
        var payload = new
        {
            paused,
            timePos,
            duration,
            hasMpv = _mpvProcess is { HasExited: false },
        };
        Console.WriteLine($"[MpvHost:PlaybackStatus] {JsonSerializer.Serialize(payload)}");
    }

    private async Task HandleSetPauseAsync(bool pause)
    {
        var result = await SendMpvIpcCommandAsync(new object[] { "set_property", "pause", pause });
        if (!result.Success)
        {
            Console.WriteLine($"[MpvHost:PlaybackStatusError] set pause failed: {result.Error ?? "unknown"}");
        }
        await EmitPlaybackStatusAsync();
    }

    private async Task HandleTogglePauseAsync()
    {
        var cyclePause = await SendMpvIpcCommandAsync(new object[] { "cycle", "pause" });
        if (!cyclePause.Success)
        {
            Console.WriteLine($"[MpvHost:PlaybackStatusError] toggle pause failed: {cyclePause.Error ?? "unknown"}");
        }
        await EmitPlaybackStatusAsync();
    }

    private async Task HandleSeekAsync(double timePos)
    {
        var result = await SendMpvIpcCommandAsync(new object[] { "set_property", "time-pos", timePos });
        if (!result.Success)
        {
            Console.WriteLine($"[MpvHost:PlaybackStatusError] seek failed: {result.Error ?? "unknown"}");
        }
        await EmitPlaybackStatusAsync();
    }

    private async Task HandleSetVolumeAsync(double volume)
    {
        var result = await SendMpvIpcCommandAsync(new object[] { "set_property", "volume", volume });
        if (!result.Success)
        {
            Console.WriteLine($"[MpvHost:PlaybackStatusError] set volume failed: {result.Error ?? "unknown"}");
        }
        await EmitPlaybackStatusAsync();
    }

    private async Task<MpvIpcCommandResult> SendMpvIpcCommandAsync(object[] command, int timeoutMs = 1500)
    {
        if (string.IsNullOrWhiteSpace(_mpvIpcPipeName) || _mpvProcess is not { HasExited: false })
        {
            return MpvIpcCommandResult.Fail("mpv ipc is not ready");
        }

        var requestId = Interlocked.Increment(ref _ipcRequestId);
        Exception? lastConnectError = null;
        NamedPipeClientStream? connectedClient = null;
        var connectDeadline = DateTime.UtcNow.AddMilliseconds(2000);
        var attempt = 0;
        Console.WriteLine($"[MpvHost:IPC] phase=connect-start pipeName={_mpvIpcPipeName}");
        while (DateTime.UtcNow < connectDeadline)
        {
            attempt += 1;
            var probeClient = new NamedPipeClientStream(".", _mpvIpcPipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            try
            {
                Console.WriteLine($"[MpvHost:IPC] connect attempt={attempt} pipeName={_mpvIpcPipeName}");
                using var connectCts = new CancellationTokenSource(600);
                await probeClient.ConnectAsync(connectCts.Token);
                connectedClient = probeClient;
                Console.WriteLine("[MpvHost:IPC] phase=connect-ok");
                break;
            }
            catch (Exception ex)
            {
                lastConnectError = ex;
                probeClient.Dispose();
                Console.WriteLine($"[MpvHost:IPC] phase=connect-failed attempt={attempt} error={ex.Message}");
                await Task.Delay(150);
            }
        }
        if (connectedClient is null)
        {
            Console.WriteLine($"[MpvHost:IPC] phase=error error=ipc connect failed: {lastConnectError?.Message ?? "unknown"}");
            return MpvIpcCommandResult.Fail($"ipc connect failed: {lastConnectError?.Message ?? "unknown"}");
        }

        using var client = connectedClient;

        await using var writer = new StreamWriter(client, new UTF8Encoding(false), leaveOpen: true)
        {
            AutoFlush = true,
            NewLine = "\n",
        };
        using var reader = new StreamReader(client, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);

        var requestPayload = new
        {
            command,
            request_id = requestId,
        };

        try
        {
            Console.WriteLine($"[MpvHost:IPC] phase=write command={JsonSerializer.Serialize(command)}");
            await writer.WriteLineAsync(JsonSerializer.Serialize(requestPayload));
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[MpvHost:IPC] phase=error error=ipc write failed: {ex.Message}");
            return MpvIpcCommandResult.Fail($"ipc write failed: {ex.Message}");
        }

        Console.WriteLine("[MpvHost:IPC] phase=read-start");
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            string? line;
            try
            {
                line = await reader.ReadLineAsync();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[MpvHost:IPC] phase=error error=ipc read failed: {ex.Message}");
                return MpvIpcCommandResult.Fail($"ipc read failed: {ex.Message}");
            }
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                Console.WriteLine($"[MpvHost:IPC] phase=read-ok raw={line}");
                if (!root.TryGetProperty("request_id", out var idElement) || idElement.GetInt32() != requestId)
                {
                    continue;
                }
                var errorValue = root.TryGetProperty("error", out var errorElement)
                    ? errorElement.GetString()
                    : null;
                var isSuccess = string.Equals(errorValue, "success", StringComparison.OrdinalIgnoreCase);
                JsonElement? data = null;
                if (root.TryGetProperty("data", out var dataElement))
                {
                    data = dataElement.Clone();
                }
                return new MpvIpcCommandResult(isSuccess, errorValue, data);
            }
            catch
            {
                // ignore malformed line and keep reading until deadline
            }
        }

        Console.WriteLine("[MpvHost:IPC] phase=error error=ipc response timeout");
        return MpvIpcCommandResult.Fail("ipc response timeout");
    }

    private static double? ToNullableDouble(JsonElement? element)
    {
        if (element is null) return null;
        var value = element.Value;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var result))
        {
            return result;
        }
        return null;
    }

    private static bool? ToNullableBool(JsonElement? element)
    {
        if (element is null) return null;
        var value = element.Value;
        if (value.ValueKind == JsonValueKind.True) return true;
        if (value.ValueKind == JsonValueKind.False) return false;
        return null;
    }

    private static string? TryGetString(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind == JsonValueKind.String) return value.GetString();
        return value.ToString();
    }

    private static bool? TryGetBool(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind == JsonValueKind.True) return true;
        if (value.ValueKind == JsonValueKind.False) return false;
        if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed)) return parsed;
        return null;
    }

    private static int? TryGetInt(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var numeric)) return numeric;
        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var parsed)) return parsed;
        return null;
    }

    private static double? TryGetDouble(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var numeric)) return numeric;
        if (value.ValueKind == JsonValueKind.String && double.TryParse(value.GetString(), out var parsed)) return parsed;
        return null;
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

internal sealed record MpvIpcCommandResult(bool Success, string? Error, JsonElement? Data)
{
    public static MpvIpcCommandResult Fail(string error) => new(false, error, null);
}
