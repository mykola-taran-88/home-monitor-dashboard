# Migration notes

## Поточний формат збережено

Home Monitor лишається HTML/CSS/vanilla JS застосунком, який публікується як один Cloudflare Worker. Це зберігає API URL, глобальний state, Chart.js та admin/auth flows і уникає непотрібного переходу на новий framework.

## Новий робочий цикл

1. Редагувати `src/index.html`.
2. Запустити `npm run build` — оновиться `index.js` з embedded Base64 HTML.
3. Запустити `npm run lint` і `npm test`.
4. Перевірити Worker у staging з реальними backend endpoints, адміністраторською сесією, фактичними налаштуваннями тарифів і пристроями.
5. Завантажити `index.js` у чинний Worker без заміни environment settings/secrets/custom domains.

## Сумісність

- API base не змінився.
- Існуючі administrative endpoints і session token flow збережені.
- SPA переходи працюють як раніше, але вкладки також оновлюють URL; direct refresh підтримується на нових UI routes.
- Unknown route повертає 404; GET/HEAD підтримані, інші методи — 405.
- Нових npm runtime dependencies немає. CDN Chart.js збережено.

## Перевірка після deploy

- Усі старі admin flows (login, settings, category/channel changes, notification test, audit log).
- `GET /control/overview`, `/dashboard`, `/home-score`, `/devices/status`, chart/history/tariff/timeline endpoints.
- Direct navigation з query parameters, back/forward, позиція dashboard після повернення.
- Actual tariff settings/rates, energy intervals crossing tariff boundary, timestamps/timezone.
- Stale/offline sensors, empty history, domain API failures, retry without clearing last-good data.
- Mobile/tablet interactions та fullscreen keyboard/focus flow.

## Технічний борг, який треба врахувати

`src/scripts/dashboard.js` наразі накладає нові renderer/adapters на частину глобальних функцій `src/scripts/core.js`. Це перехідний шар для сумісності, не ідеальна фінальна модульна структура. Видаляти legacy implementations без браузерного регресійного тестування адміністративних, timeline та історичних графіків не рекомендується. Нові функції потрібно додавати до dashboard layer або поступово переводити на окремі модулі після staging QA.
