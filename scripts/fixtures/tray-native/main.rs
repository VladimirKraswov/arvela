use tauri::Manager;
use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
#[path=__TRAY_SOURCE__]mod tray;
mod browser{pub mod monitor{pub const LABEL:&str="browser-monitor";}}
mod lifecycle{pub fn request_exit(_: &tauri::AppHandle)->bool{false}}
fn sample(app:&tauri::AppHandle,expected:bool,stage:&'static str){
 let app=app.clone();app.clone().run_on_main_thread(move||{
  let mtm=objc2::MainThreadMarker::new().unwrap();let ns=objc2_app_kit::NSApplication::sharedApplication(mtm);let hidden=ns.isHidden();println!("APPKIT active={} policy={:?}",ns.isActive(),ns.activationPolicy());
  println!("{stage} appHidden={hidden} fullscreen={} windowExists={}",app.get_webview_window("main").unwrap().is_fullscreen().unwrap(),app.get_webview_window("main").is_some());
  assert_eq!(hidden,expected);
 }).unwrap();
}
fn main(){
 tauri::Builder::default().setup(|app|{
  tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::App("index.html".into())).data_directory(std::path::PathBuf::from(std::env::var("ENKI_TRAY_FIXTURE_DATA_DIR").expect("Fixture-only data directory"))).title("Enki Tray Fixture").fullscreen(true).build()?;
  tray::setup(app.handle())?;
  let ticks=Arc::new(AtomicUsize::new(0));let count=ticks.clone();std::thread::spawn(move||loop{count.fetch_add(1,Ordering::Relaxed);std::thread::sleep(std::time::Duration::from_millis(100));});
  let handle=app.handle().clone();std::thread::spawn(move||{
   std::thread::sleep(std::time::Duration::from_secs(4));sample(&handle,false,"before-close");
   let app=handle.clone();handle.run_on_main_thread(move||app.get_webview_window("main").unwrap().close().unwrap()).unwrap();
   std::thread::sleep(std::time::Duration::from_secs(2));sample(&handle,true,"after-close");let before=ticks.load(Ordering::Relaxed);
   std::thread::sleep(std::time::Duration::from_secs(1));assert!(ticks.load(Ordering::Relaxed)>before);println!("background-worker-continued=true");
   let app=handle.clone();handle.run_on_main_thread(move||tray::show(&app)).unwrap();
   std::thread::sleep(std::time::Duration::from_secs(2));sample(&handle,false,"after-reopen");
   std::thread::sleep(std::time::Duration::from_secs(1));
   let app=handle.clone();handle.run_on_main_thread(move||{tray::close(&app);tray::close(&app);}).unwrap();
   std::thread::sleep(std::time::Duration::from_millis(50));let app=handle.clone();handle.run_on_main_thread(move||tray::show(&app)).unwrap();
   std::thread::sleep(std::time::Duration::from_secs(3));sample(&handle,false,"rapid-reopen");
   std::thread::sleep(std::time::Duration::from_secs(1));println!("TRAY_FIXTURE_PASS");handle.exit(0);
  });Ok(())
 }).invoke_handler(tauri::generate_handler![tray::runtime_quit_ready]).build(tauri::generate_context!()).unwrap().run(|app,event|{
  if let tauri::RunEvent::WindowEvent{label,event:tauri::WindowEvent::CloseRequested{api,..},..}=&event{if label=="main"{println!("CLOSE_REQUEST_RECEIVED");api.prevent_close();tray::close(app);}}
 });
}
