using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using LibVLCSharp.Shared;
using LibVLCSharp.WinForms;

namespace Cinesoft.VlcHost;

internal sealed record LaunchOptions(
    string Url,
    string Title,
    long ParentHwnd,
    bool Fullscreen,
    int NetworkCachingMs,
    int InsetLeft,
    int InsetRight,
    int InsetTop,
    int InsetBottom,
    bool Quiet,
    bool Verbose);

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var options = ParseArgs(args);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Core.Initialize();
            Log("VlcHost:Ready", $"title={options.Title}; url={MaskSensitiveUrl(options.Url)}", options, force: true);
            Application.Run(new PlayerForm(options));
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[VlcHost:Error] {ex}");
            return 1;
        }
    }

    private static LaunchOptions ParseArgs(string[] args)
    {
        string url = string.Empty;
        string title = "CineSoft Stream";
        long parentHwnd = 0;
        var fullscreen = false;
        var quiet = false;
        var verbose = false;
        var networkCachingMs = 1000;
        var insetLeft = 16;
        var insetRight = 16;
        var insetTop = 52;
        var insetBottom = 116;

        for (var i = 0; i < args.Length; i += 1)
        {
            var arg = args[i];
            switch (arg)
            {
                case "--url":
                    url = ReadNextValue(args, ref i, "--url");
                    break;
                case "--title":
                    title = ReadNextValue(args, ref i, "--title");
                    break;
                case "--parent-hwnd":
                    parentHwnd = long.TryParse(ReadNextValue(args, ref i, "--parent-hwnd"), out var parsedHwnd) ? parsedHwnd : 0;
                    break;
                case "--network-caching-ms":
                    networkCachingMs = Math.Max(0, int.TryParse(ReadNextValue(args, ref i, "--network-caching-ms"), out var parsedCaching) ? parsedCaching : 1000);
                    break;
                case "--inset-left":
                    insetLeft = Math.Max(0, int.TryParse(ReadNextValue(args, ref i, "--inset-left"), out var parsedLeft) ? parsedLeft : 16);
                    break;
                case "--inset-right":
                    insetRight = Math.Max(0, int.TryParse(ReadNextValue(args, ref i, "--inset-right"), out var parsedRight) ? parsedRight : 16);
                    break;
                case "--inset-top":
                    insetTop = Math.Max(0, int.TryParse(ReadNextValue(args, ref i, "--inset-top"), out var parsedTop) ? parsedTop : 52);
                    break;
                case "--inset-bottom":
                    insetBottom = Math.Max(0, int.TryParse(ReadNextValue(args, ref i, "--inset-bottom"), out var parsedBottom) ? parsedBottom : 116);
                    break;
                case "--fullscreen":
                    fullscreen = true;
                    break;
                case "--quiet":
                    quiet = true;
                    break;
                case "--verbose":
                    verbose = true;
                    break;
            }
        }

        if (string.IsNullOrWhiteSpace(url))
        {
            throw new InvalidOperationException("Missing required --url argument");
        }

        return new LaunchOptions(
            url,
            string.IsNullOrWhiteSpace(title) ? "CineSoft Stream" : title.Trim(),
            parentHwnd,
            fullscreen,
            networkCachingMs,
            insetLeft,
            insetRight,
            insetTop,
            insetBottom,
            quiet,
            verbose);
    }

    private static string ReadNextValue(string[] args, ref int index, string flag)
    {
        if (index + 1 >= args.Length)
        {
            throw new InvalidOperationException($"Missing value for {flag}");
        }

        index += 1;
        return args[index];
    }

    internal static void Log(string tag, string message, LaunchOptions options, bool force = false)
    {
        if (!force && options.Quiet && tag != "VlcHost:Error")
        {
            return;
        }

        if (!options.Verbose && !force && tag == "VlcHost")
        {
            return;
        }

        Console.WriteLine($"[{tag}] {message}");
    }

    internal static string MaskSensitiveUrl(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        return System.Text.RegularExpressions.Regex.Replace(
            value,
            @"(?i)(apikey|api_key|token|key|pass|password)=([^&]+)",
            "$1=***");
    }
}

internal sealed class PlayerForm : Form
{
    private sealed record SubtitleOption(string Key, int? SpuId, string Label, string Source, string? Path = null);

    private const int TitleBarHeight = 44;
    private const int WmNclbuttondown = 0xA1;
    private const int HtCaption = 0x2;
    private const int GwlStyle = -16;
    private const int WsChild = 0x40000000;
    private const int WsVisible = 0x10000000;
    private const int WsCaption = 0x00C00000;
    private const int WsPopup = unchecked((int)0x80000000);
    private const int WsThickFrame = 0x00040000;
    private const int WsBorder = 0x00800000;
    private const int WsDlgFrame = 0x00400000;
    private static readonly IntPtr HwndTop = IntPtr.Zero;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpShowWindow = 0x0040;
    private const uint SwpNoMove = 0x0002;
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpFrameChanged = 0x0020;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetClientRect(IntPtr hWnd, out Rect lpRect);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private readonly LaunchOptions _options;
    private readonly Panel _titleBar;
    private readonly Label _titleLabel;
    private readonly Button _closeButton;
    private readonly Button _minimizeButton;
    private readonly Button _fullscreenButton;
    private readonly VideoView _videoView;
    private readonly System.Windows.Forms.Timer _uiTimer;
    private readonly System.Windows.Forms.Timer _embedBoundsTimer;
    private readonly bool _embeddedMode;

    private LibVLC? _libVlc;
    private MediaPlayer? _mediaPlayer;
    private Media? _media;
    private bool _playbackStarted;
    private bool _commandReaderStarted;
    private bool _isFullscreen;
    private int _insetLeft;
    private int _insetRight;
    private int _insetTop;
    private int _insetBottom;
    private long _mediaLengthMs;
    private Rectangle _restoreBounds;
    private FormWindowState _restoreWindowState;
    private long _lastStatusTimeMs = -1;
    private long _lastStatusLengthMs = -1;
    private bool? _lastStatusPlaying;
    private int _lastStatusVolume = -1;
    private readonly List<SubtitleOption> _subtitleOptions = new();
    private string _activeSubtitleKey = string.Empty;
    private string _videoPath = string.Empty;
    private List<string> _externalSubtitleFiles = new();
    private bool _embedApplied;
    private Rectangle _lastEmbeddedBounds = Rectangle.Empty;
    private Size _lastEmbeddedParentClient = Size.Empty;

    public PlayerForm(LaunchOptions options)
    {
        _options = options;
        _embeddedMode = options.ParentHwnd > 0;
        _isFullscreen = !_embeddedMode && options.Fullscreen;
        _insetLeft = options.InsetLeft;
        _insetRight = options.InsetRight;
        _insetTop = options.InsetTop;
        _insetBottom = options.InsetBottom;
        Text = _embeddedMode ? string.Empty : $"CineSoft - {_options.Title}";
        StartPosition = _embeddedMode ? FormStartPosition.Manual : FormStartPosition.CenterScreen;
        Size = new Size(1280, 720);
        MinimumSize = new Size(640, 360);
        BackColor = Color.Black;
        ShowInTaskbar = !_embeddedMode;
        ControlBox = !_embeddedMode;
        MinimizeBox = !_embeddedMode;
        MaximizeBox = !_embeddedMode;
        TopMost = false;
        KeyPreview = true;
        FormBorderStyle = FormBorderStyle.None;

        _titleBar = new Panel
        {
            Dock = DockStyle.Top,
            Height = TitleBarHeight,
            BackColor = Color.FromArgb(18, 22, 28),
            Padding = new Padding(12, 0, 8, 0),
        };
        _titleLabel = new Label
        {
            Dock = DockStyle.Fill,
            Text = $"CineSoft - {_options.Title}",
            ForeColor = Color.White,
            TextAlign = ContentAlignment.MiddleLeft,
            Font = new Font("Segoe UI Semibold", 10f, FontStyle.Regular),
        };
        var brandLabel = new Label
        {
            Dock = DockStyle.Left,
            Width = 92,
            Text = "CINESOFT",
            ForeColor = Color.FromArgb(18, 240, 197),
            TextAlign = ContentAlignment.MiddleLeft,
            Font = new Font("Segoe UI", 11f, FontStyle.Bold),
        };
        _closeButton = CreateChromeButton("X");
        _minimizeButton = CreateChromeButton("_");
        _fullscreenButton = CreateChromeButton("[]");
        _closeButton.Click += (_, _) => Close();
        _minimizeButton.Click += (_, _) => WindowState = FormWindowState.Minimized;
        _fullscreenButton.Click += (_, _) => ToggleFullscreen();
        _titleBar.Controls.Add(_titleLabel);
        _titleBar.Controls.Add(_closeButton);
        _titleBar.Controls.Add(_fullscreenButton);
        _titleBar.Controls.Add(_minimizeButton);
        _titleBar.Controls.Add(brandLabel);

        _videoView = new VideoView
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Black,
        };

        Controls.Add(_videoView);
        if (_embeddedMode)
        {
            _titleBar.Visible = false;
            _titleBar.Hide();
        }
        else
        {
            Controls.Add(_titleBar);
        }

        _uiTimer = new System.Windows.Forms.Timer { Interval = 500 };
        _uiTimer.Tick += (_, _) => PublishPlaybackState();
        _embedBoundsTimer = new System.Windows.Forms.Timer { Interval = 250 };
        _embedBoundsTimer.Tick += (_, _) => UpdateEmbeddedBounds();

        _titleBar.MouseDown += TitleBarMouseDown;
        _titleLabel.MouseDown += TitleBarMouseDown;
        Shown += OnPlayerShown;
        FormClosing += OnPlayerClosing;
        KeyDown += OnPlayerKeyDown;
        Load += (_, _) => _videoView.CreateControl();
        Resize += (_, _) =>
        {
            if (!_embeddedMode)
            {
                PublishPlaybackState();
            }
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Program.Log("VlcHost:FormCreated", $"handle=0x{Handle.ToInt64():X}; visible={Visible}", _options, force: true);
    }

    private void OnPlayerShown(object? sender, EventArgs e)
    {
        Program.Log("VlcHost:Shown", $"handle=0x{Handle.ToInt64():X}; visible={Visible}; windowState={WindowState}", _options, force: true);
        if (_embeddedMode)
        {
            AttachToParentWindow();
        }
        else
        {
            ApplyFullscreenState(_isFullscreen, initial: true);
            TopMost = true;
            BringToFront();
            Activate();
            var restoreTopMostTimer = new System.Windows.Forms.Timer { Interval = 1500 };
            restoreTopMostTimer.Tick += (_, _) =>
            {
                restoreTopMostTimer.Stop();
                restoreTopMostTimer.Dispose();
                TopMost = false;
            };
            restoreTopMostTimer.Start();
        }

        StartPlaybackIfNeeded();
        StartCommandReaderIfNeeded();
        _uiTimer.Start();
        PublishPlaybackState();
    }

    private void AttachToParentWindow()
    {
        var parent = new IntPtr(_options.ParentHwnd);
        if (parent == IntPtr.Zero)
        {
            return;
        }

        if (_embedApplied)
        {
            UpdateEmbeddedBounds();
            if (!_embedBoundsTimer.Enabled)
            {
                _embedBoundsTimer.Start();
            }

            return;
        }

        Program.Log(
            "VlcHost:EmbedRequested",
            $"handle=0x{Handle.ToInt64():X}; parent=0x{parent.ToInt64():X}; insets={_insetLeft},{_insetTop},{_insetRight},{_insetBottom}",
            _options,
            force: true);

        Text = string.Empty;
        ControlBox = false;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.None;
        _titleBar.Hide();
        var previousParent = SetParent(Handle, parent);
        ApplyEmbeddedChildStyle(Handle);
        _embedApplied = true;
        Program.Log(
            "VlcHost:EmbedApplied",
            $"handle=0x{Handle.ToInt64():X}; parent=0x{parent.ToInt64():X}; previousParent=0x{previousParent.ToInt64():X}; lastError={Marshal.GetLastWin32Error()}",
            _options,
            force: true);
        UpdateEmbeddedBounds();
        _embedBoundsTimer.Start();
    }

    private void UpdateEmbeddedBounds()
    {
        if (!_embeddedMode)
        {
            return;
        }

        var parent = new IntPtr(_options.ParentHwnd);
        if (parent == IntPtr.Zero || !GetClientRect(parent, out var rect))
        {
            return;
        }

        var parentWidth = Math.Max(1, rect.Right - rect.Left);
        var parentHeight = Math.Max(1, rect.Bottom - rect.Top);
        var width = Math.Max(1, parentWidth - _insetLeft - _insetRight);
        var height = Math.Max(1, parentHeight - _insetTop - _insetBottom);
        var nextBounds = new Rectangle(_insetLeft, _insetTop, width, height);
        var nextParentClient = new Size(parentWidth, parentHeight);
        SetWindowPos(Handle, HwndTop, _insetLeft, _insetTop, width, height, SwpNoActivate | SwpShowWindow);
        if (nextBounds != _lastEmbeddedBounds || nextParentClient != _lastEmbeddedParentClient)
        {
            _lastEmbeddedBounds = nextBounds;
            _lastEmbeddedParentClient = nextParentClient;
            Program.Log(
                "VlcHost:BoundsApplied",
                $"parentClient={parentWidth}x{parentHeight}; bounds={_insetLeft},{_insetTop},{width},{height}; insets={_insetLeft},{_insetTop},{_insetRight},{_insetBottom}",
                _options,
                force: true);
        }
    }

    private void ApplyEmbeddedChildStyle(IntPtr handle)
    {
        var style = GetWindowLong(handle, GwlStyle);
        Program.Log("VlcHost:StyleBefore", $"style=0x{style:X8}", _options, force: true);
        style &= ~WsPopup;
        style &= ~WsCaption;
        style &= ~WsThickFrame;
        style &= ~WsBorder;
        style &= ~WsDlgFrame;
        style |= WsChild | WsVisible;
        SetWindowLong(handle, GwlStyle, style);
        SetWindowPos(handle, IntPtr.Zero, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoZOrder | SwpNoActivate | SwpFrameChanged | SwpShowWindow);
        var afterStyle = GetWindowLong(handle, GwlStyle);
        Program.Log("VlcHost:StyleAfter", $"style=0x{afterStyle:X8}; lastError={Marshal.GetLastWin32Error()}", _options, force: true);
    }

    private void StartPlaybackIfNeeded()
    {
        if (_playbackStarted)
        {
            return;
        }

        _playbackStarted = true;
        var vlcArgs = new List<string>();
        if (_options.Quiet) vlcArgs.Add("--quiet");
        if (_options.Verbose) vlcArgs.Add("--verbose=2");

        _libVlc = vlcArgs.Count > 0 ? new LibVLC(vlcArgs.ToArray()) : new LibVLC();
        _mediaPlayer = new MediaPlayer(_libVlc)
        {
            EnableHardwareDecoding = false,
            Volume = 80,
        };

        _mediaPlayer.Playing += (_, _) => OnMediaEvent(() =>
        {
            PublishPlaybackState(force: true);
            Program.Log("VlcHost:Playing", Program.MaskSensitiveUrl(_options.Url), _options, force: true);
        });
        _mediaPlayer.Paused += (_, _) => OnMediaEvent(() =>
        {
            PublishPlaybackState(force: true);
            Program.Log("VlcHost:Playback", "Paused", _options, force: true);
        });
        _mediaPlayer.Stopped += (_, _) => OnMediaEvent(() =>
        {
            PublishPlaybackState(force: true);
            Program.Log("VlcHost:Playback", "Stopped", _options, force: true);
        });
        _mediaPlayer.EndReached += (_, _) => OnMediaEvent(() =>
        {
            PublishPlaybackState(force: true);
            Program.Log("VlcHost:Playback", "Playback ended", _options, force: true);
        });
        _mediaPlayer.EncounteredError += (_, _) => Console.Error.WriteLine($"[VlcHost:Error] Encountered playback error for {Program.MaskSensitiveUrl(_options.Url)}");
        _mediaPlayer.TimeChanged += (_, _) => OnMediaEvent(() => PublishPlaybackState());
        _mediaPlayer.LengthChanged += (_, e) => OnMediaEvent(() =>
        {
            _mediaLengthMs = Math.Max(0, e.Length);
            PublishPlaybackState(force: true);
        });
        _mediaPlayer.PositionChanged += (_, _) => OnMediaEvent(() => PublishPlaybackState());
        _mediaPlayer.VolumeChanged += (_, e) => OnMediaEvent(() =>
        {
            _lastStatusVolume = (int)Math.Round(e.Volume);
            PublishPlaybackState(force: true);
        });
        _mediaPlayer.ESAdded += (_, _) => OnMediaEvent(() => PublishSubtitleState(force: true));
        _mediaPlayer.ESDeleted += (_, _) => OnMediaEvent(() => PublishSubtitleState(force: true));
        _mediaPlayer.ESSelected += (_, _) => OnMediaEvent(() => PublishSubtitleState(force: true));

        _videoView.CreateControl();
        _videoView.MediaPlayer = _mediaPlayer;
        Program.Log("VlcHost:VideoViewHandle", $"handle=0x{_videoView.Handle.ToInt64():X}; visible={_videoView.Visible}", _options, force: true);

        _media = new Media(_libVlc, new Uri(_options.Url));
        AttachLocalSubtitleFiles(_media);
        _media.AddOption($":network-caching={_options.NetworkCachingMs}");
        _media.AddOption(":clock-jitter=0");
        _media.AddOption(":clock-synchro=0");
        _media.AddOption(":avcodec-hw=none");

        var started = _mediaPlayer.Play(_media);
        if (!started)
        {
            throw new InvalidOperationException("LibVLC failed to start playback");
        }

        var subtitleRefreshTimer = new System.Windows.Forms.Timer { Interval = 1200 };
        subtitleRefreshTimer.Tick += (_, _) =>
        {
            subtitleRefreshTimer.Stop();
            subtitleRefreshTimer.Dispose();
            PublishSubtitleState(force: true);
        };
        subtitleRefreshTimer.Start();
    }

    private void PublishPlaybackState(bool force = false)
    {
        if (_mediaPlayer is null)
        {
            return;
        }

        var currentTime = Math.Max(0, _mediaPlayer.Time);
        var length = _mediaLengthMs > 0 ? _mediaLengthMs : Math.Max(0, _mediaPlayer.Length);
        var isPlaying = _mediaPlayer.IsPlaying;
        var volume = Math.Clamp(_mediaPlayer.Volume, 0, 100);

        if (!force
            && currentTime == _lastStatusTimeMs
            && length == _lastStatusLengthMs
            && _lastStatusPlaying == isPlaying
            && _lastStatusVolume == volume)
        {
            return;
        }

        _lastStatusTimeMs = currentTime;
        _lastStatusLengthMs = length;
        _lastStatusPlaying = isPlaying;
        _lastStatusVolume = volume;

        Console.WriteLine($"[VlcHost:State] time={currentTime}; length={length}; playing={(isPlaying ? 1 : 0)}; volume={volume}");
    }

    private void PublishSubtitleState(bool force = false)
    {
        if (_mediaPlayer is null)
        {
            return;
        }

        var nextOptions = new List<SubtitleOption>();
        nextOptions.Add(new SubtitleOption("spu:-1", -1, "Off", "builtin"));

        try
        {
            foreach (var externalPath in _externalSubtitleFiles)
            {
                nextOptions.Add(new SubtitleOption(
                    $"file:{externalPath}",
                    null,
                    BuildSubtitleLabel(_videoPath, externalPath),
                    "external",
                    externalPath));
            }

            var descriptions = _mediaPlayer.SpuDescription;
            if (descriptions is not null)
            {
                foreach (var description in descriptions)
                {
                    var id = description.Id;
                    var key = $"spu:{id}";
                    if (nextOptions.Any(item => string.Equals(item.Key, key, StringComparison.Ordinal)))
                    {
                        continue;
                    }
                    var name = string.IsNullOrWhiteSpace(description.Name) ? $"Subtitle {id}" : description.Name.Trim();
                    nextOptions.Add(new SubtitleOption(key, id, NormalizeTrackLabel(name, id), id >= 0 ? "embedded" : "builtin"));
                }
            }
        }
        catch
        {
        }

        var activeId = _mediaPlayer.Spu;
        var activeKey = $"spu:{activeId}";
        var changed = force || !string.Equals(activeKey, _activeSubtitleKey, StringComparison.Ordinal) || nextOptions.Count != _subtitleOptions.Count;
        if (!changed)
        {
            for (var i = 0; i < nextOptions.Count; i += 1)
            {
                var left = nextOptions[i];
                var right = _subtitleOptions[i];
                if (!string.Equals(left.Key, right.Key, StringComparison.Ordinal)
                    || left.SpuId != right.SpuId
                    || !string.Equals(left.Label, right.Label, StringComparison.Ordinal)
                    || !string.Equals(left.Source, right.Source, StringComparison.Ordinal))
                {
                    changed = true;
                    break;
                }
            }
        }

        if (!changed)
        {
            return;
        }

        _subtitleOptions.Clear();
        _subtitleOptions.AddRange(nextOptions);
        _activeSubtitleKey = activeKey;

        var payload = JsonSerializer.Serialize(new
        {
            activeKey,
            activeId,
            tracks = _subtitleOptions.Select(track => new
            {
                key = track.Key,
                id = track.SpuId,
                label = track.Label,
                source = track.Source,
            }),
        });
        Console.WriteLine($"[VlcHost:Subtitles] {payload}");
    }

    private static string NormalizeTrackLabel(string rawName, int id)
    {
        var label = string.IsNullOrWhiteSpace(rawName) ? $"Subtitle {id}" : rawName.Trim();
        if (id < 0 || string.Equals(label, "Disable", StringComparison.OrdinalIgnoreCase))
        {
            return "Off";
        }

        return label;
    }

    private static string BuildSubtitleLabel(string videoPath, string subtitlePath)
    {
        var subtitleName = Path.GetFileNameWithoutExtension(subtitlePath) ?? "Subtitle";
        var videoBaseName = Path.GetFileNameWithoutExtension(videoPath) ?? string.Empty;

        if (string.Equals(subtitleName, videoBaseName, StringComparison.OrdinalIgnoreCase))
        {
            subtitleName = "Default";
        }
        else if (subtitleName.StartsWith(videoBaseName, StringComparison.OrdinalIgnoreCase))
        {
            subtitleName = subtitleName.Substring(videoBaseName.Length).Trim(' ', '.', '-', '_', '[', ']', '(', ')');
            if (string.IsNullOrWhiteSpace(subtitleName))
            {
                subtitleName = "Default";
            }
        }

        var resolvedLanguage = ResolveSubtitleLanguageLabel(subtitleName);
        if (!string.IsNullOrWhiteSpace(resolvedLanguage))
        {
            return resolvedLanguage;
        }

        return subtitleName;
    }

    private static string? ResolveSubtitleLanguageLabel(string subtitleName)
    {
        if (string.IsNullOrWhiteSpace(subtitleName) || string.Equals(subtitleName, "Default", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var compactName = subtitleName.Trim();
        var parts = Regex.Split(compactName, @"[\s._\-\[\]\(\)]+")
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part.Trim().ToLowerInvariant())
            .ToArray();

        if (parts.Length == 0)
        {
            return null;
        }

        var languageMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["ara"] = "Arabic",
            ["arabic"] = "Arabic",
            ["eng"] = "English",
            ["english"] = "English",
            ["fre"] = "French",
            ["fra"] = "French",
            ["french"] = "French",
            ["canadian"] = "Canadian",
            ["cze"] = "Czech",
            ["ces"] = "Czech",
            ["czech"] = "Czech",
            ["dut"] = "Dutch",
            ["nld"] = "Dutch",
            ["dutch"] = "Dutch",
            ["ger"] = "German",
            ["deu"] = "German",
            ["german"] = "German",
            ["gre"] = "Greek",
            ["ell"] = "Greek",
            ["greek"] = "Greek",
            ["ita"] = "Italian",
            ["italian"] = "Italian",
            ["jpn"] = "Japanese",
            ["japanese"] = "Japanese",
            ["kor"] = "Korean",
            ["korean"] = "Korean",
            ["per"] = "Persian",
            ["fas"] = "Persian",
            ["persian"] = "Persian",
            ["pol"] = "Polish",
            ["polish"] = "Polish",
            ["por"] = "Portuguese",
            ["portuguese"] = "Portuguese",
            ["brazilian"] = "Brazilian",
            ["brazil"] = "Brazilian",
            ["spa"] = "Spanish",
            ["spanish"] = "Spanish",
            ["european"] = "European",
            ["español"] = "Spanish",
            ["tur"] = "Turkish",
            ["turkish"] = "Turkish",
            ["trk"] = "Turkish",
            ["ukr"] = "Ukrainian",
            ["ukrainian"] = "Ukrainian",
            ["rus"] = "Russian",
            ["russian"] = "Russian",
            ["rum"] = "Romanian",
            ["ron"] = "Romanian",
            ["romanian"] = "Romanian",
        };

        var normalized = parts
            .Select(part => languageMap.TryGetValue(part, out var mapped) ? mapped : string.Empty)
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .ToArray();

        if (normalized.Length == 0)
        {
            return null;
        }

        if (normalized.Contains("Brazilian", StringComparer.OrdinalIgnoreCase) && normalized.Contains("Portuguese", StringComparer.OrdinalIgnoreCase))
        {
            return "Brazilian Portuguese";
        }

        if (normalized.Contains("Canadian", StringComparer.OrdinalIgnoreCase) && normalized.Contains("French", StringComparer.OrdinalIgnoreCase))
        {
            return "Canadian French";
        }

        if (normalized.Contains("European", StringComparer.OrdinalIgnoreCase) && normalized.Contains("Portuguese", StringComparer.OrdinalIgnoreCase))
        {
            return "European Portuguese";
        }

        if (normalized.Contains("European", StringComparer.OrdinalIgnoreCase) && normalized.Contains("Spanish", StringComparer.OrdinalIgnoreCase))
        {
            return "European Spanish";
        }

        if (normalized.Contains("European", StringComparer.OrdinalIgnoreCase) && normalized.Contains("French", StringComparer.OrdinalIgnoreCase))
        {
            return "European French";
        }

        return normalized.Last();
    }

    private void AttachLocalSubtitleFiles(Media media)
    {
        if (!Uri.TryCreate(_options.Url, UriKind.Absolute, out var mediaUri) || !mediaUri.IsFile)
        {
            return;
        }

        var videoPath = mediaUri.LocalPath;
        if (string.IsNullOrWhiteSpace(videoPath) || !File.Exists(videoPath))
        {
            return;
        }
        _videoPath = videoPath;
        _externalSubtitleFiles = DiscoverSubtitleFiles(videoPath).ToList();
    }

    private static IEnumerable<string> DiscoverSubtitleFiles(string videoPath)
    {
        var subtitleExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".srt", ".ass", ".ssa", ".sub", ".vtt" };
        var results = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var videoDirectory = Path.GetDirectoryName(videoPath) ?? string.Empty;
        var videoBaseName = Path.GetFileNameWithoutExtension(videoPath);
        if (string.IsNullOrWhiteSpace(videoDirectory) || string.IsNullOrWhiteSpace(videoBaseName))
        {
            return results;
        }

        void CollectFromDirectory(string directoryPath)
        {
            if (string.IsNullOrWhiteSpace(directoryPath) || !Directory.Exists(directoryPath))
            {
                return;
            }

            foreach (var filePath in Directory.EnumerateFiles(directoryPath))
            {
                var extension = Path.GetExtension(filePath);
                if (!subtitleExtensions.Contains(extension))
                {
                    continue;
                }

                if (seen.Add(filePath))
                {
                    results.Add(filePath);
                }
            }
        }

        CollectFromDirectory(videoDirectory);
        CollectFromDirectory(Path.Combine(videoDirectory, "subs"));
        CollectFromDirectory(Path.Combine(videoDirectory, "sub"));
        CollectFromDirectory(Path.Combine(videoDirectory, "subtitles"));

        return results;
    }

    private void OnMediaEvent(Action action)
    {
        if (IsDisposed)
        {
            return;
        }

        try
        {
            BeginInvoke(action);
        }
        catch
        {
        }
    }

    private void StartCommandReaderIfNeeded()
    {
        if (_commandReaderStarted)
        {
            return;
        }

        _commandReaderStarted = true;
        _ = Task.Run(async () =>
        {
            while (!IsDisposed)
            {
                string? line;
                try
                {
                    line = await Console.In.ReadLineAsync();
                }
                catch
                {
                    break;
                }

                if (line is null)
                {
                    break;
                }

                var command = line.Trim();
                if (command.Length == 0)
                {
                    continue;
                }

                OnMediaEvent(() => HandlePlayerCommand(command));
            }
        });
    }

    private void HandlePlayerCommand(string commandLine)
    {
        var parts = commandLine.Split(' ', 2, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
        {
            return;
        }

        var command = parts[0].ToLowerInvariant();
        var value = parts.Length > 1 ? parts[1] : string.Empty;

        switch (command)
        {
            case "toggle-play":
            case "play-pause":
                TogglePlayPause();
                break;
            case "play":
                _mediaPlayer?.Play();
                PublishPlaybackState(force: true);
                break;
            case "pause":
                _mediaPlayer?.Pause();
                PublishPlaybackState(force: true);
                break;
            case "seek-percent":
            case "seek":
                if (_mediaPlayer is not null && float.TryParse(value, out var position))
                {
                    _mediaPlayer.Position = Math.Clamp(position / 1000f, 0f, 1f);
                    PublishPlaybackState(force: true);
                }
                break;
            case "volume":
            case "set-volume":
                if (_mediaPlayer is not null && int.TryParse(value, out var volume))
                {
                    _mediaPlayer.Volume = Math.Clamp(volume, 0, 100);
                    PublishPlaybackState(force: true);
                }
                break;
            case "fullscreen":
                ToggleFullscreen();
                break;
            case "set-insets":
                ApplyInsetCommand(value);
                break;
            case "set-subtitle":
                if (_mediaPlayer is null)
                {
                    break;
                }
                if (value.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
                {
                    var subtitlePath = value.Substring("file:".Length);
                    if (!string.IsNullOrWhiteSpace(subtitlePath) && File.Exists(subtitlePath))
                    {
                        _mediaPlayer.AddSlave(MediaSlaveType.Subtitle, new Uri(subtitlePath).AbsoluteUri, true);
                        var subtitleRefreshTimer = new System.Windows.Forms.Timer { Interval = 400 };
                        subtitleRefreshTimer.Tick += (_, _) =>
                        {
                            subtitleRefreshTimer.Stop();
                            subtitleRefreshTimer.Dispose();
                            PublishSubtitleState(force: true);
                        };
                        subtitleRefreshTimer.Start();
                    }
                }
                else if (value.StartsWith("spu:", StringComparison.OrdinalIgnoreCase) && int.TryParse(value.Substring("spu:".Length), out var subtitleId))
                {
                    _mediaPlayer.SetSpu(subtitleId);
                    PublishSubtitleState(force: true);
                }
                break;
            case "stop":
                Close();
                break;
        }
    }

    private void ApplyInsetCommand(string value)
    {
        var parts = (value ?? string.Empty)
            .Split(new[] { ' ', ',', ';' }, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 4)
        {
            return;
        }

        if (!int.TryParse(parts[0], out var left)
            || !int.TryParse(parts[1], out var top)
            || !int.TryParse(parts[2], out var right)
            || !int.TryParse(parts[3], out var bottom))
        {
            return;
        }

        _insetLeft = Math.Max(0, left);
        _insetTop = Math.Max(0, top);
        _insetRight = Math.Max(0, right);
        _insetBottom = Math.Max(0, bottom);
        UpdateEmbeddedBounds();
    }

    private void TogglePlayPause()
    {
        if (_mediaPlayer is null)
        {
            return;
        }

        if (_mediaPlayer.IsPlaying)
        {
            _mediaPlayer.Pause();
        }
        else
        {
            _mediaPlayer.Play();
        }

        PublishPlaybackState(force: true);
    }

    private void ToggleFullscreen()
    {
        if (_embeddedMode)
        {
            return;
        }

        ApplyFullscreenState(!_isFullscreen, initial: false);
    }

    private void ApplyFullscreenState(bool fullscreen, bool initial)
    {
        if (fullscreen == _isFullscreen && !initial)
        {
            return;
        }

        if (_embeddedMode)
        {
            _isFullscreen = fullscreen;
            return;
        }

        if (fullscreen)
        {
            _restoreBounds = Bounds;
            _restoreWindowState = WindowState;
            _isFullscreen = true;
            WindowState = FormWindowState.Normal;
            Bounds = Screen.FromControl(this).Bounds;
        }
        else
        {
            _isFullscreen = false;
            Bounds = _restoreBounds.Width > 0 ? _restoreBounds : Bounds;
            WindowState = _restoreWindowState == FormWindowState.Minimized ? FormWindowState.Normal : _restoreWindowState;
        }

        _fullscreenButton.Text = _isFullscreen ? "Exit" : "[]";
    }

    private void TitleBarMouseDown(object? sender, MouseEventArgs e)
    {
        if (_embeddedMode || e.Button != MouseButtons.Left || _isFullscreen)
        {
            return;
        }

        ReleaseCapture();
        SendMessage(Handle, WmNclbuttondown, (IntPtr)HtCaption, IntPtr.Zero);
    }

    private void OnPlayerKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Escape && _isFullscreen)
        {
            ToggleFullscreen();
            e.Handled = true;
        }
        else if (e.KeyCode == Keys.Space)
        {
            TogglePlayPause();
            e.Handled = true;
        }
    }

    private void OnPlayerClosing(object? sender, FormClosingEventArgs e)
    {
        Program.Log("VlcHost:Closing", $"handle=0x{Handle.ToInt64():X}; visible={Visible}; reason={e.CloseReason}", _options, force: true);
        _uiTimer.Stop();
        _embedBoundsTimer.Stop();
        try
        {
            _mediaPlayer?.Stop();
        }
        catch
        {
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _videoView.MediaPlayer = null;
        _mediaPlayer?.Dispose();
        _media?.Dispose();
        _libVlc?.Dispose();
        _mediaPlayer = null;
        _media = null;
        _libVlc = null;
        base.OnFormClosed(e);
    }

    private static Button CreateChromeButton(string text) => new()
    {
        Dock = DockStyle.Right,
        Width = 44,
        FlatStyle = FlatStyle.Flat,
        Text = text,
        ForeColor = Color.WhiteSmoke,
        BackColor = Color.FromArgb(24, 28, 34),
        Margin = new Padding(6, 8, 0, 8),
        Font = new Font("Segoe UI", 9f, FontStyle.Bold),
    };
}
