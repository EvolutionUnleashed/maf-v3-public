use std::{env, fs, path::PathBuf};

use sha2::{Digest, Sha256};

fn main() {
    let manifest_path = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"))
        .join("../desktop/runtime/app/desktop-runtime-manifest.json");
    println!("cargo:rerun-if-changed={}", manifest_path.display());
    let manifest = fs::read(&manifest_path).unwrap_or_else(|error| {
        panic!(
            "desktop runtime manifest is missing or unreadable at {}: {error}. Run the reviewed desktop preparation first.",
            manifest_path.display()
        )
    });
    let digest = Sha256::digest(manifest);
    println!("cargo:rustc-env=MAF_RUNTIME_MANIFEST_SHA256={digest:x}");
    tauri_build::build()
}
