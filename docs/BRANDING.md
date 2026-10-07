# Arvela

Короткое имя продукта — **Arvela**, по-русски «Арвела». Без приставок Agent,
Mesh или Desktop в интерфейсе. Это рабочее пространство для разных AI-агентов,
а не имя одного из подключённых движков.

С версии 0.2.24 имя используется в окне, настройках, системном меню, иконке,
macOS/Windows/Linux сборках, npm/Rust package и публичном репозитории:
https://github.com/VladimirKraswov/arvela . Старый URL репозитория перенаправляет
на новый; существующие Git-копии можно переключить командой
`git remote set-url origin https://github.com/VladimirKraswov/arvela.git`.

С версии 0.2.26 исходник иконки — `src/assets/arvela-icon.png`: объёмная переплетённая A на тёмно-синем фоне, бирюзовый/фиолетовый градиент. Создан встроенным imagegen; прозрачные внешние углы. Промпт: «Arvela desktop icon, bold interwoven satin ribbon A, turquoise to violet, navy squircle, clear at 32px, no text or small details». Прежний векторный знак сохранён в `src/assets/arvela.svg`. Пересоздание нативных иконок:
`npm run tauri -- icon src/assets/arvela-icon.png --output src-tauri/icons`.
Мобильные иконки, которые дополнительно создаёт CLI, в этот desktop-проект
не включаются.

Для сохранения истории и подключений остаются технические идентификаторы
`dev.local.opencodedesktop`, executable `opencode-desktop`, data paths,
OS-vault namespaces, preference keys, имена навыков и MCP/tool IDs. Это
совместимость с прежними версиями, а не отдельный продукт. OpenCode и Pi
сохраняют собственные имена.

На Mac новая установка — `/Applications/Arvela.app`. Прежний bundle нужно
сохранить в приватной резервной копии; путь `/Applications/AgentMesh Desktop.app`
остаётся ссылкой на Arvela, чтобы ранее подключённые MCP-клиенты продолжили
находить executable. Только одна копия приложения работает с профилем.
Ярлыки пользователя получают новое имя. Windows-проверка установки распознаёт
Arvela, AgentMesh Desktop и OpenCode Desktop и отказывает при неоднозначном
совпадении версий; живое обновление Windows/Linux проверяется на этих системах.

Датированные отчёты, контрольные суммы и ранее опубликованные артефакты
сохраняют реальные исторические названия. Текущие инструкции и интерфейс
используют Arvela.

Полный промпт и процесс подготовки ресурсов: [ARVELA-ICON.md](ARVELA-ICON.md).
