# Варианты сборки и поддержка платформ

Версия продукта — **0.2.17**, одинаково в `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml` и `src-tauri/tauri.conf.json` (проверяется тестом
`test/bundle-config.test.ts`).

## Матрица поддержки

| | Linux (Ubuntu 24.04, x86_64) | macOS (Apple Silicon) | Windows |
|---|---|---|---|
| Артефакт | `.deb` | `.app` + `.dmg` | NSIS `.exe` |
| Конфиг варианта | `src-tauri/tauri.linux.conf.json` | `src-tauri/tauri.macos.conf.json` | `src-tauri/tauri.windows.conf.json` |
| Команда | `npm run build:linux` | `npm run build:macos` | `npm run build:windows` |
| Последняя проверенная сборка | 0.2.10, Ubuntu 24.04 | 0.2.16, Mac владельца | 0.2.16, Windows 11 x64, по переданным отчёту и логам |
| Оконный хром | системный заголовок GTK | overlay-светофор macOS | системный заголовок Windows |
| Подпись | нет | ad-hoc `signingIdentity: "-"`, Hardened Runtime | нет сертификата издателя |
| Микрофон | портал/PulseAudio | entitlement `com.apple.security.device.audio-input` | WebView2/Windows |
| Звук завершения | `canberra-gtk-play` → `paplay` → `pw-play` | `afplay` + `Glass.aiff` | без нативного проигрывателя |
| Управление компьютером (Cua Driver) | недоступно, сообщается в настройках | да | недоступно, сообщается в настройках |
| Движок Pi | проверен вживую (0.85.1) | проверен в нативном приложении с локальной Qwen | Pi 0.85.1 CLI + JSONL RPC проверены с локальной Qwen; packaged UI не проверен |
| LSP для Pi | typescript + rust проверены | TypeScript и Rust показаны как «готов» | не проверено |
| Каталог конфигурации OpenCode | `$XDG_CONFIG_HOME` → `$HOME/.config` | `$HOME/.config` | `%USERPROFILE%\.config\opencode` |
| Данные приложения | `$XDG_DATA_HOME` → `$HOME/.local/share` | `$HOME/.local/share` | `%LOCALAPPDATA%\opencode-desktop` |

Windows 0.2.16 собран без изменения main, установлен и проверен с OpenCode
1.18.33; 375 frontend / 55 Rust тестов и отдельный browser smoke прошли.
[Подробное происхождение артефакта и ограничения](WINDOWS-RESULT-0.2.16-20261005.md).
Генерации Qwen в этом прогоне не было; её проверка относится к прежнему 0.2.14.
Agent Control использует Unix domain socket и потому
на Windows пока явно недоступен; Agent Factory, зависящая от него, также не
имеет полного Windows-паритета. Pi обнаружен в настройках установленного UI;
его чат, LSP и SSH на Windows не проходили живой тест.

## Как устроено разделение конфигурации

Tauri 2 автоматически сливает `tauri.<platform>.conf.json` с `tauri.conf.json`.
Объекты сливаются по ключам, **массивы заменяются целиком** — поэтому
`app.windows` в macOS-оверлее повторяет весь объект окна, а не только свои
добавления. `test/bundle-config.test.ts` следит, чтобы общий объект и его копия
не разъехались.

- `tauri.conf.json` — платформенно-нейтральный: идентификатор, версия, CSP,
  размеры окна, иконки, описание. Никакого macOS-хрома и никаких entitlements.
- `tauri.macos.conf.json` — `titleBarStyle: "Overlay"`, `hiddenTitle`,
  `bundle.macOS.entitlements`, цели `app` + `dmg`.
- `tauri.linux.conf.json` — цель `deb`. Runtime-зависимости пакета
  (`libwebkit2gtk-4.1-0`, `libgtk-3-0`) Tauri выводит из бинарника сам; дублировать
  их в конфиге не нужно — это лишь удваивает поле `Depends`.
- `tauri.windows.conf.json` — цель `nsis`, установка для текущего пользователя.

Соответствие в UI обеспечивает `src/native/platform.ts`: класс `mac-chrome`
добавляется только на macOS, и только он включает отступы под светофор
(27 px над брендом, 90 px слева в топбаре, 40 px в настройках).

## Команды

Общее для трёх платформ (на Windows используйте `npm.cmd`):

```sh
npm ci
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml
```

### Linux (.deb)

```sh
npm run check:linux-prereqs        # только сообщает недостающие пакеты
npm run build:linux
# src-tauri/target/release/bundle/deb/OpenCode Desktop_<version>_amd64.deb
```

Требуемые системные пакеты Ubuntu 24.04:

```
build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev \
libsoup-3.0-dev librsvg2-dev libssl-dev
```

Скрипт ничего не устанавливает и ничего не меняет в системе.

### macOS (.app + .dmg)

```sh
npm run build:macos
python3 scripts/verify-macos.py "src-tauri/target/release/bundle/macos/OpenCode Desktop.app"
```

`build:macos` сохраняет прежний способ ad-hoc подписи
(`--config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'`): линковочная подпись
не проходит строгую проверку, поэтому бандл пересобирается с явной identity `-`.
`verify-macos.py` проверяет подпись, наличие entitlement аудиовхода и
`NSMicrophoneUsageDescription` на **готовом артефакте**, а не в исходных plist.

### Windows (NSIS .exe)

```powershell
npm.cmd ci
npm.cmd test -- --maxWorkers=2
npm.cmd run build:windows
# src-tauri\target\release\bundle\nsis\OpenCode Desktop_<version>_x64-setup.exe
```

Нужны Rust stable-msvc, Visual Studio Build Tools с Desktop C++ workload,
Node.js 24 LTS >=24.15.0/npm и WebView2. По переданным отчёту и логам сборка 0.2.16
проверена на Windows 11 x64. Установщик
предназначен для текущего пользователя и в локальной сборке не имеет цифровой
подписи издателя.

`scripts/check-windows-prereqs.ps1` совместим с Windows PowerShell 5.1 и
PowerShell 7. `scripts/verify-windows.ps1` проверяет метаданные установщика,
совпадение установленной версии и `/global/health`; отсутствие установки или
здорового сервера — ошибка. `-ArtifactOnly` проверяет только файл установщика.
Это не заменяет проверку окна, Pi, разрешений, вложений и диктовки в приложении.
Windows-артефакт 0.2.16 построен из main `2def38234eb4e06a6cf1f39d2e30edb4aed01703`
без правок. SHA256 и проверенные/непроверенные сценарии указаны в отчёте импорта.

## Проверка Linux-рантайма

Без физического дисплея:

```sh
Xvfb :77 -screen 0 1360x900x24 &
DISPLAY=:77 ./src-tauri/target/release/opencode-desktop &
DISPLAY=:77 xwininfo -root -tree          # ждём окно "OpenCode Desktop" 1360x900
DISPLAY=:77 xwd -root -silent -out /tmp/shot.xwd
```

`libEGL warning: DRI3 ...` при программном рендеринге безвредны. Не направляйте
тестовый запуск на реальный OpenCode владельца: недостижимый адрес — ожидаемый
результат, он же проверяет состояние ошибки подключения.

Проверить содержимое пакета без установки:

```sh
dpkg-deb -I "src-tauri/target/release/bundle/deb/OpenCode Desktop_<version>_amd64.deb"
dpkg-deb -c  "src-tauri/target/release/bundle/deb/OpenCode Desktop_<version>_amd64.deb"
```

В списке файлов не должно быть `Entitlements.plist`, `Info.plist` и `.icns`.

## Ограничения Windows

- Agent Control MCP и Agent Factory пока недоступны: текущая реализация сервера
  использует Unix domain socket. UI сообщает об этом без падения приложения.
- `src-tauri/src/computer.rs` (Cua Driver) остаётся macOS-only и на других
  платформах честно сообщает о недоступности, не отключая прочие инструменты.
- Поиск OpenCode CLI, каталоги данных, пути без проекта и системный OpenSSH
  портированы; локальный OpenCode/Qwen проверен в пути с пробелами и кириллицей.
- Windows-поиск Pi/Node реализован; Pi 0.85.1 установлен и его короткая генерация
  плюс JSONL RPC (`get_available_models`, `get_state`, `get_commands`) проверены
  с локальной Qwen в прежнем прогоне. Теперь обнаружение Pi проверено в packaged
  settings; Pi chat, LSP и SSH-сценарий ещё не проверялись.
  В исходниках (обзор 2026-10-05) дерево Pi привязывается к Job Object с
  KILL_ON_JOB_CLOSE (best effort: при отказе Pi работает с прежней очисткой
  только прямого потомка); код собрался на Windows, но Pi tree cleanup ещё
  не проверялся вживую.
- Все консольные дочерние процессы Desktop (ssh.exe, node.exe для Pi/браузера,
  `opencode serve`, проверки `--version`) создаются с `CREATE_NO_WINDOW`
  (общий модуль `src-tauri/src/process.rs`). Windows-сборка проходит;
  отсутствие всплывающих консолей во всех сценариях не проверено.
- Нативный проигрыватель системного звука завершения для Windows не добавлен.


## Встроенная панель 0.2.17

Панель импортирована из Windows-ветки 7452a0e (её локальный установщик сохранял
номер 0.2.16). На Mac интеграция получает новый номер 0.2.17, чтобы не подменять
опубликованный релиз. Windows-артефакты 0.2.16 и их отчёты не являются сборками
окончательного main 0.2.17.
[Проверки импорта и ограничения](EMBEDDED-BROWSER-IMPORT-20261005.md).
