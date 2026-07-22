use tauri::{AppHandle, Emitter, Manager};

/// Listens for macOS system sleep and screen lock notifications,
/// emitting "system-sleep" to the frontend so the vault can auto-lock.
pub fn listen_for_sleep(app: AppHandle) {
    use std::ffi::c_void;
    use std::ptr;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRunLoopGetCurrent() -> *mut c_void;
        fn CFRunLoopRun();
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IORegisterForSystemPower(
            refcon: *mut c_void,
            notify_port_ref: *mut *mut c_void,
            callback: extern "C" fn(*mut c_void, u32, u32, *mut c_void),
            notifier: *mut *mut c_void,
        ) -> u32;
        fn IONotificationPortGetRunLoopSource(notify_port: *mut c_void) -> *mut c_void;
        fn CFRunLoopAddSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
        fn IOAllowPowerChange(kernel_port: u32, notification_id: isize) -> i32;
    }

    extern "C" {
        static kCFRunLoopDefaultMode: *const c_void;
    }

    const K_IOPMESSAGE_SYSTEM_WILL_SLEEP: u32 = 0xe0000280;
    const K_IOPMESSAGE_CAN_SYSTEM_SLEEP: u32 = 0xe0000270;

    struct Context {
        app: AppHandle,
        root_port: u32,
    }

    extern "C" fn power_callback(
        refcon: *mut c_void,
        _service: u32,
        message_type: u32,
        message_argument: *mut c_void,
    ) {
        unsafe {
            let ctx = &*(refcon as *const Context);
            match message_type {
                K_IOPMESSAGE_SYSTEM_WILL_SLEEP => {
                    if let Some(window) = ctx.app.get_webview_window("main") {
                        let _ = window.emit("system-sleep", ());
                    }
                    IOAllowPowerChange(ctx.root_port, message_argument as isize);
                }
                K_IOPMESSAGE_CAN_SYSTEM_SLEEP => {
                    IOAllowPowerChange(ctx.root_port, message_argument as isize);
                }
                _ => {}
            }
        }
    }

    unsafe {
        let ctx = Box::new(Context {
            app,
            root_port: 0,
        });
        let ctx_ptr = Box::into_raw(ctx);

        let mut notify_port: *mut c_void = ptr::null_mut();
        let mut notifier: *mut c_void = ptr::null_mut();

        let root_port = IORegisterForSystemPower(
            ctx_ptr as *mut c_void,
            &mut notify_port,
            power_callback,
            &mut notifier,
        );

        if root_port == 0 {
            let _ = Box::from_raw(ctx_ptr);
            return;
        }

        (*ctx_ptr).root_port = root_port;

        let source = IONotificationPortGetRunLoopSource(notify_port);
        let rl = CFRunLoopGetCurrent();
        CFRunLoopAddSource(rl, source, kCFRunLoopDefaultMode);
        CFRunLoopRun();
    }
}
