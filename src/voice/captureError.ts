import { platform, type DesktopPlatform } from "../native/platform";

/** Where the user actually grants microphone access, per desktop. */
function permissionHint(p: DesktopPlatform): string {
  switch (p) {
    case "macos":
      return "macOS не разрешила доступ к микрофону. Откройте «Системные настройки → Конфиденциальность и безопасность → Микрофон» и включите Arvela.";
    case "windows":
      return "Windows не разрешила доступ к микрофону. Откройте «Параметры → Конфиденциальность и защита → Микрофон» и включите доступ для приложений.";
    case "linux":
      return "Система не разрешила доступ к микрофону. Проверьте разрешение портала (xdg-desktop-portal) и устройство ввода в настройках звука.";
    default:
      return "Система не разрешила доступ к микрофону. Проверьте настройки конфиденциальности и устройство ввода.";
  }
}

function soundSettingsHint(p: DesktopPlatform): string {
  return p === "macos"
    ? "настройках звука macOS"
    : p === "windows"
      ? "параметрах звука Windows"
      : "настройках звука системы";
}

/**
 * The WebView exposes no capture API at all. On macOS that is almost always a
 * missing TCC grant for the bundle; on GTK/WebKit it is usually a missing portal
 * or an insecure origin, so the hint must not name the wrong operating system.
 */
export function micUnavailableMessage(
  host: DesktopPlatform = platform(),
): string {
  const where =
    host === "macos"
      ? "Проверьте разрешение микрофона для Arvela в системных настройках."
      : host === "windows"
        ? "Проверьте доступ к микрофону для приложений в параметрах Windows."
        : "Проверьте, что установлен и запущен xdg-desktop-portal и микрофон доступен системе.";
  return `Микрофон недоступен в этом окне приложения. ${where}`;
}

/** Capture failures are local; they must not be confused with ASR API errors. */
export function captureErrorMessage(
  error: unknown,
  host: DesktopPlatform = platform(),
): string {
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return `${permissionHint(host)} Если доступ уже включён, перезапустите приложение; если ошибка повторится — установите последнюю версию Arvela.`;
    case "NotFoundError":
    case "DevicesNotFoundError":
      return `Микрофон не найден. Подключите его или выберите устройство ввода в ${soundSettingsHint(host)}.`;
    case "NotReadableError":
    case "TrackStartError":
      return "Не удалось включить микрофон. Проверьте устройство ввода в настройках звука и не занято ли оно другим приложением, затем повторите запись.";
    case "AbortError":
      return "Запуск микрофона прерван. Попробуйте начать запись ещё раз.";
    default:
      return `Не удалось начать запись. Проверьте микрофон в ${soundSettingsHint(host)} и попробуйте ещё раз.`;
  }
}
