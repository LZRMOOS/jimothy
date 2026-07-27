use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use notify::{Config, Event, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

#[allow(dead_code)]
enum WatcherBackend {
    #[cfg(target_os = "macos")]
    Native(notify::RecommendedWatcher),
    #[cfg(not(target_os = "macos"))]
    Poll(notify::PollWatcher),
}

pub struct FileWatcher {
    _watcher: WatcherBackend,
}

impl FileWatcher {
    pub fn new(folder: PathBuf, app_handle: AppHandle) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel();

        let backend = Self::create_watcher(&folder, tx)?;

        let handle = app_handle.clone();
        thread::spawn(move || {
            let mut debounce_timer: Option<std::time::Instant> = None;
            let mut tasks_debounce: Option<std::time::Instant> = None;

            loop {
                match rx.recv_timeout(Duration::from_millis(300)) {
                    Ok(event) => {
                        let has_tasks_file = event.paths.iter().any(|p| {
                            p.file_name().map(|n| n == "tasks.md").unwrap_or(false)
                                && p.parent().map(|d| d.file_name().map(|n| n == ".scratch").unwrap_or(false)).unwrap_or(false)
                        });
                        if has_tasks_file {
                            tasks_debounce = Some(std::time::Instant::now());
                        }
                        let dominated_by_scratch = event.paths.iter().all(|p| {
                            let s = p.to_string_lossy();
                            s.contains(".scratch") || s.contains(".scratch-tmp")
                        });
                        if dominated_by_scratch {
                            continue;
                        }
                        debounce_timer = Some(std::time::Instant::now());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if let Some(timer) = tasks_debounce.take() {
                            if timer.elapsed() >= Duration::from_millis(250) {
                                let _ = handle.emit("tasks-changed", ());
                            } else {
                                tasks_debounce = Some(timer);
                            }
                        }
                        if let Some(timer) = debounce_timer.take() {
                            if timer.elapsed() >= Duration::from_millis(250) {
                                let _ = handle.emit("notes-changed", ());
                            } else {
                                debounce_timer = Some(timer);
                            }
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Ok(FileWatcher { _watcher: backend })
    }

    #[cfg(target_os = "macos")]
    fn create_watcher(
        folder: &PathBuf,
        tx: mpsc::Sender<Event>,
    ) -> Result<WatcherBackend, String> {
        let mut watcher = notify::RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

        watcher
            .watch(folder, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch folder: {}", e))?;

        let scratch_dir = folder.join(".scratch");
        if scratch_dir.is_dir() {
            let _ = watcher.watch(&scratch_dir, RecursiveMode::NonRecursive);
        }

        Ok(WatcherBackend::Native(watcher))
    }

    #[cfg(not(target_os = "macos"))]
    fn create_watcher(
        folder: &PathBuf,
        tx: mpsc::Sender<Event>,
    ) -> Result<WatcherBackend, String> {
        let mut watcher = notify::PollWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            },
            Config::default().with_poll_interval(Duration::from_secs(2)),
        )
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

        watcher
            .watch(folder, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch folder: {}", e))?;

        let scratch_dir = folder.join(".scratch");
        if scratch_dir.is_dir() {
            let _ = watcher.watch(&scratch_dir, RecursiveMode::NonRecursive);
        }

        Ok(WatcherBackend::Poll(watcher))
    }
}
