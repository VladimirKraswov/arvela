# Windows 0.2.16: импорт результата и проверка происхождения

Дата импорта на Mac: 2026-10-05. Полученный от владельца архив
`OpenCode-Desktop-0.2.16-Windows-result.zip` содержит установщик, отчёт,
десять логов, Git bundle и `NO-SOURCE-CHANGES.txt`. Нового кода и патчей нет.
Bundle прошёл `git bundle verify`, содержит только main с HEAD
`2def38234eb4e06a6cf1f39d2e30edb4aed01703`; SHA256 полностью совпадает
с отправленным bundle. Исходники Windows не требуют слияния: это уже наш main.

## Независимо проверено на Mac

- CRC всех файлов ZIP; безопасные относительные пути без symlink/traversal.
- Bundle и его ref/история; совпадение SHA с исходной передачей.
- Установщик существует, имеет PE-заголовок и размер 2 794 227 байт.
  SHA256 совпадает с отчётом и обоими логами проверки артефакта.
  NSIS bootstrap использует x86 PE, а лог Tauri явно указывает Target: x64;
  это не свидетельствует о сборке приложения для x86.
- Логи действительно содержат 375 frontend passed / 6 opt-in skipped,
  55 Rust passed, успешные check/build/NSIS и браузерный smoke JSON.
- Установщик сохранён как артефакт GitHub-релиза v0.2.16, а не бинарник в Git.
  Исходники/версия/ранее выпущенный Mac DMG не менялись.

## Результаты Windows по предоставленным отчёту и логам

Проверки здесь не запускались повторно на Windows с Mac. Это свидетельства
переданной Windows-сессии, а не новые измерения координатора.

| Проверка | Результат |
|---|---|
| Платформа | Windows 11 x64 |
| Инструменты | Node 24.16.0, npm 11.13.0, Rust/Cargo 1.99.0 MSVC, VS C++ Build Tools, WebView2 154.0.4258.53 |
| npm ci | Успех, 191 пакет, 0 сообщённых уязвимостей |
| Frontend | 375 passed, 6 opt-in live skipped |
| TypeScript/Vite | Успех; нефатальные предупреждения chunks/dynamic import |
| Rust fmt/check | Успех; Windows dead-code/unused предупреждения остались |
| Rust test | 55 passed; Mac-only тесты не входят в эту цифру |
| NSIS build | Успех, current-user, 0.2.16, неподписанный |
| Установка | Обновление 0.2.14 → 0.2.16, registry/installed version совпали |
| OpenCode | 1.18.33, healthy=true после установки |
| Packaged UI | Существующие чаты/проекты видны, Pi 0.85.1 обнаружен, Browser settings подключены к проекту |
| Config preservation | Отчёт сравнения: только управляемые MCP/skill additions; Pi models.json не изменился |
| Browser | 32 инструмента официального Playwright MCP 0.0.83 |
| Test-owned headed smoke | Auth/Origin, lazy launch, DOM, выдуманный пароль, upload/изоляция, screenshot, профиль/restart, same-client restart, owner-pipe cleanup прошли |
| Закрытие Desktop | По отчёту свой daemon завершён; OpenCode оставался healthy; после перезапуска новый daemon |

Поле healthy=false в **08-verify-artifact.log** относится к проверке только
артефакта до запуска/установки (ArtifactOnly); это не ошибка финальной проверки.
**09-verify-installed.log** подтверждает 0.2.16 и healthy=true.

## Что не подтверждено

Packaged top-bar browser opening, Pi chat/LSP и Pi Job Object cleanup,
attachments/clipboard/drag-and-drop, dictation, SSH, browser stop/re-enable
и отдельный контролируемый сценарий external-server reuse не закончены
в переданной Windows-сессии. Реальный headed smoke был в отдельном тестовом
runtime и не заменяет эти packaged UI-проверки. Наличие флага hidden-console
собралось на Windows; визуальное отсутствие всех возможных console flashes
отдельно не проверено. Agent Control/Factory и full-computer control сохраняют
прежние ограничения. Linux 0.2.16 остаётся непроверенным.

Отчёт отмечает оставленный test-owned runtime около 790 MB в Windows %TEMP%:
его удаление было отклонено политикой той среды. Он не входит в ZIP и не является
рабочим профилем. Mac-импорт не заявляет очистку ноутбука или изменение его данных.

## Контрольные суммы

- Входной ZIP:
  `d49c481c533b64a2ae705dfca33c4e69a2b7bdcaad148b9e327be9d3acfe26bb`.
- Git bundle:
  `f660f0d78a5d0aaeef584cdf2330749feb316d50c2545d513151f2620019ec1c`.
- `OpenCode Desktop_0.2.16_x64-setup.exe`:
  `25c103a867e397f28416e84a251cb3549fc15916d7e0908fcc58f4ae31ec4790`.

Сырые отчёт/логи сохранены в локальном каталоге результатов координатора;
в Git внесена эта сводка без приватных конфигов, имён пользователя и резервных копий.
