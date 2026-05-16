#!/usr/bin/env python3
"""
CineSoft Torrent Service — libtorrent-rasterbar based torrent engine.
Runs as a child process of Electron, communicates via HTTP JSON API.
"""

import sys
import os
import json
import time
import threading
import hashlib
import re
import socketserver
import warnings
import shutil
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import libtorrent as lt

warnings.filterwarnings("ignore", category=DeprecationWarning)

# ─── Global State ───

session = None
torrents = {}       # info_hash_hex -> { handle, mode, title, media_info, added_at }
download_dir = ""
server_port = 0
download_rate_limit = 0
alert_pump_stop = threading.Event()
DEFAULT_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.moeking.me:6969/announce",
    "udp://explodie.org:6969/announce",
]
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".m4v", ".webm", ".ts"}

class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def log_warning(message, **context):
    payload = {"level": "warning", "message": message, **context}
    print(json.dumps(payload), file=sys.stderr, flush=True)


def normalize_info_hash(value):
    return str(value).replace(" ", "").lower()


def extract_magnet_url(text):
    if not text:
        return None
    match = re.search(r"(magnet:\?[^\s'\"<>]+)", str(text), flags=re.IGNORECASE)
    return match.group(1) if match else None


def safe_handle_id(handle):
    try:
        return normalize_info_hash(handle.info_hash())
    except Exception:
        return "unknown"


def delete_torrent_content(entry):
    handle = entry.get("handle")
    if not is_handle_valid(handle):
        return
    try:
        ti = handle.torrent_file()
        save_path = handle.status().save_path
    except RuntimeError as exc:
        log_warning("delete_content_context_failed", error=str(exc))
        return
    if not ti:
        return

    files = ti.files()
    targets = set()
    for i in range(files.num_files()):
        rel_path = files.file_path(i)
        parts = rel_path.replace("\\", "/").split("/")
        root = parts[0] if len(parts) > 1 else rel_path
        abs_target = os.path.abspath(os.path.join(save_path, root))
        try:
            common = os.path.commonpath([os.path.abspath(download_dir), abs_target])
        except ValueError:
            continue
        if common == os.path.abspath(download_dir):
            targets.add(abs_target)

    def remove_targets():
        for attempt in range(12):
            time.sleep(0.75)
            remaining = []
            for target in targets:
                try:
                    if os.path.isdir(target):
                        shutil.rmtree(target, ignore_errors=False)
                    elif os.path.exists(target):
                        os.remove(target)
                except Exception as exc:
                    remaining.append(target)
                    if attempt == 11:
                        log_warning("delete_content_failed", target=target, error=str(exc))
            if not remaining:
                return
            targets.clear()
            targets.update(remaining)

    threading.Thread(target=remove_targets, daemon=True).start()


def cleanup_torrent_entry(info_hash_hex, remove_from_session=False, delete_files=False):
    entry = torrents.get(info_hash_hex)
    if not entry:
        return False

    handle = entry.get("handle")
    if delete_files:
        delete_torrent_content(entry)
    if remove_from_session and session and is_handle_valid(handle):
        try:
            if delete_files:
                session.remove_torrent(handle, lt.options_t.delete_files)
            else:
                session.remove_torrent(handle)
        except Exception as exc:
            log_warning(
                "remove_torrent_failed",
                torrent=info_hash_hex,
                deleteFiles=bool(delete_files),
                error=str(exc),
            )

    torrents.pop(info_hash_hex, None)
    return True


def prune_invalid_torrents():
    stale_ids = []
    for info_hash_hex, entry in list(torrents.items()):
        handle = entry.get("handle")
        if is_handle_valid(handle):
            continue
        stale_ids.append(info_hash_hex)

    for info_hash_hex in stale_ids:
        log_warning("prune_invalid_torrent", torrent=info_hash_hex)
        cleanup_torrent_entry(info_hash_hex, remove_from_session=False)

    return len(stale_ids)


def shutdown_session_cleanup():
    for info_hash_hex in list(torrents.keys()):
        cleanup_torrent_entry(info_hash_hex, remove_from_session=True, delete_files=False)

    if session:
        try:
            session.pause()
        except Exception as exc:
            log_warning("session_pause_failed", error=str(exc))


def alert_pump():
    while not alert_pump_stop.is_set():
        try:
            alert = session.wait_for_alert(1000) if session else None
        except Exception as exc:
            log_warning("wait_for_alert_failed", error=str(exc))
            time.sleep(0.25)
            continue

        if alert is None:
            continue

        try:
            alerts = session.pop_alerts() if session else []
        except Exception as exc:
            log_warning("pop_alerts_failed", error=str(exc))
            time.sleep(0.1)
            continue

        for item in alerts:
            try:
                category_name = item.what()
            except Exception as exc:
                log_warning("alert_processing_failed", error=str(exc))


def is_handle_valid(handle):
    try:
        return bool(handle and handle.is_valid())
    except Exception as exc:
        log_warning("handle_validation_failed", error=str(exc))
        return False


def init_session():
    global session
    settings = lt.default_settings()
    def safe_set(key, value):
        try:
            settings[key] = value
        except Exception as exc:
            log_warning("session_setting_failed", key=key, error=str(exc))
            pass
    safe_set('user_agent', "CineSoft/1.0 libtorrent/" + lt.version)
    safe_set('alert_mask', (
        lt.alert.category_t.status_notification |
        lt.alert.category_t.error_notification |
        lt.alert.category_t.storage_notification
    ))
    safe_set('strict_end_game_mode', False)
    safe_set('request_timeout', 5)
    safe_set('peer_timeout', 30)
    safe_set('connections_limit', 200)
    safe_set('enable_dht', True)
    safe_set('enable_lsd', True)
    safe_set('enable_upnp', True)
    safe_set('enable_natpmp', True)
    safe_set('announce_to_all_trackers', True)
    safe_set('announce_to_all_tiers', True)
    
    session = lt.session(settings)
    try:
        session.add_dht_router("router.bittorrent.com", 6881)
        session.add_dht_router("router.utorrent.com", 6881)
        session.add_dht_router("dht.transmissionbt.com", 6881)
        session.start_dht()
        session.start_lsd()
        session.start_upnp()
        session.start_natpmp()
    except Exception as exc:
        log_warning("session_network_bootstrap_failed", error=str(exc))
    threading.Thread(target=alert_pump, daemon=True).start()


def apply_download_rate_limit(limit_bps):
    global download_rate_limit
    safe_limit = max(0, int(limit_bps or 0))
    download_rate_limit = safe_limit
    if not session:
        return safe_limit
    try:
        session.set_download_rate_limit(safe_limit)
        return safe_limit
    except Exception as exc:
        log_warning("set_download_rate_limit_failed", method="direct", error=str(exc))
        pass
    try:
        settings = session.get_settings()
        settings['download_rate_limit'] = safe_limit
        session.apply_settings(settings)
    except Exception as exc:
        log_warning("set_download_rate_limit_failed", method="apply_settings", error=str(exc))
    return safe_limit


def apply_session_options(options=None):
    options = options or {}
    if not session:
        return {}

    def as_bool(name, default=True):
        value = options.get(name, default)
        return bool(value)

    applied = {
        "dhtEnabled": as_bool("dhtEnabled", True),
        "lsdEnabled": as_bool("lsdEnabled", True),
        "upnpEnabled": as_bool("upnpEnabled", True),
        "natPmpEnabled": as_bool("natPmpEnabled", True),
        "announceToAllTrackers": as_bool("announceToAllTrackers", True),
    }

    try:
        settings = session.get_settings()
        settings["enable_dht"] = applied["dhtEnabled"]
        settings["enable_lsd"] = applied["lsdEnabled"]
        settings["enable_upnp"] = applied["upnpEnabled"]
        settings["enable_natpmp"] = applied["natPmpEnabled"]
        settings["announce_to_all_trackers"] = applied["announceToAllTrackers"]
        settings["announce_to_all_tiers"] = applied["announceToAllTrackers"]
        session.apply_settings(settings)
    except Exception as exc:
        log_warning("apply_session_options_failed", method="settings", error=str(exc))

    try:
        if applied["dhtEnabled"]:
            session.start_dht()
        else:
            session.stop_dht()
    except Exception as exc:
        log_warning("apply_session_options_failed", method="dht", error=str(exc))

    try:
        if applied["lsdEnabled"]:
            session.start_lsd()
        else:
            session.stop_lsd()
    except Exception as exc:
        log_warning("apply_session_options_failed", method="lsd", error=str(exc))

    try:
        if applied["upnpEnabled"]:
            session.start_upnp()
        else:
            session.stop_upnp()
    except Exception as exc:
        log_warning("apply_session_options_failed", method="upnp", error=str(exc))

    try:
        if applied["natPmpEnabled"]:
            session.start_natpmp()
        else:
            session.stop_natpmp()
    except Exception as exc:
        log_warning("apply_session_options_failed", method="natpmp", error=str(exc))

    return applied


def ensure_trackers(atp):
    try:
        trackers = list(getattr(atp, "trackers", []) or [])
    except Exception as exc:
        log_warning("read_trackers_failed", error=str(exc))
        trackers = []
    if trackers:
        return atp
    for tr in DEFAULT_TRACKERS:
        try:
            atp.trackers.append(tr)
        except Exception as exc:
            log_warning("append_tracker_failed", tracker=tr, error=str(exc))
            pass
    return atp


def find_video_file(handle):
    """Find the best video file for browser playback."""
    if not is_handle_valid(handle):
        return None, None
    video_exts = ('.mp4', '.m4v', '.webm', '.mov', '.mkv', '.ts', '.avi', '.wmv', '.flv')
    ext_rank = {
        '.mp4': 0,
        '.m4v': 1,
        '.webm': 2,
        '.mov': 3,
        '.mkv': 4,
        '.ts': 5,
        '.avi': 6,
        '.wmv': 7,
        '.flv': 8,
    }
    try:
        ti = handle.torrent_file()
    except RuntimeError as exc:
        log_warning("find_video_torrent_file_failed", torrent=safe_handle_id(handle), error=str(exc))
        return None, None
    if not ti:
        return None, None
    files = ti.files()
    exclude_re = re.compile(r"(sample|trailer|extras?|featurette|behind[\s._-]?the[\s._-]?scenes|clip)")

    def choose(skip_extras):
        best_idx = -1
        best_size = -1
        best_rank = 999
        for i in range(files.num_files()):
            name = files.file_path(i)
            lower = name.lower()
            if skip_extras and exclude_re.search(lower):
                continue
            ext = next((e for e in video_exts if lower.endswith(e)), None)
            if not ext:
                continue
            size = files.file_size(i)
            rank = ext_rank.get(ext, 999)
            codec_penalty = 0
            if any(x in lower for x in ('x265', 'hevc', 'h.265', 'h265', '10bit', 'dolby vision', 'dv')):
                codec_penalty = 4
            if any(x in lower for x in ('x264', 'h264', 'avc')):
                codec_penalty = -1
            effective_rank = rank + codec_penalty
            if effective_rank < best_rank or (effective_rank == best_rank and size > best_size):
                best_rank = effective_rank
                best_size = size
                best_idx = i
        return best_idx

    selected_idx = choose(skip_extras=True)
    if selected_idx < 0:
        selected_idx = choose(skip_extras=False)
    if selected_idx >= 0:
        return selected_idx, files.file_path(selected_idx)
    return None, None


def list_video_files(handle):
    if not is_handle_valid(handle):
        return []
    video_exts = ('.mp4', '.m4v', '.webm', '.mov', '.mkv', '.ts', '.avi', '.wmv', '.flv')
    ext_rank = {'.mp4': 0, '.m4v': 1, '.webm': 2, '.mov': 3, '.mkv': 4, '.ts': 5, '.avi': 6, '.wmv': 7, '.flv': 8}
    try:
        ti = handle.torrent_file()
    except RuntimeError as exc:
        log_warning("list_video_torrent_file_failed", torrent=safe_handle_id(handle), error=str(exc))
        return []
    if not ti:
        return []
    files = ti.files()
    out = []
    for i in range(files.num_files()):
        rel_path = files.file_path(i)
        lower = rel_path.lower()
        ext = next((e for e in video_exts if lower.endswith(e)), None)
        if not ext:
            continue
        out.append({
            "index": i,
            "name": os.path.basename(rel_path),
            "path": rel_path,
            "size": files.file_size(i),
            "ext": ext,
            "rank": ext_rank.get(ext, 999),
            "nameLower": lower,
        })
    def score(item):
        penalty = 0
        n = item["nameLower"]
        if any(x in n for x in ('x265', 'hevc', 'h.265', 'h265', '10bit', 'dolby vision', 'dv')):
            penalty += 4
        if any(x in n for x in ('x264', 'h264', 'avc')):
            penalty -= 1
        return item["rank"] + penalty
    out.sort(key=lambda x: (score(x), -x["size"]))
    for item in out:
        item.pop("nameLower", None)
    return out


def build_status(info_hash_hex):
    entry = torrents.get(info_hash_hex)
    if not entry:
        return None
    h = entry["handle"]
    if not is_handle_valid(h):
        cleanup_torrent_entry(info_hash_hex, remove_from_session=False)
        return None
    try:
        s = h.status()
        ti = h.torrent_file()
    except RuntimeError as exc:
        log_warning("build_status_failed", torrent=info_hash_hex, error=str(exc))
        return None

    video_file_idx, video_file_path = find_video_file(h) if ti else (None, None)
    video_info = None
    selected_file_indexes = []
    selected_video_files = []
    if video_file_idx is not None and ti:
        files = ti.files()
        fp = h.file_progress()
        video_info = {
            "name": os.path.basename(files.file_path(video_file_idx)),
            "size": files.file_size(video_file_idx),
            "downloaded": fp[video_file_idx] if video_file_idx < len(fp) else 0,
            "progress": round((fp[video_file_idx] / files.file_size(video_file_idx)) * 100, 2) if video_file_idx < len(fp) and files.file_size(video_file_idx) > 0 else 0,
            "path": files.file_path(video_file_idx),
        }
        try:
            prios = h.get_file_priorities()
            selected_file_indexes = [idx for idx, value in enumerate(prios) if int(value) > 0]
        except Exception:
            selected_file_indexes = []
        for idx in selected_file_indexes:
            if idx >= files.num_files():
                continue
            rel_path = files.file_path(idx)
            ext = os.path.splitext(rel_path)[1].lower()
            if ext not in VIDEO_EXTENSIONS:
                continue
            size = files.file_size(idx)
            downloaded = fp[idx] if idx < len(fp) else 0
            selected_video_files.append({
                "index": idx,
                "name": os.path.basename(rel_path),
                "path": rel_path,
                "size": size,
                "downloaded": downloaded,
                "progress": round((downloaded / size) * 100, 2) if size > 0 else 0,
                "done": size > 0 and downloaded >= size * 0.995,
            })

    total_size = ti.total_size() if ti else 0
    progress_pct = round(s.progress * 100, 2)

    return {
        "id": info_hash_hex,
        "title": entry["title"],
        "mode": entry["mode"],
        "pendingSelection": bool(entry.get("pending_selection")),
        "addedAt": entry["added_at"],
        "paused": bool(s.flags & lt.torrent_flags.paused),
        "mediaInfo": entry["media_info"],
        "name": s.name if s.name else ti.name() if ti else "Unknown",
        "progress": progress_pct,
        "downloadSpeed": s.download_rate,
        "uploadSpeed": s.upload_rate,
        "downloaded": s.total_done,
        "uploaded": s.total_upload,
        "ratio": round(s.total_upload / max(s.total_done, 1), 2),
        "numPeers": s.num_peers,
        "numSeeds": s.num_seeds,
        "state": int(s.state),
        "hasMetadata": bool(s.has_metadata),
        "isFinished": bool(s.is_finished),
        "isSeeding": bool(s.is_seeding),
        "isPaused": bool(s.flags & lt.torrent_flags.paused),
        "announcingToTrackers": bool(getattr(s, "announcing_to_trackers", False)),
        "announcingToDht": bool(getattr(s, "announcing_to_dht", False)),
        "timeRemaining": int((total_size - s.total_done) / max(s.download_rate, 1) * 1000) if s.download_rate > 0 else -1,
        "ready": s.state in (lt.torrent_status.states.downloading, lt.torrent_status.states.seeding, lt.torrent_status.states.finished),
        "done": s.is_seeding or s.is_finished,
        "totalSize": total_size,
        "videoFile": video_info,
        "selectedVideoFiles": selected_video_files,
        "selectedFileIndexes": selected_file_indexes,
        "sequentialDownload": bool(entry.get("sequential_mode")),
        "savePath": getattr(s, "save_path", download_dir),
    }


# API HTTP Handler ───

class APIHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/")

        if path == "/add":
            self._handle_add()
        elif path == "/prepare":
            self._handle_prepare()
        elif path == "/pause":
            self._handle_pause()
        elif path == "/resume":
            self._handle_resume()
        elif path == "/remove":
            self._handle_remove()
        elif path == "/select-files":
            self._handle_select_files()
        elif path == "/speed-limit":
            self._handle_set_speed_limit()
        elif path == "/session-options":
            self._handle_session_options()
        elif path == "/stream/range-status":
            self._handle_stream_range_status()
        elif path == "/stream/ensure-range":
            self._handle_stream_ensure_range()
        else:
            self._send_json({"error": "Unknown endpoint"}, 404)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        params = parse_qs(parsed.query)

        if path == "/status":
            tid = params.get("id", [None])[0]
            if tid:
                st = build_status(tid)
                self._send_json(st if st else {"error": "Not found"}, 200 if st else 404)
            else:
                self._send_json({"error": "Missing id"}, 400)

        elif path == "/all":
            prune_invalid_torrents()
            all_statuses = [build_status(k) for k in torrents]
            self._send_json({"ok": True, "torrents": [s for s in all_statuses if s]})

        elif path == "/health":
            self._send_json({"ok": True, "version": lt.version, "torrents": len(torrents)})

        elif path == "/speed-limit":
            self._send_json({"ok": True, "downloadRateLimit": download_rate_limit})
        elif path == "/files":
            tid = params.get("id", [None])[0]
            self._handle_get_files(tid)

        else:
            self._send_json({"error": "Unknown endpoint"}, 404)

    def _build_add_params(self, torrent_id):
        atp = lt.add_torrent_params()
        atp.save_path = download_dir
        if torrent_id.startswith("magnet:"):
            atp = lt.parse_magnet_uri(torrent_id)
            atp.save_path = download_dir
            return ensure_trackers(atp)
        if len(torrent_id) == 40:
            atp = lt.parse_magnet_uri(f"magnet:?xt=urn:btih:{torrent_id}")
            atp.save_path = download_dir
            return ensure_trackers(atp)
        if torrent_id.startswith("http"):
            import urllib.request
            import urllib.error
            import tempfile

            req = urllib.request.Request(
                torrent_id,
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
            )
            try:
                with urllib.request.urlopen(req, timeout=20) as response:
                    torrent_data = response.read()
                magnet_from_body = extract_magnet_url(torrent_data.decode("utf-8", errors="ignore"))
                if magnet_from_body:
                    atp = lt.parse_magnet_uri(magnet_from_body)
                    atp.save_path = download_dir
                    return ensure_trackers(atp)

                fd, tmp_path = tempfile.mkstemp(suffix=".torrent", dir=download_dir)
                try:
                    with os.fdopen(fd, 'wb') as f:
                        f.write(torrent_data)
                    ti = lt.torrent_info(tmp_path)
                    atp.ti = ti
                    return atp
                finally:
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass
            except urllib.error.HTTPError as e:
                magnet_url = None
                location = e.headers.get("Location") if getattr(e, "headers", None) else None
                if location and str(location).lower().startswith("magnet:"):
                    magnet_url = str(location)
                if not magnet_url:
                    magnet_url = extract_magnet_url(str(e))
                if not magnet_url:
                    try:
                        error_body = e.read()
                    except Exception:
                        error_body = b""
                    magnet_url = extract_magnet_url(error_body.decode("utf-8", errors="ignore"))
                if magnet_url:
                    atp = lt.parse_magnet_uri(magnet_url)
                    atp.save_path = download_dir
                    return ensure_trackers(atp)
                raise ValueError(f"Indexer link rejected ({e.code}). Try another source with magnet/infohash.")
            except (urllib.error.URLError, RuntimeError, ValueError) as e:
                raise ValueError(f"Could not parse torrent link: {e}")
        raise ValueError("No valid torrent identifier")

    def _collect_files(self, handle):
        try:
            ti = handle.torrent_file()
        except RuntimeError as exc:
            raise ValueError(f"Torrent removed: {exc}")
        if not ti:
            return None
        files = ti.files()
        out = []
        for i in range(files.num_files()):
            rel_path = files.file_path(i)
            out.append({
                "index": i,
                "name": os.path.basename(rel_path),
                "path": rel_path,
                "size": files.file_size(i),
            })
        return out

    def _resolve_file_offset_and_size(self, ti, file_index):
        files = ti.files()
        if file_index < 0 or file_index >= files.num_files():
            raise ValueError("Invalid fileIndex")
        file_size = int(files.file_size(file_index))
        if file_size <= 0:
            raise ValueError("Invalid file size")

        # libtorrent API differs by version; prefer direct offset if available, fallback to cumulative sum.
        try:
            file_offset = int(files.file_offset(file_index))
            return file_offset, file_size
        except Exception:
            pass

        try:
            file_offset = 0
            for idx in range(file_index):
                file_offset += int(files.file_size(idx))
            return file_offset, file_size
        except Exception as exc:
            raise ValueError(f"Could not compute file offset: {exc}")

    def _compute_range_piece_status(self, handle, torrent_id, file_index, start, end):
        if not is_handle_valid(handle):
            return {"ok": False, "status": 410, "error": "Torrent removed"}

        try:
            ti = handle.torrent_file()
        except RuntimeError as exc:
            return {"ok": False, "status": 410, "error": f"Torrent removed: {exc}"}
        if not ti:
            return {"ok": False, "status": 503, "error": "Metadata not ready"}

        try:
            file_offset, file_size = self._resolve_file_offset_and_size(ti, file_index)
        except ValueError as exc:
            return {"ok": False, "status": 422, "error": str(exc)}

        if start >= file_size:
            return {"ok": False, "status": 416, "error": "Range start exceeds file size"}

        end = min(end, file_size - 1)
        global_start = file_offset + start
        global_end = file_offset + end

        try:
            piece_length = int(ti.piece_length())
        except Exception as exc:
            return {"ok": False, "status": 500, "error": f"Could not read piece length: {exc}"}
        if piece_length <= 0:
            return {"ok": False, "status": 500, "error": "Invalid piece length"}

        first_piece = global_start // piece_length
        last_piece = global_end // piece_length

        missing_pieces = []
        checked_pieces = 0
        try:
            for piece_idx in range(first_piece, last_piece + 1):
                checked_pieces += 1
                if not handle.have_piece(piece_idx):
                    missing_pieces.append(piece_idx)
        except Exception as exc:
            return {"ok": False, "status": 500, "error": f"Could not check pieces: {exc}"}

        return {
            "ok": True,
            "ready": len(missing_pieces) == 0,
            "torrentId": torrent_id,
            "fileIndex": file_index,
            "start": start,
            "end": end,
            "pieceLength": piece_length,
            "firstPiece": first_piece,
            "lastPiece": last_piece,
            "missingPieces": missing_pieces,
            "checkedPieces": checked_pieces,
        }

    def _handle_add(self):
        data = self._read_json()
        magnet_or_hash = data.get("magnetOrHash", "")
        torrent_url = data.get("torrentUrl", "")
        mode = data.get("mode", "download")
        title = data.get("title", "Unknown")
        media_info = data.get("mediaInfo", {})
        seed_mode = bool(data.get("seedMode", False))

        if mode != "download":
            self._send_json({"ok": False, "error": "Only torrent downloads are supported"}, 400)
            return

        torrent_id = magnet_or_hash or torrent_url
        if not torrent_id:
            self._send_json({"ok": False, "error": "No torrent identifier"}, 400)
            return

        try:
            atp = self._build_add_params(torrent_id)
            if seed_mode:
                try:
                    atp.flags |= lt.torrent_flags.seed_mode
                except Exception:
                    pass

            # Check if already exists
            info_hash_hex = str(atp.info_hashes.v1) if hasattr(atp, 'info_hashes') else str(atp.info_hash)
            info_hash_hex = info_hash_hex.replace(" ", "").lower()
            
            # Fix: sometimes info_hash is all zeros before adding
            handle = session.add_torrent(atp)
            
            # Get actual info hash after adding
            info_hash_hex = str(handle.info_hash()).replace(" ", "").lower()
            try:
                handle.unset_flags(lt.torrent_flags.auto_managed)
            except Exception:
                pass
            try:
                handle.unset_flags(lt.torrent_flags.paused)
            except Exception:
                pass
            try:
                handle.resume()
            except Exception:
                pass
            try:
                handle.force_reannounce()
            except Exception:
                pass
            try:
                handle.force_dht_announce()
            except Exception:
                pass

            torrents[info_hash_hex] = {
                "handle": handle,
                "mode": mode,
                "title": title,
                "media_info": media_info,
                "added_at": int(time.time() * 1000),
                "selected_file_idx": None,
                "sequential_mode": False,
            }

            self._send_json({"ok": True, "id": info_hash_hex, "title": title, "mode": mode})

        except ValueError as e:
            self._send_json({"ok": False, "error": str(e)}, 422)
        except RuntimeError as e:
            msg = str(e)
            if 'info_hash_hex' in locals():
                cleanup_torrent_entry(info_hash_hex, remove_from_session=True, delete_files=False)
            self._send_json({"ok": False, "error": f"Torrent runtime error: {msg}"}, 422)
        except Exception as e:
            if 'info_hash_hex' in locals():
                cleanup_torrent_entry(info_hash_hex, remove_from_session=True, delete_files=False)
            print(f"Error adding torrent: {e}", file=sys.stderr)
            self._send_json({"ok": False, "error": str(e)}, 500)

    def _handle_prepare(self):
        data = self._read_json()
        magnet_or_hash = data.get("magnetOrHash", "")
        torrent_url = data.get("torrentUrl", "")
        title = data.get("title", "Unknown")
        media_info = data.get("mediaInfo", {})
        torrent_id = magnet_or_hash or torrent_url
        if not torrent_id:
            self._send_json({"ok": False, "error": "No torrent identifier"}, 400)
            return
        try:
            atp = self._build_add_params(torrent_id)
            handle = session.add_torrent(atp)
            info_hash_hex = normalize_info_hash(handle.info_hash())
            handle.unset_flags(lt.torrent_flags.auto_managed)
            try:
                handle.unset_flags(lt.torrent_flags.upload_mode)
            except Exception:
                pass
            # Keep the torrent running so metadata can be fetched reliably.
            # We only pause + upload_mode after metadata exists.
            handle.resume()

            torrents[info_hash_hex] = {
                "handle": handle,
                "mode": "download",
                "title": title,
                "media_info": media_info,
                "added_at": int(time.time() * 1000),
                "selected_file_idx": None,
                "sequential_mode": False,
                "pending_selection": True,
            }

            files = self._collect_files(handle)

            try:
                # Do not download payload before user confirms file selection.
                if files:
                    file_priorities = [0] * len(files)
                    handle.prioritize_files(file_priorities)
                    handle.set_flags(lt.torrent_flags.upload_mode)
                    handle.pause()
            except Exception:
                pass

            self._send_json({
                "ok": True,
                "id": info_hash_hex,
                "title": title,
                "files": files or [],
                "metadataReady": files is not None,
            })
        except ValueError as e:
            self._send_json({"ok": False, "error": str(e)}, 422)
        except Exception as e:
            self._send_json({"ok": False, "error": str(e)}, 500)

    def _handle_session_options(self):
        data = self._read_json()
        applied = apply_session_options(data)
        self._send_json({"ok": True, "settings": applied})

    def _handle_pause(self):
        data = self._read_json()
        raw_tid = data.get("id")
        if raw_tid is None:
            self._send_json({"ok": False, "error": "Not found"}, 404)
            return
        tid = normalize_info_hash(raw_tid)
        if not tid or tid not in torrents:
            self._send_json({"ok": False, "error": "Not found"}, 404)
            return

        handle = torrents[tid].get("handle")
        if not is_handle_valid(handle):
            self._send_json({"ok": False, "error": "Torrent removed"}, 410)
            return

        try:
            # Explicit handle-level pause for this torrent only.
            handle.pause()
        except Exception as exc:
            self._send_json({"ok": False, "error": f"Pause failed: {exc}"}, 500)
            return

        deadline = time.time() + 2.0
        paused_flag = False
        state = None
        download_rate = 0
        upload_rate = 0
        while time.time() < deadline:
            try:
                st = handle.status()
                paused_flag = bool(st.flags & lt.torrent_flags.paused)
                state = int(st.state)
                download_rate = int(st.download_rate or 0)
                upload_rate = int(st.upload_rate or 0)
                if paused_flag and download_rate <= 1024:
                    break
            except Exception as exc:
                log_warning("pause_status_poll_failed", torrent=tid, error=str(exc))
                break
            time.sleep(0.1)

        self._send_json({
            "ok": True,
            "paused": paused_flag,
            "isPaused": paused_flag,
            "state": state,
            "downloadRate": download_rate,
            "uploadRate": upload_rate,
        })

    def _handle_resume(self):
        data = self._read_json()
        tid = data.get("id")
        if tid and tid in torrents:
            torrents[tid]["handle"].resume()
            self._send_json({"ok": True})
        else:
            self._send_json({"ok": False, "error": "Not found"}, 404)

    def _handle_remove(self):
        data = self._read_json()
        tid = data.get("id")
        delete_files = data.get("deleteFiles", False)
        if tid and tid in torrents:
            cleanup_torrent_entry(tid, remove_from_session=True, delete_files=delete_files)
            self._send_json({"ok": True})
        else:
            self._send_json({"ok": False, "error": "Not found"}, 404)

    def _handle_get_files(self, tid):
        if not tid or tid not in torrents:
            self._send_json({"ok": False, "error": "Torrent not found"}, 404)
            return
        entry = torrents[tid]
        h = entry["handle"]
        if not is_handle_valid(h):
            self._send_json({"ok": False, "error": "Torrent removed"}, 410)
            return
        files = self._collect_files(h)
        if files is None:
            # For pending-selection torrents, ensure metadata fetch is still active.
            if entry.get("pending_selection"):
                try:
                    h.unset_flags(lt.torrent_flags.upload_mode)
                except Exception:
                    pass
                try:
                    h.resume()
                except Exception:
                    pass
            self._send_json({"ok": False, "error": "Metadata not ready"}, 503)
            return
        if entry.get("pending_selection"):
            try:
                file_priorities = [0] * len(files)
                h.prioritize_files(file_priorities)
                h.set_flags(lt.torrent_flags.upload_mode)
                h.pause()
            except Exception:
                pass
        selected = []
        try:
            prios = h.get_file_priorities()
            selected = [idx for idx, value in enumerate(prios) if int(value) > 0]
        except Exception:
            selected = []
        self._send_json({"ok": True, "id": tid, "files": files, "selectedFileIndexes": selected})

    def _handle_select_files(self):
        data = self._read_json()
        tid = data.get("id")
        file_indexes = data.get("fileIndexes", [])
        resume = data.get("resume", True)
        sequential_download = bool(data.get("sequentialDownload", False))
        if tid not in torrents:
            self._send_json({"ok": False, "error": "Torrent not found"}, 404)
            return
        entry = torrents[tid]
        h = entry["handle"]
        if not is_handle_valid(h):
            self._send_json({"ok": False, "error": "Torrent removed"}, 410)
            return
        try:
            ti = h.torrent_file()
        except RuntimeError as exc:
            log_warning("select_file_torrent_file_failed", torrent=tid, error=str(exc))
            self._send_json({"ok": False, "error": "Torrent removed"}, 410)
            return
        if not ti:
            self._send_json({"ok": False, "error": "Metadata not ready"}, 503)
            return
        files = ti.files()
        if not isinstance(file_indexes, list):
            self._send_json({"ok": False, "error": "fileIndexes must be an array"}, 400)
            return
        valid_indexes = sorted({int(idx) for idx in file_indexes if isinstance(idx, int) and 0 <= idx < files.num_files()})
        if not valid_indexes:
            self._send_json({"ok": False, "error": "At least one valid file index is required"}, 400)
            return

        priorities = [0] * files.num_files()
        for idx in valid_indexes:
            priorities[idx] = 1
        h.prioritize_files(priorities)
        try:
            if sequential_download:
                h.set_flags(lt.torrent_flags.sequential_download)
            else:
                h.unset_flags(lt.torrent_flags.sequential_download)
        except Exception:
            try:
                h.set_sequential_download(sequential_download)
            except Exception:
                pass
        entry["selected_file_idx"] = valid_indexes[0]
        entry["sequential_mode"] = sequential_download
        entry["pending_selection"] = False
        if resume:
            try:
                h.unset_flags(lt.torrent_flags.paused)
            except Exception:
                pass
            try:
                h.unset_flags(lt.torrent_flags.upload_mode)
            except Exception:
                pass
            h.resume()
        self._send_json({"ok": True, "selectedFileIndexes": valid_indexes, "sequentialDownload": sequential_download, "resumed": bool(resume)})

    def _handle_set_speed_limit(self):
        data = self._read_json()
        limit_bps = data.get("downloadRateLimit", 0)
        applied = apply_download_rate_limit(limit_bps)
        self._send_json({"ok": True, "downloadRateLimit": applied})

    def _handle_stream_range_status(self):
        data = self._read_json()
        torrent_id = str(data.get("torrentId") or "").strip()
        file_index_raw = data.get("fileIndex")
        start_raw = data.get("start")
        end_raw = data.get("end")

        if not torrent_id:
            self._send_json({"ok": False, "error": "torrentId is required"}, 400)
            return
        if torrent_id not in torrents:
            self._send_json({"ok": False, "error": "Torrent not found"}, 404)
            return

        try:
            file_index = int(file_index_raw)
            start = int(start_raw)
            end = int(end_raw)
        except Exception:
            self._send_json({"ok": False, "error": "fileIndex/start/end must be integers"}, 400)
            return

        if file_index < 0 or start < 0 or end < 0 or start > end:
            self._send_json({"ok": False, "error": "Invalid range parameters"}, 400)
            return

        entry = torrents[torrent_id]
        handle = entry.get("handle")
        status = self._compute_range_piece_status(handle, torrent_id, file_index, start, end)
        if not status.get("ok"):
            self._send_json({"ok": False, "error": status.get("error", "Range status failed")}, int(status.get("status", 500)))
            return
        self._send_json(status)

    def _handle_stream_ensure_range(self):
        data = self._read_json()
        torrent_id = str(data.get("torrentId") or "").strip()
        file_index_raw = data.get("fileIndex")
        start_raw = data.get("start")
        end_raw = data.get("end")
        deadline_ms_raw = data.get("deadlineMs", 1000)

        if not torrent_id:
            self._send_json({"ok": False, "ready": False, "error": "torrentId is required"}, 400)
            return
        if torrent_id not in torrents:
            self._send_json({"ok": False, "ready": False, "error": "Torrent not found"}, 404)
            return

        try:
            file_index = int(file_index_raw)
            start = int(start_raw)
            end = int(end_raw)
            deadline_ms = max(1, int(deadline_ms_raw))
        except Exception:
            self._send_json({"ok": False, "ready": False, "error": "fileIndex/start/end/deadlineMs must be integers"}, 400)
            return

        if file_index < 0 or start < 0 or end < 0 or start > end:
            self._send_json({"ok": False, "ready": False, "error": "Invalid range parameters"}, 400)
            return

        entry = torrents[torrent_id]
        handle = entry.get("handle")
        status = self._compute_range_piece_status(handle, torrent_id, file_index, start, end)
        if not status.get("ok"):
            self._send_json({"ok": False, "ready": False, "error": status.get("error", "Ensure range failed")}, int(status.get("status", 500)))
            return
        if status.get("ready") is True:
            status["prioritizedPieces"] = 0
            status["deadlineMs"] = deadline_ms
            self._send_json(status)
            return

        try:
            paused = bool(handle.status().flags & lt.torrent_flags.paused)
        except Exception:
            paused = False
        if paused:
            status["prioritizedPieces"] = 0
            status["ready"] = False
            status["deadlineMs"] = deadline_ms
            status["error"] = "Torrent is paused"
            self._send_json(status)
            return

        prioritized = 0
        for piece_idx in status.get("missingPieces", []):
            try:
                handle.piece_priority(int(piece_idx), 7)
                prioritized += 1
            except Exception as exc:
                log_warning("piece_priority_failed", torrent=torrent_id, piece=int(piece_idx), error=str(exc))
            try:
                handle.set_piece_deadline(int(piece_idx), deadline_ms)
            except Exception as exc:
                log_warning("piece_deadline_failed", torrent=torrent_id, piece=int(piece_idx), deadlineMs=deadline_ms, error=str(exc))

        status["prioritizedPieces"] = prioritized
        status["deadlineMs"] = deadline_ms
        self._send_json(status)


def main():
    global download_dir, server_port

    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: torrent_service.py <download_dir> [port]"}))
        sys.exit(1)

    download_dir = sys.argv[1]
    os.makedirs(download_dir, exist_ok=True)

    requested_port = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    # Init libtorrent session
    init_session()

    # Start API server
    api_server = ThreadingHTTPServer(("127.0.0.1", requested_port), APIHandler)
    server_port = api_server.server_address[1]

    # Print startup info as JSON to stdout (Electron reads this)
    startup_info = {
        "ok": True,
        "apiPort": server_port,
        "downloadDir": download_dir,
        "libtorrentVersion": lt.version,
    }
    print(json.dumps(startup_info), flush=True)

    # Serve forever
    try:
        api_server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        alert_pump_stop.set()
        api_server.server_close()
        shutdown_session_cleanup()


if __name__ == "__main__":
    main()
