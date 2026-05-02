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
file_server_port = 0
file_server = None
download_rate_limit = 0
STREAM_WAIT_TIMEOUT_SECONDS = 180
STREAM_LOOKAHEAD_PIECES = 32
STREAM_START_BUFFER_BYTES = 15 * 1024 * 1024
piece_events = {}   # info_hash_hex -> { piece_index -> Event }
piece_events_lock = threading.Lock()
alert_pump_stop = threading.Event()
DEFAULT_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.moeking.me:6969/announce",
    "udp://explodie.org:6969/announce",
]


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


def get_piece_event(info_hash_hex, piece_index):
    with piece_events_lock:
        torrent_events = piece_events.setdefault(info_hash_hex, {})
        event = torrent_events.get(piece_index)
        if event is None:
            event = threading.Event()
            torrent_events[piece_index] = event
        return event


def clear_piece_event(info_hash_hex, piece_index):
    with piece_events_lock:
        torrent_events = piece_events.get(info_hash_hex)
        if not torrent_events:
            return
        torrent_events.pop(piece_index, None)
        if not torrent_events:
            piece_events.pop(info_hash_hex, None)


def clear_torrent_piece_events(info_hash_hex):
    with piece_events_lock:
        piece_events.pop(info_hash_hex, None)


def get_stream_file_context(info_hash_hex):
    entry = torrents.get(info_hash_hex)
    if not entry:
        return None

    handle = entry.get("handle")
    if not is_handle_valid(handle):
        return None

    try:
        ti = handle.torrent_file()
    except RuntimeError as exc:
        log_warning("stream_context_torrent_file_failed", torrent=info_hash_hex, error=str(exc))
        return None
    if not ti:
        return None

    files = ti.files()
    selected_idx = entry.get("selected_file_idx")
    if selected_idx is not None and 0 <= selected_idx < files.num_files():
        file_idx = selected_idx
        file_path = files.file_path(file_idx)
    else:
        file_idx, file_path = find_video_file(handle)
    if file_idx is None:
        return None

    piece_length = ti.piece_length()
    file_offset = files.file_offset(file_idx)
    file_size = files.file_size(file_idx)
    first_piece = file_offset // piece_length
    last_piece = min((file_offset + file_size - 1) // piece_length, ti.num_pieces() - 1)

    return {
        "entry": entry,
        "handle": handle,
        "torrent_info": ti,
        "files": files,
        "file_idx": file_idx,
        "file_path": file_path,
        "file_size": file_size,
        "file_offset": file_offset,
        "piece_length": piece_length,
        "first_piece": first_piece,
        "last_piece": last_piece,
    }


def count_ready_bytes_from_start(handle, first_piece, last_piece, piece_length, file_size):
    ready_pieces = 0
    for piece in range(first_piece, last_piece + 1):
        try:
            if not handle.have_piece(piece):
                break
        except RuntimeError:
            break
        ready_pieces += 1
    return min(file_size, ready_pieces * piece_length)


def pieces_ready(handle, start_piece, end_piece):
    for piece in range(start_piece, end_piece + 1):
        try:
            if not handle.have_piece(piece):
                return False
        except RuntimeError:
            return False
    return True


def stream_ready_state(info_hash_hex):
    ctx = get_stream_file_context(info_hash_hex)
    if not ctx:
        return {"ok": False, "ready": False, "error": "Stream file not ready"}

    handle = ctx["handle"]
    ti = ctx["torrent_info"]
    first_piece = ctx["first_piece"]
    last_piece = ctx["last_piece"]
    piece_length = ctx["piece_length"]
    file_size = ctx["file_size"]

    prioritize_for_streaming(handle)
    sequential_ready_bytes = count_ready_bytes_from_start(handle, first_piece, last_piece, piece_length, file_size)
    needed_start_bytes = min(STREAM_START_BUFFER_BYTES, file_size)
    edge_piece_count = max(5, int(((last_piece - first_piece + 1) * 0.02) + 0.999))
    edge_piece_count = min(edge_piece_count, last_piece - first_piece + 1)

    first_ready = pieces_ready(handle, first_piece, min(first_piece + edge_piece_count - 1, last_piece))
    last_ready = pieces_ready(handle, max(first_piece, last_piece - edge_piece_count + 1), last_piece)
    buffer_ready = sequential_ready_bytes >= needed_start_bytes
    ready = bool(buffer_ready and first_ready and last_ready)

    update_streaming_focus(info_hash_hex, handle, ti, first_piece)
    for offset, piece in enumerate(range(max(first_piece, last_piece - edge_piece_count + 1), last_piece + 1)):
        try:
            handle.piece_priority(piece, 7)
            handle.set_piece_deadline(piece, offset * 150)
        except Exception as exc:
            log_warning("set_tail_piece_deadline_failed", piece=piece, error=str(exc))

    return {
        "ok": True,
        "ready": ready,
        "bufferReady": buffer_ready,
        "firstReady": first_ready,
        "lastReady": last_ready,
        "sequentialReadyBytes": sequential_ready_bytes,
        "neededStartBytes": needed_start_bytes,
        "edgePieceCount": edge_piece_count,
    }


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
        clear_torrent_piece_events(info_hash_hex)
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

    clear_torrent_piece_events(info_hash_hex)
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


def signal_piece_finished(info_hash_hex, piece_index):
    with piece_events_lock:
        torrent_events = piece_events.get(info_hash_hex)
        if not torrent_events:
            return
        event = torrent_events.get(piece_index)
        if event:
            event.set()


def wait_for_piece(info_hash_hex, handle, piece_index, timeout_seconds=30):
    try:
        if handle.have_piece(piece_index):
            return True
    except RuntimeError as exc:
        log_warning("piece_ready_check_failed", torrent=info_hash_hex, piece=piece_index, error=str(exc))
        return False

    event = get_piece_event(info_hash_hex, piece_index)
    if event.wait(timeout_seconds):
        clear_piece_event(info_hash_hex, piece_index)
        return True

    try:
        ready = handle.have_piece(piece_index)
    except RuntimeError as exc:
        log_warning("piece_ready_recheck_failed", torrent=info_hash_hex, piece=piece_index, error=str(exc))
        ready = False
    if ready:
        clear_piece_event(info_hash_hex, piece_index)
        return True
    log_warning("piece_ready_timeout", torrent=info_hash_hex, piece=piece_index, timeoutSeconds=timeout_seconds)
    return False


def set_sequential_mode(handle, enabled):
    try:
        handle.set_sequential_download(bool(enabled))
    except Exception as exc:
        log_warning("set_sequential_download_failed", enabled=bool(enabled), error=str(exc))
    try:
        if enabled:
            handle.set_flags(lt.torrent_flags.sequential_download)
        else:
            handle.unset_flags(lt.torrent_flags.sequential_download)
    except Exception as exc:
        log_warning("set_sequential_flag_failed", enabled=bool(enabled), error=str(exc))


def update_streaming_focus(info_hash_hex, handle, ti, current_piece, sequential=True):
    entry = torrents.get(info_hash_hex)
    if not entry:
        return

    entry["last_stream_piece"] = current_piece

    try:
        num_pieces = ti.num_pieces()
        set_sequential_mode(handle, sequential)
        handle.piece_priority(current_piece, 7)
        lookahead_end = min(current_piece + STREAM_LOOKAHEAD_PIECES, num_pieces)
        for piece in range(current_piece + 1, lookahead_end):
            handle.piece_priority(piece, 7)
        for piece in range(max(0, current_piece - 2), current_piece):
            handle.piece_priority(piece, 7)
        for offset, piece in enumerate(range(current_piece, min(current_piece + STREAM_LOOKAHEAD_PIECES, num_pieces))):
            try:
                handle.set_piece_deadline(piece, offset * 150)
            except Exception as exc:
                log_warning("set_piece_deadline_failed", piece=piece, error=str(exc))
    except RuntimeError as exc:
        log_warning("update_streaming_focus_failed", torrent=info_hash_hex, piece=current_piece, error=str(exc))


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
                if category_name == "piece finished":
                    info_hash_hex = normalize_info_hash(item.handle.info_hash())
                    signal_piece_finished(info_hash_hex, item.piece_index)
                elif category_name == "torrent removed":
                    info_hash_hex = normalize_info_hash(item.info_hash)
                    clear_torrent_piece_events(info_hash_hex)
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
    # Streaming optimizations
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
    best_idx = -1
    best_size = -1
    best_rank = 999
    for i in range(files.num_files()):
        name = files.file_path(i)
        lower = name.lower()
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
    if best_idx >= 0:
        return best_idx, files.file_path(best_idx)
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


def prioritize_for_streaming(handle):
    """Set piece priorities for streaming — prioritize beginning and end of video file."""
    if not is_handle_valid(handle):
        return
    try:
        ti = handle.torrent_file()
    except RuntimeError as exc:
        log_warning("prioritize_torrent_file_failed", torrent=safe_handle_id(handle), error=str(exc))
        return
    if not ti:
        return
    entry = None
    for item in torrents.values():
        if item.get("handle") == handle:
            entry = item
            break

    selected_idx = entry.get("selected_file_idx") if entry else None
    if selected_idx is not None and 0 <= selected_idx < ti.files().num_files():
        file_idx = selected_idx
    else:
        file_idx, _ = find_video_file(handle)
    if file_idx is None:
        return

    num_pieces = ti.num_pieces()
    piece_length = ti.piece_length()
    files = ti.files()

    # Set all file priorities: deselect non-video, select video
    file_priorities = [0] * files.num_files()
    file_priorities[file_idx] = 7
    handle.prioritize_files(file_priorities)

    # Get file's piece range
    file_offset = files.file_offset(file_idx)
    file_size = files.file_size(file_idx)
    first_piece = file_offset // piece_length
    last_piece = min((file_offset + file_size - 1) // piece_length, num_pieces - 1)

    edge_piece_count = max(5, int(((last_piece - first_piece + 1) * 0.02) + 0.999))
    edge_piece_count = min(edge_piece_count, last_piece - first_piece + 1)

    # Keep unrelated pieces off. Download the video sequentially, with first/last
    # 2% at top priority for container metadata.
    piece_priorities = [0] * num_pieces
    for i in range(first_piece, last_piece + 1):
        piece_priorities[i] = 6
    for i in range(first_piece, min(first_piece + edge_piece_count, last_piece + 1)):
        piece_priorities[i] = 7
    for i in range(max(first_piece, last_piece - edge_piece_count + 1), last_piece + 1):
        piece_priorities[i] = 7

    handle.prioritize_pieces(piece_priorities)
    set_sequential_mode(handle, True)
    update_streaming_focus(normalize_info_hash(handle.info_hash()), handle, ti, first_piece)


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
        "savePath": getattr(s, "save_path", download_dir),
    }


# ─── HTTP File Server (for streaming video to HTML5 <video>) ───

class FileStreamHandler(BaseHTTPRequestHandler):
    """Serves torrent video files with Range request support for HTML5 video streaming."""

    def log_message(self, format, *args):
        pass  # Suppress logs

    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def _prepare_stream_response(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        if len(parts) < 1:
            self.send_error(400)
            return None

        info_hash = parts[0]
        entry = torrents.get(info_hash)
        if not entry:
            self.send_error(404, "Torrent not found")
            return None

        h = entry["handle"]
        if not is_handle_valid(h):
            self.send_error(410, "Torrent removed")
            return None
        try:
            ti = h.torrent_file()
        except RuntimeError as exc:
            log_warning("stream_torrent_file_failed", torrent=info_hash, error=str(exc))
            self.send_error(410, "Torrent removed")
            return None
        if not ti:
            self.send_error(503, "Torrent metadata not ready")
            return None

        selected_idx = entry.get("selected_file_idx")
        if selected_idx is not None and ti and 0 <= selected_idx < ti.files().num_files():
            file_idx = selected_idx
            file_path = ti.files().file_path(file_idx)
        else:
            file_idx, file_path = find_video_file(h)
        if file_idx is None:
            self.send_error(404, "No video file found")
            return None

        try:
            save_path = h.status().save_path
        except RuntimeError as exc:
            log_warning("stream_status_failed", torrent=info_hash, error=str(exc))
            self.send_error(410, "Torrent removed")
            return None
        abs_path = os.path.join(save_path, file_path)

        if not os.path.exists(abs_path):
            for _ in range(40):
                if os.path.exists(abs_path):
                    break
                time.sleep(0.5)
            if not os.path.exists(abs_path):
                self.send_error(503, "File not available yet")
                return None

        file_size = os.path.getsize(abs_path)
        if file_size == 0:
            for _ in range(40):
                file_size = os.path.getsize(abs_path)
                if file_size > 0:
                    break
                time.sleep(0.5)

        range_header = self.headers.get("Range")
        start = 0
        end = file_size - 1
        if range_header:
            range_str = range_header.replace("bytes=", "")
            range_parts = range_str.split("-")
            start = int(range_parts[0]) if range_parts[0] else 0
            end = int(range_parts[1]) if len(range_parts) > 1 and range_parts[1] else file_size - 1
        seek_request = bool(range_header and start > 0)
        if seek_request:
            set_sequential_mode(h, False)

        ext = os.path.splitext(abs_path)[1].lower()
        content_type = {
            '.mp4': 'video/mp4',
            '.mkv': 'video/x-matroska',
            '.webm': 'video/webm',
            '.avi': 'video/mp4',
            '.mov': 'video/mp4',
            '.m4v': 'video/mp4',
            '.ts': 'video/mp2t',
        }.get(ext, 'video/mp4')

        if range_header:
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        else:
            self.send_response(200)

        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(file_size if not range_header else (end - start + 1)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        return {
            "info_hash": info_hash,
            "handle": h,
            "torrent_info": ti,
            "file_idx": file_idx,
            "abs_path": abs_path,
            "start": start,
            "end": end,
            "seek_request": seek_request,
        }

    def do_GET(self):
        stream_ctx = self._prepare_stream_response()
        if not stream_ctx:
            return

        try:
            info_hash = stream_ctx["info_hash"]
            h = stream_ctx["handle"]
            ti = stream_ctx["torrent_info"]
            file_idx = stream_ctx["file_idx"]
            abs_path = stream_ctx["abs_path"]
            start = stream_ctx["start"]
            end = stream_ctx["end"]
            seek_request = stream_ctx["seek_request"]
            piece_length = ti.piece_length()
            files_storage = ti.files()
            file_offset = files_storage.file_offset(file_idx)
            file_total_size = files_storage.file_size(file_idx)
            
            with open(abs_path, "rb") as f:
                f.seek(start)
                remaining = end - start + 1
                current_pos = start
                status_error_logged = False
                
                while remaining > 0:
                    if info_hash not in torrents or not is_handle_valid(h):
                        break

                    # Fast-path: if target file is fully downloaded, stream directly from disk
                    # without per-piece checks to avoid late buffering stalls.
                    try:
                        st = h.status()
                        fp = h.file_progress()
                        file_done = bool(
                            st.is_finished
                            or st.is_seeding
                            or (file_idx < len(fp) and fp[file_idx] >= file_total_size)
                        )
                    except RuntimeError as exc:
                        if not status_error_logged:
                            log_warning("stream_status_failed", torrent=info_hash, error=str(exc))
                            status_error_logged = True
                        file_done = False

                    if file_done:
                        read_size = min(65536, remaining)
                        try:
                            data = f.read(read_size)
                        except OSError as exc:
                            log_warning("stream_file_read_failed", torrent=info_hash, position=current_pos, size=read_size, error=str(exc))
                            break
                        if not data:
                            break
                        try:
                            self.wfile.write(data)
                        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError) as exc:
                            log_warning("stream_client_disconnected", torrent=info_hash, position=current_pos, error=str(exc))
                            break
                        except OSError as exc:
                            log_warning("stream_file_write_failed", torrent=info_hash, position=current_pos, size=len(data), error=str(exc))
                            break
                        remaining -= len(data)
                        current_pos += len(data)
                        continue

                    current_piece = (file_offset + current_pos) // piece_length
                    update_streaming_focus(info_hash, h, ti, current_piece, sequential=not seek_request)
                    
                    try:
                        has_piece = h.have_piece(current_piece)
                    except RuntimeError:
                        log_warning("have_piece_failed", torrent=info_hash, piece=current_piece, error="runtime")
                        break

                    if not has_piece:
                        try:
                            update_streaming_focus(info_hash, h, ti, current_piece, sequential=not seek_request)
                            try:
                                h.set_piece_deadline(current_piece, 0)
                            except Exception as exc:
                                log_warning("set_piece_deadline_failed", piece=current_piece, error=str(exc))
                        except RuntimeError as exc:
                            log_warning("stream_piece_deadline_context_failed", torrent=info_hash, piece=current_piece, error=str(exc))
                            break
                        piece_ready = wait_for_piece(info_hash, h, current_piece, timeout_seconds=STREAM_WAIT_TIMEOUT_SECONDS)
                        if not piece_ready:
                            break # Connection will close, browser will retry

                    bytes_left_in_piece = (current_piece + 1) * piece_length - (file_offset + current_pos)
                    read_size = min(65536, remaining, bytes_left_in_piece)
                    
                    try:
                        data = f.read(read_size)
                    except OSError as exc:
                        log_warning("stream_file_read_failed", torrent=info_hash, position=current_pos, size=read_size, error=str(exc))
                        break
                    if not data:
                        break
                    try:
                        self.wfile.write(data)
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError) as exc:
                        log_warning("stream_client_disconnected", torrent=info_hash, position=current_pos, error=str(exc))
                        break
                    except OSError as exc:
                        log_warning("stream_file_write_failed", torrent=info_hash, position=current_pos, size=len(data), error=str(exc))
                        break
                    remaining -= len(data)
                    current_pos += len(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError) as exc:
            log_warning("stream_client_disconnected", torrent=info_hash, error=str(exc))
        except RuntimeError as exc:
            log_warning("stream_runtime_error", torrent=info_hash, error=str(exc))

    def do_HEAD(self):
        self._prepare_stream_response()


def start_file_server():
    global file_server, file_server_port
    file_server = ThreadingHTTPServer(("127.0.0.1", 0), FileStreamHandler)
    file_server_port = file_server.server_address[1]
    thread = threading.Thread(target=file_server.serve_forever, daemon=True)
    thread.start()
    return file_server_port


# ─── API HTTP Handler ───

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
                with urllib.request.urlopen(req) as response:
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

    def _handle_add(self):
        data = self._read_json()
        magnet_or_hash = data.get("magnetOrHash", "")
        torrent_url = data.get("torrentUrl", "")
        mode = data.get("mode", "download")
        title = data.get("title", "Unknown")
        media_info = data.get("mediaInfo", {})

        if mode != "download":
            self._send_json({"ok": False, "error": "Only torrent downloads are supported"}, 400)
            return

        torrent_id = magnet_or_hash or torrent_url
        if not torrent_id:
            self._send_json({"ok": False, "error": "No torrent identifier"}, 400)
            return

        try:
            atp = self._build_add_params(torrent_id)

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
                "last_stream_piece": None,
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
            handle.set_flags(lt.torrent_flags.paused)
            handle.pause()

            torrents[info_hash_hex] = {
                "handle": handle,
                "mode": "download",
                "title": title,
                "media_info": media_info,
                "added_at": int(time.time() * 1000),
                "selected_file_idx": None,
                "last_stream_piece": None,
                "sequential_mode": False,
                "pending_selection": True,
            }

            deadline = time.time() + 15
            files = None
            while time.time() < deadline:
                files = self._collect_files(handle)
                if files is not None:
                    break
                time.sleep(0.2)

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
        tid = data.get("id")
        if tid and tid in torrents:
            torrents[tid]["handle"].pause()
            self._send_json({"ok": True})
        else:
            self._send_json({"ok": False, "error": "Not found"}, 404)

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
            self._send_json({"ok": False, "error": "Metadata not ready"}, 503)
            return
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
        entry["selected_file_idx"] = valid_indexes[0]
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
        self._send_json({"ok": True, "selectedFileIndexes": valid_indexes, "resumed": bool(resume)})

    def _handle_set_speed_limit(self):
        data = self._read_json()
        limit_bps = data.get("downloadRateLimit", 0)
        applied = apply_download_rate_limit(limit_bps)
        self._send_json({"ok": True, "downloadRateLimit": applied})


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
        if file_server:
            file_server.shutdown()
        shutdown_session_cleanup()


if __name__ == "__main__":
    main()
