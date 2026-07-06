/// Runtime `.env` (dev) + compile-time baked values from `build.rs` (MSI installs).
use std::sync::Once;

static DOTENV_LOADED: Once = Once::new();

pub fn load_dotenv() {
    DOTENV_LOADED.call_once(|| {
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
    });
}

fn resolve(key: &str, baked: Option<&str>) -> Option<String> {
    std::env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            baked
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.to_string())
        })
}

pub fn neo4j_uri() -> Option<String> {
    resolve("NEO4J_URI", option_env!("NEO4J_URI"))
}

pub fn neo4j_user() -> Option<String> {
    resolve("NEO4J_USER", option_env!("NEO4J_USER")).or_else(|| Some("neo4j".to_string()))
}

pub fn neo4j_password() -> Option<String> {
    resolve("NEO4J_PASSWORD", option_env!("NEO4J_PASSWORD"))
}

pub fn neo4j_database() -> Option<String> {
    resolve("NEO4J_DATABASE", option_env!("NEO4J_DATABASE")).or_else(|| Some("neo4j".to_string()))
}

pub fn google_client_id() -> Option<String> {
    resolve("GOOGLE_CLIENT_ID", option_env!("GOOGLE_CLIENT_ID"))
}

pub fn google_client_secret() -> Option<String> {
    resolve("GOOGLE_CLIENT_SECRET", option_env!("GOOGLE_CLIENT_SECRET"))
}

pub fn neo4j_env_ready() -> bool {
    neo4j_uri().is_some() && neo4j_password().is_some()
}

pub fn google_oauth_ready() -> bool {
    google_client_id().is_some()
}
