use crossterm::{
    event::{Event, EventStream, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use futures_util::StreamExt;
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};
use serde_json::{Value, json};
use std::{env, io, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::mpsc,
    task::JoinHandle,
};
use unicode_width::UnicodeWidthStr;

const ACCENT: Color = Color::Rgb(126, 156, 216);

#[derive(Clone, Debug)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Debug)]
enum UiEvent {
    Delta(String),
    Error(String),
    Done,
    Approval(String),
}

struct App {
    messages: Vec<ChatMessage>,
    composer: String,
    cursor: usize,
    status: String,
    streaming: bool,
    scroll: u16,
    follow: bool,
    should_quit: bool,
    model: String,
    request_task: Option<JoinHandle<()>>,
    pending_messages: Option<Vec<Value>>,
    approval: Option<String>,
}

impl App {
    fn new() -> Self {
        Self {
            messages: Vec::new(),
            composer: String::new(),
            cursor: 0,
            status: "Ready · enter send · /help · ctrl+c quit".into(),
            streaming: false,
            scroll: 0,
            follow: true,
            should_quit: false,
            model: env::var("MEMO_MODEL").unwrap_or_else(|_| "codex:gpt-6-sol".into()),
            request_task: None,
            pending_messages: None,
            approval: None,
        }
    }

    fn new_chat(&mut self) {
        if let Some(task) = self.request_task.take() {
            task.abort();
        }
        self.messages.clear();
        self.composer.clear();
        self.cursor = 0;
        self.streaming = false;
        self.scroll = 0;
        self.follow = true;
        self.pending_messages = None;
        self.approval = None;
        self.status = "New chat".into();
    }

    fn submit(&mut self, sender: mpsc::UnboundedSender<UiEvent>) {
        if self.streaming {
            return;
        }
        let prompt = self.composer.trim().to_owned();
        if prompt.is_empty() {
            return;
        }
        if prompt.starts_with('/') {
            self.composer.clear();
            self.cursor = 0;
            self.handle_slash_command(&prompt);
            return;
        }
        self.composer.clear();
        self.cursor = 0;
        self.messages.push(ChatMessage {
            role: "user",
            content: prompt,
        });
        self.messages.push(ChatMessage {
            role: "assistant",
            content: String::new(),
        });
        self.streaming = true;
        self.follow = true;
        self.status = "Thinking… · ctrl+c interrupt".into();
        let messages = self.messages[..self.messages.len() - 1]
            .iter()
            .map(|message| json!({"role": message.role, "content": message.content}))
            .collect::<Vec<_>>();
        self.pending_messages = Some(messages);
        self.start_request(sender, "ask");
    }

    fn notice(&mut self, content: impl Into<String>) {
        self.messages.push(ChatMessage {
            role: "assistant",
            content: content.into(),
        });
        self.follow = true;
    }

    fn handle_slash_command(&mut self, command: &str) {
        let mut parts = command.split_whitespace();
        match parts.next().unwrap_or_default() {
            "/quit" | "/exit" => self.should_quit = true,
            "/new" | "/clear" => self.new_chat(),
            "/help" => self.notice(
                "Commands:\n/help — show this list\n/new — start a fresh chat\n/model [runtime:model] — show or change the model\n/runtimes — list available runtimes\n/status — show the current model and gateway address\n/quit — exit Memo",
            ),
            "/model" => {
                if let Some(model) = parts.next() {
                    let valid = model
                        .split_once(':')
                        .is_some_and(|(runtime, model)| !model.is_empty() && crate::runtimes::runtime(runtime).is_ok());
                    if !valid || parts.next().is_some() {
                        self.notice("Usage: /model runtime:model");
                    } else {
                        self.model = model.to_owned();
                        self.status = format!("Model changed to {}", self.model);
                        self.notice(format!("Using {} for new messages.", self.model));
                    }
                } else {
                    self.notice(format!("Current model: {}", self.model));
                }
            }
            "/runtimes" => {
                let runtimes = crate::runtimes::statuses()
                    .into_iter()
                    .map(|runtime| format!(
                        "{} — {}",
                        runtime.runtime.label,
                        if runtime.installed { "installed" } else { "not installed" }
                    ))
                    .collect::<Vec<_>>()
                    .join("\n");
                self.notice(format!("Runtimes:\n{runtimes}"));
            }
            "/status" => self.notice(format!(
                "Model: {}\nMCP gateway: http://127.0.0.1:6734/mcp",
                self.model
            )),
            unknown => self.notice(format!(
                "Unknown command: {unknown}\nType /help for available commands."
            )),
        }
    }

    fn start_request(
        &mut self,
        sender: mpsc::UnboundedSender<UiEvent>,
        permission_mode: &'static str,
    ) {
        let Some(messages) = self.pending_messages.clone() else {
            return;
        };
        let model = self.model.clone();
        self.request_task = Some(tokio::spawn(async move {
            stream_chat(model, messages, permission_mode, sender).await;
        }));
    }

    fn resolve_approval(&mut self, allowed: bool, sender: mpsc::UnboundedSender<UiEvent>) {
        self.approval = None;
        if allowed {
            self.status = "Approved once · running…".into();
            self.start_request(sender, "approved");
        } else {
            self.streaming = false;
            self.request_task = None;
            self.status = "Permission denied".into();
            if self
                .messages
                .last()
                .is_some_and(|message| message.role == "assistant" && message.content.is_empty())
            {
                self.messages.pop();
            }
        }
    }

    fn interrupt(&mut self) {
        if let Some(task) = self.request_task.take() {
            task.abort();
        }
        if self.streaming {
            self.streaming = false;
            self.status = "Interrupted".into();
            if self
                .messages
                .last()
                .is_some_and(|message| message.role == "assistant" && message.content.is_empty())
            {
                self.messages.pop();
            }
        } else {
            self.should_quit = true;
        }
    }

    fn insert_char(&mut self, character: char) {
        self.composer.insert(self.cursor, character);
        self.cursor += character.len_utf8();
    }

    fn insert_newline(&mut self) {
        self.insert_char('\n');
    }

    fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let previous = self.composer[..self.cursor]
            .char_indices()
            .next_back()
            .map(|(index, _)| index)
            .unwrap_or(0);
        self.composer.replace_range(previous..self.cursor, "");
        self.cursor = previous;
    }

    fn move_left(&mut self) {
        self.cursor = self.composer[..self.cursor]
            .char_indices()
            .next_back()
            .map(|(index, _)| index)
            .unwrap_or(0);
    }

    fn move_right(&mut self) {
        if self.cursor < self.composer.len() {
            self.cursor += self.composer[self.cursor..]
                .chars()
                .next()
                .map(char::len_utf8)
                .unwrap_or(0);
        }
    }
}

pub async fn run() -> Result<(), String> {
    enable_raw_mode().map_err(|error| error.to_string())?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen).map_err(|error| error.to_string())?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).map_err(|error| error.to_string())?;
    let result = run_loop(&mut terminal).await;
    let _ = disable_raw_mode();
    let _ = execute!(terminal.backend_mut(), LeaveAlternateScreen);
    let _ = terminal.show_cursor();
    result
}

async fn run_loop(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> Result<(), String> {
    let mut app = App::new();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let mut input = EventStream::new();
    let mut tick = tokio::time::interval(Duration::from_millis(50));

    loop {
        terminal
            .draw(|frame| render(frame, &app))
            .map_err(|error| error.to_string())?;
        if app.should_quit {
            return Ok(());
        }
        tokio::select! {
            _ = tick.tick() => {}
            event = input.next() => {
                match event {
                    Some(Ok(Event::Key(key))) if key.kind == KeyEventKind::Press => {
                        handle_key(&mut app, key, sender.clone());
                    }
                    Some(Ok(Event::Resize(_, _))) => {}
                    Some(Err(error)) => return Err(error.to_string()),
                    None => return Ok(()),
                    _ => {}
                }
            }
            Some(event) = receiver.recv() => match event {
                UiEvent::Delta(delta) => {
                    if let Some(message) = app.messages.last_mut()
                        && message.role == "assistant"
                    {
                        message.content.push_str(&delta);
                    }
                    app.status = "Writing… · ctrl+c interrupt".into();
                }
                UiEvent::Error(error) => {
                    if let Some(message) = app.messages.last_mut()
                        && message.role == "assistant"
                    {
                        message.content.push_str(&format!("Error: {error}"));
                    }
                    app.streaming = false;
                    app.request_task = None;
                    app.status = "Error".into();
                }
                UiEvent::Done => {
                    app.streaming = false;
                    app.request_task = None;
                    app.status = "Ready · enter send · /help · ctrl+c quit".into();
                }
                UiEvent::Approval(command) => {
                    app.request_task = None;
                    if let Some(message) = app.messages.last_mut()
                        && message.role == "assistant"
                    {
                        message.content.clear();
                    }
                    app.approval = Some(command);
                    app.status = "Approval required".into();
                }
            }
        }
    }
}

fn handle_key(app: &mut App, key: KeyEvent, sender: mpsc::UnboundedSender<UiEvent>) {
    if app.approval.is_some() {
        match key.code {
            KeyCode::Char('y') | KeyCode::Enter => app.resolve_approval(true, sender),
            KeyCode::Char('n') | KeyCode::Esc => app.resolve_approval(false, sender),
            _ => {}
        }
        return;
    }
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        app.interrupt();
        return;
    }
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('n') {
        app.new_chat();
        return;
    }
    match key.code {
        KeyCode::Enter
            if key
                .modifiers
                .intersects(KeyModifiers::SHIFT | KeyModifiers::ALT) =>
        {
            app.insert_newline();
        }
        KeyCode::Char('j') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            app.insert_newline();
        }
        KeyCode::Enter => app.submit(sender),
        KeyCode::Char(character) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            app.insert_char(character);
        }
        KeyCode::Backspace => app.backspace(),
        KeyCode::Left => app.move_left(),
        KeyCode::Right => app.move_right(),
        KeyCode::Home => app.cursor = 0,
        KeyCode::End => app.cursor = app.composer.len(),
        KeyCode::PageUp => {
            app.follow = false;
            app.scroll = app.scroll.saturating_sub(8);
        }
        KeyCode::PageDown => {
            app.scroll = app.scroll.saturating_add(8);
            app.follow = false;
        }
        _ => {}
    }
}

fn render(frame: &mut ratatui::Frame<'_>, app: &App) {
    let area = frame.area();
    let composer_height = app.composer.lines().count().clamp(1, 5) as u16 + 2;
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2),
            Constraint::Min(4),
            Constraint::Length(composer_height),
            Constraint::Length(1),
        ])
        .split(area);
    render_header(frame, rows[0], app);
    render_transcript(frame, rows[1], app);
    render_composer(frame, rows[2], app);
    render_status(frame, rows[3], app);
    if let Some(command) = &app.approval {
        render_approval(frame, area, command);
    }
}

fn render_header(frame: &mut ratatui::Frame<'_>, area: Rect, app: &App) {
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                " Memo ",
                Style::default()
                    .fg(Color::Black)
                    .bg(ACCENT)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled(&app.model, Style::default().fg(Color::DarkGray)),
        ])),
        area,
    );
}

fn transcript_text(app: &App) -> Text<'static> {
    if app.messages.is_empty() {
        return Text::from(vec![
            Line::from(""),
            Line::styled(
                "  What would you like to work on?",
                Style::default()
                    .fg(Color::Gray)
                    .add_modifier(Modifier::BOLD),
            ),
            Line::from(""),
            Line::styled(
                "  Type a prompt below. Use /help for commands.",
                Style::default().fg(Color::DarkGray),
            ),
        ]);
    }
    let mut lines = Vec::new();
    for message in &app.messages {
        lines.push(Line::from(""));
        let (marker, color) = if message.role == "user" {
            (">", ACCENT)
        } else {
            ("•", Color::Green)
        };
        lines.push(Line::from(vec![
            Span::styled(
                format!("{marker} "),
                Style::default().fg(color).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                if message.role == "user" {
                    "You"
                } else {
                    "Memo"
                },
                Style::default().add_modifier(Modifier::BOLD),
            ),
        ]));
        if message.content.is_empty() {
            lines.push(Line::styled(
                "  Thinking…",
                Style::default().fg(Color::DarkGray),
            ));
        } else {
            lines.extend(
                message
                    .content
                    .lines()
                    .map(|line| Line::from(format!("  {line}"))),
            );
        }
    }
    Text::from(lines)
}

fn render_transcript(frame: &mut ratatui::Frame<'_>, area: Rect, app: &App) {
    let text = transcript_text(app);
    let estimated_lines = text.lines.len() as u16;
    let visible = area.height.saturating_sub(1);
    let scroll = if app.follow {
        estimated_lines.saturating_sub(visible)
    } else {
        app.scroll.min(estimated_lines.saturating_sub(visible))
    };
    frame.render_widget(
        Paragraph::new(text)
            .scroll((scroll, 0))
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn render_composer(frame: &mut ratatui::Frame<'_>, area: Rect, app: &App) {
    let title = if app.streaming {
        " Working "
    } else {
        " Message Memo "
    };
    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(if app.streaming {
            Color::DarkGray
        } else {
            ACCENT
        }));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    frame.render_widget(
        Paragraph::new(app.composer.as_str()).wrap(Wrap { trim: false }),
        inner,
    );
    if !app.streaming {
        let before = &app.composer[..app.cursor];
        let line = before
            .chars()
            .filter(|character| *character == '\n')
            .count() as u16;
        let column_text = before.rsplit('\n').next().unwrap_or("");
        let column = UnicodeWidthStr::width(column_text) as u16;
        frame.set_cursor_position((inner.x + column, inner.y + line));
    }
}

fn render_status(frame: &mut ratatui::Frame<'_>, area: Rect, app: &App) {
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                format!(" {} ", app.status),
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled(
                "  direct runtime",
                Style::default().fg(Color::Rgb(85, 85, 85)),
            ),
        ])),
        area,
    );
}

fn render_approval(frame: &mut ratatui::Frame<'_>, area: Rect, command: &str) {
    let width = area.width.saturating_sub(8).min(76);
    let height = 9.min(area.height.saturating_sub(2));
    let popup = Rect::new(
        area.x + area.width.saturating_sub(width) / 2,
        area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    );
    frame.render_widget(Clear, popup);
    let body = Text::from(vec![
        Line::styled(
            "Memo is trying to run:",
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Line::from(""),
        Line::styled(format!("\"{command}\""), Style::default().fg(Color::Yellow)),
        Line::from(""),
        Line::styled(
            "[y/enter] Allow once    [n/esc] Deny",
            Style::default().fg(Color::DarkGray),
        ),
    ]);
    frame.render_widget(
        Paragraph::new(body)
            .block(
                Block::default()
                    .title(" Approval required ")
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Yellow)),
            )
            .wrap(Wrap { trim: false }),
        popup,
    );
}

async fn stream_chat(
    model: String,
    messages: Vec<Value>,
    permission_mode: &'static str,
    sender: mpsc::UnboundedSender<UiEvent>,
) {
    let Some((runtime_id, model_id)) = model.split_once(':') else {
        let _ = sender.send(UiEvent::Error(
            "MEMO_MODEL must use runtime:model format".into(),
        ));
        return;
    };
    let runtime = match crate::runtimes::runtime(runtime_id) {
        Ok(runtime) if runtime.installed() => runtime,
        Ok(runtime) => {
            let _ = sender.send(UiEvent::Error(format!(
                "{} is not installed",
                runtime.label
            )));
            return;
        }
        Err(error) => {
            let _ = sender.send(UiEvent::Error(error));
            return;
        }
    };
    let prompt = messages
        .iter()
        .filter_map(|message| {
            let role = message.get("role")?.as_str()?;
            let content = message.get("content")?.as_str()?;
            Some(format!("{}:\n{}", role.to_ascii_uppercase(), content))
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let arguments = match runtime.chat_command_with_permissions(model_id, &prompt, permission_mode)
    {
        Ok(arguments) => arguments,
        Err(error) => {
            let _ = sender.send(UiEvent::Error(error));
            return;
        }
    };
    let mut command = Command::new(runtime.executable);
    command
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = sender.send(UiEvent::Error(format!(
                "Could not start {}: {error}",
                runtime.label
            )));
            return;
        }
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = sender.send(UiEvent::Error("Runtime stdout is unavailable".into()));
        return;
    };
    let Some(mut stderr) = child.stderr.take() else {
        let _ = sender.send(UiEvent::Error("Runtime stderr is unavailable".into()));
        return;
    };
    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text).await;
        text
    });
    let mut lines = BufReader::new(stdout).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                let _ = sender.send(UiEvent::Delta(format!("{line}\n")));
            }
            Ok(None) => break,
            Err(error) => {
                let _ = sender.send(UiEvent::Error(error.to_string()));
                return;
            }
        }
    }
    let status = match child.wait().await {
        Ok(status) => status,
        Err(error) => {
            let _ = sender.send(UiEvent::Error(error.to_string()));
            return;
        }
    };
    let stderr = stderr_task.await.unwrap_or_default();
    if !status.success() {
        if is_approval_error(&stderr) && permission_mode == "ask" {
            let _ = sender.send(UiEvent::Approval(extract_command(&stderr)));
        } else {
            let error = runtime.chat_failure_message(&stderr, Some(&status.to_string()));
            let _ = sender.send(UiEvent::Error(error));
        }
        return;
    }
    let _ = sender.send(UiEvent::Done);
}

fn is_approval_error(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    [
        "requires approval",
        "approval required",
        "approval policy is never",
        "permission denied",
        "not approved",
        "tool call rejected",
    ]
    .iter()
    .any(|pattern| message.contains(pattern))
}

fn extract_command(message: &str) -> String {
    let pattern = regex::Regex::new(r#"(?i)(?:"cmd"|\bcmd\b)\s*[:=]\s*"((?:\\.|[^"\\])*)""#)
        .expect("valid command regex");
    pattern
        .captures(message)
        .and_then(|captures| captures.get(1))
        .and_then(|value| serde_json::from_str::<String>(&format!("\"{}\"", value.as_str())).ok())
        .unwrap_or_else(|| "Memo tools for this response".into())
}

#[cfg(test)]
mod tests {
    use super::{App, extract_command, is_approval_error};

    #[test]
    fn composer_edits_unicode_safely() {
        let mut app = App::new();
        app.insert_char('a');
        app.insert_char('🦀');
        app.move_left();
        app.backspace();
        assert_eq!(app.composer, "🦀");
        assert_eq!(app.cursor, 0);
    }

    #[test]
    fn new_chat_resets_state() {
        let mut app = App::new();
        app.messages.push(super::ChatMessage {
            role: "user",
            content: "hello".into(),
        });
        app.new_chat();
        assert!(app.messages.is_empty());
        assert!(app.pending_messages.is_none());
        assert!(!app.streaming);
    }

    #[test]
    fn slash_help_lists_commands_without_starting_a_request() {
        let mut app = App::new();
        app.handle_slash_command("/help");
        assert!(app.messages.last().unwrap().content.contains("/model"));
        assert!(!app.streaming);
    }

    #[test]
    fn slash_model_changes_the_active_model() {
        let mut app = App::new();
        app.handle_slash_command("/model codex:gpt-5");
        assert_eq!(app.model, "codex:gpt-5");
    }

    #[test]
    fn extracts_detailed_command_from_approval_error() {
        let error =
            r#"tool call requires approval: run_command {"cmd":"ipconfig","target":"host"}"#;
        assert!(is_approval_error(error));
        assert_eq!(extract_command(error), "ipconfig");
    }
}
