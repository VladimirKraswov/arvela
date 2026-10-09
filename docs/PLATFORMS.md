# Платформы и сборки Arvela

Текущий номер берётся из `package.json`; `bundle-config.test.ts` проверяет его
совпадение с Cargo/Tauri. Стабильные идентификатор `dev.local.opencodedesktop`,
исполняемый файл `opencode-desktop` и прежние пути данных сохранены для обновлений.

## Общий код и реальные границы

По переданному отчёту Windows-агента от 2026-10-09: 0.2.35 с минимальным
исправлением Git-карты проекта собрана на Windows; 654 frontend, 78 Rust (включая дерево Job Object), 37 Hub и
реальные изолированные browser/shared-MCP/Pi-loader проверки пройдены.
0.2.35 установлена: обычный путь Windows, версия в Settings, список чатов и
Qwen Medium; установленный MCP (36 инструментов), ввод/клик в панели и DOM
проверены. Это не полная platform acceptance и не новый запуск задачи моделью.
[Отчёт и ограничения 0.2.35](WINDOWS-RESULT-0.2.35-20261009.md).

| | macOS | Windows | Linux |
|---|---|---|---|
| CI runner | macos-14, ARM64 | windows-2022, x64 | ubuntu-24.04, x64 |
| Пакет | `.app` + `.dmg` | NSIS `.exe`, текущий пользователь | `.deb` |
| Команда | `npm run build:macos` | `npm.cmd run build:windows` | `npm run build:linux` |
| Оверлей | `tauri.macos.conf.json` | `tauri.windows.conf.json` | `tauri.linux.conf.json` |
| OpenCode / Pi / общий MCP | реализованы | реализованы | реализованы |
| Agent Control / Factory | Unix socket | недоступны, UI сообщает | Unix socket |
| Cua Driver | отдельная интеграция | недоступна | недоступна |
| Нативный звук | afplay | нет системного проигрывателя | первый доступный canberra/paplay/pw-play |
| Хранилище ключей | Keychain | Windows Credentials | Secret Service |

«Реализовано» не означает «проверено в packaged UI на этой ОС». Свежая живая
проверка ведётся в [VERIFICATION.md](VERIFICATION.md). Для M42 все три нативных
CI-пакета 0.2.33 собраны и проверены; macOS 0.2.33 установлен и проверен по
версии, агентам, восстановлению состояния и Hub. Windows/Linux текущие
live-сценарии не запускались. Прежние
[Windows 0.2.21](WINDOWS-RESULT-0.2.21-20261007.md) и Linux 0.2.10 — отдельные
исторические результаты, не доказательство работоспособности нового релиза.

## CI

[Desktop platform builds](../.github/workflows/desktop.yml) запускается на main,
рабочих `codex/**` ветках, pull request и вручную. Три независимых задания:
`npm ci`, frontend-тесты, offline eval-contracts, Hub Python-тесты, Rust fmt/check/
test и настоящий Tauri пакет. Fail-fast выключен: сбой Windows не скрывает
результат других ОС. Повторный push отменяет только устаревший запуск этой ветки.
Cargo кэш разделён по ОС/архитектуре/lockfile; Node 24 и Rust stable указываются
в артефактном receipt. Actions закреплены по commit SHA.

Проверки пакета: Mac signature/microphone + DMG CRC, Windows непустой PE/NSIS,
Linux версия/payload/no macOS files. Артефакты и `.local/ci-artifacts.json` с
version, commit, SHA256 и toolchains доступны 14 дней. Runner не устанавливает
приложение, не открывает GUI, не запускает модели и не требует приватных ключей.
CI не публикует релизы автоматически. [Чеклист живой проверки](PLATFORM-ACCEPTANCE.md)
ведётся отдельно; receipt всегда пишет `liveAcceptance: not-run`.

## Локальная сборка

Нужны Node 24, Rust stable; `npm ci` и Cargo `--locked` используют lockfiles.
Tauri автоматически объединяет базовый конфиг с оверлеем ОС. Объекты сливаются,
массивы заменяются целиком; тест проверяет полный Mac-объект окна, CSP,
entitlements и отдельные bundle targets.

```sh
npm ci
npm test -- --maxWorkers=2
npm run build
cargo check --locked --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

macOS: Xcode Command Line Tools, `npm run build:macos`, затем
`python3 scripts/verify-macos.py src-tauri/target/release/bundle/macos/Arvela.app`.
Локальный DMG подписан ad-hoc; notarization/сертификат издателя не настроены.

Windows: Visual Studio C++ Build Tools, Rust stable-msvc, WebView2, Node 24.
Используйте `npm.cmd`, затем `scripts/verify-windows.ps1 -ArtifactOnly`. Проверка
без `-ArtifactOnly` требует установки и здорового OpenCode; она не заменяет GUI.
Установщик без подписи издателя. Деревья дочерних процессов используют Job Object;
создание консольных процессов скрыто. Полный live tree-cleanup проверяется отдельно.

Ubuntu 24.04: build-essential, pkg-config, libgtk-3-dev, libwebkit2gtk-4.1-dev,
libsoup-3.0-dev, librsvg2-dev, libssl-dev. `npm run check:linux-prereqs` только
сообщает зависимости; `npm run build:linux` создаёт пакет. `dpkg-deb -I/-c` проверяет
его без установки. Xvfb — только smoke рендеринга, не проверка реального рабочего стола.
Зависимости сверены с [официальными требованиями Tauri](https://v2.tauri.app/start/prerequisites/).

## Пути и владение

OpenCode конфиг: macOS `$HOME/.config/opencode`, Linux абсолютный
`$XDG_CONFIG_HOME` или `$HOME/.config/opencode`, Windows `%USERPROFILE%\.config\opencode`.
Данные Arvela: macOS `$HOME/.local/share`, Linux абсолютный `$XDG_DATA_HOME` или
`$HOME/.local/share`, Windows `%LOCALAPPDATA%\opencode-desktop`. Точные подкаталоги
разрешает `src-tauri/src/paths.rs`; изменение названия продукта их не мигрирует.

Desktop управляет только собственными Pi/browser/SSH дочерними процессами. Уже
запущенный внешний OpenCode не останавливается при выходе. Все консольные процессы
Windows проходят общий helper `process.rs`. Агент выбирается отдельно от платформы;
недоступность Cua Driver или Agent Control не выключает Pi/браузер/обычные инструменты.
