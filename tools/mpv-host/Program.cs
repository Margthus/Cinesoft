using System.Globalization;

namespace Cinesoft.MpvHost;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var options = HostOptions.Parse(args);
        if (!options.IsValid(out var validationError))
        {
            Console.Error.WriteLine(validationError);
            Environment.ExitCode = 1;
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm(options));
    }
}

internal sealed class HostOptions
{
    public string Source { get; private set; } = string.Empty;
    public string MpvPath { get; private set; } = string.Empty;
    public string Title { get; private set; } = "CineSoft MPV Host";
    public bool StartPaused { get; private set; }
    public bool Borderless { get; private set; }
    public bool NoTaskbar { get; private set; }
    public bool KeepOpenOnExit { get; private set; }
    public string SourceType { get; private set; } = "embedded-file";
    public long? ParentHwnd { get; private set; }
    public int? X { get; private set; }
    public int? Y { get; private set; }
    public int Width { get; private set; } = 1100;
    public int Height { get; private set; } = 700;

    public static HostOptions Parse(string[] args)
    {
        var options = new HostOptions();

        for (var i = 0; i < args.Length; i++)
        {
            var key = args[i]?.Trim() ?? string.Empty;
            string NextValueOrEmpty()
            {
                if (i + 1 >= args.Length) return string.Empty;
                i += 1;
                return args[i] ?? string.Empty;
            }

            switch (key)
            {
                case "--url":
                    options.Source = NextValueOrEmpty().Trim();
                    break;
                case "--mpv-path":
                    options.MpvPath = NextValueOrEmpty().Trim();
                    break;
                case "--title":
                    options.Title = NextValueOrEmpty().Trim();
                    break;
                case "--start-paused":
                    options.StartPaused = true;
                    break;
                case "--borderless":
                    options.Borderless = true;
                    break;
                case "--no-taskbar":
                    options.NoTaskbar = true;
                    break;
                case "--keep-open-on-exit":
                    options.KeepOpenOnExit = true;
                    break;
                case "--source-type":
                {
                    var sourceType = NextValueOrEmpty().Trim().ToLowerInvariant();
                    options.SourceType = sourceType is "embedded-stream-url" or "embedded-file"
                        ? sourceType
                        : "embedded-file";
                    break;
                }
                case "--x":
                    if (int.TryParse(NextValueOrEmpty(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var x))
                    {
                        options.X = Math.Max(0, x);
                    }
                    break;
                case "--parent-hwnd":
                    if (long.TryParse(NextValueOrEmpty(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parentHwnd))
                    {
                        options.ParentHwnd = parentHwnd > 0 ? parentHwnd : null;
                    }
                    break;
                case "--y":
                    if (int.TryParse(NextValueOrEmpty(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var y))
                    {
                        options.Y = Math.Max(0, y);
                    }
                    break;
                case "--width":
                    if (int.TryParse(NextValueOrEmpty(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var w))
                    {
                        options.Width = Math.Max(320, w);
                    }
                    break;
                case "--height":
                    if (int.TryParse(NextValueOrEmpty(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var h))
                    {
                        options.Height = Math.Max(240, h);
                    }
                    break;
            }
        }

        return options;
    }

    public bool IsValid(out string error)
    {
        if (string.IsNullOrWhiteSpace(Source))
        {
            error = "Missing required argument: --url <fileOrUrl>";
            return false;
        }

        if (string.IsNullOrWhiteSpace(MpvPath))
        {
            error = "Missing required argument: --mpv-path <path>";
            return false;
        }

        if (!File.Exists(MpvPath))
        {
            error = $"mpv executable not found: {MpvPath}";
            return false;
        }

        error = string.Empty;
        return true;
    }
}
