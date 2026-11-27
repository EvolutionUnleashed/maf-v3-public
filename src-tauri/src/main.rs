#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    error::Error,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{
    Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    webview::NewWindowResponse,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "windows")]
use std::os::windows::{io::AsRawHandle, process::CommandExt};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    },
};

const BACKEND_LOG: &str = "backend.log";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const DIAGNOSTIC_LOG_BYTES: u64 = 256 * 1024;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(45);
const HEALTH_IO_TIMEOUT: Duration = Duration::from_millis(750);
const HEALTH_RESPONSE_LIMIT: usize = 4 * 1024;
const MAX_PORT_ATTEMPTS: usize = 5;
const RUNTIME_MANIFEST: &str = "desktop-runtime-manifest.json";
const NODE_VERSION: &str = "24.18.0";
const NODE_ARCHIVE_SHA256: &str = "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821";
const NODE_SOURCE: &str = "https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip";

type HmacSha256 = Hmac<Sha256>;

struct BackendState(Mutex<Option<BackendProcess>>);

/// Owns the private backend and, on Windows, the kill-on-close Job Object that
/// contains it. Windows closes the job handle even if this shell crashes, so a
/// hidden Node process cannot be left running after the desktop app is gone.
struct BackendProcess {
    child: Child,
    #[cfg(target_os = "windows")]
    _job: KillOnCloseJob,
}

impl BackendProcess {
    fn spawn(command: &mut Command) -> Result<Self, Box<dyn Error>> {
        let mut child = command.spawn()?;

        #[cfg(target_os = "windows")]
        {
            let job = match KillOnCloseJob::attach(&child) {
                Ok(job) => job,
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            };
            Ok(Self { child, _job: job })
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(Self { child })
        }
    }

    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(target_os = "windows")]
struct KillOnCloseJob(isize);

#[cfg(target_os = "windows")]
impl KillOnCloseJob {
    fn attach(child: &Child) -> Result<Self, Box<dyn Error>> {
        // SAFETY: null attributes and name request a private Job Object. The
        // returned handle is checked and owned by KillOnCloseJob from here.
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(format!(
                "Windows could not create the private backend job: {}",
                std::io::Error::last_os_error()
            )
            .into());
        }

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `limits` has the exact layout required for
        // JobObjectExtendedLimitInformation and remains alive for this call.
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            let error = std::io::Error::last_os_error();
            // SAFETY: `job` is a live handle created above and not otherwise owned.
            unsafe { CloseHandle(job) };
            return Err(format!("Windows could not configure backend crash cleanup: {error}").into());
        }

        let process_handle = child.as_raw_handle() as HANDLE;
        // SAFETY: the process handle belongs to the live Child, and `job` is a
        // configured Job Object owned by this function.
        let assigned = unsafe { AssignProcessToJobObject(job, process_handle) };
        if assigned == 0 {
            let error = std::io::Error::last_os_error();
            // SAFETY: `job` is a live handle created above and not otherwise owned.
            unsafe { CloseHandle(job) };
            return Err(format!("Windows could not contain the private backend process: {error}").into());
        }

        Ok(Self(job as isize))
    }
}

#[cfg(target_os = "windows")]
impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        // SAFETY: this value exclusively owns the Job Object handle. Closing
        // it invokes JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE for any live backend.
        unsafe { CloseHandle(self.0 as HANDLE) };
    }
}

#[derive(Clone)]
struct DesktopPaths {
    data_dir: PathBuf,
    log_path: PathBuf,
    runtime_manifest: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeManifest {
    schema_version: u32,
    application: ApplicationRuntimeManifest,
    node: NodeRuntimeManifest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplicationRuntimeManifest {
    name: String,
    version: String,
    tree: TreeManifest,
    entry_sha256: String,
    lockfile_sha256: String,
    third_party_notices_sha256: String,
    native_addon: NativeAddonManifest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TreeManifest {
    sha256: String,
    file_count: u64,
    total_bytes: u64,
    max_relative_path_length: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeAddonManifest {
    path: String,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NodeRuntimeManifest {
    version: String,
    platform: String,
    source: String,
    archive_sha256: String,
    executable_sha256: String,
    license_sha256: String,
    npm_bundled: bool,
}

fn hex_digest(bytes: impl AsRef<[u8]>) -> String {
    let mut output = String::with_capacity(bytes.as_ref().len() * 2);
    for byte in bytes.as_ref() {
        use std::fmt::Write as _;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn sha256_bytes(bytes: &[u8]) -> String {
    hex_digest(Sha256::digest(bytes))
}

fn sha256_file(path: &Path) -> Result<String, Box<dyn Error>> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hex_digest(hash.finalize()))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn safe_runtime_path(root: &Path, relative: &str) -> Result<PathBuf, Box<dyn Error>> {
    let relative_path = Path::new(relative);
    if relative_path.as_os_str().is_empty()
        || !relative_path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(format!("Runtime manifest contains an unsafe path: {relative}").into());
    }
    Ok(root.join(relative_path))
}

fn hash_runtime_tree(
    root: &Path,
    current: &Path,
    aggregate: &mut Sha256,
    file_count: &mut u64,
    total_bytes: &mut u64,
    max_relative_path_length: &mut u64,
) -> Result<(), Box<dyn Error>> {
    let entries = fs::read_dir(current)?.collect::<Result<Vec<_>, _>>()?;
    let mut entries = entries
        .into_iter()
        .map(|entry| -> Result<_, Box<dyn Error>> {
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| -> Box<dyn Error> {
                    "Runtime contains a non-Unicode filename".into()
                })?;
            Ok((name, entry))
        })
        .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
    entries.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));

    for (_name, entry) in entries {
        let path = entry.path();
        let relative = path.strip_prefix(root)?;
        let relative = relative
            .to_str()
            .ok_or("Runtime contains a non-Unicode filename")?
            .replace('\\', "/");
        if relative == RUNTIME_MANIFEST {
            continue;
        }
        *max_relative_path_length = (*max_relative_path_length).max(relative.encode_utf16().count() as u64);

        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            return Err(format!("Runtime contains a forbidden symbolic link: {relative}").into());
        }
        if metadata.is_dir() {
            hash_runtime_tree(
                root,
                &path,
                aggregate,
                file_count,
                total_bytes,
                max_relative_path_length,
            )?;
        } else if metadata.is_file() {
            let digest = sha256_file(&path)?;
            let record = format!("{relative}\0file\0{}\0{digest}\n", metadata.len());
            aggregate.update(record.as_bytes());
            *file_count += 1;
            *total_bytes += metadata.len();
        } else {
            return Err(format!("Runtime contains an unsupported filesystem entry: {relative}").into());
        }
    }
    Ok(())
}

fn verify_runtime(
    app_runtime: &Path,
    node_path: &Path,
    manifest_path: &Path,
) -> Result<(), Box<dyn Error>> {
    let manifest_bytes = fs::read(manifest_path)?;
    let actual_manifest_hash = sha256_bytes(&manifest_bytes);
    let embedded_manifest_hash = env!("MAF_RUNTIME_MANIFEST_SHA256");
    if actual_manifest_hash != embedded_manifest_hash {
        return Err("The installed runtime manifest does not match this desktop application build.".into());
    }

    let manifest: RuntimeManifest = serde_json::from_slice(&manifest_bytes)?;
    if manifest.schema_version != 2
        || manifest.application.name != "maf-v3"
        || manifest.application.version != env!("CARGO_PKG_VERSION")
    {
        return Err("The installed application runtime has incompatible identity metadata.".into());
    }
    if manifest.node.version != NODE_VERSION
        || manifest.node.platform != "win-x64"
        || manifest.node.source != NODE_SOURCE
        || manifest.node.archive_sha256 != NODE_ARCHIVE_SHA256
        || manifest.node.npm_bundled
    {
        return Err("The installed Node.js runtime metadata is not approved.".into());
    }
    for hash in [
        manifest.application.entry_sha256.as_str(),
        manifest.application.lockfile_sha256.as_str(),
        manifest.application.third_party_notices_sha256.as_str(),
        manifest.application.tree.sha256.as_str(),
        manifest.application.native_addon.sha256.as_str(),
        manifest.node.executable_sha256.as_str(),
        manifest.node.license_sha256.as_str(),
    ] {
        if !is_sha256(hash) {
            return Err("The installed runtime manifest contains an invalid SHA-256 value.".into());
        }
    }

    if sha256_file(node_path)? != manifest.node.executable_sha256 {
        return Err("The bundled Node.js executable was changed after the desktop application was built.".into());
    }
    let node_license = node_path
        .parent()
        .ok_or("The bundled Node.js runtime directory is invalid.")?
        .join("LICENSE.node.txt");
    if sha256_file(&node_license)? != manifest.node.license_sha256 {
        return Err("The bundled Node.js license was changed after the desktop application was built.".into());
    }
    let entry = app_runtime.join("dist/index.js");
    if sha256_file(&entry)? != manifest.application.entry_sha256 {
        return Err("The bundled MAF V3 server entry point was changed after build.".into());
    }
    let third_party_notices = app_runtime.join("THIRD-PARTY-NOTICES.txt");
    if sha256_file(&third_party_notices)? != manifest.application.third_party_notices_sha256 {
        return Err("The bundled third-party notices were changed after build.".into());
    }
    let native_addon = safe_runtime_path(app_runtime, &manifest.application.native_addon.path)?;
    if sha256_file(&native_addon)? != manifest.application.native_addon.sha256 {
        return Err("The bundled SQLite native module was changed after build.".into());
    }

    let mut tree_hash = Sha256::new();
    let mut file_count = 0_u64;
    let mut total_bytes = 0_u64;
    let mut max_relative_path_length = 0_u64;
    hash_runtime_tree(
        app_runtime,
        app_runtime,
        &mut tree_hash,
        &mut file_count,
        &mut total_bytes,
        &mut max_relative_path_length,
    )?;
    if hex_digest(tree_hash.finalize()) != manifest.application.tree.sha256
        || file_count != manifest.application.tree.file_count
        || total_bytes != manifest.application.tree.total_bytes
        || max_relative_path_length != manifest.application.tree.max_relative_path_length
    {
        return Err("The installed application runtime failed its integrity check.".into());
    }
    Ok(())
}

fn random_token() -> Result<String, Box<dyn Error>> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)?;
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}")?;
    }
    Ok(output)
}

fn reserve_loopback_port() -> Result<u16, Box<dyn Error>> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn rotate_backend_log(log_path: &Path) -> Result<(), Box<dyn Error>> {
    let Ok(metadata) = fs::metadata(log_path) else {
        return Ok(());
    };
    if metadata.len() <= MAX_LOG_BYTES {
        return Ok(());
    }

    let archived = log_path.with_file_name("backend.previous.log");
    if archived.exists() {
        fs::remove_file(&archived)?;
    }
    fs::rename(log_path, archived)?;
    Ok(())
}

fn open_backend_log(log_path: &Path) -> Result<File, Box<dyn Error>> {
    rotate_backend_log(log_path)?;
    Ok(OpenOptions::new().create(true).append(true).open(log_path)?)
}

fn backend_command(
    node_path: &Path,
    app_runtime: &Path,
    data_dir: &Path,
    migrations_dir: &Path,
    port: u16,
    token: &str,
) -> Command {
    // Tauri can return verbatim Windows paths (\\?\C:\...). Node's main-module
    // resolver rejects these with EISDIR on the drive prefix. Preserve the native
    // paths for integrity checks, but use equivalent ordinary paths at this process
    // boundary, including cwd and the data/migration environment variables.
    let node_path = dunce::simplified(node_path);
    let app_runtime = dunce::simplified(app_runtime);
    let data_dir = dunce::simplified(data_dir);
    let migrations_dir = dunce::simplified(migrations_dir);
    let mut command = Command::new(node_path);
    command
        .arg(app_runtime.join("dist/index.js"))
        .current_dir(app_runtime)
        .stdin(Stdio::null())
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("NAPI_RS_NATIVE_LIBRARY_PATH")
        .env_remove("ELECTRON_RUN_AS_NODE")
        .env("NODE_ENV", "production")
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("MAF_DATA_DIR", data_dir)
        .env("MAF_MIGRATIONS_DIR", migrations_dir)
        .env("MAF_DESKTOP", "1")
        .env("MAF_DESKTOP_TOKEN", token)
        .env("MAF_STRICT_PORT", "1");

    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    command
}

fn spawn_backend(
    node_path: &Path,
    app_runtime: &Path,
    data_dir: &Path,
    migrations_dir: &Path,
    log_path: &Path,
    port: u16,
    token: &str,
) -> Result<BackendProcess, Box<dyn Error>> {
    let log = open_backend_log(log_path)?;
    let stderr = log.try_clone()?;
    let mut command = backend_command(
        node_path, app_runtime, data_dir, migrations_dir, port, token,
    );
    command.stdout(Stdio::from(log)).stderr(Stdio::from(stderr));
    BackendProcess::spawn(&mut command)
}

fn health_check(port: u16, token: &str) -> bool {
    let Ok(challenge) = random_token() else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(token.as_bytes()) else {
        return false;
    };
    mac.update(challenge.as_bytes());
    let expected_proof = hex_digest(mac.finalize().into_bytes());
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) else {
        return false;
    };
    let _ = stream.set_write_timeout(Some(HEALTH_IO_TIMEOUT));
    let request = format!(
        "GET /desktop/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-MAF-Desktop-Challenge: {challenge}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    if stream.set_nonblocking(true).is_err() {
        return false;
    }
    let deadline = Instant::now() + HEALTH_IO_TIMEOUT;
    let mut response = Vec::with_capacity(512);
    let mut buffer = [0_u8; 512];
    loop {
        if Instant::now() >= deadline {
            return false;
        }
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                response.extend_from_slice(&buffer[..read]);
                if response.len() > HEALTH_RESPONSE_LIMIT {
                    return false;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return false,
        }
    }

    let response = String::from_utf8_lossy(&response);
    response.starts_with("HTTP/1.1 200")
        && match response.split_once("\r\n\r\n") {
            Some((_, body)) => body.trim() == expected_proof,
            None => false,
        }
}

fn wait_for_backend(
    process: &mut BackendProcess,
    port: u16,
    token: &str,
    deadline: Instant,
) -> Result<(), Box<dyn Error>> {
    while Instant::now() < deadline {
        if let Some(status) = process.child.try_wait()? {
            return Err(format!("The local service stopped during startup ({status}).").into());
        }
        if health_check(port, token) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(120));
    }

    process.stop();
    Err("The local service did not become ready within 45 seconds.".into())
}

fn launch_backend(
    paths: &DesktopPaths,
    resource_dir: &Path,
    token: &str,
) -> Result<(BackendProcess, u16), Box<dyn Error>> {
    let app_runtime = resource_dir.join("runtime/app");
    let node_path = resource_dir.join("runtime/node/node.exe");
    let migrations_dir = app_runtime.join("drizzle");

    for required in [
        node_path.clone(),
        app_runtime.join("dist/index.js"),
        migrations_dir.join("meta/_journal.json"),
        paths.runtime_manifest.clone(),
    ] {
        if !required.is_file() {
            return Err(format!("A required bundled application resource is missing: {}", required.display()).into());
        }
    }
    verify_runtime(&app_runtime, &node_path, &paths.runtime_manifest)?;

    let deadline = Instant::now() + STARTUP_TIMEOUT;
    let mut last_error = "No loopback port was attempted.".to_string();
    let mut attempts = 0;
    for attempt in 1..=MAX_PORT_ATTEMPTS {
        if Instant::now() >= deadline {
            break;
        }
        attempts = attempt;
        let port = reserve_loopback_port()?;
        let mut process = spawn_backend(
            &node_path,
            &app_runtime,
            &paths.data_dir,
            &migrations_dir,
            &paths.log_path,
            port,
            token,
        )?;
        match wait_for_backend(&mut process, port, token, deadline) {
            Ok(()) => return Ok((process, port)),
            Err(error) => {
                last_error = format!("Attempt {attempt} on port {port}: {error}");
            }
        }
    }
    Err(format!(
        "The private local service could not claim a safe loopback port after {attempts} attempt(s). {last_error}"
    )
    .into())
}

fn is_loopback_origin(url: &tauri::Url, port: u16) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port_or_known_default() == Some(port)
        && url.username().is_empty()
        && url.password().is_none()
}

fn is_safe_external_https_url(url: &tauri::Url) -> bool {
    if url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }

    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    if host.parse::<IpAddr>().is_ok() || !host.contains('.') {
        return false;
    }
    ![
        ".localhost",
        ".local",
        ".internal",
        ".lan",
        ".home",
        ".test",
        ".invalid",
        ".example",
    ]
    .iter()
    .any(|suffix| host == &suffix[1..] || host.ends_with(suffix))
}

fn bootstrap_url(port: u16, token: &str, first_route: &str) -> Result<tauri::Url, Box<dyn Error>> {
    let mut url: tauri::Url = format!("http://127.0.0.1:{port}/desktop/bootstrap").parse()?;
    url.query_pairs_mut()
        .append_pair("token", token)
        .append_pair("next", first_route);
    Ok(url)
}

fn read_log_tail(path: &Path) -> String {
    let Ok(mut file) = File::open(path) else {
        return "(No backend log is available.)".to_string();
    };
    let length = file.metadata().map(|item| item.len()).unwrap_or_default();
    if length > DIAGNOSTIC_LOG_BYTES {
        use std::io::{Seek, SeekFrom};
        let _ = file.seek(SeekFrom::Start(length - DIAGNOSTIC_LOG_BYTES));
    }
    let mut bytes = Vec::new();
    let _ = file.read_to_end(&mut bytes);
    let text = String::from_utf8_lossy(&bytes);
    text.lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if [
                "api_key",
                "api-key",
                "api key",
                "apikey",
                "authorization",
                "bearer ",
                "cookie",
                "key=",
                "secret",
                "token=",
                "sk-",
                "tvly-",
                "aiza",
            ]
            .iter()
            .any(|marker| lower.contains(marker))
            {
                "[redacted sensitive log line]"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn diagnostics_report(app: &tauri::AppHandle, paths: &DesktopPaths) -> String {
    let manifest = fs::read_to_string(&paths.runtime_manifest)
        .unwrap_or_else(|_| "(Runtime manifest could not be read.)".to_string());
    let generated = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|item| item.as_secs())
        .unwrap_or_default();
    format!(
        "MAF V3 diagnostics\nGenerated (Unix time): {generated}\nApp version: {}\nOperating system: {} {}\nData folder: {}\n\nRuntime manifest\n----------------\n{}\n\nSanitized backend log (last 256 KiB)\n------------------------------------\n{}\n",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH,
        paths.data_dir.display(),
        manifest,
        read_log_tail(&paths.log_path),
    )
}

fn show_message(app: &tauri::AppHandle, message: impl Into<String>, kind: MessageDialogKind) {
    app.dialog()
        .message(message)
        .title("MAF V3")
        .kind(kind)
        .show(|_| {});
}

fn export_diagnostics(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    let paths = app.state::<DesktopPaths>().inner().clone();
    let file_name = format!(
        "MAF-V3-diagnostics-{}.txt",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|item| item.as_secs())
            .unwrap_or_default()
    );
    app.dialog()
        .file()
        .set_title("Export MAF V3 diagnostics")
        .set_file_name(file_name)
        .add_filter("Text document", &["txt"])
        .save_file(move |selection| {
            let Some(selection) = selection else {
                return;
            };
            let Ok(destination) = selection.into_path() else {
                show_message(&app_handle, "That destination cannot be used.", MessageDialogKind::Error);
                return;
            };
            match fs::write(&destination, diagnostics_report(&app_handle, &paths)) {
                Ok(()) => show_message(
                    &app_handle,
                    format!("Diagnostics saved to:\n{}", destination.display()),
                    MessageDialogKind::Info,
                ),
                Err(error) => show_message(
                    &app_handle,
                    format!("Diagnostics could not be saved:\n{error}"),
                    MessageDialogKind::Error,
                ),
            }
        });
}

fn stop_backend(app: &tauri::AppHandle) {
    let state = app.state::<BackendState>();
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut process) = guard.take() {
            process.stop();
        }
    }
}

fn startup_failure(app: &tauri::AppHandle, paths: &DesktopPaths, detail: impl AsRef<str>) {
    if let Some(startup) = app.get_webview_window("startup") {
        let _ = startup.close();
    }
    let exit_handle = app.clone();
    let message = format!(
        "MAF V3 could not start its private local service.\n\n{}\n\nA support log is available at:\n{}",
        detail.as_ref(),
        paths.log_path.display()
    );
    app.dialog()
        .message(message)
        .title("MAF V3 could not start")
        .kind(MessageDialogKind::Error)
        .show(move |_| exit_handle.exit(1));
}

fn open_main_window(
    app: &tauri::AppHandle,
    data_dir: &Path,
    webview_data_dir: PathBuf,
    token: &str,
    process: BackendProcess,
    port: u16,
) -> Result<(), String> {
    let first_route = if data_dir.join("integrations.enc.json").is_file() {
        "/setup?desktop=1"
    } else {
        "/settings/integrations?desktop=1&firstRun=1"
    };
    let url = bootstrap_url(port, token, first_route).map_err(|error| error.to_string())?;
    let navigation_handle = app.clone();
    let popup_handle = app.clone();

    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("MAF V3")
        .inner_size(1280.0, 850.0)
        .min_inner_size(800.0, 600.0)
        .center()
        .data_directory(webview_data_dir)
        .devtools(false)
        .zoom_hotkeys_enabled(false)
        .on_navigation(move |url| {
            if is_loopback_origin(url, port) {
                return true;
            }
            if is_safe_external_https_url(url) {
                let _ = navigation_handle.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .on_new_window(move |url, _features| {
            if is_safe_external_https_url(&url) {
                let _ = popup_handle.opener().open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .build()
        .map_err(|error| format!("The application window could not be created: {error}"))?;

    let state = app.state::<BackendState>();
    let mut backend = state
        .0
        .lock()
        .map_err(|_| "The private backend state is unavailable.".to_string())?;
    *backend = Some(process);
    if let Some(startup) = app.get_webview_window("startup") {
        let _ = startup.close();
    }
    Ok(())
}

fn setup_desktop(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
    let resource_dir = app.path().resource_dir()?;
    let data_dir = app.path().app_local_data_dir()?;
    fs::create_dir_all(&data_dir)?;
    let webview_data_dir = data_dir.join("webview");
    fs::create_dir_all(&webview_data_dir)?;

    let paths = DesktopPaths {
        data_dir: data_dir.clone(),
        log_path: data_dir.join(BACKEND_LOG),
        runtime_manifest: resource_dir.join("runtime/app/desktop-runtime-manifest.json"),
    };
    app.manage(paths.clone());

    let startup_result = WebviewWindowBuilder::new(
        app,
        "startup",
        WebviewUrl::App("startup.html".into()),
    )
    .title("Starting MAF V3")
    .inner_size(520.0, 320.0)
    .resizable(false)
    .maximizable(false)
    .center()
    .data_directory(webview_data_dir.clone())
    .disable_javascript()
    .devtools(false)
    .zoom_hotkeys_enabled(false)
    .build();
    if let Err(error) = startup_result {
        let handle = app.handle().clone();
        let exit_handle = handle.clone();
        handle
            .dialog()
            .message(format!(
                "MAF V3 could not create its startup window.\n\n{error}"
            ))
            .title("MAF V3 could not start")
            .kind(MessageDialogKind::Error)
            .show(move |_| exit_handle.exit(1));
        return Ok(());
    }

    let token = random_token()?;
    let handle = app.handle().clone();
    thread::spawn(move || match launch_backend(&paths, &resource_dir, &token) {
        Ok((process, port)) => {
            if let Err(error) = open_main_window(
                &handle,
                &data_dir,
                webview_data_dir,
                &token,
                process,
                port,
            ) {
                startup_failure(&handle, &paths, error);
            }
        }
        Err(error) => startup_failure(&handle, &paths, error.to_string()),
    });
    Ok(())
}

fn main() {
    let builder = tauri::Builder::default()
        .manage(BackendState(Mutex::new(None)))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app
                .get_webview_window("main")
                .or_else(|| app.get_webview_window("startup"))
            {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .menu(|app| {
            let export = MenuItem::with_id(
                app,
                "export-diagnostics",
                "Export diagnostics...",
                true,
                Some("Ctrl+Shift+D"),
            )?;
            let reveal = MenuItem::with_id(
                app,
                "reveal-data",
                "Open data folder",
                true,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = PredefinedMenuItem::quit(app, None)?;
            let file = Submenu::with_items(
                app,
                "File",
                true,
                &[&export, &reveal, &separator, &quit],
            )?;
            Menu::with_items(app, &[&file])
        })
        .on_menu_event(|app, event| {
            if event.id() == "export-diagnostics" {
                export_diagnostics(app);
            } else if event.id() == "reveal-data" {
                let paths = app.state::<DesktopPaths>();
                if let Err(error) = app.opener().reveal_item_in_dir(&paths.data_dir) {
                    show_message(
                        app,
                        format!("The data folder could not be opened:\n{error}"),
                        MessageDialogKind::Error,
                    );
                }
            }
        })
        .setup(setup_desktop);

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build the MAF V3 desktop application");
    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            stop_backend(app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn backend_process_boundary_uses_node_compatible_windows_paths() {
        let command = backend_command(
            Path::new(r"\\?\C:\Users\Test User\MAF V3\runtime\node\node.exe"),
            Path::new(r"\\?\C:\Users\Test User\MAF V3\runtime\app"),
            Path::new(r"\\?\C:\Users\Test User\MAF Data"),
            Path::new(r"\\?\C:\Users\Test User\MAF V3\runtime\app\drizzle"),
            43210,
            "test-token",
        );
        assert_eq!(command.get_program(), r"C:\Users\Test User\MAF V3\runtime\node\node.exe");
        assert_eq!(command.get_current_dir(), Some(Path::new(r"C:\Users\Test User\MAF V3\runtime\app")));
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args.len(), 1);
        assert_eq!(Path::new(args[0]), Path::new(r"C:\Users\Test User\MAF V3\runtime\app\dist\index.js"));
        let environment: std::collections::BTreeMap<_, _> = command.get_envs().collect();
        for (name, expected) in [
            ("MAF_DATA_DIR", r"C:\Users\Test User\MAF Data"),
            ("MAF_MIGRATIONS_DIR", r"C:\Users\Test User\MAF V3\runtime\app\drizzle"),
            ("HOST", "127.0.0.1"),
            ("PORT", "43210"),
        ] {
            assert_eq!(environment.get(std::ffi::OsStr::new(name)), Some(&Some(std::ffi::OsStr::new(expected))));
        }
        for name in ["NODE_OPTIONS", "NODE_PATH", "NAPI_RS_NATIVE_LIBRARY_PATH", "ELECTRON_RUN_AS_NODE"] {
            assert_eq!(environment.get(std::ffi::OsStr::new(name)), Some(&None));
        }
    }

    #[test]
    fn runtime_tree_digest_matches_cross_language_contract() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "maf-v3-tree-digest-{}-{unique}",
            std::process::id()
        ));
        let files = [
            (".bin/tool", "one"),
            ("@scope/pkg", "two"),
            ("Zed", "three"),
            ("_foo", "four"),
            ("alpha", "five"),
        ];

        for (relative, contents) in files {
            let destination = root.join(relative);
            fs::create_dir_all(destination.parent().expect("fixture path has a parent"))
                .expect("fixture directory should be created");
            fs::write(destination, contents).expect("fixture file should be written");
        }

        let mut aggregate = Sha256::new();
        let mut file_count = 0;
        let mut total_bytes = 0;
        let mut max_relative_path_length = 0;
        let result = hash_runtime_tree(
            &root,
            &root,
            &mut aggregate,
            &mut file_count,
            &mut total_bytes,
            &mut max_relative_path_length,
        );
        let _ = fs::remove_dir_all(&root);
        result.expect("fixture tree should hash successfully");

        assert_eq!(
            hex_digest(aggregate.finalize()),
            "35643da7c6b3a20b4715d3908f25d6fa02398556d354b4c2d6f8661dc16e7851"
        );
        assert_eq!(file_count, 5);
        assert_eq!(total_bytes, 19);
        assert_eq!(max_relative_path_length, 10);
    }
}
