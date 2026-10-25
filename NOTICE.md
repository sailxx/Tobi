# Происхождение кода

Tobi основан на коде **Coucou for Windows** — https://github.com/louis-cfm/coucou,
папки `windows/` (приложение Tauri) и `windows/hook/`, коммит `1e5180921c1326fc72e41d313e3e2855e9c10162`
(20.10.2026), затем перенесено всё до Coucou for Windows 0.5.3 (коммит a8815f4, 22.10.2026): WhatsApp, «Что нового», синий Tobi при обновлении, недельный итог на телефоне. Код Coucou распространяется по лицензии MIT, © 2026 Louis Raillé.

Из Coucou **не взято**: имя «Coucou», персонаж Mochi (внешний вид, выражения), иконки, звуки и картинки.

Перенос новых функций из Coucou: `git remote add upstream https://github.com/louis-cfm/coucou`,
затем смотреть `git diff 1e51809..upstream/main -- windows/` и переносить вручную.
