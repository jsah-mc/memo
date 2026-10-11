use memo::{models::ModelRouter, runtimes};
use serde_json::{Value, json};
use std::{env, process::ExitCode};

#[tokio::main]
async fn main() -> ExitCode {
    match run(env::args().skip(1).collect()).await {
        Ok(value) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&value).expect("JSON serialization")
            );
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

async fn run(arguments: Vec<String>) -> Result<Value, String> {
    match arguments.as_slice() {
        [command] if command == "runtimes" => {
            serde_json::to_value(runtimes::statuses()).map_err(|error| error.to_string())
        }
        [command, text @ ..] if command == "route" && !text.is_empty() => {
            let route = ModelRouter::default().route(&json!({"input": text.join(" ")}));
            serde_json::to_value(route).map_err(|error| error.to_string())
        }
        [command] if command == "gateway" => {
            memo::api::serve().await?;
            Ok(json!({"stopped": true}))
        }
        _ => Err("usage: memo <runtimes|route TEXT|serve>".into()),
    }
}
