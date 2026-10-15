mod native_fingerprint;
fn main() {
    let fingerprint = native_fingerprint::fingerprint(std::path::Path::new("."))
        .expect("native compatibility fingerprint");
    println!("cargo:rustc-env=ARVELA_NATIVE_FINGERPRINT={fingerprint}");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=resources");
    println!("cargo:rerun-if-changed=native_fingerprint.rs");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=Cargo.lock");
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=updater.pub");
    tauri_build::build()
}
