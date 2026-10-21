//! AppKit must finish leaving a fullscreen Space before hiding. Hiding an
//! NSWindow or even NSApplication during that transition can strand a black Space.
use block2::RcBlock;
use objc2::{
    rc::Retained,
    runtime::{AnyObject, ProtocolObject},
};
use objc2_app_kit::{NSWindow, NSWindowDidExitFullScreenNotification};
use objc2_foundation::{NSNotificationCenter, NSObjectProtocol};
use std::{
    cell::RefCell,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::Manager;

thread_local! {
    static PENDING: RefCell<Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>> = const { RefCell::new(None) };
}
static FULLSCREEN: AtomicBool = AtomicBool::new(false);
static WANT_HIDE: AtomicBool = AtomicBool::new(false);
fn cancel() {
    PENDING.with(|pending| {
        if let Some(observer) = pending.borrow_mut().take() {
            // The token is created by this exact notification center on the main thread.
            let token: &ProtocolObject<dyn NSObjectProtocol> = &observer;
            let object: &AnyObject = token.as_ref();
            unsafe { NSNotificationCenter::defaultCenter().removeObserver(object) };
        }
    });
}
pub fn show(app: &tauri::AppHandle) {
    // Reopen can arrive during the native animation: cancel the hide intention,
    // but retain the observer so fullscreen is restored only after exit completes.
    WANT_HIDE.store(false, Ordering::Release);
    if let Err(error) = app.show() {
        eprintln!("Cannot unhide Enki: {error}");
    }
    if !PENDING.with(|p| p.borrow().is_some()) && FULLSCREEN.swap(false, Ordering::AcqRel) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_fullscreen(true);
        }
    }
}
pub fn hide(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    if PENDING.with(|p| p.borrow().is_some()) {
        WANT_HIDE.store(true, Ordering::Release);
        return Ok(());
    }
    if !window.is_fullscreen()? {
        return app.hide();
    }
    let pointer = window.ns_window()?;
    // Tauri owns this live NSWindow. The observer is scoped to that object; no
    // guessed timers or global window notifications determine when to hide.
    let native = unsafe { &*(pointer.cast::<NSWindow>()) };
    let handle = app.clone();
    let callback = RcBlock::new(move |_| {
        cancel();
        if WANT_HIDE.swap(false, Ordering::AcqRel) {
            if let Err(error) = handle.hide() {
                eprintln!("Cannot hide Enki: {error}");
            }
        } else if FULLSCREEN.swap(false, Ordering::AcqRel) {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.set_fullscreen(true);
            }
        }
    });
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(NSWindowDidExitFullScreenNotification),
            Some(native),
            None,
            &callback,
        )
    };
    PENDING.with(|p| *p.borrow_mut() = Some(observer));
    FULLSCREEN.store(true, Ordering::Release);
    WANT_HIDE.store(true, Ordering::Release);
    if let Err(error) = window.set_fullscreen(false) {
        cancel();
        FULLSCREEN.store(false, Ordering::Release);
        WANT_HIDE.store(false, Ordering::Release);
        return Err(error);
    }
    Ok(())
}
