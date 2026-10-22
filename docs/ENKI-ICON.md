# Иконка Enki

Канонический растровый исходник — [src/assets/enki-icon-master.png](../src/assets/enki-icon-master.png).
Золотой знак соединяет мотив клинописи и двух потоков воды на лазуритной
скруглённой плитке. Это современная интерпретация имени Энки, а не историческая надпись.
Рисунок создан встроенным imagegen; прозрачность за пределами плитки сохранена.
Боковая панель и браузерная вкладка используют уменьшенную 256px копию
src/assets/enki-icon.png (73 КБ), чтобы не загружать полный мастер; нативные
размеры, Windows ICO/Appx и macOS ICNS получены штатным Tauri CLI.

## Воспроизведение упаковки

```sh
npm run tauri -- icon src/assets/enki-icon-master.png --output .local/enki-icons
cp .local/enki-icons/128x128@2x.png src/assets/enki-icon.png
```

Скопируйте только соответствующие настольные файлы из .local/enki-icons
в src-tauri/icons. Мобильные ресурсы в проект не включаются.
Не заменяйте исходник уменьшенным icon.png: он нужен для следующих сборок.
Иконка трея использует нативный ресурс приложения. Новая иконка Dock/меню
запуска требует нативного обновления; горячая UI-замена обновляет только интерфейс.

## Промпт генерации

Use case: logo-brand. Create one finished square desktop application icon for Enki, an AI coding assistant named after the Sumerian deity of wisdom and fresh water. A premium, exceptionally clean, memorable emblem: a single bold warm-gold abstract cuneiform-inspired water glyph, subtly suggesting an E and two flowing streams, centered on a deep lapis-blue rounded-square tile. Strong sculptural silhouette, a restrained satin-gold highlight and subtle dimensional blue depth, elegant modern macOS app-icon craft. Glyph occupies about 62 percent of tile width, thick forms and generous negative space so it is instantly readable at 32 pixels. Tile occupies 90 percent of square canvas, evenly centered, transparent outside rounded corners. Straight-on orthographic view. No words, letters as typography, captions, borders, tiny details, drop shadow outside tile, watermark, mockup, or surrounding scene. This is a modern interpretation, not an archaeological inscription. Produce the actual icon alone, 1024 by 1024.
