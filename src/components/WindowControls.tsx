import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMac } from "../utils/platform";

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  // Don't render anything on macOS
  if (isMac) {
    return null;
  }

  useEffect(() => {
    const appWindow = getCurrentWindow();

    // Check initial maximize state
    appWindow.isMaximized().then(setIsMaximized);

    // Listen for window resize events to update maximize state
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleMinimize = async () => {
    await getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    await getCurrentWindow().toggleMaximize();
  };

  const handleClose = async () => {
    await getCurrentWindow().close();
  };

  return (
    <div className="window-controls">
      <button
        className="window-control-btn"
        onClick={handleMinimize}
        aria-label="Minimize"
        title="Minimize"
      >
        <svg className="window-control-icon" viewBox="0 0 10 10" fill="none" stroke="currentColor">
          <line x1="0" y1="5" x2="10" y2="5" />
        </svg>
      </button>
      <button
        className="window-control-btn"
        onClick={handleMaximize}
        aria-label={isMaximized ? "Restore" : "Maximize"}
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? (
          <svg className="window-control-icon" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="2" y="0" width="8" height="8" />
            <rect x="0" y="2" width="8" height="8" />
          </svg>
        ) : (
          <svg className="window-control-icon" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="0" y="0" width="10" height="10" />
          </svg>
        )}
      </button>
      <button
        className="window-control-btn window-control-close"
        onClick={handleClose}
        aria-label="Close"
        title="Close"
      >
        <svg className="window-control-icon" viewBox="0 0 10 10" fill="none" stroke="currentColor">
          <line x1="0" y1="0" x2="10" y2="10" />
          <line x1="10" y1="0" x2="0" y2="10" />
        </svg>
      </button>
    </div>
  );
}
