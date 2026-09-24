/** Capture failures are local; they must not be confused with ASR API errors. */
export function captureErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error
    ? String(error.name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "macOS не разрешила доступ к микрофону. Откройте «Системные настройки → Конфиденциальность и безопасность → Микрофон» и включите OpenCode Desktop. Если доступ уже включён, перезапустите приложение; если ошибка повторится — установите последнюю версию OpenCode Desktop.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Микрофон не найден. Подключите его или выберите устройство ввода в «Системные настройки → Звук».";
    case "NotReadableError":
    case "TrackStartError":
      return "Не удалось включить микрофон. Проверьте устройство ввода в настройках звука и не занято ли оно другим приложением, затем повторите запись.";
    case "AbortError":
      return "Запуск микрофона прерван. Попробуйте начать запись ещё раз.";
    default:
      return "Не удалось начать запись. Проверьте микрофон в настройках звука macOS и попробуйте ещё раз.";
  }
}
