/// Load `src-tauri/.env` at runtime (`build.rs` dotenv only runs at compile time).
pub fn load_dotenv() {
    if neo4j_env_ready() {
        return;
    }

    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let candidates = [
        format!("{manifest_dir}/.env"),
        format!("{manifest_dir}\\.env"),
        "src-tauri/.env".to_string(),
        "src-tauri\\.env".to_string(),
        ".env".to_string(),
    ];

    for path in &candidates {
        if std::path::Path::new(path).is_file() && dotenv::from_path(path).is_ok() {
            return;
        }
    }

    dotenv::dotenv().ok();
}

pub fn neo4j_env_ready() -> bool {
    env_nonempty("NEO4J_URI") && env_nonempty("NEO4J_PASSWORD")
}

fn env_nonempty(key: &str) -> bool {
    std::env::var(key)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}
