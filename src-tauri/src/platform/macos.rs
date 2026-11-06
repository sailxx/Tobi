// macOS: ~/Library for files, `open` for links and folders, and an NSWindow
// pinned above the menu bar for the island.
//
// The island works like the Windows one: the window is placed by Tauri, a
// cursor poll (CoreGraphics) drives click-through, the eyes and the drag.
// This file was written without a Mac at hand and is built and unit-tested by
// CI only; nothing here has been seen running on a real notch display.

use std::ffi::c_void;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use tauri::{AppHandle, WebviewWindow};

use super::{home_dir, LocalTime};

/// File name of the Claude Code relay.
pub const HOOK_EXE: &str = "tobi-hook";

/// Environment variable holding the home directory.
pub const HOME_VAR: &str = "HOME";

// ── Files ─────────────────────────────────────────────────────────────────────

/// ~/Library/Application Support/Tobi — preferences, tobi-hook, the inbox, the
/// log and the relay socket. Every path built from it is quoted wherever it is
/// handed to a shell (hooks.rs), so the space in "Application Support" is safe.
pub fn config_dir() -> PathBuf {
    home_dir().join("Library/Application Support/Tobi")
}

pub fn local_dir() -> PathBuf {
    config_dir()
}

/// Where a saved image goes, best first.
pub fn picture_dirs() -> Vec<PathBuf> {
    let home = home_dir();
    vec![home.join("Pictures"), home.join("Downloads"), home]
}

/// Nothing to prepare: WebKit on macOS needs no environment.
pub fn prepare_environment() {}

pub fn local_time() -> LocalTime {
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe {
        let now = libc::time(std::ptr::null_mut());
        libc::localtime_r(&now, &mut tm);
    }
    LocalTime {
        year: (tm.tm_year + 1900) as u32,
        month: (tm.tm_mon + 1) as u32,
        day: tm.tm_mday as u32,
        hour: tm.tm_hour as u32,
        minute: tm.tm_min as u32,
        second: tm.tm_sec as u32,
    }
}

/// Creates `dir` and closes it to other users.
pub fn ensure_private_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
}

/// A real directory (not a symlink), owned by us, no access for group or others.
fn is_private_dir(dir: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    std::fs::symlink_metadata(dir)
        .map(|m| {
            m.file_type().is_dir() && m.uid() == unsafe { libc::getuid() } && m.mode() & 0o077 == 0
        })
        .unwrap_or(false)
}

/// Where tobi-hook finds us: `~/Library/Application Support/Tobi/tobi.sock`.
/// macOS has no `$XDG_RUNTIME_DIR`; this directory is made 0700 by
/// `ensure_private_dir`. Must match `socket_path()` in hook/src/unix.rs exactly.
pub fn relay_socket_path() -> Option<PathBuf> {
    let dir = config_dir();
    ensure_private_dir(&dir).ok()?;
    is_private_dir(&dir).then(|| dir.join("tobi.sock"))
}

// ── Who we are ────────────────────────────────────────────────────────────────

/// The account's full name from the passwd entry ("Louis Raille").
pub fn user_full_name() -> Option<String> {
    unsafe {
        let mut pwd: libc::passwd = std::mem::zeroed();
        let mut result: *mut libc::passwd = std::ptr::null_mut();
        let mut buf = vec![0 as libc::c_char; 16 * 1024];
        let rc = libc::getpwuid_r(libc::getuid(), &mut pwd, buf.as_mut_ptr(), buf.len(), &mut result);
        if rc != 0 || result.is_null() || pwd.pw_gecos.is_null() {
            return None;
        }
        let gecos = std::ffi::CStr::from_ptr(pwd.pw_gecos).to_string_lossy().into_owned();
        let name = gecos.split(',').next().unwrap_or("").trim().to_string();
        (!name.is_empty()).then_some(name)
    }
}

// ── Processes ─────────────────────────────────────────────────────────────────

pub fn no_console(cmd: &mut Command) -> &mut Command {
    cmd
}

pub fn open_url(url: &str) {
    let _ = Command::new("open").arg(url).spawn();
}

pub fn reveal_folder(path: &str) {
    let _ = Command::new("open").arg(path).spawn();
}

/// Our own `which`: the first executable file named `stem` on $PATH, then the
/// folders a Dock launch leaves out of it (Homebrew, npm, Volta, Bun).
pub fn find_on_path(stem: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    let home = home_dir();
    dirs.extend(
        ["/opt/homebrew/bin", "/usr/local/bin"].iter().map(PathBuf::from).chain(
            [".local/bin", ".npm-global/bin", ".volta/bin", ".bun/bin", ".claude/local"]
                .iter()
                .map(|d| home.join(d)),
        ),
    );
    dirs.into_iter().map(|dir| dir.join(stem)).find(|p| is_executable(p))
}

fn is_executable(p: &Path) -> bool {
    std::fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

// ── Session windows ("Open terminal") ─────────────────────────────────────────

/// Claude's desktop app for the Mac: opened by its bundle name.
pub fn open_claude_desktop() -> bool {
    Command::new("open").args(["-a", "Claude"]).status().is_ok_and(|s| s.success())
}

/// Where the Codex CLI may be, best first.
pub fn codex_candidates() -> Vec<PathBuf> {
    find_on_path("codex").into_iter().collect()
}

/// A process's ancestors, nearest first, from `ps`. Used only to remember which
/// terminal a session runs in.
pub fn process_ancestors(pid: u32) -> Vec<u32> {
    let mut out = Vec::new();
    let mut current = pid;
    for _ in 0..crate::session_window::MAX_DEPTH {
        let Ok(o) = Command::new("ps").args(["-o", "ppid=", "-p", &current.to_string()]).output() else {
            break;
        };
        let Some(parent) = String::from_utf8_lossy(&o.stdout).trim().parse::<u32>().ok() else { break };
        if parent <= 1 {
            break;
        }
        out.push(parent);
        current = parent;
    }
    out
}

/// Raising a terminal window is not implemented on the Mac: the island falls
/// back to opening the folder in VS Code.
pub fn window_owners(_ancestors: &[u32]) -> Vec<u32> {
    Vec::new()
}

pub fn focus_session_window(_owners: &[u32], _folder: &str) -> bool {
    false
}

// ── Cursor ────────────────────────────────────────────────────────────────────

/// The 60 Hz poll reads the cursor and flips click-through from it.
pub const CURSOR_POLL: bool = true;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *const c_void) -> CGPoint;
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

/// The island window's scale factor (bits of an f64), kept by `pin_to_monitor`:
/// CoreGraphics reports the cursor in points, the poll compares physical pixels.
static WINDOW_SCALE: AtomicU64 = AtomicU64::new(0x3FF0_0000_0000_0000); // 1.0

/// Cursor position in physical screen pixels (points × the island's scale).
pub fn cursor_physical() -> Option<(f64, f64)> {
    let scale = f64::from_bits(WINDOW_SCALE.load(Ordering::Relaxed));
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let p = CGEventGetLocation(event);
        CFRelease(event);
        Some((p.x * scale, p.y * scale))
    }
}

/// True while the left mouse button is held.
pub fn left_button_down() -> bool {
    // kCGEventSourceStateCombinedSessionState = 0, kCGMouseButtonLeft = 0.
    unsafe { CGEventSourceButtonState(0, 0) }
}

// ── Island window ─────────────────────────────────────────────────────────────

/// Runs `f` on the NSWindow behind `win`. AppKit objects belong to the main
/// thread, so this hops there when called from anywhere else.
fn with_ns_window(win: &WebviewWindow, f: impl FnOnce(&NSWindow) + Send + 'static) {
    let target = win.clone();
    let _ = win.run_on_main_thread(move || {
        let Ok(ptr) = target.ns_window() else { return };
        if ptr.is_null() {
            return;
        }
        // SAFETY: Tauri hands out the live NSWindow of this window, and we are on the main thread.
        f(unsafe { &*(ptr as *const NSWindow) });
    });
}

/// Above the menu bar (NSStatusWindowLevel = 25), on every Space and above
/// full-screen apps, out of Mission Control's cycle, no shadow, never the key
/// window. The activation policy (no Dock icon) is set in lib.rs.
pub fn make_non_activating(win: &WebviewWindow) {
    WINDOW_SCALE.store(win.scale_factor().unwrap_or(1.0).to_bits(), Ordering::Relaxed);
    let _ = win.set_focusable(false);
    with_ns_window(win, |w| {
        w.setLevel(25);
        w.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        w.setHasShadow(false);
    });
}

/// Temporarily allow the keyboard so a text field inside the island can be typed in.
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    let _ = win.set_focusable(activating);
}

/// Click-through here is the poll's set_ignore_cursor_events, not a region.
pub fn set_input_region(_win: &WebviewWindow, _rect: Option<(f64, f64, f64, f64)>) {}

/// The cursor poll already parks itself with the island (island.rs): nothing to do.
pub fn set_pointer_watch(_active: bool) {}

/// Tauri places a window on the right display; all we keep is its scale.
pub fn pin_to_monitor(win: &WebviewWindow, _x: i32, _y: i32) {
    WINDOW_SCALE.store(win.scale_factor().unwrap_or(1.0).to_bits(), Ordering::Relaxed);
}

/// The island sits at the very top of the screen: nothing to make room for.
pub fn top_inset(_win: &WebviewWindow, _x: i32, _y: i32) -> i32 {
    0
}

/// Nothing to unblock: WKWebView takes drops through Tauri.
pub fn unblock_webview_drops(_app: &AppHandle) {}

// ── Shortcuts ─────────────────────────────────────────────────────────────────

/// macOS lets the app register global shortcuts (Carbon hot keys).
pub fn global_shortcuts_blocked() -> Option<&'static str> {
    None
}

/// Option+key types a character on many Mac layouts, but Ctrl+Option does not;
/// Tobi's defaults use Cmd or Ctrl, so nothing is held back.
pub fn ctrl_alt_types(_vk: u16, _shift: bool) -> Option<String> {
    None
}

// ── Desktop Tobi window ──────────────────────────────────────────────────────

/// Placed anywhere and polled, exactly like Windows.
pub fn desktop_mode() -> super::DesktopMode {
    super::DesktopMode::Poll
}

pub fn prepare_desktop_window(win: &WebviewWindow, _mode: super::DesktopMode) -> bool {
    make_non_activating(win);
    true
}

pub fn set_desktop_shape(_win: &WebviewWindow, _shape: super::MouseShape) {}

pub fn set_layer_margins(_win: &WebviewWindow, _x: f64, _y: f64) {}

pub fn set_layer_overlay(_win: &WebviewWindow, _on: bool) {}

pub fn layer_display(_island: &WebviewWindow, _tobi: &WebviewWindow) -> Option<(f64, f64)> {
    None
}
