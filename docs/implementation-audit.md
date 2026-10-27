# Аудит до реалізації

**Дата:** 27 жовтня 2026 року. **Вхідні матеріали:** `index.js` та об’єднане технічне завдання Home Monitor.

## Поточна архітектура

- Єдиний Cloudflare Worker повертав HTML тільки для `/` і `/index.html`; інші шляхи отримували `404`.
- HTML, стилі та клієнтський JavaScript були упаковані в Base64-константу `DATA` усередині `index.js`.
- UI — одна сторінка з ручним перемиканням `.view`, глобальним об’єктом `state` та функціями на рівні документа; React/Vue, TypeScript, package manager scripts, окремі route modules і тести відсутні.
- Графіки працюють через наявний CDN Chart.js 4.5.1.
- API клієнт звертається до `https://smart-home-api-v2.mykola-taran-88.workers.dev/api/v1`; існували dashboard, score, devices, history, tariff analytics, timeline та захищені admin endpoints.
- У наданому файлі не було конфігурації Wrangler, CI, backend-коду чи API OpenAPI-схеми.

## Виявлені проблеми

1. Base64-моноліт ускладнював review, підтримку та відтворювану збірку.
2. Worker обслуговував тільки кореневий шлях — direct deep links після refresh не працювали.
3. Головна дублювала детальні дані та містила англомовні назви/старі labels.
4. План клімату залежав від `/floor-plan.png`, був неповним SVG та мав інтерактивність лише в кількох кімнатах.
5. Температура й вологість використовували один графік з різними осями; історичні розриви й актуальність не були узгоджені наскрізно.
6. Погода показувалася в dual-axis графіку; режими не відповідали всім вимогам, а часовий пояс був жорстко прив’язаний до Europe/Kyiv у частині UI.
7. Існували `|| 0` та інші fallback-и, що могли показувати відсутні показники як нулі.
8. Один `Promise.all` у початковому loader міг зірвати весь dashboard через одну помилку джерела.
9. Не було автономного маршруту/сторінки пристроїв; переходи були обмежені вкладками SPA.
10. Не було окремих README, API gap log, migration notes, testing report чи автоматизованих smoke-тестів.

## Компоненти/логіка для повторного використання

- Наявний API helper `req`, кешування/дедуплікація запитів та bearer token для адмін-зони.
- Наявні API endpoints і domain state (`overview`, `dash`, `score`, history series, device status, tariff range).
- Timeline, адмін-зона каналів/категорій/налаштувань/audit, існуючі period selectors, toast, modal і Chart.js.
- Існуючі API field names використовуються через новий mapping layer, а не переписуються в React-компонентах (React у проєкті немає).

## На заміну / реалізовано заново

- Окреме джерело HTML у `src/index.html` та build script.
- Route-aware Worker для direct links.
- Оновлена «Стан дому» з deduped alert center, snapshots, 7-day strip, system status та top-3 recommendations.
- Повний векторний SVG-план з п’ятьма кімнатами й окремим зовнішнім sensor item.
- Два окремі climate charts, energy metric modes, погодні метрики, data-state helpers та окрема сторінка пристроїв.
- CSS token layer, адаптивні стилі, focus/touch sizing та reduced-motion правила.

## Міграційний план

1. Зберегти Cloudflare Worker + чинний API host.
2. Винести HTML із Base64 у `src/index.html`.
3. Зберегти endpoints та адміністративні API; додати adapters на клієнті.
4. Додати кореневі й deep-link routes на Worker.
5. Додати static checks і route smoke tests.
6. Поступово закрити API gaps і виконати перевірки у staging з реальними контрактами/пристроями.

## Технічні ризики

- API schemas не надані; частина поля очікуються за фактично наявними frontend references, не за контрактом, підтвердженим backend.
- Таймзона, тарифи та межі комфорту доступні тільки якщо backend/config повертає їх. Відсутні конфігурації не підміняються вигаданими.
- UI лишається vanilla JS/HTML, бо це поточний deployable формат; повний модульний React/TypeScript rewrite був би архітектурною міграцією та ризиком для робочих інтеграцій.
- Реальні API responses, permissions і пристрої не були включені до завантаження, тому динамічну поведінку треба перевірити у середовищі користувача.

## Примітка щодо меж рефакторингу

Для зниження ризику регресії збережено великий legacy `core.js` із глобальним `state` і частиною старих renderer-функцій. `dashboard.js` має новий UI/data-adapter шар і перевизначає кілька однойменних renderer functions після завантаження core. Це не фінальна модульна архітектура; повне видалення legacy-реалізацій потребує ізольованого browser E2E з реальними даними та окремого проходу по admin/timeline flows. Повторні визначення й глобальний state залишаються відомим технічним боргом, свідомо не прибраним автоматичним пошуковим/regex-рефакторингом.
