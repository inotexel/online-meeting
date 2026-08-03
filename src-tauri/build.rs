fn load_build_env() {
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let env_path = std::path::Path::new(&manifest_dir).join(".env");
        if env_path.is_file() {
            let _ = dotenv::from_path(env_path);
        }
    }
    dotenv::dotenv().ok();
}

fn bake_env(key: &str) {
    if let Ok(value) = std::env::var(key) {
        if !value.trim().is_empty() {
            println!("cargo:rustc-env={key}={value}");
        }
    }
}

fn main() {
    println!("cargo:rerun-if-changed=.env");

    load_build_env();

    for key in [
        "PAYMENT_ENDPOINT",
        "API_ACCESS_KEY",
        "APP_ENDPOINT",
        "POSTHOG_API_KEY",
        "NEO4J_URI",
        "NEO4J_USER",
        "NEO4J_PASSWORD",
        "NEO4J_DATABASE",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
    ] {
        bake_env(key);
    }

    tauri_build::build()
}
