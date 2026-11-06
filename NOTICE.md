# Происхождение кода

Tobi основан на коде **Coucou for Windows** — https://github.com/louis-cfm/coucou,
папки `windows/` (приложение Tauri) и `windows/hook/`, коммит `1e5180921c1326fc72e41d313e3e2855e9c10162`
(20.10.2026), затем перенесено всё до Coucou for Windows 0.5.3 (коммит a8815f4, 22.10.2026): WhatsApp, «Что нового», синий Tobi при обновлении, недельный итог на телефоне. Код Coucou распространяется по лицензии MIT, © 2026 Louis Raillé.

Из Coucou **не взято**: имя «Coucou», персонаж Mochi (внешний вид, выражения), иконки, звуки и картинки.

Перенос новых функций из Coucou: `git remote add upstream https://github.com/louis-cfm/coucou`,
затем смотреть `git diff 1e51809..upstream/main -- windows/` и переносить вручную.

## Лицензия

Код Tobi распространяется по лицензии Apache 2.0 (файл LICENSE). Часть кода взята из проектов под лицензией MIT, их текст сохранён ниже.

```
MIT License

Copyright (c) 2026 Louis Raillé (Coucou, the code Tobi is based on)
Copyright (c) 2026 Rhytam Biswas (Coucou for Android, the code in android/ is based on)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
