mod commands;
mod documents;
mod embeddings;
pub mod env;
mod neo4j;

pub use commands::*;

pub fn load_runtime_env() {
    env::load_dotenv();
}
