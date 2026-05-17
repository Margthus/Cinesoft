using LibVLCSharp.Shared;
using LibVLCSharp.WinForms;

namespace Cinesoft.VlcHost;

internal sealed record LaunchOptions(
    string Url,
    string Title,
    bool Fullscreen,
    int NetworkCachingMs,
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
            Console.Error.WriteLine($"[VlcHost:Error] {ex.Message}");
            return 1;
        }
    }

    private static LaunchOptions ParseArgs(string[] args)
    {
        string url = string.Empty;
        string title = "CineSoft Stream";
        var fullscreen = false;
        var quiet = false;
        var verbose = false;
        var networkCachingMs = 1000;

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
                case "--network-caching-ms":
                    networkCachingMs = Math.Max(0, int.TryParse(ReadNextValue(args, ref i, "--network-caching-ms"), out var parsed) ? parsed : 1000);
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

        return new LaunchOptions(url, string.IsNullOrWhiteSpace(title) ? "CineSoft Stream" : title.Trim(), fullscreen, networkCachingMs, quiet, verbose);
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
    private readonly LaunchOptions _options;
    private readonly VideoView _videoView;
    private LibVLC? _libVlc;
    private MediaPlayer? _mediaPlayer;
    private Media? _media;
    private bool _playbackStarted;

    public PlayerForm(LaunchOptions options)
    {
        _options = options;
        Text = $"CineSoft - {_options.Title}";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1280, 720);
        MinimumSize = new Size(640, 360);
        BackColor = Color.Black;
        ShowInTaskbar = true;
        TopMost = false;
        WindowState = _options.Fullscreen ? FormWindowState.Maximized : FormWindowState.Normal;

        _videoView = new VideoView
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Black,
        };

        Controls.Add(_videoView);
        Shown += OnPlayerShown;
        FormClosing += OnPlayerClosing;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Program.Log(
            "VlcHost:FormCreated",
            $"handle=0x{Handle.ToInt64():X}; visible={Visible}",
            _options,
            force: true);
    }

    private void OnPlayerShown(object? sender, EventArgs e)
    {
        Program.Log(
            "VlcHost:Shown",
            $"handle=0x{Handle.ToInt64():X}; visible={Visible}; windowState={WindowState}",
            _options,
            force: true);
        TopMost = true;
        BringToFront();
        Activate();
        BeginInvoke(new Action(async () =>
        {
            await Task.Delay(1500);
            TopMost = false;
        }));
        StartPlaybackIfNeeded();
    }

    private void StartPlaybackIfNeeded()
    {
        if (_playbackStarted)
        {
            return;
        }

        _playbackStarted = true;
        var vlcArgs = new List<string>();
        if (_options.Quiet)
        {
            vlcArgs.Add("--quiet");
        }

        if (_options.Verbose)
        {
            vlcArgs.Add("--verbose=2");
        }

        _libVlc = vlcArgs.Count > 0 ? new LibVLC(vlcArgs.ToArray()) : new LibVLC();
        _mediaPlayer = new MediaPlayer(_libVlc);
        _mediaPlayer.Playing += (_, _) => Program.Log("VlcHost:Playing", Program.MaskSensitiveUrl(_options.Url), _options, force: true);
        _mediaPlayer.EncounteredError += (_, _) => Console.Error.WriteLine($"[VlcHost:Error] Encountered playback error for {Program.MaskSensitiveUrl(_options.Url)}");
        _mediaPlayer.EndReached += (_, _) => Program.Log("VlcHost:Playback", "Playback ended", _options, force: true);
        _videoView.MediaPlayer = _mediaPlayer;
        Program.Log(
            "VlcHost:VideoViewHandle",
            $"handle=0x{_videoView.Handle.ToInt64():X}; visible={_videoView.Visible}",
            _options,
            force: true);

        _media = new Media(_libVlc, new Uri(_options.Url));
        _media.AddOption($":network-caching={_options.NetworkCachingMs}");
        _media.AddOption(":clock-jitter=0");
        _media.AddOption(":clock-synchro=0");

        var started = _mediaPlayer.Play(_media);
        if (!started)
        {
            throw new InvalidOperationException("LibVLC failed to start playback");
        }
    }

    private void OnPlayerClosing(object? sender, FormClosingEventArgs e)
    {
        Program.Log(
            "VlcHost:Closing",
            $"handle=0x{Handle.ToInt64():X}; visible={Visible}",
            _options,
            force: true);
        try
        {
            _mediaPlayer?.Stop();
        }
        catch {}
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
}
