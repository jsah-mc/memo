use std::io::{self, Read};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut token = String::new();
    io::stdin().read_to_string(&mut token)?;
    let token = token.trim();
    if token.is_empty() {
        return Err("broker token is required on stdin".into());
    }
    keyring::Entry::new("dev.memo.desktop", "composio-broker")?.set_password(token)?;
    println!("Memo broker access was saved in the operating-system credential store.");
    Ok(())
}
