# Иконка Enki

Канонический растровый исходник — [src/assets/enki-icon-master.png](../src/assets/enki-icon-master.png).
Персонаж Enki — робот в тёмно-синем капюшоне с голубыми светящимися глазами,
угловатыми боковыми модулями и прозрачным фоном. Владелец выбрал этот
самостоятельный рисунок по мотивам предоставленного референса.
Рисунок создан встроенным imagegen; прозрачность вокруг персонажа сохранена.
Боковая панель и favicon используют уменьшенную 256px копию
src/assets/enki-icon.png; нативные PNG, Windows ICO/Appx и macOS ICNS
получены из того же мастера штатным Tauri CLI.

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

Use case: logo-brand. Create an original premium mascot emblem for Enki, an AI desktop application. Input image is THEME REFERENCE ONLY: do not duplicate its character, pose, hood geometry or headphone design. A friendly mysterious little robotic intelligence wearing a sculpted midnight-navy hood, smooth obsidian visor with two luminous cyan expressive eyes. Distinct original design: slightly rounded pentagonal hood opening with folded cheek edges, calm curious eyes instead of angry slashes, subtle asymmetric hood fold, compact small angular ear modules instead of large circular headphones, tiny restrained cyan circuit accents. Clean centered head-and-shoulders bust facing straight ahead, symmetrical overall silhouette, all visible within square canvas with generous safe margin. Polished stylized 3D logo render, crisp deliberate contours, restrained materials and highlights, large readable shapes suitable for a 32px app icon. Deep navy and electric cyan, no extraneous scene. Genuine transparent background outside the mascot. No text, no letters, no watermark, no border, no surrounding tile, no tiny busy details, no weapons. One finished mascot emblem only, not a presentation sheet.
