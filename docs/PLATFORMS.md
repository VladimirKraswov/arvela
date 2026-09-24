# Варианты сборки и поддержка платформ

Версия продукта — **0.2.9**, одинаково в `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml` и `src-tauri/tauri.conf.json` (проверяется тестом
`test/bundle-config.test.ts`).

## Матрица поддержки

| | Linux (Ubuntu 24.04, x86_64) | macOS (Apple Silicon) | Windows |
|---|---|---|---|
| Артефакт | `.deb` | `.app` + `.dmg` | **нет** |
| Конфиг варианта | `src-tauri/tauri.linux.conf.json` | `src-tauri/tauri.macos.conf.json` | отсутствует намеренно |
| Команда | `npm run build:linux` | `npm run build:macos` | — |
| Собрано и запущено | да, в этом чекауте | нет (нужен Mac) | нет |
| Оконный хром | системный заголовок GTK | overlay-светофор macOS | — |
| Подпись | нет | ad-hoc `signingIdentity: "-"`, Hardened Runtime | — |
| Микрофон | портал/PulseAudio | entitlement `com.apple.security.device.audio-input` | — |
| Звук завершения | `canberra-gtk-play` → `paplay` → `pw-play` | `afplay` + `Glass.aiff` | таблица пуста |
| Управление компьютером (Cua Driver) | недоступно, сообщается в настройках | да | — |
| Движок Pi | проверен вживую (0.85.1) | не проверялся здесь | — |
| LSP для Pi | typescript + rust проверены | зависит от установленных серверов | — |
| Каталог конфигурации OpenCode | `$XDG_CONFIG_HOME` → `$HOME/.config` | `$HOME/.config` | — |
| Данные приложения | `$XDG_DATA_HOME` → `$HOME/.local/share` | `$HOME/.local/share` | — |

**Windows не собран и не протестирован.** Пустых заглушек-артефактов нет.

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

Соответствие в UI обеспечивает `src/native/platform.ts`: класс `mac-chrome`
добавляется только на macOS, и только он включает отступы под светофор
(27 px над брендом, 90 px слева в топбаре, 40 px в настройках).

## Команды

Общее для обеих платформ:

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
# src-tauri/target/release/bundle/deb/OpenCode Desktop_0.2.9_amd64.deb
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
dpkg-deb -I "src-tauri/target/release/bundle/deb/OpenCode Desktop_0.2.9_amd64.deb"
dpkg-deb -c  "src-tauri/target/release/bundle/deb/OpenCode Desktop_0.2.9_amd64.deb"
```

В списке файлов не должно быть `Entitlements.plist`, `Info.plist` и `.icns`.

## Точки расширения для Windows

Ничего из этого не реализовано; список описывает, что именно нужно добавить.

1. `src-tauri/tauri.windows.conf.json` — цели (`nsis`/`msi`) и параметры
   WebView2. Сейчас файла нет намеренно: его появление и есть включение варианта.
2. `src-tauri/src/paths.rs` — арм `#[cfg(target_os = "windows")]` для
   `%APPDATA%` / `%LOCALAPPDATA%`; XDG-переменных там нет.
3. `src-tauri/src/sound.rs` — таблица `PLAYERS` для Windows пуста; заполнить её,
   не меняя `completion_chime`.
4. `src-tauri/src/hosts.rs` — `SSH_PROGRAMS` содержит только POSIX-пути; для
   Windows нужен `%SystemRoot%\System32\OpenSSH\ssh.exe` (по-прежнему абсолютный,
   без поиска по PATH).
5. `src/native/platform.ts` — значение `"windows"` уже распознаётся, подсказки
   микрофона и ярлык `Ctrl` уже заданы; оконный хром отдельной настройки не
   требует.
6. `scripts/` — аналог `check-linux-prereqs.sh` / `verify-macos.py` для
   проверки готового артефакта.

`src-tauri/src/computer.rs` (Cua Driver) остаётся macOS-only и на других
платформах честно сообщает о недоступности, не отключая прочие инструменты.
